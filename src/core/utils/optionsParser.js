/**
 * Options Block Parser
 * Parses structured <options>...</options> blocks produced by the LLM
 * into clean, renderable option sets and markdown segments.
 *
 * Designed with tolerance for streaming tokens and malformed tags.
 */

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

    const label = extractAttr(rawAttrs, 'label') || extractAttr(rawAttrs, 'name') || extractAttr(rawAttrs, 'title');
    const desc = extractAttr(rawAttrs, 'desc') || extractAttr(rawAttrs, 'description') || innerText;
    const requirement = extractAttr(rawAttrs, 'requirement') || extractAttr(rawAttrs, 'hint') || extractAttr(rawAttrs, 'require');
    const value = extractAttr(rawAttrs, 'value') || label;

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
      const label = extractAttr(rawAttrs, 'label') || extractAttr(rawAttrs, 'name');
      const desc = extractAttr(rawAttrs, 'desc');
      if (label) {
        options.push({
          id: 'opt_1',
          label,
          desc: desc || '',
          value: label
        });
      }
    }
  }

  return options;
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

  const segments = [];
  // Match closed <options ...>...</options> or open/streaming <options ...>... (until end of string)
  const optionsBlockRegex = /<options\b([^>]*)>([\s\S]*?)(?:<\/options>|$)/gi;
  let lastIndex = 0;
  let match;

  while ((match = optionsBlockRegex.exec(content)) !== null) {
    const matchIndex = match.index;
    // Prefix markdown text
    if (matchIndex > lastIndex) {
      const prefixText = content.slice(lastIndex, matchIndex).trim();
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
  if (lastIndex < content.length) {
    const suffixText = content.slice(lastIndex).trim();
    if (suffixText) {
      segments.push({ type: 'markdown', content: suffixText });
    }
  }

  return segments.length > 0 ? segments : [{ type: 'markdown', content }];
}
