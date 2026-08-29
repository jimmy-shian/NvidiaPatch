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
const { resolveChatCompletionsUrl, isCustomUpstreamUrl } = require('../utils/urlHelper');

async function handleTestChat(req, res) {
  const { model, messages, stream, response_format } = req.body;
  const currentSettings = settings.get();
  const enableContentValidation = currentSettings.ENABLE_CONTENT_VALIDATION;
  const rawBaseUrl = currentSettings.NVIDIA_API_URL || process.env.NVIDIA_API_URL || 'https://integrate.api.nvidia.com/v1';
  const targetUrl = resolveChatCompletionsUrl(rawBaseUrl);
  const isCustomUrl = isCustomUpstreamUrl(rawBaseUrl);

  if (!model || !messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Model and messages array are required' });
  }

  const sanitized = sanitizeChatCompletionBody({ model, messages, stream, response_format });
  const cleanMessages = sanitized.messages;

  let activeKeys = apiKeys.getActiveKeys();
  if (activeKeys.length === 0) {
    if (isCustomUrl) {
      activeKeys = [{ id: 'local', key_value: 'local-key', status: 'active' }];
    } else {
      return res.status(503).json({ error: 'No active/healthy API Keys available in the Gateway pool.' });
    }
  }

  async function attemptTestChat(keyIndex) {
    if (res.destroyed || res.writableEnded) {
      return;
    }

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

    let isTimedOut = false;
    let isClientDisconnected = false;

    const timeoutId = setTimeout(() => {
      isTimedOut = true;
      abortController.abort();
    }, testTimeoutMs);

    const onClientClose = () => {
      if (!res.writableEnded) {
        isClientDisconnected = true;
        abortController.abort();
      }
    };
    if (typeof res.once === 'function') {
      res.once('close', onClientClose);
    }

    try {
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${selectedKey.key_value || 'local-key'}`
        },
        body: JSON.stringify({
          ...sanitized,
          model: model,
          messages: cleanMessages,
          stream: !!stream,
          temperature: sanitized.temperature !== undefined ? sanitized.temperature : 1
        }),
        signal: abortController.signal
      });

      clearTimeout(timeoutId);
      if (typeof res.off === 'function') {
        res.off('close', onClientClose);
      } else if (typeof res.removeListener === 'function') {
        res.removeListener('close', onClientClose);
      }

      if (!response.ok) {
        const errText = await response.text();

        if (response.status === 404) {
          addLog('error', `[模型測試] 模型「${model}」在端點回傳 404（模型不存在或端點不支援）：${errText.substring(0, 160)}`);
          return res.status(404).json({
            error: {
              message: `模型「${model}」不存在或端點不支援（HTTP 404）：${errText}`,
              type: 'invalid_request_error',
              code: 'model_not_found'
            }
          });
        }

        addLog('warning', `[模型測試] Key ID ${selectedKey.id} 收到 HTTP ${response.status}：${errText}`);

        if (response.status === 401 || response.status === 403) {
          if (isNumericKey) apiKeys.updateStatus(selectedKey.id, 'inactive', `HTTP ${response.status}: Key revoked/invalid`);
          return attemptTestChat(keyIndex + 1);
        } else if (response.status === 429) {
          if (isNumericKey) apiKeys.recordCooldown(selectedKey.id, 30, '429 Rate Limit Exceeded');
          return attemptTestChat(keyIndex + 1);
        } else if (response.status >= 500) {
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
        const noValidation = !enableContentValidation;

        function writeStreamError(message, detail) {
          try {
            if (!res.headersSent) {
              res.writeHead(200, {
                'Content-Type': 'text/event-stream; charset=utf-8',
                'Cache-Control': 'no-cache, no-transform',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no'
              });
            }
            res.write(`data: ${JSON.stringify({
              id: `chatcmpl-test-${Date.now()}-error`,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model,
              choices: [{
                index: 0,
                delta: { content: `\n\n[Gateway Error] ${message || ''}${detail ? ` (${detail})` : ''}` },
                finish_reason: 'stop'
              }]
            })}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
          } catch (e) {
            // ignore
          }
        }

        let hasToolCalls = false;

        async function readTestStream() {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              if (!noValidation) {
                if (!hasToolCalls && (!fullContent || !fullContent.trim())) {
                  addLog('error', `[模型測試｜內容校驗] 串流回應被拒收：模型回傳了空內容。`);
                  if (!res.headersSent) {
                    throw new ContentValidationError('模型回傳空內容 (Empty Content)');
                  }
                  writeStreamError('模型回傳空內容');
                  return;
                }
                if (fullContent && fullContent.trim()) {
                  const validation = smartValidate(fullContent, { maxLength: 10000 });
                  if (!validation.valid) {
                    const issue = formatValidationIssue(validation);
                    addLog('error', `[模型測試｜內容校驗] 串流回應被拒收：偵測到不合法或未閉合標籤：${issue}。`);
                    if (!res.headersSent) {
                      throw new ContentValidationError(fullContent);
                    }
                    writeStreamError('內容校驗失敗', issue);
                    return;
                  }
                }
              }
              if (!res.headersSent) {
                res.writeHead(200, {
                  'Content-Type': 'text/event-stream; charset=utf-8',
                  'Cache-Control': 'no-cache, no-transform',
                  'Connection': 'keep-alive',
                  'X-Accel-Buffering': 'no'
                });
              }
              res.write('data: [DONE]\n\n');
              res.end();
              return;
            }

            if (!res.headersSent) {
              res.writeHead(200, {
                'Content-Type': 'text/event-stream; charset=utf-8',
                'Cache-Control': 'no-cache, no-transform',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no'
              });
            }

            if (noValidation) {
              res.write(value);
              continue;
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
                    const finishReason = parsed.choices[0].finish_reason;
                    if (delta?.tool_calls || delta?.function_call || msg?.tool_calls || msg?.function_call || finishReason === 'tool_calls' || finishReason === 'function_call') {
                      hasToolCalls = true;
                    }
                    const add = (s) => { if (typeof s === 'string') fullContent += s; };
                    add(delta && delta.content);
                    add(delta && delta.reasoning_content);
                    add(delta && delta.reasoning);
                    add(delta && delta.thought);
                    add(delta && delta.thinking);
                    add(msg && msg.content);
                    add(msg && msg.reasoning_content);
                    add(msg && msg.reasoning);
                    add(msg && msg.thought);
                    add(msg && msg.thinking);
                    add(txt);
                    add(content);
                  }
                } catch (e) {
                  // ignore
                }
              }
            }
            res.write(value);
          }
        }

        try {
          await readTestStream();
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
          try { res.end(); } catch (e) { /* ignore */ }
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
      if (typeof res.off === 'function') {
        res.off('close', onClientClose);
      } else if (typeof res.removeListener === 'function') {
        res.removeListener('close', onClientClose);
      }

      if (isClientDisconnected || res.destroyed || res.writableEnded) {
        addLog('warning', `[模型測試] 客戶端已中斷連線，停止模型「${model}」測試。`);
        return;
      }

      if (isTimedOut || err.name === 'AbortError') {
        addLog('error', `[模型測試] 模型「${model}」測試逾時（已達 ${testTimeoutMs / 1000} 秒），NVIDIA 上游端點無回應。`);
        if (!res.headersSent && !res.writableEnded) {
          return res.status(504).json({
            error: {
              message: `模型「${model}」測試逾時（已達 ${testTimeoutMs / 1000} 秒），NVIDIA 上游端點無回應。`,
              type: 'timeout_error',
              code: 'model_timeout'
            }
          });
        }
        return;
      }

      addLog('warning', `[模型測試] Key ID ${selectedKey.id} 請求失敗：${err.message}`);
      return attemptTestChat(keyIndex + 1);
    }
  }

  await attemptTestChat(0);
}

module.exports = {
  handleTestChat
};