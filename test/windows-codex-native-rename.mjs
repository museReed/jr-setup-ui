import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describeStep, stepsForTools } from "../src/config-install.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (name) =>
  readFileSync(path.join(root, "materials", "skills", "hooks", name), "utf8");
const ok = (message) => console.log("ok - " + message);

try {
  const common = read("codex-app-server-common.ps1");
  assert.match(common, /windows-app-server\.json/);
  assert.match(common, /JrPortStart = 4500/);
  assert.match(common, /JrPortEnd = 4599/);
  assert.match(common, /Get-NetTCPConnection[\s\S]*-State Listen/);
  assert.match(common, /Start-Process[\s\S]*app-server', '--listen'/);
  assert.match(common, /Local\\jr-setup-ui-codex-app-server/);
  assert.match(common, /codexVersion = \$CodexVersion/);

  const launcher = read("codex-shared-app-server.ps1");
  assert.match(launcher, /Get-JrAppServer/);
  assert.match(launcher, /--remote \$state\.endpoint/);
  assert.match(launcher, /CODEX_APP_SERVER_URL = \[string\]\$state\.endpoint/);
  assert.match(launcher, /本次改用原生模式；Codex 可正常使用，auto-rename 暫停/);
  assert.match(launcher, /Codex 已更新至 .*背景 server 仍是/);
  assert.match(launcher, /Invoke-NativeCodex \$realCodex \$InvocationArgs -DisableAutoRename/);
  assert.match(launcher, /JR_CODEX_AUTO_RENAME_DISABLED/);
  assert.match(launcher, /'exec'.*'review'.*'login'/s);
  ok("Windows wrapper 會共用動態 port；啟動失敗或版本不符時退回原生 Codex");

  const setter = read("codex-session-name-set.ps1");
  assert.match(setter, /ClientWebSocket/);
  assert.match(setter, /method = 'initialize'/);
  assert.match(setter, /method = 'initialized'/);
  assert.match(setter, /method = 'thread\/name\/set'/);
  assert.match(setter, /threadId = \$ThreadId; name = \$Name/);
  ok("Windows helper 完成 app-server handshake 後呼叫 thread/name/set");

  const namer = read("codex-session-namer.ps1");
  assert.match(namer, /codex-session-name-set\.ps1/);
  assert.match(namer, /JR_CODEX_AUTO_RENAME_DISABLED/);
  assert.doesNotMatch(namer, /state_\*\.sqlite|sqlite3|CODEX_DB/);
  assert.doesNotMatch(namer, /AI_TAB_SYNC_FILE|Console\]::Title/);
  assert.match(
    namer,
    /if \(\$name -and \(Set-SessionName \$name\)\) \{[\s\S]*Remove-Item -LiteralPath \$relayFile/,
  );
  ok("Windows namer 不碰 SQLite、tab-sync 或 Console title，失敗時保留 relay 重試");

  const step = describeStep("codex-namer", {
    lang: "zh-TW",
    home: "C:/Users/Reed",
    platform: "win32",
  });
  assert.equal(step.hookFiles.length, 5);
  assert.match(step.windowsCodexProfile.block, /function codex/);
  assert.match(step.windowsCodexProfile.block, /codex-shared-app-server\.ps1/);
  assert.match(step.windowsCodexProfile.block, /function codex-server-restart/);
  assert.equal(stepsForTools(["codex"], "win32").includes("tab-sync"), false);
  assert.equal(stepsForTools(["claude", "codex"], "win32").includes("tab-sync"), true);
  ok("Codex-only 不再安裝 Watcher；同時選 Claude 時 tab-sync 只留給 Claude");
} catch (error) {
  console.error("not ok - " + (error.stack || error.message));
  process.exit(1);
}
