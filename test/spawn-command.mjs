import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
    '"npm.cmd install -g @openai/codex"',
  ]);
  assert.equal(wrapped.spawnOptions.windowsVerbatimArguments, true);
  ok("包裝後由 cmd.exe 執行，原本的參數順序不變");

  // 迴歸：路徑帶空白（C:\Program Files\nodejs\npx.cmd）時，指令本身要有自己的
  // 引號，整串再包一層給 /s 剝——少了內層引號，cmd.exe 會在空白處斷開，畫面上是
  // 'C:\Program' is not recognized（VM 實測；winget 那些指令沒空白所以一直沒踩到）。
  const spaced = resolveSpawn(
    "C:\\Program Files\\nodejs\\npx.cmd",
    ["--yes", "skills", "add", "anthropics/skills"],
    "win32",
  );
  assert.deepEqual(spaced.args, [
    "/d",
    "/s",
    "/c",
    '""C:\\Program Files\\nodejs\\npx.cmd" --yes skills add anthropics/skills"',
  ]);
  ok("指令路徑帶空白時，內層引號與最外層引號都在");

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
    `"${npmDir}\\claude.CMD auth login"`,
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

  // 迴歸：resolveSpawn 回傳的 spawnOptions 漏帶，cmd.exe 包裝就會壞掉。實測代價很
  // 大——env-check 漏帶時，Claude Code 與 Codex 明明裝了卻一律顯示「未安裝」，
  // 而且看起來像環境檢查自己壞了，跟這支改動一點都不像有關係。
  //
  // 這裡掃原始碼：每個叫 resolveSpawn / resolveLaunch 的地方都要把 spawnOptions
  // 接出來，接了才可能往下傳。
  const callers = [
    "src/env-check.js",
    "src/server.js",
    "scripts/install-configs.mjs",
    "scripts/verify-behavior.mjs",
    "scripts/verify-hook-live.mjs",
    "scripts/verify-hooks-live.mjs",
  ];

  for (const file of callers) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    const destructured = /const \{[^}]*\}\s*=\s*resolve(Spawn|Launch)\(/.test(text);

    assert(
      text.includes("spawnOptions"),
      `${file} 沒有接 spawnOptions——cmd.exe 包裝會壞在 Windows 上`,
    );

    if (destructured) {
      assert(
        /const \{[^}]*spawnOptions[^}]*\}\s*=\s*resolve(Spawn|Launch)\(/.test(text),
        `${file} 解構了 resolve 的結果卻沒把 spawnOptions 接出來`,
      );
    }
  }
  ok("每個 spawn 呼叫端都有接 resolve 回傳的 spawnOptions");
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
