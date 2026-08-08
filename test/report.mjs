import assert from "node:assert/strict";

import {
  FEEDBACK_REPO,
  issueBody,
  issueTitle,
  issueUrl,
  redact,
  tail,
} from "../public/report.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

try {
  // ⚠️ 這份東西會被貼到一個公開的 issue 上，而學生的使用者名稱常常是本名。
  // 三種寫法都要換掉：正斜線、反斜線，以及 JSON 逃脫過的雙反斜線（診斷資料是 JSON）。
  const home = "C:\\Users\\Reed Chen";
  const text = [
    "C:\\Users\\Reed Chen\\.claude\\skills",
    "C:/Users/Reed Chen/.local/bin",
    '"C:\\\\Users\\\\Reed Chen\\\\.codex"',
  ].join("\n");
  const clean = redact(text, home);
  assert(!clean.includes("Reed Chen"), `使用者名稱沒被換掉：${clean}`);
  assert.equal(clean.split("~").length - 1, 3, "三種寫法都要換成 ~");
  ok("回報內容裡的家目錄會換成 ~，反斜線與正斜線都算");

  // mac 的形狀。
  assert.equal(
    redact("/Users/reed/.claude/skills/x", "/Users/reed"),
    "~/.claude/skills/x",
  );
  ok("macOS 的家目錄同樣換得掉");

  // 家目錄拿不到時不能整個爆掉——那只是少一層遮蔽，不是不能回報。
  assert.equal(redact("abc", ""), "abc");
  assert.equal(redact("abc", undefined), "abc");
  assert.equal(redact(undefined, "/Users/x"), "");
  ok("家目錄缺漏時原樣回傳，不拋錯");

  // 網址長度有極限（實務上 8k 就會 414），而原始輸出動不動就上萬字。
  // 砍尾巴不砍頭：問題通常發生在最後。
  const long = `${"a".repeat(5000)}END`;
  const cut = tail(long, 100);
  assert(cut.endsWith("END"), "要留最後面那一段");
  assert(cut.includes("被截掉了"), "被砍了一定要講——不然讀的人會以為那就是全部");
  assert(cut.length < 400);
  // 沒超過就原樣，不要多一行沒必要的說明。
  assert.equal(tail("short", 100), "short");
  ok("原始輸出只留最後一段，而且會講清楚被截掉了");

  const body = issueBody({
    card: { label: "Claude Code" },
    platform: "作業系統：win32 / arm64",
    source: "main",
    status: "失敗",
    log: "C:\\Users\\Reed Chen\\.local\\bin\\claude.exe 找不到",
    sections: { env: { locked: false } },
    home,
  });
  // 學生要寫的那一段擺最上面：log 放前面的話，多數人會直接按送出，
  // 我們拿到一份沒有人話的報告。
  assert(body.indexOf("## 發生什麼事") < body.indexOf("## 這一張卡的原始輸出"));
  assert(!body.includes("Reed Chen"), "body 裡也不能漏掉遮蔽");
  assert(body.includes("Claude Code"));
  assert(body.includes("main"));
  ok("回報內容把「請描述」放在最前面，log 也遮蔽過");

  // 沒有輸出時不要留一個空的程式碼區塊——那看起來像壞掉。
  assert(
    issueBody({ card: { label: "x" }, log: "" }).includes("（這一張卡還沒有輸出）"),
  );
  ok("沒有輸出時講一句，不留空的程式碼區塊");

  assert.equal(issueTitle({ label: "Codex CLI" }), "[嚮導] Codex CLI 卡住了");
  assert.equal(issueTitle(null), "[嚮導] 某一張卡 卡住了");
  ok("標題帶卡片名字，助教一眼看得出是哪一步");

  // ⚠️ 送去的是一個獨立的公開 repo，不是 jr-setup-ui 本身：主 repo 之後要轉 private，
  // 而 private repo 的 issue 非協作者開不了（見 docs/go-private-checklist.md）。
  assert.equal(FEEDBACK_REPO, "museReed/jr-setup-feedback");
  const url = issueUrl(FEEDBACK_REPO, "標題 &=?", "內容\n第二行");
  assert(url.startsWith("https://github.com/museReed/jr-setup-feedback/issues/new?"));
  // 標題與內容裡的 & = ? 換行都要跳脫，不然網址會被切斷。
  assert(!url.includes("標題 &=?"));
  assert(url.includes("title="));
  assert(url.includes("body="));
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("title"), "標題 &=?");
  assert.equal(parsed.searchParams.get("body"), "內容\n第二行");
  ok("issue 網址會正確跳脫，解回來跟原本一模一樣");
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
