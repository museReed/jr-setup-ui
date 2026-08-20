import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
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
  assert.match(windows, /Read-JrAppServerState/);
  assert.match(windows, /Test-JrManagedState/);
  assert.match(windows, /Start-JrAppServer/);
  assert.match(windows, /連線位置：/);
  ok("Windows restart 讀取共用狀態、拒絕中斷 TUI，並用動態 port 重啟");

  const mac = read("codex-server-restart.sh");
  const syntax = spawnSync("bash", ["-n"], { input: mac, encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);
  assert.match(mac, /lsof -n -P -U/);
  assert.match(mac, /仍有 Codex 視窗連著 core daemon（偵測到 \$CLIENT_COUNT 個連線）/);
  assert.match(mac, /exit 2/);
  assert.match(mac, /app-server daemon restart/);
  assert.match(mac, /app-server daemon version/);
  assert.doesNotMatch(mac, /nohup/);
  assert.doesNotMatch(mac, /macos-app-server\.state/);
  ok("macOS restart 拒絕中斷 TUI，並交給 Codex core daemon 重啟");

  const temp = mkdtempSync("/tmp/csr-");
  const home = path.join(temp, "home");
  const bin = path.join(temp, "bin");
  const socket = path.join(home, ".codex", "app-server-control", "app-server-control.sock");
  const calls = path.join(temp, "calls.txt");
  mkdirSync(bin, { recursive: true });
  mkdirSync(path.dirname(socket), { recursive: true });
  writeFileSync(
    path.join(bin, "codex"),
    `#!/bin/sh
if [ "$*" = "app-server daemon version" ]; then printf '%s\\n' "$FAKE_DAEMON_JSON"; exit 0; fi
if [ "$*" = "app-server daemon restart" ]; then printf '%s\\n' "$*" >> "$FAKE_CALLS"; printf '%s\\n' '{"status":"restarted"}'; exit 0; fi
exit 8
`,
  );
  writeFileSync(
    path.join(bin, "lsof"),
    `#!/bin/sh
printf '%s\\n' 'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME'
printf '%s\\n' 'codex 4242 user 9u unix 0x0 0t0 123 app-server-control.sock'
if [ "\${FAKE_CLIENT:-}" = "1" ]; then printf '%s\\n' 'codex 5252 user 8u unix 0x0 0t0 124 ->123'; fi
`,
  );
  chmodSync(path.join(bin, "codex"), 0o755);
  chmodSync(path.join(bin, "lsof"), 0o755);
  const daemonJson = JSON.stringify({
    status: "running",
    socketPath: socket,
    cliVersion: "0.149.0",
    appServerVersion: "0.149.0",
  });
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socket, resolve);
  });
  try {
    const env = {
      ...process.env,
      HOME: home,
      CODEX_HOME: path.join(home, ".codex"),
      PATH: `${bin}:${process.env.PATH}`,
      FAKE_DAEMON_JSON: daemonJson,
      FAKE_CALLS: calls,
    };
    const restarted = spawnSync("bash", [path.join(root, "materials", "skills", "hooks", "codex-server-restart.sh")], {
      encoding: "utf8",
      env,
    });
    assert.equal(restarted.status, 0, JSON.stringify(restarted));
    assert.match(restarted.stdout, /core daemon 已更新至 0\.149\.0/);
    assert.equal(readFileSync(calls, "utf8"), "app-server daemon restart\n");

    writeFileSync(calls, "");
    const refused = spawnSync("bash", [path.join(root, "materials", "skills", "hooks", "codex-server-restart.sh")], {
      encoding: "utf8",
      env: { ...env, FAKE_CLIENT: "1" },
    });
    assert.equal(refused.status, 2, JSON.stringify(refused));
    assert.match(refused.stdout, /仍有 Codex 視窗/);
    assert.equal(readFileSync(calls, "utf8"), "");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(temp, { recursive: true, force: true });
  }

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
