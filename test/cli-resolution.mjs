import assert from "node:assert/strict";

import { describeStep } from "../src/config-install.js";
import {
  findAllExecutables,
  pickRunnable,
  resolveLaunch,
} from "../src/spawn-command.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

// ⚠️ 迴歸（Reed 的 VM 實測）：%LOCALAPPDATA%\Microsoft\WindowsApps 底下的
// 「應用程式執行別名」是零位元組的 APPEXECLINK reparse point——Node 對它們 stat
// 直接 EACCES，existsSync 回 false，那支 CLI 在我們眼裡等於不存在。
//
// 真機上 `pwsh --version` 回 PowerShell 7.6.4、PATH 也有那個目錄，我們卻回報
// 「沒有裝 PowerShell 7」。而 B5 那一列的全部目的就是偵測 Store 版。
//
// 修法是「列目錄比檔名」——同一次實測 readdir 看得到。
{
  const winApps = "C:\\Users\\Reed\\AppData\\Local\\Microsoft\\WindowsApps";
  const found = findAllExecutables(
    "pwsh",
    { PATH: winApps, PATHEXT: ".EXE" },
    {
      platform: "win32",
      // stat 一律失敗，就像真機那樣。
      fileExists: () => false,
      listDir: (dir) => (dir === winApps ? ["pwsh.exe", "winget.exe"] : []),
    },
  );
  assert.deepEqual(found, [`${winApps}\\pwsh.EXE`]);
  ok("stat 看不到的應用程式執行別名，靠列目錄找得到");

  // 列目錄失敗（目錄不存在、沒權限）不能讓整趟解析中斷。
  assert.deepEqual(
    findAllExecutables(
      "pwsh",
      { PATH: "C:\\nope", PATHEXT: ".EXE" },
      {
        platform: "win32",
        fileExists: () => false,
        listDir: () => {
          throw new Error("ENOENT");
        },
      },
    ),
    [],
  );
  ok("列目錄失敗時安靜跳過那個目錄");
}

try {
  const windowsEnv = {
    PATH: "C:\\first;C:\\second",
    PATHEXT: ".CMD;.EXE",
  };
  const twoExecutables = findAllExecutables("codex", windowsEnv, {
    platform: "win32",
    fileExists: (candidate) =>
      candidate === "C:\\first\\codex.EXE" ||
      candidate === "C:\\second\\codex.EXE",
  });

  // PATH 順序若被打亂，機器可能會叫到另一個版本，讓嚮導行為和終端不同。
  assert.deepEqual(twoExecutables, [
    "C:\\first\\codex.EXE",
    "C:\\second\\codex.EXE",
  ]);
  ok("同名執行檔會依 PATH 順序全部列出");

  const linkedExecutables = findAllExecutables("codex", windowsEnv, {
    platform: "win32",
    fileExists: (candidate) => candidate.endsWith("codex.EXE"),
    realPath: () => "C:\\actual\\codex.exe",
  });

  // 同一檔案的連結若沒有去重，後續選擇會把一支 CLI 誤認成多個安裝版本。
  assert.deepEqual(linkedExecutables, ["C:\\first\\codex.EXE"]);
  ok("realpath 相同的候選只保留 PATH 上第一筆");

  const unresolvedLink = findAllExecutables("codex", windowsEnv, {
    platform: "win32",
    fileExists: (candidate) => candidate === "C:\\first\\codex.EXE",
    realPath: () => {
      throw new Error("broken link");
    },
  });

  // realpath 暫時解不開若往外丟例外，明明存在的 CLI 會讓整個環境檢查中斷。
  assert.deepEqual(unresolvedLink, ["C:\\first\\codex.EXE"]);
  ok("realpath 解不開時仍保留原候選");

  const shimAndExe = findAllExecutables("codex", windowsEnv, {
    platform: "win32",
    fileExists: (candidate) =>
      candidate === "C:\\first\\codex.CMD" ||
      candidate === "C:\\first\\codex.EXE",
  });

  // npm shim 排在前面時若照單全收，殘留的 codex.cmd 會遮住能執行的官方 codex.exe。
  assert.equal(
    pickRunnable(shimAndExe, { platform: "win32" }),
    "C:\\first\\codex.EXE",
  );
  ok("Windows 上真正的 exe 優先於 cmd shim");

  // 只有 shim 的正常 npm 安裝若被當成不可執行，學生會被錯誤要求重新安裝 CLI。
  assert.equal(
    pickRunnable(["C:\\first\\codex.CMD"], { platform: "win32" }),
    "C:\\first\\codex.CMD",
  );
  ok("Windows 上只有 shim 時仍會使用 shim");

  // 完全找不到候選時若回傳裸指令以外的值，呼叫端無法維持原本的 ENOENT 行為。
  assert.equal(pickRunnable([], { platform: "win32" }), null);
  ok("沒有候選時回傳 null");

  // POSIX 沒有 Windows shim 分類，若擅自重排會違反 shell 原本的 PATH 選擇順序。
  assert.equal(
    pickRunnable(["/first/codex.cmd", "/second/codex"], {
      platform: "linux",
    }),
    "/first/codex.cmd",
  );
  ok("非 Windows 維持第一個候選");

  const launch = resolveLaunch("codex", ["--version"], {
    env: windowsEnv,
    platform: "win32",
    fileExists: (candidate) =>
      candidate === "C:\\first\\codex.CMD" ||
      candidate === "C:\\second\\codex.EXE",
    realPath: (candidate) => candidate,
  });

  // 嚮導若沒有接上新的選擇規則，實際 spawn 仍會落到 PATH 前面的壞 shim。
  assert.equal(launch.cmd, "C:\\second\\codex.EXE");
  ok("嚮導啟動路徑會跨 PATH 優先選真正的 exe");

  // ⚠️ 這裡原本還驗一段 PowerShell wrapper（tab-sync 寫進 profile 的那個 function）：
  // 它要用 -All 列出全部候選、挑出真正的 .exe，否則會鎖定 PATH 前面的壞 shim。
  // 那個 wrapper 隨自動命名一起下架了（archive/auto-rename/），所以這段測試也跟著
  // 收起來。復原 wrapper 時記得把它一起接回來——選錯 exe 的坑在 VM 上踩過。
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
