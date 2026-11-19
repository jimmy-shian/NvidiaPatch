import { describe, it, expect } from 'vitest';
import {
  parseOptionsBlocks,
  stripOptionsBlocks,
  isMeaningfulRequirement,
  isOptionInInput,
  toggleOptionInInput
} from '../optionsParser';

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

  it('unwraps <options> accidentally wrapped inside xml/html code fences', () => {
    const fencedText = `以下是推薦方案：

\`\`\`xml
<options title="建議下一步">
  <option label="方案一" desc="本機量化推論" />
  <option text="方案二" desc="雲端混和推論" />
</options>
\`\`\`

請點選上方按鈕。`;

    const blocks = parseOptionsBlocks(fencedText);
    expect(blocks.length).toBe(3);
    expect(blocks[0].type).toBe('markdown');
    expect(blocks[0].content).toBe('以下是推薦方案：');
    expect(blocks[1].type).toBe('options');
    expect(blocks[1].options).toHaveLength(2);
    expect(blocks[1].options[0].label).toBe('方案一');
    expect(blocks[1].options[1].label).toBe('方案二');
    expect(blocks[2].type).toBe('markdown');
    expect(blocks[2].content).toBe('請點選上方按鈕。');
  });

  it('stripOptionsBlocks removes complete, fenced, and standalone <option> tags while keeping body text', () => {
    const raw = `這是分析內文。

\`\`\`xml
<options title="建議下一步">
  <option label="方案一" desc="說明一" />
  <option label="方案二" requirement="額外條件" />
</options>
\`\`\`

另外這段也要保留。
<option label="遺漏外框的選項" desc="不應被複製" />
<options title="未閉合">
  <option label="串流中選項" />`;

    const clean = stripOptionsBlocks(raw);
    expect(clean).toBe('這是分析內文。\n\n另外這段也要保留。');
    expect(clean).not.toContain('<options');
    expect(clean).not.toContain('<option');
    expect(clean).not.toContain('方案一');
  });

  it('filters out non-meaningful requirements like "無" and "無需補充"', () => {
    expect(isMeaningfulRequirement('無')).toBe(false);
    expect(isMeaningfulRequirement('無。')).toBe(false);
    expect(isMeaningfulRequirement('無需補充')).toBe(false);
    expect(isMeaningfulRequirement('none')).toBe(false);
    expect(isMeaningfulRequirement('N/A')).toBe(false);
    expect(isMeaningfulRequirement('')).toBe(false);
    expect(isMeaningfulRequirement('農曆出生日期')).toBe(true);

    const blocks = parseOptionsBlocks(`<options title="請選擇">
      <option label="直接開始" requirement="無" />
      <option label="帶入生辰" requirement="農曆出生日期" />
    </options>`);
    expect(blocks[0].options[0].requirement).toBe('');
    expect(blocks[0].options[1].requirement).toBe('農曆出生日期');
  });

  it('supports multi-select toggling and click-again removal from input text', () => {
    const optA = { id: 'opt_1', label: '選項A', requirement: '無' };
    const optB = { id: 'opt_2', label: '選項B', requirement: '補充條件' };

    // 1. Add option A (without "無")
    const r1 = toggleOptionInInput('', optA);
    expect(r1.added).toBe(true);
    expect(r1.hasRequirement).toBe(false);
    expect(r1.nextInput).toBe('選項A');
    expect(isOptionInInput(r1.nextInput, optA)).toBe(true);

    // 2. Multi-select: add option B while keeping option A
    const r2 = toggleOptionInInput(r1.nextInput, optB);
    expect(r2.added).toBe(true);
    expect(r2.hasRequirement).toBe(true);
    expect(r2.nextInput).toBe('選項A\n選項B（補充條件：）');
    expect(isOptionInInput(r2.nextInput, optA)).toBe(true);
    expect(isOptionInInput(r2.nextInput, optB)).toBe(true);

    // 3. Click option A again to remove it from input
    const r3 = toggleOptionInInput(r2.nextInput, optA);
    expect(r3.added).toBe(false);
    expect(r3.nextInput).toBe('選項B（補充條件：）');
    expect(isOptionInInput(r3.nextInput, optA)).toBe(false);
    expect(isOptionInInput(r3.nextInput, optB)).toBe(true);

    // 4. Remove option B even after user filled in details inside parentheses
    const editedInput = '補充備註\n選項B（補充條件：明天上午）';
    expect(isOptionInInput(editedInput, optB)).toBe(true);
    const r4 = toggleOptionInInput(editedInput, optB);
    expect(r4.added).toBe(false);
    expect(r4.nextInput).toBe('補充備註');
  });
});
