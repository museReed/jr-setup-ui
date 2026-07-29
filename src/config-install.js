// 規則檔安裝：每個步驟是一個可以獨立執行、獨立驗證的單位。
// 這裡只算「要做什麼」，不碰檔案系統；真正動手的是 scripts/install-configs.mjs。
//
// ⚠️ 這份清單對應 jr_ai_agent_configs/install/{zh-TW,zh-CN,en}.md 的步驟，
// 檔案本體則內建在 materials/（用 scripts/sync-materials.sh 同步）。
// configs repo 改了之後，這兩處都要跟著更新（兩份是刻意的取捨，見 PR 說明）。

export const LANGUAGES = ["zh-TW", "zh-CN", "en"];
export const TOOLS = ["claude", "codex"];

export const STEP_IDS = [
  "claude-md",
  "output-style",
  "hook",
  "allowlist",
  "codex-config",
  "codex-agents",
  "tab-sync",
  "claude-hooks",
  "codex-hooks",
];

const CLAUDE_STEPS = ["claude-md", "output-style", "hook", "allowlist"];
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
    ...(selected.includes("claude") ? ["claude-hooks"] : []),
    ...(selected.includes("codex") ? ["codex-hooks"] : []),
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
  $watcher = Start-Process powershell.exe -ArgumentList "-NoProfile -File \`"${watcherTarget}\`" \`"$syncFile\`" $PID" -WindowStyle Hidden -PassThru

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

function agentHooks(id, home, platform) {
  const isClaude = id === "claude-hooks";
  const agentDir = `${home}/.${isClaude ? "claude" : "codex"}`;
  const bases = isClaude
    ? ["set-session-name", "session-auto-namer", "context-monitor"]
    : ["codex-session-namer", "codex-context-monitor"];
  const hookFiles = bases.map((base) => {
    const file = hookFileName(base, platform);
    return {
      base,
      source: `skills/hooks/${file}`,
      target: `${agentDir}/hooks/${file}`,
    };
  });
  const byBase = Object.fromEntries(hookFiles.map((file) => [file.base, file]));
  const namer = isClaude ? "session-auto-namer" : "codex-session-namer";
  const monitor = isClaude ? "context-monitor" : "codex-context-monitor";
  const registrations = [
    {
      event: "PostToolUse",
      command: hookCommand(byBase[namer].target, platform),
    },
    {
      event: "UserPromptSubmit",
      command: hookCommand(byBase[namer].target, platform, ["prompt"]),
    },
    {
      event: "PostToolUse",
      command: hookCommand(byBase[monitor].target, platform),
    },
  ];

  return {
    id,
    label: isClaude ? "Claude Code hooks" : "Codex hooks",
    kind: "agent-hooks",
    hookFiles,
    registrations,
    settingsTarget: isClaude
      ? `${agentDir}/settings.json`
      : `${agentDir}/hooks.json`,
    // 只有 Claude 這邊吃白名單；Codex 沒有對應的權限層。
    namingAllowRule: isClaude
      ? namingAllowRule(byBase["set-session-name"].target, platform)
      : undefined,
    supportFiles: isClaude
      ? [
          {
            source: "skills/model-context-windows-cache.json",
            target: `${agentDir}/model-context-windows-cache.json`,
          },
        ]
      : [],
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
        label: "行為規則 CLAUDE.md",
        kind: "copy",
        source: `claude-code/${lang}/CLAUDE.md`,
        target: `${claudeDir}/CLAUDE.md`,
        // 已經有的話不能蓋——那是使用者自己的規則，交給 AI 合併。
        protectExisting: true,
      };

    case "output-style":
      return {
        id,
        label: "回覆格式 Output Style",
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
        label: "Shell 不串接 hook",
        kind: "hook",
        source: "claude-code/hooks/block-chained-bash.js",
        target: `${claudeDir}/hooks/block-chained-bash.js`,
        settingsTarget: `${claudeDir}/settings.json`,
      };

    case "allowlist":
      return {
        id,
        label: "常用指令白名單",
        kind: "allowlist",
        source: "claude-code/starter-allowlist.json",
        settingsTarget: `${claudeDir}/settings.json`,
      };

    case "codex-config":
      return {
        id,
        label: "Codex config.toml",
        kind: "copy",
        source: `codex/${lang}/config.toml.example`,
        target: `${codexDir}/config.toml`,
        protectExisting: true,
      };

    case "codex-agents":
      return {
        id,
        label: "行為規則 AGENTS.md",
        kind: "copy",
        source: `codex/${lang}/AGENTS.md`,
        target: `${codexDir}/AGENTS.md`,
      };

    case "tab-sync": {
      const file = hookFileName("ai-tab-sync", platform);
      const target =
        platform === "win32"
          ? `${home}/.jr-setup/bin/${file}`
          : `${home}/.local/bin/${file}`;
      return {
        id,
        label: "終端機標題同步",
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

    case "claude-hooks":
    case "codex-hooks":
      return agentHooks(id, home, platform);

    default:
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
export function namingAllowRule(hookTarget, platform = process.platform) {
  if (platform === "win32") {
    // 前綴要跟 session-auto-namer.ps1 組出來的指令一字不差。那支用 Join-Path
    // 產生路徑，出來是反斜線；我們內部一律用正斜線組路徑，不轉的話比對不到，
    // 這條規則就等於沒加。
    const windowsPath = hookTarget.replaceAll("/", "\\");
    return `Bash(powershell -NoProfile -ExecutionPolicy Bypass -File "${windowsPath}":*)`;
  }

  return `Bash(${hookTarget}:*)`;
}

export function expandAllowRules(rules, home) {
  return rules.map((rule) => rule.replace("Bash(~/", `Bash(${home}/`));
}

export const HOOK_MARKER = "block-chained-bash";

// 對應 output-styles/concise-structured.md 的 frontmatter name。
export const OUTPUT_STYLE_NAME = "Concise Structured";

export function mergeOutputStyle(settings, { styleName }) {
  return { ...structuredClone(settings ?? {}), outputStyle: styleName };
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
    hooks: [{ type: "command", command: `node ${hookPath}`, timeout: 5 }],
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
        { type: "command", command: registration.command, timeout: 10 },
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

export function mergeAllowRules(settings, { allowRules }) {
  const next = structuredClone(settings ?? {});
  const permissions = next.permissions ?? {};
  const allow = [...(permissions.allow ?? [])];
  const added = allowRules.filter((rule) => !allow.includes(rule));
  next.permissions = { ...permissions, allow: [...allow, ...added] };
  return { settings: next, addedRules: added.length };
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
