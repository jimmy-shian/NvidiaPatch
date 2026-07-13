let db = null;

function setDb(instance) {
  db = instance;
}

function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase(filePath) first.');
  }
  return db;
}

module.exports = {
  setDb,
  getDb
};
