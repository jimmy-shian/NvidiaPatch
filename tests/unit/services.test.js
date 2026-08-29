import { describe, it, expect, beforeAll, afterAll } from 'vitest';
const path = require('path');
const fs = require('fs');
const { initDatabase, closeDatabase } = require('../../database/database');
const keyService = require('../../gateway/services/KeyService');
const modelService = require('../../gateway/services/ModelService');
const rulesService = require('../../gateway/services/RulesService');
const settingsService = require('../../gateway/services/SettingsService');
const healthService = require('../../gateway/services/HealthService');
const { ValidationError } = require('../../gateway/errors/GatewayError');

const TEST_DB = path.join(__dirname, 'services-test.db');

describe('Service Layer Unit Tests', () => {
  beforeAll(() => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    initDatabase(TEST_DB);
  });

  afterAll(() => {
    closeDatabase();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  describe('KeyService', () => {
    it('should validate and add new key, then return masked key', () => {
      expect(() => keyService.addKey('')).toThrow(ValidationError);
      const res = keyService.addKey('nvapi-test-service-key-12345678');
      expect(res.success).toBe(true);

      const keys = keyService.getMaskedKeys();
      expect(keys.length).toBeGreaterThan(0);
      expect(keys[0].masked_key).toContain('...');
    });

    it('should delete key correctly', () => {
      const all = keyService.getAllKeys();
      const targetId = all[0].id;
      const res = keyService.deleteKey(targetId);
      expect(res.success).toBe(true);
    });
  });

  describe('ModelService', () => {
    it('should save and retrieve model priorities', () => {
      const modelList = ['meta/llama-3.1-8b-instruct', 'meta/llama-3.1-70b-instruct'];
      const res = modelService.savePriorityList(modelList, 1);
      expect(res.success).toBe(true);

      const saved = modelService.getModels(1);
      expect(saved.length).toBe(2);
      expect(saved[0].model_id).toBe('meta/llama-3.1-8b-instruct');
    });

    it('should switch active model group', () => {
      const res = modelService.setActiveGroup(2);
      expect(res.activeGroup).toBe(2);
      const groups = modelService.getGroups();
      expect(groups.activeGroup).toBe(2);
    });

    it('should sync models from custom Base URL when configured', async () => {
      const origFetch = global.fetch;
      settingsService.updateSettings({ NVIDIA_API_URL: 'http://127.0.0.1:8765/v1/' });

      global.fetch = async (url) => {
        expect(url).toBe('http://127.0.0.1:8765/v1/models');
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            data: [
              { id: 'custom/model-alpha', name: 'Model Alpha', created: 1700000000 },
              { id: 'custom/model-beta', name: 'Model Beta', created: 1700000001 }
            ]
          }),
          json: async () => ({
            data: [
              { id: 'custom/model-alpha', name: 'Model Alpha', created: 1700000000 },
              { id: 'custom/model-beta', name: 'Model Beta', created: 1700000001 }
            ]
          })
        };
      };

      try {
        const syncResult = await modelService.syncFromNvidia('test-req-custom');
        expect(syncResult.success).toBe(true);
        expect(syncResult.savedCount).toBe(2);
        expect(syncResult.source).toBe('http://127.0.0.1:8765/v1/models');

        const avail = modelService.getAvailable();
        expect(avail.models.length).toBe(2);
        expect(avail.models.some(m => m.id === 'custom/model-alpha')).toBe(true);
        expect(avail.lastSyncSource).toBe('http://127.0.0.1:8765/v1/models');
      } finally {
        global.fetch = origFetch;
        settingsService.updateSettings({ NVIDIA_API_URL: 'https://integrate.api.nvidia.com/v1' });
      }
    });

    it('should sync models from Ollama /api/tags when base URL is http://localhost:11434', async () => {
      const origFetch = global.fetch;
      settingsService.updateSettings({ NVIDIA_API_URL: 'http://localhost:11434' });

      global.fetch = async (url) => {
        if (url === 'http://localhost:11434/models' || url === 'http://localhost:11434/v1/models') {
          return { ok: false, status: 404 };
        }
        if (url === 'http://localhost:11434/api/tags') {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              models: [
                { name: 'llama3:latest', model: 'llama3:latest', modified_at: '2024-05-01T12:00:00Z' },
                { name: 'qwen2.5-coder:7b', model: 'qwen2.5-coder:7b', modified_at: '2024-05-01T12:00:00Z' }
              ]
            })
          };
        }
        return { ok: false, status: 404 };
      };

      try {
        const syncResult = await modelService.syncFromNvidia('test-ollama');
        expect(syncResult.success).toBe(true);
        expect(syncResult.savedCount).toBe(2);
        expect(syncResult.source).toBe('http://localhost:11434/api/tags');

        const avail = modelService.getAvailable();
        expect(avail.models.some(m => m.id === 'llama3:latest')).toBe(true);
        expect(avail.models.some(m => m.id === 'qwen2.5-coder:7b')).toBe(true);
      } finally {
        global.fetch = origFetch;
        settingsService.updateSettings({ NVIDIA_API_URL: 'https://integrate.api.nvidia.com/v1' });
      }
    });

    it('should sync models from LM Studio /api/v0/models when base URL is http://localhost:1234', async () => {
      const origFetch = global.fetch;
      settingsService.updateSettings({ NVIDIA_API_URL: 'http://localhost:1234' });

      global.fetch = async (url) => {
        if (url === 'http://localhost:1234/models' || url === 'http://localhost:1234/v1/models' || url === 'http://localhost:1234/api/tags') {
          return { ok: false, status: 404 };
        }
        if (url === 'http://localhost:1234/api/v0/models') {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              models: [
                { id: 'deepseek-coder-v2-lite', type: 'llm', loaded: true },
                { id: 'mistral-nemo-instruct-2407', type: 'llm', loaded: false }
              ]
            })
          };
        }
        return { ok: false, status: 404 };
      };

      try {
        const syncResult = await modelService.syncFromNvidia('test-lmstudio');
        expect(syncResult.success).toBe(true);
        expect(syncResult.savedCount).toBe(2);
        expect(syncResult.source).toBe('http://localhost:1234/api/v0/models');

        const avail = modelService.getAvailable();
        expect(avail.models.some(m => m.id === 'deepseek-coder-v2-lite')).toBe(true);
      } finally {
        global.fetch = origFetch;
        settingsService.updateSettings({ NVIDIA_API_URL: 'https://integrate.api.nvidia.com/v1' });
      }
    });
  });

  describe('RulesService', () => {
    it('should create, update and delete custom rules', () => {
      expect(() => rulesService.addRule('', 'content')).toThrow(ValidationError);
      const addRes = rulesService.addRule('Test Rule', 'You are a helpful assistant');
      expect(addRes.success).toBe(true);

      const all = rulesService.getAllRules();
      const customRule = all.find(r => r.title === 'Test Rule');
      expect(customRule).toBeDefined();

      const updateRes = rulesService.updateRule(customRule.id, 'Updated Title', 'Updated content');
      expect(updateRes.success).toBe(true);

      const delRes = rulesService.deleteRule(customRule.id);
      expect(delRes.success).toBe(true);
    });
  });

  describe('SettingsService', () => {
    it('should validate invalid settings parameters', () => {
      expect(() => settingsService.updateSettings({ PORT: 999999 })).toThrow(ValidationError);
      expect(() => settingsService.updateSettings({ ROUND_DELAY_MS: 0 })).toThrow(ValidationError);
    });

    it('should update and retrieve formatted settings in seconds', () => {
      const res = settingsService.updateSettings({
        ROUND_DELAY_MS: 10,
        REQUEST_TIMEOUT_MS: 60,
        PORT: 4000
      });
      expect(res.ROUND_DELAY_MS).toBe(10);
      expect(res.REQUEST_TIMEOUT_MS).toBe(60);

      const raw = settingsService.getRawSettings();
      expect(raw.ROUND_DELAY_MS).toBe(10000);
    });
  });

  describe('HealthService', () => {
    it('should report database status and system metrics', async () => {
      const health = await healthService.getHealthStatus(false);
      expect(health.status).toBeDefined();
      expect(health.metrics).toBeDefined();
      expect(health.metrics.memory.heapUsedMb).toBeGreaterThan(0);
      expect(health.dependencies.database).toBe('healthy');
    });
  });
});
