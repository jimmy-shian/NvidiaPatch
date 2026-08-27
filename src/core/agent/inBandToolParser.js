/**
 * In-Band Tool Call Parser
 * Parses XML/JSON tool calls generated within LLM text content (Nemotron, Qwen, DeepSeek, Llama).
 * Supports:
 * 1. XML style (Nemotron/ChatML):
 *    <tool_call>
 *    <function=web_search>
 *    <parameter=query>
 *    "query text"
 *    </parameter>
 *    </function>
 *    </tool_call>
 * 
 * 2. XML style with attributes:
 *    <tool_call>
 *    <function name="web_search">
 *    <parameter name="query">query text</parameter>
 *    </function>
 *    </tool_call>
 * 
 * 3. JSON style inside <tool_call>:
 *    <tool_call>
 *    {"name": "web_search", "arguments": {"query": "query text"}}
 *    </tool_call>
 * 
 * 4. Markdown code block ```tool_call ... ```
 */

export function parseInBandToolCalls(text) {
  if (!text || typeof text !== 'string') {
    return { toolCalls: [], cleanedText: text || '' };
  }

  const toolCalls = [];
  let cleanedText = text;

  const processBlock = (rawBlock) => {
    const trimmed = rawBlock.trim();

    // A. Try parsing as JSON
    let parsedJson = null;
    try {
      parsedJson = JSON.parse(trimmed);
    } catch (_) {
      const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch) {
        try {
          parsedJson = JSON.parse(codeBlockMatch[1]);
        } catch (_) {}
      }
    }

    if (parsedJson && typeof parsedJson === 'object') {
      const toolName = parsedJson.name || parsedJson.function?.name || parsedJson.tool;
      const toolArgs = parsedJson.arguments || parsedJson.parameters || parsedJson.function?.parameters || parsedJson.function?.arguments || {};
      if (toolName) {
        toolCalls.push({
          id: `call_inband_${Date.now()}_${toolCalls.length}`,
          type: 'function',
          function: {
            name: toolName.trim(),
            arguments: typeof toolArgs === 'string' ? toolArgs : JSON.stringify(toolArgs)
          }
        });
        return;
      }
    }

    // B. Parse XML format: <function=name> or <function name="name">
    const funcNameMatch = trimmed.match(/<function(?:\s+name=|\s*=|=)\s*["']?([^"'>\s]+)["']?/i);
    const toolName = funcNameMatch ? funcNameMatch[1] : null;

    if (toolName) {
      const args = {};
      const paramRegex = /<parameter(?:\s+name=|\s*=|=)\s*["']?([^"'>\s]+)["']?>([\s\S]*?)<\/parameter>/gi;
      let paramMatch;
      let foundParam = false;

      while ((paramMatch = paramRegex.exec(trimmed)) !== null) {
        foundParam = true;
        const paramName = paramMatch[1].trim();
        let paramValue = paramMatch[2].trim();

        // If wrapped in clean JSON quotes or objects
        if ((paramValue.startsWith('{') && paramValue.endsWith('}')) ||
            (paramValue.startsWith('[') && paramValue.endsWith(']'))) {
          try {
            paramValue = JSON.parse(paramValue);
          } catch (_) {}
        }
        args[paramName] = paramValue;
      }

      // If no <parameter> tag but content inside <function>...</function>
      if (!foundParam) {
        const innerContent = trimmed
          .replace(/<function(?:\s+name=|\s*=|=)\s*["']?[^"'>\s]+["']?>/i, '')
          .replace(/<\/function>/i, '')
          .trim();
        if (innerContent) {
          try {
            const innerJson = JSON.parse(innerContent);
            Object.assign(args, innerJson);
          } catch (_) {
            args.query = innerContent;
          }
        }
      }

      toolCalls.push({
        id: `call_inband_${Date.now()}_${toolCalls.length}`,
        type: 'function',
        function: {
          name: toolName.trim(),
          arguments: JSON.stringify(args)
        }
      });
    }
  };

  // 1. Match <tool_call>...</tool_call> blocks
  const toolCallBlockRegex = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
  let match;
  while ((match = toolCallBlockRegex.exec(text)) !== null) {
    processBlock(match[1]);
  }

  // 2. Match ```tool_call ... ``` blocks
  const markdownCodeBlockRegex = /```(?:tool_call|function_call)\s*([\s\S]*?)\s*```/gi;
  let mdMatch;
  while ((mdMatch = markdownCodeBlockRegex.exec(text)) !== null) {
    processBlock(mdMatch[1]);
  }

  // 3. Match <function_calls><invoke name="...">...</invoke></function_calls> format
  const invokeRegex = /<invoke\s+name=["']([^"']+)["']>([\s\S]*?)<\/invoke>/gi;
  let invokeMatch;
  while ((invokeMatch = invokeRegex.exec(text)) !== null) {
    const toolName = invokeMatch[1].trim();
    const invokeBody = invokeMatch[2];
    const args = {};
    const paramRegex = /<parameter\s+name=["']([^"']+)["']>([\s\S]*?)<\/parameter>/gi;
    let paramMatch;
    while ((paramMatch = paramRegex.exec(invokeBody)) !== null) {
      const pName = paramMatch[1].trim();
      let pVal = paramMatch[2].trim();
      try { pVal = JSON.parse(pVal); } catch (_) {}
      args[pName] = pVal;
    }
    toolCalls.push({
      id: `call_inband_${Date.now()}_${toolCalls.length}`,
      type: 'function',
      function: {
        name: toolName,
        arguments: JSON.stringify(args)
      }
    });
  }

  // Strip all matched tool call blocks from cleanedText
  cleanedText = cleanedText
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/<function_calls>[\s\S]*?<\/function_calls>/gi, '')
    .replace(/```(?:tool_call|function_call)\s*[\s\S]*?```/gi, '')
    .trim();

  return { toolCalls, cleanedText };
}
