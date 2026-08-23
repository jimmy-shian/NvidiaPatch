/**
 * Provider Registry & Factory
 */
import { NvidiaNimProvider } from './NvidiaNimProvider';
import { OpenAICompatibleProvider } from './OpenAICompatibleProvider';
import { GroqProvider, OllamaProvider, OpenRouterProvider } from './OtherProviders';

export const PROVIDER_TYPES = [
  { id: 'nvidia', name: 'NVIDIA NIM', defaultEndpoint: 'https://integrate.api.nvidia.com/v1', requiresKey: true, isDefault: true },
  { id: 'openai_compat', name: 'Custom OpenAI Compatible', defaultEndpoint: 'https://api.openai.com/v1', requiresKey: true },
  { id: 'groq', name: 'Groq', defaultEndpoint: 'https://api.groq.com/openai/v1', requiresKey: true },
  { id: 'openrouter', name: 'OpenRouter', defaultEndpoint: 'https://openrouter.ai/api/v1', requiresKey: true },
  { id: 'ollama', name: 'Ollama (Local/LAN)', defaultEndpoint: 'http://10.0.2.2:11434/v1', requiresKey: false }
];

export function createProvider(type, config = {}) {
  switch (type) {
    case 'nvidia':
      return new NvidiaNimProvider(config);
    case 'groq':
      return new GroqProvider(config);
    case 'ollama':
      return new OllamaProvider(config);
    case 'openrouter':
      return new OpenRouterProvider(config);
    case 'openai_compat':
    default:
      return new OpenAICompatibleProvider(config);
  }
}
