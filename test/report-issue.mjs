import assert from "node:assert/strict";

import { explainFailure, issueUrlFrom } from "../src/report-issue.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

try {
  // gh 成功時把 issue 網址印在最後一行。前面可能有別的雜訊（升級提示之類）。
  assert.equal(
    issueUrlFrom(
      "Creating issue in museReed/jr-setup-feedback\nhttps://github.com/museReed/jr-setup-feedback/issues/12\n",
    ),
    "https://github.com/museReed/jr-setup-feedback/issues/12",
  );
  ok("從 gh 的輸出裡挑出 issue 網址");

  assert.equal(issueUrlFrom("沒有網址"), "");
  assert.equal(issueUrlFrom(null), "");
  ok("沒有網址時回空字串，不會炸");

  // ⚠️ 「HTTP 401」對學生沒有意義，「還沒登入」才有。而且要指名去哪一張卡處理。
  const auth = explainFailure("HTTP 401: Bad credentials");
  assert.match(auth, /登入/);
  assert.match(auth, /版本控制與 GitHub/);
  ok("認證失敗時講人話，而且指名去哪一張卡");

  assert.match(explainFailure("gh: Not Found (HTTP 404)"), /嚮導的問題/);
  ok("找不到 repo 時明講那是我們的問題，不是學生的");

  // 認不出來的錯誤原樣帶回去，不要自己編一個原因。
  const unknown = explainFailure("something exploded");
  assert.match(unknown, /原始訊息/);
  ok("認不出來的錯誤帶回 gh 的原話，不自己編原因");
} catch (error) {
  console.error(error);
  process.exit(1);
}
