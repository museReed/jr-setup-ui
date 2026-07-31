// ⚠️ 這支目前沒有任何地方 import（只有 test/login-hints.mjs 測它）。
// 真正在跑的那份在 public/viewmodel.js，兩邊必須一致——這裡放著沒同步的舊邏輯，
// 測試會綠，但綠的是死碼，等於假保障。
//
// 兩個坑（2026-07-31 用 codex login --device-auth 的真實輸出驗出來，詳見
// public/viewmodel.js 的註解）：ANSI 色碼會黏在網址尾巴；代碼長度不能寫死。
export function extractLoginHints(text) {
  if (typeof text !== "string") {
    return { url: null, code: null };
  }

  const plain = text.replace(/\u001b\[[0-9;]*m/g, "");
  const urlMatch = plain.match(/https:\/\/\S+/);
  // 不加 /i：裝置代碼一律大寫，加了會撈到說明文字裡的 "one-time"。
  const codeMatch = plain.match(/\b[A-Z0-9]{3,6}-[A-Z0-9]{3,6}\b/);

  return {
    url: urlMatch === null ? null : urlMatch[0].replace(/[.,)]+$/, ""),
    code: codeMatch === null ? null : codeMatch[0],
  };
}
