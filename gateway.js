const express = require('express');
const cors = require('cors');
const { apiKeys, modelsConfig, stats, rules } = require('./database');

function getTaiwanDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });

  return formatter.formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});
}

function getTaiwanISOString(date = new Date()) {
  const parts = getTaiwanDateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+08:00`;
}

const activeLogs = [];
function addLog(type, message) {
  const logEntry = {
    timestamp: getTaiwanISOString(),
    type, // 'info', 'success', 'warning', 'error'
    message
  };
  activeLogs.unshift(logEntry);
  if (activeLogs.length > 100) {
    activeLogs.pop();
  }
  console.log(`[Gateway Log] [${type.toUpperCase()}] ${message}`);
}

/**
 * 檢查內容中是否有未閉合或格式不完整的 HTML/XML tag
 * @param {string} content - 要檢查的字串
 * @returns {{ valid: boolean, unclosedTags: string[], malformedTags: string[], mismatchedTags: string[] }} 檢查結果
 */
function validateContent(content) {
  if (!content || typeof content !== 'string') {
    return { valid: true, unclosedTags: [], malformedTags: [], mismatchedTags: [] };
  }

  const malformedTags = [];

  // 先檢查「看起來像 tag 開頭，但沒有 > 結尾」的情況。
  // 例如：<tool_call、</thinking、<>。這類輸出會讓 Cline 的 XML/HTML-like parser 直接炸開。
  for (let i = 0; i < content.length; i++) {
    if (content[i] !== '<') continue;

    const nextChar = content[i + 1] || '';

    // a < b 這種比較符號不要誤判；只處理像標籤的開頭。
    if (nextChar === '>') {
      malformedTags.push('<>');
      continue;
    }
    if (!/[A-Za-z/!?]/.test(nextChar)) {
      continue;
    }

    const closeIndex = content.indexOf('>', i + 1);
    const nextOpenIndex = content.indexOf('<', i + 1);
    if (closeIndex === -1 || (nextOpenIndex !== -1 && nextOpenIndex < closeIndex)) {
      const endIndex = nextOpenIndex !== -1 && nextOpenIndex < closeIndex ? nextOpenIndex : Math.min(content.length, i + 80);
      const fragment = content.slice(i, endIndex).replace(/\s+/g, ' ').trim();
      malformedTags.push(fragment || '<');
      if (nextOpenIndex === -1) break;
      i = Math.max(i, nextOpenIndex - 1);
    }
  }

  if (malformedTags.length > 0) {
    return {
      valid: false,
      unclosedTags: [],
      malformedTags: [...new Set(malformedTags)].slice(0, 8),
      mismatchedTags: []
    };
  }

  const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9:_-]*)\b[^>]*(\/?)>/g;
  const selfClosingTags = new Set([
    'br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col',
    'embed', 'source', 'track', 'wbr', 'frame', 'param', 'spacer',
    'circle', 'ellipse', 'line', 'path', 'polygon', 'polyline', 'rect', 'stop', 'use'
  ]);
  
  const stack = [];
  const mismatchedTags = [];
  let match;

  while ((match = tagRegex.exec(content)) !== null) {
    const fullTag = match[0];
    const tagName = match[1].toLowerCase();
    const isSelfClosing = match[2] === '/' || fullTag.endsWith('/>');
    const isClosingTag = fullTag.startsWith('</');

    // 自閉合 tag 跳過
    if (isSelfClosing || selfClosingTags.has(tagName) || fullTag.startsWith('<!') || fullTag.startsWith('<?')) {
      continue;
    }

    if (isClosingTag) {
      // 閉合 tag：檢查 stack 頂端是否匹配
      if (stack.length > 0 && stack[stack.length - 1] === tagName) {
        stack.pop();
      } else {
        mismatchedTags.push(`</${tagName}>`);
      }
    } else {
      // 開頭 tag：push 進 stack
      stack.push(tagName);
    }
  }

  if (stack.length > 0 || mismatchedTags.length > 0) {
    return {
      valid: false,
      unclosedTags: [...new Set(stack)],
      malformedTags: [],
      mismatchedTags: [...new Set(mismatchedTags)].slice(0, 8)
    };
  }

  return { valid: true, unclosedTags: [], malformedTags: [], mismatchedTags: [] };
}

function formatValidationIssue(validation) {
  const issues = [];
  if (validation.unclosedTags && validation.unclosedTags.length > 0) {
    issues.push(validation.unclosedTags.map(t => `<${t}>`).join(', '));
  }
  if (validation.malformedTags && validation.malformedTags.length > 0) {
    issues.push(validation.malformedTags.join(', '));
  }
  if (validation.mismatchedTags && validation.mismatchedTags.length > 0) {
    issues.push(validation.mismatchedTags.join(', '));
  }
  return issues.join(', ') || 'unknown tag issue';
}

function createGatewayApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1gb' }));

  // 0. 基礎狀態檢查與歡迎頁面 (防止連線測試出現 Cannot GET /v1 錯誤)
  app.get('/', (req, res) => {
    res.json({ status: "running", service: "NVIDIA NIM LLM Gateway", version: "1.0.1" });
  });

  app.get('/v1', (req, res) => {
    res.json({ status: "running", service: "NVIDIA NIM LLM Gateway", version: "1.0.1" });
  });

  // 1. 取得日誌
  app.get('/api/logs', (req, res) => {
    res.json(activeLogs);
  });

  // 2. API Keys 管理
  app.get('/api/keys', (req, res) => {
    res.json(apiKeys.getAll());
  });

  app.post('/api/keys', (req, res) => {
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: 'Key is required' });
    const result = apiKeys.add(key.trim());
    if (result.success) {
      addLog('info', `Added new API Key: ${key.substring(0, 10)}...`);
      res.json({ success: true });
    } else {
      res.status(400).json({ error: result.error });
    }
  });

  app.delete('/api/keys/:id', (req, res) => {
    apiKeys.delete(req.params.id);
    addLog('info', `Deleted API Key ID: ${req.params.id}`);
    res.json({ success: true });
  });

  app.post('/api/keys/test', async (req, res) => {
    addLog('info', 'Starting manual connectivity test for all API keys...');
    const results = await apiKeys.testAllKeys();
    const successCount = results.filter(r => r.success).length;
    addLog('info', `Key test complete. ${successCount}/${results.length} keys are active.`);
    res.json(results);
  });

  // 3. 模型管理
  app.get('/api/models', (req, res) => {
    const groupId = req.query.groupId ? Number(req.query.groupId) : null;
    res.json(modelsConfig.getAll(groupId));
  });

  app.post('/api/models', (req, res) => {
    const { models, groupId } = req.body;
    if (!models || !Array.isArray(models)) {
      return res.status(400).json({ error: 'Models list is required' });
    }
    const result = modelsConfig.savePriorityList(models, groupId);
    addLog('info', `Updated model priority order for Group ${result.groupId}: ${models.join(' -> ')}`);
    res.json({ success: true, groupId: result.groupId });
  });

  app.get('/api/models/groups', (req, res) => {
    res.json(modelsConfig.getGroups());
  });

  app.post('/api/models/groups/active', (req, res) => {
    const { groupId } = req.body;
    const result = modelsConfig.setActiveGroup(groupId);
    addLog('info', `Switched active model priority group to Group ${result.activeGroup}.`);
    res.json(result);
  });

  app.get('/api/models/available', (req, res) => {
    res.json({
      models: modelsConfig.getAvailable(),
      lastSyncTime: modelsConfig.getLastSyncTime(),
      lastSyncSource: modelsConfig.getLastSyncSource(),
      expectedCount: modelsConfig.getLastSyncExpectedCount()
    });
  });

  app.post('/api/models/sync', async (req, res) => {
    // 主要同步來源改為 NVIDIA Build 網頁 Free Endpoint catalog，不再依賴 /v1/models。
    // 若 Build catalog 暫時不可用，仍會用第一把 active key 做最後保底 fallback。
    const activeKeys = apiKeys.getActiveKeys();
    const fallbackKey = activeKeys.length > 0 ? activeKeys[0].key_value : null;

    addLog('info', 'Syncing Free Endpoint models from NVIDIA Build catalog...');
    const result = await modelsConfig.syncFromNvidia(fallbackKey);
    if (result.success) {
      const expectedText = result.expectedCount ? ` / NVIDIA Build expected ${result.expectedCount}` : '';
      addLog('success', `Successfully synced ${result.count}${expectedText} Free Endpoint models. Source: ${result.source || 'NVIDIA Build catalog'}`);
      res.json({ success: true, count: result.count, expectedCount: result.expectedCount || null, source: result.source || null });
    } else {
      addLog('error', `Sync models failed: ${result.error}`);
      res.status(500).json({ error: result.error });
    }
  });

  // 4. Rules 管理
  app.get('/api/rules', (req, res) => {
    res.json(rules.getAll());
  });

  app.post('/api/rules', (req, res) => {
    const { title, content } = req.body;
    if (!title || !content) return res.status(400).json({ error: 'Title and Content are required' });
    const result = rules.add(title, content);
    if (result.success) {
      addLog('info', `Added custom rule: "${title}"`);
      res.json({ success: true });
    } else {
      res.status(400).json({ error: result.error });
    }
  });

  app.put('/api/rules/:id', (req, res) => {
    const { title, content } = req.body;
    const result = rules.update(req.params.id, title, content);
    if (result.success) {
      addLog('info', `Updated custom rule ID: ${req.params.id}`);
      res.json({ success: true });
    } else {
      res.status(400).json({ error: result.error });
    }
  });

  app.delete('/api/rules/:id', (req, res) => {
    const result = rules.delete(req.params.id);
    if (result.success) {
      addLog('info', `Deleted custom rule ID: ${req.params.id}`);
      res.json({ success: true });
    } else {
      res.status(400).json({ error: result.error });
    }
  });

  // 5. 統計資訊
  app.get('/api/stats', (req, res) => {
    res.json({
      hourly: stats.getHourlyStats(),
      keysCount: apiKeys.getAll().length,
      activeKeysCount: apiKeys.getActiveKeys().length,
      modelsCount: modelsConfig.getAll().length
    });
  });

  // 5.5 OpenAI 相容的 Models 列表端點 (供 Cline / OpenCode 驗證連線與取得可用模型)
  app.get('/v1/models', (req, res) => {
    const configuredModels = modelsConfig.getAll().filter(m => m.is_active === 1);
    const modelsData = [
      {
        id: 'patcher-main',
        object: 'model',
        created: 1718925400,
        owned_by: 'myself'
      }
    ];
    
    configuredModels.forEach(m => {
      if (m.model_id !== 'patcher-main') {
        modelsData.push({
          id: m.model_id,
          object: 'model',
          created: 1718925400,
          owned_by: 'nvidia'
        });
      }
    });

    res.json({
      object: 'list',
      data: modelsData
    });
  });

  app.get('/models', (req, res) => {
    const configuredModels = modelsConfig.getAll().filter(m => m.is_active === 1);
    const modelsData = [
      {
        id: 'patcher-main',
        object: 'model',
        created: 1718925400,
        owned_by: 'myself'
      }
    ];
    
    configuredModels.forEach(m => {
      if (m.model_id !== 'patcher-main') {
        modelsData.push({
          id: m.model_id,
          object: 'model',
          created: 1718925400,
          owned_by: 'nvidia'
        });
      }
    });

    res.json({
      object: 'list',
      data: modelsData
    });
  });

  // 6. OpenAI 相容的 Chat Completions Gateway 中介核心
  app.post('/v1/chat/completions', async (req, res) => {
    const originalBody = req.body;
    const stream = !!originalBody.stream;

    // 支援 Mock 測試環境變數
    const nvidiaBaseUrl = process.env.NVIDIA_API_URL || 'https://integrate.api.nvidia.com/v1';

    // 撈出排序好的模型
    const configuredModels = modelsConfig.getAll().filter(m => m.is_active === 1);
    if (configuredModels.length === 0) {
      addLog('error', 'Gateway request rejected: No active models configured in priority list.');
      return res.status(500).json({ error: { message: 'No active models configured in the Gateway' } });
    }

    addLog('info', `New request received (stream=${stream}). Initializing dispatch...`);

    // ========== 新邏輯：模型順位替換 + Key 輪詢 + 完整重試機制 ==========
    //
    // 概念說明：
    // - 每個模型都有自己的一輪測試（所有可用 key 輪過一次 = 一輪）
    // - 如果某一輪中所有 key 都失敗，等待 15 秒後進行下一輪
    // - 一個模型最多嘗試 MAX_ROUNDS_PER_MODEL 輪（2 輪）
    // - 所有輪都失敗後，才切換到下一個順位的模型
    // - 所有模型都失敗，才爆錯

    const MAX_ROUNDS_PER_MODEL = 2;  // 每個模型最多嘗試 2 輪
    const ROUND_DELAY_MS = 15000;     // 每輪之間的等待時間（15 秒）

    /**
     * 對指定的模型和 key 發送請求
     * @param {object} model - 模型配置對象
     * @param {object} key - API Key 對象
     * @param {number} keyIndex - 當前 key 在 availableKeys 中的索引
     * @returns {Promise<object>} { success, shouldFallbackModel, statusCode, errorText }
     */
    async function sendSingleRequest(model, key, keyIndex, availableKeys) {
      const modelId = model.model_id;
      const forwardBody = { ...originalBody, model: modelId };

      let abortController = new AbortController();
      const timeoutId = setTimeout(() => {
        abortController.abort();
      }, 120000); // 120 秒超時

      try {
        const response = await fetch(`${nvidiaBaseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key.key_value}`
          },
          body: JSON.stringify(forwardBody),
          signal: abortController.signal
        });

        clearTimeout(timeoutId);

        // A. 處理 200 成功響應
        if (response.ok) {
          apiKeys.recordSuccess(key.id);
          stats.recordRequest(true);
          addLog('success', `Request succeeded using [Priority ${model.priority}] ${modelId}`);
          return { success: true, response, shouldFallbackModel: false };
        }

        // B. 處理 503 Service Unavailable - 模型暫時不可用
        if (response.status === 503) {
          const errText = await response.text();
          addLog('warning', `Received HTTP 503 from NVIDIA for model ${modelId} with Key ID ${key.id}. Model temporarily unavailable. Error: ${errText.substring(0, 100)}`);
          apiKeys.recordFailure(key.id, `HTTP 503: ${errText.substring(0, 50)}`);
          // 503 代表模型有問題，需要切換模型，但先繼續試下一把 key
          return { success: false, shouldFallbackModel: true, statusCode: 503, errorText: errText };
        }

        // C. 處理 429 速率限制響應
        if (response.status === 429) {
          addLog('warning', `Received 429 Rate Limit on Key ID ${key.id}. Entering 30s Cooldown.`);
          apiKeys.recordCooldown(key.id, 30, '429 Rate Limit Exceeded');
          // 換下一把 key，繼續當前模型
          return { success: false, shouldFallbackModel: false, statusCode: 429, errorText: '' };
        }

        // D. 處理 5xx 伺服器錯誤（不含 503，503 已在前面處理）
        if (response.status >= 500) {
          const errText = await response.text();
          addLog('warning', `Received HTTP ${response.status} from NVIDIA for model ${modelId} with Key ID ${key.id}. Error: ${errText.substring(0, 100)}`);
          apiKeys.recordFailure(key.id, `HTTP ${response.status}: ${errText.substring(0, 50)}`);
          // 5xx 也視為模型問題，需要模型順位替換
          return { success: false, shouldFallbackModel: true, statusCode: response.status, errorText: errText };
        }

        // E. 處理 404 找不到模型
        if (response.status === 404) {
          const errText = await response.text();
          addLog('warning', `Received HTTP 404 from NVIDIA for model ${modelId}. Model may be deprecated or account lacks access. Error: ${errText.substring(0, 100)}`);
          // 404 表示模型不存在，應該直接切換到下一個模型
          return { success: false, shouldFallbackModel: true, statusCode: 404, errorText: errText };
        }

        // F. 處理 401/403 憑證無效錯誤
        if (response.status === 401 || response.status === 403) {
          const errText = await response.text();
          addLog('error', `Invalid Key error (HTTP ${response.status}) on Key ID ${key.id}. Key is now set to Inactive.`);
          apiKeys.updateStatus(key.id, 'inactive', `HTTP ${response.status}: Key revoked/invalid`);
          // 換下一把 key
          return { success: false, shouldFallbackModel: false, statusCode: response.status, errorText: errText };
        }

        // G. 處理其他 4xx 錯誤 (400 Bad Request 等) - 直接報錯
        const errText = await response.text();
        addLog('error', `Non-retryable client error (HTTP ${response.status}): ${errText}`);
        stats.recordRequest(false);
        return { success: false, fatal: true, statusCode: response.status, errorText: errText, response };

      } catch (err) {
        clearTimeout(timeoutId);
        
        // 捕捉 Timeout / Network Abort 錯誤
        if (err.name === 'AbortError') {
          addLog('warning', `NVIDIA request timed out (120s) for model ${modelId} with Key ID ${key.id}`);
          apiKeys.recordFailure(key.id, 'Request timeout (120s)');
          // 超時視同模型問題
          return { success: false, shouldFallbackModel: true, statusCode: 0, errorText: 'Request timeout (120s)' };
        }

        // 其他網路連線異常
        addLog('warning', `Network/Connection error for model ${modelId} with Key ID ${key.id}: ${err.message}`);
        apiKeys.recordFailure(key.id, `Network Error: ${err.message}`);
        // 網路異常也視為需要模型順位替換
        return { success: false, shouldFallbackModel: true, statusCode: 0, errorText: err.message };
      }
    }

    /**
     * 嘗試使用所有 key 對當前模型進行一輪測試
     * @param {object} model - 當前模型
     * @param {number} roundNumber - 第幾輪 (1-based)
     * @returns {Promise<object>} { success, response, forceFallbackModel }
     */
    async function tryModelWithAllKeys(model, roundNumber) {
      const modelId = model.model_id;

      // 取得目前所有可用的健康的 Key
      const availableKeys = apiKeys.getActiveKeys();
      if (availableKeys.length === 0) {
        addLog('error', `[Round ${roundNumber}] Model: ${modelId} failed. No healthy API Keys available.`);
        return { success: false, forceFallbackModel: true };
      }

      addLog('info', `[Round ${roundNumber}/${MAX_ROUNDS_PER_MODEL}] Trying model: [Priority ${model.priority}] ${modelId} with ${availableKeys.length} key(s)...`);

      // 逐一嘗試所有 key
      for (let keyIndex = 0; keyIndex < availableKeys.length; keyIndex++) {
        const selectedKey = availableKeys[keyIndex];
        addLog('info', `[Round ${roundNumber}] Attempting model: ${modelId} with Key: ...${selectedKey.key_value.substring(selectedKey.key_value.length - 8)} (Key ${keyIndex + 1}/${availableKeys.length})`);

        const result = await sendSingleRequest(model, selectedKey, keyIndex, availableKeys);

        // 成功
        if (result.success) {
          // === 在回傳前檢查內容是否有未閉合的 HTML tag ===
          // 對非串流模式：直接檢查 JSON 中的 content
          // 對串流模式：需要先讀取完整串流內容再做檢查
          const isStream = !!originalBody.stream;
          
          if (isStream) {
            // 串流模式：緩衝所有內容，等完整收到後再校驗
            try {
              const reader = result.response.body.getReader();
              const decoder = new TextDecoder();
              let streamBuffer = '';
              let fullContent = '';
              const sseLines = [];
              let streamDone = false;

              function readStreamFully() {
                return reader.read().then(({ done, value }) => {
                  if (done) {
                    streamDone = true;
                    // 處理最後殘留的 buffer
                    if (streamBuffer) {
                      const lines = streamBuffer.split('\n');
                      for (const line of lines) {
                        const trimmed = line.trim();
                        if (trimmed.startsWith('data:')) {
                          const dataStr = trimmed.slice(5).trim();
                          if (dataStr !== '[DONE]') {
                            try {
                              const chunk = JSON.parse(dataStr);
                              if (chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content) {
                                fullContent += chunk.choices[0].delta.content;
                              }
                            } catch (e) {
                              // 忽略解析錯誤
                            }
                          }
                        }
                      }
                    }

                    // 對完整內容做校驗
                    const validation = validateContent(fullContent);
                    if (!validation.valid) {
                      const validationIssue = formatValidationIssue(validation);
                      addLog('error', `[Round ${roundNumber}] Content validation failed for stream response from model ${modelId}: invalid or unclosed tag detected: ${validationIssue}. Content length: ${fullContent.length}. Rejecting response and regenerating with the next available attempt.`);
                      apiKeys.recordFailure(selectedKey.id, `ContentValidation: ${validationIssue}`);
                      // 回傳失敗，讓外層繼續嘗試下一把 key 或下一輪
                      return { success: false, shouldFallbackModel: false, statusCode: 0, errorText: `Content validation failed: ${validationIssue}` };
                    }

                    // 校驗通過，回傳 success + 所有 SSE 行
                    return { success: true, response: result.response, sseLines };
                  }

                  streamBuffer += decoder.decode(value, { stream: true });
                  const lines = streamBuffer.split('\n');
                  streamBuffer = lines.pop();

                  for (const line of lines) {
                    const trimmed = line.trim();
                    sseLines.push(line.endsWith('\r') ? line.slice(0, -1) : line);
                    if (trimmed.startsWith('data:')) {
                      const dataStr = trimmed.slice(5).trim();
                      if (dataStr !== '[DONE]') {
                        try {
                          const chunk = JSON.parse(dataStr);
                          if (chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content) {
                            fullContent += chunk.choices[0].delta.content;
                          }
                        } catch (e) {
                          // 忽略解析錯誤
                        }
                      }
                    }
                  }

                  return readStreamFully();
                });
              }

              const streamResult = await readStreamFully();
              
              // 如果串流校驗失敗（包含未閉合 tag），streamResult 會是 { success: false, ... }
              // 這裡繼續迭代下一把 key
              if (!streamResult.success) {
                continue;
              }
              
              // 串流校驗通過，回傳 success 並附上 SSE lines 和原始 response
              return { success: true, response: result.response, sseLines: streamResult.sseLines, streamContent: fullContent };
            } catch (err) {
              addLog('error', `[Round ${roundNumber}] Stream read/validation error for model ${modelId}: ${err.message}`);
              apiKeys.recordFailure(selectedKey.id, `Stream validation error: ${err.message}`);
              // 繼續嘗試下一把 key
              continue;
            }
          } else {
            // 非串流模式：直接解析 JSON 並檢查 content
            try {
              const json = await result.response.json();
              let contentToCheck = '';
              if (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) {
                contentToCheck = json.choices[0].message.content;
              }

              const validation = validateContent(contentToCheck);
              if (!validation.valid) {
                const validationIssue = formatValidationIssue(validation);
                addLog('error', `[Round ${roundNumber}] Content validation failed for model ${modelId}: invalid or unclosed tag detected: ${validationIssue}. Content length: ${contentToCheck.length}. Rejecting response and regenerating with the next available attempt.`);
                apiKeys.recordFailure(selectedKey.id, `ContentValidation: ${validationIssue}`);
                // 繼續嘗試下一把 key
                continue;
              }

              // 校驗通過，回傳 success + json
              return { success: true, response: result.response, jsonData: json };
            } catch (err) {
              if (err.message && err.message.includes('Content validation')) {
                // 這已經是 validation error，繼續嘗試下一把 key
                continue;
              }
              // 其他 JSON 解析錯誤
              addLog('error', `[Round ${roundNumber}] JSON parse error for model ${modelId}: ${err.message}`);
              apiKeys.recordFailure(selectedKey.id, `JSON parse error: ${err.message}`);
              continue;
            }
          }
        }

        // 致命錯誤（非可重試的 4xx），直接回傳
        if (result.fatal) {
          return { success: false, fatal: true, statusCode: result.statusCode, errorText: result.errorText, response: result.response };
        }

        // shouldFallbackModel 為 true 表示這個 key 的錯誤顯示模型有問題
        // 但我們還是要繼續試完剩下的 key，因為可能有 key-specific 的問題
        // 如果所有 key 都返回 shouldFallbackModel，則表示模型確實有問題
        
        // 記錄最後一次錯誤資訊以便判斷
        if (keyIndex === availableKeys.length - 1) {
          // 這是最後一把 key 了
        }
      }

      // 所有 key 都嘗試完畢，檢查是否需要切換模型
      // 如果所有 key 都失敗，返回 forceFallbackModel = true 觸發模型切換
      addLog('warning', `[Round ${roundNumber}] All ${availableKeys.length} key(s) failed for model ${modelId}.`);
      return { success: false, forceFallbackModel: true };
    }

    /**
     * 主要調度邏輯：模型順位替換 + 多輪重試
     */
    async function dispatchRequest() {
      // 遍歷所有模型（按優先順序）
      for (let modelIndex = 0; modelIndex < configuredModels.length; modelIndex++) {
        const currentModel = configuredModels[modelIndex];
        const modelId = currentModel.model_id;

        addLog('info', `=== Starting dispatch for model: [Priority ${currentModel.priority}] ${modelId} ===`);

        // 對此模型進行多輪測試
        let anyKeyWasAvailable = false;
        
        for (let round = 1; round <= MAX_ROUNDS_PER_MODEL; round++) {
          // 在開始新一輪前先檢查是否有可用的 key
          const availableKeys = apiKeys.getActiveKeys();
          if (availableKeys.length === 0) {
            addLog('error', `Model ${modelId}: No healthy API Keys available in pool. Breaking out of rounds.`);
            break; // 跳出 round 迴圈，嘗試下一個模型
          }

          // 如果不是第一輪，等待 15 秒
          if (round > 1) {
            addLog('info', `Model ${modelId}: Round ${round - 1} completed with all keys failed. Waiting ${ROUND_DELAY_MS / 1000}s before round ${round}...`);
            await new Promise(resolve => setTimeout(resolve, ROUND_DELAY_MS));
          }

          const result = await tryModelWithAllKeys(currentModel, round);

          // 成功！（content validation 已在 tryModelWithAllKeys 中完成）
          if (result.success) {
            const stream = !!originalBody.stream;
            
            if (stream) {
              // 串流模式：直接 flush 已校驗通過的 SSE lines
              res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
              res.setHeader('Cache-Control', 'no-cache, no-transform');
              res.setHeader('Connection', 'keep-alive');
              res.setHeader('X-Accel-Buffering', 'no');
              res.flushHeaders();

              for (const line of result.sseLines) {
                // 對每個 data line 添加 model 覆蓋
                if (line.startsWith('data:') && !line.includes('[DONE]')) {
                  try {
                    const dataStr = line.slice(5).trim();
                    const chunk = JSON.parse(dataStr);
                    if (chunk && typeof chunk === 'object') {
                      chunk.model = originalBody.model || 'patcher-main';
                      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                      if (typeof res.flush === 'function') res.flush();
                      continue;
                    }
                  } catch (e) {
                    // 解析失敗，直接寫入原始行
                  }
                }
                res.write(line + '\n');
                if (typeof res.flush === 'function') res.flush();
              }
              res.write('data: [DONE]\n\n');
              if (typeof res.flush === 'function') res.flush();
              res.end();
            } else {
              // 非串流模式：直接回傳已校驗通過的 JSON
              const json = result.jsonData;
              if (json && typeof json === 'object') {
                json.model = originalBody.model || 'patcher-main';
              }
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.json(json);
            }
            return; // 成功，結束
          }

          // 致命錯誤
          if (result.fatal) {
            stats.recordRequest(false);
            return res.status(result.statusCode).send(result.errorText);
          }

          // forceFallbackModel 表示所有 key 都失敗，需要切換模型或等待下一輪
          if (result.forceFallbackModel) {
            addLog('info', `Model ${modelId}: All keys exhausted in round ${round}.`);
            
            // 如果不是最後一輪，會繼續下一輪（先等待 15 秒）
            if (round < MAX_ROUNDS_PER_MODEL) {
              addLog('info', `Model ${modelId}: Will retry in next round (${round + 1}/${MAX_ROUNDS_PER_MODEL}) after delay.`);
            }
          }
        }

        // 此模型的所有輪數都消耗完畢且失敗，切換到下一個模型
        addLog('warning', `Model ${modelId}: Exhausted all ${MAX_ROUNDS_PER_MODEL} rounds without success. Falling back to next model.`);
      }

      // 所有模型都失敗
      addLog('error', 'All configured models exhausted all retry rounds. No model could fulfill the request.');
      stats.recordRequest(false);
      return res.status(503).json({
        error: { message: 'All configured models exhausted all retry rounds. Check Gateway logs for details. Every model was tried for the configured retry rounds with 15s delays between rounds, but none succeeded.' }
      });
    }

    // 開始調度（內容校驗已在 tryModelWithAllKeys 中處理，無需外層 try/catch）
    await dispatchRequest();
  });

  // 7. 測試專用聊天端點 (繞過模型重寫與 Fallback，直接使用健康的金鑰對特定 NIM 模型發送對話)
  app.post('/api/test/chat', async (req, res) => {
    const { model, messages, stream } = req.body;
    
    if (!model || !messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Model and messages array are required' });
    }

    const activeKeys = apiKeys.getActiveKeys();
    if (activeKeys.length === 0) {
      return res.status(503).json({ error: 'No active/healthy API Keys available in the Gateway pool.' });
    }

    const nvidiaBaseUrl = process.env.NVIDIA_API_URL || 'https://integrate.api.nvidia.com/v1';

    async function attemptTestChat(keyIndex) {
      if (keyIndex >= activeKeys.length) {
        addLog('error', `[Test Chat] All available keys (${activeKeys.length}) failed to test model ${model}.`);
        return res.status(502).json({ error: `All active keys failed for model ${model}.` });
      }

      const selectedKey = activeKeys[keyIndex];
      addLog('info', `[Test Chat] Testing model: ${model} with Key: ...${selectedKey.key_value.substring(selectedKey.key_value.length - 8)} (Attempt ${keyIndex + 1}/${activeKeys.length})`);

      let abortController = new AbortController();
      const timeoutId = setTimeout(() => {
        abortController.abort();
      }, 60000); // 測試 API 設定為 60 秒超時

      try {
        const response = await fetch(`${nvidiaBaseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${selectedKey.key_value}`
          },
          body: JSON.stringify({ model, messages, stream: !!stream }),
          signal: abortController.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errText = await response.text();
          addLog('warning', `[Test Chat] NIM replied with HTTP ${response.status} using Key ID ${selectedKey.id}: ${errText}`);

          // 如果是 404, 401, 403, 429, 5xx 錯誤，更換下一個 Key 嘗試
          if (response.status === 404 || response.status === 401 || response.status === 403 || response.status === 429 || response.status >= 500) {
            if (response.status === 401 || response.status === 403) {
              apiKeys.updateStatus(selectedKey.id, 'inactive', `HTTP ${response.status}: Key revoked/invalid`);
            } else if (response.status === 429) {
              apiKeys.recordCooldown(selectedKey.id, 30, '429 Rate Limit Exceeded');
            }
            return attemptTestChat(keyIndex + 1);
          }

          return res.status(response.status).send(errText);
        }

        // === 串流模式：先 buffer 完整內容，校驗通過後再 flush ===
        if (stream) {
          const reader = response.body.getReader();
          let fullContent = '';
          const contentBuffer = [];
          let validationFailed = false;

          function readTestChunk() {
            return reader.read().then(({ done, value }) => {
              if (done) {
                // 檢查完整內容是否有未閉合 tag
                const validation = validateContent(fullContent);
                if (!validation.valid) {
                  validationFailed = true;
                  addLog('error', `[Test Chat - Content Validation] Stream response rejected: invalid or unclosed tag detected: ${formatValidationIssue(validation)}.`);
                  // 不發送任何內容，直接拋錯
                  throw new ContentValidationError(fullContent);
                }
                // 校驗通過，才將串流標頭與內容 flush 給前端
                res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');
                for (const chunk of contentBuffer) {
                  res.write(chunk);
                }
                res.end();
                return;
              }
              // 累積原始 bytes
              const text = new TextDecoder().decode(value);
              // 累積 content 用於校驗
              const lines = text.split('\n');
              for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith('data:') && !trimmed.includes('[DONE]')) {
                  try {
                    const dataStr = trimmed.slice(5).trim();
                    const parsed = JSON.parse(dataStr);
                    if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta && parsed.choices[0].delta.content) {
                      fullContent += parsed.choices[0].delta.content;
                    }
                  } catch (e) {
                    // 忽略解析錯誤
                  }
                }
              }
              contentBuffer.push(value);
              return readTestChunk();
            });
          }

          try {
            await readTestChunk();
            if (validationFailed) {
              // 串流已 flush 完成或失敗，但我們不回傳錯誤資料
            }
          } catch (err) {
            if (err.name === 'ContentValidationError') {
              addLog('error', `[Test Chat] Content validation failed before flushing to frontend. Regenerating with next key...`);
              return attemptTestChat(keyIndex + 1);
            }
            addLog('error', `[Test Chat] Stream read error: ${err.message}`);
            if (!res.headersSent) {
              return res.status(502).json({ error: `Stream read error: ${err.message}` });
            }
            res.end();
          }
        } else {
          // === 非串流模式：檢查內容是否有未閉合的 HTML tag ===
          const json = await response.json();
          let contentToCheck = '';
          if (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) {
            contentToCheck = json.choices[0].message.content;
          }
          
          const validation = validateContent(contentToCheck);
          if (!validation.valid) {
            const validationIssue = formatValidationIssue(validation);
            addLog('error', `[Test Chat - Content Validation] Non-stream response rejected: invalid or unclosed tag detected: ${validationIssue}. Regenerating with next key...`);
            return attemptTestChat(keyIndex + 1);
          }

          res.json(json);
        }
      } catch (err) {
        clearTimeout(timeoutId);
        addLog('warning', `[Test Chat] Request failed with Key ID ${selectedKey.id}: ${err.message}`);
        return attemptTestChat(keyIndex + 1);
      }
    }

    await attemptTestChat(0);
  });

  return app;
}

/**
 * 自訂錯誤類型：內容校驗失敗
 * 用於在 dispatch 機制中觸發重試
 */
class ContentValidationError extends Error {
  constructor(content) {
    super('Content validation failed: unclosed HTML tags detected');
    this.name = 'ContentValidationError';
    this.content = content;
  }
}

module.exports = {
  createGatewayApp
};