// 規則檔安裝的「要做哪些事」——純函式，不碰檔案系統。
// 真正動手的是 scripts/install-configs.mjs，它照這裡算出來的清單執行。
//
// ⚠️ 這份清單對應 jr_ai_agent_configs/install/{zh-TW,zh-CN,en}.md 的步驟。
// 那邊改了，這裡要跟著改（兩份實作是刻意的取捨，見 PR 說明）。

export const LANGUAGES = ["zh-TW", "zh-CN", "en"];
export const TOOLS = ["claude", "codex"];

// 第一版只做 User Level：不需要知道學生的專案在哪。
export function planInstall({ tools, lang, home, existing = {} }) {
  if (!LANGUAGES.includes(lang)) {
    throw new Error(`不支援的語言：${lang}`);
  }

  const selected = tools.filter((tool) => TOOLS.includes(tool));

  if (selected.length === 0) {
    throw new Error("至少要選一個工具");
  }

  const steps = [];
  const manual = [];

  if (selected.includes("claude")) {
    const claudeDir = `${home}/.claude`;

    // 已經有 CLAUDE.md 的話不能蓋掉——那是使用者自己的規則。交給 AI 合併。
    if (existing.claudeMd) {
      manual.push({
        id: "merge-claude-md",
        label: "合併 CLAUDE.md",
        detail: "你已經有 ~/.claude/CLAUDE.md，蓋掉會弄丟你原本的規則",
        target: `${claudeDir}/CLAUDE.md`,
        source: `claude-code/${lang}/CLAUDE.md`,
      });
    } else {
      steps.push({
        kind: "copy",
        source: `claude-code/${lang}/CLAUDE.md`,
        target: `${claudeDir}/CLAUDE.md`,
        label: "行為規則 CLAUDE.md",
      });
    }

    steps.push({
      kind: "copy",
      source: `claude-code/${lang}/output-styles/concise-structured.md`,
      target: `${claudeDir}/output-styles/concise-structured.md`,
      label: "回覆格式 Output Style",
    });

    steps.push({
      kind: "copy",
      source: "claude-code/hooks/block-chained-bash.py",
      target: `${claudeDir}/hooks/block-chained-bash.py`,
      executable: true,
      label: "Shell 不串接 hook",
    });

    steps.push({
      kind: "claude-settings",
      allowlistSource: "claude-code/starter-allowlist.json",
      hookPath: `${claudeDir}/hooks/block-chained-bash.py`,
      target: `${claudeDir}/settings.json`,
      label: "註冊 hook + 常用指令白名單",
    });
  }

  if (selected.includes("codex")) {
    const codexDir = `${home}/.codex`;

    // Codex 沒有全域 AGENTS.md 機制，User Level 只能靠 config.toml 的 instructions。
    if (existing.codexConfig) {
      manual.push({
        id: "merge-codex-config",
        label: "合併 config.toml",
        detail: "你已經有 ~/.codex/config.toml，要把 personality 與 instructions 兩段併進去",
        target: `${codexDir}/config.toml`,
        source: `codex/${lang}/config.toml.example`,
      });
    } else {
      steps.push({
        kind: "copy",
        source: `codex/${lang}/config.toml.example`,
        target: `${codexDir}/config.toml`,
        label: "Codex config.toml",
      });
    }

    steps.push({
      kind: "copy",
      source: `codex/${lang}/AGENTS.md`,
      target: `${codexDir}/AGENTS.md`,
      label: "行為規則 AGENTS.md",
    });
  }

  return { steps, manual };
}

// Bash() 白名單是字面比對，不會展開 ~ 或 $HOME——安裝時就要換成這台機器的絕對路徑。
export function expandAllowRules(rules, home) {
  return rules.map((rule) => rule.replace("Bash(~/", `Bash(${home}/`));
}

// 註冊 hook：先把舊的同名 hook 清掉再加，重跑安裝不會疊出兩份。
export function mergeClaudeSettings(settings, { hookPath, allowRules }) {
  const next = structuredClone(settings ?? {});
  const marker = "block-chained-bash.py";

  const hooks = next.hooks ?? {};
  const preToolUse = (hooks.PreToolUse ?? [])
    .map((group) => ({
      ...group,
      hooks: (group.hooks ?? []).filter(
        (hook) => !(hook.command ?? "").includes(marker),
      ),
    }))
    .filter((group) => group.hooks.length > 0);

  preToolUse.push({
    matcher: "Bash",
    hooks: [
      { type: "command", command: `python3 ${hookPath}`, timeout: 5 },
    ],
  });

  next.hooks = { ...hooks, PreToolUse: preToolUse };

  const permissions = next.permissions ?? {};
  const allow = [...(permissions.allow ?? [])];
  const added = allowRules.filter((rule) => !allow.includes(rule));
  next.permissions = { ...permissions, allow: [...allow, ...added] };

  return { settings: next, addedRules: added.length };
}
