import assert from "node:assert/strict";

import { needsCmdWrapper, resolveSpawn } from "../src/spawn-command.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

try {
  // 迴歸：Node 20 起 spawn 在 shell:false 下執行 .cmd 會丟 EINVAL
  // （BatBadBut 修補）。實測按下安裝按鈕就是撞這個。
  assert.equal(needsCmdWrapper("npm.cmd", "win32"), true);
  assert.equal(needsCmdWrapper("claude.CMD", "win32"), true);
  assert.equal(needsCmdWrapper("setup.bat", "win32"), true);
  ok("win32 上的 .cmd / .bat 需要包 cmd.exe");

  assert.equal(needsCmdWrapper("npm.cmd", "darwin"), false);
  assert.equal(needsCmdWrapper("winget", "win32"), false);
  assert.equal(needsCmdWrapper("node", "win32"), false);
  ok("非 win32 或非包裝檔不需要包");

  const wrapped = resolveSpawn(
    "npm.cmd",
    ["install", "-g", "@openai/codex"],
    "win32",
  );
  assert.equal(wrapped.cmd, "cmd.exe");
  assert.deepEqual(wrapped.args, [
    "/d",
    "/s",
    "/c",
    "npm.cmd",
    "install",
    "-g",
    "@openai/codex",
  ]);
  ok("包裝後由 cmd.exe 執行，原本的參數順序不變");

  const untouched = resolveSpawn("winget", ["install", "--id", "Git.Git"], "win32");
  assert.equal(untouched.cmd, "winget");
  assert.deepEqual(untouched.args, ["install", "--id", "Git.Git"]);
  ok("winget 是真正的 exe，不會被包");

  const posix = resolveSpawn("npm", ["install"], "darwin");
  assert.equal(posix.cmd, "npm");
  assert.deepEqual(posix.args, ["install"]);
  ok("darwin 完全不受影響");
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
