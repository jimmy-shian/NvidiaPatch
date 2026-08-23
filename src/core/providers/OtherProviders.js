/**
 * GroqProvider, OllamaProvider, OpenRouterProvider extensions
 */
import { OpenAICompatibleProvider } from './OpenAICompatibleProvider';

export class GroqProvider extends OpenAICompatibleProvider {
  constructor(config = {}) {
    super({
      id: 'groq',
      name: 'Groq',
      baseUrl: config.baseUrl || 'https://api.groq.com/openai/v1',
      apiKey: config.apiKey || '',
      ...config
    });
  }
}

export class OllamaProvider extends OpenAICompatibleProvider {
  constructor(config = {}) {
    super({
      id: 'ollama',
      name: 'Ollama (Local)',
      baseUrl: config.baseUrl || 'http://10.0.2.2:11434/v1', // 10.0.2.2 points to host localhost in Android emulator
      apiKey: config.apiKey || 'ollama',
      ...config
    });
  }
}

export class OpenRouterProvider extends OpenAICompatibleProvider {
  constructor(config = {}) {
    super({
      id: 'openrouter',
      name: 'OpenRouter',
      baseUrl: config.baseUrl || 'https://openrouter.ai/api/v1',
      apiKey: config.apiKey || '',
      ...config
    });
  }
}
