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

const root = fileURLToPath(new URL("..", import.meta.url));
const guard = path.join(
  root,
  "materials",
  "skills",
  "hooks",
  "codex-version-guard.sh",
);
const source = readFileSync(guard, "utf8");
const syntax = spawnSync("bash", ["-n", guard], { encoding: "utf8" });
assert.equal(syntax.status, 0, syntax.stderr);
assert.match(source, /app-server daemon start/);
assert.match(source, /--remote "unix:\/\/.*socket_path"/);
assert.match(source, /JR_CODEX_NATIVE_DAEMON=1/);
assert.match(source, /JR_CODEX_AUTO_RENAME_DISABLED=1/);
assert.doesNotMatch(source, /macos-app-server\.state/);

const temp = mkdtempSync("/tmp/cvg-");
const home = path.join(temp, "home");
const bin = path.join(temp, "bin");
const control = path.join(home, ".codex", "app-server-control");
const socket = path.join(control, "app-server-control.sock");
const calls = path.join(temp, "calls.txt");
const delayedSocket = path.join(control, "delayed.sock");
mkdirSync(bin, { recursive: true });
mkdirSync(control, { recursive: true });
writeFileSync(
  path.join(bin, "codex"),
  `#!/bin/sh
if [ "$*" = "app-server daemon start" ]; then
  if [ "\${FAKE_DAEMON_EXIT:-0}" -ne 0 ]; then echo "daemon failed"; exit "$FAKE_DAEMON_EXIT"; fi
  if [ -n "\${FAKE_DELAY_SOCKET:-}" ]; then
    python3 -c 'import socket,sys,time; time.sleep(0.2); sock=socket.socket(socket.AF_UNIX); sock.bind(sys.argv[1]); sock.close()' "$FAKE_DELAY_SOCKET" >/dev/null 2>&1 &
  fi
  printf '%s\\n' "$FAKE_DAEMON_JSON"
  exit 0
fi
printf 'native=%s disabled=%s socket=%s args=%s\\n' "\${JR_CODEX_NATIVE_DAEMON:-}" "\${JR_CODEX_AUTO_RENAME_DISABLED:-}" "\${CODEX_APP_SERVER_SOCKET:-}" "$*" >> "$FAKE_CODEX_CALLS"
exit 7
`,
);
chmodSync(path.join(bin, "codex"), 0o755);

const runGuard = (extraEnv = {}, args = ["--sandbox", "read-only"]) =>
  spawnSync("bash", [guard, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      CODEX_HOME: path.join(home, ".codex"),
      PATH: `${bin}:${process.env.PATH}`,
      FAKE_CODEX_CALLS: calls,
      FAKE_DAEMON_JSON: JSON.stringify({
        status: "running",
        socketPath: socket,
        cliVersion: "0.149.0",
        appServerVersion: "0.149.0",
      }),
      ...extraEnv,
    },
  });

const server = net.createServer();
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(socket, resolve);
});
try {
  const success = runGuard();
  assert.equal(success.status, 7, JSON.stringify(success));
  assert.equal(success.stderr, "");
  assert.equal(
    readFileSync(calls, "utf8"),
    `native=1 disabled= socket=${socket} args=--remote unix://${socket} --sandbox read-only\n`,
  );

  writeFileSync(calls, "");
  const delayed = runGuard({
    FAKE_DELAY_SOCKET: delayedSocket,
    FAKE_DAEMON_JSON: JSON.stringify({
      status: "started",
      socketPath: delayedSocket,
      cliVersion: "0.149.0",
      appServerVersion: "0.149.0",
    }),
  });
  assert.equal(delayed.status, 7, JSON.stringify(delayed));
  assert.equal(delayed.stderr, "");
  assert.equal(
    readFileSync(calls, "utf8"),
    `native=1 disabled= socket=${delayedSocket} args=--remote unix://${delayedSocket} --sandbox read-only\n`,
  );

  writeFileSync(calls, "");
  const mismatch = runGuard({
    FAKE_DAEMON_JSON: JSON.stringify({
      status: "running",
      socketPath: socket,
      cliVersion: "0.150.0",
      appServerVersion: "0.149.0",
    }),
  });
  assert.equal(mismatch.status, 7, JSON.stringify(mismatch));
  assert.match(mismatch.stderr, /CLI 已更新至 0\.150\.0/);
  assert.match(mismatch.stderr, /core daemon 仍是 0\.149\.0/);
  assert.match(mismatch.stderr, /codex-server-restart/);
  assert.equal(
    readFileSync(calls, "utf8"),
    "native= disabled=1 socket= args=--sandbox read-only\n",
  );

  writeFileSync(calls, "");
  const failed = runGuard({ FAKE_DAEMON_EXIT: "9" });
  assert.equal(failed.status, 7, JSON.stringify(failed));
  assert.match(failed.stderr, /core daemon 無法啟動/);
  assert.equal(
    readFileSync(calls, "utf8"),
    "native= disabled=1 socket= args=--sandbox read-only\n",
  );

  writeFileSync(calls, "");
  const bypass = runGuard({}, ["app-server", "daemon", "version"]);
  assert.equal(bypass.status, 7, JSON.stringify(bypass));
  assert.equal(
    readFileSync(calls, "utf8"),
    "native= disabled= socket= args=app-server daemon version\n",
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
  rmSync(temp, { recursive: true, force: true });
}

console.log("ok - macOS launcher 會等待冷啟動 socket；失敗或版本不同時只停用本次 auto-rename");
