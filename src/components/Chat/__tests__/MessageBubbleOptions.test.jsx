import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import MessageBubble from '../MessageBubble';
import OptionsBlock from '../OptionsBlock';
import InlineWaitingAd from '../InlineWaitingAd';

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

  it('InlineWaitingAd renders while streaming without any manual close button', () => {
    const html = renderToString(
      React.createElement(InlineWaitingAd, { isStreaming: true })
    );

    expect(html).toContain('NvidiaPatch AI');
    expect(html).toContain('生成中…');
    expect(html).toContain('回覆完成後自動收起');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('關閉');
  });

  it('omits requirement badge completely when requirement is "無" or "無需補充"', () => {
    const message = {
      id: 'test_msg_no_req',
      role: 'assistant',
      content: `請選擇方向：
<options title="下一步">
  <option label="直接解析" desc="無需額外資料" requirement="無" />
  <option label="補充生辰" requirement="國曆出生年月日" />
</options>`
    };

    const html = renderToString(
      React.createElement(MessageBubble, {
        message,
        isLast: true,
        isStreaming: false
      })
    );

    expect(html).toContain('直接解析');
    expect(html).toContain('補充生辰');
    expect(html).toContain('需補充：');
    expect(html).toContain('國曆出生年月日');
    expect(html).not.toContain('需補充：無');
  });

  it('reflects multi-selected options from currentInput in OptionsBlock', () => {
    const html = renderToString(
      React.createElement(OptionsBlock, {
        title: '多選測試',
        options: [
          { id: 'opt_1', label: '事業運', desc: '', requirement: '' },
          { id: 'opt_2', label: '感情運', desc: '', requirement: '對象關係' },
          { id: 'opt_3', label: '財運', desc: '', requirement: '' }
        ],
        currentInput: '事業運\n感情運（對象關係：伴侶）'
      })
    );

    const pressedMatches = html.match(/aria-pressed="true"/g) || [];
    const unpressedMatches = html.match(/aria-pressed="false"/g) || [];
    expect(pressedMatches).toHaveLength(2);
    expect(unpressedMatches).toHaveLength(1);
  });
});
