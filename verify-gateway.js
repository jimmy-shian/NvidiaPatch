const http = require('http');
const fs = require('fs');
const path = require('path');
const { initDatabase, apiKeys, modelsConfig, stats } = require('./database');
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

        // D. 正常回應
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
    if (res.status === 200 && data.model === 'meta/llama3-70b-instruct') {
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
    
    if (res.status === 200 && data.model === 'meta/llama3-8b-instruct') {
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
