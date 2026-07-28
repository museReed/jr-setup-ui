import assert from "node:assert/strict";

import {
  findExecutable,
  needsCmdWrapper,
  resolveLaunch,
  resolveSpawn,
} from "../src/spawn-command.js";

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

  // 迴歸：Windows 的 npm 只裝出 claude.cmd，沒有 claude.exe。登入按鈕原本
  // 直接 spawn 裸的 "claude" → ENOENT → 畫面回「找不到 claude 指令」。
  const winEnv = {
    PATH: "C:\\Windows\\system32;C:\\Users\\jr\\AppData\\Roaming\\npm\\",
    PATHEXT: ".COM;.EXE;.BAT;.CMD",
  };
  const npmDir = "C:\\Users\\jr\\AppData\\Roaming\\npm";
  const onlyCmdWrapper = (candidate) => candidate === `${npmDir}\\claude.CMD`;

  assert.equal(
    findExecutable("claude", winEnv, onlyCmdWrapper),
    `${npmDir}\\claude.CMD`,
  );
  ok("查 PATH 時會試完 PATHEXT，找得到只有 .CMD 的包裝檔");

  const login = resolveLaunch("claude", ["auth", "login"], {
    env: winEnv,
    fileExists: onlyCmdWrapper,
    platform: "win32",
  });
  assert.equal(login.cmd, "cmd.exe");
  assert.deepEqual(login.args, [
    "/d",
    "/s",
    "/c",
    `${npmDir}\\claude.CMD`,
    "auth",
    "login",
  ]);
  ok("登入動作解析到 .CMD 後改由 cmd.exe 執行");

  const realExe = resolveLaunch("winget", ["install"], {
    env: winEnv,
    fileExists: (candidate) => candidate === "C:\\Windows\\system32\\winget.EXE",
    platform: "win32",
  });
  assert.equal(realExe.cmd, "C:\\Windows\\system32\\winget.EXE");
  assert.deepEqual(realExe.args, ["install"]);
  ok("真正的 .EXE 直接執行，不繞 cmd.exe");

  // 查不到就原樣回傳：ENOENT 要照常浮現成「請先安裝」，不能被吞掉。
  const missing = resolveLaunch("claude", ["auth", "login"], {
    env: winEnv,
    fileExists: () => false,
    platform: "win32",
  });
  assert.equal(missing.cmd, "claude");
  assert.deepEqual(missing.args, ["auth", "login"]);
  ok("PATH 裡真的沒有時維持原樣，讓 ENOENT 照常出現");

  const posixLaunch = resolveLaunch("claude", ["auth", "login"], {
    env: { PATH: "/usr/local/bin" },
    fileExists: () => {
      throw new Error("非 win32 不該查 PATH");
    },
    platform: "darwin",
  });
  assert.equal(posixLaunch.cmd, "claude");
  ok("非 Windows 不做任何解析");
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
