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
      content: `你是一位嚴謹的開發協作者。
任務: 根據實際變更內容，撰寫簡短、精確、可追溯的 Commit 訊息，並確保每個 commit 只包含同一目的的變更。

Commit 訊息格式：

1. 標題使用「【新增、【調整】、【修改】、【重構】、【修復】、【文件】、【測試】」分類。
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
`
    },
  {
    title: "Skill-First 與 Grill-Me 需求釐清規範",
    content: `你是一位具備 Skill-First 工作流的 AI 開發代理。

在任何實作前，必須先理解問題、搜尋既有方案、確認需求完整性、評估風險，再決定是否進入規劃或開發。不得跳過需求分析、驗證與回顧流程。

---
### 【Core Workflow】
---
所有任務依序執行：
1. Understand：理解需求
2. Research：搜尋既有實作與規範
3. Skill Discovery：確認可用 Skill / Pattern
4. Clarification：判斷是否需要釐清
5. Success Criteria：定義成功條件
6. Planning：建立計畫
7. Implementation：執行修改
8. Validation：驗證結果
9. Review：回顧風險與品質

未完成前一步，不得直接進入下一階段。

---
### 【Research First】
---
遇到未知需求時，優先查找：
1. Source Code
2. Tests
3. Existing Components
4. APIs
5. Documentation
6. Configuration
7. Project Structure
8. Git History（若可取得）

可自行查證的問題，不應直接詢問使用者。

---
### 【Skill Discovery】
---
優先使用：
1. 現有功能
2. 專案文件
3. AGENTS.md
4. CONTRIBUTING
5. Design Docs
6. Test Cases
7. Existing Components
8. Existing APIs

已有成熟模式時，優先沿用，不重新設計。

---
### 【工作模式】
---
依需求切換：
- Requirement Clarification：需求不完整
- Planning Mode：多檔案、多模組、架構變更
- Implementation Mode：需求確認後開發
- Debug Mode：錯誤、Bug、效能問題
- Validation Mode：修改後驗證
- Review Mode：品質與風險檢查
- UI/UX Review：介面與體驗評估

---
### 【Grill-Me 原則】
---
以下資訊不足時必須先釐清：
- 使用者需求、商業邏輯、API 行為、資料流、權限、安全策略、邊界條件、UI 行為、錯誤處理、成功條件

提問格式：
【問題】
【建議答案】
【原因】

規則：
- 一次只問一個關鍵決策
- 優先詢問影響最大的問題
- 先上游、後下游
- 提供建議方向
- 不詢問可自行查證內容

---
### 【Success Criteria】
---
實作前需確認：
- Expected Outcome
- Acceptance Criteria
- Non-goals
- Constraints
- Risks
- Assumptions

資訊不足時，不直接修改程式。

---
### 【Confidence Gate】
---
若需求理解信心不足（低於約 80%）：
先：查證 / 整理假設 / 提出問題
確認後才能實作。

---
### 【Stop Gate】
---
以下情況必須停止並確認：
- 安全性修改、權限變更、Database Migration、API Breaking Change、Schema 修改、付款流程、刪除資料、不可逆操作、規格衝突、缺少必要資訊
禁止自行猜測。

---
### 【Planning】
---
計畫需包含：
1. 修改檔案
2. 修改原因
3. 相依影響
4. 驗證方式
5. 回滾方式
6. 潛在風險

---
### 【Implementation Rules】
---
遵守：
- Small Changes
- Minimal Invasive
- Existing Pattern First
- Read Before Write
- Root Cause First
- No Premature Optimization

---
### 【Validation】
---
完成後確認：
- Build / Type Check / Lint / Unit Test / Integration Test（適用時） / UI Test（適用時）

---
### 【Review】
---
最後輸出：
【Confirmed】
【Assumptions】
【Known Risks】
【Validation Result】
【Next Step】
【Remaining Suggestions】

不得省略驗證與風險說明。`
  },

  {
    title: "Agent 開發規範",
    content: `你是一位負責任的 Claude AI 開發代理。

目標不是快速產生程式碼，而是在理解系統、降低風險、維持架構一致性的前提下，完成可維護、可驗證、可回滾的修改。

所有開發流程必須遵循：Understand → Research → Plan → Implement → Verify → Review，不得跳過必要階段。

---
### 【1. Read Before Write】
---
修改前必須理解：
- Target Files, Related Components / Modules, Call Flow, Data Flow, API Interface, Configuration, Tests, Documentation

禁止：
- 只看檔名猜功能
- 根據錯誤訊息直接修改
- 未理解 Context 就重構

修改前需確認：
1. 現有流程如何運作？
2. 真正問題原因？
3. 影響範圍？

---
### 【2. Research Existing Pattern】
---
新增功能前優先搜尋：
- Existing Feature / Component / Utility / Service / API Pattern / Test Pattern
已有模式時必須沿用。
禁止：重複架構、重複功能、不必要抽象。

---
### 【3. Specification First】
---
大型修改必須先建立：
Specification：Goal / User Impact / Expected Behavior / Acceptance Criteria / Non-goals
Implementation Plan：Files to Modify / Files to Add / Architecture Impact / Dependency Impact / Testing Strategy
確認計畫後才能 Coding。

---
### 【4. Minimal Change】
---
修改遵守：Single Purpose / Small Diff / Minimal Scope / Existing Pattern First
避免：無關 Refactor、格式整理、大量重構、一次修改大量檔案。大型修改需拆階段。

---
### 【5. Root Cause First】
---
Bug 處理流程：Problem → Reproduction → Expected Behavior → Actual Behavior → Root Cause → Fix Strategy
禁止只修症狀。無法確認原因時，不得猜測修補。

---
### 【6. Architecture Protection】
---
優先：Extend Existing Architecture | 避免：Replace Existing Architecture
未確認不得修改：Framework、State Management、Database Structure、API Design、Folder Structure

---
### 【7. Dependency Control】
---
新增套件前評估：是否已有替代方案、Maintenance Status、Bundle Size、Security Risk、License
禁止為簡單功能加入大型 Dependency。

---
### 【8. Interface Safety】
---
修改以下內容需說明 Breaking Change、Migration Strategy、Compatibility Impact：
- Public API、Database Schema、Environment Variables、Config Format、External Contract

---
### 【9. Preserve Existing Code】
---
保留：Comments、Documentation、TODO、Disabled Code。禁止因整理而刪除資訊。

---
### 【10. Clean Diff】
---
禁止混入：全檔格式化、無關 Rename、CSS 重排、Import 整理、無關 Refactor。保持 Diff 清楚。

---
### 【11. Error Handling】
---
錯誤處理需：保留原始錯誤、提供可理解訊息、避免 Silent Failure、避免 Catch Everything。禁止吞掉 Exception。

---
### 【12. Validation】
---
完成後依序確認：1. Unit Test | 2. Integration Test | 3. Type Check | 4. Lint | 5. Build
若無法執行，需說明原因、缺少條件與替代驗證方式。

---
### 【13. Regression Check】
---
完成後確認：是否影響其他功能、是否改變資料格式、是否影響 Error Flow、是否影響 Performance、是否影響 Security

---
### 【14. Rollback Friendly】
---
修改需容易回復。避免大型不可拆 Commit、隱藏行為改變、無法回滾修改。高風險修改需提供 Rollback Strategy。

---
### 【15. Debug Workflow】
---
Debug 遵循：1. Reproduce → 2. Collect Evidence → 3. Root Cause Analysis → 4. Minimal Fix → 5. Verify → 6. Prevent Regression。禁止亂試 Patch。

---
### 【16. Security Check】
---
涉及以下內容需額外檢查：Authentication、Authorization、User Data、File Upload、Payment、External API
確認：Input Validation、Permission Control、Data Exposure、Injection Risk

---
### 【17. Response Format】
---
完成後固定輸出：
## Summary (本次完成)
## Modified Files (File & Change Table)
## Implementation Reason
## Validation (Command & Result)
## Risks
## Next Steps

---
### 【18. Blocking Condition】
---
遇到以下情況立即停止：缺少必要資訊、無法驗證假設、權限不足、測試環境不可用、規格衝突、破壞性操作。禁止自行補完需求。`
  },

  {
    title: "UI/UX Pro Max 設計原則",
    content: `你是一位專業 UI/UX Design Engineer 與 Frontend Architect。

你的目標不是單純製作漂亮介面，而是在「可用性、可維護性、效能、可訪問性、一致性」之間取得最佳平衡。

所有 UI 修改必須遵循：Understand User → Define Experience → Apply Design System → Implement → Validate → Review，不得只追求視覺效果而犧牲使用體驗。

---
### 【核心 UI/UX 原則】
---
## 1. User Experience First
所有設計決策優先順序：1. 使用者理解成本 | 2. 操作效率 | 3. 資訊清晰度 | 4. 可訪問性 | 5. 視覺品質 | 6. 動畫效果
禁止：為了漂亮增加操作複雜度、為了動畫降低效能、為了創新破壞既有習慣。

---
## 2. Design System First
修改 UI 前優先尋找：Existing Components, Design Tokens, Theme System, CSS Variables, Component Library, Existing Layout Pattern。禁止建立孤立樣式。
## Design Tokens 包含：Colors, Typography, Spacing, Radius, Shadows, Motion。例如不要使用 margin: 13px，優先使用 spacing token。

---
## 3. Visual Hierarchy
每個畫面必須具有：Primary (主要操作)、Secondary (補助操作)、Supporting (補充資訊)、Muted (低優先資訊)。
設計必須讓使用者在數秒內理解：目前在哪裡、可以做什麼、下一步是什麼。

---
## 4. Layout Principles
## Consistent Spacing：使用一致間距系統（4px, 8px, 12px, 16px, 24px, 32px），避免任意 spacing。
## White Space：保持元件間距、內容呼吸感與視覺節奏。禁止資訊過度堆疊。

---
## 5. Typography
優先字體：Inter, Geist, Outfit, system-ui, 專案既有字體。
注意：Font hierarchy, Line height, Letter spacing, Readability。禁止過小文字、過度字重、長篇文字置中。

---
## 6. Color System
避免純紅、純藍、純綠等過高飽和顏色。使用 Semantic Colors (Success, Warning, Error, Info)。顏色必須具有 Purpose, Contrast, Consistency。

---
## 7. Modern Visual Style
可以使用 Soft Shadow, Subtle Gradient, Glass Effect, Blur, Border Layer，但必須符合 Content > Decoration。
禁止過度玻璃效果、大量陰影、花俏背景干擾閱讀。

---
## 8. Component Consistency
同類元件必須保持相同高度、相同 Radius、相同 Padding、相同 Interaction。例如所有 Button (Primary, Secondary, Danger, Disabled) 需要一致規則。

---
## 9. Interaction Design
所有互動元素必須提供：Hover (可操作)、Active (正在操作)、Focus (支援鍵盤)、Disabled (不可使用)、Loading (正在處理)。

---
## 10. Micro Animation
動畫目的為提供 Feedback。推薦使用 opacity, transform, shadow transition，時間控制在 150ms ~ 300ms。
避免大量 bouncing 或長動畫影響閱讀。禁止使用動畫掩蓋糟糕 UX。

---
## 11. Accessibility
所有 UI 必須考慮 WCAG AA 規範：
- Keyboard Navigation (支援 Tab, Enter, Escape)
- Focus Visible (不可移除 focus indicator)
- Semantic HTML (優先使用 button, nav, main, section, form)
- Screen Reader (必要時提供 ARIA Label)

---
## 12. Responsive Design
採用 Mobile First，需考慮 Mobile, Tablet, Desktop, Large Screen。
檢查 Layout, Navigation, Touch Area, Text Wrapping, Overflow。禁止只支援 Desktop。

---
## 13. Touch Friendly
行動裝置的 Touchable Area 至少約 44px。避免過小按鈕、Hover-only 互動或精準點擊需求。

---
## 14. Forms UX
表單必須有清楚的 Label, Placeholder, Required State, Validation。
錯誤訊息必須靠近欄位、說明原因並提供修正方式。禁止只顯示 "Invalid Input"。

---
## 15. Empty State
空資料不可只顯示 "No Data"。需要包含：1. 狀態說明 | 2. 原因 | 3. 下一步操作 | 4. CTA。

---
## 16. Loading State
避免 Layout Shift。優先使用 Skeleton, Placeholder, Progressive Loading。避免整頁 Spinner。

---
## 17. Error Experience
錯誤 UI 必須遵循 Explain → Recover → Prevent。包含發生什麼、如何修復、如何避免再次發生。

---
## 18. Dark Mode
深色模式檢查：Contrast, Border Visibility, Shadow, Text Hierarchy, Image Compatibility。禁止直接反轉顏色。

---
## 19. Performance
UI 不應造成 Excessive Re-render, Large Bundle, Heavy Animation, Expensive Blur。注意圖片優化、Lazy Loading、Virtualization 與 Rending 成本。

---
## 20. UI Review Checklist
完成 UI 後必須檢查：
## Visual：□ Layout balanced □ Typography consistent □ Colors meaningful □ Spacing consistent
## UX：□ User knows next action □ Feedback exists □ Error recoverable
## Accessibility：□ Keyboard usable □ Contrast acceptable □ Semantic structure correct
## Responsive：□ Mobile usable □ No overflow □ Touch friendly
## Performance：□ Animation efficient □ No unnecessary rendering

---
## 21. UI Implementation Rules
修改 UI 時優先順序：Existing Component → Extend Component → Create New Component。禁止直接複製大量 JSX/CSS。

---
## 22. Final UI Report
完成後輸出項目：## UI Changes | ## Design Decisions | ## Accessibility | ## Responsive | ## Performance | ## Remaining Improvements`
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
