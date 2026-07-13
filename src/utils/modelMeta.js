export const getModelEmoji = (modelId) => {
  if (!modelId) return '⚡';
  const id = modelId.toLowerCase();
  if (id.includes('llama')) return '🦙';
  if (id.includes('gpt')) return '🤖';
  if (id.includes('mistral') || id.includes('mixtral')) return '🌀';
  if (id.includes('gemma')) return '💎';
  if (id.includes('nemotron')) return '🧠';
  if (id.includes('phi')) return '🔤';
  if (id.includes('minimax') || id.includes('minimaxai')) return '🔲';
  if (id.includes('step')) return '🪜';
  if (id.includes('nvidia')) return '💚';
  if (id.includes('deepseek')) return '🔍';
  if (id.includes('qwen')) return '🐼';
  return '⚡';
};

export const getModelCategory = (modelId) => {
  if (!modelId) return 'Other';
  const id = modelId.toLowerCase();
  if (id.includes('llama')) return 'Llama';
  if (id.includes('gpt')) return 'GPT';
  if (id.includes('mistral') || id.includes('mixtral')) return 'Mistral';
  if (id.includes('gemma')) return 'Gemma';
  if (id.includes('nemotron')) return 'Nemotron';
  if (id.includes('phi')) return 'Phi';
  if (id.includes('minimax') || id.includes('minimaxai')) return 'MiniMax';
  if (id.includes('step')) return 'Step';
  if (id.includes('nvidia')) return 'Nvidia';
  return 'Other';
};
