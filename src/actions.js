import { EXECUTION_POLICY_FIX } from "./execution-policy.js";
import { INSTALLERS, installActionId, resolveInstaller } from "./installers.js";
import { buildTerminalLaunch } from "./terminal-launch.js";

// 這張表是 action 白名單本體，之後真正的安裝步驟會加在這裡。
// 網路端只會傳 key，指令內容永遠寫死在本檔。
export const actions = {
  hello: {
    kind: "fixed",
    label: "顯示問候",
    cmd: "echo",
    args: ["hello from jr-setup-ui"],
    description: "輸出一行問候文字。",
  },
  "slow-count": {
    kind: "fixed",
    label: "慢速計數",
    cmd: "bash",
    args: ["-c", "for i in 1 2 3; do echo tick $i; sleep 1; done"],
    description: "每秒輸出一行計數。",
  },
  "fail-demo": {
    kind: "fixed",
    label: "失敗示範",
    cmd: "bash",
    args: ["-c", "echo 這是 stderr >&2; exit 3"],
    description: "輸出 stderr 並以 exit code 3 結束。",
  },
  "claude-hello": {
    kind: "agent",
    label: "Claude 問候",
    engine: "claude",
    prompt: "請只回覆兩個字：OK",
    permission: "read-only",
    description: "請 Claude 回覆 OK。",
  },
  "codex-hello": {
    kind: "agent",
    label: "Codex 問候",
    engine: "codex",
    prompt: "請只回覆兩個字：OK",
    permission: "read-only",
    description: "請 Codex 回覆 OK。",
  },
  "claude-free": {
    kind: "agent",
    label: "送給 Claude",
    engine: "claude",
    prompt: "",
    acceptsPrompt: true,
    permission: "read-only",
    allowsWriteToggle: true,
    description: "把輸入內容送給 Claude。",
  },
  "codex-free": {
    kind: "agent",
    label: "送給 Codex",
    engine: "codex",
    prompt: "",
    acceptsPrompt: true,
    permission: "read-only",
    allowsWriteToggle: true,
    description: "把輸入內容送給 Codex。",
  },
};

const installerNames = {
  claude: "Claude Code",
  codex: "Codex",
  git: "Git",
  gh: "GitHub CLI",
};

for (const id of Object.keys(INSTALLERS)) {
  const installer = resolveInstaller(id, process.platform);

  if (installer !== null) {
    const name = installerNames[id];
    actions[installActionId(id)] = {
      kind: "fixed",
      label: `安裝 ${name}`,
      cmd: installer.cmd,
      args: installer.args,
      description: `安裝 ${name}。完成後需重新開啟嚮導。`,
    };
  }
}

if (process.platform === "win32") {
  actions["fix-execution-policy"] = {
    kind: "fixed",
    label: "修正執行原則",
    cmd: EXECUTION_POLICY_FIX.cmd,
    args: EXECUTION_POLICY_FIX.args,
    description: "將目前使用者的 PowerShell 執行原則改為 RemoteSigned。",
  };
}

const loginActions = [
  {
    key: "login-claude",
    label: "登入 Claude Code",
    commandLine: "claude auth login",
    description: "開啟終端機視窗登入 Claude Code。",
  },
  {
    key: "login-codex",
    label: "登入 Codex",
    commandLine: "codex login",
    description: "開啟終端機視窗登入 Codex。",
  },
  {
    key: "login-gh",
    label: "登入 GitHub CLI",
    commandLine: "gh auth login",
    description: "開啟終端機視窗登入 GitHub CLI。",
  },
];

for (const loginAction of loginActions) {
  const command = buildTerminalLaunch(
    loginAction.commandLine,
    process.platform,
  );

  if (command !== null) {
    actions[loginAction.key] = {
      kind: "fixed",
      label: loginAction.label,
      cmd: command.cmd,
      args: command.args,
      description: loginAction.description,
      // 這類 action 只負責開一個獨立視窗，沒有輸出可以串。若照一般方式接管線，
      // 那個視窗會一直握著管線不放，close 事件永遠不來、前端永遠卡在執行中。
      launchesWindow: true,
    };
  }
}

export function buildAgentCommand(engine, prompt, permission) {
  if (permission !== "read-only" && permission !== "write") {
    throw new Error(`不支援的代理權限：${permission}`);
  }

  if (engine === "claude") {
    const allowedTools = ["Read", "Glob", "Grep"];

    if (permission === "write") {
      allowedTools.push("Write", "Edit");
    }

    return {
      cmd: "claude",
      args: [
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        // --allowedTools 是變長參數，逐個列會把 prompt 一起吃掉；
        // 必須用逗號串成單一值，再用 -- 收尾，prompt 才傳得進去。
        "--allowedTools",
        allowedTools.join(","),
        "--",
        prompt,
      ],
    };
  }

  if (engine === "codex") {
    const sandbox =
      permission === "read-only" ? "read-only" : "workspace-write";

    return {
      cmd: "codex",
      args: [
        "exec",
        "--json",
        "--color",
        "never",
        "--skip-git-repo-check",
        "--sandbox",
        sandbox,
        // 同上：用 -- 收尾，prompt 以 - 開頭時才不會被當成參數。
        "--",
        prompt,
      ],
    };
  }

  throw new Error(`不支援的代理引擎：${engine}`);
}
