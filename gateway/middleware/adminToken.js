const crypto = require('crypto');
const db = require('../../database');

let adminToken = null;

function getOrCreateAdminToken() {
  if (adminToken) return adminToken;
  try {
    const row = db.initDatabase().prepare("SELECT value FROM metadata WHERE key = 'ADMIN_TOKEN'").get();
    if (row && row.value && row.value.length >= 32) {
      adminToken = row.value;
      return adminToken;
    }
  } catch (_) { /* fall through */ }
  const token = crypto.randomBytes(32).toString('hex');
  db.initDatabase().prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('ADMIN_TOKEN', ?)").run(token);
  console.log(`[Gateway] Admin token generated: ${token}`);
  adminToken = token;
  return adminToken;
}

module.exports = {
  getOrCreateAdminToken
};
