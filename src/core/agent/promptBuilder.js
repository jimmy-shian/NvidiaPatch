/**
 * Prompt Builder
 * Assembles base system prompt, personal context, enabled skills, and conversation history.
 */
import { ContextManager } from '../context/contextManager';
import { SkillManager } from '../skills/skillManager';

const BASE_SYSTEM_PROMPT = `You are NvidiaPatch Mobile Chat, an intelligent, helpful, and versatile AI assistant.
Respond accurately, clearly, and format answers using GitHub Flavored Markdown with appropriate headers, bullet points, and syntax-highlighted code blocks where appropriate.`;

export async function buildCompleteMessages({
  messages = [],
  selectedSkillIds = [],
  customSystemPrompt = ''
}) {
  const systemBlocks = [];

  // 1. Base system prompt
  if (customSystemPrompt && customSystemPrompt.trim()) {
    systemBlocks.push(customSystemPrompt.trim());
  } else {
    systemBlocks.push(BASE_SYSTEM_PROMPT);
  }

  // 2. Personal Context / Background
  const contextMessage = await ContextManager.buildContextSystemMessage();
  if (contextMessage) {
    systemBlocks.push(contextMessage);
  }

  // 3. Active Skills
  const skillMessage = await SkillManager.buildSkillSystemMessage(selectedSkillIds);
  if (skillMessage) {
    systemBlocks.push(skillMessage);
  }

  const combinedSystemPrompt = systemBlocks.join('\n\n');

  return [
    { role: 'system', content: combinedSystemPrompt },
    ...messages
  ];
}
