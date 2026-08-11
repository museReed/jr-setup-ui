import assert from "node:assert/strict";

import {
  checksForTools,
  normalizeNotFound,
  parseClaudeAuth,
  parseCodexAuth,
  runEnvCheck,
  runProbe,
} from "../src/env-check.js";
import {
  installActionId,
  resolveInstaller,
} from "../src/installers.js";

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

// 第一張卡的工具選擇要管到環境段：選了誰才出現誰的安裝與登入。
const allChecks = [
  { id: "claude" },
  { id: "claude-auth" },
  { id: "codex" },
  { id: "codex-auth" },
  { id: "git" },
  { id: "node" },
];

assert.deepEqual(
  checksForTools(allChecks, ["codex"]).map((check) => check.id),
  ["codex", "codex-auth", "git", "node"],
);
assert.deepEqual(
  checksForTools(allChecks, ["claude"]).map((check) => check.id),
  ["claude", "claude-auth", "git", "node"],
);
assert.deepEqual(
  checksForTools(allChecks, ["claude", "codex"]).map((check) => check.id),
  allChecks.map((check) => check.id),
);
ok("工具選擇只砍掉沒選到的那個 CLI，共用前置照留");

// 空的／沒帶就照舊全查——/env 在選擇載入之前也會被呼叫到，砍掉的話開頁瞬間
// 會少一半卡片再突然長回來。
assert.deepEqual(checksForTools(allChecks, []), allChecks);
assert.deepEqual(checksForTools(allChecks, undefined), allChecks);
ok("沒指定工具時維持全查");

// Windows 的清單多四列平台專屬檢查，macOS 多一列 Ghostty。過濾工具不能誤傷它們。
// 這一段刻意用寫死的清單而不是真的 CHECKS：CHECKS 依 process.platform 組出來，
// 在 macOS 上跑的測試永遠看不到 Windows 那四列——那正是這次要防的盲點。
const bothPlatforms = [
  { id: "execution-policy" },
  { id: "claude" },
  { id: "claude-auth" },
  { id: "codex" },
  { id: "codex-auth" },
  { id: "git" },
  { id: "gh" },
  { id: "gh-auth" },
  { id: "node" },
  { id: "python" },
  { id: "windows-terminal" },
  { id: "powershell-version" },
  { id: "powershell-encoding" },
  { id: "ghostty" },
];
const platformOnly = [
  "execution-policy",
  "windows-terminal",
  "powershell-version",
  "powershell-encoding",
  "ghostty",
];

for (const tools of [["codex"], ["claude"]]) {
  const kept = checksForTools(bothPlatforms, tools).map((check) => check.id);

  for (const id of platformOnly) {
    assert(kept.includes(id), `${id} 是平台專屬前置，不該被工具選擇砍掉`);
  }
}
ok("Windows 與 macOS 的平台專屬檢查不受工具選擇影響");

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
const expectedIds = [
  "claude",
  "claude-auth",
  "codex",
  "codex-auth",
  "git",
  "gh",
  "gh-auth",
  "node",
  // demo 那段的 self_play.py 要 python3。macOS 內建、Windows 沒有——實測 VM 上
  // 只有 Windows Store 的殼，agent 只好當場把腳本改寫成 PowerShell。
  "python",
  // 兩個平台都查：shell 設定檔裡指向已刪檔案的 claude / codex 函式。
  "shell-wrapper",
];

if (process.platform === "win32") {
  expectedIds.unshift("execution-policy");
  // 沙箱那一列排在 codex-auth 後面：它問的是「這支 codex 待會兒跑得起來嗎」，
  // 跟裝了沒、登入了沒同一組。順序要跟 checksForPlatform 一致。
  expectedIds.splice(expectedIds.indexOf("codex-auth") + 1, 0, "codex-sandbox");
  expectedIds.push(
    "windows-terminal",
    "powershell-version",
    "powershell-encoding",
    "pwsh-store",
  );
}

if (process.platform === "darwin") {
  expectedIds.push("ghostty");
}

assert.equal(result.checks.length, expectedIds.length);
assert.deepEqual(
  result.checks.map(({ id }) => id),
  expectedIds,
);

for (const check of result.checks) {
  assert.equal(typeof check.id, "string");
  assert.equal(typeof check.label, "string");
  assert(["ok", "missing", "warn"].includes(check.status));
  assert.equal(typeof check.detail, "string");
}

ok(`runEnvCheck 回傳 os 與 ${expectedIds.length} 筆固定形狀的檢查結果`);

for (const check of result.checks) {
  assert(Object.hasOwn(check, "fixAction"));
  assert(
    typeof check.fixAction === "string" || check.fixAction === null,
  );
}
ok("每筆檢查都有字串或 null 的 fixAction");

if (process.platform === "darwin") {
  assert(!result.checks.some(({ id }) => id === "execution-policy"));
  assert(result.checks.some(({ id }) => id === "ghostty"));
  ok("darwin 不包含 PowerShell 執行原則檢查");
} else {
  ok("(skipped) 非 darwin 不檢查執行原則項目是否缺席");
}

for (const id of ["claude", "codex", "git", "gh", "node"]) {
  assert.equal(
    result.checks.find((check) => check.id === id).fixAction,
    null,
  );
}
ok("五個非登入項目都不提供 fixAction");

for (const check of result.checks) {
  assert(Object.hasOwn(check, "installAction"));
  assert(
    typeof check.installAction === "string" ||
      check.installAction === null,
  );
  const expectedInstallAction =
    check.status === "missing" &&
    resolveInstaller(check.id, process.platform) !== null
      ? installActionId(check.id)
      : null;
  assert.equal(check.installAction, expectedInstallAction);
}
ok("每筆檢查都有符合狀態與平台的 installAction");

assert.equal(
  result.checks.find(({ id }) => id === "node").installAction,
  null,
);
ok("Node.js 檢查不提供安裝 action");

for (const id of ["claude-auth", "codex-auth", "gh-auth"]) {
  assert.equal(
    result.checks.find((check) => check.id === id).installAction,
    null,
  );
}
ok("三個登入狀態檢查都不提供安裝 action");

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

// 迴歸：.cmd 退路是交給 cmd.exe 跑，cmd.exe 一定啟動得起來，找不到目標只回 9009。
// 不還原成 ENOENT 的話，未安裝會被誤報成「檢查失敗」（實測 gh 就是這樣）。
const NOT_FOUND = { type: "error", error: { code: "ENOENT" } };

assert.deepEqual(
  normalizeNotFound({ type: "close", exitCode: 9009, stdout: "" }),
  NOT_FOUND,
);
// 實測：gh 未安裝時 cmd.exe 回的是 1，不是 9009。
assert.deepEqual(
  normalizeNotFound({
    type: "close",
    exitCode: 1,
    stdout: "",
    stderr: "'gh.cmd' is not recognized as an internal or external command,\r\n",
  }),
  NOT_FOUND,
);
assert.deepEqual(normalizeNotFound({ type: "close", exitCode: 1 }), NOT_FOUND);
// 有 stdout 就代表指令真的跑了，非零是它自己的失敗，不能當成未安裝。
assert.deepEqual(
  normalizeNotFound({ type: "close", exitCode: 1, stdout: "x" }),
  { type: "close", exitCode: 1, stdout: "x" },
);
assert.deepEqual(
  normalizeNotFound({ type: "close", exitCode: 0, stdout: "" }),
  { type: "close", exitCode: 0, stdout: "" },
);
assert.deepEqual(normalizeNotFound({ type: "timeout" }), { type: "timeout" });
ok("退路沒有 stdout 又非零就還原成未安裝，其他結果原樣傳回");

// 迴歸：`codex login status` 未登入時是「非零 + 空 stdout + 訊息在 stderr」，
// 特徵跟指令不存在一模一樣。這個判準只能用在版本探測，登入探測開了會把
// 「未登入」誤報成「需要先安裝」（實測 Windows 上就是這樣）。
const notLoggedIn = await runProbe(process.execPath, [
  "-e",
  "process.stderr.write('Not logged in'); process.exit(1)",
]);
assert.equal(notLoggedIn.type, "close");
assert.equal(notLoggedIn.exitCode, 1);
assert.equal(parseCodexAuth(notLoggedIn.output).loggedIn, false);
ok("登入探測不會把未登入誤判成未安裝");
