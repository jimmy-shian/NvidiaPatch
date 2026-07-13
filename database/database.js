const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const { setDb, getDb } = require('./connection');

function initDatabase(dbPath) {
  try {
    const db = getDb();
    if (db) return db;
  } catch (_) {}
  
  const resolvedPath = dbPath || path.join(__dirname, '..', 'gateway.db');
  console.log('Initializing SQLite database at:', resolvedPath);
  
  const db = new DatabaseSync(resolvedPath);
  setDb(db);
  
  // Run schema migrations
  const { runMigrations } = require('./schema/schemaManager');
  runMigrations(db);
  
  return db;
}

function closeDatabase() {
  try {
    const db = getDb();
    if (db) {
      try {
        db.close();
      } catch (e) {
        console.error('Error closing database:', e.message);
      }
      setDb(null);
    }
  } catch (_) {}
}

// Repositories
const apiKeys = require('./repositories/apiKeys');
const modelsConfig = require('./repositories/modelsConfig');
const rules = require('./repositories/rules');
const stats = require('./repositories/stats');
const settings = require('./repositories/settings');
const tokenUsage = require('./repositories/tokenUsage');

module.exports = {
  initDatabase,
  closeDatabase,
  getDb,
  apiKeys,
  modelsConfig,
  rules,
  stats,
  settings,
  tokenUsage
};
