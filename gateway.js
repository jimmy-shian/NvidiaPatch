const express = require('express');
const cors = require('cors');
const { apiKeys, modelsConfig, stats, rules } = require('./database');

const activeLogs = [];
function addLog(type, message) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    type, // 'info', 'success', 'warning', 'error'
    message
  };
  activeLogs.unshift(logEntry);
  if (activeLogs.length > 100) {
    activeLogs.pop();
  }
  console.log(`[Gateway Log] [${type.toUpperCase()}] ${message}`);
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
    res.json(modelsConfig.getAll());
  });

  app.post('/api/models', (req, res) => {
    const { models } = req.body;
    if (!models || !Array.isArray(models)) {
      return res.status(400).json({ error: 'Models list is required' });
    }
    modelsConfig.savePriorityList(models);
    addLog('info', `Updated model priority order: ${models.join(' -> ')}`);
    res.json({ success: true });
  });

  app.get('/api/models/available', (req, res) => {
    res.json({
      models: modelsConfig.getAvailable(),
      lastSyncTime: modelsConfig.getLastSyncTime()
    });
  });

  app.post('/api/models/sync', async (req, res) => {
    // 找出第一個 active 的 key 來做同步
    const activeKeys = apiKeys.getActiveKeys();
    if (activeKeys.length === 0) {
      addLog('error', 'Sync models failed: No active API Key found. Add and test a key first.');
      return res.status(400).json({ error: 'No active API Key found. Please add a key and test it first.' });
    }

    const testKey = activeKeys[0].key_value;
    addLog('info', `Syncing models from NVIDIA NIM using key: ${activeKeys[0].key_value.substring(0, 10)}...`);
    const result = await modelsConfig.syncFromNvidia(testKey);
    if (result.success) {
      addLog('success', `Successfully synced ${result.count} models from NVIDIA API.`);
      res.json({ success: true, count: result.count });
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

    // 執行轉發與 Fallback 機制
    async function attemptRequest(modelIndex, keyIndexOffset = 0) {
      if (modelIndex >= configuredModels.length) {
        addLog('error', 'All configured models and fallbacks failed to respond.');
        stats.recordRequest(false);
        return res.status(502).json({
          error: { message: 'All configured models and fallbacks failed. Check Gateway logs for details.' }
        });
      }

      const currentModel = configuredModels[modelIndex];
      const modelId = currentModel.model_id;

      // 取得目前所有可用的健康的 Key
      const availableKeys = apiKeys.getActiveKeys();
      if (availableKeys.length === 0) {
        addLog('error', `Model: ${modelId} failed. Reason: No healthy API Keys available (all keys might be disabled or in cooldown).`);
        stats.recordRequest(false);
        return res.status(503).json({
          error: { message: 'No active/healthy NVIDIA API Keys available in the Gateway pool.' }
        });
      }

      // 選擇一個 Key (輪詢 + Offset)
      const keyIndex = keyIndexOffset % availableKeys.length;
      const selectedKey = availableKeys[keyIndex];

      addLog('info', `Attempting model: [Priority ${currentModel.priority}] ${modelId} with Key: ...${selectedKey.key_value.substring(selectedKey.key_value.length - 8)}`);

      // 複製 Request Body 並修改 model 欄位為 NVIDIA NIM 實際的 model_id
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
            'Authorization': `Bearer ${selectedKey.key_value}`
          },
          body: JSON.stringify(forwardBody),
          signal: abortController.signal
        });

        clearTimeout(timeoutId);

        // A. 處理 200 成功響應
        if (response.ok) {
          apiKeys.recordSuccess(selectedKey.id);
          stats.recordRequest(true);
          addLog('success', `Request succeeded using [Priority ${currentModel.priority}] ${modelId}`);

          // 設置與規範化響應標頭
          if (stream) {
            res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache, no-transform');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');
            res.flushHeaders();
          } else {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
          }

          // 串流轉發 (並動態將 response 中的 model 欄位改回為客戶端請求的模型 ID)
          if (stream) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            const processLine = (line) => {
              // 移除 Windows 常見的 \r 換行字元以進行規範化
              const cleanLine = line.endsWith('\r') ? line.slice(0, -1) : line;
              const trimmed = cleanLine.trim();

              if (trimmed.startsWith('data:')) {
                const dataStr = trimmed.slice(5).trim();
                if (dataStr === '[DONE]') {
                  res.write('data: [DONE]\n\n');
                  if (typeof res.flush === 'function') res.flush();
                  return;
                }
                try {
                  const chunk = JSON.parse(dataStr);
                  if (chunk && typeof chunk === 'object') {
                    // 強制為每個 JSON chunk 設定正確的 model ID
                    chunk.model = originalBody.model || 'patcher-main';
                  }
                  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                } catch (e) {
                  res.write(cleanLine + '\n\n');
                }
              } else {
                // 忽略純空行以防止過多換行，對有內容的非 data 行則正常寫入並加 \n
                if (trimmed !== '') {
                  res.write(cleanLine + '\n');
                }
              }
              if (typeof res.flush === 'function') res.flush();
            };

            function readChunk() {
              reader.read().then(({ done, value }) => {
                if (done) {
                  if (buffer) {
                    processLine(buffer);
                  }
                  res.end();
                  return;
                }
                
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop(); // 保留不完整的一行

                for (const line of lines) {
                  processLine(line);
                }
                readChunk();
              }).catch(err => {
                addLog('error', `Stream pipe broke mid-transit: ${err.message}`);
                res.end();
              });
            }
            readChunk();
          } else {
            // 非串流轉發 (並動態將 response 中的 model 欄位改回為客戶端請求的模型 ID)
            const json = await response.json();
            if (json && typeof json === 'object') {
              json.model = originalBody.model || 'patcher-main';
            }
            res.json(json);
          }
          return;
        }

        // B. 處理 429 速率限制響應
        if (response.status === 429) {
          addLog('warning', `Received 429 Rate Limit on Key ID ${selectedKey.id}. Entering 30s Cooldown.`);
          apiKeys.recordCooldown(selectedKey.id, 30, '429 Rate Limit Exceeded');
          
          // 重試當前模型，但換下一個 Key
          return attemptRequest(modelIndex, keyIndexOffset + 1);
        }

        // C. 處理 5xx 伺服器錯誤 或 404 找不到模型錯誤
        if (response.status >= 500 || response.status === 404) {
          const errText = await response.text();
          addLog('warning', `Received HTTP ${response.status} from NVIDIA for model ${modelId}. Error: ${errText.substring(0, 100)}`);
          if (response.status >= 500) {
            apiKeys.recordFailure(selectedKey.id, `HTTP ${response.status}: ${errText.substring(0, 50)}`);
          } else {
            addLog('warning', `Model ${modelId} returned HTTP 404. Model may be deprecated or account lacks access.`);
          }

          // 切換至「下一順位模型」，並且重設 Key 索引從 0 開始嘗試
          addLog('info', `Initiating model fallback due to NVIDIA HTTP ${response.status} error...`);
          return attemptRequest(modelIndex + 1, 0);
        }

        // D. 處理 401/403 憑證無效錯誤
        if (response.status === 401 || response.status === 403) {
          const errText = await response.text();
          addLog('error', `Invalid Key error (HTTP ${response.status}) on Key ID ${selectedKey.id}. Key is now set to Inactive.`);
          apiKeys.updateStatus(selectedKey.id, 'inactive', `HTTP ${response.status}: Key revoked/invalid`);

          // 重試當前模型，更換下一個 Key
          return attemptRequest(modelIndex, keyIndexOffset + 1);
        }

        // E. 處理其他 4xx 錯誤 (400 Bad Request 等) - 直接報錯
        const errText = await response.text();
        addLog('error', `Non-retryable client error (HTTP ${response.status}): ${errText}`);
        stats.recordRequest(false);
        return res.status(response.status).send(errText);

      } catch (err) {
        clearTimeout(timeoutId);
        
        // 捕捉 Timeout / Network Abort 錯誤
        if (err.name === 'AbortError') {
          addLog('warning', `NVIDIA request timed out (120s) for model ${modelId} with Key ID ${selectedKey.id}`);
          apiKeys.recordFailure(selectedKey.id, 'Request timeout (120s)');
          
          // 超時視同 5xx，切換至「下一順位模型」
          addLog('info', `Initiating model fallback due to timeout...`);
          return attemptRequest(modelIndex + 1, 0);
        }

        // 其他網路連線異常
        addLog('warning', `Network/Connection error for model ${modelId} with Key ID ${selectedKey.id}: ${err.message}`);
        apiKeys.recordFailure(selectedKey.id, `Network Error: ${err.message}`);
        
        // 網路異常通常也是 5xx 級別，切換下一順位模型
        return attemptRequest(modelIndex + 1, 0);
      }
    }

    // 每次請求都從 index 0 (第一順位模型) 開始
    await attemptRequest(0, 0);
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

        // 轉發標頭
        res.setHeader('Content-Type', response.headers.get('Content-Type'));
        if (stream) {
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');

          const reader = response.body.getReader();
          function readChunk() {
            reader.read().then(({ done, value }) => {
              if (done) {
                res.end();
                return;
              }
              res.write(value);
              readChunk();
            }).catch(err => {
              addLog('error', `[Test Chat] Stream read error: ${err.message}`);
              res.end();
            });
          }
          readChunk();
        } else {
          const json = await response.json();
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

module.exports = {
  createGatewayApp
};
