// 開一個真的終端把 codex 叫起來，好讓它問「要不要設定沙箱」。
//
//   先看不動：  node scripts/setup-codex-sandbox.mjs
//   真的開視窗：node scripts/setup-codex-sandbox.mjs --apply
//
// ⚠️ 為什麼要開新視窗，不在嚮導的管線裡跑：
//
//   1. 那是一個**互動選單**（1 設定 / 2 不提權 / 3 離開），要學生自己選
//   2. 選了 1 會跳 UAC，而背景跑的 UAC 框會出現在嚮導視窗**後面**——學生順手
//      關掉，我們只拿到一個沒頭沒尾的錯誤碼（那就是 1223 = ERROR_CANCELLED）
//
// ⚠️ 這支不判定成功與否。判定在 env-check 那一列：~/.codex/cap_sid 裡有沒有
// workspace + readonly 兩個 SID（見 src/codex-sandbox.js 的 sandboxReady）。
// 學生選完之後按「重新檢查」，那一列自己會轉綠。
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import { sandboxReady } from "../src/codex-sandbox.js";

const APPLY = process.argv.includes("--apply");

// ⚠️ 開的是**互動式的 codex**，不是 `codex sandbox` 子指令。這一點試錯了兩次，
// 兩次都是在 VM 上被打臉的，所以把過程寫下來：
//
//   第一版  codex sandbox pwsh -c "echo sandbox-ok"
//           → 沙箱裡那個 pwsh 讀 profile 噴紅字（Smart App Control 那道）
//   第二版  codex sandbox cmd /c echo sandbox-ok
//           → 紅字沒了，但**修不好真正壞掉的那種機器**：cap_sid 還在、帳號被刪掉
//             時，它直接失敗，連選單都不跳：
//               helper_sid_resolve_failed: resolve SID for offline user
//               CodexSandboxOffline failed: LookupAccountNameW … 1332
//             （1332 ＝ 找不到那個帳號。cap_sid 記著名字，帳號沒了就解析不到。）
//   現在    在一個未信任的暫存目錄裡開互動式 codex
//           → 那正是會跳「要設定哪種沙箱」選單的路徑（真機驗過）
//
// ⚠️ 為什麼要另外開一個暫存目錄：家目錄在 config.toml 裡是 trust_level = "trusted"，
// 那裡的 codex **不用沙箱、也就不會問**。選單只在未信任的目錄出現。
//
// ⚠️ 而且**目錄名要每次都不一樣**。第一版用固定名字 jr-codex-sandbox-setup，結果
// 只有第一次有效：codex 把用過的目錄寫進 config.toml 的 [projects] 並標成
// trust_level = "trusted"，第二次進去就不再問了（真機實測，config.toml 裡看得到
// 那一筆）。信任是逐目錄累加的，所以每次給一個新名字最省事。
//
// ⚠️ 也試過直接跑那支 helper（codex-windows-sandbox-setup.exe）——**不通**。它要一個
// base64 payload，是 codex 內部呼叫用的，人叫它只會得到：
//   helper_request_args_failed: failed to decode payload b64
const WORK_DIR = `jr-codex-sandbox-${Date.now().toString(36)}`;
const BODY = [
  `$dir = Join-Path $env:TEMP '${WORK_DIR}'`,
  "New-Item -ItemType Directory -Force -Path $dir | Out-Null",
  "Set-Location $dir",
  "codex",
].join("\n");

function launcher() {
  // 檔名不帶時間戳：這支同一台機器上重跑很正常，蓋掉上一份就好。
  if (process.platform === "win32") {
    const file = path.join(tmpdir(), "jr-setup-codex-sandbox.ps1");
    // BOM：PowerShell 5.1 讀沒有 BOM 的 UTF-8 會當成 ANSI，中文全變亂碼。
    writeFileSync(file, `﻿${BODY}\n`, "utf8");
    return file;
  }

  const file = path.join(tmpdir(), "jr-setup-codex-sandbox.command");
  writeFileSync(file, `#!/bin/zsh -i\n${BODY}\n`);
  chmodSync(file, 0o755);
  return file;
}

function openTerminal(file) {
  if (process.platform === "win32") {
    return {
      cmd: "cmd.exe",
      args: [
        "/c",
        "start",
        "",
        "wt.exe",
        "powershell.exe",
        "-NoExit",
        // ⚠️ 這裡要 -NoProfile，合併那支刻意**不加**——兩支的需求相反，別互相抄。
        //
        //   合併    要跑學生平常那一支 claude / codex，而 wrapper 住在 profile 裡
        //   這一支  只跑一個 codex 指令，profile 對它沒有任何用處
        //
        // 真機（Reed 的 arm64 VM）上載 profile 還會噴一段紅字：Smart App Control
        // 開在評估中 → WDAC 使用者模式稽核 → 未簽章的 profile 被判成受限語言模式，
        // PowerShell 載入 profile 用的正是 dot-source，於是拒絕載入。學生會看到
        // 「Cannot dot-source this command because it was defined in a different
        // language mode」，跟他要做的事一點關係都沒有。
        "-NoProfile",
        // 我們自己寫出來的臨時腳本不該看機器的執行原則臉色（跟合併那支同一個理由）。
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        file,
      ],
    };
  }

  return { cmd: "open", args: [file] };
}

if (process.platform !== "win32") {
  console.log("沙箱的設定選單只有 Windows 會出現，這一項在這台機器上不用做。");
  process.exit(0);
}

// ⚠️ 兩種結果都要講。真機實測：受限帳號還在的機器按下去**什麼都不問**，直接印
// sandbox-ok；只有真的要重建帳號時才跳選單與 UAC。只講後者的話，前一種人會停在
// 那裡等一個不會出現的選單（Reed 在畫面前指出文案跟他看到的不一樣）。
console.log("會開一個新的終端視窗，在那裡把 Codex 叫起來。");
console.log("");
console.log("在那個視窗裡：");
console.log("  1. 它會問「要設定哪種沙箱」——選 1（Set up default sandbox）再按 Enter");
console.log("  2. 跳出來的權限確認視窗要按「是」");
console.log("     ⚠️ 那個視窗預設選在「否」，順手按 Enter 就等於取消，而且不會有任何說明");
console.log("  3. 看到「Sandbox ready」就成功了");
console.log("");
console.log("設定好的那一刻嚮導就會自己往下走，不用等你關掉那個視窗。");
console.log("");

if (!APPLY) {
  console.log("以上只是先看不動。加 --apply 才會真的開視窗。");
  process.exit(0);
}

const CAP_SID = path.join(homedir(), ".codex", "cap_sid");
const POLL_MS = 1000;
const TIMEOUT_MS = 3 * 60 * 1000;

// ⚠️ 開視窗之前先把 cap_sid 挪開。這是「一定會跳選單」的唯一可靠條件。
//
// 試過三種觸發方式，只有這一種每次都成立：
//
//   固定的暫存目錄     第二次起不會問（目錄被寫進 [projects] 標成 trusted）
//   每次換新目錄名     **還是不一定會問**（真機實測：同樣是「帳號沒了、cap_sid 還在」，
//                      ~\Desktop\test 會問、新的暫存目錄不會，原因未查明）
//   把 cap_sid 挪開    ✅ 每次都問（Reed 驗過兩次）
//
// ⚠️ 挪開不是刪掉：學生中途取消的話要還得回去，否則我們把一台本來好好的機器弄壞了。
// 逾時或沒完成就搬回來（見下面的 restore）。
const CAP_SID_BACKUP = `${CAP_SID}.jr-setup-bak`;
let movedCapSid = false;

try {
  renameSync(CAP_SID, CAP_SID_BACKUP);
  movedCapSid = true;
} catch {
  // 檔案本來就不在——那正是「從沒設定過」的狀態，codex 一定會問，不用做什麼。
}

function restoreCapSid() {
  if (!movedCapSid) {
    return;
  }

  try {
    renameSync(CAP_SID_BACKUP, CAP_SID);
  } catch {
    // 新的已經寫出來了（設定成功），舊的那份就沒用了。
  }
}

const { cmd, args } = openTerminal(launcher());
spawn(cmd, args, { stdio: "ignore", detached: true }).unref();

console.log("已經開了一個新的終端視窗，請看那個視窗。");
console.log("");

// ⚠️ 不要等視窗關掉。那裡開的是互動式 codex，學生設定完之後多半會留著它——等關窗
// 等於要他多做一個動作，而且畫面在那之前完全不會動（Reed 指定改成隨時輪詢）。
//
// 等的是**狀態本身**，判準跟畫面上那一列同一組，不各寫一份。這支結束之後 app.js
// 會自己重跑環境檢查，所以那一列會自動轉綠。

// ⚠️ 兩個條件都要，跟畫面上那一列同一組判準（見 src/codex-sandbox.js）：
// cap_sid 齊全，而且那兩個本機帳號真的在。只等 cap_sid 的話，帳號被刪掉的機器
// 會在設定還沒做完時就被判成好了。
const ACCOUNTS = ["codexsandboxoffline", "codexsandboxonline"];

function accountsExist() {
  try {
    // net user 而不是 Get-LocalUser：cmd.exe 每台都有，也不必過 PowerShell 的
    // 語言模式那一關（Smart App Control 開著的機器會擋未簽章腳本）。
    const out = execFileSync("cmd.exe", ["/c", "net user"], {
      encoding: "utf8",
    }).toLowerCase();

    return ACCOUNTS.every((name) => out.includes(name));
  } catch {
    return false;
  }
}

function ready() {
  try {
    return sandboxReady(readFileSync(CAP_SID, "utf8")) && accountsExist();
  } catch {
    // 檔案還沒出現就是還沒好，不是錯誤。
    return false;
  }
}

const startedAt = Date.now();
let announced = 0;

while (!ready()) {
  if (Date.now() - startedAt > TIMEOUT_MS) {
    console.log("");
    console.log("等了三分鐘還沒偵測到沙箱設定完成。三種可能：");
    console.log("");
    console.log("  ● 那個視窗還停在選單上 ——照上面的步驟選完就好");
    console.log("  ● 剛才那個權限確認視窗，你按到「否」了嗎？");
    console.log("    ⚠️ 它預設就選在「否」，按 Enter 等於取消，而且畫面上不會有任何說明。");
    console.log("    再按一次這顆按鈕，這次在那個視窗按「是」。");
    console.log("  ● 它已經寫著「Sandbox ready」——回嚮導按一次「重新檢查」就好");
    // 沒設定成功就把舊的記錄搬回去，不要留下一台比按之前更糟的機器。
    restoreCapSid();
    process.exit(0);
  }

  // 每 15 秒說一次話。完全安靜的等待看起來像當掉，而這一段可能要等學生按 UAC。
  const waited = Math.floor((Date.now() - startedAt) / 15000);

  if (waited > announced) {
    announced = waited;
    console.log(`等那個視窗完成⋯⋯（${waited * 15} 秒）`);
  }

  await new Promise((resolve) => setTimeout(resolve, POLL_MS));
}

// 設定成功了，新的 cap_sid 已經寫出來，舊那份備份沒有用了。
try {
  rmSync(CAP_SID_BACKUP, { force: true });
} catch {
  // 刪不掉也無所謂，它只是一個帶著 .jr-setup-bak 的舊檔。
}

console.log("");
console.log("✓ 沙箱設定好了。那個終端視窗可以關掉了（codex 還開著的話按 Ctrl+C）。");
