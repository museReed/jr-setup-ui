// macOS 上 `npm install -g` 會寫 /usr/local/lib/node_modules——官方 .pkg 裝的 Node
// 把那個目錄留給 root，學生帳號直接 EACCES（乾淨 VM 實測）。Windows 一直沒撞到，
// 是因為它的全域目錄在 %APPDATA%，本來就是使用者自己的：同一行指令、兩個平台的
// 擁有者不同。
//
// 所以 macOS 改用兩家官方各自的原生安裝器：不經過 npm、不需要 sudo，都裝進
// ~/.local/bin。npm 那條路的建議「try running as root」對這兩個 CLI 是錯的——
// 用 sudo 裝出來的東西屬於 root，之後自動更新用學生身分跑，寫不進去且靜默失敗。
//
// pipefail 不能省：curl 失敗時右邊的直譯器讀到空輸入會正常結束，整條管線變成
// exit 0——沒裝成功卻回報成功，還會照樣去寫 .zshrc。
//
// ⚠️ 兩支安裝器對 PATH 的處理不一樣，實測過才知道，不要照著另一支類推：
//   claude  完全不碰 shell rc，只在輸出裡印一行提醒 → 嚮導得自己補
//   codex   會自己把 ~/.local/bin 寫進 ~/.zprofile → 嚮導不要插手
function ensureZshrcPath(binDir) {
  const line = `export PATH="${binDir}:$PATH"`;
  // 追加前先 grep：重裝、或學生自己照安裝器的提醒加過，都不該長出第二行。
  return `LINE='${line}'\ngrep -qF "$LINE" "$HOME/.zshrc" 2>/dev/null || printf '\\n%s\\n' "$LINE" >> "$HOME/.zshrc"`;
}

const CLAUDE_DARWIN_SCRIPT = [
  "set -eo pipefail",
  "curl -fsSL https://claude.ai/install.sh | bash",
  ensureZshrcPath("$HOME/.local/bin"),
].join("\n");

const CODEX_DARWIN_SCRIPT = [
  "set -eo pipefail",
  "curl -fsSL https://chatgpt.com/codex/install.sh | sh",
].join("\n");

// Windows 走兩家官方的 PowerShell 安裝器。npm 那條在 Windows 上本來就能跑（全域
// 目錄在 %APPDATA%，沒有 macOS 的權限問題），換掉是為了三件事：不再要求學生機器上
// 的 Node 裝得對、兩個平台同一套安裝來源、以及 npm 那層轉手本身會壞的地方（關掉
// optional deps、平台包缺失）就不存在了。
//
// ⚠️ 讀過兩支 .ps1 之後才敢寫的差異，不要照著 macOS 那半類推：
//   claude  下載 claude.exe 再跑 `claude.exe install`，落點 %USERPROFILE%\.local\bin。
//           它有沒有把那個目錄寫進登錄檔，腳本裡看不出來 → env-path.js 補一份保險。
//   codex   自己把目錄寫進登錄檔的 User Path（SetEnvironmentVariable(..., "User")），
//           嚮導既有的「重讀登錄檔」機制就抓得到，不用插手。
//
// -NoProfile：學生的 PowerShell profile 可能印東西或改 PATH，安裝不該受它影響。
// 指令內容照兩家官方文件寫的形狀，包含 codex 那個 -ExecutionPolicy Bypass。
const CLAUDE_WIN32_COMMAND = "irm https://claude.ai/install.ps1 | iex";
const CODEX_WIN32_COMMAND = "irm https://chatgpt.com/codex/install.ps1 | iex";

// 每一條 winget 都帶 --disable-interactivity：不准它停下來等人回答。
//
// 嚮導 spawn 出來的 winget 沒有人在看著，跳出任何一個要人選的提示就是永久卡住——
// 畫面停在安裝中，學生只能按取消。--accept-*-agreements 只擋掉條款那兩題，其餘的
// （來源要選哪個、要不要換套件）擋不到，這個旗標才是整批的。
//
// ⚠️ 它**不會**讓輸出變乾淨。winget 的轉圈符號與進度條靠 \r 一格一格重畫，在真的
// 終端機裡是一行動畫，透過管子接出來就是幾百行 `- \ | /`——加了這個旗標之後照樣有
// （Windows VM 實測，加旗標前後的原始輸出都是滿滿的轉圈符號）。winget 沒有關進度的
// 旗標，要乾淨只能在我們這邊過濾。那是另一件事，還沒做。
export const INSTALLERS = {
  claude: {
    win32: {
      cmd: "powershell.exe",
      args: ["-NoProfile", "-Command", CLAUDE_WIN32_COMMAND],
    },
    darwin: {
      cmd: "bash",
      args: ["-c", CLAUDE_DARWIN_SCRIPT],
    },
  },
  codex: {
    win32: {
      cmd: "powershell.exe",
      args: [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        CODEX_WIN32_COMMAND,
      ],
      // 跟 macOS 同一個環境變數（.ps1 第 14 行讀它）。Windows 這邊其實有第二道
      // 保險——Prompt-YesNo 在 stdio 被導向時直接回 false，而嚮導的 spawn 就是
      // 導向的——但不靠那個副作用：意圖寫出來，兩個平台也才一致。
      env: { CODEX_NON_INTERACTIVE: "1" },
    },
    darwin: {
      cmd: "bash",
      args: ["-c", CODEX_DARWIN_SCRIPT],
      // 沒有這個變數，安裝器最後會問「Start Codex now? [y/N]」——而且它是直接寫
      // /dev/tty、也從 /dev/tty 讀。嚮導 spawn 出來的子程序繼承了啟動嚮導的那個
      // 終端機，所以問句會印在學生沒在看的終端機視窗，然後停在那裡等一個永遠不會
      // 來的輸入（有控制終端時 /dev/tty 開得起來，實測確認）。
      //
      // 網頁那格輸入框救不了：它寫的是子程序的 stdin，而安裝器繞過 stdin。
      // 這個變數是安裝腳本自己提供的開關（腳本第 6 行讀它），不是硬繞。
      // 它也會讓「要不要移除衝突的 codex」答「不要」——正是我們要的，不該在
      // 學生看不到的地方靜默移除他的東西。
      env: { CODEX_NON_INTERACTIVE: "1" },
    },
  },
  // Demo 那段的 self_play.py 要 python3。macOS 內建、Windows 沒有——實測 VM 上
  // 只有 Windows Store 的殼（打 python 會跳商店，py 也不存在），agent 只好當場把
  // 那支腳本改寫成 PowerShell。它做得到，但那是一次沒必要的即興演出：多花時間、
  // 結果不可重現，而 demo 的判定看的是產出檔案有沒有出現。
  //
  // 版本寫死 3.13：winget 的 Python 套件 ID 帶主次版號（Python.Python.3.13），
  // 沒有「最新」這個 ID。開課前手動更新這一行就好，跟 setup.sh 的 NODE_VERSION
  // 同一個做法。
  python: {
    win32: {
      cmd: "winget",
      args: [
        "install",
        "--id",
        "Python.Python.3.13",
        "-e",
        "--source",
        "winget",
        "--accept-source-agreements",
        "--accept-package-agreements",
        "--disable-interactivity",
        "--silent",
      ],
    },
    // macOS 內建 python3，只有在真的缺了才會跑到這裡。
    darwin: {
      cmd: "brew",
      args: ["install", "python"],
    },
  },
  git: {
    win32: {
      cmd: "winget",
      // 必須指定 --source winget：實測有些機器的 msstore 來源憑證驗證失敗
      // （0x8a15005e），沒指定來源時 winget 會直接放棄並要求你選一個。
      args: [
        "install",
        "--id",
        "Git.Git",
        "-e",
        "--source",
        "winget",
        "--accept-source-agreements",
        "--accept-package-agreements",
        "--disable-interactivity",
        "--silent",
      ],
    },
    darwin: {
      cmd: "brew",
      args: ["install", "git"],
    },
  },
  gh: {
    win32: {
      cmd: "winget",
      args: [
        "install",
        "--id",
        "GitHub.cli",
        "-e",
        "--source",
        "winget",
        "--accept-source-agreements",
        "--accept-package-agreements",
        "--disable-interactivity",
        "--silent",
      ],
    },
    darwin: {
      cmd: "brew",
      args: ["install", "gh"],
    },
  },
  ghostty: {
    darwin: {
      cmd: "brew",
      args: ["install", "--cask", "ghostty"],
    },
  },
  "windows-terminal": {
    win32: {
      cmd: "winget",
      args: [
        "install",
        "--id",
        "Microsoft.WindowsTerminal",
        "-e",
        "--source",
        "winget",
        "--accept-source-agreements",
        "--accept-package-agreements",
        "--disable-interactivity",
      ],
    },
  },
};

// winget 在「已經裝好、沒有可用更新」時會回非零 exit code，那不是失敗。
// 實測：安裝已存在的 Git 得到 2316632107（0x8A15002B，UPDATE_NOT_APPLICABLE）。
export function isBenignExit(cmd, exitCode) {
  if (typeof exitCode !== "number") {
    return false;
  }

  // winget 的錯誤碼是 32-bit unsigned，Node 拿到的是同一個數值。
  const WINGET_ALREADY_INSTALLED = 0x8a150061;
  const WINGET_NO_APPLICABLE_UPDATE = 0x8a15002b;

  if (cmd === "winget") {
    return (
      exitCode === WINGET_ALREADY_INSTALLED ||
      exitCode === WINGET_NO_APPLICABLE_UPDATE
    );
  }

  return false;
}

export function resolveInstaller(id, platform) {
  return INSTALLERS[id]?.[platform] ?? null;
}

export function installActionId(id) {
  return `install-${id}`;
}
