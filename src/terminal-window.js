// 開一個真的終端機視窗，跑我們寫出來的臨時腳本（.command / .ps1）。
//
// 三支腳本本來各抄一份 openTerminal——verify-in-terminal、merge-in-terminal、
// setup-codex-sandbox。抄第四份的時候一定會漏掉下面那個差異，而這個 repo 已經被
// 「同一件事寫兩份、只修到一邊」咬過好幾次（BOM、profile 路徑、npm 判準）。
//
// ⚠️ 三份唯一的差異是 Windows 上的 -NoProfile，而且它是**刻意**的，不是漏抄：
//
//   驗證 / 合併   要跑學生平常那一支 claude / codex，而 wrapper 住在 profile 裡
//                 → 一定要載入 profile
//   沙箱設定      只跑一個 codex 指令，profile 對它沒有用處；而且真機上載入 profile
//                 會噴紅字（Reed 的 arm64 VM：Smart App Control 評估中 → WDAC 稽核
//                 → 未簽章的 profile 落進受限語言模式 → dot-source 被拒），學生看到
//                 「Cannot dot-source this command…」跟他要做的事一點關係都沒有
//                 → 一定不要載入
//
// 所以 loadProfile 是參數不是常數。預設 true：那是三支裡兩支要的，而且忘記傳的話
// 得到的是「多載入一個 profile」，不是「沙箱那支的紅字」以外的新毛病。

// Ghostty 可能在兩個地方：brew cask 裝到 /Applications，自己拖曳的人放 ~/Applications。
//
// ⚠️ 這份清單是**唯一**一份——env-check 用它判「裝了沒」，這裡用它決定「用不用它開」。
// 分成兩份的話會長出「那一列說已安裝，驗證卻還是跑在系統 Terminal 上」這種矛盾。
export function ghosttyAppPaths(home) {
  return [`/Applications/Ghostty.app`, `${home}/Applications/Ghostty.app`];
}

export function terminalCommand(
  launcher,
  { platform, home, exists, loadProfile = true },
) {
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
        ...(loadProfile ? [] : ["-NoProfile"]),
        // 我們自己寫出來的臨時腳本不該看機器的執行原則臉色。Windows 預設是
        // Restricted，新開的視窗會直接紅字「running scripts is disabled」，而嚮導
        // 這邊看到的 exit code 還是 0——因為 cmd start 一開完就回來了（VM 實測）。
        //
        // Bypass 只影響這一個行程，不動機器設定。
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        launcher,
      ],
    };
  }

  // 裝了 Ghostty 就用它。嚮導自己要求學生裝 Ghostty（那一列沒裝是紅燈），驗證卻
  // 跑在系統 Terminal 上的話，學生會問「那我裝它幹嘛」——而且他之後上課用的是
  // Ghostty，驗證跑在別的終端機等於驗了一個他不會用的環境。
  //
  // 實測（Reed 的 mac，2026-08-15）：Ghostty 的 Info.plist 自己宣告接手 .command
  // （CFBundleDocumentTypes → Terminal scripts），open -a 之後腳本真的會執行，
  // 視窗裡 TERM_PROGRAM=ghostty。
  //
  // 沒裝就交回系統的預設處理程式，跟以前一樣——那是安裝 Ghostty 之前的過渡狀態。
  const ghostty = ghosttyAppPaths(home).find((path) => exists(path));

  return ghostty === undefined
    ? { cmd: "open", args: [launcher] }
    : { cmd: "open", args: ["-a", ghostty, launcher] };
}
