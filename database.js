const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

let db = null;

const { getTaiwanDateParts, getTaiwanISOString, getTaiwanHourString } = require('./utils/date');


function ensureModelsConfigSchema() {
  const tableInfo = db.prepare("PRAGMA table_info(models_config)").all();
  const hasGroupId = tableInfo.some(col => col.name === 'group_id');
  const tableRow = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'models_config'").get();
  const tableSql = tableRow && tableRow.sql ? tableRow.sql : '';
  const hasLegacyUniqueModelId = /model_id\s+TEXT\s+UNIQUE/i.test(tableSql);
  const hasGroupUnique = /UNIQUE\s*\(\s*group_id\s*,\s*model_id\s*\)/i.test(tableSql);

  if (!hasGroupId || hasLegacyUniqueModelId || !hasGroupUnique) {
    console.log('Migrating models_config table to grouped priority schema...');
    const rows = hasGroupId
      ? db.prepare("SELECT group_id, model_id, priority, is_active FROM models_config ORDER BY group_id ASC, priority ASC").all()
      : db.prepare("SELECT 1 AS group_id, model_id, priority, is_active FROM models_config ORDER BY priority ASC").all();

    db.exec("DROP TABLE IF EXISTS models_config_new");
    db.exec(`
      CREATE TABLE models_config_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER DEFAULT 1,
        model_id TEXT NOT NULL,
        priority INTEGER NOT NULL,
        is_active INTEGER DEFAULT 1,
        UNIQUE(group_id, model_id)
      )
    `);

    const insert = db.prepare("INSERT OR IGNORE INTO models_config_new (group_id, model_id, priority, is_active) VALUES (?, ?, ?, ?)");
    const priorityByGroup = new Map();
    rows.forEach((row) => {
      const groupId = normalizeModelGroupId(row.group_id || 1);
      const nextPriority = (priorityByGroup.get(groupId) || 0) + 1;
      priorityByGroup.set(groupId, nextPriority);
      insert.run(groupId, row.model_id, nextPriority, row.is_active === 0 ? 0 : 1);
    });

    db.exec(`
      DROP TABLE models_config;
      ALTER TABLE models_config_new RENAME TO models_config;
    `);
  }

  db.prepare("INSERT OR IGNORE INTO metadata (key, value) VALUES ('active_model_group', '1')").run();
}

function normalizeModelGroupId(groupId) {
  const parsed = Number.parseInt(groupId, 10);
  if ([1, 2, 3].includes(parsed)) return parsed;
  return 1;
}


const NVIDIA_BUILD_FREE_ENDPOINT_URL = 'https://build.nvidia.com/models?filters=nimType%3Anim_type_preview';
const NVIDIA_FEATURED_MODELS_URL = 'https://assets.ngc.nvidia.com/products/api-catalog/featured-models.json';

function decodeHtmlEntities(value) {
  if (!value || typeof value !== 'string') return '';
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\\u002[fF]/g, '/')
    .replace(/\\\//g, '/');
}

function stripHtml(value) {
  return decodeHtmlEntities(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractExpectedFreeEndpointCount(html) {
  const text = stripHtml(html);
  const filtersCount = text.match(/Filters\s*\(?\s*1\s*\)?\s*(\d+)\s*models/i);
  if (filtersCount) return Number(filtersCount[1]);

  const freeEndpointCount = text.match(/Free\s+Endpoint\s+(\d+)/i);
  if (freeEndpointCount) return Number(freeEndpointCount[1]);

  return null;
}

function normalizeBuildModelId(provider, slug) {
  const cleanedProvider = decodeURIComponent(String(provider || '').trim()).replace(/^\/+|\/+$/g, '');
  const cleanedSlug = decodeURIComponent(String(slug || '').trim()).replace(/^\/+|\/+$/g, '');
  if (!cleanedProvider || !cleanedSlug) return null;

  const blockedFirstSegments = new Set([
    'api', '_next', 'assets', 'docs', 'explore', 'models', 'skills', 'blueprints',
    'terms', 'privacy', 'contact', 'login', 'search', 'favicon.ico'
  ]);
  if (blockedFirstSegments.has(cleanedProvider.toLowerCase())) return null;
  if (cleanedSlug.includes('.') && !cleanedSlug.includes('-')) return null;

  return `${cleanedProvider}/${cleanedSlug}`;
}

function extractBuildFreeEndpointModelsFromHtml(html) {
  const normalizedHtml = decodeHtmlEntities(html);
  const models = new Map();

  const addModel = (modelId, name = null, created = 0) => {
    if (!modelId || typeof modelId !== 'string') return;
    const cleanedModelId = modelId.trim().replace(/^\/+|\/+$/g, '');
    if (!/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(cleanedModelId)) return;
    if (!models.has(cleanedModelId)) {
      models.set(cleanedModelId, {
        id: cleanedModelId,
        name: name || cleanedModelId.split('/').pop(),
        created: Number.isFinite(Number(created)) ? Number(created) : 0
      });
    }
  };

  // 1. 從模型卡片連結擷取完整路徑，例如 /minimaxai/minimax-m3
  const hrefRegex = /href\s*=\s*["'](?:https:\/\/build\.nvidia\.com)?\/([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)(?:[?#][^"']*)?["']/g;
  let hrefMatch;
  while ((hrefMatch = hrefRegex.exec(normalizedHtml)) !== null) {
    const modelId = normalizeBuildModelId(hrefMatch[1], hrefMatch[2]);
    addModel(modelId);
  }

  // 2. 從 Next/JSON 片段或範例程式碼擷取 model 欄位
  const jsonModelRegex = /["']model["']\s*:\s*["']([a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+)["']/g;
  let jsonMatch;
  while ((jsonMatch = jsonModelRegex.exec(normalizedHtml)) !== null) {
    addModel(jsonMatch[1]);
  }

  // 3. 從一般文字中的 build.nvidia.com/provider/model URL 擷取
  const absoluteUrlRegex = /https:\/\/build\.nvidia\.com\/([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)/g;
  let absoluteMatch;
  while ((absoluteMatch = absoluteUrlRegex.exec(normalizedHtml)) !== null) {
    const modelId = normalizeBuildModelId(absoluteMatch[1], absoluteMatch[2]);
    addModel(modelId);
  }

  return Array.from(models.values());
}

function buildNvidiaCatalogCandidateUrls(pageNumber) {
  const encodedFilter = 'filters=nimType%3Anim_type_preview';
  const base = `https://build.nvidia.com/models?${encodedFilter}`;

  if (pageNumber === 1) {
    return [
      `${base}&itemsPerPage=100`,
      `${base}&pageSize=100`,
      `${base}&limit=100`,
      base,
      `${base}&page=1`,
      `${base}&pageNumber=1`,
      `${base}&p=1`
    ];
  }

  const offset = (pageNumber - 1) * 24;
  return [
    `${base}&page=${pageNumber}`,
    `${base}&pageNumber=${pageNumber}`,
    `${base}&p=${pageNumber}`,
    `${base}&page=${pageNumber}&itemsPerPage=24`,
    `${base}&pageNumber=${pageNumber}&itemsPerPage=24`,
    `${base}&limit=24&offset=${offset}`,
    `${base}&offset=${offset}`
  ];
}

async function fetchTextWithTimeout(url, options = {}, timeoutMs = 25000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Accept': 'text/html,application/json;q=0.9,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) NVIDIA-NIM-Gateway/1.0',
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text.substring(0, 200)}`);
    }
    return text;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchNvidiaBuildFreeEndpointCatalog() {
  const collected = new Map();
  const visitedSignatures = new Set();
  let expectedCount = null;
  let lastError = null;
  const MAX_PAGES = 5;
  const MAX_CONSECUTIVE_FAILURES = 3;
  let consecutiveFailures = 0;
  let successfulUrlPattern = null;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    let bestCandidate = null;
    let candidateUrls;

    if (page === 1 || !successfulUrlPattern) {
      candidateUrls = buildNvidiaCatalogCandidateUrls(page);
    } else {
      candidateUrls = [successfulUrlPattern.replace(/page=\d+|pageNumber=\d+|p=\d+/g, (match) => {
        const paramName = match.split('=')[0];
        return `${paramName}=${page}`;
      })];
    }

    for (const url of candidateUrls) {
      try {
        const html = await fetchTextWithTimeout(url);
        const parsedModels = extractBuildFreeEndpointModelsFromHtml(html);
        const pageExpectedCount = extractExpectedFreeEndpointCount(html);
        if (pageExpectedCount) expectedCount = pageExpectedCount;

        const signature = parsedModels.map(m => m.id).sort().join('|');
        const newModels = parsedModels.filter(m => !collected.has(m.id));

        if (!bestCandidate || newModels.length > bestCandidate.newModels.length) {
          bestCandidate = { url, parsedModels, newModels, signature };
        }

        if (expectedCount && parsedModels.length >= expectedCount) {
          bestCandidate = { url, parsedModels, newModels: parsedModels.filter(m => !collected.has(m.id)), signature };
          break;
        }
      } catch (err) {
        lastError = err;
      }

      if (page > 1 && successfulUrlPattern) break;

      if (candidateUrls.indexOf(url) < candidateUrls.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    if (!bestCandidate || bestCandidate.parsedModels.length === 0) {
      consecutiveFailures += 1;
      if (page === 1 && consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        throw lastError || new Error('Unable to parse NVIDIA Build Free Endpoint catalog after multiple attempts.');
      }
      if (page === 1) {
        continue;
      }
      break;
    }

    consecutiveFailures = 0;

    if (!successfulUrlPattern && page === 1) {
      successfulUrlPattern = bestCandidate.url;
    }

    if (visitedSignatures.has(bestCandidate.signature) && bestCandidate.newModels.length === 0) {
      break;
    }
    visitedSignatures.add(bestCandidate.signature);

    bestCandidate.parsedModels.forEach((model) => {
      if (!collected.has(model.id)) collected.set(model.id, model);
    });

    if (expectedCount && collected.size >= expectedCount) break;
    if (bestCandidate.newModels.length === 0 && page > 1) break;

    if (page < MAX_PAGES) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  if (collected.size === 0) {
    throw lastError || new Error('No Free Endpoint models found from NVIDIA Build catalog.');
  }

  return {
    models: Array.from(collected.values()).sort((a, b) => a.id.localeCompare(b.id)),
    expectedCount,
    source: NVIDIA_BUILD_FREE_ENDPOINT_URL
  };
}

async function fetchNvidiaFeaturedModelsCatalog() {
  const text = await fetchTextWithTimeout(NVIDIA_FEATURED_MODELS_URL, {}, 20000);
  const data = JSON.parse(text);
  const entries = Array.isArray(data) ? data : (Array.isArray(data.data) ? data.data : []);
  const models = [];
  const seen = new Set();

  entries.forEach((entry) => {
    const modelId = entry.model || entry.id || entry.name;
    if (!modelId || seen.has(modelId)) return;
    seen.add(modelId);
    models.push({
      id: modelId,
      name: entry['model-name'] || entry.name || modelId.split('/').pop(),
      created: 0
    });
  });

  return {
    models,
    expectedCount: null,
    source: NVIDIA_FEATURED_MODELS_URL
  };
}

function initDatabase(dbPath) {
  if (db) return db;

  const targetPath = dbPath || path.join(process.cwd(), 'gateway.db');
  console.log(`Initializing SQLite database at: ${targetPath}`);
  
  db = new DatabaseSync(targetPath);

  // 1. 建立 api_keys 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_value TEXT UNIQUE NOT NULL,
      status TEXT DEFAULT 'active', -- active, cooldown, inactive
      consecutive_failures INTEGER DEFAULT 0,
      total_errors INTEGER DEFAULT 0,
      last_used_at TEXT,
      cooldown_until TEXT,
      last_error_message TEXT
    )
  `);

  // 2. 建立 models_config 表
  // group_id 用於保存三組模型順位設定，使用者可在 UI 直接切換目前啟用組別
  db.exec(`
    CREATE TABLE IF NOT EXISTS models_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER DEFAULT 1, -- 1~3 = 三組可切換的模型順位設定
      model_id TEXT NOT NULL,
      priority INTEGER NOT NULL, -- 1 = primary, 2 = fallback-1, 3 = fallback-2 ...
      is_active INTEGER DEFAULT 1,
      UNIQUE(group_id, model_id)
    )
  `);

  // 3. 建立 available_models 表 (NVIDIA 同步過來的模型)
  db.exec(`
    CREATE TABLE IF NOT EXISTS available_models (
      id TEXT PRIMARY KEY,
      name TEXT,
      created INTEGER
    )
  `);

  // 4. 建立 rules 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      is_preset INTEGER DEFAULT 0
    )
  `);

  // 5. 建立 stats 表 (每小時彙整)
  db.exec(`
    CREATE TABLE IF NOT EXISTS stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hour TEXT UNIQUE NOT NULL, -- Format: YYYY-MM-DD HH:00
      request_count INTEGER DEFAULT 0,
      success_count INTEGER DEFAULT 0,
      error_count INTEGER DEFAULT 0
    )
  `);

  // 6. 建立 metadata 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  // 7. 建立 token_usage 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS token_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT,
      timestamp TEXT NOT NULL,
      model_id TEXT NOT NULL,
      prompt_tokens INTEGER DEFAULT 0,
      completion_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      request_body TEXT DEFAULT '',
      response_content TEXT DEFAULT ''
    )
  `);

  // 7.1 確保舊表缺少 request_body 或 response_content 欄位時自動補上
  try {
    const tokenUsageCols = db.prepare("PRAGMA table_info(token_usage)").all();
    if (!tokenUsageCols.some(c => c.name === 'request_body')) {
      db.exec("ALTER TABLE token_usage ADD COLUMN request_body TEXT DEFAULT ''");
    }
    if (!tokenUsageCols.some(c => c.name === 'response_content')) {
      db.exec("ALTER TABLE token_usage ADD COLUMN response_content TEXT DEFAULT ''");
    }
  } catch (_) { /* ignore */ }

  // 確保初始設定參數存在於 metadata 中
  db.prepare("INSERT OR IGNORE INTO metadata (key, value) VALUES ('ROUND_DELAY_MS', '15000')").run();
  db.prepare("INSERT OR IGNORE INTO metadata (key, value) VALUES ('REQUEST_TIMEOUT_MS', '120000')").run();
  db.prepare("INSERT OR IGNORE INTO metadata (key, value) VALUES ('STREAM_READ_TIMEOUT_MS', '120000')").run();
  db.prepare("INSERT OR IGNORE INTO metadata (key, value) VALUES ('NVIDIA_API_URL', 'https://integrate.api.nvidia.com/v1')").run();
  db.prepare("INSERT OR IGNORE INTO metadata (key, value) VALUES ('PORT', '4000')").run();
  db.prepare("INSERT OR IGNORE INTO metadata (key, value) VALUES ('MAX_ROUNDS_PER_MODEL', '2')").run();
  db.prepare("INSERT OR IGNORE INTO metadata (key, value) VALUES ('TEST_TIMEOUT_MS', '60000')").run();
  db.prepare("INSERT OR IGNORE INTO metadata (key, value) VALUES ('MODEL_FAILURE_COOLDOWN_MS', '60000')").run();
  db.prepare("INSERT OR IGNORE INTO metadata (key, value) VALUES ('KEY_CONCURRENCY_DELAY_MS', '5000')").run();
  db.prepare("INSERT OR IGNORE INTO metadata (key, value) VALUES ('PRICE_PER_MILLION_PROMPT_TOKENS', '0.30')").run();
  db.prepare("INSERT OR IGNORE INTO metadata (key, value) VALUES ('PRICE_PER_MILLION_COMPLETION_TOKENS', '0.60')").run();
  db.prepare("INSERT OR IGNORE INTO metadata (key, value) VALUES ('CURRENCY_SYMBOL', 'USD')").run();
  db.prepare("INSERT OR IGNORE INTO metadata (key, value) VALUES ('REF_PRICE_PER_MILLION_PROMPT_TOKENS', '5.00')").run();
  db.prepare("INSERT OR IGNORE INTO metadata (key, value) VALUES ('REF_PRICE_PER_MILLION_COMPLETION_TOKENS', '15.00')").run();

  // 確保舊版資料庫可平滑升級到三組模型順位 schema
  ensureModelsConfigSchema();

  // 插入預設 Rules
  insertPresetRules();

  return db;
}

function insertPresetRules() {
  // 每次啟動皆清理並重新載入最新的 preset 規則，以確保規範內容與程式碼同步
  const presets = [
    {
      title: "Git Commit 與開發工作流規範",
      content: `請優先掃描並分析整個專案中更新或新增的檔案內容與變更差異（diff）。

你是一位嚴謹的開發協作者。
任務: 根據實際變更內容，撰寫簡短、精確、可追溯的 Commit 訊息，並確保每個 commit 只包含同一目的的變更。

Commit 訊息格式：
1. 標題使用「【新增】、【調整】、【修改】、【重構】、【修復】、【文件】、【測試】」分類。
2. 標題格式為：【分類】具體變更主題。
3. 細項說明使用「-」開頭，描述實際完成的變更。
4. 避免模糊描述，例如「更新一些東西」、「修一下」、「調整功能」。
5. 若變更目的不同，可建議拆成多次 commit。

Commit 範例(多組commit被要求合併的話，訊息用雙換行整組疊加的方式)：
【修復】表單驗證錯誤
-修正驗證條件判斷
-避免錯誤輸入通過驗證

【調整】按鈕 hover 樣式
-優化 hover 狀態的視覺回饋
-調整互動動畫與陰影效果

Git 操作與精確暫存規範(可撰寫python檔案輔助精確commit)：
1. 一律使用繁體中文 zh-TW 回覆。
2. 產生 commit 訊息前，優先參考專案既有 commit message 寫法。
3. 未追蹤檔案不可任意加入 commit，必須先提醒使用者確認。
4. 一個 commit 只處理一個清楚目的；不同目的的變更必須分批 commit。
5. 同一檔案內若包含不同目的的變更，必須使用 "git add -p <file>" 精確暫存，不可直接整檔加入。
6. 若同一個 hunk 混有不同目的的變更，必須使用 split hunk 或 manual edit hunk 拆分。
7. 禁止使用 "git add ." 混入不相關變更。
8. 所有 diff 檢查指令都必須加上 "--no-pager"。
9. 每次 commit 前，必須用 "git --no-pager diff --cached" 確認 staging area 只包含本次 commit 需要的內容。
10. 若暫存內容混入不相關檔案或行數，必須先取消暫存並重新精確加入。
11. 使用者未明確要求執行 commit 時，禁止直接 commit，只能提供建議 commit message。

同檔案分段 commit 範例：
若 A 檔案中：
* 第 1-10 行：修復表單驗證
* 第 12-15 行：調整按鈕樣式

不可使用：
"git add A檔案"

正確流程：
"""bash
git --no-pager diff A檔案
git add -p A檔案
git --no-pager diff --cached
git commit -m "【修復】表單驗證錯誤"
git add -p A檔案
git --no-pager diff --cached
git commit -m "【調整】按鈕 hover 樣式"
"""`
    },
    {
      title: "UI/UX 設計原則",
      content: `你是一位專業 UI/UX Design Engineer 與 Frontend Architect。你的目標不是單純製作漂亮介面，而是在「可用性、可維護性、效能、可訪問性、一致性」之間取得最佳平衡。

【核心 UI/UX 設計與模組化規範】
1. 元件模組化拆分：元件設計與生成必須依據功能分類拆分成獨立的檔案與方程式（Function/Component），嚴禁將所有邏輯與介面堆積在單一檔案內。保持單一檔案簡短清晰（建議單一檔案控制在 250 行內），避免單一檔案過大，提高可讀性與可維護性。
2. User Experience First：設計決策優先順序：(1) 使用者理解成本 | (2) 操作效率 | (3) 資訊清晰度 | (4) 可訪問性 | (5) 視覺品質 | (6) 動畫效果。
3. Design System First：修改 UI 前優先尋找並沿用既有 Design Tokens (Colors, Typography, Spacing, Radius, Shadows, Motion) 與 CSS 變數，禁止建立孤立樣式。
4. Interaction Design & Micro Animation：所有互動元素必須提供 Hover、Active、Focus、Disabled 狀態與微小的互動動畫（150ms ~ 300ms 漸變效果），提供良好回饋。
5. Accessibility (無障礙支援)：遵循 WCAG AA 規範，確保 Keyboard Navigation 可用 (Tab, Enter, Escape)，提供適當 Contrast。
6. Responsive Design (響應式適配)：採用 Mobile First，確保在各尺寸螢幕（Mobile/Tablet/Desktop/Short Height）下均不溢出。當左側選單/高度過矮時，必須使用滾動條 (overflow-y: auto) 避免底部按鈕被遮蓋。`
    },
        {
      title: "精準錯誤 定位診斷",
      content: `你是一位資深系統除錯專家（Senior Debugging Specialist）。你的唯一目標是**找出錯誤的根本原因（Root Cause）與精確位置**，此階段「**嚴禁進行任何程式碼修改或提供修復代碼**」。

請依照下列步驟與規範執行：

## 【執行步驟與分析流程】
1. **讀取與搜集資訊**：仔細檢視使用者提供的錯誤堆疊（Stack Trace）、系統日誌（Logs）或異常行為描述。主動查找或要求讀取涉及的原始碼檔案。
2. **追蹤資料流向 (Data Flow)**：從輸入端、函數呼叫起點，一步步追蹤變數狀態與資料結構的變化，確認是在哪一個節點、哪一個變數發生預期之外的變異（例如空值、型態錯誤、編碼 CP950 衝突等）。
3. **定位受影響程式碼**：精確鎖定發生問題的**檔案路徑、函數名稱及具體程式碼行數範圍**，並對該行程式碼的邏輯進行深度解剖。
4. **探究根本原因 (Root Cause)**：說明為何會發生此錯誤（如並發競爭、異常未捕獲、未處理邊界條件），並清晰區分「症狀表現」與「根本成因」。

## 【嚴格遵守之約束限制】
- ⚠️ **禁止提供修復代碼**：本階段只專注於「診斷與定位」，不要編寫任何修改後的代碼。
- ⚠️ **精確引用**：列出受影響位置時，必須提供 clickable file links（格式如 \`[filename](file:///path/to/file#L100-L120)\`）並精確指出行數。
- ⚠️ **基於事實**：如果現有資訊不足以做出精準判斷，必須具體列出需要進一步讀取的檔案或日誌，禁止自行猜測。

## 【診斷報告輸出格式】
你的回覆必須**嚴格依據下列結構輸出**：
1. **【錯誤現象摘要】**：簡短描述發生的異常行為。
2. **【關鍵呼叫鏈與資料流】**：列出異常傳遞的呼叫軌跡與變數狀態變化。
3. **【受影響程式碼定位】**：以 Markdown 連結格式標明具體檔案路徑及行數範圍。
4. **【根本原因分析 (Root Cause)】**：詳細解釋導致錯誤的邏輯瑕疵。
5. **【後續診斷建議】**：如需更多資訊，說明需要補充哪些日誌或執行哪些診斷命令。`
    },
    {
      title: "系統問題與 Bug 修正指引",
      content: `你是一位高效率且謹慎的軟體修正專家（Software Fix Specialist）。請依據已定位的錯誤原因與診斷報告，開始進行程式碼的修復工作。

請務必嚴格遵循下列規範，確保變更安全、可維護且易於回滾：

## 【修復執行規範】
1. **最小侵入性原則 (Minimal Invasive)**：
   - 僅針對根本原因進行修復。**嚴禁**順便進行無關的程式碼重構、變數命名調整、全檔格式化（Format）或 CSS 樣式微調。
   - 優先沿用專案現有的設計模式（Pattern）與寫法，避免引入不必要的新技術或第三方套件。
2. **保留原有 Context 與相容性**：
   - 必須完整保留無關的註解、TODO 標記與已停用的程式碼，不可隨意刪除。
   - 確保所有變更符合 Windows 環境相容性（如檔案路徑斜線方向），且 Python 檔案讀寫一律強制指定 \`'utf-8'\` 編碼，嚴防 CP950 報錯。
3. **逐步變更與 Staging 提交**：
   - 每次只解決一個核心問題。涉及多個不同目的的修改時，必須拆分步驟，確保每一次 Commit 的目的單一且乾淨。
   - 修改完成後，必須用 \`git --no-pager diff --cached\` 確認 Staging area 只包含本次 Commit 所需內容。

## 【驗證與防範回歸 (Regression)】
1. **編譯與型態檢查**：修改後必須確認程式碼可正常編譯，並執行 \`npm run build\` 或型態檢查（Type Check）。
2. **測試驗證**：提供或執行對應的自動化測試指令（如 Unit Test）。如果沒有自動化測試，必須提供詳細的手動驗證步驟（如 API 測試數據或 UI 交互驗證路徑），證明錯誤已被徹底修復，且沒有破壞現有的其他功能。

## 【修正報告輸出格式】
你的回覆必須**嚴格依據下列結構輸出**：
1. **【修復策略說明】**：簡單描述你採用的修復方案與原因。
2. **【變更檔案清單】**：列出所有修改的檔案路徑。
3. **【程式碼變更對照 (Diff)】**：使用 Git Diff 格式展示修改的程式碼段落。
4. **【驗證指令與結果】**：列出你用來驗證修復正確性的指令與驗證結果。
5. **【迴歸風險評估】**：評估此修改是否可能影響其他模組，以及如何防範。`
    }
  ];

  const insert = db.prepare("INSERT INTO rules (title, content, is_preset) VALUES (?, ?, 1)");

  try {
    db.exec("BEGIN TRANSACTION");

    db.exec("DELETE FROM rules WHERE is_preset = 1");

    for (const rule of presets) {
      insert.run(rule.title, rule.content);
    }

    db.exec("COMMIT");
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch (rollbackErr) {
      console.error("Rollback preset rules failed:", rollbackErr.message);
    }

    throw err;
  }
}

/**
 * 釋放所有已過期的 cooldown 狀態金鑰，將其狀態改回 active
 */
function releaseExpiredKeyCooldowns() {
  if (!db) return;
  const nowStr = getTaiwanISOString();
  db.prepare(`
    UPDATE api_keys
    SET status = 'active',
        cooldown_until = NULL
    WHERE status = 'cooldown'
      AND cooldown_until IS NOT NULL
      AND cooldown_until < ?
  `).run(nowStr);
}

/** @namespace apiKeys */
const apiKeys = {
  /**
   * 取得所有 API Keys（含已過期 cooldown 自動釋放）
   * @returns {Array<{id: number, key_value: string, status: string, consecutive_failures: number, total_errors: number, last_used_at: string|null, cooldown_until: string|null, last_error_message: string|null}>} 所有金鑰
   */
  getAll: () => {
    releaseExpiredKeyCooldowns();
    return db.prepare("SELECT * FROM api_keys ORDER BY id DESC").all();
  },
  getActiveKeys: () => {
    // 撈出健康狀態且不在 cooldown 期的 key
    // 注意：只有 429 會讓 key 進入 cooldown，其他錯誤會記錄但不冷卻。
    releaseExpiredKeyCooldowns();
    return db.prepare(`
      SELECT * FROM api_keys 
      WHERE status = 'active'
    `).all();
  },
  getKeyStatus: (id) => {
    releaseExpiredKeyCooldowns();
    const row = db.prepare("SELECT status FROM api_keys WHERE id = ?").get(id);
    return row ? row.status : null;
  },
  add: (keyValue) => {
    try {
      const stmt = db.prepare("INSERT INTO api_keys (key_value) VALUES (?)");
      stmt.run(keyValue);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
  delete: (id) => {
    const stmt = db.prepare("DELETE FROM api_keys WHERE id = ?");
    stmt.run(id);
    return { success: true };
  },
  updateStatus: (id, status, errorMsg = null) => {
    const stmt = db.prepare(`
      UPDATE api_keys 
      SET status = ?,
          cooldown_until = CASE WHEN ? = 'cooldown' THEN cooldown_until ELSE NULL END,
          last_error_message = ? 
      WHERE id = ?
    `);
    stmt.run(status, status, errorMsg, id);
  },
  recordSuccess: (id) => {
    const nowStr = getTaiwanISOString();
    const stmt = db.prepare(`
      UPDATE api_keys 
      SET status = 'active',
          consecutive_failures = 0,
          last_used_at = ?,
          cooldown_until = NULL,
          last_error_message = NULL
      WHERE id = ?
    `);
    stmt.run(nowStr, id);
  },
  recordFailure: (id, errorMsg) => {
    const stmt = db.prepare(`
      UPDATE api_keys 
      SET status = CASE WHEN status = 'inactive' THEN 'inactive' ELSE 'active' END,
          cooldown_until = CASE WHEN status = 'inactive' THEN cooldown_until ELSE NULL END,
          consecutive_failures = consecutive_failures + 1,
          total_errors = total_errors + 1,
          last_error_message = ?
      WHERE id = ?
    `);
    stmt.run(errorMsg, id);
    // 除了 429 之外，其他狀況不應使 key 進入冷卻。
    // 非 401/403 的暫時性錯誤只記錄錯誤，不會把 key 排除出可用池。
    return 'active';
  },
  recordCooldown: (id, seconds = 30, errorMsg) => {
    const cooldownTime = getTaiwanISOString(new Date(Date.now() + seconds * 1000));
    const stmt = db.prepare(`
      UPDATE api_keys 
      SET status = 'cooldown',
          cooldown_until = ?,
          total_errors = total_errors + 1,
          last_error_message = ?
      WHERE id = ?
    `);
    stmt.run(cooldownTime, errorMsg, id);
  },
  testAllKeys: async () => {
    const keys = db.prepare("SELECT * FROM api_keys").all();
    const results = [];
    
    for (const key of keys) {
      try {
        const res = await fetch("https://integrate.api.nvidia.com/v1/models", {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${key.key_value}`
          }
        });
        if (res.ok) {
          apiKeys.recordSuccess(key.id);
          results.push({ id: key.id, status: 'active', success: true });
        } else {
          const text = await res.text();
          const errorMessage = text || `HTTP ${res.status}`;
          if (res.status === 429) {
            apiKeys.recordCooldown(key.id, 30, errorMessage || '429 Rate Limit Exceeded');
            results.push({ id: key.id, status: 'cooldown', success: false, error: errorMessage });
          } else if (res.status === 401 || res.status === 403) {
            apiKeys.updateStatus(key.id, 'inactive', `HTTP ${res.status}: Key revoked/invalid`);
            results.push({ id: key.id, status: 'inactive', success: false, error: errorMessage });
          } else {
            apiKeys.recordFailure(key.id, errorMessage);
            results.push({ id: key.id, status: 'active', success: false, error: errorMessage });
          }
        }
      } catch (err) {
        apiKeys.recordFailure(key.id, err.message);
        results.push({ id: key.id, status: 'active', success: false, error: err.message });
      }
    }
    return results;
  }
};

// 輔助函式庫 - 模型設定
const modelsConfig = {
  getActiveGroup: () => {
    try {
      const row = db.prepare("SELECT value FROM metadata WHERE key = 'active_model_group'").get();
      return normalizeModelGroupId(row ? row.value : 1);
    } catch (err) {
      return 1;
    }
  },
  setActiveGroup: (groupId) => {
    const normalizedGroupId = normalizeModelGroupId(groupId);
    db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('active_model_group', ?)").run(String(normalizedGroupId));
    return { success: true, activeGroup: normalizedGroupId };
  },
  getAll: (groupId = null) => {
    const targetGroupId = groupId === null ? modelsConfig.getActiveGroup() : normalizeModelGroupId(groupId);
    return db.prepare("SELECT * FROM models_config WHERE group_id = ? ORDER BY priority ASC").all(targetGroupId);
  },
  getGroups: () => {
    const activeGroup = modelsConfig.getActiveGroup();
    const groups = [1, 2, 3].map((groupId) => {
      const models = db.prepare("SELECT * FROM models_config WHERE group_id = ? ORDER BY priority ASC").all(groupId);
      return {
        group_id: groupId,
        is_active_group: groupId === activeGroup,
        models,
        count: models.length,
        primary_model: models[0] ? models[0].model_id : null
      };
    });
    return { activeGroup, groups };
  },
  savePriorityList: (modelIds, groupId = null) => {
    const targetGroupId = groupId === null ? modelsConfig.getActiveGroup() : normalizeModelGroupId(groupId);
    // 傳入陣列，例如 ['meta/llama3-70b-instruct', 'meta/llama3-8b-instruct']
    // 只重設指定組別的配置，避免覆蓋另外兩組模型順位
    db.prepare("DELETE FROM models_config WHERE group_id = ?").run(targetGroupId);
    const insert = db.prepare("INSERT INTO models_config (group_id, model_id, priority, is_active) VALUES (?, ?, ?, 1)");
    const uniqueModelIds = [...new Set(modelIds.filter(Boolean))];
    uniqueModelIds.forEach((modelId, idx) => {
      insert.run(targetGroupId, modelId, idx + 1);
    });
    return { success: true, groupId: targetGroupId };
  },
  getAvailable: () => {
    return db.prepare("SELECT * FROM available_models ORDER BY id ASC").all();
  },
  getLastSyncTime: () => {
    try {
      const row = db.prepare("SELECT value FROM metadata WHERE key = 'last_model_sync_time'").get();
      return row ? row.value : null;
    } catch (err) {
      return null;
    }
  },
  getLastSyncSource: () => {
    try {
      const row = db.prepare("SELECT value FROM metadata WHERE key = 'last_model_sync_source'").get();
      return row ? row.value : null;
    } catch (err) {
      return null;
    }
  },
  getLastSyncExpectedCount: () => {
    try {
      const row = db.prepare("SELECT value FROM metadata WHERE key = 'last_model_sync_expected_count'").get();
      const count = row && row.value ? Number(row.value) : null;
      return Number.isFinite(count) && count > 0 ? count : null;
    } catch (err) {
      return null;
    }
  },
  getLastSyncParsedCount: () => {
    try {
      const row = db.prepare("SELECT value FROM metadata WHERE key = 'last_model_sync_parsed_count'").get();
      const count = row && row.value ? Number(row.value) : null;
      return Number.isFinite(count) && count >= 0 ? count : null;
    } catch (err) {
      return null;
    }
  },
  getLastSyncSavedCount: () => {
    try {
      const row = db.prepare("SELECT value FROM metadata WHERE key = 'last_model_sync_saved_count'").get();
      const count = row && row.value ? Number(row.value) : null;
      return Number.isFinite(count) && count >= 0 ? count : null;
    } catch (err) {
      return null;
    }
  },
  syncFromNvidia: async (keyValue = null) => {
    try {
      let catalog;
      try {
        // 主要來源：NVIDIA Build 網頁的 Free Endpoint 篩選結果。
        // /v1/models 是「這把 key 當下可見的模型」，不等同於 build.nvidia.com 上標示可免費試用的 Preview Endpoint 清單。
        catalog = await fetchNvidiaBuildFreeEndpointCatalog();
      } catch (buildErr) {
        // 備援來源：NVIDIA 公開 featured catalog，避免 Build 頁面暫時改版時完全無法同步。
        // 若有 API Key，再退回 /v1/models 作為最後保底，但不再把它當作主要 Free Endpoint 來源。
        let fallbackError = buildErr;
        try {
          catalog = await fetchNvidiaFeaturedModelsCatalog();
        } catch (featuredErr) {
          fallbackError = featuredErr;
        }

        if (!catalog && keyValue) {
          const res = await fetch("https://integrate.api.nvidia.com/v1/models", {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${keyValue}`
            }
          });
          if (!res.ok) {
            const errorText = await res.text().catch(() => '');
            throw new Error(`NVIDIA Build catalog failed (${buildErr.message}); fallback /v1/models replied with HTTP ${res.status}${errorText ? `: ${errorText.substring(0, 200)}` : ''}`);
          }
          const data = await res.json();
          if (!data || !Array.isArray(data.data)) {
            throw new Error(`NVIDIA Build catalog failed (${buildErr.message}); fallback /v1/models returned invalid data.`);
          }
          const seen = new Set();
          catalog = {
            models: data.data
              .map((m) => {
                const modelId = typeof m.id === 'string' ? m.id.trim() : '';
                if (!modelId || seen.has(modelId)) return null;
                seen.add(modelId);
                return {
                  id: modelId,
                  name: typeof m.name === 'string' && m.name.trim() ? m.name.trim() : modelId.split('/').pop(),
                  created: Number.isFinite(Number(m.created)) ? Number(m.created) : 0
                };
              })
              .filter(Boolean),
            expectedCount: null,
            source: 'https://integrate.api.nvidia.com/v1/models'
          };
        }

        if (!catalog) throw fallbackError;
      }

      if (!catalog || !Array.isArray(catalog.models) || catalog.models.length === 0) {
        return { success: false, error: 'Invalid data format from NVIDIA Build catalog' };
      }

      // parsedCount 代表從同步來源實際解析出的模型數量；不是寫死數值。
      // savedCount 代表去重後實際寫入 available_models 的數量。
      const parsedCount = catalog.models.length;

      // 先清空原本的可用模型
      db.exec("DELETE FROM available_models");
      const insert = db.prepare("INSERT OR REPLACE INTO available_models (id, name, created) VALUES (?, ?, ?)");

      const syncedModels = [];
      const seen = new Set();
      catalog.models.forEach((m) => {
        const modelId = typeof m.id === 'string' ? m.id.trim() : '';
        if (!modelId || seen.has(modelId)) return;
        seen.add(modelId);

        const modelName = typeof m.name === 'string' && m.name.trim()
          ? m.name.trim()
          : modelId.split('/').pop();
        const created = Number.isFinite(Number(m.created)) ? Number(m.created) : 0;

        insert.run(modelId, modelName, created);
        syncedModels.push(modelId);
      });

      // 預設將第一順位等自動設定（如果第 1 組原本是空的）
      const check = db.prepare("SELECT COUNT(*) as count FROM models_config WHERE group_id = 1").get();
      if (check.count === 0 && syncedModels.length > 0) {
        // 找出一些常見的優秀模型先當預設
        const findPreferred = (patterns, exclude = []) => syncedModels.find(id => {
          const lowered = id.toLowerCase();
          return !exclude.includes(id) && patterns.some(pattern => lowered.includes(pattern));
        });
        const primary = findPreferred(['nemotron-3-ultra', 'deepseek-v4', 'kimi-k2', 'minimax-m3', 'llama-4', 'llama-3.3']) || syncedModels[0];
        const fallback1 = findPreferred(['qwen', 'glm', 'mistral', 'gemma', 'step'], [primary]) || syncedModels.find(id => id !== primary);
        const fallback2 = findPreferred(['minimax', 'deepseek', 'moonshotai', 'nvidia'], [primary, fallback1]) || syncedModels.find(id => id !== primary && id !== fallback1);

        const activePresets = [primary, fallback1, fallback2].filter(Boolean);
        const insertConfig = db.prepare("INSERT INTO models_config (group_id, model_id, priority, is_active) VALUES (1, ?, ?, 1)");
        activePresets.forEach((mId, index) => {
          insertConfig.run(mId, index + 1);
        });
      }
      // 記錄同步時間至 metadata 表
      const savedCount = syncedModels.length;
      db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('last_model_sync_time', ?)").run(getTaiwanISOString());
      db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('last_model_sync_source', ?)").run(catalog.source || NVIDIA_BUILD_FREE_ENDPOINT_URL);
      db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('last_model_sync_expected_count', ?)").run(catalog.expectedCount ? String(catalog.expectedCount) : '');
      db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('last_model_sync_parsed_count', ?)").run(String(parsedCount));
      db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('last_model_sync_saved_count', ?)").run(String(savedCount));

      return {
        success: true,
        count: savedCount,
        parsedCount,
        savedCount,
        expectedCount: catalog.expectedCount,
        source: catalog.source || NVIDIA_BUILD_FREE_ENDPOINT_URL
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
};

// 輔助函式庫 - Rules
const rules = {
  getAll: () => {
    return db.prepare("SELECT * FROM rules ORDER BY is_preset DESC, id DESC").all();
  },
  add: (title, content) => {
    try {
      const stmt = db.prepare("INSERT INTO rules (title, content, is_preset) VALUES (?, ?, 0)");
      stmt.run(title, content);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
  update: (id, title, content) => {
    try {
      const stmt = db.prepare("UPDATE rules SET title = ?, content = ? WHERE id = ? AND is_preset = 0");
      stmt.run(title, content, id);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
  delete: (id) => {
    try {
      const stmt = db.prepare("DELETE FROM rules WHERE id = ? AND is_preset = 0");
      stmt.run(id);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
};

// 輔助函式庫 - 統計資訊
const stats = {
  getHourlyStats: () => {
    // 撈出最近 24 小時的統計
    return db.prepare(`
      SELECT * FROM stats 
      ORDER BY hour DESC 
      LIMIT 24
    `).all().reverse();
  },
  recordRequest: (isSuccess) => {
    // 格式化台灣時間 YYYY-MM-DD HH:00，避免系統時區造成每小時流量與即時日誌偏移
    const hourStr = getTaiwanHourString();

    // 先插入或忽略
    db.prepare("INSERT OR IGNORE INTO stats (hour, request_count, success_count, error_count) VALUES (?, 0, 0, 0)").run(hourStr);

    if (isSuccess) {
      db.prepare(`
        UPDATE stats 
        SET request_count = request_count + 1,
            success_count = success_count + 1
        WHERE hour = ?
      `).run(hourStr);
    } else {
      db.prepare(`
        UPDATE stats 
        SET request_count = request_count + 1,
            error_count = error_count + 1
        WHERE hour = ?
      `).run(hourStr);
    }
  }
};

function closeDatabase() {
  if (db) {
    try {
      db.close();
    } catch (e) {
      console.error('Error closing database:', e.message);
    }
    db = null;
  }
}

const settings = {
  get() {
    const roundDelay = db.prepare("SELECT value FROM metadata WHERE key = 'ROUND_DELAY_MS'").get();
    const reqTimeout = db.prepare("SELECT value FROM metadata WHERE key = 'REQUEST_TIMEOUT_MS'").get();
    const streamTimeout = db.prepare("SELECT value FROM metadata WHERE key = 'STREAM_READ_TIMEOUT_MS'").get();
    const nvidiaUrl = db.prepare("SELECT value FROM metadata WHERE key = 'NVIDIA_API_URL'").get();
    const port = db.prepare("SELECT value FROM metadata WHERE key = 'PORT'").get();
    const maxRounds = db.prepare("SELECT value FROM metadata WHERE key = 'MAX_ROUNDS_PER_MODEL'").get();
    const testTimeout = db.prepare("SELECT value FROM metadata WHERE key = 'TEST_TIMEOUT_MS'").get();
    const modelFailureCooldown = db.prepare("SELECT value FROM metadata WHERE key = 'MODEL_FAILURE_COOLDOWN_MS'").get();
    const keyConcurrencyDelay = db.prepare("SELECT value FROM metadata WHERE key = 'KEY_CONCURRENCY_DELAY_MS'").get();
    return {
      ROUND_DELAY_MS: Number(roundDelay?.value || 15000),
      REQUEST_TIMEOUT_MS: Number(reqTimeout?.value || 120000),
      STREAM_READ_TIMEOUT_MS: Number(streamTimeout?.value || 120000),
      NVIDIA_API_URL: nvidiaUrl?.value || 'https://integrate.api.nvidia.com/v1',
      PORT: Number(port?.value || 4000),
      MAX_ROUNDS_PER_MODEL: Number(maxRounds?.value || 2),
      TEST_TIMEOUT_MS: Number(testTimeout?.value || 60000),
      MODEL_FAILURE_COOLDOWN_MS: Number(modelFailureCooldown?.value || 60000),
      KEY_CONCURRENCY_DELAY_MS: Number(keyConcurrencyDelay?.value || 5000),
      PRICE_PER_MILLION_PROMPT_TOKENS: Number(db.prepare("SELECT value FROM metadata WHERE key = 'PRICE_PER_MILLION_PROMPT_TOKENS'").get()?.value || 0.30),
      PRICE_PER_MILLION_COMPLETION_TOKENS: Number(db.prepare("SELECT value FROM metadata WHERE key = 'PRICE_PER_MILLION_COMPLETION_TOKENS'").get()?.value || 0.60),
      REF_PRICE_PER_MILLION_PROMPT_TOKENS: Number(db.prepare("SELECT value FROM metadata WHERE key = 'REF_PRICE_PER_MILLION_PROMPT_TOKENS'").get()?.value || 5.00),
      REF_PRICE_PER_MILLION_COMPLETION_TOKENS: Number(db.prepare("SELECT value FROM metadata WHERE key = 'REF_PRICE_PER_MILLION_COMPLETION_TOKENS'").get()?.value || 15.00),
      CURRENCY_SYMBOL: db.prepare("SELECT value FROM metadata WHERE key = 'CURRENCY_SYMBOL'").get()?.value || 'USD'
    };
  },
  save(config) {
    if (config.ROUND_DELAY_MS !== undefined) {
      db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('ROUND_DELAY_MS', ?)").run(String(config.ROUND_DELAY_MS));
    }
    if (config.REQUEST_TIMEOUT_MS !== undefined) {
      db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('REQUEST_TIMEOUT_MS', ?)").run(String(config.REQUEST_TIMEOUT_MS));
    }
    if (config.STREAM_READ_TIMEOUT_MS !== undefined) {
      db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('STREAM_READ_TIMEOUT_MS', ?)").run(String(config.STREAM_READ_TIMEOUT_MS));
    }
    if (config.NVIDIA_API_URL !== undefined) {
      db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('NVIDIA_API_URL', ?)").run(String(config.NVIDIA_API_URL));
    }
    if (config.PORT !== undefined) {
      db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('PORT', ?)").run(String(config.PORT));
    }
    if (config.MAX_ROUNDS_PER_MODEL !== undefined) {
      db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('MAX_ROUNDS_PER_MODEL', ?)").run(String(config.MAX_ROUNDS_PER_MODEL));
    }
    if (config.TEST_TIMEOUT_MS !== undefined) {
      db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('TEST_TIMEOUT_MS', ?)").run(String(config.TEST_TIMEOUT_MS));
    }
    if (config.MODEL_FAILURE_COOLDOWN_MS !== undefined) {
      db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('MODEL_FAILURE_COOLDOWN_MS', ?)").run(String(config.MODEL_FAILURE_COOLDOWN_MS));
    }
    if (config.KEY_CONCURRENCY_DELAY_MS !== undefined) {
      db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('KEY_CONCURRENCY_DELAY_MS', ?)").run(String(config.KEY_CONCURRENCY_DELAY_MS));
    }
    if (config.PRICE_PER_MILLION_PROMPT_TOKENS !== undefined) {
      db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('PRICE_PER_MILLION_PROMPT_TOKENS', ?)").run(String(config.PRICE_PER_MILLION_PROMPT_TOKENS));
    }
    if (config.PRICE_PER_MILLION_COMPLETION_TOKENS !== undefined) {
      db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('PRICE_PER_MILLION_COMPLETION_TOKENS', ?)").run(String(config.PRICE_PER_MILLION_COMPLETION_TOKENS));
    }
    if (config.REF_PRICE_PER_MILLION_PROMPT_TOKENS !== undefined) {
      db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('REF_PRICE_PER_MILLION_PROMPT_TOKENS', ?)").run(String(config.REF_PRICE_PER_MILLION_PROMPT_TOKENS));
    }
    if (config.REF_PRICE_PER_MILLION_COMPLETION_TOKENS !== undefined) {
      db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('REF_PRICE_PER_MILLION_COMPLETION_TOKENS', ?)").run(String(config.REF_PRICE_PER_MILLION_COMPLETION_TOKENS));
    }
    if (config.CURRENCY_SYMBOL !== undefined) {
      db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('CURRENCY_SYMBOL', ?)").run(String(config.CURRENCY_SYMBOL));
    }
    return this.get();
  }
};

const tokenUsage = {
  addRecord(requestId, modelId, promptTokens, completionTokens, requestBody, responseContent) {
    const timestamp = getTaiwanISOString();
    const total = (promptTokens || 0) + (completionTokens || 0);
    const bodyStr = typeof requestBody === 'string' ? requestBody : JSON.stringify(requestBody || {});
    const respStr = responseContent || '';
    db.prepare(`
      INSERT INTO token_usage (request_id, timestamp, model_id, prompt_tokens, completion_tokens, total_tokens, request_body, response_content)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(requestId || null, timestamp, modelId, promptTokens || 0, completionTokens || 0, total, bodyStr, respStr);

    // 唯獨最近 50 個顯示完整對話，更早之前的紀錄自動清除對話與回傳文字
    try {
      db.exec(`
        UPDATE token_usage 
        SET request_body = '', response_content = '' 
        WHERE id NOT IN (
          SELECT id FROM token_usage 
          ORDER BY id DESC 
          LIMIT 50
        )
      `);
    } catch (err) {
      console.error('Failed to prune old token_usage prompt contents:', err);
    }
  },
  getStats() {
    return db.prepare(`
      SELECT 
        model_id,
        SUM(prompt_tokens) as total_prompt_tokens,
        SUM(completion_tokens) as total_completion_tokens,
        SUM(total_tokens) as total_total_tokens,
        COUNT(id) as request_count
      FROM token_usage
      GROUP BY model_id
      ORDER BY total_total_tokens DESC
    `).all();
  },
  getLogs(limit = 100) {
    return db.prepare(`
      SELECT id, request_id, timestamp, model_id, prompt_tokens, completion_tokens, total_tokens, request_body, response_content
      FROM token_usage
      ORDER BY id DESC
      LIMIT ?
    `).all(limit);
  },
  getDetail(id) {
    return db.prepare(`
      SELECT id, request_id, timestamp, model_id, prompt_tokens, completion_tokens, total_tokens, request_body, response_content
      FROM token_usage
      WHERE id = ?
    `).get(id);
  },
  clear() {
    db.exec("DELETE FROM token_usage");
  }
};

module.exports = {
  initDatabase,
  closeDatabase,
  apiKeys,
  modelsConfig,
  rules,
  stats,
  settings,
  tokenUsage
};
