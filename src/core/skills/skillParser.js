/**
 * Skill Parser
 * Parses markdown with YAML frontmatter into structured Skill objects.
 */
export function parseSkillMarkdown(rawText, fallbackId = '') {
  if (!rawText || typeof rawText !== 'string') {
    return null;
  }

  const trimmed = rawText.trim();
  const frontmatterMatch = trimmed.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);

  if (!frontmatterMatch) {
    // No frontmatter, treat whole file as instructions
    return {
      id: fallbackId || `skill_${Date.now()}`,
      name: fallbackId || 'Custom Skill',
      description: 'Imported skill',
      icon: '⚡',
      toolsRequired: [],
      instructions: trimmed,
      rawContent: trimmed
    };
  }

  const [, frontmatterRaw, instructions] = frontmatterMatch;
  const metadata = parseSimpleYaml(frontmatterRaw);

  const id = metadata.name || fallbackId || `skill_${Date.now()}`;
  const name = metadata.name || fallbackId || 'Unnamed Skill';
  const description = metadata.description || '';
  const icon = metadata.icon || '🛠️';
  const toolsRequired = Array.isArray(metadata.tools_required) 
    ? metadata.tools_required 
    : (typeof metadata.tools_required === 'string' ? [metadata.tools_required] : []);

  return {
    id: id.toLowerCase().replace(/\s+/g, '-'),
    name,
    description,
    icon,
    toolsRequired,
    instructions: instructions.trim(),
    rawContent: rawText
  };
}

/**
 * Lightweight YAML parser for frontmatter
 */
function parseSimpleYaml(yamlStr) {
  const result = {};
  const lines = yamlStr.split('\n');
  let currentKey = null;

  for (let line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Array item under currentKey
    if (trimmed.startsWith('-') && currentKey) {
      const val = trimmed.slice(1).trim().replace(/^['"]|['"]$/g, '');
      if (!Array.isArray(result[currentKey])) {
        result[currentKey] = [];
      }
      result[currentKey].push(val);
      continue;
    }

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx > 0) {
      const key = trimmed.slice(0, colonIdx).trim();
      let value = trimmed.slice(colonIdx + 1).trim();

      // Remove enclosing quotes
      value = value.replace(/^['"]|['"]$/g, '');

      // Multi-line / folded block marker
      if (value === '>' || value === '>-' || value === '|' || value === '|-') {
        currentKey = key;
        result[key] = '';
      } else if (value.startsWith('[') && value.endsWith(']')) {
        // Simple inline array: [a, b]
        const items = value.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
        result[key] = items;
        currentKey = key;
      } else {
        result[key] = value;
        currentKey = key;
      }
    } else if (currentKey && typeof result[currentKey] === 'string') {
      // Continuation of folded string
      result[currentKey] += (result[currentKey] ? ' ' : '') + trimmed;
    }
  }

  return result;
}
