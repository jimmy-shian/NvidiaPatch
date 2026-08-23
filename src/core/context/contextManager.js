/**
 * Personal Context & Background Manager
 * Injects user preferences, personal background, response language, and rules into LLM Context.
 */
import { LocalDB } from '../storage/localDatabase';

export const SUPPORTED_LANGUAGES = [
  { id: 'zh-TW', name: '繁體中文', prompt: 'Traditional Chinese (繁體中文 - 台灣慣用詞彙與語法)' },
  { id: 'en', name: 'English', prompt: 'English' },
  { id: 'ja', name: '日本語', prompt: 'Japanese (日本語)' },
  { id: 'ko', name: '한국어', prompt: 'Korean (한국어)' },
  { id: 'es', name: 'Español', prompt: 'Spanish (Español)' },
  { id: 'fr', name: 'Français', prompt: 'French (Français)' },
  { id: 'de', name: 'Deutsch', prompt: 'German (Deutsch)' },
  { id: 'pt', name: 'Português', prompt: 'Portuguese (Português)' },
  { id: 'it', name: 'Italiano', prompt: 'Italian (Italiano)' },
  { id: 'zh-CN', name: '简体中文', prompt: 'Simplified Chinese (简体中文)' },
  { id: 'zhuyin', name: '注音文 (台灣注音符號)', prompt: '台灣繁體中文搭配注音符號風格（如「ㄋㄧˇ ㄏㄠˇ」、「ㄉㄜ˙」等幽默活潑的台灣注音文模式）' }
];

export const SUPPORTED_STYLES = [
  { id: 'balanced', name: '平衡適中', prompt: '自然流暢，兼顧清晰度與適度深度。' },
  { id: 'concise', name: '簡潔俐落', prompt: '言簡意賅，直接切入核心重點，去除多餘客套。' },
  { id: 'detailed', name: '詳盡完整', prompt: '深入分析，提供周全的背景脈絡、詳細步驟與延伸說明。' },
  { id: 'rigorous', name: '嚴謹專業', prompt: '高度精確、邏輯嚴密，使用標準專業術語與嚴謹論證。' },
  {
    id: 'adhd',
    name: 'ADHD 專注優化',
    prompt: `【ADHD 專注與快速閱讀優化模式】：
1. 結論先行：必須優先在最上方給出簡潔有力的 TL;DR 核心結論。
2. 結構分明：廣泛使用清晰的小標題、粗體關鍵字與項目符號（Bullet points）。
3. 短段落：每段不超過 2-3 行，避免大篇幅密集連續文字。
4. 步驟化：操作流程請以編號步驟（Step 1, Step 2...）清晰呈現。
5. 降低認知負荷：一次聚焦單一核心概念，減少冗長前言與客套修飾。`
  }
];

export const DEFAULT_CONTEXT = {
  userName: '',
  responseLanguage: 'zh-TW',
  responseStyle: 'balanced',
  personalBackground: '',
  customInstructions: ''
};

export const ContextManager = {
  async getContext() {
    const stored = await LocalDB.getAllContextSettings();
    // Support migration from old field environmentInfo
    if (stored.environmentInfo && !stored.personalBackground) {
      stored.personalBackground = stored.environmentInfo;
    }
    return {
      ...DEFAULT_CONTEXT,
      ...stored
    };
  },

  async saveContext(contextObj) {
    await LocalDB.saveAllContextSettings(contextObj);
  },

  /**
   * Build System Prompt block for Personal Context
   */
  async buildContextSystemMessage() {
    const ctx = await this.getContext();
    const parts = [];

    if (ctx.responseLanguage) {
      const langObj = SUPPORTED_LANGUAGES.find(l => l.id === ctx.responseLanguage);
      const langDesc = langObj ? langObj.prompt : ctx.responseLanguage;
      parts.push(`- 回答語言偏好 (Response Language): ${langDesc}`);
    }

    if (ctx.responseStyle) {
      const styleObj = SUPPORTED_STYLES.find(s => s.id === ctx.responseStyle);
      const styleDesc = styleObj ? `${styleObj.name} - ${styleObj.prompt}` : ctx.responseStyle;
      parts.push(`- 溝通與回答風格 (Response Style): ${styleDesc}`);
    }

    if (ctx.userName && ctx.userName.trim()) {
      parts.push(`- 使用者稱謂 (User Name/Alias): ${ctx.userName.trim()}`);
    }

    if (ctx.personalBackground && ctx.personalBackground.trim()) {
      parts.push(`- 使用者個人背景資料 (Personal Background Context):\n${ctx.personalBackground.trim()}`);
    }

    if (ctx.customInstructions && ctx.customInstructions.trim()) {
      parts.push(`- 長期自定義原則與 Persona (Custom Instructions):\n${ctx.customInstructions.trim()}`);
    }

    if (parts.length === 0) return null;

    return `=== 使用者個人偏好與背景資料 (USER PROFILE & CONTEXT) ===\n請在所有回答中依據以下使用者設定進行客製化回覆：\n${parts.join('\n\n')}\n`;
  }
};
