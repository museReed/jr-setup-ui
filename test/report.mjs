import assert from "node:assert/strict";

import {
  buildIssue,
  FEEDBACK_EMAIL,
  issueBody,
  issueTitle,
  mailtoUrl,
  newIssueUrl,
  redact,
} from "../public/report.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

try {
  // 學生的使用者名稱常常是本名，而這份東西會被貼到公開的 issue 上。
  const home = "C:\\Users\\Reed Chen";
  const text = [
    "C:\\Users\\Reed Chen\\.codex\\config.toml",
    "C:/Users/Reed Chen/.codex/AGENTS.md",
    "C:\\\\Users\\\\Reed Chen\\\\npm",
  ].join("\n");
  const hidden = redact(text, home);
  assert.ok(!hidden.includes("Reed Chen"), hidden);
  assert.equal(hidden.split("~").length - 1, 3);
  ok("三種路徑寫法的家目錄都換成 ~（含 JSON 逃脫過的雙反斜線）");

  assert.equal(redact("abc", ""), "abc");
  assert.equal(redact(null, home), "");
  ok("沒有家目錄或不是字串時不會炸");

  assert.match(issueTitle({ label: "Codex CLI" }), /Codex CLI/);
  assert.match(issueTitle(null), /某一張卡/);
  ok("標題帶卡片名字，沒有卡片時也有話講");

  // 學生要寫的那段擺最上面：log 放前面的話多數人會直接按送出。
  const body = issueBody({ card: { label: "Codex CLI" }, log: "x" });
  assert.ok(body.indexOf("發生什麼事") < body.indexOf("原始輸出"));
  ok("「發生什麼事」排在 log 前面");

  assert.match(issueBody({ card: null, log: "" }), /這一張卡還沒有輸出/);
  ok("沒有輸出時講清楚，不留一個空的程式碼區塊");

  // ⚠️ 走 gh --body-file 之後**沒有任何截斷**：log 多長就送多長。學生最需要回報的
  // 時候（winget 噴了一大坨）正是 log 最長的時候，擠進網址的那份反而缺關鍵段落。
  const chinese = "安裝失敗，請看下方輸出".repeat(300);
  const heavy = buildIssue({
    card: { label: "Codex CLI 的規矩與回話風格" },
    platform: "win32 arm64",
    source: "rework/returning-students",
    status: "失敗",
    home,
    log: `${chinese}\nC:\\Users\\Reed Chen\\secret`,
    sections: { env: "open", rules: "locked", skills: "locked" },
  });
  assert.ok(heavy.body.includes(chinese.slice(0, 40)));
  assert.ok(!heavy.body.includes("被截掉了"));
  ok("很長的 log 一字不漏地送，沒有截斷");

  // 遮蔽仍然要做——那份東西會貼到一個公開的 issue 上。
  assert.ok(!heavy.body.includes("Reed Chen"), "內容裡還有本名");
  ok("家目錄照樣遮蔽掉，長度不影響這件事");

  assert.equal(heavy.title, issueTitle({ label: "Codex CLI 的規矩與回話風格" }));
  ok("buildIssue 同時給標題與內容，交給 gh 去開");

  // ⚠️ 兩條退路的網址都**不准帶 log**。
  //
  // 帶 log 就會撞上檔頭那段講的同一個坑：網址有長度上限，而中文 percent-encoding
  // 一個字變九個字元——學生最需要回報的時候正是 log 最長的時候，硬塞進去的那份
  // 反而缺了關鍵段落。log 一律走剪貼簿。
  //
  // 用長度釘住，不是用「有沒有 body 參數」：GitHub 那條**刻意**帶一行短提示，因為
  // 學生按下按鈕之後人就在 GitHub 分頁上，嚮導框裡那句「請貼上」他看不到，於是看到
  // 一個內文全空的表單就以為按鈕壞了（Reed 實測）。提示要跟著他走。
  const longTitle = issueTitle({ label: "換上課堂用的終端機" });
  const longBody = "中".repeat(3000);

  for (const url of [newIssueUrl(longTitle), mailtoUrl(longTitle)]) {
    // ⚠️ 比對前先解碼。URLSearchParams 把空白編成 `+`、encodeURIComponent 編成
    // `%20`，兩種都是合法的，直接比字串會為了這個差別假紅。
    const decoded = decodeURIComponent(url).replaceAll("+", " ");
    assert.ok(decoded.includes(longTitle), `${url} 少了標題`);
    // 1000 是刻意鬆的：真正的危險區在 8k 左右，這條守的是「有人把 log 塞進來」，
    // 不是逐字節省。訂太緊的話，改一句提示的措辭就會假紅。
    assert.ok(url.length < 1000, `${url.length} 字元，太長了`);
    assert.ok(!decoded.includes(longBody), `${url} 塞了 log`);
  }

  // GitHub 那條要帶提示，否則學生看到空表單會以為按鈕壞了。
  assert.match(newIssueUrl(longTitle), /[?&]body=/);

  const hint = decodeURIComponent(newIssueUrl(longTitle)).split("body=")[1];
  assert.match(hint, /貼在這裡/);
  // ⚠️ 提示要包在 HTML 註解裡：那樣它在編輯框看得到、送出之後渲染不出來，行為就是
  // 一個 placeholder。忘了刪也不會在 issue 開頭掛一句對助教沒有意義的話。
  assert.match(hint, /^<!--[\s\S]*-->/);
  // 所以也不准再叫學生「刪掉這一行」——那是它不必存在的那一步。
  assert.doesNotMatch(hint, /刪掉/);
  // mailto 不帶內文：信件程式對 body 的處理各家不同，而學生本來就要貼上。
  assert.ok(!/[?&]body=/.test(mailtoUrl(longTitle)));

  assert.ok(mailtoUrl(longTitle).startsWith(`mailto:${FEEDBACK_EMAIL}?`));
  // 沒有標題時也要送得出去——空主旨的信很容易被當成垃圾信。
  assert.match(mailtoUrl(""), /subject=jr-setup/);
  ok("兩條退路的網址都不帶 log；GitHub 那條帶一行貼上提示");
} catch (error) {
  console.error(error);
  process.exit(1);
}
