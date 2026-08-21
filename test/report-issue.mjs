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

  // ⚠️ 「HTTP 401」對學生沒有意義，「還沒登入」才有。
  //
  // 而且要指向**現在就按得動的那顆鍵**。這一條原本指名「版本控制與 GitHub」那張卡
  // ——但學生最需要回報的時候，正是他還沒把 gh 裝好登入好的時候，那等於把求助的人
  // 推回問題本身。現在指向框裡那顆退路鍵：它不需要 gh，也不需要 CLI 登入。
  const auth = explainFailure("HTTP 401: Bad credentials");
  assert.match(auth, /登入/);
  assert.match(auth, /複製內容並開 GitHub/);
  ok("認證失敗時講人話，而且指向不需要 gh 的那條退路");

  // 每一種失敗都要給得出一條現在走得通的路，不能只說「你少了什麼」。
  for (const stderr of [
    "HTTP 401: Bad credentials",
    "something exploded",
  ]) {
    assert.match(
      explainFailure(stderr),
      /複製內容並開 GitHub/,
      `這種失敗沒有指向退路：${stderr}`,
    );
  }
  ok("認證失敗與未知失敗都指向那條退路");

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
