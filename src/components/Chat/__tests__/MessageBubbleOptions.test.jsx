import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import MessageBubble from '../MessageBubble';

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, fallback) => fallback || key
  })
}));

describe('MessageBubble Options Rendering', () => {
  it('renders options block cleanly when content contains <options> tag', () => {
    const message = {
      id: 'test_msg_1',
      role: 'assistant',
      content: `請告訴我：
<options title="想選紫微斗數還是塔羅？">
  <option label="紫微斗數" desc="請補充農曆出生日期" requirement="農曆出生日期" />
  <option label="塔羅" desc="請提供最關心的具體問題" requirement="具體問題" />
  <option label="兩者都要" />
</options>
我會立即為您算出結果。`
    };

    const html = renderToString(
      React.createElement(MessageBubble, {
        message,
        isLast: true,
        isStreaming: false
      })
    );

    // Verify option labels and structure are present
    expect(html).toContain('紫微斗數');
    expect(html).toContain('塔羅');
    expect(html).toContain('兩者都要');
    expect(html).toContain('想選紫微斗數還是塔羅？');
    expect(html).toContain('需補充：');
    expect(html).toContain('農曆出生日期');
    expect(html).toContain('3');
    expect(html).toContain('個選項');
  });

  it('renders regular text when no options tag exists', () => {
    const message = {
      id: 'test_msg_2',
      role: 'assistant',
      content: '這是一般的普通段落文字說明。'
    };

    const html = renderToString(
      React.createElement(MessageBubble, {
        message,
        isLast: true,
        isStreaming: false
      })
    );

    expect(html).toContain('這是一般的普通段落文字說明。');
    expect(html).not.toContain('個選項');
  });
});
