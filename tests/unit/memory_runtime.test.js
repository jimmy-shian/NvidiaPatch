import { describe, it, expect, beforeAll, afterAll } from 'vitest';
const path = require('path');
const fs = require('fs');
const { initDatabase, closeDatabase, stats, tokenUsage, apiKeys, settings, modelsConfig } = require('../../database/database');

const TEST_DB = path.join(__dirname, 'memory-runtime-test.db');

describe('In-Memory Runtime & Zero-Write Cache Tests', () => {
  beforeAll(() => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    initDatabase(TEST_DB);
  });

  afterAll(() => {
    closeDatabase();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  describe('Stats In-Memory Runtime Store', () => {
    it('should record requests in RAM and return accurate hourly stats without SQLite writes', () => {
      stats.reset();
      expect(stats.getStats().totalRequests).toBe(0);

      // Record multiple successes and failures
      stats.recordRequest(true);
      stats.recordRequest(true);
      stats.recordRequest(false);

      const currentStats = stats.getStats();
      expect(currentStats.totalRequests).toBe(3);
      expect(currentStats.successRequests).toBe(2);
      expect(currentStats.errorRequests).toBe(1);

      const hourly = stats.getHourlyStats();
      expect(hourly.length).toBeGreaterThan(0);
      const latest = hourly[hourly.length - 1];
      expect(latest.request_count).toBe(3);
      expect(latest.success_count).toBe(2);
      expect(latest.error_count).toBe(1);

      // Reset
      stats.reset();
      expect(stats.getStats().totalRequests).toBe(0);
      expect(stats.getHourlyStats().length).toBe(0);
    });
  });

  describe('Token Usage In-Memory Ring Buffer (Max 50)', () => {
    it('should store records in a bounded ring buffer and calculate O(1) aggregates', () => {
      tokenUsage.clear();
      expect(tokenUsage.getLogs().length).toBe(0);
      expect(tokenUsage.getStats().length).toBe(0);

      // Insert 60 records
      for (let i = 1; i <= 60; i++) {
        tokenUsage.addRecord(`req-${i}`, 'test-model-a', 10, 20, { messages: ['hello'] }, 'hi');
      }

      // Ring buffer should cap at 50 records
      const logs = tokenUsage.getLogs(100);
      expect(logs.length).toBe(50);
      // Most recent should be first
      expect(logs[0].request_id).toBe('req-60');

      // Model aggregate stats should reflect all 60 requests
      const modelStats = tokenUsage.getStats();
      expect(modelStats.length).toBe(1);
      expect(modelStats[0].model_id).toBe('test-model-a');
      expect(modelStats[0].request_count).toBe(60);
      expect(modelStats[0].total_prompt_tokens).toBe(600);
      expect(modelStats[0].total_completion_tokens).toBe(1200);
      expect(modelStats[0].total_total_tokens).toBe(1800);

      // Get detail
      const detailId = logs[0].id;
      const detail = tokenUsage.getDetail(detailId);
      expect(detail).toBeDefined();
      expect(detail.request_id).toBe('req-60');

      // Clear
      tokenUsage.clear();
      expect(tokenUsage.getLogs().length).toBe(0);
      expect(tokenUsage.getStats().length).toBe(0);
    });
  });

  describe('API Keys Volatile Runtime Cooldown & Lazy Expiration', () => {
    it('should handle runtime cooldown and lazy expiration purely in memory', () => {
      const addRes = apiKeys.add('nvapi-cooldown-test-key');
      expect(addRes.success).toBe(true);

      const allKeys = apiKeys.getAll();
      const testKey = allKeys.find(k => k.key_value === 'nvapi-cooldown-test-key');
      expect(testKey).toBeDefined();
      expect(testKey.status).toBe('active');

      // Put into 1 second cooldown
      apiKeys.recordCooldown(testKey.id, 1, 'Rate limited');
      expect(apiKeys.getKeyStatus(testKey.id)).toBe('cooldown');

      const activeKeysBefore = apiKeys.getActiveKeys();
      expect(activeKeysBefore.some(k => k.id === testKey.id)).toBe(false);

      // Record success should reset cooldown
      apiKeys.recordSuccess(testKey.id);
      expect(apiKeys.getKeyStatus(testKey.id)).toBe('active');

      const activeKeysAfter = apiKeys.getActiveKeys();
      expect(activeKeysAfter.some(k => k.id === testKey.id)).toBe(true);

      // Clean up
      apiKeys.delete(testKey.id);
    });
  });

  describe('Settings Dirty-Check & In-Memory Read Cache', () => {
    it('should read from RAM cache and avoid writes if values did not change', () => {
      const s1 = settings.get();
      expect(s1.PORT).toBeDefined();

      // Save same values (dirty check returns cached without write)
      const s2 = settings.save({ PORT: s1.PORT });
      expect(s2.PORT).toBe(s1.PORT);

      // Save new value
      const s3 = settings.save({ ROUND_DELAY_MS: 18000 });
      expect(s3.ROUND_DELAY_MS).toBe(18000);
      expect(settings.get().ROUND_DELAY_MS).toBe(18000);
    });
  });

  describe('Model Config Dirty-Check & In-Memory Cache', () => {
    it('should read group config from memory cache', () => {
      const activeGroup = modelsConfig.getActiveGroup();
      expect([1, 2, 3]).toContain(activeGroup);

      const groups = modelsConfig.getGroups();
      expect(groups.groups.length).toBe(3);

      // Save priority list
      const saveRes = modelsConfig.savePriorityList(['model-x', 'model-y'], 1);
      expect(saveRes.success).toBe(true);

      const g1Models = modelsConfig.getAll(1);
      expect(g1Models.length).toBe(2);
      expect(g1Models[0].model_id).toBe('model-x');
    });
  });
});
