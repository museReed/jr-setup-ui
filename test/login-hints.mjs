import assert from "node:assert/strict";

import { extractLoginHints } from "../src/login-hints.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

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
