// 「開一個真的終端視窗，在裡面跑一段東西」的兩個共用零件。
//
// 抽出來是因為現在有兩個地方要開視窗，而它們踩過的坑一模一樣：
//
//   scripts/verify-in-terminal.mjs   hook 的效果只有真終端看得到
//   scripts/merge-in-terminal.mjs    合併要讓學生看得到授權框、也答得了問題
//
// ⚠️ 這個模組只「寫檔」與「算出要執行的指令」，不自己 spawn。開視窗那一下留在
// scripts 裡——src 底下能開子行程的模組是一份寫死的清單（見 test/backend-layers.mjs），
// 而那份清單短才有意義。
import { chmodSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// 把要跑的東西寫成一支臨時腳本。
//
// 為什麼不直接把指令塞進 wt.exe / open 的參數：那一串會經過兩三層 shell，引號規則
// 各不相同，中文提問一過去就散了。寫成檔案之後只剩「執行這個檔」一件事。
//
// Windows 那份一定要 BOM：PowerShell 5.1 沒有 BOM 就當系統 ANSI 讀，中文變亂碼，
// 而亂碼字元可能剛好破壞字串引號，整支腳本連 parse 都過不了。
//
// ⚠️ 兩邊都刻意「不」跳過 profile：tab-sync 的 wrapper 就住在 profile 裡，跳過它
// 等於學生在這個視窗裡看到的行為跟他平常的終端不一樣。
export function writeLauncher({ body, env = {}, prefix = "jr", stamp }) {
  const id = stamp ?? `${process.pid}-${Date.now()}`;
  const entries = Object.entries(env);

  if (process.platform === "win32") {
    const file = path.join(tmpdir(), `${prefix}-${id}.ps1`);
    const setEnv = entries
      .map(([name, value]) => `$env:${name} = '${value}'`)
      .join("\n");
    // BOM 用逃脫寫法，不放那個字元本身——它在編輯器與 diff 裡都看不見，留一個隱形
    // 字元在這裡，下一個人只會看到一段莫名其妙的字串。
    writeFileSync(file, `\ufeff${setEnv}\n${body}\n`, "utf8");
    return file;
  }

  const file = path.join(tmpdir(), `${prefix}-${id}.command`);
  const setEnv = entries
    .map(([name, value]) => `export ${name}='${value}'`)
    .join("\n");
  // -i 讓 zsh 讀 ~/.zshrc，wrapper 才會存在。
  writeFileSync(file, `#!/bin/zsh -i\n${setEnv}\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

// 開那個視窗要執行的指令。回傳 { cmd, args }，spawn 由呼叫端自己做。
export function openTerminal(launcher, platform = process.platform) {
  if (platform === "win32") {
    return {
      cmd: "cmd.exe",
      args: [
        "/c",
        "start",
        "",
        "wt.exe",
        "powershell.exe",
        "-NoExit",
        // 我們自己寫出來的臨時腳本，不該看機器的執行原則臉色。Windows 預設是
        // Restricted，新開的視窗會直接紅字「running scripts is disabled」，而嚮導這
        // 邊看到的 exit code 還是 0——因為 cmd start 一開完就回來了（VM 實測）。
        //
        // Bypass 只影響這一個行程，不動機器設定。順帶把 profile 也救回來：Restricted
        // 連 profile 都不載入，wrapper 就住在裡面。
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        launcher,
      ],
    };
  }

  return { cmd: "open", args: [launcher] };
}
