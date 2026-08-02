import assert from "node:assert/strict";

import { extractLoginHints } from "../src/login-hints.js";
// 真正跑在畫面上的是 viewmodel 那份。兩份必須給出一樣的結果——否則這裡全綠、
// 學生看到的卻是壞的（src/login-hints.js 目前沒有任何地方 import）。
import { extractLoginHints as liveExtract } from "../public/viewmodel.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

// codex login --device-auth 的真實輸出（2026-07-31 實機錄下）。
// 兩個坑都在這一段裡：CLI 會上色，色碼黏在網址尾巴；代碼是 4 碼-5 碼不是 4-4。
const CODEX_DEVICE_OUTPUT = [
  "Welcome to Codex [\u001b[90m0.144.3\u001b[0m]",
  "",
  "1. Open this link in your browser and sign in to your account",
  "   \u001b[94mhttps://auth.openai.com/codex/device\u001b[0m",
  "",
  "2. Enter this one-time code \u001b[90m(expires in 15 minutes)\u001b[0m",
  "   \u001b[94m1REC-UZZL1\u001b[0m",
].join("\n");

for (const [name, fn] of [
  ["src/login-hints.js", extractLoginHints],
  ["public/viewmodel.js", liveExtract],
]) {
  assert.deepEqual(
    fn(CODEX_DEVICE_OUTPUT),
    { url: "https://auth.openai.com/codex/device", code: "1REC-UZZL1" },
    name,
  );
}
ok("codex 真實輸出：色碼不黏在網址上，4 碼-5 碼的代碼撈得到（兩份實作一致）");

// 放寬長度之後最容易誤中的就是說明文字裡的英文連字詞。
assert.equal(extractLoginHints("Enter this one-time code below").code, null);
assert.equal(liveExtract("Enter this one-time code below").code, null);
ok("不會把說明文字的 one-time 當成代碼");

assert.equal(
  extractLoginHints("! First copy your one-time code: E1A0-63E1").code,
  "E1A0-63E1",
);
ok("抓出 GitHub 一次性代碼");

assert.equal(
  extractLoginHints(
    "Open this URL to continue in your web browser: https://github.com/login/device",
  ).url,
  "https://github.com/login/device",
);
ok("抓出 GitHub 登入網址");

const codexUrl =
  "https://auth.openai.com/oauth/authorize?client_id=app&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&scope=openid";
assert.equal(
  extractLoginHints(`If your browser did not open, navigate to ${codexUrl}`)
    .url,
  codexUrl,
);
ok("保留含問號與 & 參數的 Codex 長網址");

assert.equal(
  extractLoginHints("Visit https://example.com/login.").url,
  "https://example.com/login",
);
assert.equal(
  extractLoginHints("(https://example.com/login)").url,
  "https://example.com/login",
);
ok("去掉網址結尾的句點與右括號");

assert.deepEqual(extractLoginHints("沒有登入提示"), {
  url: null,
  code: null,
});
ok("沒有網址或代碼時回傳 null");

assert.doesNotThrow(() => extractLoginHints(undefined));
assert.deepEqual(extractLoginHints(undefined), { url: null, code: null });
ok("undefined 輸入不拋錯並回傳 null");
