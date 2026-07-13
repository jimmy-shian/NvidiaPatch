/**
 * 自訂錯誤類型：內容校驗失敗
 * 在 attemptTestChat 中觸發重試；
 * 正式 /v1/chat/completions route 則使用物件標記 { contentValidationFailed: true } 來保持一致性
 */
class ContentValidationError extends Error {
  constructor(content) {
    super('內容校驗失敗：偵測到未閉合的 HTML/XML 標籤');
    this.name = 'ContentValidationError';
    this.content = content;
  }
}

module.exports = ContentValidationError;
