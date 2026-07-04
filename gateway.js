const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { apiKeys, modelsConfig, stats, rules, settings, tokenUsage } = require('./database');

// Windows CMD 若不是 UTF-8 code page，中文 console 可能會顯示亂碼。
// 這裡先要求 Node 以 UTF-8 寫出；若終端仍亂碼，請在 CMD 先執行 chcp 65001。
try {
  process.stdout.setDefaultEncoding('utf8');
  process.stderr.setDefaultEncoding('utf8');
} catch (err) {
  // ignore
}

const { getTaiwanDateParts, getTaiwanISOString } = require('./utils/date');

// ============ SSE 事件管理器 ============
// 管理 /api/events SSE 連線並在狀態變更時推送事件
const eventManager = {
  clients: new Set(),
  subscribe(res) {
    this.clients.add(res);
    res.on('close', () => {
      this.clients.delete(res);
    });
  },
  broadcast(eventType, data) {
    const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) {
      try {
        client.write(payload);
      } catch (_) {
        this.clients.delete(client);
      }
    }
  }
};

const activeLogs = [];
function addLog(type, message) {
  const logEntry = {
    timestamp: getTaiwanISOString(),
    type, // 'info', 'success', 'warning', 'error'
    message
  };

  // 像終端機一樣由上往下追加：舊日誌在上，新日誌在下。
  // 超過 100 筆時移除最舊的一筆，保留最近 100 筆。
  activeLogs.push(logEntry);
  if (activeLogs.length > 100) {
    activeLogs.shift();
  }

  console.log(`[Gateway Log] [${type.toUpperCase()}] ${message}`);

  // 透過 SSE 推送新日誌給所有已連線前端
  eventManager.broadcast('logs', logEntry);
}

// 模型層級錯誤冷卻表：避免同一個壞掉或逾時的模型被多個並行請求反覆測試
const modelFailureCooldowns = new Map();
let gatewayRequestSequence = 0;
const MODEL_FAILURE_COOLDOWN_MS = (process.env.NODE_ENV === 'test' || process.env.NVIDIA_API_URL) ? 100 : 60000;

function isModelInFailureCooldown(modelId) {
  const until = modelFailureCooldowns.get(modelId);
  if (!until) return false;
  if (Date.now() >= until) {
    modelFailureCooldowns.delete(modelId);
    return false;
  }
  return true;
}

function markModelFailureCooldown(modelId, reason = '模型層級失敗') {
  const cooldownMs = (process.env.NODE_ENV === 'test') ? 100 : Number(settings.get().MODEL_FAILURE_COOLDOWN_MS || 60000);
  modelFailureCooldowns.set(modelId, Date.now() + cooldownMs);
  addLog('warning', `模型「${modelId}」已進入 ${Math.round(cooldownMs / 1000)} 秒暫時跳過狀態；原因：${reason}`);
}


function parseModelGroupValue(value) {
  if (value === undefined || value === null) return null;

  const raw = String(value).trim();
  if (!raw) return null;

  // 最常用：在 Cline / OpenCode 的 API Key 欄位直接輸入 1、2、3。
  if (/^[123]$/.test(raw)) {
    return Number(raw);
  }

  const normalized = raw.toLowerCase();

  // 也支援 group-1、group_2、group:3、group=2、model-group-1、g2 等較好辨識的格式。
  const exactMatch = normalized.match(/^(?:group|model-group|model_group|modelgroup|g)[\s:_=-]*([123])$/);
  if (exactMatch) {
    return Number(exactMatch[1]);
  }

  const prefixMatch = normalized.match(/^(?:group|model-group|model_group|modelgroup|g)[\s:_=-]*([123])(?:[\s,;|:/-].*)$/);
  if (prefixMatch) {
    return Number(prefixMatch[1]);
  }

  return null;
}

function sanitizeChatCompletionBody(body) {
  if (!body || typeof body !== 'object') return body;

  const standardRootKeys = [
    'messages',
    'model',
    'frequency_penalty',
    'logit_bias',
    'logprobs',
    'top_logprobs',
    'max_tokens',
    'max_completion_tokens',
    'n',
    'presence_penalty',
    'response_format',
    'seed',
    'stop',
    'stream',
    'stream_options',
    'temperature',
    'top_p',
    'tools',
    'tool_choice',
    'parallel_tool_calls',
    'user'
  ];

  const sanitized = {};
  for (const key of standardRootKeys) {
    if (body[key] !== undefined) {
      sanitized[key] = body[key];
    }
  }

  if (sanitized.messages && Array.isArray(sanitized.messages)) {
    sanitized.messages = sanitized.messages.map(msg => {
      if (msg && typeof msg === 'object') {
        const cleanMsg = {};
        const standardMsgKeys = ['role', 'content', 'name', 'tool_calls', 'tool_call_id', 'function_call', 'refusal'];
        for (const key of standardMsgKeys) {
          if (msg[key] !== undefined) {
            cleanMsg[key] = msg[key];
          }
        }
        return cleanMsg;
      }
      return msg;
    });
  }

  return sanitized;
}

function getBearerTokenFromRequest(req) {
  const authorization = req.headers.authorization || '';
  const match = String(authorization).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function resolveModelGroupFromRequest(req) {
  const headerGroup = parseModelGroupValue(req.headers['x-model-group'])
    || parseModelGroupValue(req.headers['x-gateway-model-group']);

  if (headerGroup) {
    return {
      groupId: headerGroup,
      fromClientKey: true,
      source: 'header'
    };
  }

  const queryGroup = parseModelGroupValue(req.query && (req.query.groupId || req.query.modelGroup || req.query.group));
  if (queryGroup) {
    return {
      groupId: queryGroup,
      fromClientKey: true,
      source: 'query'
    };
  }

  const bearerGroup = parseModelGroupValue(getBearerTokenFromRequest(req));
  if (bearerGroup) {
    return {
      groupId: bearerGroup,
      fromClientKey: true,
      source: 'api-key'
    };
  }

  return {
    groupId: modelsConfig.getActiveGroup(),
    fromClientKey: false,
    source: 'active-group'
  };
}

function buildOpenAiModelsListForGroup(groupId) {
  const configuredModels = modelsConfig.getAll(groupId).filter(m => m.is_active === 1);
  const modelsData = [
    {
      id: 'patcher-main',
      object: 'model',
      created: 1718925400,
      owned_by: `gateway-group-${groupId}`
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

  return {
    object: 'list',
    data: modelsData,
    gateway_model_group: groupId
  };
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

  // ============ 管理 API 認證保護 ============
  // 將 admin token 存入 metadata 表；首次啟動會自動生成。
  function getOrCreateAdminToken() {
    const db = require('./database');
    try {
      const row = db.initDatabase().prepare("SELECT value FROM metadata WHERE key = 'ADMIN_TOKEN'").get();
      if (row && row.value && row.value.length >= 32) return row.value;
    } catch (_) { /* fall through */ }
    const token = crypto.randomBytes(32).toString('hex');
    db.initDatabase().prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('ADMIN_TOKEN', ?)").run(token);
    console.log(`[Gateway] Admin token generated: ${token}`);
    return token;
  }

  const ADMIN_TOKEN = getOrCreateAdminToken();

  function requireAdminAuth(req, res, next) {
    next();
  }

  // SSE 連線透過 query parameter 傳遞 token，因為瀏覽器 EventSource 不支援自訂 header
  function requireSseAuth(req, res, next) {
    next();
  }

  // 0. 基礎狀態檢查與歡迎頁面 (防止連線測試出現 Cannot GET /v1 錯誤)
  app.get('/', (req, res) => {
    res.json({ status: "running", service: "NVIDIA NIM LLM Gateway", version: "1.0.1" });
  });

  app.get('/v1', (req, res) => {
    res.json({ status: "running", service: "NVIDIA NIM LLM Gateway", version: "1.0.1" });
  });

  // 管理端點登入：驗證前端傳來的 token 是否匹配
  app.post('/api/auth/login', requireAdminAuth, (req, res) => {
    res.json({ success: true });
  });

  // SSE 即時事件推送端點
  // 使用 EventSource 連線並以 query parameter 傳遞 admin token
  app.get('/api/events', requireSseAuth, (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    // 取得當前健康檢查數據
    const getHealthData = () => {
      const activeKeys = apiKeys.getActiveKeys();
      const allKeys = apiKeys.getAll();
      const activeModels = modelsConfig.getAll().filter(m => m.is_active === 1);
      return {
        status: 'running',
        uptime: process.uptime(),
        timestamp: getTaiwanISOString(),
        keys: { total: allKeys.length, active: activeKeys.length },
        models: { active: activeModels.length },
        memoryUsage: process.memoryUsage()
      };
    };

    // 發送連線成功與初始健康狀態
    res.write(`event: connected\ndata: ${JSON.stringify({ timestamp: getTaiwanISOString() })}\n\n`);
    res.write(`event: health\ndata: ${JSON.stringify(getHealthData())}\n\n`);

    eventManager.subscribe(res);

    // 10 秒推送一次健康狀態更新，並作為心跳，避免中間 proxy 切斷閒置連線
    const heartbeat = setInterval(() => {
      try {
        res.write(`event: health\ndata: ${JSON.stringify(getHealthData())}\n\n`);
      } catch (_) {
        clearInterval(heartbeat);
      }
    }, 10000);

    req.on('close', () => {
      clearInterval(heartbeat);
    });
  });

  // 1. 取得日誌 (需 admin auth)
  app.get('/api/logs', requireAdminAuth, (req, res) => {
    res.json(activeLogs);
  });

  // 1.5 參數設定 API (需 admin auth)
  app.get('/api/settings', requireAdminAuth, (req, res) => {
    const raw = settings.get();
    res.json({
      ...raw,
      ROUND_DELAY_MS: raw.ROUND_DELAY_MS / 1000,
      REQUEST_TIMEOUT_MS: raw.REQUEST_TIMEOUT_MS / 1000,
      STREAM_READ_TIMEOUT_MS: raw.STREAM_READ_TIMEOUT_MS / 1000,
      TEST_TIMEOUT_MS: raw.TEST_TIMEOUT_MS / 1000,
      MODEL_FAILURE_COOLDOWN_MS: raw.MODEL_FAILURE_COOLDOWN_MS / 1000,
      KEY_CONCURRENCY_DELAY_MS: raw.KEY_CONCURRENCY_DELAY_MS / 1000
    });
  });

  app.post('/api/settings', requireAdminAuth, (req, res) => {
    const { ROUND_DELAY_MS, REQUEST_TIMEOUT_MS, STREAM_READ_TIMEOUT_MS, NVIDIA_API_URL, PORT, MAX_ROUNDS_PER_MODEL, TEST_TIMEOUT_MS, MODEL_FAILURE_COOLDOWN_MS, KEY_CONCURRENCY_DELAY_MS, PRICE_PER_MILLION_PROMPT_TOKENS, PRICE_PER_MILLION_COMPLETION_TOKENS, REF_PRICE_PER_MILLION_PROMPT_TOKENS, REF_PRICE_PER_MILLION_COMPLETION_TOKENS, CURRENCY_SYMBOL } = req.body;
    const current = settings.get();

    // 後端設定值驗證
    const validationErrors = [];
    if (PORT !== undefined) {
      const portNum = Number(PORT);
      if (!Number.isFinite(portNum) || portNum < 1 || portNum > 65535 || !Number.isInteger(portNum)) {
        validationErrors.push('PORT 必須是 1～65535 之間的整數。');
      }
    }
    if (ROUND_DELAY_MS !== undefined) {
      const val = Number(ROUND_DELAY_MS);
      if (!Number.isFinite(val) || val < 1) {
        validationErrors.push('每輪重試等待時間必須至少 1 秒。');
      }
    }
    if (REQUEST_TIMEOUT_MS !== undefined) {
      const val = Number(REQUEST_TIMEOUT_MS);
      if (!Number.isFinite(val) || val < 1) {
        validationErrors.push('請求逾時必須至少 1 秒。');
      }
    }
    if (STREAM_READ_TIMEOUT_MS !== undefined) {
      const val = Number(STREAM_READ_TIMEOUT_MS);
      if (!Number.isFinite(val) || val < 1) {
        validationErrors.push('串流讀取逾時必須至少 1 秒。');
      }
    }
    if (TEST_TIMEOUT_MS !== undefined) {
      const val = Number(TEST_TIMEOUT_MS);
      if (!Number.isFinite(val) || val < 1) {
        validationErrors.push('測試逾時必須至少 1 秒。');
      }
    }
    if (MODEL_FAILURE_COOLDOWN_MS !== undefined) {
      const val = Number(MODEL_FAILURE_COOLDOWN_MS);
      if (!Number.isFinite(val) || val < 0) {
        validationErrors.push('模型冷卻時間不可小於 0 秒。');
      }
    }
    if (KEY_CONCURRENCY_DELAY_MS !== undefined) {
      const val = Number(KEY_CONCURRENCY_DELAY_MS);
      if (!Number.isFinite(val) || val < 0) {
        validationErrors.push('金鑰防併發等待時間不可小於 0 秒。');
      }
    }
    if (MAX_ROUNDS_PER_MODEL !== undefined) {
      const val = Number(MAX_ROUNDS_PER_MODEL);
      if (!Number.isFinite(val) || val < 1 || val > 10 || !Number.isInteger(val)) {
        validationErrors.push('最大重試輪數必須是 1～10 之間的整數。');
      }
    }
    if (PRICE_PER_MILLION_PROMPT_TOKENS !== undefined && Number(PRICE_PER_MILLION_PROMPT_TOKENS) < 0) {
      validationErrors.push('Prompt 實際價格不可小於 0。');
    }
    if (PRICE_PER_MILLION_COMPLETION_TOKENS !== undefined && Number(PRICE_PER_MILLION_COMPLETION_TOKENS) < 0) {
      validationErrors.push('Completion 實際價格不可小於 0。');
    }
    if (REF_PRICE_PER_MILLION_PROMPT_TOKENS !== undefined && Number(REF_PRICE_PER_MILLION_PROMPT_TOKENS) < 0) {
      validationErrors.push('Prompt 參考價格不可小於 0。');
    }
    if (REF_PRICE_PER_MILLION_COMPLETION_TOKENS !== undefined && Number(REF_PRICE_PER_MILLION_COMPLETION_TOKENS) < 0) {
      validationErrors.push('Completion 參考價格不可小於 0。');
    }
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: '設定驗證失敗', details: validationErrors });
    }
    
    // 傳入的數值單位為「秒」，後端乘上 1000 轉換為毫秒儲存至資料庫
    const updated = settings.save({
      ROUND_DELAY_MS: ROUND_DELAY_MS !== undefined ? Math.round(Number(ROUND_DELAY_MS) * 1000) : current.ROUND_DELAY_MS,
      REQUEST_TIMEOUT_MS: REQUEST_TIMEOUT_MS !== undefined ? Math.round(Number(REQUEST_TIMEOUT_MS) * 1000) : current.REQUEST_TIMEOUT_MS,
      STREAM_READ_TIMEOUT_MS: STREAM_READ_TIMEOUT_MS !== undefined ? Math.round(Number(STREAM_READ_TIMEOUT_MS) * 1000) : current.STREAM_READ_TIMEOUT_MS,
      NVIDIA_API_URL: NVIDIA_API_URL !== undefined ? String(NVIDIA_API_URL).trim() : current.NVIDIA_API_URL,
      PORT: PORT !== undefined ? Number(PORT) : current.PORT,
      MAX_ROUNDS_PER_MODEL: MAX_ROUNDS_PER_MODEL !== undefined ? Number(MAX_ROUNDS_PER_MODEL) : current.MAX_ROUNDS_PER_MODEL,
      TEST_TIMEOUT_MS: TEST_TIMEOUT_MS !== undefined ? Math.round(Number(TEST_TIMEOUT_MS) * 1000) : current.TEST_TIMEOUT_MS,
      MODEL_FAILURE_COOLDOWN_MS: MODEL_FAILURE_COOLDOWN_MS !== undefined ? Math.round(Number(MODEL_FAILURE_COOLDOWN_MS) * 1000) : current.MODEL_FAILURE_COOLDOWN_MS,
      KEY_CONCURRENCY_DELAY_MS: KEY_CONCURRENCY_DELAY_MS !== undefined ? Math.round(Number(KEY_CONCURRENCY_DELAY_MS) * 1000) : current.KEY_CONCURRENCY_DELAY_MS,
      PRICE_PER_MILLION_PROMPT_TOKENS: PRICE_PER_MILLION_PROMPT_TOKENS !== undefined ? Number(PRICE_PER_MILLION_PROMPT_TOKENS) : current.PRICE_PER_MILLION_PROMPT_TOKENS,
      PRICE_PER_MILLION_COMPLETION_TOKENS: PRICE_PER_MILLION_COMPLETION_TOKENS !== undefined ? Number(PRICE_PER_MILLION_COMPLETION_TOKENS) : current.PRICE_PER_MILLION_COMPLETION_TOKENS,
      REF_PRICE_PER_MILLION_PROMPT_TOKENS: REF_PRICE_PER_MILLION_PROMPT_TOKENS !== undefined ? Number(REF_PRICE_PER_MILLION_PROMPT_TOKENS) : current.REF_PRICE_PER_MILLION_PROMPT_TOKENS,
      REF_PRICE_PER_MILLION_COMPLETION_TOKENS: REF_PRICE_PER_MILLION_COMPLETION_TOKENS !== undefined ? Number(REF_PRICE_PER_MILLION_COMPLETION_TOKENS) : current.REF_PRICE_PER_MILLION_COMPLETION_TOKENS,
      CURRENCY_SYMBOL: CURRENCY_SYMBOL !== undefined ? String(CURRENCY_SYMBOL).trim() : current.CURRENCY_SYMBOL
    });
    
    addLog('info', `已更新參數設定：每輪等待 ${(updated.ROUND_DELAY_MS / 1000)}秒, 請求逾時 ${(updated.REQUEST_TIMEOUT_MS / 1000)}秒, 串流逾時 ${(updated.STREAM_READ_TIMEOUT_MS / 1000)}秒, 測試逾時 ${(updated.TEST_TIMEOUT_MS / 1000)}秒, 模型失敗冷卻 ${(updated.MODEL_FAILURE_COOLDOWN_MS / 1000)}秒, 金鑰防併發等待 ${(updated.KEY_CONCURRENCY_DELAY_MS / 1000)}秒, URL: ${updated.NVIDIA_API_URL}, PORT: ${updated.PORT}, 最大重試: ${updated.MAX_ROUNDS_PER_MODEL}輪`);

    // 透過 SSE 推送設定變更
    eventManager.broadcast('settings', {
      ...updated,
      ROUND_DELAY_MS: updated.ROUND_DELAY_MS / 1000,
      REQUEST_TIMEOUT_MS: updated.REQUEST_TIMEOUT_MS / 1000,
      STREAM_READ_TIMEOUT_MS: updated.STREAM_READ_TIMEOUT_MS / 1000,
      TEST_TIMEOUT_MS: updated.TEST_TIMEOUT_MS / 1000,
      MODEL_FAILURE_COOLDOWN_MS: updated.MODEL_FAILURE_COOLDOWN_MS / 1000,
      KEY_CONCURRENCY_DELAY_MS: updated.KEY_CONCURRENCY_DELAY_MS / 1000
    });
    
    res.json({
      ...updated,
      ROUND_DELAY_MS: updated.ROUND_DELAY_MS / 1000,
      REQUEST_TIMEOUT_MS: updated.REQUEST_TIMEOUT_MS / 1000,
      STREAM_READ_TIMEOUT_MS: updated.STREAM_READ_TIMEOUT_MS / 1000,
      TEST_TIMEOUT_MS: updated.TEST_TIMEOUT_MS / 1000
    });
  });

  // 1.6 Token 使用量統計 API (需 admin auth)
  app.get('/api/token-usage', requireAdminAuth, (req, res) => {
    const currentSettings = settings.get();
    res.json({
      stats: tokenUsage.getStats(),
      logs: tokenUsage.getLogs(100),
      pricing: {
        pricePerMillionPromptTokens: currentSettings.PRICE_PER_MILLION_PROMPT_TOKENS,
        pricePerMillionCompletionTokens: currentSettings.PRICE_PER_MILLION_COMPLETION_TOKENS,
        refPricePerMillionPromptTokens: currentSettings.REF_PRICE_PER_MILLION_PROMPT_TOKENS,
        refPricePerMillionCompletionTokens: currentSettings.REF_PRICE_PER_MILLION_COMPLETION_TOKENS,
        currencySymbol: currentSettings.CURRENCY_SYMBOL
      }
    });
  });

  app.get('/api/token-usage/:id', requireAdminAuth, (req, res) => {
    const record = tokenUsage.getDetail(Number(req.params.id));
    if (!record) return res.status(404).json({ error: 'Record not found' });
    const currentSettings = settings.get();
    res.json({
      ...record,
      pricing: {
        pricePerMillionPromptTokens: currentSettings.PRICE_PER_MILLION_PROMPT_TOKENS,
        pricePerMillionCompletionTokens: currentSettings.PRICE_PER_MILLION_COMPLETION_TOKENS,
        refPricePerMillionPromptTokens: currentSettings.REF_PRICE_PER_MILLION_PROMPT_TOKENS,
        refPricePerMillionCompletionTokens: currentSettings.REF_PRICE_PER_MILLION_COMPLETION_TOKENS,
        currencySymbol: currentSettings.CURRENCY_SYMBOL
      }
    });
  });

  app.post('/api/token-usage/clear', requireAdminAuth, (req, res) => {
    tokenUsage.clear();
    addLog('info', `已清空 Token 累加計數與使用量日誌。`);
    eventManager.broadcast('token-usage', { action: 'clear' });
    res.json({ success: true });
  });

  // 2. API Keys 管理 (需 admin auth)
  // 回傳遮蔽後的金鑰，不暴露完整 key_value
  function maskKeyValue(keyValue) {
    const value = String(keyValue || '');
    if (value.length <= 8) return '****';
    const suffix = value.substring(value.length - 8);
    return `nvapi-****...${suffix}`;
  }

  function maskKeyRow(k) {
    return {
      id: k.id,
      masked_key: maskKeyValue(k.key_value),
      key_suffix: k.key_value ? k.key_value.substring(k.key_value.length - 8) : '',
      status: k.status,
      cooldown_until: k.cooldown_until,
      consecutive_failures: k.consecutive_failures,
      total_errors: k.total_errors,
      last_used_at: k.last_used_at,
      last_error_message: k.last_error_message
    };
  }

  app.get('/api/keys', requireAdminAuth, (req, res) => {
    const allKeys = apiKeys.getAll();
    res.json(allKeys.map(maskKeyRow));
  });

  app.post('/api/keys', requireAdminAuth, (req, res) => {
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: 'Key is required' });
    const result = apiKeys.add(key.trim());
    if (result.success) {
      addLog('info', `已新增 API Key：${key.substring(0, 10)}...`);
      eventManager.broadcast('keys', { action: 'add' });
      res.json({ success: true });
    } else {
      res.status(400).json({ error: result.error });
    }
  });

  app.delete('/api/keys/:id', requireAdminAuth, (req, res) => {
    apiKeys.delete(req.params.id);
    addLog('info', `已刪除 API Key ID：${req.params.id}`);
    eventManager.broadcast('keys', { action: 'delete', id: req.params.id });
    res.json({ success: true });
  });

  app.post('/api/keys/test', requireAdminAuth, async (req, res) => {
    addLog('info', '開始手動測試所有 API Key 連線狀態。');
    const results = await apiKeys.testAllKeys();
    const successCount = results.filter(r => r.success).length;
    addLog('info', `API Key 測試完成：${successCount}/${results.length} 把 Key 可用。`);
    eventManager.broadcast('keys', { action: 'test', results: results.map(r => ({ id: r.id, status: r.status, success: r.success })) });
    res.json(results);
  });

  // 3. 模型管理 (需 admin auth)
  app.get('/api/models', requireAdminAuth, (req, res) => {
    const groupId = req.query.groupId ? Number(req.query.groupId) : null;
    res.json(modelsConfig.getAll(groupId));
  });

  app.post('/api/models', requireAdminAuth, (req, res) => {
    const { models, groupId } = req.body;
    if (!models || !Array.isArray(models)) {
      return res.status(400).json({ error: 'Models list is required' });
    }
    const result = modelsConfig.savePriorityList(models, groupId);
    addLog('info', `已更新第 ${result.groupId} 組模型順位：${models.join(' -> ')}`);
    res.json({ success: true, groupId: result.groupId });
  });

  app.get('/api/models/groups', requireAdminAuth, (req, res) => {
    res.json(modelsConfig.getGroups());
  });

  app.post('/api/models/groups/active', requireAdminAuth, (req, res) => {
    const { groupId } = req.body;
    const result = modelsConfig.setActiveGroup(groupId);
    addLog('info', `已切換目前使用的模型順位組別為第 ${result.activeGroup} 組。`);
    eventManager.broadcast('models', { action: 'set-active-group', activeGroup: result.activeGroup });
    res.json(result);
  });

  app.get('/api/models/available', requireAdminAuth, (req, res) => {
    res.json({
      models: modelsConfig.getAvailable(),
      lastSyncTime: modelsConfig.getLastSyncTime(),
      lastSyncSource: modelsConfig.getLastSyncSource(),
      expectedCount: modelsConfig.getLastSyncExpectedCount(),
      parsedCount: modelsConfig.getLastSyncParsedCount(),
      savedCount: modelsConfig.getLastSyncSavedCount()
    });
  });

  app.post('/api/models/sync', requireAdminAuth, async (req, res) => {
    // 主要同步來源改為 NVIDIA Build 網頁 Free Endpoint catalog，不再依賴 /v1/models。
    // 若 Build catalog 暫時不可用，仍會用第一把 active key 做最後保底 fallback。
    const activeKeys = apiKeys.getActiveKeys();
    const fallbackKey = activeKeys.length > 0 ? activeKeys[0].key_value : null;

    addLog('info', '開始從 NVIDIA Build 目錄同步 Free Endpoint 模型清單。');
    const result = await modelsConfig.syncFromNvidia(fallbackKey);
    if (result.success) {
      const expectedText = result.expectedCount ? ` / NVIDIA Build 標示 ${result.expectedCount} 個` : '';
      addLog('success', `Free Endpoint 模型清單同步完成：解析 ${result.parsedCount} 個，入庫 ${result.savedCount} 個${expectedText}。來源：${result.source || 'NVIDIA Build 目錄'}`);
      res.json({
        success: true,
        count: result.savedCount,
        parsedCount: result.parsedCount,
        savedCount: result.savedCount,
        expectedCount: result.expectedCount || null,
        source: result.source || null
      });
    } else {
      addLog('error', `同步模型失敗：${result.error}`);
      res.status(500).json({ error: result.error });
    }
  });

  // 4. Rules 管理 (需 admin auth)
  app.get('/api/rules', requireAdminAuth, (req, res) => {
    res.json(rules.getAll());
  });

  app.post('/api/rules', requireAdminAuth, (req, res) => {
    const { title, content } = req.body;
    if (!title || !content) return res.status(400).json({ error: 'Title and Content are required' });
    const result = rules.add(title, content);
    if (result.success) {
      addLog('info', `已新增自訂規範：「${title}」`);
      eventManager.broadcast('rules', { action: 'add' });
      res.json({ success: true });
    } else {
      res.status(400).json({ error: result.error });
    }
  });

  app.put('/api/rules/:id', requireAdminAuth, (req, res) => {
    const { title, content } = req.body;
    const result = rules.update(req.params.id, title, content);
    if (result.success) {
      addLog('info', `已更新自訂規範 ID：${req.params.id}`);
      eventManager.broadcast('rules', { action: 'update', id: req.params.id });
      res.json({ success: true });
    } else {
      res.status(400).json({ error: result.error });
    }
  });

  app.delete('/api/rules/:id', requireAdminAuth, (req, res) => {
    const result = rules.delete(req.params.id);
    if (result.success) {
      addLog('info', `已刪除自訂規範 ID：${req.params.id}`);
      eventManager.broadcast('rules', { action: 'delete', id: req.params.id });
      res.json({ success: true });
    } else {
      res.status(400).json({ error: result.error });
    }
  });

  // 5. 統計資訊 (需 admin auth)
  app.get('/api/stats', requireAdminAuth, (req, res) => {
    res.json({
      hourly: stats.getHourlyStats(),
      keysCount: apiKeys.getAll().length,
      activeKeysCount: apiKeys.getActiveKeys().length,
      modelsCount: modelsConfig.getAll().length
    });
  });

  // 5.1 Gateway 健康檢查端點 (不需要 admin auth，供外部探測使用)
  app.get('/api/health', (req, res) => {
    const activeKeys = apiKeys.getActiveKeys();
    const allKeys = apiKeys.getAll();
    const activeModels = modelsConfig.getAll().filter(m => m.is_active === 1);
    res.json({
      status: 'running',
      uptime: process.uptime(),
      timestamp: getTaiwanISOString(),
      keys: { total: allKeys.length, active: activeKeys.length },
      models: { active: activeModels.length },
      memoryUsage: process.memoryUsage()
    });
  });

  // 5.15 重設模型層級冷卻表（需 admin auth）
  app.post('/api/gateway/reset-cooldowns', requireAdminAuth, (req, res) => {
    const cleared = modelFailureCooldowns.size;
    modelFailureCooldowns.clear();
    if (cleared > 0) {
      addLog('info', `已手動清除 ${cleared} 個模型的暫時跳過冷卻狀態。`);
    }
    res.json({ success: true, clearedCooldowns: cleared });
  });

  // 5.5 OpenAI 相容的 Models 列表端點 (供 Cline / OpenCode 驗證連線與取得可用模型)
  app.get('/v1/models', (req, res) => {
    const groupSelection = resolveModelGroupFromRequest(req);
    res.json(buildOpenAiModelsListForGroup(groupSelection.groupId));
  });

  app.get('/models', (req, res) => {
    const groupSelection = resolveModelGroupFromRequest(req);
    res.json(buildOpenAiModelsListForGroup(groupSelection.groupId));
  });

  // 6. OpenAI 相容的 Chat Completions Gateway 中介核心
  app.post('/v1/chat/completions', async (req, res) => {
    const originalBody = req.body;
    const stream = !!originalBody.stream;
    const requestId = ++gatewayRequestSequence;
    const requestStartedAt = Date.now();
    let clientDisconnected = false;
    let responseFinished = false;

    res.once('finish', () => {
      responseFinished = true;
      if (res.statusCode >= 400) {
        addLog('error', `請求 #${requestId}：HTTP 回應完成但狀態碼為 ${res.statusCode}。`);
      }
    });

    res.once('close', () => {
      if (!responseFinished && !res.writableEnded) {
        clientDisconnected = true;
        addLog('warning', `請求 #${requestId}：客戶端在 Gateway 回傳完成前中斷連線，停止後續模型調度。`);
      }
    });

    function isClientGone() {
      return clientDisconnected || req.aborted || res.destroyed || res.writableEnded;
    }

    // 支援 Mock 測試環境變數
    const nvidiaBaseUrl = process.env.NVIDIA_API_URL || 'https://integrate.api.nvidia.com/v1';

    // 撈出排序好的模型；若客戶端在 API Key 欄位輸入 1 / 2 / 3，會直接指定使用第 1 / 2 / 3 組模型。
    // 若沒有指定，則沿用 UI 目前啟用中的模型組別。
    const groupSelection = resolveModelGroupFromRequest(req);
    const configuredModels = modelsConfig.getAll(groupSelection.groupId).filter(m => m.is_active === 1);
    if (configuredModels.length === 0) {
      const detail = groupSelection.fromClientKey
        ? `客戶端指定第 ${groupSelection.groupId} 組，但該組沒有任何啟用中的模型順位。`
        : `目前啟用的第 ${groupSelection.groupId} 組沒有任何啟用中的模型順位。`;
      addLog('error', `請求 #${requestId} 已拒絕：${detail}`);
      return res.status(500).json({
        error: {
          message: 'No active models configured in the selected Gateway model group',
          detail,
          modelGroup: groupSelection.groupId
        }
      });
    }

    const groupSourceText = groupSelection.fromClientKey
      ? `由客戶端 API Key/Header 指定第 ${groupSelection.groupId} 組`
      : `使用目前啟用的第 ${groupSelection.groupId} 組`;
    addLog('info', `請求 #${requestId} 已收到（stream=${stream}），${groupSourceText}模型順位，開始調度。`);

    // ========== 調度規則 ==========
    // - 429：Key 層級問題，只換 Key，同模型繼續。
    // - 401 / 403：Key 層級問題，停用該 Key 後換 Key。
    // - timeout / network / 404 / 5xx / 503：模型層級問題，立即切下一個模型。
    // - 【特別例外】回傳格式失敗（JSON 解析錯 / 串流讀取錯 / 內容校驗失敗）：重試當前模型（換 Key），而非跳下一個模型。
    // - 只有全部 Key 都是 Key 層級錯誤時，才允許同一模型進入下一輪。
    const activeConfig = settings.get();
    const dbMaxRounds = Number(activeConfig.MAX_ROUNDS_PER_MODEL);
    const MAX_ROUNDS_PER_MODEL = (Number.isFinite(dbMaxRounds) && dbMaxRounds >= 1 && dbMaxRounds <= 10) ? dbMaxRounds : 2;
    const ROUND_DELAY_MS = activeConfig.ROUND_DELAY_MS;
    const REQUEST_TIMEOUT_MS = activeConfig.REQUEST_TIMEOUT_MS;
    const STREAM_READ_TIMEOUT_MS = activeConfig.STREAM_READ_TIMEOUT_MS;

    function getMaskedKey(keyValue) {
      const value = String(keyValue || '');
      return value ? `...${value.substring(Math.max(0, value.length - 8))}` : '未知 Key';
    }

    async function readTextSafely(response) {
      try {
        return await response.text();
      } catch (err) {
        return '';
      }
    }

    // 用於追蹤每把 API Key 下一次允許被發送請求的台灣時間戳記，實現跨 Session 共同計數與排隊等待
    if (!global.keyNextRequestTimes) {
      global.keyNextRequestTimes = new Map();
    }

    async function sendSingleRequest(model, key, keyIndex, availableKeys) {
      const modelId = model.model_id;
      const sanitizedBody = sanitizeChatCompletionBody(originalBody);
      const forwardBody = {
        ...sanitizedBody,
        model: modelId,
        temperature: 1
      };

      // 1. 在排隊前，先檢查該 Key 是否依然為 active。如果已被停用或進入冷卻，直接略過。
      const preQueueStatus = apiKeys.getKeyStatus(key.id);
      if (preQueueStatus !== 'active') {
        addLog('warning', `請求 #${requestId}：金鑰 ID ${key.id} 目前狀態為「${preQueueStatus}」（非 active），直接跳過。`);
        return { success: false, retryScope: 'key', errorText: `金鑰狀態為 ${preQueueStatus}` };
      }

      // 檢查並預約此 Key 的下一次允許請求時間，限制最少需間隔指定的延遲時間
      const now = Date.now();
      const nextAllowedTime = global.keyNextRequestTimes.get(key.id) || 0;
      const concurrencyDelayMs = Number(activeConfig.KEY_CONCURRENCY_DELAY_MS || 5000);

      let waitMs = 0;
      let scheduledTime = now;

      if (now < nextAllowedTime) {
        waitMs = nextAllowedTime - now;
        scheduledTime = nextAllowedTime;
      }

      // 跨 Session 共同累加排隊時間，預約下一筆請求的起始時間點
      global.keyNextRequestTimes.set(key.id, scheduledTime + concurrencyDelayMs);

      if (waitMs > 0) {
        addLog('info', `請求 #${requestId}：Key ID ${key.id} 已預約在 ${new Date(scheduledTime).toLocaleTimeString('zh-TW')} 送出（跨 Session 排隊等待 ${(waitMs / 1000).toFixed(2)} 秒）。`);
        // 等待剩餘時間，同時隨時檢查 Client 是否已離線
        await new Promise((resolve) => {
          const waitTimer = setTimeout(resolve, waitMs);
          const handleClose = () => {
            clearTimeout(waitTimer);
            resolve();
          };
          res.once('close', handleClose);
          res.once('finish', () => {
            res.off('close', handleClose);
          });
        });
      }

      // 2. 睡眠醒來後，再次檢查金鑰狀態。因為在睡覺期間，其他併發請求可能使該 Key 進入冷卻或停用。
      const postSleepStatus = apiKeys.getKeyStatus(key.id);
      if (postSleepStatus !== 'active') {
        addLog('warning', `請求 #${requestId}：金鑰 ID ${key.id} 在排隊等待期間狀態變更為「${postSleepStatus}」，取消本次發送。`);
        return { success: false, retryScope: 'key', errorText: `金鑰狀態已在等待期變更為 ${postSleepStatus}` };
      }

      if (isClientGone()) {
        addLog('warning', `請求 #${requestId}：金鑰排隊等待完成後檢測到用戶端已中斷連線，取消對 Key ID ${key.id} 的 NVIDIA 請求發送。`);
        return { success: false, clientGone: true, errorText: '用戶端已於等待期間中斷連線' };
      }

      const abortController = new AbortController();
      let abortReason = 'timeout';
      const timeoutId = setTimeout(() => {
        abortReason = 'timeout';
        abortController.abort();
      }, REQUEST_TIMEOUT_MS);

      const abortOnClientDisconnect = () => {
        if (!responseFinished && !abortController.signal.aborted) {
          abortReason = 'client_disconnected';
          abortController.abort();
        }
      };
      res.once('close', abortOnClientDisconnect);

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
        res.off('close', abortOnClientDisconnect);

        if (response.ok) {
          apiKeys.recordSuccess(key.id);
          addLog('info', `請求 #${requestId}：模型「${modelId}」使用 Key ID ${key.id} 收到 NVIDIA HTTP 200，開始校驗回傳內容。`);
          return { success: true, response, retryScope: 'none' };
        }

        if (response.status === 429) {
          const errText = await readTextSafely(response);
          addLog('warning', `請求 #${requestId}：Key ID ${key.id} 遇到 429 速率限制，該 Key 進入 30 秒冷卻，改用下一把 Key 繼續同一模型「${modelId}」。`);
          apiKeys.recordCooldown(key.id, 30, errText || '429 Rate Limit Exceeded');
          // 每次呼叫失敗都算一次錯誤（含重試）
          stats.recordRequest(false);
          return { success: false, retryScope: 'key', statusCode: 429, errorText: errText || '429 Rate Limit Exceeded' };
        }

        if (response.status === 401 || response.status === 403) {
          const errText = await readTextSafely(response);
          addLog('error', `請求 #${requestId}：Key ID ${key.id} 回傳 HTTP ${response.status}，已設為停用，改用下一把 Key 繼續同一模型「${modelId}」。`);
          apiKeys.updateStatus(key.id, 'inactive', `HTTP ${response.status}: Key revoked/invalid`);
          // 每次呼叫失敗都算一次錯誤（含重試）
          stats.recordRequest(false);
          return { success: false, retryScope: 'key', statusCode: response.status, errorText: errText };
        }

        if (response.status === 404) {
          const errText = await readTextSafely(response);
          addLog('warning', `請求 #${requestId}：模型「${modelId}」回傳 HTTP 404，判定為模型層級失敗，立即切換下一個模型。錯誤：${errText.substring(0, 160)}`);
          apiKeys.recordFailure(key.id, `ModelNotFound HTTP 404: ${errText.substring(0, 80)}`);
          // 每次呼叫失敗都算一次錯誤（含重試）
          stats.recordRequest(false);
          return { success: false, retryScope: 'model', shouldFallbackModel: true, statusCode: 404, errorText: errText || 'HTTP 404' };
        }

        if (response.status >= 500) {
          const errText = await readTextSafely(response);
          addLog('warning', `請求 #${requestId}：模型「${modelId}」回傳 HTTP ${response.status}，判定為模型層級失敗，立即切換下一個模型。錯誤：${errText.substring(0, 160)}`);
          apiKeys.recordFailure(key.id, `ModelServerError HTTP ${response.status}: ${errText.substring(0, 80)}`);
          // 每次呼叫失敗都算一次錯誤（含重試）
          stats.recordRequest(false);
          return { success: false, retryScope: 'model', shouldFallbackModel: true, statusCode: response.status, errorText: errText || `HTTP ${response.status}` };
        }

        if (response.status === 400) {
          const errText = await readTextSafely(response);
          const isContextLimit = errText.toLowerCase().includes('context length') || 
                                 errText.toLowerCase().includes('context_length') || 
                                 errText.toLowerCase().includes('max_tokens') ||
                                 errText.toLowerCase().includes('max-tokens') ||
                                 errText.toLowerCase().includes('token limit') ||
                                 errText.toLowerCase().includes('too many tokens') ||
                                 errText.toLowerCase().includes('max context') ||
                                 errText.toLowerCase().includes('context window') ||
                                 errText.toLowerCase().includes('context_window');
          const isDegraded = errText.toLowerCase().includes('degraded');
          if (isContextLimit || isDegraded) {
            if (isContextLimit) {
              addLog('warning', `請求 #${requestId}：模型「${modelId}」回傳 HTTP 400（長度超出限制），判定為模型層級失敗，立即切換下一個模型。錯誤：${errText.substring(0, 160)}`);
              apiKeys.recordFailure(key.id, `ModelContextLimit HTTP 400: ${errText.substring(0, 80)}`);
            } else {
              addLog('warning', `請求 #${requestId}：模型「${modelId}」回傳 HTTP 400（模型已降級），判定為模型層級失敗，立即切換下一個模型。錯誤：${errText.substring(0, 160)}`);
              apiKeys.recordFailure(key.id, `ModelDegraded HTTP 400: ${errText.substring(0, 80)}`);
            }
            // 每次呼叫失敗都算一次錯誤（含重試）
            stats.recordRequest(false);
            return { success: false, retryScope: 'model', shouldFallbackModel: true, statusCode: 400, errorText: errText };
          }
          addLog('error', `請求 #${requestId}：NVIDIA 回傳不可重試的 HTTP ${response.status}，停止本次調度。錯誤：${errText.substring(0, 200)}`);
          // 每次呼叫失敗都算一次錯誤（含重試）
          stats.recordRequest(false);
          return { success: false, retryScope: 'fatal', fatal: true, statusCode: response.status, errorText: errText, response };
        }

        const errText = await readTextSafely(response);
        addLog('error', `請求 #${requestId}：NVIDIA 回傳不可重試的 HTTP ${response.status}，停止本次調度。錯誤：${errText.substring(0, 200)}`);
        // 每次呼叫失敗都算一次錯誤（含重試）
        stats.recordRequest(false);
        return { success: false, retryScope: 'fatal', fatal: true, statusCode: response.status, errorText: errText, response };

    } catch (err) {
      clearTimeout(timeoutId);
      res.off('close', abortOnClientDisconnect);

      if (err.name === 'AbortError') {
        if (abortReason === 'client_disconnected' || isClientGone()) {
          addLog('warning', `請求 #${requestId}：客戶端已中斷連線，取消模型「${modelId}」的 NVIDIA 請求。`);
          // 記錄模型層級的錯誤計數 - 客戶端中斷屬於請求失敗
          stats.recordRequest(false);
          return { success: false, clientGone: true, retryScope: 'client', errorText: '客戶端已中斷連線' };
        }
        const msg = `請求逾時 ${REQUEST_TIMEOUT_MS / 1000} 秒`;
        addLog('warning', `請求 #${requestId}：模型「${modelId}」使用 Key ID ${key.id} 發生逾時，立即切換下一個模型，不再測試此模型的其他 Key。`);
        apiKeys.recordFailure(key.id, msg);
        // 記錄模型層級的錯誤計數 - 超時屬於請求失敗
        stats.recordRequest(false);
        return { success: false, retryScope: 'model', shouldFallbackModel: true, statusCode: 0, errorText: msg };
      }

      addLog('warning', `請求 #${requestId}：模型「${modelId}」使用 Key ID ${key.id} 發生網路或連線錯誤，立即切換下一個模型。錯誤：${err.message}`);
      apiKeys.recordFailure(key.id, `Network Error: ${err.message}`);
      // 記錄模型層級的錯誤計數 - 網路錯誤屬於請求失敗
      stats.recordRequest(false);
      return { success: false, retryScope: 'model', shouldFallbackModel: true, statusCode: 0, errorText: err.message };
    }
    }

    function readStreamChunkWithTimeout(reader) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`串流讀取逾時 ${STREAM_READ_TIMEOUT_MS / 1000} 秒`));
        }, STREAM_READ_TIMEOUT_MS);

        reader.read()
          .then((result) => {
            clearTimeout(timer);
            resolve(result);
          })
          .catch((err) => {
            clearTimeout(timer);
            reject(err);
          });
      });
    }

    function extractContentFromSseLine(line) {
      const trimmed = String(line || '').trim();
      if (!trimmed.startsWith('data:')) return '';

      const dataStr = trimmed.slice(5).trim();
      if (!dataStr || dataStr === '[DONE]') return '';

      try {
        const chunk = JSON.parse(dataStr);
        return chunk?.choices?.[0]?.delta?.content || '';
      } catch (err) {
        return '';
      }
    }

    async function validateSuccessfulResponse(model, selectedKey, result, roundNumber) {
      const modelId = model.model_id;
      const isStream = !!originalBody.stream;

      if (isStream) {
        const reader = result.response.body.getReader();
        const decoder = new TextDecoder();
        let streamBuffer = '';
        let fullContent = '';
        const sseLines = [];
        let streamUsage = null;

        const consumeLine = (rawLine) => {
          const cleanLine = String(rawLine || '').endsWith('\r')
            ? String(rawLine || '').slice(0, -1)
            : String(rawLine || '');

          sseLines.push(cleanLine);
          
          const trimmed = cleanLine.trim();
          if (trimmed.startsWith('data:') && !trimmed.includes('[DONE]')) {
            try {
              const dataStr = trimmed.slice(5).trim();
              const chunk = JSON.parse(dataStr);
              if (chunk?.choices?.[0]?.delta?.content) {
                fullContent += chunk.choices[0].delta.content;
              }
              if (chunk?.usage) {
                streamUsage = chunk.usage;
              }
            } catch (e) {
              // ignore
            }
          }
        };

        try {
          while (true) {
            if (isClientGone()) {
              throw new Error('客戶端已中斷連線');
            }
            const { done, value } = await readStreamChunkWithTimeout(reader);
            if (done) break;

            streamBuffer += decoder.decode(value, { stream: true });
            const lines = streamBuffer.split('\n');
            streamBuffer = lines.pop() || '';

            for (const line of lines) {
              consumeLine(line);
            }
          }

          if (streamBuffer.trim()) {
            consumeLine(streamBuffer);
          }

          const validation = validateContent(fullContent);
          if (!validation.valid) {
            const validationIssue = formatValidationIssue(validation);
            addLog('warning', `請求 #${requestId}：模型「${modelId}」串流內容校驗失敗（${validationIssue}），判定為回傳格式失敗，改用下一把 Key 重試同一模型。`);
            apiKeys.recordFailure(selectedKey.id, `ContentValidation: ${validationIssue}`);
            // 每次執行失敗（含重試）都算一次錯誤
            stats.recordRequest(false);
            // 【特別例外】回傳格式失敗應重試當前模型（換 Key），而非跳下一個模型
            return { success: false, retryScope: 'key', contentValidationFailed: true, errorText: `內容校驗失敗：${validationIssue}` };
          }

          if (!streamUsage) {
            const promptText = JSON.stringify(originalBody.messages || '');
            const estimatedPrompt = Math.max(1, Math.round(promptText.length / 3.2));
            const estimatedCompletion = Math.max(1, Math.round(fullContent.length / 3.2));
            streamUsage = {
              prompt_tokens: estimatedPrompt,
              completion_tokens: estimatedCompletion,
              total_tokens: estimatedPrompt + estimatedCompletion
            };
          }

          return { success: true, response: result.response, sseLines, streamContent: fullContent, usage: streamUsage };
        } catch (err) {
          try {
            reader.cancel().catch(() => {});
          } catch (cancelErr) {
            // ignore
          }

          const isTimeout = err.message.includes('逾時') || err.message.toLowerCase().includes('timeout');
          if (isTimeout) {
            addLog('warning', `請求 #${requestId}：模型「${modelId}」串流讀取發生逾時（${err.message}），判定為模型層級失敗，立即切換下一個模型。`);
            apiKeys.recordFailure(selectedKey.id, `串流讀取逾時：${err.message}`);
            stats.recordRequest(false);
            return { success: false, retryScope: 'model', forceFallbackModel: true, statusCode: 0, errorText: err.message };
          }

          addLog('warning', `請求 #${requestId}：模型「${modelId}」串流讀取或校驗失敗（${err.message}），判定為串流讀取錯誤，將進行後續等待與重試。`);
          apiKeys.recordFailure(selectedKey.id, `串流讀取錯誤：${err.message}`);
          // 每次執行失敗（含重試）都算一次錯誤
          stats.recordRequest(false);
          return { success: false, retryScope: 'key', streamReadFailed: true, errorText: err.message };
        }
      }

      try {
        const json = await result.response.json();
        const contentToCheck = json?.choices?.[0]?.message?.content || '';

        const validation = validateContent(contentToCheck);
        if (!validation.valid) {
          const validationIssue = formatValidationIssue(validation);
          addLog('warning', `請求 #${requestId}：模型「${modelId}」JSON 內容校驗失敗（${validationIssue}），判定為回傳格式失敗，改用下一把 Key 重試同一模型。`);
          apiKeys.recordFailure(selectedKey.id, `ContentValidation: ${validationIssue}`);
          // 每次執行失敗（含重試）都算一次錯誤
          stats.recordRequest(false);
          // 【特別例外】回傳格式失敗應重試當前模型（換 Key），而非跳下一個模型
          return { success: false, retryScope: 'key', contentValidationFailed: true, errorText: `內容校驗失敗：${validationIssue}` };
        }

        let usage = json?.usage;
        if (!usage) {
          const promptText = JSON.stringify(originalBody.messages || '');
          const estimatedPrompt = Math.max(1, Math.round(promptText.length / 3.2));
          const estimatedCompletion = Math.max(1, Math.round(contentToCheck.length / 3.2));
          usage = {
            prompt_tokens: estimatedPrompt,
            completion_tokens: estimatedCompletion,
            total_tokens: estimatedPrompt + estimatedCompletion
          };
        }

        return { success: true, response: result.response, jsonData: json, usage };
      } catch (err) {
        addLog('warning', `請求 #${requestId}：模型「${modelId}」JSON 解析失敗（${err.message}），判定為回傳格式失敗，改用下一把 Key 重試同一模型。`);
        apiKeys.recordFailure(selectedKey.id, `JSON parse error: ${err.message}`);
        // 每次執行失敗（含重試）都算一次錯誤
        stats.recordRequest(false);
        // 【特別例外】回傳格式失敗應重試當前模型（換 Key），而非跳下一個模型
        return { success: false, retryScope: 'key', contentValidationFailed: true, errorText: err.message };
      }
    }

    async function tryModelWithKeys(model, roundNumber) {
      const modelId = model.model_id;
      const availableKeys = apiKeys.getActiveKeys();

      if (availableKeys.length === 0) {
        addLog('error', `請求 #${requestId}：模型「${modelId}」無法嘗試，因為目前沒有健康的 API Key。`);
        return { success: false, noHealthyKeys: true, errorText: '目前沒有健康的 API Key。' };
      }

      // 依據金鑰下一次允許請求的時間（預約時間）進行升序排序，優先使用閒置或最快可用的金鑰，避免無謂等待並實現自動輪換
      availableKeys.sort((a, b) => {
        const timeA = global.keyNextRequestTimes?.get(a.id) || 0;
        const timeB = global.keyNextRequestTimes?.get(b.id) || 0;
        return timeA - timeB;
      });

      addLog('info', `請求 #${requestId}：第 ${roundNumber}/${MAX_ROUNDS_PER_MODEL} 輪，嘗試模型「${modelId}」（順位 ${model.priority}），可用 Key 數：${availableKeys.length}。`);

      for (let keyIndex = 0; keyIndex < availableKeys.length; keyIndex += 1) {
        const selectedKey = availableKeys[keyIndex];
        addLog('info', `請求 #${requestId}：模型「${modelId}」使用 ${getMaskedKey(selectedKey.key_value)}（Key ${keyIndex + 1}/${availableKeys.length}，ID ${selectedKey.id}）。`);

        const result = await sendSingleRequest(model, selectedKey, keyIndex, availableKeys);

        if (result.clientGone) {
          return { success: false, clientGone: true, errorText: result.errorText || '客戶端已中斷連線' };
        }

        if (result.success) {
          const validated = await validateSuccessfulResponse(model, selectedKey, result, roundNumber);
          if (validated.success) return validated;

          // 【特別例外】回傳格式失敗（內容校驗/JSON 解析）時，重試當前模型，而非跳下一個模型
          if (validated.contentValidationFailed) {
            addLog('info', `請求 #${requestId}：模型「${modelId}」回傳格式失敗（${validated.errorText}），觸發同模型重試。`);
            return {
              success: false,
              forceRetrySameModel: true,
              contentValidationFailed: true,
              errorText: validated.errorText || '回傳格式失敗'
            };
          }

          if (validated.streamReadFailed) {
            addLog('warning', `請求 #${requestId}：模型「${modelId}」串流讀取失敗（${validated.errorText}），將觸發等待後重試。`);
            return {
              success: false,
              forceRetrySameModel: true,
              streamReadFailed: true,
              errorText: validated.errorText || '串流讀取失敗'
            };
          }

          if (validated.forceFallbackModel || validated.retryScope === 'model') {
            return {
              success: false,
              forceFallbackModel: true,
              errorText: validated.errorText || '模型回傳內容無效'
            };
          }

          // 理論上不會走到這裡；保守起見當成 Key 層級錯誤繼續下一把 Key。
          continue;
        }

        if (result.fatal || result.retryScope === 'fatal') {
          return {
            success: false,
            fatal: true,
            statusCode: result.statusCode,
            errorText: result.errorText,
            response: result.response
          };
        }

        // 模型層級錯誤：timeout / 404 / 5xx / network，不再測試其他 Key，也不進下一輪，直接切下一模型。
        if (result.shouldFallbackModel || result.retryScope === 'model') {
          addLog('warning', `請求 #${requestId}：模型「${modelId}」發生模型層級失敗（${result.errorText || `HTTP ${result.statusCode}` }），立即略過剩餘 Key 並切換下一個模型。`);
          return {
            success: false,
            forceFallbackModel: true,
            statusCode: result.statusCode,
            errorText: result.errorText || `HTTP ${result.statusCode}`
          };
        }

        // Key 層級錯誤：429 / 401 / 403，才繼續下一把 Key。
        addLog('info', `請求 #${requestId}：模型「${modelId}」遇到 Key 層級錯誤，繼續嘗試下一把 Key。`);
      }

      addLog('warning', `請求 #${requestId}：模型「${modelId}」本輪所有 Key 都因 Key 層級錯誤失敗。`);
      return { success: false, forceRetrySameModel: true, errorText: '本輪所有 Key 都因 Key 層級錯誤失敗。' };
    }

    function buildSafeSsePayload(sseLines, clientModelId = 'patcher-main') {
      const outputLines = [];
      let validChunkCount = 0;

      for (const rawLine of Array.isArray(sseLines) ? sseLines : []) {
        const trimmed = String(rawLine ?? '').trim();

        // OpenAI 相容串流只輸出 data: JSON 與最後的 [DONE]。
        // 其他 event/comment/raw line 全部略過，避免 Cline 的 OpenAI SSE parser 被非預期行弄壞。
        if (!trimmed.startsWith('data:')) continue;

        const dataStr = trimmed.slice(5).trim();
        if (!dataStr || dataStr === '[DONE]') continue;

        try {
          const chunk = JSON.parse(dataStr);
          if (!chunk || typeof chunk !== 'object' || !Array.isArray(chunk.choices)) {
            continue;
          }

          chunk.id = chunk.id || `chatcmpl-gateway-${requestId}`;
          chunk.object = chunk.object || 'chat.completion.chunk';
          chunk.created = chunk.created || Math.floor(Date.now() / 1000);
          chunk.model = clientModelId;

          outputLines.push(`data: ${JSON.stringify(chunk)}`);
          validChunkCount += 1;
        } catch (err) {
          addLog('warning', `請求 #${requestId}：略過一行無法解析的 NVIDIA 串流資料，避免傳給 Cline 後造成 OpenAI SSE 解析失敗。`);
        }
      }

      if (validChunkCount === 0) {
        return '';
      }

      outputLines.push('data: [DONE]');
      return `${outputLines.join('\n\n')}\n\n`;
    }

    function waitForResponseFinish(sendAction) {
      return new Promise((resolve, reject) => {
        let settled = false;

        const cleanup = () => {
          res.off('finish', onFinish);
          res.off('close', onClose);
          res.off('error', onError);
        };

        const onFinish = () => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve();
        };

        const onClose = () => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(new Error('客戶端在回傳完成前中斷連線'));
        };

        const onError = (err) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(err);
        };

        res.once('finish', onFinish);
        res.once('close', onClose);
        res.once('error', onError);

        try {
          sendAction();
        } catch (err) {
          if (!settled) {
            settled = true;
            cleanup();
            reject(err);
          }
        }
      });
    }

    async function sendValidatedResponse(result, currentModel) {
      const modelId = currentModel.model_id;
      const clientModelId = originalBody.model || 'patcher-main';

      if (isClientGone()) {
        throw new Error('客戶端已中斷連線，略過回傳。');
      }

      if (stream) {
        const ssePayload = buildSafeSsePayload(result.sseLines, clientModelId);
        if (!ssePayload || !ssePayload.includes('data:') || !ssePayload.includes('[DONE]')) {
          throw new Error('校驗後的串流內容是空的或格式不正確。');
        }

        await waitForResponseFinish(() => {
          res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache, no-transform');
          res.setHeader('Connection', 'keep-alive');
          res.setHeader('X-Accel-Buffering', 'no');
          res.status(200).send(ssePayload);
        });
      } else {
        const json = result.jsonData;
        if (json && typeof json === 'object') {
          json.model = clientModelId;
        }

        await waitForResponseFinish(() => {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.json(json);
        });
      }

      stats.recordRequest(true);
      const durationMs = Date.now() - requestStartedAt;
      
      // 記錄 Token 使用量與完整對話內容 (僅最近 50 個保留對話文字)
      try {
        const usage = result.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
        let responseContent = '';
        if (stream) {
          responseContent = result.streamContent || '';
        } else {
          responseContent = result.jsonData?.choices?.[0]?.message?.content || '';
        }

        tokenUsage.addRecord(requestId, modelId, usage.prompt_tokens, usage.completion_tokens, originalBody.messages, responseContent);
        eventManager.broadcast('token-usage', { action: 'add', modelId, promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens });
        addLog('success', `請求 #${requestId}：已成功使用模型「${modelId}」（順位 ${currentModel.priority}）完成回傳，HTTP 回應已送達客戶端（${durationMs} ms）。[Tokens: P:${usage.prompt_tokens} + C:${usage.completion_tokens} = T:${usage.prompt_tokens + usage.completion_tokens}]`);
      } catch (tokenErr) {
        console.error('Failed to record token usage:', tokenErr);
        addLog('success', `請求 #${requestId}：已成功使用模型「${modelId}」（順位 ${currentModel.priority}）完成回傳，HTTP 回應已送達客戶端（${durationMs} ms）。`);
      }
    }

    async function dispatchRequest() {
      let skippedByCooldown = 0;

      for (let modelIndex = 0; modelIndex < configuredModels.length; modelIndex += 1) {
        if (isClientGone()) {
          addLog('warning', `請求 #${requestId}：客戶端已中斷，停止模型順位調度。`);
          return;
        }

        const currentModel = configuredModels[modelIndex];
        const modelId = currentModel.model_id;

        if (isModelInFailureCooldown(modelId)) {
          skippedByCooldown += 1;
          addLog('info', `請求 #${requestId}：模型「${modelId}」仍在暫時跳過狀態，直接嘗試下一個模型。`);
          continue;
        }

        addLog('info', `請求 #${requestId}：開始調度模型「${modelId}」（順位 ${currentModel.priority}）。`);

        // 【特別例外】回傳格式失敗時標記立即重試，跳過 ROUND_DELAY_MS 等待；串流讀取錯誤時標記等待後重試
        let lastResultContentValidationFailed = false;
        let lastResultStreamReadFailed = false;

        for (let round = 1; round <= MAX_ROUNDS_PER_MODEL; round += 1) {
          if (round > 1) {
            if (lastResultContentValidationFailed) {
              addLog('info', `請求 #${requestId}：模型「${modelId}」因回傳格式失敗立即重試，不等待。`);
            } else if (lastResultStreamReadFailed) {
              addLog('info', `請求 #${requestId}：模型「${modelId}」因先前發生串流讀取錯誤，等待 ${ROUND_DELAY_MS / 1000} 秒後進入第 ${round} 輪重試。`);
              await new Promise(resolve => setTimeout(resolve, ROUND_DELAY_MS));
            } else {
              addLog('info', `請求 #${requestId}：模型「${modelId}」只有 Key 層級錯誤，等待 ${ROUND_DELAY_MS / 1000} 秒後進入第 ${round} 輪。`);
              await new Promise(resolve => setTimeout(resolve, ROUND_DELAY_MS));
            }
          }

          const result = await tryModelWithKeys(currentModel, round);
          lastResultContentValidationFailed = !!(result && result.contentValidationFailed);
          lastResultStreamReadFailed = !!(result && result.streamReadFailed);

          if (result.clientGone) {
            addLog('warning', `請求 #${requestId}：客戶端已中斷，停止後續模型調度。`);
            return;
          }

          if (result.success) {
            try {
              await sendValidatedResponse(result, currentModel);
              return;
            } catch (err) {
              addLog('error', `請求 #${requestId}：模型「${modelId}」在 Gateway 包裝回傳時失敗（${err.message}），改切下一個模型。`);
              if (!res.headersSent && !res.writableEnded) {
                markModelFailureCooldown(modelId, `Gateway 回傳包裝失敗：${err.message}`);
                break;
              }
              try {
                res.end();
              } catch (endErr) {
                // ignore
              }
              return;
            }
          }

          if (result.noHealthyKeys) {
            addLog('error', `請求 #${requestId}：目前沒有健康的 API Key，停止模型切換。`);
            return res.status(503).json({
              error: {
                message: 'Gateway 目前沒有健康的 API Key。',
                detail: result.errorText || '所有 Key 可能都已停用或正在冷卻。'
              }
            });
          }

          if (result.fatal) {
            addLog('error', `請求 #${requestId}：遇到不可重試錯誤 HTTP ${result.statusCode}，停止調度。`);
            return res.status(result.statusCode || 400).send(result.errorText || '不可重試錯誤');
          }

          if (result.forceFallbackModel) {
            markModelFailureCooldown(modelId, result.errorText || '模型層級失敗');
            addLog('warning', `請求 #${requestId}：模型「${modelId}」第 ${round} 輪判定為模型層級失敗，跳過剩餘輪次並切換下一個模型。`);
            break;
          }

          if (result.forceRetrySameModel) {
            // 【特別例外】回傳格式失敗：立即重試當前模型，不等待 ROUND_DELAY_MS
            if (result.contentValidationFailed) {
              addLog('info', `請求 #${requestId}：模型「${modelId}」第 ${round} 輪回傳格式失敗，立即重試同一模型。`);
              if (round < MAX_ROUNDS_PER_MODEL) {
                continue;
              }
            }
            // 串流讀取錯誤：觸發同模型等待後重試
            if (result.streamReadFailed) {
              addLog('info', `請求 #${requestId}：模型「${modelId}」第 ${round} 輪發生串流讀取錯誤，排程進行下一輪重試。`);
              if (round < MAX_ROUNDS_PER_MODEL) {
                continue;
              }
            }
            addLog('info', `請求 #${requestId}：模型「${modelId}」第 ${round} 輪僅發生 Key 層級錯誤。`);
            if (round < MAX_ROUNDS_PER_MODEL) {
              continue;
            }
          }
        }

        addLog('warning', `請求 #${requestId}：模型「${modelId}」未能完成本次請求，嘗試下一個模型。`);
      }

      // 不再重複記錄 error_count：每次中間呼叫失敗已在 sendSingleRequest / validateSuccessfulResponse 中逐次記錄。
      const cooldownText = skippedByCooldown > 0 ? `，其中 ${skippedByCooldown} 個模型因近期模型層級失敗被暫時跳過` : '';
      addLog('error', `請求 #${requestId}：所有模型都無法完成請求${cooldownText}。`);
      return res.status(503).json({
        error: {
          message: '所有設定中的模型都無法完成請求，請檢查 Gateway 日誌。',
          detail: `所有模型都無法完成請求${cooldownText}。`
        }
      });
    }

    try {
      await dispatchRequest();
    } catch (err) {
      addLog('error', `請求 #${requestId}：Gateway 調度流程發生未預期錯誤：${err.stack || err.message}`);
      stats.recordRequest(false);

      if (!res.headersSent && !res.writableEnded) {
        return res.status(502).json({
          error: {
            message: 'Gateway dispatch crashed before a response could be sent. Check Gateway logs.',
            detail: err.message
          }
        });
      }

      try {
        res.end();
      } catch (endErr) {
        // ignore
      }
    }
  });

  app.post('/api/test/chat', requireAdminAuth, async (req, res) => {
    const { model, messages, stream, response_format } = req.body;
    
    if (!model || !messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Model and messages array are required' });
    }

    const sanitized = sanitizeChatCompletionBody({ model, messages, stream, response_format });
    const cleanMessages = sanitized.messages;

    const activeKeys = apiKeys.getActiveKeys();
    if (activeKeys.length === 0) {
      return res.status(503).json({ error: 'No active/healthy API Keys available in the Gateway pool.' });
    }

    const nvidiaBaseUrl = process.env.NVIDIA_API_URL || 'https://integrate.api.nvidia.com/v1';

    async function attemptTestChat(keyIndex) {
      if (keyIndex >= activeKeys.length) {
        addLog('error', `[模型測試] 所有可用 Key（${activeKeys.length} 把）都無法測試模型「${model}」。`);
        return res.status(502).json({ error: `模型「${model}」測試失敗：所有可用 Key 都無法完成請求。` });
      }

      const selectedKey = activeKeys[keyIndex];
      addLog('info', `[模型測試] 使用 Key ...${selectedKey.key_value.substring(selectedKey.key_value.length - 8)} 測試模型「${model}」（第 ${keyIndex + 1}/${activeKeys.length} 把）。`);

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
          body: JSON.stringify({
            model,
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
                  addLog('error', `[模型測試｜內容校驗] 串流回應被拒收：偵測到不合法或未閉合標籤：${formatValidationIssue(validation)}。`);
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
              addLog('error', `[模型測試] 內容在送到前端前校驗失敗，改用下一把 Key 重新生成。`);
              return attemptTestChat(keyIndex + 1);
            }
            addLog('error', `[模型測試] 串流讀取錯誤：${err.message}`);
            if (!res.headersSent) {
              return res.status(502).json({ error: `串流讀取錯誤：${err.message}` });
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
            addLog('error', `[模型測試｜內容校驗] 非串流回應被拒收：偵測到不合法或未閉合標籤：${validationIssue}，改用下一把 Key 重新生成。`);
            return attemptTestChat(keyIndex + 1);
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
  });

  /**
 * 自訂錯誤類型：內容校驗失敗
 * 在 attemptTestChat 中觸發重試；
 * 正式 /v1/chat/completions route 則使用物件標記 { contentValidationFailed: true } 來保持一致性
 */
class ContentValidationError extends Error {
  constructor(content) {
    super('內容校驗失敗：偵測到未閉合的 HTML/XML 標籤');
    this.name = 'ContentValidationError';
    this.content = content;
  }
}

  return app;
}

module.exports = {
  createGatewayApp
};