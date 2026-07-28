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
  git: {
    win32: {
      cmd: "winget",
      args: ["install", "--id", "Git.Git", "-e", "--silent"],
    },
    darwin: {
      cmd: "brew",
      args: ["install", "git"],
    },
  },
  gh: {
    win32: {
      cmd: "winget",
      args: ["install", "--id", "GitHub.cli", "-e", "--silent"],
    },
    darwin: {
      cmd: "brew",
      args: ["install", "gh"],
    },
  },
};

export function resolveInstaller(id, platform) {
  return INSTALLERS[id]?.[platform] ?? null;
}

export function installActionId(id) {
  return `install-${id}`;
}
