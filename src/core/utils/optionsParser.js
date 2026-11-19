/**
 * Options Block Parser
 * Parses structured <options>...</options> blocks produced by the LLM
 * into clean, renderable option sets and markdown segments.
 *
 * Designed with tolerance for streaming tokens and malformed tags.
 */

const NON_MEANINGFUL_REQUIREMENTS = new Set([
  '無',
  '无',
  '無需',
  '无需',
  '無須',
  '无须',
  '無需補充',
  '无需补充',
  '無須補充',
  '无须补充',
  '不用',
  '不需要',
  '不用補充',
  '不需要補充',
  '沒有',
  '没有',
  '暫無',
  '暂无',
  '皆無',
  'none',
  'no',
  'n/a',
  'na',
  'null',
  'nil',
  'false',
  '-',
  '—',
  '–',
  '無（可直接執行）',
  '無(可直接執行)'
]);

/**
 * Checks whether an option's requirement attribute actually asks for user input.
 * Filters out placeholder values like "無", "無需補充", "none", etc.
 */
export function isMeaningfulRequirement(req) {
  if (!req || typeof req !== 'string') return false;
  const normalized = req
    .trim()
    .replace(/[。！!.,，、：:；;\s]+$/g, '')
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  return !NON_MEANINGFUL_REQUIREMENTS.has(normalized);
}

/**
 * Formats an option into the text inserted into the chat input box.
 */
export function formatOptionDraft(opt) {
  const val = String(opt?.label || opt?.value || '').trim();
  if (!val) return '';
  if (isMeaningfulRequirement(opt?.requirement)) {
    return `${val}（${opt.requirement.trim()}：）`;
  }
  return val;
}

function matchesOptionLine(line, opt) {
  const val = String(opt?.label || opt?.value || '').trim();
  if (!val) return false;
  const trimmed = String(line || '').trim();
  if (!trimmed) return false;
  if (trimmed === val) return true;
  const draft = formatOptionDraft(opt);
  if (draft && trimmed === draft) return true;
  if (isMeaningfulRequirement(opt?.requirement)) {
    const reqPrefix = `${val}（${opt.requirement.trim()}：`;
    if (trimmed.startsWith(reqPrefix) && trimmed.endsWith('）')) {
      return true;
    }
  }
  return false;
}

/**
 * Checks whether the given option is currently present in the chat input text.
 */
export function isOptionInInput(inputText, opt) {
  if (!inputText || typeof inputText !== 'string') return false;
  const val = String(opt?.label || opt?.value || '').trim();
  if (!val) return false;
  return inputText.split(/\r?\n/).some((line) => matchesOptionLine(line, opt));
}

/**
 * Toggles an option in/out of the chat input text (multi-select & click-again-to-remove).
 */
export function toggleOptionInInput(inputText, opt) {
  const val = String(opt?.label || opt?.value || '').trim();
  if (!val) {
    return {
      nextInput: typeof inputText === 'string' ? inputText : '',
      added: false,
      hasRequirement: false
    };
  }

  const current = typeof inputText === 'string' ? inputText : '';
  const hasReq = isMeaningfulRequirement(opt?.requirement);

  if (isOptionInInput(current, opt)) {
    const remainingLines = current
      .split(/\r?\n/)
      .filter((line) => !matchesOptionLine(line, opt));
    const nextInput = remainingLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return {
      nextInput,
      added: false,
      hasRequirement: false
    };
  }

  const draft = formatOptionDraft(opt);
  const trimmed = current.trim();
  const nextInput = trimmed ? `${trimmed}\n${draft}` : draft;
  return {
    nextInput,
    added: true,
    hasRequirement: hasReq
  };
}

/**
 * Extracts attribute value by name (supporting single, double, or unquoted values)
 */
function extractAttr(attrString, attrName) {
  const regex = new RegExp(`${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = attrString.match(regex);
  if (!match) return '';
  return match[1] ?? match[2] ?? match[3] ?? '';
}

/**
 * Parses individual <option> items inside an <options> body
 */
function parseOptionItems(innerXml) {
  const options = [];
  // Match either <option .../> or <option ...>inner</option>
  const optionRegex = /<option\b([^>]*?)(?:\/>|>([\s\S]*?)<\/option>)/gi;
  let match;

  while ((match = optionRegex.exec(innerXml)) !== null) {
    const rawAttrs = match[1] || '';
    const innerText = (match[2] || '').trim();

    const label = extractAttr(rawAttrs, 'label') ||
      extractAttr(rawAttrs, 'name') ||
      extractAttr(rawAttrs, 'title') ||
      extractAttr(rawAttrs, 'text');
    const desc = extractAttr(rawAttrs, 'desc') || extractAttr(rawAttrs, 'description') || innerText;
    const rawRequirement = extractAttr(rawAttrs, 'requirement') || extractAttr(rawAttrs, 'hint') || extractAttr(rawAttrs, 'require');
    const requirement = isMeaningfulRequirement(rawRequirement) ? rawRequirement.trim() : '';
    const value = extractAttr(rawAttrs, 'value') || label || innerText;

    if (label || desc) {
      options.push({
        id: `opt_${options.length + 1}`,
        label: label || desc,
        desc: label ? desc : '',
        requirement,
        value: value || label || desc
      });
    }
  }

  // Fallback for partially typed streaming option tag: <option label="foo" desc="bar"
  if (options.length === 0) {
    const partialMatch = innerXml.match(/<option\b([^>]+)$/i);
    if (partialMatch) {
      const rawAttrs = partialMatch[1];
      const label = extractAttr(rawAttrs, 'label') ||
        extractAttr(rawAttrs, 'name') ||
        extractAttr(rawAttrs, 'title') ||
        extractAttr(rawAttrs, 'text');
      const desc = extractAttr(rawAttrs, 'desc');
      const rawRequirement = extractAttr(rawAttrs, 'requirement') || extractAttr(rawAttrs, 'hint') || extractAttr(rawAttrs, 'require');
      const requirement = isMeaningfulRequirement(rawRequirement) ? rawRequirement.trim() : '';
      if (label) {
        options.push({
          id: 'opt_1',
          label,
          desc: desc || '',
          requirement,
          value: label
        });
      }
    }
  }

  return options;
}

/**
 * Unwrap code fences if the LLM mistakenly wrapped <options>...</options> inside ```xml ... ```
 */
function unwrapFencedOptions(content) {
  return content
    .replace(/```(?:xml|html|options)?\s*\r?\n?\s*(<options\b[\s\S]*?<\/options>)\s*\r?\n?\s*```/gi, '$1')
    .replace(/```(?:xml|html|options)?\s*\r?\n?\s*(<options\b[\s\S]*)$/i, '$1');
}

/**
 * Main parser: splits text into Markdown segments and Options segments
 * @param {string} content - Raw message text
 * @returns {Array<{ type: 'markdown' | 'options', content?: string, title?: string, options?: Array }>}
 */
export function parseOptionsBlocks(content) {
  if (!content || typeof content !== 'string') {
    return [{ type: 'markdown', content: '' }];
  }

  // Fast path: if no <options tag, return original content as single markdown block
  if (!/<options\b/i.test(content)) {
    return [{ type: 'markdown', content }];
  }

  const normalizedContent = unwrapFencedOptions(content);
  const segments = [];
  // Match closed <options ...>...</options> or open/streaming <options ...>... (until end of string)
  const optionsBlockRegex = /<options\b([^>]*)>([\s\S]*?)(?:<\/options>|$)/gi;
  let lastIndex = 0;
  let match;

  while ((match = optionsBlockRegex.exec(normalizedContent)) !== null) {
    const matchIndex = match.index;
    // Prefix markdown text
    if (matchIndex > lastIndex) {
      const prefixText = normalizedContent.slice(lastIndex, matchIndex).trim();
      if (prefixText) {
        segments.push({ type: 'markdown', content: prefixText });
      }
    }

    const rawAttrs = match[1] || '';
    const innerXml = match[2] || '';
    const title = extractAttr(rawAttrs, 'title') || extractAttr(rawAttrs, 'header') || extractAttr(rawAttrs, 'label');
    const parsedItems = parseOptionItems(innerXml);

    if (parsedItems.length > 0) {
      segments.push({
        type: 'options',
        title: title || '',
        options: parsedItems
      });
    } else {
      // If parsing yielded nothing (malformed XML or empty), keep as markdown safely
      segments.push({ type: 'markdown', content: match[0] });
    }

    lastIndex = matchIndex + match[0].length;
  }

  // Trailing markdown text
  if (lastIndex < normalizedContent.length) {
    const suffixText = normalizedContent.slice(lastIndex).trim();
    if (suffixText) {
      segments.push({ type: 'markdown', content: suffixText });
    }
  }

  return segments.length > 0 ? segments : [{ type: 'markdown', content: normalizedContent }];
}

/**
 * Strips <options>...</options> blocks and standalone <option> tags,
 * returning only the clean body text for clipboard copy.
 */
export function stripOptionsBlocks(content) {
  if (!content || typeof content !== 'string') return '';
  return unwrapFencedOptions(content)
    .replace(/<options\b[^>]*>[\s\S]*?(?:<\/options>|$)/gi, '')
    .replace(/<option\b[^>]*?(?:\/>|>[\s\S]*?<\/option>)/gi, '')
    .replace(/<widget-summary\b[^>]*>[\s\S]*?(?:<\/widget-summary>|$)/gi, '')
    .replace(/<meihua-numbers[^>]*>.*?<\/meihua-numbers>|<meihua-numbers[^>]*\/>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
