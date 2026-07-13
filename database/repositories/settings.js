const { getDb } = require('../connection');

const settings = {
  get() {
    const db = getDb();
    const roundDelay = db.prepare("SELECT value FROM metadata WHERE key = 'ROUND_DELAY_MS'").get();
    const reqTimeout = db.prepare("SELECT value FROM metadata WHERE key = 'REQUEST_TIMEOUT_MS'").get();
    const streamTimeout = db.prepare("SELECT value FROM metadata WHERE key = 'STREAM_READ_TIMEOUT_MS'").get();
    const nvidiaUrl = db.prepare("SELECT value FROM metadata WHERE key = 'NVIDIA_API_URL'").get();
    const port = db.prepare("SELECT value FROM metadata WHERE key = 'PORT'").get();
    const maxRounds = db.prepare("SELECT value FROM metadata WHERE key = 'MAX_ROUNDS_PER_MODEL'").get();
    const testTimeout = db.prepare("SELECT value FROM metadata WHERE key = 'TEST_TIMEOUT_MS'").get();
    const modelFailureCooldown = db.prepare("SELECT value FROM metadata WHERE key = 'MODEL_FAILURE_COOLDOWN_MS'").get();
    const keyConcurrencyDelay = db.prepare("SELECT value FROM metadata WHERE key = 'KEY_CONCURRENCY_DELAY_MS'").get();
    return {
      ROUND_DELAY_MS: Number(roundDelay?.value || 15000),
      REQUEST_TIMEOUT_MS: Number(reqTimeout?.value || 120000),
      STREAM_READ_TIMEOUT_MS: Number(streamTimeout?.value || 120000),
      NVIDIA_API_URL: nvidiaUrl?.value || 'https://integrate.api.nvidia.com/v1',
      PORT: Number(port?.value || 4000),
      MAX_ROUNDS_PER_MODEL: Number(maxRounds?.value || 2),
      TEST_TIMEOUT_MS: Number(testTimeout?.value || 60000),
      MODEL_FAILURE_COOLDOWN_MS: Number(modelFailureCooldown?.value || 60000),
      KEY_CONCURRENCY_DELAY_MS: Number(keyConcurrencyDelay?.value || 5000),
      PRICE_PER_MILLION_PROMPT_TOKENS: Number(db.prepare("SELECT value FROM metadata WHERE key = 'PRICE_PER_MILLION_PROMPT_TOKENS'").get()?.value || 0.30),
      PRICE_PER_MILLION_COMPLETION_TOKENS: Number(db.prepare("SELECT value FROM metadata WHERE key = 'PRICE_PER_MILLION_COMPLETION_TOKENS'").get()?.value || 0.60),
      REF_PRICE_PER_MILLION_PROMPT_TOKENS: Number(db.prepare("SELECT value FROM metadata WHERE key = 'REF_PRICE_PER_MILLION_PROMPT_TOKENS'").get()?.value || 5.00),
      REF_PRICE_PER_MILLION_COMPLETION_TOKENS: Number(db.prepare("SELECT value FROM metadata WHERE key = 'REF_PRICE_PER_MILLION_COMPLETION_TOKENS'").get()?.value || 15.00),
      CURRENCY_SYMBOL: db.prepare("SELECT value FROM metadata WHERE key = 'CURRENCY_SYMBOL'").get()?.value || 'USD'
    };
  },
  save(config) {
    const db = getDb();
    if (config.ROUND_DELAY_MS !== undefined) {
      db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('ROUND_DELAY_MS', ?)").run(String(config.ROUND_DELAY_MS));
    }
    if (config.REQUEST_TIMEOUT_MS !== undefined) {
      db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('REQUEST_TIMEOUT_MS', ?)").run(String(config.REQUEST_TIMEOUT_MS));
    }
    if (config.STREAM_READ_TIMEOUT_MS !== undefined) {
      db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('STREAM_READ_TIMEOUT_MS', ?)").run(String(config.STREAM_READ_TIMEOUT_MS));
    }
    if (config.NVIDIA_API_URL !== undefined) {
      db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('NVIDIA_API_URL', ?)").run(String(config.NVIDIA_API_URL));
    }
    if (config.PORT !== undefined) {
      db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('PORT', ?)").run(String(config.PORT));
    }
    if (config.MAX_ROUNDS_PER_MODEL !== undefined) {
      db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('MAX_ROUNDS_PER_MODEL', ?)").run(String(config.MAX_ROUNDS_PER_MODEL));
    }
    if (config.TEST_TIMEOUT_MS !== undefined) {
      db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('TEST_TIMEOUT_MS', ?)").run(String(config.TEST_TIMEOUT_MS));
    }
    if (config.MODEL_FAILURE_COOLDOWN_MS !== undefined) {
      db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('MODEL_FAILURE_COOLDOWN_MS', ?)").run(String(config.MODEL_FAILURE_COOLDOWN_MS));
    }
    if (config.KEY_CONCURRENCY_DELAY_MS !== undefined) {
      db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('KEY_CONCURRENCY_DELAY_MS', ?)").run(String(config.KEY_CONCURRENCY_DELAY_MS));
    }
    if (config.PRICE_PER_MILLION_PROMPT_TOKENS !== undefined) {
      db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('PRICE_PER_MILLION_PROMPT_TOKENS', ?)").run(String(config.PRICE_PER_MILLION_PROMPT_TOKENS));
    }
    if (config.PRICE_PER_MILLION_COMPLETION_TOKENS !== undefined) {
      db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('PRICE_PER_MILLION_COMPLETION_TOKENS', ?)").run(String(config.PRICE_PER_MILLION_COMPLETION_TOKENS));
    }
    if (config.REF_PRICE_PER_MILLION_PROMPT_TOKENS !== undefined) {
      db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('REF_PRICE_PER_MILLION_PROMPT_TOKENS', ?)").run(String(config.REF_PRICE_PER_MILLION_PROMPT_TOKENS));
    }
    if (config.REF_PRICE_PER_MILLION_COMPLETION_TOKENS !== undefined) {
      db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('REF_PRICE_PER_MILLION_COMPLETION_TOKENS', ?)").run(String(config.REF_PRICE_PER_MILLION_COMPLETION_TOKENS));
    }
    if (config.CURRENCY_SYMBOL !== undefined) {
      db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('CURRENCY_SYMBOL', ?)").run(String(config.CURRENCY_SYMBOL));
    }
    return this.get();
  }
};

module.exports = settings;
