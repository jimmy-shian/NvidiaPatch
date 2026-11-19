/**
 * Message Sanitizer for OpenAI / NVIDIA NIM / vLLM API Compliance
 * Strips non-standard metadata fields and ensures strict schema conformance:
 * - System: { role: 'system', content: string }
 * - User: { role: 'user', content: string | array }
 * - Assistant: { role: 'assistant', content: string | null, tool_calls?: array }
 * - Tool: { role: 'tool', tool_call_id: string, content: string }
 * 
 * Specifically removes 'name' from role: 'tool' to prevent vLLM/NIM
 * "400/422 Extra inputs are not permitted: name" validation failures.
 */

export function sanitizeMessagesForApi(messages = []) {
  if (!Array.isArray(messages)) return [];

  return messages.map(m => {
    if (!m || typeof m !== 'object') {
      return { role: 'user', content: String(m || '') };
    }

    const role = m.role || 'user';

    // 1. System messages
    if (role === 'system') {
      return {
        role: 'system',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '')
      };
    }

    // 2. User messages
    if (role === 'user') {
      // Support multimodal parts if images are present
      if (Array.isArray(m.images) && m.images.length > 0) {
        const parts = [];
        const textContent = typeof m.content === 'string' ? m.content.trim() : '';
        if (textContent) {
          parts.push({ type: 'text', text: textContent });
        } else {
          parts.push({ type: 'text', text: '請分析這張圖片內容。' });
        }
        for (const img of m.images) {
          const url = typeof img === 'string' ? img : img?.url;
          if (url) {
            parts.push({
              type: 'image_url',
              image_url: { url }
            });
          }
        }
        return { role: 'user', content: parts };
      }

      // If content is already array of multimodal parts
      if (Array.isArray(m.content)) {
        return { role: 'user', content: m.content };
      }

      return {
        role: 'user',
        content: typeof m.content === 'string' ? m.content : String(m.content ?? '')
      };
    }

    // 3. Assistant messages
    if (role === 'assistant') {
      const sanitized = {
        role: 'assistant',
        // In OpenAI & NVIDIA NIM spec, if tool_calls is present, content should be null
        content: (m.tool_calls && m.tool_calls.length > 0) ? (m.content || null) : (m.content ?? '')
      };

      if (Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
        sanitized.tool_calls = m.tool_calls.map(tc => ({
          id: tc.id || `call_${Date.now()}`,
          type: 'function',
          function: {
            name: tc.function?.name || '',
            arguments: typeof tc.function?.arguments === 'string'
              ? tc.function.arguments
              : JSON.stringify(tc.function?.arguments || {})
          }
        }));
      }

      return sanitized;
    }

    // 4. Tool result messages (Crucial for NVIDIA NIM & vLLM)
    if (role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: m.tool_call_id || 'call_default',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '')
        // NOTE: Strictly OMIT 'name' and any custom React/DB metadata fields!
      };
    }

    return {
      role,
      content: typeof m.content === 'string' ? m.content : String(m.content ?? '')
    };
  });
}

/**
 * Check whether message history contains native tool-calling frames (role: 'tool' or assistant tool_calls)
 */
export function hasToolProtocolMessages(messages = []) {
  return Array.isArray(messages) && messages.some(
    (m) => m && (m.role === 'tool' || (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0))
  );
}

/**
 * Convert native tool_calls / role: 'tool' messages into plain user/assistant observation messages
 * for models or providers that reject role: 'tool' on Round 2+ follow-ups.
 */
export function convertToolHistoryToObservationMessages(messages = []) {
  if (!Array.isArray(messages)) return [];
  const observations = [];
  const base = [];

  for (const m of messages) {
    if (!m) continue;
    if (m.role === 'tool') {
      const contentStr = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
      if (contentStr) observations.push(contentStr);
    } else if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      continue;
    } else {
      base.push(m);
    }
  }

  if (observations.length > 0) {
    base.push({ role: 'assistant', content: '我已執行搜尋與資料檢索。' });
    base.push({
      role: 'user',
      content: `【檢索資料事實如下】:\n${observations.join('\n\n')}\n\n請根據以上檢索結果，直接向使用者產出完整、詳盡的正式 Markdown 回覆，並在結尾附上 <options title="延伸探索">...</options> 提供後續可選按鈕。`
    });
  }

  return base;
}
