import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describeStep } from "../src/config-install.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (name) =>
  readFileSync(path.join(root, "materials", "skills", "hooks", name), "utf8");
const ok = (message) => console.log("ok - " + message);

try {
  const windows = read("codex-server-restart.ps1");
  assert.match(windows, /Get-NetTCPConnection[\s\S]*-State Established/);
  assert.match(windows, /仍有 Codex 視窗連著背景 server（偵測到 .*個連線）/);
  assert.match(windows, /exit 2/);
  assert.match(windows, /codex-server-restart/);
  assert.match(windows, /Get-CimInstance Win32_Process/);
  assert.match(windows, /app-server', '--listen'/);
  assert.match(windows, /Test-AppServerReady/);
  ok("Windows restart 有連線中的 TUI 就拒絕，且只重啟確認過的 Codex server");

  const mac = read("codex-server-restart.sh");
  const syntax = spawnSync("bash", ["-n"], { input: mac, encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);
  assert.match(mac, /lsof -n -P -U/);
  assert.match(mac, /仍有 Codex 視窗連著背景 server（偵測到 \$CLIENT_COUNT 個連線）/);
  assert.match(mac, /exit 2/);
  assert.match(mac, /codex\*app-server\*--listen/);
  assert.match(mac, /app-server --listen unix:\/\//);
  ok("macOS restart 會找 Unix socket client，仍有 TUI 時拒絕並通過 bash 語法檢查");

  const winStep = describeStep("codex-namer", {
    lang: "zh-TW",
    home: "C:/Users/Reed",
    platform: "win32",
  });
  assert.match(winStep.windowsCodexProfile.block, /function codex-server-restart/);
  assert.match(winStep.windowsCodexProfile.block, /C:\/Users\/Reed\/\.codex\/hooks\/codex-server-restart\.ps1/);

  const macStep = describeStep("codex-namer", {
    lang: "zh-TW",
    home: "/Users/reed",
    platform: "darwin",
  });
  assert(
    macStep.hookFiles.some(
      ({ source, target }) =>
        source === "skills/hooks/codex-server-restart.sh" &&
        target === "/Users/reed/.local/bin/codex-server-restart",
    ),
  );
  ok("兩個平台都能在任何資料夾直接執行 codex-server-restart，不需要 cd");
} catch (error) {
  console.error("not ok - " + (error.stack || error.message));
  process.exit(1);
}
