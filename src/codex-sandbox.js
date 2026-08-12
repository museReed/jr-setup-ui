// Windows 上兩個「裝好了、看起來也對，但一跑就爆」的坑。兩個都只在 Windows 有意義。
//
// ── 第一層：codex 的沙箱 helper 找不到 ──────────────────────────────────
//
// 症狀是 `ShellExecuteExW failed to launch setup helper: 1223`。
// PATH 上那條 %LOCALAPPDATA%\Programs\OpenAI\Codex\bin 是一個 junction，而且只指到
// bin。codex 找 codex-windows-sandbox-setup.exe 時假設它是 codex.exe 的兄弟、或在
// 旁邊（或 bin 的上一層旁邊）的 codex-resources 目錄裡——透過那條 junction 進來的話
// 三個地方都對不到，於是退回裸檔名，Windows 找不到。
// 追蹤：openai/codex #28278、#29952、#30829。
//
// ── 第二層：PowerShell 是 Microsoft Store 版 ────────────────────────────
//
// 這一層的說法改過兩次，兩次都是被實測推翻的，所以把過程寫下來：
//
//   最初      「Store 版是 MSIX，沙箱**起不來**」——那是一個疑問，不是一次事故
//   2026-08-11 拿掉警告：Store 版底下 `codex exec --sandbox read-only` 完全正常
//   2026-08-12 **警告改回來，但理由完全不同**（見下）
//
// ⚠️ 8/11 那次的測試是**無效的**：那台的沙箱其實從來沒設定起來（`~/.codex/cap_sid`
// 是快照帶的、helper 也找不到），所以 codex 根本沒走 `CreateProcessAsUserW`，
// 測到的「正常」只是它退回去跑而已。
//
// 8/12 把沙箱真的設定起來之後，症狀立刻出現：
//
//   codex sandbox powershell …  →  正常（5.1 住在 System32，不是 MSIX）
//   codex sandbox pwsh …        →  CreateProcessAsUserW failed: 2 / 1920
//
// 真正的壞法是：**提升式沙箱以受限帳號跑指令，而那個帳號存取不到 MSIX 封裝的
// pwsh**。所以沙箱起得來、檔案也改得動（apply_patch 沒問題），但 codex 一個指令
// 都執行不了。學生看到的是一長串 `CreateProcessAsUserW failed: 1920`，完全聯想
// 不到「因為我的 PowerShell 是從市集裝的」。
//
// ⚠️ **不能靠設定繞過**。codex 的 shell 選法寫死在 shell-command/src/shell_detect.rs：
// `which::which("pwsh")` 先查 PATH，找到 WindowsApps 那支就用它；找不到任何 pwsh
// 才退回 `powershell`。沒有環境變數、沒有 config key 可以覆寫。
//
// 上游 openai/codex#35871 把這件事量得比我們徹底（同一台、同一個 session、每種
// shell 各 20 次）：MSIX 的 pwsh 20/20 失敗，5.1、cmd.exe、git bash 各 0/20。
// 那份 issue 也指出它是六七個看起來不相干的回報（#26803 #25436 #26186 #9062
// #30047 #26896）背後的同一個原因——因為沒有人發現條件是「shell 是不是封裝過的」。
//
// ⚠️ 它還解掉一個我們自己踩過的困惑：失敗看起來「間歇」其實是**逐指令決定**的。
// `echo hello` 20/20 失敗、`Get-Content` 20/20 成功，因為讀檔那條路根本到不了
// SpawnChild。所以我們看到的「apply_patch 成功、下一步 Get-Content 炸」不矛盾
// ——那次的 Get-Content 是**透過 shell** 跑的。
//
// 自救三條，寫在 model.js 的 GUIDANCE 裡（順序就是建議順序）：
//   1. 從 aka.ms/PSWindows 裝 MSI 版 → 落在機器 PATH，排在 WindowsApps 前面。
//      **這是首選**：留著 PowerShell 7，也留著完整的沙箱防護
//   2. `[windows] sandbox = "unelevated"`（issue 裡的官方退路）→ 不用 CreateProcessAsUserW，
//      代價是防護較弱
//   3. 關掉 pwsh.exe 的應用程式執行別名 → which 找不到 → 退回 5.1。零下載，
//      但等於讓學生降版本，所以排最後（Reed 拍板）
//
// ⚠️ **不要接 winget 安裝鍵**，至少在重驗之前不要：installers.js 那段記的是
// 「實測拿到的還是 MSIX」，但那次觀察有個沒排除的干擾——那台**已經裝過**，
// 指令根本是 no-op。要接的話得先在一台沒裝過的機器上確認 winget 給的是哪一種包。

// Store 版的 PowerShell 在 PATH 上的入口一律落在這裡。傳統安裝是
// C:\Program Files\PowerShell\7\pwsh.exe，兩者分得很開。
const WINDOWS_APPS = /\\WindowsApps\\/i;

export function isStorePowerShell(source) {
  return typeof source === "string" && WINDOWS_APPS.test(source);
}

// ⚠️ 這一列**會警告**，而且沒有修復鍵——自救步驟在 GUIDANCE 裡（兩條路都不是
// 我們按得下去的：一個是 Windows 設定裡的開關，一個是手動裝 MSI）。
//
// 「沒裝 pwsh」反而是好的：codex 找不到 pwsh 就退回 5.1，而 5.1 在沙箱裡沒問題。
// 所以這一列的黃燈條件很窄——**裝了、而且是市集那份**。
export function storePowerShellStatus(source) {
  if (source === null || source === undefined || source === "") {
    // 沒裝 pwsh 完全不是問題，而且對沙箱來說還比較好（codex 會退回 5.1）。
    return { status: "ok", detail: "沒有裝 PowerShell 7（不影響課程）" };
  }

  if (!isStorePowerShell(source)) {
    return { status: "ok", detail: "是一般安裝版" };
  }

  return {
    status: "warn",
    // ⚠️ 不給安裝鍵：winget 拿到的還是 MSIX，按了會「說成功、那一列還是黃的」。
    installable: false,
    // ⚠️ 一行。完整說法在 GUIDANCE，那裡才有版面。
    detail: "市集版的 PowerShell，Codex 執行指令會失敗",
    storePath: source,
  };
}

// codex 找 helper 的三個地方，照它自己的順序：
//
//   1. codex.exe 的兄弟
//   2. codex.exe 旁邊的 codex-resources\
//   3. bin 的上一層旁邊的 codex-resources\
//
// 三個都對不到就是會炸的那種裝法。judgement 寫成純函式，因為真的要重現得先在
// Windows 上弄出一條 junction——那不是每次跑測試都做得到的事。
const HELPER = "codex-windows-sandbox-setup.exe";

export function findSandboxHelper(codexPath, { exists }) {
  if (typeof codexPath !== "string" || codexPath === "") {
    return null;
  }

  const binDir = codexPath.replace(/[\\/][^\\/]+$/, "");
  const parentDir = binDir.replace(/[\\/][^\\/]+$/, "");
  const candidates = [
    `${binDir}\\${HELPER}`,
    `${binDir}\\codex-resources\\${HELPER}`,
    `${parentDir}\\codex-resources\\${HELPER}`,
  ];

  return candidates.find((candidate) => exists(candidate)) ?? null;
}

// 修法：在 codex 會去看的位置，建一條 junction 指到真正的 codex-resources。
//
// 檔案本來就在機器上——PATH 上那條 bin junction 指到
// ~\.codex\packages\standalone\current\bin，而 codex-resources 就在它的上一層。
// codex 找的是「bin 的上一層旁邊」，從 junction 這側看過去是
// %LOCALAPPDATA%\Programs\OpenAI\Codex\，那裡什麼都沒有。補一條 junction 就通了。
//
// 為什麼是 junction 不是複製：codex.exe 那包 250MB 起跳，而 junction 是零成本。
// Windows 上建目錄 junction 不需要管理員權限（symlink 要，除非開了開發人員模式）。
//
// ⚠️ 要接到 ...\standalone\current\codex-resources，**不是**解析到底的
// ...\releases\0.147.0-aarch64-pc-windows-msvc\codex-resources。
// 第一版用 realpathSync 解 bin，Node 把整條鏈連 current 一起解開，junction 於是
// 釘死在當下那個版本號上——codex 升版、舊的 releases 目錄被清掉，連結就斷了
// （真機截圖抓到的）。接在 current 上，升版時它自己會跟著換。
const RELEASES_SEGMENT = /([\\/])releases\1[^\\/]+(?=[\\/]|$)/i;

export function currentPackageRoot(realBinPath) {
  const packageRoot = realBinPath.replace(/[\\/][^\\/]+$/, "");

  return packageRoot.replace(RELEASES_SEGMENT, "$1current");
}

export function planSandboxLink({ codexPath, realBinPath, exists }) {
  if (
    typeof codexPath !== "string" ||
    codexPath === "" ||
    typeof realBinPath !== "string" ||
    realBinPath === ""
  ) {
    return null;
  }

  const binDir = codexPath.replace(/[\\/][^\\/]+$/, "");
  const linkPath = `${binDir.replace(/[\\/][^\\/]+$/, "")}\\codex-resources`;
  const targetPath = `${currentPackageRoot(realBinPath)}\\codex-resources`;

  // 真正的那份不在的話就沒得接——那是另一種壞法（套件本身缺檔），
  // 接一條指向空氣的 junction 只會把問題藏起來。
  if (!exists(targetPath)) {
    return null;
  }

  // ⚠️ 「連結在不在」跟「連結通不通」是兩件事。只看前者的話，升版之後那條斷掉的
  // junction 會被當成「已經接好了」，學生按第二次也修不好（第一版就是這樣）。
  // 判準改成：從連結那條路走得到 helper 才算接好。
  if (exists(`${linkPath}\\${HELPER}`)) {
    return { linkPath, targetPath, alreadyLinked: true, stale: false };
  }

  // 連結在、但走不到 helper ＝ 斷掉的舊連結。要先拆掉再接。
  return {
    linkPath,
    targetPath,
    alreadyLinked: false,
    stale: exists(linkPath),
  };
}

export function sandboxStatus({ codexPath, helperPath, storePowerShell }) {
  if (codexPath === null || codexPath === undefined || codexPath === "") {
    // codex 都還沒裝的話，這一列沒有話好說——那一列自己會紅。
    return { status: "ok", detail: "等 Codex 裝好再看這一項" };
  }

  if (helperPath !== null) {
    return { status: "ok", detail: "沙箱要用的檔案都在" };
  }

  // 兩層都中的時候先講 Store 版：它是比較上游的那個，而且是學生自己修得掉的。
  if (storePowerShell) {
    return {
      status: "warn",
      installable: false,
      fixLabel: "接回沙箱要用的檔案",
      detail: "沙箱檔案接不上，而且 PowerShell 7 是 Store 版",
      codexPath,
    };
  }

  return {
    status: "warn",
    installable: false,
    fixLabel: "接回沙箱要用的檔案",
    detail: "Codex 找不到沙箱要用的檔案，跑起來會失敗",
    codexPath,
  };
}
