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
const openVaultRepoScript = moduleFile(
  "../scripts/open-vault-repo.mjs",
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
const fixShellWrapperScript = moduleFile(
  "../scripts/fix-shell-wrapper.mjs",
  import.meta.url,
);
const fixCodexSandboxScript = moduleFile(
  "../scripts/fix-codex-sandbox.mjs",
  import.meta.url,
);
const setupCodexSandboxScript = moduleFile(
  "../scripts/setup-codex-sandbox.mjs",
  import.meta.url,
);
const fixLegacySkillsScript = moduleFile(
  "../scripts/fix-legacy-skills.mjs",
  import.meta.url,
);
const fixLegacyCliScript = moduleFile(
  "../scripts/fix-legacy-cli.mjs",
  import.meta.url,
);
const clearQuarantineScript = moduleFile(
  "../scripts/clear-quarantine.mjs",
  import.meta.url,
);
const finishBrewUninstallScript = moduleFile(
  "../scripts/finish-brew-uninstall.mjs",
  import.meta.url,
);
const finishNpmUninstallScript = moduleFile(
  "../scripts/finish-npm-uninstall.mjs",
  import.meta.url,
);
const restoreMergeBackupScript = moduleFile(
  "../scripts/restore-merge-backup.mjs",
  import.meta.url,
);
const mergeInTerminalScript = moduleFile(
  "../scripts/merge-in-terminal.mjs",
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
  "pwsh-store": "PowerShell 7（一般安裝版）",
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
  // 兩個平台都要有：POSIX 那邊 .zshrc 一樣塞得進一個指向舊 npm 路徑的函式。
  "fix-shell-wrapper": {
    kind: "fixed",
    // 畫面上那顆的文字由 env-check 的 fixLabel 決定（要指名壞掉的是哪一支）。
    // 這裡是 action 註冊表的名字，兩支都可能，所以不指名。
    label: "清除廢棄的引用",
    cmd: process.execPath,
    args: [fixShellWrapperScript, "--apply"],
    description:
      "刪掉 shell 設定檔裡指向已刪檔案的 claude / codex 函式，讓安裝完的 CLI 叫得動。",
  },
  // 只有 Windows 用得到，但註冊在共用區：mac 上那一列根本不會出現，
  // 而把它藏進 win32 分支會讓 test/viewmodel.mjs 的守門測試在 mac 上看不到它。
  "fix-codex-sandbox": {
    kind: "fixed",
    label: "接回沙箱檔案",
    cmd: process.execPath,
    args: [fixCodexSandboxScript, "--apply"],
    description:
      "在 Codex 會去找的位置接一條 junction，指回它自己套件裡的 codex-resources。",
  },
  // 沙箱的**設定**跟上面那顆（接檔案）是兩件事，所以是兩個 action。
  //
  // ⚠️ 這顆開一個真的終端視窗，跟合併那顆同一個理由：codex 問的是互動選單，而選了
  // 之後跳的 UAC 框在背景管線裡會出現在嚮導後面——學生順手關掉，我們只拿到一個
  // 沒頭沒尾的錯誤碼。
  "setup-codex-sandbox": {
    kind: "fixed",
    label: "設定沙箱（開終端）",
    cmd: process.execPath,
    args: [setupCodexSandboxScript, "--apply"],
    description:
      "開一個終端把 Codex 叫起來，讓它問你要怎麼設定沙箱；選完回嚮導按重新檢查。",
  },
  // A3：合併改成開一個真的終端視窗。
  //
  // 舊的做法（已移除的 merge-config-step）是在嚮導裡叫 agent，輸出串到右邊那塊。
  // 問題是合併過程 agent 會反問「這兩條規則衝突，要留哪一個」——那句話在嚮導裡沒人
  // 回得了，最後它自己猜一個。開真視窗學生就能當場回答，也來得及在它做壞事前攔下來。
  //
  // 這支是 fixed 不是 agent：真正叫 agent 的是那個新視窗，這邊只負責拍快照、開窗、
  // 等完成標記、然後比對有沒有把學生原本的行弄丟。
  "merge-in-terminal": {
    kind: "fixed",
    label: "用 AI 合併（開終端）",
    cmd: process.execPath,
    options: { step: STEP_IDS, lang: LANGUAGES },
    buildArgs: ({ step, lang }) => [
      mergeInTerminalScript,
      `--step=${step}`,
      `--lang=${lang}`,
    ],
    description:
      "開一個真的終端視窗做合併，合完列出有沒有把你原本的行弄丟。",
  },
  // 合併是唯一會改寫學生自己內容的動作，所以它一定要有退路。用的是我們在合併前
  // 自己拍的快照，不是 AI 說它有備份的那一份（見 src/merge-backup.js）。
  "restore-merge-backup": {
    kind: "fixed",
    label: "還原成合併前",
    cmd: process.execPath,
    options: { step: STEP_IDS },
    buildArgs: ({ step }) => [restoreMergeBackupScript, `--step=${step}`, "--apply"],
    description: "把這一步的設定檔還原成合併前的樣子。",
  },
  "fix-legacy-cli": {
    kind: "fixed",
    label: "搬走 npm 裝的舊版",
    cmd: process.execPath,
    args: [fixLegacyCliScript, "--apply"],
    description:
      "把上一輪 npm 裝的 claude / codex 殘留搬進隔離區。只有 npm 版、沒有官方版的不動。",
  },
  "fix-legacy-skills": {
    kind: "fixed",
    label: "搬走打架的舊 skill",
    cmd: process.execPath,
    args: [fixLegacySkillsScript, "--apply"],
    description:
      "把 ~/.codex/skills 裡跟這次要裝的同名的 skill 搬進隔離區，Codex 才不會兩份都載入。",
  },
  // 那兩顆搬移鍵的收尾。⚠️ 唯一一顆真的刪東西的按鈕——範圍與不碰什麼寫在
  // scripts/clear-quarantine.mjs 的開頭，畫面上按之前也會先列出要刪什麼。
  // brew 那批的收尾：搬走連結只做了一半，Caskroom 裡的本體還在、brew 的清單上也
  // 還有它，下一次 brew upgrade 有機會把連結裝回來（見 src/leftovers.js）。
  //
  // ⚠️ 範圍只有隔離區 brew-cli 分區裡那幾支——我們親手搬走的那些。學生自己用 brew
  // 裝的其他東西一律不碰。
  "finish-brew-uninstall": {
    kind: "fixed",
    label: "跑 brew uninstall 收尾",
    cmd: process.execPath,
    args: [finishBrewUninstallScript, "--apply"],
    description:
      "把先前搬進隔離區的那幾支 Homebrew 舊版從 brew 的清單上卸掉，連結才不會被裝回來。",
  },
  // npm 那批的收尾，跟上面那顆同一個道理：套件本體還在，下一次 npm i -g 或換 Node
  // 版本重裝全域套件時，捷徑會被建回來。
  //
  // ⚠️ 只卸 NPM_PACKAGES 那張表上、而且我們剛才搬進隔離區的那幾支。學生自己 npm
  // 裝的其他全域套件一律不碰。
  "finish-npm-uninstall": {
    kind: "fixed",
    label: "跑 npm uninstall 收尾",
    cmd: process.execPath,
    args: [finishNpmUninstallScript, "--apply"],
    description:
      "把先前搬進隔離區的那幾支 npm 舊版從全域目錄卸掉，捷徑才不會被建回來。",
  },
  "clear-quarantine": {
    kind: "fixed",
    label: "清掉隔離區",
    cmd: process.execPath,
    args: [clearQuarantineScript, "--apply"],
    description:
      "把先前搬進 ~/.jr-setup/quarantine 的舊 skill 與舊 CLI 刪掉。合併的還原點與 .bak 不動。",
  },
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
        "open-vault",
        "vault-note",
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
  "open-vault-repo": {
    kind: "fixed",
    label: "看筆記的改動歷史",
    cmd: process.execPath,
    args: [openVaultRepoScript],
    description: "把筆記庫的 commit 歷史在瀏覽器開起來，證據在遠端不在本機。",
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

// engine 可以是固定字串，也可以是一個吃 options 的函式。呼叫端只想知道「這一次要跑
// 哪個 agent」，兩種形狀都在這裡收斂掉，免得每個用到 action.engine 的地方各判斷一次。
//
// 函式形狀目前沒有人在用了——合併那顆（唯一的使用者）在 A3 之後改成開真終端，
// agent 是那個新視窗叫的。留著是因為下一顆需要跟著選擇走的動作遲早會出現。
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
