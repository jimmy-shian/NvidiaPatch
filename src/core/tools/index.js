/**
 * System Tools Registry & Dispatcher
 */
import { WEB_SEARCH_TOOL_DEFINITION, executeWebSearch } from './webSearch';

export const SYSTEM_TOOLS = [
  WEB_SEARCH_TOOL_DEFINITION
];

export async function executeTool(name, args, options = {}) {
  switch (name) {
    case 'web_search':
      return executeWebSearch(args, options);
    default:
      throw new Error(`Tool "${name}" is not implemented`);
  }
}
