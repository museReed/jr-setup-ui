// 規則檔安裝：每個步驟是一個可以獨立執行、獨立驗證的單位。
// 這裡只算「要做什麼」，不碰檔案系統；真正動手的是 scripts/install-configs.mjs。
//
// ⚠️ 這份清單對應 jr_ai_agent_configs/install/{zh-TW,zh-CN,en}.md 的步驟，
// 檔案本體則內建在 materials/（用 scripts/sync-materials.sh 同步）。
// configs repo 改了之後，這兩處都要跟著更新（兩份是刻意的取捨，見 PR 說明）。

export const LANGUAGES = ["zh-TW", "zh-CN", "en"];
export const TOOLS = ["claude", "codex"];

// 核心三件套。一個 skill 一列：壞了看得出來是哪一支，重裝也只重裝那一支。
export const SKILL_NAMES = ["auto-rename", "handoff", "structured-questions"];

// skill 的卡片標題就是 skill 的名字。
//
// 其他卡的標題講「學生會看到的事」，因為那些設定學生不用叫、裝好就在背後生效。
// skill 不一樣：他要打那個名字才叫得動（Codex 那邊是 $handoff），標題不寫名字的話
// 學生知道有這個功能卻不知道怎麼呼叫。做什麼用的移到描述裡。
const SKILL_LABELS = {
  "auto-rename": "auto-rename",
  "vault-sync": "vault-sync",
  handoff: "handoff",
  "structured-questions": "structured-questions",
};

// 第三方 skill 走各自 GitHub 上定義的安裝法（npx skills / claude mcp），要網路與
// Node——跟前面那些內建素材的離線安裝不同類，所以另開一種 kind，畫面上也標出來。
const EXTERNAL_SKILL_STEPS = {
  "ext-frontend-design-claude": {
    label: "frontend-design（Claude）",
    agent: "claude",
    cmd: "npx",
    args: [
      "--yes",
      "skills",
      "add",
      "anthropics/skills",
      "--skill",
      "frontend-design",
      "-g",
      "-a",
      "claude-code",
      "-y",
    ],
    // 裝完長在哪：驗證只認這個落點，不看指令有沒有跑完。
    marker: ".claude/skills/frontend-design",
  },
  "ext-frontend-design-codex": {
    label: "frontend-design（Codex）",
    agent: "codex",
    cmd: "npx",
    args: [
      "--yes",
      "skills",
      "add",
      "anthropics/skills",
      "--skill",
      "frontend-design",
      "-g",
      "-a",
      "codex",
      "-y",
    ],
    marker: ".agents/skills/frontend-design",
  },
  "ext-skill-creator-claude": {
    label: "skill-creator（Claude）",
    agent: "claude",
    cmd: "npx",
    args: [
      "--yes",
      "skills",
      "add",
      "anthropics/skills",
      "--skill",
      "skill-creator",
      "-g",
      "-a",
      "claude-code",
      "--copy",
      "-y",
    ],
    marker: ".claude/skills/skill-creator",
  },
  "ext-playwright-codex": {
    label: "playwright（Codex）",
    agent: "codex",
    cmd: "npx",
    args: [
      "--yes",
      "skills",
      "add",
      "openai/skills",
      "--skill",
      "playwright",
      "-g",
      "-a",
      "codex",
      "-y",
    ],
    marker: ".agents/skills/playwright",
  },
  // Claude 這邊的 Playwright 不是 skill 而是 MCP server，落點在 ~/.claude.json，
  // 所以驗證方式跟上面四列不同（見 config-check.js 的 checkExternalSkill）。
  //
  // 為什麼兩邊機制不一樣，查過了：anthropics/skills 底下十七支 skill 裡沒有
  // playwright。最接近的是 webapp-testing，但它走 Python 的 playwright.sync_api、
  // 預設 headless，是拿來測本機網頁應用的——課堂要的是「學生看得到瀏覽器自己動」，
  // 而且它會多拉一條 Python 依賴，等於在安裝流程裡再開一個會壞的地方。
  //
  // 要統一的話唯一已知可行的方向是「兩邊都用 MCP」（Codex 支援 MCP，config.toml
  // 的 [mcp_servers.*] 就是），不是「兩邊都用 skill」。目前決定維持現狀。
  "ext-playwright-claude": {
    label: "playwright（Claude）",
    agent: "claude",
    cmd: "claude",
    args: ["mcp", "add", "-s", "user", "playwright", "npx", "@playwright/mcp@latest"],
    mcpServer: "playwright",
  },
};

export const EXTERNAL_SKILL_IDS = Object.keys(EXTERNAL_SKILL_STEPS);

// 筆記那一段：Obsidian 本體、接上 GitHub 的筆記庫、以及讓 AI 接手管理的 skill。
//
// vault 的位置寫死。嚮導沒有檔案選擇器，讓學生貼路徑的話「一鍵」就不成立，而且
// 每台機器路徑不一樣，驗證與 skill 裡的指令都得跟著變。
export const VAULT_DIR = "jr-workshop-vault";
export const VAULT_REPO = "obsidian-vault";
export const OBSIDIAN_GIT = {
  plugin: "obsidian-git",
  // release 的三個檔直接放進 vault 的 plugins 目錄就等於裝好了，不必解壓縮。
  files: ["main.js", "manifest.json", "styles.css"],
  release: "https://github.com/Vinzent03/obsidian-git/releases/latest/download",
  // key 名取自 2.38.6 的 DEFAULT_SETTINGS。寫錯的 key 會被安靜忽略——設定看起來
  // 寫進去了，行為卻是預設值，而畫面上沒有任何錯誤。
  settings: {
    // 打開 vault 就先把另一台推上去的抓下來
    autoPullOnBoot: true,
    // Obsidian 沒有「關閉 vault」這個時機可以掛，所以改成每 10 分鐘自動
    // commit + push 一次。學生不用記得按任何按鈕。
    autoSaveInterval: 10,
    // 推之前先拉——衝突大多是「另一台先推了」，先拉就少一半
    pullBeforePush: true,
    syncMethod: "merge",
    commitMessage: "vault backup: {{date}}",
    // 右下角那個分支名（main）拿掉：學生這一段不需要知道 branch 是什麼，而畫面上
    // 一個看不懂的英文字只會讓他覺得這東西不是給他用的（Reed 實測看到）。
    showBranchStatusBar: false,
    // 「已存 N 個檔」那一行留著：它是唯一看得到「真的有在自動存」的地方。
    showStatusBar: true,
  },
};

// claude-hud：輸入框下面那一條狀態列。
//
// 它原本的裝法是在 Claude Code 裡打四個 slash 指令，其中兩個是互動式問答——學生
// 會被中途的選項卡住，答錯就裝出不一樣的 HUD，失敗了也很難判定卡在哪一步。
// 改成「兩條非互動 CLI + 兩次寫檔」，答案在這裡寫死（來源：docs/claude-hud-card.md）。
export const CLAUDE_HUD = {
  marketplace: "jarrodwatts/claude-hud",
  plugin: "claude-hud@claude-hud",
  // setup 問「自動刷新間隔」時選的是 5 秒；沒有它用量的倒數會卡住不動。
  refreshInterval: 5,
  // configure 那四題的答案。只寫偏離預設的 key——把 Minimal 那一堆 false 全部展開
  // 的話，plugin 之後改預設值就會跟我們寫死的值打架。
  //
  // sevenDayThreshold: 0 是人為追加的：7 天用量預設只在超過 80% 才顯示，我們要它
  // 一直看得到。configure 不會問這一題，只能直接寫檔。
  config: {
    lineLayout: "compact",
    showSeparators: false,
    language: "en",
    display: {
      showModel: true,
      showContextBar: true,
      showUsage: true,
      usageBarEnabled: true,
      usageCompact: false,
      showResetLabel: true,
      sevenDayThreshold: 0,
    },
    gitStatus: {
      enabled: true,
      showDirty: true,
      showAheadBehind: false,
      showFileStats: false,
    },
    jjStatus: { enabled: false },
  },
};

export function skillStepId(agent, name) {
  return `skill-${agent}-${name}`;
}

// 一條龍 demo 不是「安裝」而是「跑一次給你看」：問配色（structured-questions）
// → 生成網頁（frontend-design）→ live-preview 逐字打 code。所以這一列沒有安裝
// 按鈕，只有「開終端驗證」，而且判定看的是它有沒有真的產出網頁。
export const DEMO_STEPS = ["demo-claude", "demo-codex"];

const CLAUDE_SKILL_STEPS = SKILL_NAMES.map((name) =>
  skillStepId("claude", name),
);
const CODEX_SKILL_STEPS = SKILL_NAMES.map((name) => skillStepId("codex", name));

function externalStepsFor(agent) {
  return EXTERNAL_SKILL_IDS.filter(
    (id) => EXTERNAL_SKILL_STEPS[id].agent === agent,
  );
}

export const NOTE_STEPS = ["obsidian", "obsidian-vault"];

// 這兩列沒有東西可裝，跟 demo 同一類：按下去開一個真的終端，叫 AI 寫一篇測試
// 筆記並存上去，學生自己去 GitHub 上看那個檔在不在。
//
// 為什麼證據要放在 GitHub 上：本機那個檔案是 AI 寫的，看得到只證明它會建檔；
// 要證明「整條同步是通的」，得看那個檔有沒有真的離開這台機器。
export const VAULT_AGENT_STEPS = ["vault-agent-claude", "vault-agent-codex"];

export const STEP_IDS = [
  "claude-md",
  "output-style",
  "hook",
  "allowlist",
  "claude-hud",
  "codex-config",
  "codex-agents",
  "tab-sync",
  "claude-namer",
  "claude-monitor",
  "codex-namer",
  "codex-monitor",
  ...CLAUDE_SKILL_STEPS,
  ...CODEX_SKILL_STEPS,
  ...EXTERNAL_SKILL_IDS,
  ...DEMO_STEPS,
  ...NOTE_STEPS,
  ...VAULT_AGENT_STEPS,
  skillStepId("claude", "vault-sync"),
  skillStepId("codex", "vault-sync"),
];

const CLAUDE_STEPS = [
  "claude-md",
  "output-style",
  "allowlist",
  // 退役那一列排在權限卡後面：先讓學生看到「現在是怎麼設定的」，再處理「以前那個
  // 東西要移掉」。反過來的話，他第一眼看到的是一張講一個他早就忘了的功能的卡。
  //
  // 沒裝過的人這一列根本不會出現（checkRetired 回 null），所以對新學生來說這個
  // 順序不存在。
  "hook",
  // 排在 Claude 那組最後：它改的是同一個 settings.json，而且要等前面幾張都寫完
  // 再動那個檔，備份才有意義。
  "claude-hud",
];
const CODEX_STEPS = ["codex-config", "codex-agents"];
export const TAB_SYNC_MARKER = "jr-setup-ui tab sync";
export const CODEX_APP_SERVER_MARKER = "jr-setup-ui codex shared app-server";
export const CODEX_VERSION_GUARD_MARKER = "jr-setup-ui codex version guard";

// 這一步是誰家的設定。合併要用同一家的 agent 去做——Codex 的 config.toml 交給
// Claude 合併的話，動手的是沒在用那份設定的那一個（Reed 實測看到「Claude：思考中」
// 出現在 Codex 那張卡上）。
//
// 共用的那幾步（tab-sync）與 skill / demo 回 null：它們沒有「誰家的」這回事。
export function agentForStep(id) {
  if (CLAUDE_STEPS.includes(id)) return "claude";

  return CODEX_STEPS.includes(id) ? "codex" : null;
}

export function stepsForTools(tools, platform = process.platform) {
  const selected = tools.filter((tool) => TOOLS.includes(tool));

  if (selected.length === 0) {
    throw new Error("至少要選一個工具");
  }

  return [
    ...(selected.includes("claude") ? CLAUDE_STEPS : []),
    ...(selected.includes("codex") ? CODEX_STEPS : []),
    ...(selected.includes("claude") ? ["tab-sync"] : []),
    // 命名與 context 監控拆開：兩者的檔案、註冊、驗證方式都不一樣，綁在一起的話
    // 其中一個壞掉會拖著另一個一起變黃，學生也不知道要重裝哪個。
    ...(selected.includes("claude") ? ["claude-namer", "claude-monitor"] : []),
    ...(selected.includes("codex") ? ["codex-namer", "codex-monitor"] : []),
    // skill 排在 hook 後面：auto-rename 那支手動叫的是命名 hook 的腳本，hook 沒裝
    // 好的話 skill 裝了也叫不動。
    ...(selected.includes("claude") ? CLAUDE_SKILL_STEPS : []),
    ...(selected.includes("codex") ? CODEX_SKILL_STEPS : []),
    ...(selected.includes("claude") ? externalStepsFor("claude") : []),
    ...(selected.includes("codex") ? externalStepsFor("codex") : []),
    // 筆記那一段整段排在 demo 前面（選配，但學生可以自己走完）。段內的順序是：
    //
    //   Obsidian      先有 app，vault 裡才寫得出 .obsidian/ 設定
    //   vault-sync    筆記庫那張的操作步驟第三步就要學生叫 AI 存一次——skill 排在
    //                 它後面的話，彈窗教的動作用的是還沒裝的東西（Reed 實測）
    //   筆記庫        建資料夾、接 GitHub、設定自動同步
    "obsidian",
    ...(selected.includes("claude") ? [skillStepId("claude", "vault-sync")] : []),
    ...(selected.includes("codex") ? [skillStepId("codex", "vault-sync")] : []),
    "obsidian-vault",
    // 筆記段的收尾：叫 AI 真的寫一篇進去，證明前面四張串起來是通的。
    ...(selected.includes("claude") ? ["vault-agent-claude"] : []),
    ...(selected.includes("codex") ? ["vault-agent-codex"] : []),
    // demo 排最後：它把前面裝的東西串起來跑一次，前面沒綠就沒必要跑；而且它要
    // 當日密碼才開（見 model.js 的 SECTION_PASSCODES），提早發嚮導時本來就不該
    // 讓學生走到這裡。
    ...(selected.includes("claude") ? ["demo-claude"] : []),
    ...(selected.includes("codex") ? ["demo-codex"] : []),
  ];
}

export function hookFileName(base, platform = process.platform) {
  return `${base}.${platform === "win32" ? "ps1" : "sh"}`;
}

function blockMarkers(marker) {
  return {
    start: `# >>> ${marker} >>>`,
    end: `# <<< ${marker} <<<`,
  };
}

export function hasMarkedBlock(content, marker) {
  const { start, end } = blockMarkers(marker);
  const startAt = content.indexOf(start);
  const endAt = content.indexOf(end);
  return startAt !== -1 && endAt > startAt;
}

export function removeLegacyCodexTabSyncBlock(content, legacyBlock) {
  return content.replace(legacyBlock, "");
}

export function upsertBlock(content, marker, block) {
  const { start, end } = blockMarkers(marker);
  const startAt = content.indexOf(start);
  const endAt = content.indexOf(end);

  if ((startAt === -1) !== (endAt === -1) || endAt < startAt) {
    throw new Error(`設定檔裡的 ${marker} 標記不成對，請先手動修正`);
  }

  const rendered = `${start}\n${block.trim()}\n${end}`;

  if (startAt !== -1) {
    return `${content.slice(0, startAt)}${rendered}${content.slice(endAt + end.length)}`;
  }

  if (content.length === 0) {
    return `${rendered}\n`;
  }

  return `${content.replace(/\s*$/, "")}\n\n${rendered}\n`;
}

const NON_INTERACTIVE_ARGS = new Set(["-p", "exec", "--version", "--help"]);

export function isInteractiveInvocation(args) {
  return !args.some((arg) => NON_INTERACTIVE_ARGS.has(arg));
}

// POSIX 不再需要 watcher。分頁標題由命名 hook 自己寫 OSC 進 /dev/ttysNNN——
// set-session-name.sh 在命名的當下寫一次，session-auto-namer.sh 每個 hook 事件再
// 寫一次，跟 watcher 用的是同一招。
//
// 差別在頻率，而那正是重點：watcher 每秒無條件重寫，所以在這個分頁裡看背景 agent
// 時，Claude Code 剛寫進去的 agent 名字會在一秒內被蓋回本分頁的名字（畫面上就是
// 「閃一下正確名字又跳回去」）。改成事件驅動之後，看 agent 期間本 session 沒有 hook
// 事件，也就沒人去蓋，agent 的名字留得住——而那個名字本來就是 auto-rename 寫進
// job state 的名字。
//
// CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1 是必要條件，不是可選的：少了它，Claude Code
// 自己寫的標題會蓋掉 hook 寫的名字，而事件驅動的頻率搶不回來（macOS 實測 2026-08-19，
// 有設才穩定）。
//
// ⚠️ 用指令前綴而不是 export：export 會讓這個 shell 之後開的每個程序都拿到。前綴仍
// 會被 claude 的子程序繼承（包含它可能生出來的 daemon），這一點擋不掉——萬一 daemon
// 拿到，底下的背景 agent 就不再寫標題，看 agent 時分頁會停在本分頁的名字。那等於改動
// 前的結果（只是不閃），不會更糟，所以沒有為它多做防護。
//
// Windows 不能照做，而且理由是結構性的：那邊改標題靠 SetConsoleTitle，那是 console 的
// 行程狀態，而 hook 是被 `powershell.exe -File` 叫起來的子行程——host 一退出標題就被
// 還原，等於沒寫。標題要留得住，只能靠一個長壽的、待在同一個 console 裡的行程，那就是
// watcher 本身。2026-08-20 在 Windows 上實測過三種情境，記在
// docs/windows-tab-title-why-watcher.md，不要再推導一次。
function posixTabSyncFunction(command) {
  return `${command}() {
  CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1 command ${command} "$@"
}`;
}

// watcher 改標題用的是 [Console]::Title，那個 API 作用在「自己所在的 console」。
// -WindowStyle Hidden 會開一個新的 console，watcher 於是改到自己的標題、碰不到
// 學生的分頁——安裝看起來全綠、名字也寫進檔案了，就是標題不動（VM 實測 A 無效
// B 有效）。-NoNewWindow 共用同一個 console，而且一樣不會冒出黑框。
function powershellTabSyncFunction(command, watcherTarget) {
  return `function ${command} {
  param([Parameter(ValueFromRemainingArguments = $true)][object[]]$InvocationArgs)
  $commandCandidates = @(Get-Command ${command} -CommandType Application -All -ErrorAction SilentlyContinue | Where-Object { Test-Path -LiteralPath $_.Source -PathType Leaf })
  $realCommandPath = @($commandCandidates | Where-Object { [System.IO.Path]::GetExtension($_.Source) -in @('.exe', '.com') } | ForEach-Object { $_.Source })[0]
  if ($null -eq $realCommandPath) {
    $realCommandPath = @($commandCandidates | ForEach-Object { $_.Source })[0]
  }
  if ($null -eq $realCommandPath) {
    Write-Host "找不到可執行的 ${command}，請重新安裝後再試。"
    return
  }
  if ($InvocationArgs | Where-Object { $_ -in @('-p', 'exec', '--version', '--help') }) {
    & $realCommandPath @InvocationArgs
    return
  }

  $syncFile = Join-Path ([System.IO.Path]::GetTempPath()) "jr-tab-sync-${command}-$PID-$([Guid]::NewGuid().ToString('N')).txt"
  [System.IO.File]::WriteAllText($syncFile, '(等待命名)', [System.Text.Encoding]::UTF8)
  $previousSyncFile = $env:AI_TAB_SYNC_FILE
  $env:AI_TAB_SYNC_FILE = $syncFile
  $watcher = Start-Process powershell.exe -ArgumentList "-NoProfile -File \`"${watcherTarget}\`" \`"$syncFile\`" $PID" -NoNewWindow -PassThru

  try {
    & $realCommandPath @InvocationArgs
    $commandExitCode = $LASTEXITCODE
  } finally {
    Stop-Process -Id $watcher.Id -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $syncFile -Force -ErrorAction SilentlyContinue
    $env:AI_TAB_SYNC_FILE = $previousSyncFile
  }
  $global:LASTEXITCODE = $commandExitCode
}`;
}

function tabSyncBlock(platform, watcherTarget) {
  if (platform !== "win32") {
    return posixTabSyncFunction("claude");
  }

  return powershellTabSyncFunction("claude", watcherTarget);
}

function windowsCodexAppServerBlock(launcherTarget, restartTarget) {
  const quotedTarget = launcherTarget.replaceAll("'", "''");
  const quotedRestart = restartTarget.replaceAll("'", "''");
  return `function codex {
  param([Parameter(ValueFromRemainingArguments = $true)][object[]]$InvocationArgs)
  & '${quotedTarget}' @InvocationArgs
  $global:LASTEXITCODE = $LASTEXITCODE
}

function codex-server-restart {
  & '${quotedRestart}'
  $global:LASTEXITCODE = $LASTEXITCODE
}`;
}

function posixCodexVersionGuardBlock(guardTarget) {
  const quotedTarget = guardTarget.replaceAll("'", "'\"'\"'");
  return `codex() {
  '${quotedTarget}' "$@"
}`;
}

function hookCommand(target, platform, args = []) {
  const command =
    platform === "win32"
      ? `powershell.exe -NoProfile -File "${target}"`
      : `bash "${target}"`;
  return [command, ...args].join(" ");
}

// 命名 hook 與 context 監控 hook 各自一列。共用同一個 settings 檔，靠 hookMarkers
// 分辨誰是誰——兩邊的檔名沒有交集，所以重裝其中一個不會掃掉另一個的註冊。
const AGENT_HOOK_STEPS = {
  "claude-namer": {
    label: "對話自己取名字",
    agent: "claude",
    bases: ["set-session-name", "session-auto-namer"],
    events: [
      { event: "PostToolUse", base: "session-auto-namer", args: [] },
      { event: "UserPromptSubmit", base: "session-auto-namer", args: ["prompt"] },
    ],
  },
  "claude-monitor": {
    label: "快記不住前面時提醒你",
    agent: "claude",
    bases: ["context-monitor"],
    events: [{ event: "PostToolUse", base: "context-monitor", args: [] }],
    supportFiles: ["skills/model-context-windows-cache.json"],
  },
  "codex-namer": {
    label: "Codex 對話自己取名字",
    agent: "codex",
    bases: ["codex-session-namer"],
    events: [
      { event: "PostToolUse", base: "codex-session-namer", args: [] },
      {
        event: "UserPromptSubmit",
        base: "codex-session-namer",
        args: ["prompt"],
      },
    ],
  },
  "codex-monitor": {
    label: "Codex 快記不住前面時提醒你",
    agent: "codex",
    bases: ["codex-context-monitor"],
    events: [{ event: "PostToolUse", base: "codex-context-monitor", args: [] }],
  },
};

function agentHooks(id, home, platform) {
  const spec = AGENT_HOOK_STEPS[id];
  const isClaude = spec.agent === "claude";
  const agentDir = `${home}/.${spec.agent}`;
  const bases = spec.bases;
  const hookFiles = bases.map((base) => {
    const file = hookFileName(base, platform);
    return {
      base,
      source: `skills/hooks/${file}`,
      target: `${agentDir}/hooks/${file}`,
    };
  });
  if (id === "codex-namer") {
    if (platform === "win32") {
      hookFiles.push(
        {
          base: "codex-session-name-set",
          source: "skills/hooks/codex-session-name-set.ps1",
          target: `${agentDir}/hooks/codex-session-name-set.ps1`,
        },
        {
          base: "codex-app-server-common",
          source: "skills/hooks/codex-app-server-common.ps1",
          target: `${agentDir}/hooks/codex-app-server-common.ps1`,
        },
        {
          base: "codex-shared-app-server",
          source: "skills/hooks/codex-shared-app-server.ps1",
          target: `${agentDir}/hooks/codex-shared-app-server.ps1`,
        },
        {
          base: "codex-server-restart",
          source: "skills/hooks/codex-server-restart.ps1",
          target: `${agentDir}/hooks/codex-server-restart.ps1`,
        },
      );
    } else {
      hookFiles.push(
        {
          base: "codex-session-name-set",
          source: "skills/hooks/codex-session-name-set.py",
          target: `${agentDir}/hooks/codex-session-name-set.py`,
        },
        {
          base: "codex-server-restart",
          source: "skills/hooks/codex-server-restart.sh",
          target: `${home}/.local/bin/codex-server-restart`,
        },
        ...(platform === "darwin"
          ? [
              {
                base: "codex-version-guard",
                source: "skills/hooks/codex-version-guard.sh",
                target: `${agentDir}/hooks/codex-version-guard.sh`,
              },
            ]
          : []),
      );
    }
  }
  // Windows 的命名指令若直接叫 powershell，Claude Code 會拒絕用白名單放行
  // （原文：Command spawns a nested PowerShell process which cannot be validated），
  // 而「以後不要再問」寫下的規則含 session id，下次必失效。多裝一支 bash 薄殼把
  // powershell 藏進去，模型看到的就只是「執行一支腳本」，跟 macOS 同形狀。
  if (isClaude && platform === "win32" && bases.includes("set-session-name")) {
    hookFiles.push({
      base: "set-session-name-shim",
      source: "skills/hooks/set-session-name-shim.sh",
      target: `${agentDir}/hooks/set-session-name.sh`,
    });
  }

  const byBase = Object.fromEntries(hookFiles.map((file) => [file.base, file]));
  // 白名單放行的是模型真正會跑的那支：Windows 是薄殼，其他平台就是腳本本身。
  const namingTarget = (byBase["set-session-name-shim"] ?? byBase["set-session-name"])
    ?.target;
  const windowsCodexProfile =
    id === "codex-namer" && platform === "win32"
      ? {
          target: `${home}/Documents/WindowsPowerShell/Microsoft.PowerShell_profile.ps1`,
          marker: CODEX_APP_SERVER_MARKER,
          block: windowsCodexAppServerBlock(
            byBase["codex-shared-app-server"].target,
            byBase["codex-server-restart"].target,
          ),
          legacyCodexTabSyncBlock: powershellTabSyncFunction(
            "codex",
            `${home}/.jr-setup/bin/ai-tab-sync.ps1`,
          ),
        }
      : undefined;
  const posixCodexProfile =
    id === "codex-namer" && platform === "darwin"
      ? {
          target: `${home}/.zshrc`,
          marker: CODEX_VERSION_GUARD_MARKER,
          block: posixCodexVersionGuardBlock(
            byBase["codex-version-guard"].target,
          ),
        }
      : undefined;
  const registrations = spec.events.map((entry) => ({
    event: entry.event,
    command: hookCommand(byBase[entry.base].target, platform, entry.args),
  }));

  return {
    id,
    label: spec.label,
    kind: "agent-hooks",
    hookFiles,
    registrations,
    settingsTarget: isClaude
      ? `${agentDir}/settings.json`
      : `${agentDir}/hooks.json`,
    // 只有 Claude 的命名指令要進白名單；Codex 沒有對應的權限層，監控 hook 也不
    // 需要模型去執行任何東西。
    namingAllowRule: namingTarget === undefined ? undefined : namingAllowRule(namingTarget),
    // 附屬檔案跟著用得到它的那一列走：模型 context 上限的快取只有監控 hook 在讀。
    supportFiles: (spec.supportFiles ?? []).map((source) => ({
      source,
      target: `${agentDir}/${source.split("/").pop()}`,
    })),
    windowsCodexProfile,
    posixCodexProfile,
  };
}

// Claude 的 skill 住 ~/.claude/skills/，Codex 的住 ~/.agents/skills/（官方 user 目錄，
// 舊版才在 ~/.codex/skills）。兩邊的 SKILL.md 內容不同，各自一列。
// 哪幾支 skill 有翻譯。其餘的只有繁中一份，lang 給什麼都拿同一個檔——寫在這裡
// 而不是去問檔案系統，是因為 describeStep 是純函式，測試裡的 home 是假路徑。
const TRANSLATED_SKILLS = new Set(["vault-sync"]);

// 繁中是預設，檔名不帶語言；其他語言用 SKILL.<lang>.md。
function skillFile(base, name, lang, suffix = "") {
  const translated = TRANSLATED_SKILLS.has(name) && lang !== "zh-TW";
  return translated ? `${base}.${lang}${suffix}` : `${base}${suffix}`;
}

function skillStep(id, home, lang) {
  const [, agent, ...rest] = id.split("-");
  const name = rest.join("-");
  const root = agent === "claude" ? `${home}/.claude/skills` : `${home}/.agents/skills`;
  const files = [
    {
      source: `skills/skill-files/${agent}/${name}/${skillFile("SKILL", name, lang, ".md")}`,
      // 落點的檔名一律是 SKILL.md——那是 skill 系統認的名字，不是我們挑的。
      target: `${root}/${name}/SKILL.md`,
    },
  ];

  // 一次性的設定步驟拆成參考檔：九成的呼叫是「幫我存起來」，不該每次都把那 80 行
  // 讀進來。SKILL.md 只留一句指路，模型真的要接新筆記庫時才去讀它。
  if (name === "vault-sync") {
    files.push({
      source: `skills/skill-files/${agent}/vault-sync/references/${skillFile("new-vault", name, lang, ".md")}`,
      target: `${root}/${name}/references/new-vault.md`,
    });
  }

  // Codex 的 handoff 會叫模型去 Read _shared/codex-session-rename.md。那個檔案沒
  // 跟著裝的話，skill 讀得到、改名那半段卻是死的——附屬檔案跟著用得到它的那一列走。
  if (agent === "codex" && name === "handoff") {
    files.push({
      source: "skills/skill-files/codex/_shared/codex-session-rename.md",
      target: `${root}/_shared/codex-session-rename.md`,
    });
  }

  // vault-sync 那支 SKILL.md 裡的每一條指令都指著筆記庫。留成 VAULT_PATH 的話
  // 模型會照字面打出 `git -C VAULT_PATH status`——那是一個不存在的資料夾。
  const vaultPath = { from: "VAULT_PATH", to: `${home.replaceAll("\\", "/")}/${VAULT_DIR}` };

  return {
    id,
    // 工具名留著：里程碑那條路上 Claude 與 Codex 各有一張同樣的卡，不標就分不出來。
    label: `${SKILL_LABELS[name]}（${agent === "claude" ? "Claude" : "Codex"}）`,
    kind: "skill",
    agent,
    name,
    files,
    // SKILL.md 裡寫的是 $HOME/...，但 Bash() 白名單是字面比對、不展開變數：模型照
    // SKILL.md 打出來的那條指令會對不上白名單而被擋（跟 hook 那邊同一個坑）。
    // 安裝時就換成這台機器的絕對路徑，形狀跟 namingAllowRule 一致。
    // 代換套在所有 Claude skill 上，不挑名字：會叫命名腳本的不只 auto-rename，
    // handoff 收尾也要改名。沒有那段字串的 skill 代換不到東西，等於不動。
    substitutions: [
      ...(agent === "claude"
        ? [
            {
              from: "$HOME/.claude/hooks/set-session-name.sh",
              to: `${home.replaceAll("\\", "/")}/.claude/hooks/set-session-name.sh`,
            },
          ]
        : []),
      ...(name === "vault-sync" ? [vaultPath] : []),
    ],
  };
}

export function applySubstitutions(content, substitutions) {
  return substitutions.reduce(
    (text, { from, to }) => text.replaceAll(from, to),
    content,
  );
}

function externalSkill(id, home) {
  const spec = EXTERNAL_SKILL_STEPS[id];

  return {
    id,
    label: spec.label,
    kind: "external-skill",
    agent: spec.agent,
    cmd: spec.cmd,
    args: spec.args,
    // 兩種落點：一般 skill 是目錄，Playwright（Claude）是 ~/.claude.json 裡的 MCP 設定。
    marker: spec.marker === undefined ? undefined : `${home}/${spec.marker}`,
    mcpServer: spec.mcpServer,
    mcpConfig: `${home}/.claude.json`,
  };
}

// 第一版只做 User Level：不需要知道學生的專案在哪。
export function describeStep(id, { lang, home, platform = process.platform }) {
  if (!LANGUAGES.includes(lang)) {
    throw new Error(`不支援的語言：${lang}`);
  }

  const claudeDir = `${home}/.claude`;
  const codexDir = `${home}/.codex`;

  switch (id) {
    case "claude-md":
      return {
        id,
        label: "Claude Code CLI 做事的規矩",
        kind: "copy",
        source: `claude-code/${lang}/CLAUDE.md`,
        target: `${claudeDir}/CLAUDE.md`,
        // 已經有的話不能蓋——那是使用者自己的規則，交給 AI 合併。
        protectExisting: true,
      };

    case "output-style":
      return {
        id,
        label: "回話短、結論先講",
        // 只複製檔案不會生效：真正的開關是 settings.json 的 outputStyle 欄位
        // （md 裡是叫使用者自己去 /config 選）。沒寫的話回覆格式完全不會變，
        // 而且沒有任何錯誤訊息——所以安裝時一起寫進去。
        kind: "output-style",
        source: `claude-code/${lang}/output-styles/concise-structured.md`,
        target: `${claudeDir}/output-styles/concise-structured.md`,
        settingsTarget: `${claudeDir}/settings.json`,
        styleName: OUTPUT_STYLE_NAME,
      };

    // 已退役。這一步以前裝一支 PreToolUse hook，把 `a && b` 這種串接指令擋下來，
    // 理由是白名單逐個子指令比對，串接會整串比對不到、於是每一次都跳出來問。
    //
    // auto mode 底下那個理由整個消失：指令改由 classifier 逐一審查，串不串接都一樣
    // 會過。留著只剩壞處——學生打一條再正常不過的 `cd x && ls` 被自己的機器擋下來，
    // 而畫面上沒有任何東西解釋為什麼。
    //
    // 這一步現在只對「以前裝過的人」出現，做的事是把它移除（見 checkRetired）。
    case "hook":
      return {
        id,
        label: "移除已退役的「一次只跑一個指令」",
        kind: "retire",
        files: [`${claudeDir}/hooks/block-chained-bash.js`],
        settingsTarget: `${claudeDir}/settings.json`,
        markers: [HOOK_MARKER],
        detail:
          "auto mode 底下每一條指令都會被逐一審查，不再需要把串接的指令拆開——" +
          "這支 hook 留著只會擋掉正常的指令，按一下把它移除",
      };

    case "allowlist":
      return {
        id,
        // 標題講兩件事的主角：讓 Claude 自己判斷，加上一份「不用等判斷」的清單。
        // 只寫「常用指令不用每次問你」的話，學生會以為這一步的全部就是那份清單，
        // 而真正改變他體感的是模式——那才是「危險的會擋、安全的直接跑」的來源。
        label: "讓它自己判斷安全的操作",
        kind: "allowlist",
        source: "claude-code/starter-allowlist.json",
        settingsTarget: `${claudeDir}/settings.json`,
      };

    case "obsidian": {
      // mac 有 brew 就走 cask；沒有 brew 的機器下載官方 dmg 掛載複製——嚮導不能代裝
      // brew（要 sudo 密碼，而 spawn 出來的子程序沒有 tty），所以不能只留 brew 這條。
      // Windows 上的落點不只一種：Obsidian 走 Squirrel，裝到使用者自己的
      // AppData 底下，但那個安裝器的版本、以及 x64／ARM 的差異都可能換位置
      //（Windows VM 實測：winget 說裝好了，我賭的那一個路徑卻是空的）。
      //
      // 所以列出所有已知的候選，任何一個在就算裝好——賭單一路徑的代價是「東西
      // 明明在，卡片卻紅著」，而學生完全不知道要去哪裡看。
      // Windows 上不要賭單一路徑。Obsidian 走 Squirrel：真正的執行檔放在
      // `app-<版本>\Obsidian.exe`，外層那個 stub 不是每個版本都會建。版號還會
      // 隨著更新變，寫死等於下次更新就失效。
      //
      // 所以只講「去哪幾個資料夾找」，每個資料夾都看它自己與底下的 app-* 子資料夾
      //（見 config-check 的 findObsidianApp）。
      const appRoots =
        platform === "win32"
          ? [
              `${home}/AppData/Local/Obsidian`,
              `${home}/AppData/Local/Programs/Obsidian`,
              "C:/Program Files/Obsidian",
              "C:/Program Files (x86)/Obsidian",
            ]
          : ["/Applications"];
      return {
        id,
        label: "Obsidian",
        kind: "obsidian-app",
        appRoots,
        appName: platform === "win32" ? "Obsidian.exe" : "Obsidian.app",
        winget: "Obsidian.Obsidian",
        cask: "obsidian",
        dmg: "https://github.com/obsidianmd/obsidian-releases/releases/latest/download/Obsidian-universal.dmg",
      };
    }

    case "vault-agent-claude":
    case "vault-agent-codex": {
      const agent = id === "vault-agent-claude" ? "claude" : "codex";
      return {
        id,
        label: `叫 AI 寫一篇進去（${agent === "claude" ? "Claude" : "Codex"}）`,
        kind: "vault-agent",
        agent,
        vault: `${home}/${VAULT_DIR}`,
        repo: VAULT_REPO,
      };
    }

    case "obsidian-vault": {
      const vault = `${home}/${VAULT_DIR}`;
      return {
        id,
        label: "接到 GitHub 的筆記庫",
        kind: "obsidian-vault",
        vault,
        repo: VAULT_REPO,
        pluginDir: `${vault}/.obsidian/plugins/${OBSIDIAN_GIT.plugin}`,
        configDir: `${vault}/.obsidian`,
        source: "obsidian/歡迎.md",
        gitignoreSource: "obsidian/gitignore",
        // Obsidian 自己那份「我知道哪些筆記庫」的名單。資料夾建在硬碟上不等於
        // Obsidian 認得它——沒登記的話 obsidian://open 會回「Vault not found」，
        // 學生得自己在 app 裡按「開啟資料夾作為筆記庫」（Reed 實測撞到）。
        registry:
          platform === "win32"
            ? `${home}/AppData/Roaming/Obsidian/obsidian.json`
            : platform === "darwin"
              ? `${home}/Library/Application Support/obsidian/obsidian.json`
              : `${home}/.config/obsidian/obsidian.json`,
      };
    }

    case "claude-hud":
      return {
        id,
        label: "輸入框下面那條狀態列",
        kind: "claude-hud",
        agent: "claude",
        marketplace: CLAUDE_HUD.marketplace,
        plugin: CLAUDE_HUD.plugin,
        settingsTarget: `${claudeDir}/settings.json`,
        configTarget: `${claudeDir}/plugins/claude-hud/config.json`,
        // 舊的狀態列（別人的、或學生自己寫的）被蓋掉之前先存這裡。
        previousTarget: `${claudeDir}/plugins/claude-hud/previous-statusline.txt`,
        // cache 路徑第一層是 marketplace 名、第二層才是 plugin 名，中間那層不能省。
        cacheRoot: `${claudeDir}/plugins/cache`,
        // 兩個平台的狀態列差在「誰當入口」：mac 是一行 bash（用 ls + sort 找最新版，
        // {RUNTIME} 換成這台機器的 node 絕對路徑），Windows 是一支 node 腳本，
        // settings.json 裡只留「node 的路徑 + 腳本的路徑」。
        commandTemplate:
          platform === "win32"
            ? "claude-code/claude-hud/statusline.mjs.template"
            : "claude-code/claude-hud/statusline.sh.template",
        // Windows 這條走了兩輪才到位，理由寫在 statusline.mjs.template 開頭：
        //
        //   一行 powershell -Command   引號被下一層 shell 咬掉，整條不啟動
        //   powershell -File 一支 .ps1  手動跑得出來，Claude Code 裡仍然空白
        //                              （ARM64 上 powershell 冷啟動 1～2 秒，而狀態列
        //                                每 5 秒跑一次，來不及在 timeout 前吐出東西）
        //   node 一支 .mjs             ← 現在這個。一個程序、啟動快一個數量級、
        //                                指令裡只剩兩個被引號包好的絕對路徑
        //
        // 對照組實測：同一時間把指令換成 `cmd /c echo PROBE-OK`，狀態列當場出現
        // PROBE-OK——所以機制是活的，問題在 PowerShell 那一層。
        scriptTarget:
          platform === "win32"
            ? `${claudeDir}/plugins/claude-hud/statusline.mjs`
            : null,
      };

    case "codex-config":
      return {
        id,
        label: "Codex CLI 的規矩與回話風格",
        kind: "copy",
        source: `codex/${lang}/config.toml.example`,
        target: `${codexDir}/config.toml`,
        protectExisting: true,
        // 檔案已存在時也要把預設模式那兩個 key 補進去，不交給 AI 合併。
        mergeModes: true,
      };

    case "codex-agents":
      return {
        id,
        label: "Codex CLI 做事的規矩",
        kind: "copy",
        source: `codex/${lang}/AGENTS.md`,
        target: `${codexDir}/AGENTS.md`,
        // 跟 CLAUDE.md 同一個理由：學生會在自己的規則檔裡加東西，安裝直接覆蓋
        // 就弄丟了。原本只留一個 .bak，但學生不會知道要去翻備份。
        protectExisting: true,
      };

    case "tab-sync": {
      // POSIX 只剩 rc 區塊，沒有要安裝的檔案——watcher 拿掉之後 watcherSource /
      // target 就都是 undefined。下游要能吃這個：安裝時不複製檔案、檢查時不比對
      // 版本、進度只看 rc 檔。Windows 維持原樣。
      const file = hookFileName("ai-tab-sync", platform);
      const target =
        platform === "win32" ? `${home}/.jr-setup/bin/${file}` : undefined;
      return {
        id,
        // ⚠️ 這是「合併卡上的一列」的名字，不是那張卡的名字。卡片叫「分頁與對話
        // 自己取名字」（model.js 的 MERGED_CARDS），這一列講的是它負責的那一半：
        // 讓終端留得住標題。兩邊寫同一句的話，畫面上會是卡片標題底下再抄一次自己
        // （Reed 在 VM 上看到的）。
        label: "終端記得住標題",
        kind: "tab-sync",
        ...(platform === "win32"
          ? { watcherSource: `skills/bin/${file}`, target }
          : {}),
        rcTarget:
          platform === "win32"
            ? `${home}/Documents/WindowsPowerShell/Microsoft.PowerShell_profile.ps1`
            : `${home}/.zshrc`,
        rcMarker: TAB_SYNC_MARKER,
        rcBlock: tabSyncBlock(platform, target),
      };
    }

    case "claude-namer":
    case "claude-monitor":
    case "codex-namer":
      return agentHooks(id, home, platform);

    // 已退役。這支 hook 的前提沒有了：它假設「context 快滿＝這次對話要收尾了」，
    // 所以提早叫學生去開新的一輪。
    //
    // Codex 官方的做法不是那樣——它把可用的 context 容量收小，快滿的時候在**同一個
    // session 裡壓縮**（compress）再繼續，對話不用中斷。於是這支 hook 的提醒變成
    // 在錯的時間叫人做錯的事：學生看到警告就去開新對話，把本來壓縮一下就能接著做
    // 的脈絡整段丟掉。
    //
    // 只對「以前裝過的人」出現，做的事是把它移除（見 checkRetired）。
    case "codex-monitor": {
      const file = hookFileName("codex-context-monitor", platform);
      return {
        id,
        label: "移除已退役的「Codex 快記不住前面時提醒你」",
        kind: "retire",
        files: [`${home}/.codex/hooks/${file}`],
        settingsTarget: `${home}/.codex/hooks.json`,
        markers: ["codex-context-monitor"],
        detail:
          "Codex 現在會把 context 容量收小，快滿的時候在同一個對話裡壓縮就能接著做" +
          "——不用開新的一輪。這支還在的話會叫你去開新對話，按一下把它移除",
      };
    }

    case "demo-claude":
    case "demo-codex": {
      const agent = id === "demo-claude" ? "claude" : "codex";
      return {
        id,
        label: `把前面學的串起來跑一次（${agent === "claude" ? "Claude" : "Codex"}）`,
        kind: "demo",
        agent,
      };
    }

    default:
      if (EXTERNAL_SKILL_STEPS[id] !== undefined) {
        return externalSkill(id, home);
      }

      if (STEP_IDS.includes(id)) {
        return skillStep(id, home, lang);
      }

      throw new Error(`不認得的步驟：${id}`);
  }
}

// Bash() 白名單是字面比對，不會展開 ~ 或 $HOME——安裝時就要換成這台機器的絕對路徑。
// 命名 hook 會叫模型去執行寫入指令，那條指令必須在白名單裡，否則每次命名都跳
// 權限詢問——在 claude -p 這種沒人能按同意的情境下直接被拒。
//
// ⚠️ starter-allowlist.json 只有 .sh 那條規則（`Bash(~/.claude/hooks/
// set-session-name.sh:*)`），Windows 上實際要跑的是一段 powershell 指令，
// 比對不到。實測模型自己回報：「要求開一個巢狀 PowerShell 程序，被權限規則擋下」。
// 兩個平台同一個形狀：直接執行一支腳本。Windows 那支是薄殼（見 agentHooks），
// powershell 藏在腳本內部，權限層看不到巢狀直譯器。路徑一律正斜線——session-auto-namer
// 組指令時也轉，兩邊不一致的話前綴永遠對不上，這條規則就等於沒加。
export function namingAllowRule(hookTarget) {
  return `Bash(${quoteIfSpaced(hookTarget.replaceAll("\\", "/"))}:*)`;
}

// 家目錄含空白（C:\Users\Reed Chen）時不加引號，bash 會把路徑斷成兩段，命名指令
// 直接跑不起來。沒空白就不加：那是 macOS 已經證實白名單放行得了的形狀，能不動就
// 不動。session-auto-namer 用同一條規則組指令，兩邊必須一致，否則前綴對不上。
export function quoteIfSpaced(path) {
  return path.includes(" ") ? `"${path}"` : path;
}

export function expandAllowRules(rules, home) {
  return rules.map((rule) => rule.replace("Bash(~/", `Bash(${home}/`));
}

// 命名／監控 hook 的執行上限。原本 10 秒，Windows VM 實測會超時：
//   UserPromptSubmit hook timed out after 10s — output discarded
// 那支是 PowerShell 腳本，冷啟動加上第一次 Get-CimInstance（WMI 查父行程）在 VM 裡
// 就能吃掉十秒。超時的後果是 hook 的輸出被整個丟棄——那一輪的命名指示等於沒發生，
// 而且畫面上只有一行紅字，看起來像 skill 壞了。
//
// 放寬到 30 秒不會讓正常情況變慢（跑完就結束），只是把冷啟動那一下的餘裕留出來。
export const AGENT_HOOK_TIMEOUT_SECONDS = 30;

export const HOOK_MARKER = "block-chained-bash";

// 對應 output-styles/concise-structured.md 的 frontmatter name。
export const OUTPUT_STYLE_NAME = "Concise Structured";

export function mergeOutputStyle(settings, { styleName }) {
  return { ...structuredClone(settings ?? {}), outputStyle: styleName };
}

// ⚠️ 這裡以前住著 bashHookCommand 與 mergeHookRegistration——擋串接那支 hook 的
// 註冊器。整支退役了（見 describeStep 的 "hook"），所以一起拿掉。
//
// findHookRegistration 留著：退役那一列還要靠它認出「這台機器裝過」。
//
// 把命令列裡提到這幾個字的 hook 註冊全部拿掉，空掉的群組一起收乾淨。
//
// 重裝與退役共用同一段：重裝是「先拿掉舊的再寫新的」，退役是「只拿掉」。兩邊各寫
// 一份的話，其中一份遲早會漏掉「群組空了要刪掉」——留一個空群組，Claude Code 讀
// 得到卻什麼都不做，而畫面上看不出差別。
//
// Claude 的 settings.json 與 Codex 的 hooks.json 是同一個形狀
// （hooks[事件][].hooks[].command），所以兩邊共用這一支。
export function removeHookRegistrations(settings, markers) {
  const next = structuredClone(settings ?? {});
  const hooks = { ...(next.hooks ?? {}) };

  for (const [event, groups] of Object.entries(hooks)) {
    hooks[event] = (groups ?? [])
      .map((group) => ({
        ...group,
        hooks: (group.hooks ?? []).filter((hook) =>
          markers.every((marker) => !(hook.command ?? "").includes(marker)),
        ),
      }))
      .filter((group) => group.hooks.length > 0);
  }

  next.hooks = hooks;
  return next;
}

// 這幾個字還在不在任何一條註冊裡。退役那一列靠它決定「這個學生裝過沒有」。
export function hasHookRegistrations(settings, markers) {
  return Object.values(settings?.hooks ?? {}).some((groups) =>
    (groups ?? []).some((group) =>
      (group.hooks ?? []).some((hook) =>
        markers.some((marker) => (hook.command ?? "").includes(marker)),
      ),
    ),
  );
}

export function mergeAgentHookRegistrations(
  settings,
  { registrations, hookMarkers },
) {
  const next = removeHookRegistrations(settings, hookMarkers);
  const hooks = { ...(next.hooks ?? {}) };

  for (const registration of registrations) {
    const groups = [...(hooks[registration.event] ?? [])];
    groups.push({
      hooks: [
        {
          type: "command",
          command: registration.command,
          timeout: AGENT_HOOK_TIMEOUT_SECONDS,
        },
      ],
    });
    hooks[registration.event] = groups;
  }

  next.hooks = hooks;
  return next;
}

export function hasAgentHookRegistrations(settings, registrations) {
  return registrations.every((registration) =>
    (settings?.hooks?.[registration.event] ?? []).some((group) =>
      (group.hooks ?? []).some(
        (hook) => hook.command === registration.command,
      ),
    ),
  );
}

// 白名單要真的省下按鍵，預設模式就得跟著換。
//
// 預設的 default 模式下，白名單只免掉「這條指令能不能跑」那一問，改檔案仍然每次都
// 問——課堂上學生大半的按鍵是花在這裡。acceptEdits 讓工作區內的檔案修改直接套用，
// 白名單管指令、模式管檔案，兩件事湊齊才是學生預期的「不會一直被打斷」。
//
// 不用 bypassPermissions / dontAsk：那是連工作區外、網路操作都不問，放進學生的
// 設定檔風險太大，也不是這門課要教的習慣。
export const CLAUDE_DEFAULT_MODE = "auto";

// 我們上一輪寫進去的值。退役時只改這一個值——學生自己設成 plan / default /
// bypassPermissions 的都不動，那是他的選擇。
//
// ⚠️ 這條規則靠「這個值一定是我們寫的」成立。學生刻意設成 acceptEdits 的話會被
// 一起換掉，而我們分辨不出來——那是這個做法的代價，不是漏洞。換掉的方向是官方
// 在 Pro/Max/Team 上的預設，所以就算猜錯，結果也是他原本沒裝嚮導時的樣子。
export const SUPERSEDED_CLAUDE_MODE = "acceptEdits";

// 驗證用：settings.json 現在的 defaultMode 是什麼。沒設回 null——「沒寫進去」與
// 「學生自己設成別的」要分開講。
//
// 這一格原本沒有人驗：checkAllowlist 只數 permissions.allow 有幾條，模式被改掉、
// 或哪天寫入那條路壞了，卡片照樣全綠而學生每次改檔案還是被問。
export function readDefaultMode(settings) {
  return settings?.permissions?.defaultMode ?? null;
}

// Codex 的預設模式：三個 key 由程式保證寫入，不交給 AI 合併。
//
// config.toml 是 protectExisting 的——學生已經有檔案時「安裝」不覆蓋，只能按「用 AI
// 合併」。那條路是叫一個 agent 讀檔改檔，結果不保證、也不可重現。Claude Code 那邊
// 的 defaultMode 是程式直接寫進 settings.json，兩邊落地機率差太多。
//
// 只補這幾個 key，不碰其餘任何一行：學生原本的 personality、instructions、MCP
// 區塊都原樣留著。已經有值就不動——他自己調過就是他的選擇。
//
// 不引 TOML parser：要做的判斷只有「最上層有沒有這個 key」。整個檔案 parse 出來
// 再寫回去，反而會把學生的註解、排版、字串引號樣式全部重排一遍。
//
// ⚠️ approvals_reviewer 跟 approval_policy 是兩個獨立的旋鈕，不要以為設了一個就
// 涵蓋另一個（VM 實測踩到：學生的 config.toml 兩個模式 key 都在、值也對，Codex 仍然
// 一直問——因為 on-request 的字面意思本來就是「需要時才問」）：
//
//   approval_policy    什麼時候「需要」批准
//   approvals_reviewer 誰來批准："user"（預設，跳出來問學生）或 "auto_review"
//                      （交給一個審核 agent 判斷）
//
// 官方文件明說 auto_review「只換審核者，不動沙盒邊界」——工作區外的寫入照樣被
// workspace-write 擋著。所以這是「少問」不是「放行」，跟 Claude Code 那邊
// acceptEdits 的取捨一致。
//
// 命名有個坑：官方文件叫它 Auto-review，Codex app 的選單卻顯示「Approve for me」，
// 同一件事兩個名字（openai/codex#29452）。卡片文案兩個都不用，直接寫它做什麼。
const CODEX_MODES = {
  default_permissions: '":workspace"',
  approval_policy: '"on-request"',
  approvals_reviewer: '"auto_review"',
};

// 舊版 Windows 會移除原生 thread title，因為當時靠 SQLite + tab-sync。保留 transform
// 只為了讓舊的 merge report 還能讀；新的 Windows 安裝和 POSIX 一樣保留原生設定。
export function transformStepSource(content, step) {
  if (step.sourceTransform !== "omit-codex-native-title") {
    return content;
  }

  return content
    .split("\n")
    .filter(
      (line) =>
        !/^\s*terminal_title\s*=/.test(line) &&
        !/^\s*["']thread-title["']\s*,?\s*(?:#.*)?$/.test(line),
    )
    .join("\n");
}

// Codex 有新舊兩套設定沙盒的方式，官方文件明說不能並存：
// 「Don't combine with sandbox_mode or [sandbox_workspace_write]」。
//
// 我們原本用舊的 sandbox_mode = "workspace-write"。VM 實測：權限選單顯示的是
// 「1. Read Only (current)」——因為那個選單看的是新的 default_permissions，而它沒設
// 時的預設就是 :read-only。舊 key 設了等於白設。
//
// 功能上當時還是通的，但是靠 approvals_reviewer = "auto_review" 在補：每次改檔案都
// 走「需要批准 → 自動批准」，多燒一輪審核，而且模式標籤是錯的。換成
// default_permissions = ":workspace" 之後選單才是「3. Approve for me」（Reed 在
// Windows VM 上手改實測確認，行為也一致：工作區內不再逐次批准，工作區外照樣被擋）。
//
// 已經裝過的機器上舊 key 還在，而 mergeCodexModes 只補不刪——所以要主動退掉它。
// 註解掉而不是刪掉：那是學生檔案裡的一行，留著看得出發生過什麼、也還原得回去。
// ⚠️ 這兩張表的每一筆都來自**真機事故**，不是照文件抄的。Codex 官方沒有一份「已停用
// key」清單可以對，而且不認得的 key 只會警告、不會失敗——會讓 codex 連啟動都失敗的
// 是「認得的 key 配了不認得的值」（enum 解析錯誤）。所以撞到一次記一次。
//
// 兩張表分開是因為處置的判準不同：
//
//   KEYS    這個 key 本身廢了，值是什麼都要停用
//   VALUES  key 還活著，只有某幾個值不收——**其他值不能動**
//
// 混成一張的話（把 service_tier 丟進 KEYS），學生刻意設的 service_tier = "fast"
// 會被我們安靜地註解掉。那是合法設定，他知道自己在做什麼。
const RETIRED_CODEX_KEYS = ["sandbox_mode"];
// service_tier = "default" 是真機撞到的：新版只收 fast / flex，設成 default 時
// codex 直接以 `unknown variant 'default'` 收場，連啟動都失敗。
const RETIRED_CODEX_VALUES = { service_tier: ["default"] };
const RETIRED_NOTE = "# 由嚮導停用：與 default_permissions 不能並存（Codex 官方限制）";
const RETIRED_VALUE_NOTE = "# 由嚮導停用：這個值新版 Codex 不收，留著會開不起來";

// 這一行是不是「該停用的舊設定」。回傳要記在報告裡的名字，不是的話回 null。
//
// 值的比對只認引號裡那一段，前後空白與單雙引號都不算差別——學生手寫的檔案
// 什麼寫法都有。
function retiredCodexEntry(line) {
  const key = RETIRED_CODEX_KEYS.find((name) =>
    new RegExp(`^\\s*${name}\\s*=`).test(line),
  );

  if (key !== undefined) {
    return { key, note: RETIRED_NOTE };
  }

  for (const [name, values] of Object.entries(RETIRED_CODEX_VALUES)) {
    const match = line.match(new RegExp(`^\\s*${name}\\s*=\\s*["']?([^"'\\s#]*)`));

    if (match !== null && values.includes(match[1])) {
      return { key: `${name} = "${match[1]}"`, note: RETIRED_VALUE_NOTE };
    }
  }

  return null;
}

// 驗證用：這三個 key 的期望值。安裝寫進去之後沒有人回頭確認過，而學生的檔案可能
// 本來就有同名 key（我們刻意不覆蓋），那時卡片會全綠、設定卻是他原本那個值。
export const CODEX_MODE_EXPECTATIONS = Object.fromEntries(
  Object.entries(CODEX_MODES).map(([key, quoted]) => [key, quoted.slice(1, -1)]),
);

// 最上層那幾個 key 現在到底是什麼值。讀不到就回 null——「沒設」與「設成別的值」
// 要分開講，學生看到「沒裝」跟「你原本設的是 X」要做的事不一樣。
export function readCodexModes(content) {
  const lines = (content ?? "").split("\n");
  const topLevelEnd = lines.findIndex((line) => /^\s*\[/.test(line));
  const topLevel = topLevelEnd === -1 ? lines : lines.slice(0, topLevelEnd);
  const found = {};

  for (const key of Object.keys(CODEX_MODES)) {
    const pattern = new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`);
    const hit = topLevel.map((line) => line.match(pattern)).find(Boolean);
    found[key] = hit === undefined ? null : hit[1];
  }

  return found;
}

export function mergeCodexModes(content) {
  let lines = (content ?? "").split("\n");
  // 第一個 [section] 之後的同名 key 屬於那個 section，不是最上層，不能算數。
  const endOf = (all) => all.findIndex((line) => /^\s*\[/.test(line));
  const retired = [];

  // 先退掉舊 key，再算要補什麼：兩件事都只看最上層，而註解掉不會改變行數，
  // 所以下面重算一次就好。
  lines = lines.map((line, index) => {
    const beyondTopLevel = endOf(lines) !== -1 && index > endOf(lines);

    if (beyondTopLevel) {
      return line;
    }

    const entry = retiredCodexEntry(line);

    if (entry === null) {
      return line;
    }

    retired.push(entry.key);
    return `${entry.note}\n# ${line.trim()}`;
  });

  const topLevelEnd = endOf(lines);
  const topLevel = topLevelEnd === -1 ? lines : lines.slice(0, topLevelEnd);
  const added = [];

  for (const key of Object.keys(CODEX_MODES)) {
    const pattern = new RegExp(`^\\s*${key}\\s*=`);
    if (topLevel.some((line) => pattern.test(line))) continue;
    added.push(key);
  }

  if (added.length === 0) {
    return { content: lines.join("\n"), added, retired };
  }

  const insertAt = topLevelEnd === -1 ? lines.length : topLevelEnd;
  const before = lines.slice(0, insertAt).join("\n").replace(/\s*$/, "");
  const after = lines.slice(insertAt).join("\n").replace(/^\s*/, "");
  const block = added.map((key) => `${key} = ${CODEX_MODES[key]}`).join("\n");

  return {
    content: after === "" ? `${before}\n${block}\n` : `${before}\n${block}\n\n${after}`,
    added,
    retired,
  };
}

// 驗證用：最上層還有沒有留著已停用的舊 key。兩者並存時 Codex 的行為沒有定義，
// 而畫面上看不出來——舊 key 靜靜地讓新的那個失效，就是這次踩到的坑。
export function readRetiredCodexKeys(content) {
  const lines = (content ?? "").split("\n");
  const topLevelEnd = lines.findIndex((line) => /^\s*\[/.test(line));
  const topLevel = topLevelEnd === -1 ? lines : lines.slice(0, topLevelEnd);

  return topLevel
    .map((line) => retiredCodexEntry(line)?.key)
    .filter((key) => key !== undefined);
}

export function mergeAllowRules(settings, { allowRules }) {
  const next = structuredClone(settings ?? {});
  const permissions = next.permissions ?? {};
  const allow = [...(permissions.allow ?? [])];
  const added = allowRules.filter((rule) => !allow.includes(rule));
  // 學生自己調過就尊重他的選擇，只在沒設過的時候補上預設。
  //
  // 例外是上一輪嚮導寫進去的那個值（acceptEdits）：那不是學生的選擇，是我們的。
  // 換成 auto 是這一步退役的另一半——白名單本身不用搬家（官方文件：auto mode 底下
  // 窄的 Bash allow 規則照常生效，只有 Bash(*) 那種寬規則會被暫停）。
  const superseded = permissions.defaultMode === SUPERSEDED_CLAUDE_MODE;
  const modeAdded = permissions.defaultMode === undefined || superseded;
  next.permissions = {
    ...permissions,
    allow: [...allow, ...added],
    defaultMode: superseded
      ? CLAUDE_DEFAULT_MODE
      : (permissions.defaultMode ?? CLAUDE_DEFAULT_MODE),
  };
  return { settings: next, addedRules: added.length, modeAdded };
}

// 驗證用：settings.json 裡到底有沒有那個 hook（只看檔案在不在不算數——
// 複製成功但沒註冊，hook 一樣不會擋，而且不會有任何錯誤訊息）。
export function findHookRegistration(settings) {
  const groups = settings?.hooks?.PreToolUse ?? [];

  for (const group of groups) {
    for (const hook of group.hooks ?? []) {
      if ((hook.command ?? "").includes(HOOK_MARKER)) {
        return { matcher: group.matcher ?? null, command: hook.command };
      }
    }
  }

  return null;
}

export function countInstalledRules(settings, expectedRules) {
  const allow = settings?.permissions?.allow ?? [];
  return expectedRules.filter((rule) => allow.includes(rule)).length;
}
