export const INSTALLERS = {
  claude: {
    // Windows 上的 npm 是 npm.cmd / npm.ps1，沒有 npm.exe。
    // spawn 不開 shell 時找不到裸的 "npm"，必須寫完整檔名。
    win32: {
      cmd: "npm.cmd",
      args: ["install", "-g", "@anthropic-ai/claude-code"],
    },
    darwin: {
      cmd: "npm",
      args: ["install", "-g", "@anthropic-ai/claude-code"],
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
      cmd: "npm",
      args: ["install", "-g", "@openai/codex"],
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
