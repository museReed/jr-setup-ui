import assert from "node:assert/strict";

import { ghosttyAppPaths, terminalCommand } from "../src/terminal-window.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

const MAC_HOME = "/Users/student";
const LAUNCHER = "/tmp/jr-verify-20260815.command";
const WIN_LAUNCHER = "C:\\Users\\Reed\\AppData\\Local\\Temp\\jr-verify.ps1";

try {
  // ── Windows ───────────────────────────────────────────────────────────────
  //
  // ⚠️ 這一組是這支模組存在的理由。三支腳本本來各抄一份 openTerminal，而它們在
  // Windows 上**不一樣**：沙箱那支要 -NoProfile，另外兩支刻意不要。抽成共用模組
  // 的時候最容易做的錯事就是把這個差異壓平——壓平的話兩邊各壞一種：
  //
  //   驗證 / 合併 掉了 profile → wrapper 不存在 → 標題同步那一格根本沒在驗
  //   沙箱 多載入 profile      → 真機噴 dot-source / language mode 紅字
  const loadsProfile = terminalCommand(WIN_LAUNCHER, {
    platform: "win32",
    home: "C:\\Users\\Reed",
    exists: () => false,
    loadProfile: true,
  });
  const skipsProfile = terminalCommand(WIN_LAUNCHER, {
    platform: "win32",
    home: "C:\\Users\\Reed",
    exists: () => false,
    loadProfile: false,
  });

  assert.ok(!loadsProfile.args.includes("-NoProfile"), "驗證與合併要載入 profile");
  assert.ok(skipsProfile.args.includes("-NoProfile"), "沙箱那支不能載入 profile");
  ok("Windows 上 -NoProfile 跟著 loadProfile 走，兩種需求都保得住");

  // 忘記傳的時候給的是「載入 profile」——三支裡兩支要的那一種。
  const defaulted = terminalCommand(WIN_LAUNCHER, {
    platform: "win32",
    home: "C:\\Users\\Reed",
    exists: () => false,
  });
  assert.ok(!defaulted.args.includes("-NoProfile"));
  ok("沒指定時預設載入 profile");

  for (const result of [loadsProfile, skipsProfile]) {
    assert.equal(result.cmd, "cmd.exe");
    assert.deepEqual(result.args.slice(0, 6), [
      "/c",
      "start",
      "",
      "wt.exe",
      "powershell.exe",
      "-NoExit",
    ]);
    assert.deepEqual(result.args.slice(-4), [
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      WIN_LAUNCHER,
    ]);
  }
  ok("Windows 一律 wt.exe + 留著視窗 + Bypass，不看機器的執行原則臉色");

  // ── mac ───────────────────────────────────────────────────────────────────
  //
  // 沒裝 Ghostty＝交回系統的預設處理程式，跟搬家之前一樣。這是安裝 Ghostty 之前的
  // 過渡狀態，不是壞掉。
  assert.deepEqual(
    terminalCommand(LAUNCHER, {
      platform: "darwin",
      home: MAC_HOME,
      exists: () => false,
    }),
    { cmd: "open", args: [LAUNCHER] },
  );
  ok("mac 上沒裝 Ghostty 時照舊交給系統預設的終端機");

  // 裝了就用它。實測（Reed 的 mac，2026-08-15）：Ghostty 的 Info.plist 自己宣告接手
  // .command，open -a 之後腳本真的會執行，視窗裡 TERM_PROGRAM=ghostty。
  assert.deepEqual(
    terminalCommand(LAUNCHER, {
      platform: "darwin",
      home: MAC_HOME,
      exists: (path) => path === "/Applications/Ghostty.app",
    }),
    { cmd: "open", args: ["-a", "/Applications/Ghostty.app", LAUNCHER] },
  );
  ok("裝了 Ghostty 就用它開——嚮導叫學生裝的終端機，驗證就該跑在上面");

  // 自己拖曳安裝的人放在家目錄底下。
  assert.deepEqual(
    terminalCommand(LAUNCHER, {
      platform: "darwin",
      home: MAC_HOME,
      exists: (path) => path === `${MAC_HOME}/Applications/Ghostty.app`,
    }).args,
    ["-a", `${MAC_HOME}/Applications/Ghostty.app`, LAUNCHER],
  );
  ok("~/Applications 底下的 Ghostty 也認得");

  // ⚠️ 這一條釘住「判裝了沒」與「判用不用它」看的是同一份清單。分成兩份的話會長出
  // 「那一列說已安裝，驗證卻還是跑在系統 Terminal 上」這種矛盾。
  assert.deepEqual(ghosttyAppPaths(MAC_HOME), [
    "/Applications/Ghostty.app",
    `${MAC_HOME}/Applications/Ghostty.app`,
  ]);
  ok("Ghostty 的路徑清單只有一份，env-check 與開視窗共用");
} catch (error) {
  console.error(error);
  process.exit(1);
}
