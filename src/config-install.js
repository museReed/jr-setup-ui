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
];

const CLAUDE_STEPS = [
  "claude-md",
  "output-style",
  "hook",
  "allowlist",
  // 排在 Claude 那組最後：它改的是同一個 settings.json，而且要等前面幾張都寫完
  // 再動那個檔，備份才有意義。
  "claude-hud",
];
const CODEX_STEPS = ["codex-config", "codex-agents"];
export const TAB_SYNC_MARKER = "jr-setup-ui tab sync";

export function stepsForTools(tools) {
  const selected = tools.filter((tool) => TOOLS.includes(tool));

  if (selected.length === 0) {
    throw new Error("至少要選一個工具");
  }

  return [
    ...(selected.includes("claude") ? CLAUDE_STEPS : []),
    ...(selected.includes("codex") ? CODEX_STEPS : []),
    "tab-sync",
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
    // demo 排最後：它把前面裝的東西串起來跑一次，前面沒綠就沒必要跑。
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

function posixTabSyncFunction(command, watcherTarget) {
  return `${command}() {
  local arg sync_file tty_path watcher_pid exit_code
  for arg in "$@"; do
    case "$arg" in
      -p|exec|--version|--help) command ${command} "$@"; return $? ;;
    esac
  done

  sync_file="\${TMPDIR:-/tmp}/jr-tab-sync-${command}-$$-\${RANDOM}.txt"
  printf '%s\\n' '(等待命名)' > "$sync_file"
  tty_path="$(tty 2>/dev/null)"
  AI_TAB_SYNC_FILE="$sync_file"
  export AI_TAB_SYNC_FILE

  watcher_pid=""
  if [ -n "$tty_path" ] && [ "$tty_path" != "not a tty" ]; then
    "${watcherTarget}" "$sync_file" "$tty_path" &
    watcher_pid=$!
  fi

  command ${command} "$@"
  exit_code=$?
  [ -n "$watcher_pid" ] && kill "$watcher_pid" 2>/dev/null
  rm -f "$sync_file"
  unset AI_TAB_SYNC_FILE
  return "$exit_code"
}`;
}

// watcher 改標題用的是 [Console]::Title，那個 API 作用在「自己所在的 console」。
// -WindowStyle Hidden 會開一個新的 console，watcher 於是改到自己的標題、碰不到
// 學生的分頁——安裝看起來全綠、名字也寫進檔案了，就是標題不動（VM 實測 A 無效
// B 有效）。-NoNewWindow 共用同一個 console，而且一樣不會冒出黑框。
function powershellTabSyncFunction(command, watcherTarget) {
  return `function ${command} {
  param([Parameter(ValueFromRemainingArguments = $true)][object[]]$InvocationArgs)
  $realCommand = Get-Command ${command} -CommandType Application -ErrorAction Stop | Select-Object -First 1
  if ($InvocationArgs | Where-Object { $_ -in @('-p', 'exec', '--version', '--help') }) {
    & $realCommand.Source @InvocationArgs
    return
  }

  $syncFile = Join-Path ([System.IO.Path]::GetTempPath()) "jr-tab-sync-${command}-$PID-$([Guid]::NewGuid().ToString('N')).txt"
  [System.IO.File]::WriteAllText($syncFile, '(等待命名)', [System.Text.Encoding]::UTF8)
  $previousSyncFile = $env:AI_TAB_SYNC_FILE
  $env:AI_TAB_SYNC_FILE = $syncFile
  $watcher = Start-Process powershell.exe -ArgumentList "-NoProfile -File \`"${watcherTarget}\`" \`"$syncFile\`" $PID" -NoNewWindow -PassThru

  try {
    & $realCommand.Source @InvocationArgs
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
  const build =
    platform === "win32" ? powershellTabSyncFunction : posixTabSyncFunction;
  return `${build("claude", watcherTarget)}\n\n${build("codex", watcherTarget)}`;
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
  };
}

// Claude 的 skill 住 ~/.claude/skills/，Codex 的住 ~/.agents/skills/（官方 user 目錄，
// 舊版才在 ~/.codex/skills）。兩邊的 SKILL.md 內容不同，各自一列。
function skillStep(id, home) {
  const [, agent, ...rest] = id.split("-");
  const name = rest.join("-");
  const root = agent === "claude" ? `${home}/.claude/skills` : `${home}/.agents/skills`;
  const files = [
    {
      source: `skills/skill-files/${agent}/${name}/SKILL.md`,
      target: `${root}/${name}/SKILL.md`,
    },
  ];

  // Codex 的 handoff 會叫模型去 Read _shared/codex-session-rename.md。那個檔案沒
  // 跟著裝的話，skill 讀得到、改名那半段卻是死的——附屬檔案跟著用得到它的那一列走。
  if (agent === "codex" && name === "handoff") {
    files.push({
      source: "skills/skill-files/codex/_shared/codex-session-rename.md",
      target: `${root}/_shared/codex-session-rename.md`,
    });
  }

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
    substitutions:
      agent === "claude"
        ? [
            {
              from: "$HOME/.claude/hooks/set-session-name.sh",
              to: `${home.replaceAll("\\", "/")}/.claude/hooks/set-session-name.sh`,
            },
          ]
        : [],
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

    case "hook":
      return {
        id,
        label: "一次只跑一個指令",
        kind: "hook",
        source: "claude-code/hooks/block-chained-bash.js",
        target: `${claudeDir}/hooks/block-chained-bash.js`,
        settingsTarget: `${claudeDir}/settings.json`,
      };

    case "allowlist":
      return {
        id,
        label: "常用指令不用每次問你",
        kind: "allowlist",
        source: "claude-code/starter-allowlist.json",
        settingsTarget: `${claudeDir}/settings.json`,
      };

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
        commandTemplate: "claude-code/claude-hud/statusline.sh.template",
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
      const file = hookFileName("ai-tab-sync", platform);
      const target =
        platform === "win32"
          ? `${home}/.jr-setup/bin/${file}`
          : `${home}/.local/bin/${file}`;
      return {
        id,
        label: "分頁自己報上名字",
        kind: "tab-sync",
        watcherSource: `skills/bin/${file}`,
        target,
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
    case "codex-monitor":
      return agentHooks(id, home, platform);

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
        return skillStep(id, home);
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

// PreToolUse 的指令是丟給 bash 跑的，Windows 路徑不處理就會被吃掉：
// C:\Users\Reed 裡的 \U \R 是 bash 的跳脫序列，路徑變成 C:UsersReed，node 找不到
// 檔案而以 exit 1 結束——而 PreToolUse 只認 exit 2 是「擋下」，exit 1 是「hook 出
// 錯，放行」。於是 hook 看起來裝好了、實際上什麼都沒擋（VM 實測 echo a && echo b
// 直接通過）。反斜線換成正斜線 + 補引號，兩件都做：Windows 吃正斜線，引號則讓路
// 徑帶空白時也不會斷成兩段。
export function bashHookCommand(hookPath) {
  return `node "${hookPath.replaceAll("\\", "/")}"`;
}

// 註冊 hook：先把舊的同名 hook 清掉再加，重跑安裝不會疊出兩份。
export function mergeHookRegistration(settings, { hookPath }) {
  const next = structuredClone(settings ?? {});
  const hooks = next.hooks ?? {};
  const preToolUse = (hooks.PreToolUse ?? [])
    .map((group) => ({
      ...group,
      hooks: (group.hooks ?? []).filter(
        (hook) => !(hook.command ?? "").includes(HOOK_MARKER),
      ),
    }))
    .filter((group) => group.hooks.length > 0);

  preToolUse.push({
    matcher: "Bash",
    hooks: [{ type: "command", command: bashHookCommand(hookPath), timeout: 5 }],
  });

  next.hooks = { ...hooks, PreToolUse: preToolUse };
  return next;
}

export function mergeAgentHookRegistrations(
  settings,
  { registrations, hookMarkers },
) {
  const next = structuredClone(settings ?? {});
  const hooks = { ...(next.hooks ?? {}) };

  for (const [event, groups] of Object.entries(hooks)) {
    hooks[event] = groups
      .map((group) => ({
        ...group,
        hooks: (group.hooks ?? []).filter((hook) =>
          hookMarkers.every(
            (marker) => !(hook.command ?? "").includes(marker),
          ),
        ),
      }))
      .filter((group) => group.hooks.length > 0);
  }

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
export const CLAUDE_DEFAULT_MODE = "acceptEdits";

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
const RETIRED_CODEX_KEYS = ["sandbox_mode"];
const RETIRED_NOTE = "# 由嚮導停用：與 default_permissions 不能並存（Codex 官方限制）";

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

    const key = RETIRED_CODEX_KEYS.find((name) =>
      new RegExp(`^\\s*${name}\\s*=`).test(line),
    );

    if (key === undefined) {
      return line;
    }

    retired.push(key);
    return `${RETIRED_NOTE}\n# ${line.trim()}`;
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

  return RETIRED_CODEX_KEYS.filter((key) =>
    topLevel.some((line) => new RegExp(`^\\s*${key}\\s*=`).test(line)),
  );
}

export function mergeAllowRules(settings, { allowRules }) {
  const next = structuredClone(settings ?? {});
  const permissions = next.permissions ?? {};
  const allow = [...(permissions.allow ?? [])];
  const added = allowRules.filter((rule) => !allow.includes(rule));
  // 學生自己調過就尊重他的選擇，只在沒設過的時候補上預設。
  const modeAdded = permissions.defaultMode === undefined;
  next.permissions = {
    ...permissions,
    allow: [...allow, ...added],
    defaultMode: permissions.defaultMode ?? CLAUDE_DEFAULT_MODE,
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
