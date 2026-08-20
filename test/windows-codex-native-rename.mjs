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
  const launcher = read("codex-shared-app-server.ps1");
  assert.match(launcher, /app-server', '--listen'/);
  assert.match(launcher, /--remote \$endpoint/);
  assert.match(launcher, /\/readyz/);
  assert.match(launcher, /Start-Process/);
  assert.match(launcher, /WaitOne\(10000\)/);
  assert.match(launcher, /'exec'.*'review'.*'login'/s);
  ok("Windows wrapper 延遲啟動一個 app-server，互動 TUI 全部用 --remote 共用");

  const setter = read("codex-session-name-set.ps1");
  assert.match(setter, /ClientWebSocket/);
  assert.match(setter, /method = 'initialize'/);
  assert.match(setter, /method = 'initialized'/);
  assert.match(setter, /method = 'thread\/name\/set'/);
  assert.match(setter, /threadId = \$ThreadId; name = \$Name/);
  ok("Windows helper 完成 app-server handshake 後呼叫 thread/name/set");

  const namer = read("codex-session-namer.ps1");
  assert.match(namer, /codex-session-name-set\.ps1/);
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
  assert.equal(step.hookFiles.length, 4);
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
