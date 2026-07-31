// Model（domain）：不依賴任何人的那一層。
//
// 這裡放「規則本身」——哪些工具組合、哪些語言是合法的，以及怎麼把它們變成一次
// 查詢。View / ViewModel / API 都往這裡依賴，這裡不往外依賴任何一層。
//
// 為什麼要獨立出來：原本這幾樣住在 viewmodel.js，而 api.js（跟 server 講話的那層）
// 得 import 它才組得出 /configs 的查詢字串——資料層反過來依賴呈現層，箭頭反了。
// 搬到這裡之後兩邊都只往內指。

export const CONFIG_LANGUAGES = ["zh-TW", "zh-CN", "en"];

export const CONFIG_TOOL_CHOICES = [
  { value: "claude", label: "Claude Code" },
  { value: "codex", label: "Codex CLI" },
  { value: "claude,codex", label: "兩個都要" },
];

export const SECTIONS = [
  { id: "env", title: "讓 AI 能跑起來", subtitle: "環境與登入" },
  { id: "rules", title: "讓它照你的規矩回話", subtitle: "規則檔與 hooks" },
  { id: "skills", title: "給它技能包", subtitle: "Skills" },
  { id: "demo", title: "跑一次給你看", subtitle: "Demo" },
];

export const SECTION_GATES = {
  skills: [
    {
      id: "rules-new-terminal",
      title: "關掉現在的終端分頁，開一個新的",
      detail: "wrapper 寫在 shell profile，舊分頁不會載入",
    },
  ],
  demo: [
    {
      id: "skills-new-terminal",
      title: "再開一次新的分頁",
      detail: "skill 只在 session 啟動時掃目錄",
    },
    {
      id: "codex-hook-trust",
      title: "第一次跑 codex 要接受 hook 信任提示",
      detail: "沒接受的話整組 hook 不會跑",
      codexOnly: true,
    },
  ],
};

export const GUIDANCE = {
  hook: {
    symptom: "跑 `echo a && echo b` 時，兩個指令都照常執行了",
    expected: "畫面出現「一次只跑一個指令」，第二個指令不會執行",
    checks: [
      "關掉舊的終端分頁，再開一個新分頁",
      "確認 Claude Code 是從新分頁裡啟動",
    ],
    diagnose: null,
  },
  "claude-namer": {
    symptom: "送出第一句話後，終端分頁標題沒有變",
    expected: "分頁標題會變成「emoji + 中文名稱」",
    checks: [
      "安裝後有沒有關掉舊分頁，再開一個新分頁",
      "命名時如果跳出執行權限提示，有沒有允許那條指令",
    ],
    diagnose: "diagnose-naming-block",
  },
  "codex-namer": {
    symptom: "送出第一句話後，終端分頁標題沒有變",
    expected: "分頁標題會變成「emoji + 中文名稱」",
    checks: [
      "安裝後有沒有關掉舊分頁，再開一個新分頁",
      "第一次使用 Codex 時，有沒有接受 hook 信任提示",
    ],
    diagnose: null,
  },
  "tab-sync": {
    symptom: "名字已經寫進同步檔，但終端分頁標題沒有動",
    expected: "同步檔一出現新名字，分頁標題就跟著更新",
    checks: [
      "shell profile 裡有沒有載入 claude / codex wrapper",
      "安裝 wrapper 後有沒有關掉舊分頁，再開一個新分頁",
    ],
    diagnose: "diagnose-title-path",
  },
  "skill-claude-handoff": {
    symptom: "交接檔已經寫出來，分頁標題卻沒有變成 📦",
    expected: "交接檔完成後，分頁標題會改成「📦 + 交接主題」",
    checks: [
      "有沒有在新終端分頁啟動 Claude Code",
      "執行改名指令時如果跳出權限提示，有沒有允許",
    ],
    diagnose: "diagnose-naming-block",
  },
  "skill-codex-handoff": {
    symptom: "交接檔已經寫出來，分頁標題卻沒有變成 📦",
    expected: "交接檔完成後，分頁標題會改成「📦 + 交接主題」",
    checks: [
      "有沒有在新終端分頁啟動 Codex",
      "第一次使用 Codex 時，有沒有接受 hook 信任提示",
    ],
    diagnose: null,
  },
  "ext-frontend-design-claude": {
    symptom: "第三方 frontend-design skill 安裝失敗",
    expected: "重新檢查時顯示「已安裝」，可以在 Claude Code 裡使用",
    checks: ["確認目前可以連上網路", "確認 Node.js 版本是 18 或更新版本"],
    diagnose: null,
  },
  "ext-frontend-design-codex": {
    symptom: "第三方 frontend-design skill 安裝失敗",
    expected: "重新檢查時顯示「已安裝」，可以在 Codex 裡使用",
    checks: ["確認目前可以連上網路", "確認 Node.js 版本是 18 或更新版本"],
    diagnose: null,
  },
  "ext-skill-creator-claude": {
    symptom: "第三方 skill-creator 安裝失敗",
    expected: "重新檢查時顯示「已安裝」，可以在 Claude Code 裡使用",
    checks: ["確認目前可以連上網路", "確認 Node.js 版本是 18 或更新版本"],
    diagnose: null,
  },
  "ext-playwright-codex": {
    symptom: "第三方 Playwright skill 安裝失敗",
    expected: "重新檢查時顯示「已安裝」，可以在 Codex 裡使用",
    checks: ["確認目前可以連上網路", "確認 Node.js 版本是 18 或更新版本"],
    diagnose: null,
  },
  "ext-playwright-claude": {
    symptom: "第三方 Playwright MCP 安裝失敗",
    expected: "重新檢查時顯示「已註冊 MCP server：playwright」",
    checks: ["確認目前可以連上網路", "確認 Node.js 版本是 18 或更新版本"],
    diagnose: null,
  },
};

export function sectionGateState(
  sectionId,
  completedGateIds = new Set(),
  tools = "claude",
) {
  const codexSelected = tools.split(",").includes("codex");
  const required = (SECTION_GATES[sectionId] ?? []).filter(
    (gate) => gate.codexOnly !== true || codexSelected,
  );
  const missing = required.filter((gate) => !completedGateIds.has(gate.id));

  return {
    locked: missing.length > 0,
    missing,
    reason:
      missing.length === 0
        ? ""
        : `先完成「${missing.map((gate) => gate.title).join("」和「")}」。`,
  };
}

const RULE_CHECK_IDS = {
  claude: new Set([
    "claude-md",
    "output-style",
    "hook",
    "allowlist",
    "claude-namer",
    "claude-monitor",
  ]),
  codex: new Set([
    "codex-config",
    "codex-agents",
    "codex-namer",
    "codex-monitor",
  ]),
  shared: new Set(["tab-sync"]),
};

const CARD_DEFINITIONS = {
  rules: [
    {
      agent: "claude",
      label: "Claude",
      logo: "logo-claude",
      includes: (id) => RULE_CHECK_IDS.claude.has(id),
    },
    {
      agent: "codex",
      label: "Codex",
      logo: "logo-openai",
      includes: (id) => RULE_CHECK_IDS.codex.has(id),
    },
    {
      agent: "shared",
      label: "兩邊共用",
      logo: "logo-terminal",
      includes: (id) => RULE_CHECK_IDS.shared.has(id),
    },
  ],
  skills: [
    {
      agent: "claude",
      label: "Claude",
      logo: "logo-claude",
      includes: (id) =>
        id.startsWith("skill-claude-") || /^ext-.*-claude$/.test(id),
    },
    {
      agent: "codex",
      label: "Codex",
      logo: "logo-openai",
      includes: (id) =>
        id.startsWith("skill-codex-") || /^ext-.*-codex$/.test(id),
    },
  ],
  demo: [
    {
      agent: "claude",
      label: "Claude",
      logo: "logo-claude",
      includes: (id) => id === "demo-claude",
    },
    {
      agent: "codex",
      label: "Codex",
      logo: "logo-openai",
      includes: (id) => id === "demo-codex",
    },
  ],
};

function sectionForCheck(id) {
  if (id.startsWith("skill-") || id.startsWith("ext-")) {
    return "skills";
  }

  if (id.startsWith("demo-")) {
    return "demo";
  }

  return "rules";
}

export function groupChecks(checks) {
  return Object.entries(CARD_DEFINITIONS).map(([sectionId, definitions]) => {
    const sectionChecks = checks.filter(
      (check) => sectionForCheck(check.id) === sectionId,
    );
    const cards = definitions
      .map(({ agent, label, logo, includes }) => ({
        agent,
        label,
        logo,
        checks: sectionChecks.filter((check) => includes(check.id)),
      }))
      .filter((card) => card.checks.length > 0);
    const knownIds = new Set(
      cards.flatMap((card) => card.checks.map((check) => check.id)),
    );
    const otherChecks = sectionChecks.filter(
      (check) => !knownIds.has(check.id),
    );

    if (otherChecks.length > 0) {
      cards.push({
        agent: "other",
        label: "其他",
        logo: "logo-terminal",
        checks: otherChecks,
      });
    }

    return { sectionId, cards };
  });
}

export function configQuery({ tools, lang }) {
  const toolValues = CONFIG_TOOL_CHOICES.map((choice) => choice.value);

  if (!toolValues.includes(tools) || !CONFIG_LANGUAGES.includes(lang)) {
    throw new Error("規則檔工具或語言不合法");
  }

  return `tools=${tools}&lang=${lang}`;
}
