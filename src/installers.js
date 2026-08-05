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

export const INSTALLERS = {
  claude: {
    // Windows 上的 npm 是 npm.cmd / npm.ps1，沒有 npm.exe。
    // spawn 不開 shell 時找不到裸的 "npm"，必須寫完整檔名。
    win32: {
      cmd: "npm.cmd",
      args: ["install", "-g", "@anthropic-ai/claude-code"],
    },
    darwin: {
      cmd: "bash",
      args: ["-c", CLAUDE_DARWIN_SCRIPT],
    },
  },
  codex: {
    // Windows 上的 npm 是 npm.cmd / npm.ps1，沒有 npm.exe。
    // spawn 不開 shell 時找不到裸的 "npm"，必須寫完整檔名。
    win32: {
      cmd: "npm.cmd",
      args: ["install", "-g", "@openai/codex"],
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
