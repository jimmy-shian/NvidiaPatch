function stripCodeBlocks(content) {
  if (!content) return '';
  // 1. Strip closed triple-backtick code blocks
  let clean = content.replace(/```[\s\S]*?```/g, ' ');
  // 2. Strip any remaining unclosed triple-backtick code block at the end
  clean = clean.replace(/```[\s\S]*/g, ' ');
  // 3. Strip closed single-backtick code blocks
  clean = clean.replace(/`[\s\S]*?`/g, ' ');
  // 4. Strip any remaining unclosed single-backtick code block at the end
  clean = clean.replace(/`[\s\S]*/g, ' ');
  return clean;
}

function validateContent(content) {
  if (!content || typeof content !== 'string') {
    return { valid: true, unclosedTags: [], malformedTags: [], mismatchedTags: [] };
  }

  const cleanContent = stripCodeBlocks(content);
  const malformedTags = [];

  for (let i = 0; i < cleanContent.length; i++) {
    if (cleanContent[i] !== '<') continue;

    const nextChar = cleanContent[i + 1] || '';

    if (nextChar === '>') {
      malformedTags.push('<>');
      continue;
    }
    if (!/[A-Za-z/!?]/.test(nextChar)) {
      continue;
    }

    const closeIndex = cleanContent.indexOf('>', i + 1);
    const nextOpenIndex = cleanContent.indexOf('<', i + 1);
    if (closeIndex === -1 || (nextOpenIndex !== -1 && nextOpenIndex < closeIndex)) {
      const endIndex = nextOpenIndex !== -1 && nextOpenIndex < closeIndex ? nextOpenIndex : Math.min(cleanContent.length, i + 80);
      const fragment = cleanContent.slice(i, endIndex).replace(/\s+/g, ' ').trim();
      malformedTags.push(fragment || '<');
      if (nextOpenIndex === -1) break;
      i = Math.max(i, nextOpenIndex - 1);
    }
  }

  if (malformedTags.length > 0) {
    return {
      valid: false,
      unclosedTags: [],
      malformedTags: [...new Set(malformedTags)].slice(0, 8),
      mismatchedTags: []
    };
  }

  const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9:_-]*)\b[^>]*(\/?)>/g;
  const selfClosingTags = new Set([
    'br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col',
    'embed', 'source', 'track', 'wbr', 'frame', 'param', 'spacer',
    'circle', 'ellipse', 'line', 'path', 'polygon', 'polyline', 'rect', 'stop', 'use'
  ]);
  
  const stack = [];
  const mismatchedTags = [];
  let match;

  while ((match = tagRegex.exec(cleanContent)) !== null) {
    const fullTag = match[0];
    const tagName = match[1].toLowerCase();
    const isSelfClosing = match[2] === '/' || fullTag.endsWith('/>');
    const isClosingTag = fullTag.startsWith('</');

    if (isSelfClosing || selfClosingTags.has(tagName) || fullTag.startsWith('<!') || fullTag.startsWith('<?')) {
      continue;
    }

    if (isClosingTag) {
      if (stack.length > 0 && stack[stack.length - 1] === tagName) {
        stack.pop();
      } else {
        mismatchedTags.push(`</${tagName}>`);
      }
    } else {
      stack.push(tagName);
    }
  }

  if (stack.length > 0 || mismatchedTags.length > 0) {
    return {
      valid: false,
      unclosedTags: [...new Set(stack)],
      malformedTags: [],
      mismatchedTags: [...new Set(mismatchedTags)].slice(0, 8)
    };
  }

  return { valid: true, unclosedTags: [], malformedTags: [], mismatchedTags: [] };
}

function formatValidationIssue(validation) {
  const issues = [];
  if (validation.unclosedTags && validation.unclosedTags.length > 0) {
    issues.push(validation.unclosedTags.map(t => `<${t}>`).join(', '));
  }
  if (validation.malformedTags && validation.malformedTags.length > 0) {
    issues.push(validation.malformedTags.join(', '));
  }
  if (validation.mismatchedTags && validation.mismatchedTags.length > 0) {
    issues.push(validation.mismatchedTags.join(', '));
  }
  return issues.join(', ') || 'unknown tag issue';
}

module.exports = {
  validateContent,
  formatValidationIssue
};
