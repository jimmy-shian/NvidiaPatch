/**
 * 安全讀取 fetch response 的純文字內容。
 * 用於錯誤處理分支，response 可能已被串流消耗，try/catch 包住避免拋錯。
 *
 * @param {Response} response
 * @returns {Promise<string>}
 */
async function readTextSafely(response) {
  try {
    return await response.text();
  } catch (err) {
    return '';
  }
}

module.exports = {
  readTextSafely
};