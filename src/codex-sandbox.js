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
// Store 版是 MSIX 包，檔案系統與權限都被虛擬化過，沙箱 helper 起不來。而且它在 PATH
// 上的入口是 WindowsApps 底下的「應用程式執行別名」，不是真的執行檔——路徑看起來
// 很正常，問題完全看不出來。
//
// ⚠️ 這一層要能單獨、快速查得到（B5）：沙箱探針要真的去跑 codex，很慢；而 Store 版
// 這件事光看路徑就知道，第一頁就該講，不必等探針。

// Store 版的 PowerShell 在 PATH 上的入口一律落在這裡。傳統安裝是
// C:\Program Files\PowerShell\7\pwsh.exe，兩者分得很開。
const WINDOWS_APPS = /\\WindowsApps\\/i;

export function isStorePowerShell(source) {
  return typeof source === "string" && WINDOWS_APPS.test(source);
}

export function storePowerShellStatus(source) {
  if (source === null || source === undefined || source === "") {
    // 沒裝 pwsh 完全不是問題：課堂只需要 5.1，7 是加分。
    return { status: "ok", detail: "沒有裝 PowerShell 7（不影響課程）" };
  }

  if (!isStorePowerShell(source)) {
    return { status: "ok", detail: "是一般安裝版" };
  }

  return {
    status: "warn",
    installable: false,
    fixLabel: null,
    // ⚠️ 一行。長說明在 public/model.js 的 GUIDANCE——這一格右邊緊接著按鈕區。
    detail: "是 Microsoft Store 版，Codex 沙箱會起不來",
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
      detail: "沙箱要用的檔案找不到，而且 PowerShell 7 是 Store 版",
      codexPath,
    };
  }

  return {
    status: "warn",
    installable: false,
    detail: "Codex 沙箱要用的檔案找不到，跑起來會失敗",
    codexPath,
  };
}
