/**
 * 模型測試路由 Handler（POST /api/test/chat）
 *
 * 與正式 chat 路由不同之處：
 *  - 不用排隊、不做模型順位調度，僅用一把 Key 試一次
 *  - Key 失敗時遞迴嘗試下一把，直到所有 Key 都失敗
 *  - 內容校驗失敗時以 throw ContentValidationError 觸發下一把 Key
 *  - 使用 TEST_TIMEOUT_MS 而非 REQUEST_TIMEOUT_MS
 */

const { apiKeys, settings } = require('../../database');
const { addLog } = require('../logs/logger');
const { sanitizeChatCompletionBody } = require('../utils/sanitize');
const { smartValidate, formatValidationIssue } = require('../engine/contentValidator');
const ContentValidationError = require('../errors/ContentValidationError');

const NVIDIA_BASE_URL = process.env.NVIDIA_API_URL || 'https://integrate.api.nvidia.com/v1';

async function handleTestChat(req, res) {
  const { model, messages, stream, response_format } = req.body;
  const enableContentValidation = settings.get().ENABLE_CONTENT_VALIDATION;

  if (!model || !messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Model and messages array are required' });
  }

  const sanitized = sanitizeChatCompletionBody({ model, messages, stream, response_format });
  const cleanMessages = sanitized.messages;

  const activeKeys = apiKeys.getActiveKeys();
  if (activeKeys.length === 0) {
    return res.status(503).json({ error: 'No active/healthy API Keys available in the Gateway pool.' });
  }

  async function attemptTestChat(keyIndex) {
    if (keyIndex >= activeKeys.length) {
      addLog('error', `[模型測試] 所有可用 Key（${activeKeys.length} 把）都無法測試模型「${model}」。`);
      return res.status(502).json({
        error: {
          message: `模型「${model}」測試失敗：所有可用 Key 都無法完成請求。`,
          type: 'api_error',
          code: 'all_keys_failed'
        }
      });
    }

    const selectedKey = activeKeys[keyIndex];
    addLog('info', `[模型測試] 使用 Key ...${selectedKey.key_value.substring(selectedKey.key_value.length - 8)} 測試模型「${model}」（第 ${keyIndex + 1}/${activeKeys.length} 把）。`);

    const abortController = new AbortController();
    const testTimeoutMs = settings.get().TEST_TIMEOUT_MS || 60000;
    addLog('info', `[模型測試] 使用測試逾時 ${testTimeoutMs / 1000} 秒（TEST_TIMEOUT_MS）。`);
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, testTimeoutMs);

    try {
      const response = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${selectedKey.key_value}`
        },
        body: JSON.stringify({
              model: model,
          messages: cleanMessages,
          stream: !!stream,
          temperature: 1,
          ...(sanitized.response_format ? { response_format: sanitized.response_format } : {})
        }),
        signal: abortController.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errText = await response.text();
        addLog('warning', `[模型測試] Key ID ${selectedKey.id} 收到 NIM HTTP ${response.status}：${errText}`);

        if (response.status === 404 || response.status === 401 || response.status === 403 || response.status === 429 || response.status >= 500) {
          if (response.status === 401 || response.status === 403) {
            apiKeys.updateStatus(selectedKey.id, 'inactive', `HTTP ${response.status}: Key revoked/invalid`);
          } else if (response.status === 429) {
            apiKeys.recordCooldown(selectedKey.id, 30, '429 Rate Limit Exceeded');
          }
          return attemptTestChat(keyIndex + 1);
        }

        return res.status(response.status).json({
          error: {
            message: errText,
            type: 'invalid_request_error',
            code: 'test_chat_error'
          }
        });
      }

        if (stream) {
          const reader = response.body.getReader();
          let fullContent = '';
          const contentBuffer = [];
          let validationFailed = false;
          const noValidation = !enableContentValidation;

          if (noValidation) {
            res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
          }

          function readTestChunk() {
            return reader.read().then(({ done, value }) => {
              if (done) {
                if (!noValidation) {
                  if (!fullContent || !fullContent.trim()) {
                    validationFailed = true;
                    addLog('error', `[模型測試｜內容校驗] 串流回應被拒收：模型回傳了空內容。`);
                    throw new ContentValidationError('模型回傳空內容 (Empty Content)');
                  }
                  const validation = smartValidate(fullContent, { maxLength: 10000 });
                  if (!validation.valid) {
                    validationFailed = true;
                    addLog('error', `[模型測試｜內容校驗] 串流回應被拒收：偵測到不合法或未閉合標籤：${formatValidationIssue(validation)}。`);
                    throw new ContentValidationError(fullContent);
                  }
                  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
                  res.setHeader('Cache-Control', 'no-cache');
                  res.setHeader('Connection', 'keep-alive');
                  for (const chunk of contentBuffer) {
                    res.write(chunk);
                  }
                  res.end();
                } else {
                  res.end();
                }
                return;
              }

              if (noValidation) {
                res.write(value);
                return readTestChunk();
              }

              const text = new TextDecoder().decode(value, { stream: true });
              const lines = text.split('\n');
              for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith('data:') && !trimmed.includes('[DONE]')) {
                  try {
                    const dataStr = trimmed.slice(5).trim();
                    const parsed = JSON.parse(dataStr);
                    if (parsed.choices && parsed.choices[0]) {
                      const delta = parsed.choices[0].delta;
                      const msg = parsed.choices[0].message;
                      const txt = parsed.choices[0].text;
                      const content = parsed.choices[0].content;
                      const add = (s) => { if (typeof s === 'string') fullContent += s; };
                      add(delta && delta.content);
                      add(delta && delta.reasoning_content);
                      add(msg && msg.content);
                      add(msg && msg.reasoning_content);
                      add(txt);
                      add(content);
                    }
                  } catch (e) {
                    // ignore
                  }
                }
              }
              contentBuffer.push(value);
              return readTestChunk();
            });
          }

        try {
          await readTestChunk();
        } catch (err) {
          if (err.name === 'ContentValidationError') {
            addLog('error', `[模型測試] 內容在送到前端前校驗失敗，改用下一把 Key 重新生成。`);
            return attemptTestChat(keyIndex + 1);
          }
          addLog('error', `[模型測試] 串流讀取錯誤：${err.message}`);
          if (!res.headersSent) {
            return res.status(502).json({
              error: {
                message: `串流讀取錯誤：${err.message}`,
                type: 'api_error',
                code: 'stream_error'
              }
            });
          }
          res.end();
        }
       } else {
         const json = await response.json();
         // 非串流：清理假串流字元後再校驗與回傳。
         const stripFake = (c) => {
           if (typeof c === 'string') return c.replace(/\uE000+/g, '');
           return c;
         };
         const target = json?.choices?.[0]?.message;
         if (target) {
           if (typeof target.content === 'string') target.content = stripFake(target.content);
           if (typeof target.reasoning_content === 'string') target.reasoning_content = stripFake(target.reasoning_content);
         }
         let contentToCheck = target?.content || target?.reasoning_content || '';

         if (enableContentValidation) {
           const validation = smartValidate(contentToCheck, { maxLength: 10000 });
           if (!validation.valid) {
             const validationIssue = formatValidationIssue(validation);
             addLog('error', `[模型測試｜內容校驗] 非串流回應被拒收：偵測到不合法或未閉合標籤：${validationIssue}，改用下一把 Key 重新生成。`);
             return attemptTestChat(keyIndex + 1);
           }
         }

         res.json(json);
      }
    } catch (err) {
      clearTimeout(timeoutId);
      addLog('warning', `[模型測試] Key ID ${selectedKey.id} 請求失敗：${err.message}`);
      return attemptTestChat(keyIndex + 1);
    }
  }

  await attemptTestChat(0);
}

module.exports = {
  handleTestChat
};