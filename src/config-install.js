// 規則檔安裝：每個步驟是一個可以獨立執行、獨立驗證的單位。
// 這裡只算「要做什麼」，不碰檔案系統；真正動手的是 scripts/install-configs.mjs。
//
// ⚠️ 這份清單對應 jr_ai_agent_configs/install/{zh-TW,zh-CN,en}.md 的步驟。
// 那邊改了，這裡要跟著改（兩份實作是刻意的取捨，見 PR 說明）。

export const LANGUAGES = ["zh-TW", "zh-CN", "en"];
export const TOOLS = ["claude", "codex"];

export const STEP_IDS = [
  "materials",
  "claude-md",
  "output-style",
  "hook",
  "allowlist",
  "codex-config",
  "codex-agents",
];

const CLAUDE_STEPS = ["claude-md", "output-style", "hook", "allowlist"];
const CODEX_STEPS = ["codex-config", "codex-agents"];

export function stepsForTools(tools) {
  const selected = tools.filter((tool) => TOOLS.includes(tool));

  if (selected.length === 0) {
    throw new Error("至少要選一個工具");
  }

  return [
    "materials",
    ...(selected.includes("claude") ? CLAUDE_STEPS : []),
    ...(selected.includes("codex") ? CODEX_STEPS : []),
  ];
}

// 第一版只做 User Level：不需要知道學生的專案在哪。
export function describeStep(id, { lang, home }) {
  if (!LANGUAGES.includes(lang)) {
    throw new Error(`不支援的語言：${lang}`);
  }

  const claudeDir = `${home}/.claude`;
  const codexDir = `${home}/.codex`;

  switch (id) {
    case "materials":
      return { id, label: "設定素材", kind: "download" };

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
        kind: "copy",
        source: `claude-code/${lang}/output-styles/concise-structured.md`,
        target: `${claudeDir}/output-styles/concise-structured.md`,
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

    default:
      throw new Error(`不認得的步驟：${id}`);
  }
}

// Bash() 白名單是字面比對，不會展開 ~ 或 $HOME——安裝時就要換成這台機器的絕對路徑。
export function expandAllowRules(rules, home) {
  return rules.map((rule) => rule.replace("Bash(~/", `Bash(${home}/`));
}

export const HOOK_MARKER = "block-chained-bash";

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
