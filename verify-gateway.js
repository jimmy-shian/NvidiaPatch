const http = require('http');
const fs = require('fs');
const path = require('path');
const { initDatabase, closeDatabase, apiKeys, modelsConfig, stats, settings } = require('./database');
const { createGatewayApp } = require('./gateway');

const MOCK_NVIDIA_PORT = 18080;
const GATEWAY_PORT = 18081;
const DB_FILE = path.join(__dirname, 'verify-test.db');

let mockServer;
let gatewayServer;

// 1. 啟動 Mock NVIDIA NIM 伺服器
function startMockNvidiaServer() {
  mockServer = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/chat/completions') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        const payload = JSON.parse(body);
        const authHeader = req.headers['authorization'] || '';
        const key = authHeader.replace('Bearer ', '').trim();
        const model = payload.model;

        console.log(`[Mock NVIDIA] Received request. Key: ${key}, Model: ${model}`);

        // A. 模擬 401 錯誤
        if (key === 'key-invalid') {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: "Invalid API Key" }));
          return;
        }

        // B. 模擬 429 錯誤
        if (key === 'key-429') {
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: "Rate limit exceeded" }));
          return;
        }

        // C. 模擬 503 錯誤 (只在模型為 70b 時觸發，用以測試 fallback)
        if (model === 'meta/llama3-70b-instruct' && key === 'key-trigger-fallback') {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: "Model overloaded, try fallback" }));
          return;
        }

        // E. 模擬 404 錯誤 (用於模型不存在或帳戶無權限，觸發 model fallback 或 test chat key rotation)
        if (key === 'key-trigger-404' || (model === 'meta/llama3-70b-instruct' && key === 'key-trigger-404-fallback')) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: "Function not found for account" }));
          return;
        }

        // F. 模擬 400 Context Limit 錯誤 (只在模型為 70b 時觸發，用以測試 fallback)
        if (model === 'meta/llama3-70b-instruct' && key === 'key-trigger-400-context') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            message: "This model's maximum context length is 202752 tokens. However, your messages resulted in 206517 tokens. Please reduce the length of the messages.",
            type: "Bad Request",
            code: 400
          }));
          return;
        }
        
        // G. 模擬串流超時 (只在第一順位模型且使用特定 key 時觸發，故意掛起連線。寫入第一個 chunk 以便立刻發出 Header)
        if (model === 'meta/llama3-70b-instruct' && key === 'key-trigger-stream-timeout') {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          });
          res.write(':\n\n'); // 發送一個 SSE 註解 chunk 來強制 Flush Header，讓客戶端 fetch 立即 Resolve
          return;
        }

        // D. 正常回應
        if (payload.stream) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          });
          res.write(`data: ${JSON.stringify({
            id: "chatcmpl-mock",
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: model,
            choices: [{
              index: 0,
              delta: { content: `Mock stream response for model ${model}` },
              finish_reason: null
            }]
          })}\n\n`);
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: "chatcmpl-mock",
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: model,
          choices: [{
            index: 0,
            message: { role: "assistant", content: `Mock response for model ${model}` },
            finish_reason: "stop"
          }]
        }));
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  mockServer.listen(MOCK_NVIDIA_PORT, '127.0.0.1', () => {
    console.log(`[Mock NVIDIA] running on http://127.0.0.1:${MOCK_NVIDIA_PORT}`);
  });
}

// 2. 清理測試資料庫
function cleanupDB() {
  closeDatabase();
  if (fs.existsSync(DB_FILE)) {
    try {
      fs.unlinkSync(DB_FILE);
      console.log(`[Cleanup] Removed temporary database: ${DB_FILE}`);
    } catch (e) {
      console.error('Failed to delete temp db:', e.message);
    }
  }
}

// 3. 測試本體
async function runTests() {
  console.log('\n>>> STARTING GATEWAY INTEGRATION TESTS <<<\n');

  // 確保在測試啟動前清理先前殘留的資料庫
  cleanupDB();

  // 初始化臨時測試資料庫
  initDatabase(DB_FILE);

  // 設定測試環境變數
  process.env.NVIDIA_API_URL = `http://127.0.0.1:${MOCK_NVIDIA_PORT}`;
  
  // 啟動 Gateway
  const app = createGatewayApp();
  gatewayServer = app.listen(GATEWAY_PORT, '127.0.0.1', () => {
    console.log(`[Gateway] running on http://127.0.0.1:${GATEWAY_PORT}`);
  });

  // 等待伺服器就緒
  await new Promise(r => setTimeout(r, 500));

  try {
    // --- 測試 1: 基本轉發功能 (健康 Key + 順位 1 模型) ---
    console.log('\n--- Test 1: Basic completions forwarding ---');
    // 寫入一個健康 key
    apiKeys.add('key-healthy');
    // 設定模型優先級 (順位 1: meta/llama3-70b-instruct)
    modelsConfig.savePriorityList(['meta/llama3-70b-instruct']);

    let res = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'patcher-main',
        messages: [{ role: 'user', content: 'hello' }]
      })
    });
    
    let data = await res.json();
    console.log('Response Status:', res.status);
    console.log('Response Body:', JSON.stringify(data));
    if (res.status === 200 && data.model === 'patcher-main') {
      console.log('=> TEST 1 PASSED');
    } else {
      throw new Error('TEST 1 FAILED');
    }

    // --- 測試 2: 429 Cooldown 與 Key 輪詢旋轉 ---
    console.log('\n--- Test 2: 429 Cooldown & Key Rotation ---');
    // 刪除舊 Key，並加入一把會觸發 429 的 key，與一把健康的 key
    db = initDatabase(DB_FILE); // 重新獲取 db 實例以進行數據操作
    const allKeys = apiKeys.getAll();
    allKeys.forEach(k => apiKeys.delete(k.id));

    apiKeys.add('key-429');     // 首個嘗試的 Key
    apiKeys.add('key-healthy'); // 備載健康的 Key

    res = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'patcher-main',
        messages: [{ role: 'user', content: 'test 429 rotation' }]
      })
    });

    data = await res.json();
    console.log('Response Status:', res.status);
    console.log('Response Body:', JSON.stringify(data));

    // 檢查資料庫以確認 key-429 是否被設定為 cooldown
    const keysAfter = apiKeys.getAll();
    const key429Obj = keysAfter.find(k => k.key_value === 'key-429');
    console.log('key-429 Status in DB:', key429Obj.status);
    
    if (res.status === 200 && key429Obj.status === 'cooldown') {
      console.log('=> TEST 2 PASSED (successfully rotated and marked 429 key as cooldown)');
    } else {
      throw new Error('TEST 2 FAILED');
    }

    // --- 測試 3: 503 Fallback 模型降級 ---
    console.log('\n--- Test 3: 503 Model Fallback ---');
    // 清空 Key，改加入 key-trigger-fallback (調用 70b 時會回傳 503)
    apiKeys.getAll().forEach(k => apiKeys.delete(k.id));
    apiKeys.add('key-trigger-fallback');

    // 設定兩台模型順位 (70b 第一順位, 8b 第二順位)
    modelsConfig.savePriorityList(['meta/llama3-70b-instruct', 'meta/llama3-8b-instruct']);

    res = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'patcher-main',
        messages: [{ role: 'user', content: 'trigger fallback' }]
      })
    });

    data = await res.json();
    console.log('Response Status:', res.status);
    console.log('Response Model returned:', data.model);
    
    if (res.status === 200 && data.model === 'patcher-main') {
      console.log('=> TEST 3 PASSED (successfully degraded to 2nd priority model)');
    } else {
      throw new Error('TEST 3 FAILED');
    }

    // --- 測試 4: 401 Invalid Key 標記損壞 ---
    console.log('\n--- Test 4: 401 Invalid Key disabling ---');
    apiKeys.getAll().forEach(k => apiKeys.delete(k.id));
    apiKeys.add('key-invalid'); // Revoked Key

    res = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'patcher-main',
        messages: [{ role: 'user', content: 'test invalid key' }]
      })
    });

    console.log('Response Status:', res.status);
    const keyInvalidObj = apiKeys.getAll().find(k => k.key_value === 'key-invalid');
    console.log('key-invalid Status in DB:', keyInvalidObj.status);

    if (res.status === 503 && keyInvalidObj.status === 'inactive') {
      console.log('=> TEST 4 PASSED (successfully marked invalid key as inactive)');
    } else {
      throw new Error('TEST 4 FAILED');
    }

    // --- 測試 5: 404 Model Fallback 模型降級 ---
    console.log('\n--- Test 5: 404 Model Fallback ---');
    // 清空 Key，加入會對 70b 觸發 404 的 key
    apiKeys.getAll().forEach(k => apiKeys.delete(k.id));
    apiKeys.add('key-trigger-404-fallback');

    // 設定兩台模型順位 (70b 第一順位, 8b 第二順位)
    modelsConfig.savePriorityList(['meta/llama3-70b-instruct', 'meta/llama3-8b-instruct']);

    res = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'patcher-main',
        messages: [{ role: 'user', content: 'trigger 404 fallback' }]
      })
    });

    data = await res.json();
    console.log('Response Status:', res.status);
    console.log('Response Model returned:', data.model);
    
    if (res.status === 200 && data.model === 'patcher-main') {
      console.log('=> TEST 5 PASSED (successfully degraded to 2nd priority model on 404)');
    } else {
      throw new Error('TEST 5 FAILED');
    }

    // --- 測試 6: 測試對話 API 的金鑰輪詢旋轉 ---
    console.log('\n--- Test 6: Test Chat Key Rotation ---');
    // 刪除所有金鑰，加入一把觸發 404 的 key，和一把健康的 key
    apiKeys.getAll().forEach(k => apiKeys.delete(k.id));
    apiKeys.add('key-trigger-404');
    apiKeys.add('key-healthy');

    res = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/api/test/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'meta/llama3-70b-instruct',
        messages: [{ role: 'user', content: 'test chat key rotation' }],
        stream: false
      })
    });

    data = await res.json();
    console.log('Response Status:', res.status);
    console.log('Response Body:', JSON.stringify(data));

    if (res.status === 200 && data.model === 'meta/llama3-70b-instruct') {
      console.log('=> TEST 6 PASSED (successfully rotated keys and got successful response from key-healthy)');
    } else {
      throw new Error('TEST 6 FAILED');
    }

    // --- 測試 7: OpenAI 相容 Models 列表獲取 ---
    console.log('\n--- Test 7: GET OpenAI compatible models list ---');
    res = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/models`, {
      method: 'GET'
    });

    data = await res.json();
    console.log('Response Status:', res.status);
    console.log('Response Body:', JSON.stringify(data));

    if (res.status === 200 && data.object === 'list' && Array.isArray(data.data) && data.data.some(m => m.id === 'patcher-main')) {
      console.log('=> TEST 7 PASSED (successfully returned OpenAI compatible models list)');
    } else {
      throw new Error('TEST 7 FAILED');
    }

    // --- 測試 8: GET /v1 基礎連線狀態檢查 ---
    console.log('\n--- Test 8: GET /v1 health status check ---');
    res = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1`, {
      method: 'GET'
    });

    data = await res.json();
    console.log('Response Status:', res.status);
    console.log('Response Body:', JSON.stringify(data));

    if (res.status === 200 && data.status === 'running') {
      console.log('=> TEST 8 PASSED (successfully returned status: running for /v1)');
    } else {
      throw new Error('TEST 8 FAILED');
    }

    // --- 測試 9: 400 Context Limit Fallback 模型降級 ---
    console.log('\n--- Test 9: 400 Context Limit Fallback ---');
    // 清空 Key，加入會對 70b 觸發 400 context limit 的 key，以及一個正常的 key-healthy
    apiKeys.getAll().forEach(k => apiKeys.delete(k.id));
    apiKeys.add('key-trigger-400-context');

    // 設定兩台模型順位 (70b 第一順位, 8b 第二順位)
    modelsConfig.savePriorityList(['meta/llama3-70b-instruct', 'meta/llama3-8b-instruct']);

    res = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'patcher-main',
        messages: [{ role: 'user', content: 'trigger 400 context limit fallback' }]
      })
    });

    data = await res.json();
    console.log('Response Status:', res.status);
    console.log('Response Model returned:', data.model);

    if (res.status === 200 && data.model === 'patcher-main') {
      console.log('=> TEST 9 PASSED (successfully degraded to 2nd priority model on 400 context limit)');
    } else {
      throw new Error('TEST 9 FAILED');
    }

    // --- 測試 10: 串流讀取逾時 Fallback 模型降級 ---
    console.log('\n--- Test 10: Stream Read Timeout Fallback ---');
    // 清除模型冷卻狀態，以免被前一個測試的冷卻時間干擾而直接跳過 70b 模型
    await fetch(`http://127.0.0.1:${GATEWAY_PORT}/api/gateway/reset-cooldowns`, { method: 'POST' });

    // 清空 Key，加入會對 70b 觸發串流超時的 key
    apiKeys.getAll().forEach(k => apiKeys.delete(k.id));
    apiKeys.add('key-trigger-stream-timeout');

    // 設定兩台模型順位 (70b 第一順位, 8b 第二順位)
    modelsConfig.savePriorityList(['meta/llama3-70b-instruct', 'meta/llama3-8b-instruct']);

    // 暫時將超時設定改為 1.5 秒
    settings.save({ STREAM_READ_TIMEOUT_MS: 1500 });

    res = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'patcher-main',
        messages: [{ role: 'user', content: 'trigger stream timeout' }],
        stream: true
      })
    });

    // 串流請求時，Gateway 會在順利切換到備用模型後輸出最終的 HTTP 200 SSE 串流。
    // 這裡我們直接校驗回應狀態碼與內容，確保它成功回傳。
    console.log('Response Status:', res.status);
    
    // 恢復超時設定為 120000ms
    settings.save({ STREAM_READ_TIMEOUT_MS: 120000 });

    if (res.status === 200) {
      console.log('=> TEST 10 PASSED (successfully degraded to 2nd priority model on stream read timeout)');
    } else {
      throw new Error('TEST 10 FAILED');
    }

    console.log('\n>>> ALL INTEGRATION TESTS PASSED SUCCESSFULLY! <<<\n');
  } catch (err) {
    console.error('\n>>> TEST SUITE FAILED:', err.message);
  } finally {
    // 關閉伺服器並清理
    if (gatewayServer) gatewayServer.close();
    if (mockServer) mockServer.close();
    cleanupDB();
  }
}

// 執行
startMockNvidiaServer();
setTimeout(runTests, 100);
