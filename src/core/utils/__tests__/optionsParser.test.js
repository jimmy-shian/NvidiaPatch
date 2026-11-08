import { describe, it, expect } from 'vitest';
import { parseOptionsBlocks } from '../optionsParser';

describe('optionsParser', () => {
  it('returns pure markdown when no <options> tag exists', () => {
    const text = '這是一般純文字回覆，沒有任何選項。';
    const blocks = parseOptionsBlocks(text);
    expect(blocks).toEqual([{ type: 'markdown', content: text }]);
  });

  it('correctly parses closed <options> block with multiple items', () => {
    const text = `建議：
鑑於您目前「待業中」，最實際的切入是事業與財運。
<options title="想選紫微斗數還是塔羅？(或兩者都要)">
  <option label="紫微斗數" desc="若選紫微斗數，請補充 農曆出生日期" requirement="農曆出生日期" />
  <option label="塔羅" desc="若選塔羅，請提供您最關心的 具體問題" requirement="具體問題" />
  <option label="兩者都要" desc="我會立即為您算出結果" />
</options>
我會立即為您算出結果。`;

    const blocks = parseOptionsBlocks(text);
    expect(blocks.length).toBe(3);
    expect(blocks[0].type).toBe('markdown');
    expect(blocks[0].content).toContain('鑑於您目前');

    expect(blocks[1].type).toBe('options');
    expect(blocks[1].title).toBe('想選紫微斗數還是塔羅？(或兩者都要)');
    expect(blocks[1].options.length).toBe(3);
    expect(blocks[1].options[0].label).toBe('紫微斗數');
    expect(blocks[1].options[0].desc).toBe('若選紫微斗數，請補充 農曆出生日期');
    expect(blocks[1].options[0].requirement).toBe('農曆出生日期');
    expect(blocks[1].options[1].label).toBe('塔羅');
    expect(blocks[1].options[2].label).toBe('兩者都要');

    expect(blocks[2].type).toBe('markdown');
    expect(blocks[2].content).toContain('我會立即為您算出結果。');
  });

  it('supports children text inside <option> tag as description', () => {
    const text = `<options title="請選擇處理方案">
  <option label="方案 A">這是詳細說明與後續條件</option>
  <option label="方案 B">另一種方案說明</option>
</options>`;

    const blocks = parseOptionsBlocks(text);
    expect(blocks.length).toBe(1);
    expect(blocks[0].type).toBe('options');
    expect(blocks[0].options[0].label).toBe('方案 A');
    expect(blocks[0].options[0].desc).toBe('這是詳細說明與後續條件');
    expect(blocks[0].options[1].label).toBe('方案 B');
    expect(blocks[0].options[1].desc).toBe('另一種方案說明');
  });

  it('tolerates streaming unclosed <options> tags safely', () => {
    const streamingText = `請選擇：
<options title="方案確認">
  <option label="選項一" desc="第一項說明" />
  <option label="選項二" desc="第二項說明" />`;

    const blocks = parseOptionsBlocks(streamingText);
    expect(blocks.length).toBe(2);
    expect(blocks[0].type).toBe('markdown');
    expect(blocks[1].type).toBe('options');
    expect(blocks[1].options.length).toBe(2);
    expect(blocks[1].options[0].label).toBe('選項一');
    expect(blocks[1].options[1].label).toBe('選項二');
  });

  it('falls back gracefully on malformed option tags without crashing', () => {
    const malformedText = '<options title="無效選項"><invalid>內容</invalid></options>';
    const blocks = parseOptionsBlocks(malformedText);
    expect(blocks).toBeDefined();
    // Even if options array is empty, it does not throw
  });
});
