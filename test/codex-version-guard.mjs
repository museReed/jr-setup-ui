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
import os from "node:os";
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
assert.match(source, /macos-app-server\.state/);
assert.match(source, /背景 server 仍是/);
assert.match(source, /codex-server-restart/);

const temp = mkdtempSync("/tmp/cvg-");
const home = path.join(temp, "home");
const bin = path.join(temp, "bin");
const control = path.join(home, ".codex", "app-server-control");
const socket = path.join(control, "app-server-control.sock");
const calls = path.join(temp, "calls.txt");
mkdirSync(bin, { recursive: true });
mkdirSync(control, { recursive: true });
writeFileSync(
  path.join(bin, "codex"),
  `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "$FAKE_CODEX_VERSION"; exit 0; fi\nprintf '%s\\n' "$*" >> "$FAKE_CODEX_CALLS"\nexit 7\n`,
);
writeFileSync(
  path.join(bin, "lsof"),
  "#!/bin/sh\nprintf 'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\\n'\nprintf 'codex 4242 user 9u unix 0x0 0t0 123 app-server-control.sock\\n'\n",
);
chmodSync(path.join(bin, "codex"), 0o755);
chmodSync(path.join(bin, "lsof"), 0o755);
writeFileSync(
  path.join(control, "macos-app-server.state"),
  `4242\tcodex-cli 0.148.0\t${socket}\n`,
);

const server = net.createServer();
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(socket, resolve);
});
try {
  const result = spawnSync("bash", [guard, "--sandbox", "read-only"], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      CODEX_HOME: path.join(home, ".codex"),
      PATH: `${bin}:${process.env.PATH}`,
      FAKE_CODEX_VERSION: "codex-cli 0.149.0",
      FAKE_CODEX_CALLS: calls,
    },
  });
  assert.equal(result.status, 7, JSON.stringify(result));
  assert.match(result.stderr, /Codex 已更新至 codex-cli 0\.149\.0/);
  assert.match(result.stderr, /背景 server 仍是 codex-cli 0\.148\.0/);
  assert.match(result.stderr, /codex-server-restart/);
  assert.equal(readFileSync(calls, "utf8"), "--sandbox read-only\n");
} finally {
  await new Promise((resolve) => server.close(resolve));
  rmSync(temp, { recursive: true, force: true });
}

console.log("ok - macOS 版本不同時先提醒，但仍保留原生 Codex 參數與結束碼");
