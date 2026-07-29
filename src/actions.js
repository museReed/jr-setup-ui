import { LANGUAGES, STEP_IDS } from "./config-install.js";
import { EXECUTION_POLICY_FIX } from "./execution-policy.js";
import { INSTALLERS, installActionId, resolveInstaller } from "./installers.js";
import { moduleFile } from "./paths.js";

// moduleFile 而不是 new URL(...).pathname：後者在 Windows 會多一條前導斜線，
// 拿去當指令參數會變成 C:\C:\... 找不到檔案（見 paths.js 的說明）。
const installConfigsScript = moduleFile(
  "../scripts/install-configs.mjs",
  import.meta.url,
);
const verifyConfigsScript = moduleFile(
  "../scripts/verify-configs.mjs",
  import.meta.url,
);
const verifyBehaviorScript = moduleFile(
  "../scripts/verify-behavior.mjs",
  import.meta.url,
);
const verifyHooksLiveScript = moduleFile(
  "../scripts/verify-hooks-live.mjs",
  import.meta.url,
);
const verifyHookLiveScript = moduleFile(
  "../scripts/verify-hook-live.mjs",
  import.meta.url,
);

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

Object.assign(actions, {
  "install-config-step": {
    kind: "fixed",
    label: "安裝這一步",
    cmd: process.execPath,
    // 選項的值由 server 比對過白名單才會進到這裡。
    options: { step: STEP_IDS, lang: LANGUAGES },
    buildArgs: ({ step, lang }) => [
      installConfigsScript,
      `--step=${step}`,
      `--lang=${lang}`,
    ],
    description: "安裝單一個規則檔步驟。",
  },
  "verify-configs": {
    kind: "fixed",
    label: "驗證安裝",
    cmd: process.execPath,
    options: { lang: LANGUAGES, tools: ["claude", "codex", "claude,codex"] },
    buildArgs: ({ lang, tools }) => [
      verifyConfigsScript,
      `--lang=${lang}`,
      `--tools=${tools}`,
    ],
    description: "檢查規則檔是否真的生效，含實際觸發 hook。",
  },
  "verify-behavior": {
    kind: "fixed",
    label: "驗證回覆格式",
    cmd: process.execPath,
    options: { tools: ["claude", "codex", "claude,codex"] },
    buildArgs: ({ tools }) => [verifyBehaviorScript, `--tools=${tools}`],
    description: "請學生自己的 AI 回答一題並判定回覆有沒有照格式規則。",
  },
  "verify-hook-live": {
    kind: "fixed",
    label: "驗證 hook 會擋",
    cmd: process.execPath,
    args: [verifyHookLiveScript],
    description: "叫真的 Claude 跑一個串接指令，確認 hook 真的被載入並執行。",
  },
  "verify-hooks-live": {
    kind: "fixed",
    label: "驗證自動命名",
    cmd: process.execPath,
    args: [verifyHooksLiveScript],
    description:
      "叫真的 Claude 跑一次，確認命名 hook 有被觸發、名字有寫進檔案。" +
      "終端標題那一格 headless 驗不到，輸出會請學生回自己的終端看一眼。",
  },
  "merge-config-step": {
    kind: "agent",
    label: "用 AI 幫我合併",
    engine: "claude",
    permission: "write",
    options: { step: STEP_IDS, lang: LANGUAGES },
    buildPrompt: ({ step, lang }) =>
      [
        `我要把工作坊的設定合併進我已經有的檔案，語言版本是 ${lang}，這一步是 ${step}。`,
        `新版內容在 ~/.jr-setup/configs/ 底下（claude-code/${lang}/ 與 codex/${lang}/）。`,
        "請先讀我現有的檔案和新版內容，備份現有檔案（加 .bak.時間戳），",
        "再把工作坊的規則合併進去——保留我原本的內容，不要整份覆蓋。",
        "改完告訴我你加了什麼、有沒有衝突。",
      ].join(""),
    description: "把工作坊規則合併進使用者已存在的設定檔。",
  },
  "login-claude": {
    kind: "fixed",
    label: "登入 Claude Code",
    cmd: "claude",
    args: ["auth", "login"],
    acceptsInput: true,
    description: "登入 Claude Code。",
  },
  "login-codex": {
    kind: "fixed",
    label: "登入 Codex",
    cmd: "codex",
    args: ["login"],
    acceptsInput: true,
    description: "登入 Codex。",
  },
  "login-gh": {
    kind: "fixed",
    label: "登入 GitHub CLI",
    cmd: "gh",
    args: [
      "auth",
      "login",
      "--web",
      "--hostname",
      "github.com",
      "--git-protocol",
      "https",
      "--skip-ssh-key",
    ],
    acceptsInput: true,
    description: "登入 GitHub CLI。",
  },
});

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
