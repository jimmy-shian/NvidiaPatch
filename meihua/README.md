# 梅花易數 (Meihua Yishu) 本地計算規則與知識工具包

本套件為一套 100% 離線運作、零依賴、具備完整確定性演算法與周易權威資料庫的梅花易數工具包。

## 架構說明

```
meihua/
├── calculator/                # 確定性計算層 (Pure Deterministic Code)
│   ├── bagua.js               # 先天八卦數、二進制、五行映射
│   ├── casting.js             # 數字起卦、隨機數字、時間起卦演算法
│   ├── hexagram.js            # 64 卦 8x8 雙向查表
│   ├── mutual.js              # 互卦演算法 (取主卦 2-3-4 下互, 3-4-5 上互)
│   ├── changed.js             # 動爻與變卦演算法 (單爻陰陽翻轉)
│   ├── tiyong.js              # 體用判定 (1~3 爻下用上體，4~6 爻上用下體)
│   ├── wuxing.js              # 五行生剋判定 (同/生/剋)
│   └── index.js               # 統一入口：calculateMeihua(params)
│
├── knowledge/                 # 靜態知識庫 (完整離線 JSON 數據)
│   ├── bagua.json             # 八卦基本象義、自然、方位、人體
│   ├── hexagrams.json         # 64 卦完整卦名、全稱、卦辭、大象辭、關鍵字
│   ├── lines.json             # 386 條完整爻辭 (384 爻 + 用九/用六)
│   ├── correspondences.json   # 八卦萬物類象 (天時、地理、器物、人物、動物)
│   └── interpretation_rules.json # 體用總訣與生剋解讀規則庫
│
├── resolver/                  # 知識提取與 Prompt 拼裝層
│   └── knowledgeResolver.js   # 整合計算結果 + 檢索知識 + 注入防幻覺 Context
│
├── prompts/                   # 提示詞模板
│   └── interpretation.md      # 嚴格約束 LLM 不得竄改卦象或捏造古文的 Prompt
│
├── SKILL.md                   # 標準 Agent Skill 定義檔
│
└── tests/                     # 完整單元測試與 Golden Cases
    ├── bagua.test.js
    ├── casting.test.js
    ├── hexagram.test.js
    ├── mutual.test.js
    ├── changed.test.js
    ├── tiyong.test.js
    ├── wuxing.test.js
    ├── golden_cases.json      # 權威固定案例
    └── goldenCases.test.js
```

## 快速使用範例

```javascript
import { calculateMeihua } from './calculator/index.js';
import { resolveKnowledge, buildLLMContext } from './resolver/knowledgeResolver.js';

// 1. 數字起卦 (例：數字 6, 8，占問事業)
const calcResult = calculateMeihua({
  method: 'number',
  a: 6,
  b: 8,
  question: '想詢問今年換工作是否合適'
});

// 2. 結合知識庫
const resolved = resolveKnowledge(calcResult);

// 3. 建構防幻覺 LLM 上下文
const promptContext = buildLLMContext(resolved, '想詢問今年換工作是否合適');
console.log(promptContext);
```
