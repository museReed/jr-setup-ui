import assert from "node:assert/strict";

import { buildTerminalLaunch } from "../src/terminal-launch.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

const windows = buildTerminalLaunch("claude auth login", "win32");
assert.equal(windows.cmd, "cmd.exe");
assert(windows.args.includes("start"));
assert.equal(windows.args.at(-1), "claude auth login");
ok("Windows 用 cmd.exe start 開啟登入視窗");

const macos = buildTerminalLaunch("codex login", "darwin");
assert.equal(macos.cmd, "osascript");
ok("macOS 用 osascript 開啟 Terminal");

assert.equal(buildTerminalLaunch("x", "sunos"), null);
ok("不支援的平台不建立終端機指令");

for (const launch of [windows, macos]) {
  const args = launch.args.join(" ");
  assert.doesNotMatch(args, /--dangerously|&&|\||;/);
}
ok("兩個平台的登入指令都不含危險參數或串接符號");
