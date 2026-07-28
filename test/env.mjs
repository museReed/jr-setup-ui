import assert from "node:assert/strict";

import {
  parseClaudeAuth,
  parseCodexAuth,
  runEnvCheck,
  runProbe,
} from "../src/env-check.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

assert.deepEqual(
  parseClaudeAuth('{"loggedIn": true, "subscriptionType": "max"}'),
  { loggedIn: true, detail: "已登入（max）" },
);
ok("Claude 已登入狀態與訂閱類型可解析");

assert.deepEqual(parseClaudeAuth('{"loggedIn": false}'), {
  loggedIn: false,
  detail: "未登入",
});
ok("Claude 未登入狀態可解析");

assert.deepEqual(parseClaudeAuth("這不是 JSON"), {
  loggedIn: false,
  detail: "無法判讀登入狀態",
});
ok("Claude 非 JSON 輸出不拋錯");

assert.doesNotThrow(() => parseClaudeAuth(""));
ok("Claude 空字串不拋錯");

assert.doesNotThrow(() => parseClaudeAuth(undefined));
ok("Claude undefined 不拋錯");

assert.deepEqual(parseCodexAuth("Logged in using ChatGPT"), {
  loggedIn: true,
  detail: "已登入",
});
ok("Codex 已登入輸出可解析");

assert.deepEqual(parseCodexAuth("Not logged in"), {
  loggedIn: false,
  detail: "未登入",
});
ok("Codex 未登入輸出可解析");

assert.doesNotThrow(() => parseCodexAuth(undefined));
ok("Codex undefined 不拋錯");

let timeout;
const startedAt = Date.now();
const result = await Promise.race([
  runEnvCheck(),
  new Promise((resolve, reject) => {
    timeout = setTimeout(
      () => reject(new Error("runEnvCheck 超過 20 秒")),
      20_000,
    );
  }),
]);
clearTimeout(timeout);

assert.equal(result.os.platform, process.platform);
assert.equal(result.os.arch, process.arch);
assert.equal(result.checks.length, 8);
assert.deepEqual(
  result.checks.map(({ id }) => id),
  [
    "claude",
    "claude-auth",
    "codex",
    "codex-auth",
    "git",
    "gh",
    "gh-auth",
    "node",
  ],
);

for (const check of result.checks) {
  assert.equal(typeof check.id, "string");
  assert.equal(typeof check.label, "string");
  assert(["ok", "missing", "warn"].includes(check.status));
  assert.equal(typeof check.detail, "string");
}

ok("runEnvCheck 回傳 os 與 8 筆固定形狀的檢查結果");

assert(Date.now() - startedAt < 20_000);
ok("runEnvCheck 在 20 秒內完成");

// 迴歸：`codex login status` 把訊息寫到 stderr，只讀 stdout 會誤判成未登入。
const stderrProbe = await runProbe(process.execPath, [
  "-e",
  "process.stderr.write('Logged in using ChatGPT')",
]);
assert.equal(stderrProbe.stdout, "");
assert.equal(stderrProbe.output, "Logged in using ChatGPT");
assert.equal(parseCodexAuth(stderrProbe.output).loggedIn, true);
ok("寫到 stderr 的登入訊息也讀得到");

// 迴歸：gh --version 會多印一行 release 連結，detail 只留第一行。
for (const check of result.checks) {
  assert(!check.detail.includes("\n"), `${check.id} 的 detail 含換行`);
}
ok("每筆 detail 都只有一行");
