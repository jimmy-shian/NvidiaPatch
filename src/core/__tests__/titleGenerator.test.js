import { describe, it, expect } from 'vitest';
import {
  cleanGeneratedTitle,
  generateTitleFromPrompt,
  cleanFallbackTitle
} from '../agent/titleGenerator';

describe('titleGenerator', () => {
  describe('cleanGeneratedTitle', () => {
    it('should strip thinking tags and return clean title from thinking models', () => {
      const raw = '<think>I should think about the title for this question.</think>量子計算基礎入門';
      expect(cleanGeneratedTitle(raw)).toBe('量子計算基礎入門');
    });

    it('should handle unclosed thinking tags from truncated streams without crashing', () => {
      const raw = '<think>The user is asking about React hooks...';
      expect(cleanGeneratedTitle(raw)).toBe('');
    });

    it('should strip common AI labels, quotes, brackets, and colons', () => {
      expect(cleanGeneratedTitle('標題：【深度學習架構】')).toBe('深度學習架構');
      expect(cleanGeneratedTitle('對話標題：「台灣氣象爬蟲」')).toBe('台灣氣象爬蟲');
      expect(cleanGeneratedTitle('Title: **Next.js 15 Routing**')).toBe('Next.js 15 Routing');
      expect(cleanGeneratedTitle('"Python 非同步程式設計"')).toBe('Python 非同步程式設計');
    });

    it('should strip trailing punctuation', () => {
      expect(cleanGeneratedTitle('Docker 容器化部署實務。')).toBe('Docker 容器化部署實務');
      expect(cleanGeneratedTitle('主題：Kubernetes 叢集架構：')).toBe('Kubernetes 叢集架構');
    });
  });

  describe('generateTitleFromPrompt', () => {
    it('should generate concise title with a single LLM prompt and filter thinking tokens', async () => {
      const mockProvider = {
        async *chatStream({ messages, max_tokens }) {
          expect(max_tokens).toBeLessThanOrEqual(150); // Low token consumption
          expect(messages.length).toBe(1); // Single prompt
          expect(messages[0].role).toBe('user');
          yield { type: 'thinking', delta: 'Thinking about the title...' };
          yield { type: 'content', delta: '<think>Formulate title</think>' };
          yield { type: 'content', delta: '標題：「Vue3 組件通訊」' };
          yield { type: 'done', delta: '' };
        }
      };

      const result = await generateTitleFromPrompt({
        prompt: '請幫我寫一個 Vue3 組件通訊的範例，包含 props 和 emit',
        provider: mockProvider,
        model: 'deepseek-ai/deepseek-r1'
      });

      expect(result).toBe('Vue3 組件通訊');
    });

    it('should fallback to cleanFallbackTitle if LLM call fails', async () => {
      const failingProvider = {
        async *chatStream() {
          yield { type: 'error', delta: 'Network timeout' };
        }
      };

      const result = await generateTitleFromPrompt({
        prompt: '如何配置 Vite 與 Tailwind CSS 開發環境',
        provider: failingProvider,
        model: 'test-model'
      });

      expect(result).toBe('如何配置 Vite 與 Tailwind CSS 開發環境');
    });
  });

  describe('cleanFallbackTitle', () => {
    it('should clean markdown and whitespace from prompt without harsh 15-char truncation', () => {
      expect(cleanFallbackTitle('### 如何修復 `NullPointerException` 錯誤？')).toBe('如何修復 NullPointerException 錯誤');
      expect(cleanFallbackTitle('```js\nconsole.log(1)\n```\n請解釋這段代碼')).toBe('請解釋這段代碼');
      expect(cleanFallbackTitle('')).toBe('新對話');
      expect(cleanFallbackTitle(null)).toBe('新對話');
    });
  });
});
