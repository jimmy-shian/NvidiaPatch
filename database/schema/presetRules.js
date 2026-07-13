const fs = require('fs');
const path = require('path');

function insertPresetRules(db) {
  // 每次啟動皆清理並重新載入最新的 preset 規則，以確保規範內容與程式碼同步
  let presets = [];
  try {
    const jsonPath = path.join(__dirname, 'preset-rules.json');
    const content = fs.readFileSync(jsonPath, 'utf8');
    presets = JSON.parse(content);
  } catch (err) {
    console.error('Failed to read preset-rules.json, using fallback empty array:', err.message);
  }

  const insert = db.prepare("INSERT INTO rules (title, content, is_preset) VALUES (?, ?, 1)");

  try {
    db.exec("BEGIN TRANSACTION");
    db.exec("DELETE FROM rules WHERE is_preset = 1");

    for (const rule of presets) {
      insert.run(rule.title, rule.content);
    }

    db.exec("COMMIT");
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch (rollbackErr) {
      console.error("Rollback preset rules failed:", rollbackErr.message);
    }
    throw err;
  }
}

module.exports = {
  insertPresetRules
};
