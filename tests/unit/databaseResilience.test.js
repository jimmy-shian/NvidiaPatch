import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
const { initDatabase, ensureDatabase, isDatabaseReady, closeDatabase } = require('../../database/database');
const rootDb = require('../../database');

const TEST_DB = path.join(__dirname, 'resilience-test.db');
const NESTED_TEST_DIR = path.join(__dirname, 'test-new-install-nested');
const NESTED_TEST_DB = path.join(NESTED_TEST_DIR, 'gateway.db');

function cleanupDbFiles() {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  if (fs.existsSync(NESTED_TEST_DIR)) {
    fs.rmSync(NESTED_TEST_DIR, { recursive: true, force: true });
  }
}

describe('Database resilience (initDatabase / ensureDatabase)', () => {
  beforeAll(() => {
    cleanupDbFiles();
  });

  afterAll(() => {
    closeDatabase();
    cleanupDbFiles();
  });

  it('should re-export resilience methods from root database.js facade', () => {
    expect(typeof rootDb.ensureDatabase).toBe('function');
    expect(typeof rootDb.isDatabaseReady).toBe('function');
    expect(typeof rootDb.initDatabase).toBe('function');
    expect(typeof rootDb.closeDatabase).toBe('function');
  });

  it('should report not-ready before init and ready after init', () => {
    expect(isDatabaseReady()).toBe(false);
    initDatabase(TEST_DB);
    expect(isDatabaseReady()).toBe(true);
  });

  it('should automatically create parent directories on fresh install', async () => {
    closeDatabase();
    expect(fs.existsSync(NESTED_TEST_DIR)).toBe(false);

    // 模擬全新安裝時 userData 目錄尚未建立的情境
    const ok = await ensureDatabase(NESTED_TEST_DB);
    expect(ok).toBe(true);
    expect(isDatabaseReady()).toBe(true);
    expect(fs.existsSync(NESTED_TEST_DIR)).toBe(true);

    closeDatabase();
  });

  it('should be idempotent when already ready', async () => {
    const db1 = initDatabase(TEST_DB);
    const db2 = initDatabase(TEST_DB);
    expect(db2).toBe(db1);
    expect(await ensureDatabase(TEST_DB)).toBe(true);
  });

  it('should roll back to not-ready after close and re-init via ensureDatabase', async () => {
    initDatabase(TEST_DB);
    expect(isDatabaseReady()).toBe(true);

    closeDatabase();
    expect(isDatabaseReady()).toBe(false);

    // 模擬「重新啟動 Gateway」後的資料庫就緒檢查：等待後自動重建
    expect(await ensureDatabase(TEST_DB)).toBe(true);
    expect(isDatabaseReady()).toBe(true);
  });

  it('should return false after bounded retries when the DB path is unusable', async () => {
    // 以不存在的虛擬磁碟機模擬無法建立目錄與寫入的非法路徑
    const badPath = 'Z:/non-existent-drive/unusable/gateway.db';

    closeDatabase();
    // 4 次重試後必須回傳 false，且不得留下被誤判為可用的半初始化 handle
    const ok = await ensureDatabase(badPath);
    expect(ok).toBe(false);
    expect(isDatabaseReady()).toBe(false);

    // 路徑恢復後可立即自癒
    expect(await ensureDatabase(TEST_DB)).toBe(true);
  }, 20000);
});
