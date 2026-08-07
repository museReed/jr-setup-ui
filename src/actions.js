import { LANGUAGES, STEP_IDS } from "./config-install.js";
import { EXECUTION_POLICY_FIX } from "./execution-policy.js";
import { INSTALLERS, installActionId, resolveInstaller } from "./installers.js";
import { moduleFile } from "./paths.js";

// moduleFile 而不是 new URL(...).pathname：後者在 Windows 會多一條前導斜線，
// 拿去當指令參數會變成 C:\C:\... 找不到檔案（見 paths.js 的說明）。
// 登入指令預設會自己彈瀏覽器，學生就來不及用卡片上的授權按鈕。
//
// claude 與 gh 都認 BROWSER 環境變數（claude 的二進位檔裡是
// `spawn(process.env.BROWSER, [url])`，gh 有正式文件），把它指到一個「存在、
// 吃得下參數、什麼都不做」的指令就能擋掉自動開啟，網頁改由卡片上的按鈕開。
//
// Windows 沒有 true.exe，用 where.exe：拿網址當參數會找不到檔案、印一行訊息就
// 結束，不開視窗也不會卡住。
const NO_BROWSER = process.platform === "win32" ? "where" : "true";
const NO_AUTO_BROWSER = { BROWSER: NO_BROWSER };

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
const verifyInTerminalScript = moduleFile(
  "../scripts/verify-in-terminal.mjs",
  import.meta.url,
);
const diagnoseNamingBlockScript = moduleFile(
  "../scripts/diagnose-naming-block.mjs",
  import.meta.url,
);
const diagnoseTitlePathScript = moduleFile(
  "../scripts/diagnose-title-path.ps1",
  import.meta.url,
);

export function shouldExplainOutput({ action, options = null, result }) {
  const succeeded =
    result.signal == null &&
    (result.exitCode === 0 || result.benign === true);

  if (succeeded) {
    return false;
  }

  if (action.startsWith("ext-")) {
    return true;
  }

  if (action === "install-config-step") {
    return options?.step?.startsWith("ext-") === true;
  }

  return action.startsWith("install-");
}

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

// 這張表漏一個 id，按鈕就會變成「安裝 undefined」——而且只有那一個項目缺的時候
// 才看得到，測試不會紅（實測加 python 時就是這樣）。下面用 assert 擋住。
export const installerNames = {
  claude: "Claude Code",
  codex: "Codex",
  git: "Git",
  gh: "GitHub CLI",
  python: "Python 3",
  // ghostty 一直沒寫在這裡，所以 macOS 上那顆按鈕從以前就是「安裝 undefined」。
  // 加 python 時順手做的這道守衛把它抓出來了。
  ghostty: "Ghostty 終端機",
  "windows-terminal": "Windows Terminal",
};

for (const id of Object.keys(INSTALLERS)) {
  if (installerNames[id] === undefined) {
    throw new Error(`installerNames 少了 ${id}，按鈕會顯示成「安裝 undefined」`);
  }
}

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
      // 有些安裝器要靠環境變數才不會停下來問問題（見 installers.js 的 codex）。
      ...(installer.env === undefined ? {} : { env: installer.env }),
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
  actions["diagnose-title-path"] = {
    kind: "fixed",
    label: "診斷終端標題",
    cmd: "cmd.exe",
    options: { step: ["tab-sync"] },
    args: [
      "/c",
      "start",
      "",
      "wt.exe",
      "powershell.exe",
      "-NoExit",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      diagnoseTitlePathScript,
    ],
    description: "開啟 Windows Terminal，逐段檢查標題同步路徑。",
  };
}

Object.assign(actions, {
  "diagnose-naming-block": {
    kind: "fixed",
    label: "診斷命名白名單",
    cmd: process.execPath,
    options: {
      step: ["claude-namer", "skill-claude-handoff"],
    },
    args: [diagnoseNamingBlockScript],
    description: "檢查命名指令卡在白名單、hook 或 Claude Code 內建防護。",
  },
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
  // hook 的效果只有在真終端裡看得到，所以這顆不是「跑完印結果」，而是「開一個
  // 視窗讓學生看」。學生不需要輸入任何東西。
  "verify-in-terminal": {
    kind: "fixed",
    label: "開終端驗證",
    cmd: process.execPath,
    options: {
      case: [
        "naming",
        "chained",
        "allowlist",
        "context",
        "title",
        "skill-rename",
        "skill-handoff",
        "skill-questions",
        "demo",
        "fullscreen-open",
        "fullscreen-proof",
        "statusline",
        "mcp-playwright",
      ],
      agent: ["claude", "codex"],
    },
    buildArgs: ({ case: testCase, agent }) => [
      verifyInTerminalScript,
      `--case=${testCase}`,
      `--agent=${agent}`,
    ],
    description: "開一個真的終端視窗跑驗證，學生只要看畫面。",
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
    // 用哪個 agent 跟著第一張卡的工具選擇走，不寫死（Reed 指定）。
    //
    // 原本一律用 claude。選「只要 Codex」的學生機器上根本沒有 claude——那組檢查
    // 整組被拿掉、CLI 也不會安裝——但 config.toml 是 protectExisting，仍然會要求
    // 合併。按下去跑的是一個不存在的指令，拿到「找不到 claude 指令」。
    //
    // 兩個都選時優先 claude：它是課堂的主線，而且合併要改檔案，Claude 這邊裝好的
    // acceptEdits 讓它不會停下來問。
    engine: ({ tools }) => (tools === "codex" ? "codex" : "claude"),
    permission: "write",
    options: {
      step: STEP_IDS,
      lang: LANGUAGES,
      tools: ["claude", "codex", "claude,codex"],
    },
    buildPrompt: ({ step, lang }) =>
      [
        `我要把工作坊的設定合併進我已經有的檔案，語言版本是 ${lang}，這一步是 ${step}。`,
        // 路徑錯了 agent 會自己去翻，翻得到就沒人發現——但每次合併都多燒一輪，
        // 翻不到就只能瞎猜。實際落點是 app/materials/（實測回報）。
        `新版內容在 ~/.jr-setup/app/materials/ 底下（claude-code/${lang}/ 與 codex/${lang}/）。`,
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
    env: NO_AUTO_BROWSER,
    description: "登入 Claude Code。",
  },
  "login-codex": {
    kind: "fixed",
    label: "登入 Codex",
    cmd: "codex",
    // ⚠️ 不要再加 --device-auth。
    //
    // 它確實會印出網址與一次性代碼、也不自己開瀏覽器，但那個模式需要**每個帳號**
    // 先去 ChatGPT Security Settings 打開「device code authorization」，沒開的人
    // 走到授權頁只會看到一段紅字要他去改設定（VM 實測）。對課堂學生是死路。
    //
    // 也沒辦法像 claude / gh 那樣用 BROWSER 擋掉自動開啟：codex 用 Rust 的
    // webbrowser crate，macOS 直接叫 Safari/Chrome、Windows 走 ShellExecute，
    // 二進位檔裡根本沒有 BROWSER 這個字串。
    //
    // 所以 codex 就是會自己開瀏覽器。卡片那邊不放「開啟授權頁」主按鈕假裝是使用者
    // 控制的，改成說明 + 備援連結（見 viewmodel 的 LOGIN_CARD_SERVICES）。
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
    // gh 的 GH_BROWSER 優先於 BROWSER（gh help environment 明寫），學生環境若已設
    // GH_BROWSER，只覆寫 BROWSER 會被蓋過去，所以兩個都設。
    env: { ...NO_AUTO_BROWSER, GH_BROWSER: NO_BROWSER },
    description: "登入 GitHub CLI。",
  },
});

// engine 可以是固定字串，也可以是一個吃 options 的函式（merge-config-step 就是後者
// ——它要跟著學生選的工具走）。呼叫端只想知道「這一次要跑哪個 agent」，兩種形狀都
// 在這裡收斂掉，免得每個用到 action.engine 的地方各判斷一次。
//
// 目前有兩處：組指令、以及挑輸出的 parser（claude 與 codex 的串流格式不同）。少改
// 一處的話畫面上的名字或解析會跟實際跑的那個對不上。
export function resolveEngine(action, options = null) {
  return typeof action.engine === "function"
    ? action.engine(options ?? {})
    : action.engine;
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
