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
import { spawn } from "node:child_process";
import { chmodSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const APPLY = process.argv.includes("--apply");

// codex 的沙箱選單只在它**用得到沙箱**時才跳。`codex sandbox` 這個子指令就是
// 拿來試沙箱的，比開一個完整的對話乾淨——學生不必先問它一句話才看到選單。
const BODY = "codex sandbox pwsh -c \"echo sandbox-ok\"";

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

console.log("會開一個新的終端視窗，讓 Codex 問你要怎麼設定沙箱。");
console.log("");
console.log("在那個視窗裡：");
console.log("  1. 選 1（Set up default sandbox）再按 Enter");
console.log("  2. 跳出來的權限確認視窗要按「是」");
console.log("     ⚠️ 那個視窗預設選在「否」，順手按 Enter 就等於取消，而且不會有任何說明");
console.log("  3. 看到它印出路徑就成功了，回到嚮導按「重新檢查」");
console.log("");

if (!APPLY) {
  console.log("以上只是先看不動。加 --apply 才會真的開視窗。");
  process.exit(0);
}

const { cmd, args } = openTerminal(launcher());
spawn(cmd, args, { stdio: "ignore", detached: true }).unref();

console.log("已經開了一個新的終端視窗，請看那個視窗。");
