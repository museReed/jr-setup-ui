import assert from "node:assert/strict";

import {
  buildIssue,
  encodedLength,
  issueBody,
  issueTitle,
  issueUrl,
  redact,
  tailWithin,
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

  // ⚠️ B1 的全部重點：中文 percent-encoding 會膨脹九倍。
  assert.equal(encodedLength("中"), 9);
  assert.equal(encodedLength("abc"), 3);
  ok("編碼後的長度算得出來——一個中文字九個字元");

  // 舊做法數的是字元數，3000 個中文字編碼後 27000 字元，遠超過 GitHub 的 8k。
  const chinese = "安裝失敗，請看下方輸出".repeat(300);
  assert.ok(encodedLength(chinese) > 25000);
  const trimmed = tailWithin(chinese, 3000);
  assert.ok(
    encodedLength(trimmed) <= 3000,
    `修完還是超過預算：${encodedLength(trimmed)}`,
  );
  ok("大量中文時，砍到編碼後真的塞得進預算");

  // 砍尾巴不砍頭：問題通常發生在最後。
  const marked = `${"開頭".repeat(500)}最後一行是關鍵`;
  const kept = tailWithin(marked, 2000);
  assert.ok(kept.includes("最後一行是關鍵"));
  assert.ok(kept.includes("被截掉了"));
  ok("留的是尾巴，而且明講前面被砍了");

  // 不講被砍的話，讀 issue 的人會以為那就是全部——「前面沒有錯誤訊息」跟
  // 「前面被砍掉了」是兩個完全不同的結論。
  const short = "一行就好";
  assert.equal(tailWithin(short, 3000), short);
  ok("塞得下就原樣送，不加提示");

  // 預算小到連提示都放不下時整段不送——送一個只有提示沒有內容的 log 是浪費。
  assert.equal(tailWithin(chinese, 50), "");
  ok("預算小到放不下提示時整段不送");

  assert.equal(tailWithin("", 100), "");
  assert.equal(tailWithin(null, 100), "");
  ok("空的或不是字串時不會炸");

  assert.match(issueTitle({ label: "Codex CLI" }), /Codex CLI/);
  assert.match(issueTitle(null), /某一張卡/);
  ok("標題帶卡片名字，沒有卡片時也有話講");

  // 學生要寫的那段擺最上面：log 放前面的話多數人會直接按送出。
  const body = issueBody({ card: { label: "Codex CLI" }, log: "x" });
  assert.ok(body.indexOf("發生什麼事") < body.indexOf("原始輸出"));
  ok("「發生什麼事」排在 log 前面");

  assert.match(issueBody({ card: null, log: "" }), /這一張卡還沒有輸出/);
  ok("沒有輸出時講清楚，不留一個空的程式碼區塊");

  // 整條網址一定要送得出去——固定成本（標題、段落狀態、平台那幾行）先扣掉。
  const heavy = buildIssue({
    card: { label: "Codex CLI 的規矩與回話風格" },
    platform: "win32 arm64",
    source: "rework/returning-students",
    status: "失敗",
    home,
    log: `${chinese}\nC:\\Users\\Reed Chen\\secret`,
    sections: { env: "open", rules: "locked", skills: "locked" },
  });
  assert.ok(
    heavy.url.length <= 6000,
    `網址還是太長：${heavy.url.length}`,
  );
  ok("整條網址壓在 6000 字元內——固定成本先扣掉才給 log 預算");

  // ⚠️ 遮蔽要在截斷**之前**做，不然被留下的那段尾巴可能還帶著本名。
  assert.ok(!heavy.body.includes("Reed Chen"), "截斷後的內容還有本名");
  ok("先遮蔽再截斷，尾巴不會漏出本名");

  // log 很短時不該被截，也不該有提示。
  const light = buildIssue({ card: { label: "Git" }, log: "git version 2.55" });
  assert.ok(light.body.includes("git version 2.55"));
  assert.ok(!light.body.includes("被截掉了"));
  ok("log 短的時候原樣送");

  assert.match(issueUrl("a/b", "t", "b"), /^https:\/\/github\.com\/a\/b\/issues\/new\?/);
  ok("網址指向獨立的回報 repo 的開 issue 頁");
} catch (error) {
  console.error(error);
  process.exit(1);
}
