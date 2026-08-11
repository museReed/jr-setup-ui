import assert from "node:assert/strict";

import { mergeReport, missingLines } from "../src/merge-report.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

try {
  const before = ["# 我的規則", "一律用繁體中文", "不要自動 commit", "測試要先跑過"].join(
    "\n",
  );

  assert.deepEqual(missingLines(before, before), []);
  ok("一模一樣時沒有缺行");

  // ⚠️ 這是 Reed 拍板的判準：合併本來就會重排順序，那不算弄丟。
  const reordered = [
    "# 工作坊規則",
    "測試要先跑過",
    "# 我的規則",
    "不要自動 commit",
    "一律用繁體中文",
  ].join("\n");
  assert.deepEqual(missingLines(before, reordered), []);
  ok("只是換位置不算弄丟——合併本來就會重排");

  // 真的少了一行。
  const dropped = ["# 我的規則", "一律用繁體中文", "測試要先跑過"].join("\n");
  const lost = missingLines(before, dropped);
  assert.equal(lost.length, 1);
  assert.equal(lost[0].text, "不要自動 commit");
  // 行號是合併**前**那份的——學生要對照的是他自己原本的檔案。
  assert.equal(lost[0].line, 3);
  ok("真的少一行時抓得到，而且回報的是合併前的行號");

  // 前後空白與行尾不算改動。
  assert.deepEqual(
    missingLines("  一律用繁體中文  \r\n不要自動 commit", "不要自動 commit\n一律用繁體中文"),
    [],
  );
  ok("前後空白與 CRLF 的差異不算改動");

  // 但內文改了就是改了——AI「潤飾」成另一句話，規則的意思可能整個變掉。
  const polished = ["# 我的規則", "請一律使用繁體中文", "不要自動 commit", "測試要先跑過"].join(
    "\n",
  );
  assert.deepEqual(
    missingLines(before, polished).map((entry) => entry.text),
    ["一律用繁體中文"],
  );
  ok("內文被改寫算弄丟——那正是 AI 潤飾造成的那種");

  // 空行與分隔線不算內容，少了不報。
  assert.deepEqual(missingLines("一律用繁體中文\n\n---\n", "一律用繁體中文"), []);
  ok("空行與分隔線不算內容");

  // 重複行用數量比：原本寫三次、只剩一次也是丟了兩次。
  const thrice = ["規則 A", "規則 A", "規則 A"].join("\n");
  assert.equal(missingLines(thrice, "規則 A").length, 2);
  ok("重複行用數量比，丟了幾次就報幾次");

  const clean = mergeReport([{ target: "a.md", before, after: reordered }]);
  assert.equal(clean.ok, true);
  assert.equal(clean.total, 0);
  ok("整份報告：沒缺行時是 ok");

  const broken = mergeReport([
    { target: "a.md", before, after: dropped },
    { target: "b.toml", before: "x = 1", after: "x = 1" },
  ]);
  assert.equal(broken.ok, false);
  assert.equal(broken.total, 1);
  assert.equal(broken.results.length, 2);
  assert.equal(broken.results[1].missing.length, 0);
  assert.ok(broken.summary.includes("還原"));
  ok("整份報告：兩檔一起看，只有出事的那檔列缺行，並指路到還原");
} catch (error) {
  console.error(error);
  process.exit(1);
}
