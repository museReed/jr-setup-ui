import assert from "node:assert/strict";

import {
  buildIssue,
  issueBody,
  issueTitle,
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
} catch (error) {
  console.error(error);
  process.exit(1);
}
