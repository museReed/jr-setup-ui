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
  ],
};

// 掛在「特定一張卡」上的人工關卡，跟段落閘門不同：段落閘門是走完一段才提醒，
// 這裡是在真正需要它的那張卡上就提醒。
//
// codex 的信任提示原本掛在「進 Demo 之前」，但整組 codex hook 的驗證在規則段就要
// 用到它——沒接受的話規則段的 codex hook 一定驗不過，而提醒卻排在兩段之後。
// 學生被推進一個必然失敗的驗證，跟終端機標題同步排太後面是同一種錯位（VM 實測）。
// 學生要圈選、貼回來的那串代碼。固定字串就夠——這一格要抓的是「auto-copy 沒生效」，
// 不是防作弊；硬打字打得出來也代表他看到了那一行。
export const FULLSCREEN_PROOF = "fullscreen-copy-ok-7f3a91";

export const FULLSCREEN_PROMPT = `請原樣印出這一行，不要加任何說明：${FULLSCREEN_PROOF}`;

// 貼回來的東西前後常常黏到空白或換行（圈選很難剛好停在字尾），比對前先清乾淨。
export function matchesFullscreenProof(pasted) {
  return typeof pasted === "string" && pasted.trim() === FULLSCREEN_PROOF;
}

export const FULLSCREEN_ITEMS = [
  {
    id: "fullscreen-yes",
    title: "跳出方框時按 1. Yes, try it",
    detail: "畫面會整個重畫一次，方框消失",
  },
  {
    id: "fullscreen-mouse",
    title: "打一句話，用滑鼠點那句話中間",
    detail: "游標會跳到你點的位置，不用按左右鍵移過去",
  },
  {
    id: "fullscreen-copy",
    title: "圈選代碼那一行，貼進下面的欄位",
    detail: "放開滑鼠就複製好了，不要按 Ctrl+C——在這個模式下它是中斷執行",
  },
];

// 第一次跑 codex 會連續跳兩個問句，兩個都選錯就整組 hook 不跑、後面 codex 那幾格
// 全部失敗——而失敗訊息只會說「驗證沒過」，不會說「你剛才那兩個選項選錯了」。
//
// 勾選框只寫「要接受信任提示」，但學生根本還沒看過那個畫面，不知道長什麼樣、有幾
// 個選項、哪一個是對的。所以照原樣把它們印出來，學生對照著選就好。
export const CARD_HINTS = {
  "codex-namer": {
    title: "第一次跑 codex 會問這兩題，照這樣選：",
    lines: [
      "Allow this hook to run? → Yes（不接受的話整組 hook 都不會跑）",
      "Select sandbox mode?   → default（課堂用預設就好）",
    ],
  },
};

export const CARD_GATES = {
  // 掛在 Claude Code 那張卡上：那張已經是「裝 CLI + 登入」，接上全螢幕選擇之後
  // 順序就是裝 → 登入 → 第一次跑起來選畫面模式，完整是一條線。
  claude: FULLSCREEN_ITEMS,
  "codex-namer": [
    {
      id: "codex-hook-trust",
      title: "第一次跑 codex 要接受 hook 信任提示",
      detail: "沒接受的話整組 hook 都不會跑，這一列與後面的 codex 驗證都會失敗",
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

// 解鎖一段要看兩件事：人工關卡勾了沒，以及**前一段是不是真的全部完成**。
//
// 先前只看勾選框，於是學生勾一勾就能跳段：
//   - 規則段從一開始就開著（它沒有任何 gate），CLI 都還沒裝就能去裝規則檔
//   - 技能包那段只要勾「我開了新分頁」就放行，但 auto-rename 那支 skill 呼叫的是
//     規則段裝的命名 hook，規則沒裝好裝了也叫不動（驗收文件早就寫了這條）
//
// 勾選框是「學生自己宣告做了什麼」，擋不住「前面根本沒做完」。所以再加一道用實際
// 狀態判斷的閘門。
export function sectionGateState(
  sectionId,
  completedGateIds = new Set(),
  tools = "claude",
  sectionDone = {},
) {
  const codexSelected = tools.split(",").includes("codex");
  const required = (SECTION_GATES[sectionId] ?? []).filter(
    (gate) => gate.codexOnly !== true || codexSelected,
  );
  const missing = required.filter((gate) => !completedGateIds.has(gate.id));

  const index = SECTIONS.findIndex((section) => section.id === sectionId);
  const previous = SECTIONS[index - 1];
  // undefined 代表「還不知道」（資料還沒回來），那就不要擋——寧可放行也不要在
  // 載入中把人鎖在外面。
  const previousPending =
    previous !== undefined && sectionDone[previous.id] === false
      ? previous
      : null;

  const reasons = [
    ...(previousPending === null
      ? []
      : [`先把「${previousPending.title}」做完`]),
    ...missing.map((gate) => `完成「${gate.title}」`),
  ];

  return {
    locked: reasons.length > 0,
    missing,
    previousPending,
    reason: reasons.length === 0 ? "" : `${reasons.join("，再")}。`,
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

const ENV_CARD_META = {
  claude: {
    agent: "claude",
    label: "Claude Code",
    logo: "logo-claude",
    description: "安裝並登入 Claude Code，才能直接請它協助完成課堂任務。",
    checkIds: ["claude", "claude-auth"],
  },
  codex: {
    agent: "codex",
    label: "Codex CLI",
    logo: "logo-openai",
    description: "安裝並登入 Codex CLI，讓它能在這台電腦上協助寫程式。",
    checkIds: ["codex", "codex-auth"],
  },
  git: {
    agent: "shared",
    logo: "logo-git",
    description: "安裝 Git，才能保存每次修改並和 GitHub 同步。",
  },
  gh: {
    agent: "shared",
    label: "GitHub CLI",
    logo: "logo-github",
    description: "安裝並登入 GitHub CLI，才能從這裡管理遠端專案。",
    checkIds: ["gh", "gh-auth"],
  },
  node: {
    agent: "shared",
    logo: "logo-nodejs",
    description: "確認 Node.js 可用，課堂工具與專案才跑得起來。",
  },
  homebrew: {
    agent: "shared",
    logo: "logo-homebrew",
    description: "確認 Homebrew 可用，才能安裝課堂需要的 macOS 工具。",
  },
  "execution-policy": {
    agent: "other",
    logo: "logo-powershell",
    description: "調整 PowerShell 權限，讓課堂安裝指令可以執行。",
  },
  "powershell-version": {
    agent: "other",
    logo: "logo-powershell",
    description: "確認 PowerShell 版本符合課堂工具的執行需求。",
  },
  "powershell-encoding": {
    agent: "other",
    logo: "logo-powershell",
    description: "確認 PowerShell 使用正確編碼，避免中文輸出變成亂碼。",
  },
  "windows-terminal": {
    agent: "other",
    logo: "logo-terminal",
    description: "安裝 Windows Terminal，讓課堂指令有一致的執行環境。",
  },
  ghostty: {
    agent: "other",
    logo: "logo-terminal",
    description: "安裝 Ghostty，讓你有一個好用的終端機執行課堂指令。",
  },
  terminal: {
    agent: "other",
    logo: "logo-terminal",
    description: "確認終端機可用，才能執行接下來的課堂指令。",
  },
};

const AGENT_ORDER = ["claude", "codex", "shared", "other"];

function checkCard(sectionId, card, check) {
  return {
    sectionId,
    checkId: check.id,
    agent: card.agent,
    label: check.label,
    logo: card.logo,
    detail:
      card.description ??
      `設定 ${check.label}，讓這項功能能在接下來的課程中正常使用。`,
    check,
    checks: [check],
    kind: sectionId === "env" ? "env" : "config",
  };
}

// 有些卡片是後面所有卡的前提，必須排到最前面。
//
// 目前只有一張：終端機標題同步。它把 watcher 裝進 shell profile，之後每個新開的
// 終端才會有人把名字放上分頁標題。命名 hook 那幾張要學生「看標題有沒有變」，
// 沒先裝這個就永遠看不到——不是 hook 壞了，是根本沒人在聽（VM 實測：
// PowerShell profile 檔案不存在，標題自然一直是預設值）。
//
// 舊版一頁攤開所有列，靠驗收文件提醒順序；改成強制線性流程之後，順序錯了就是
// 把學生推進一個必然失敗的驗證。
const SETUP_FIRST = ["tab-sync"];

function setupOrder(card) {
  const index = SETUP_FIRST.indexOf(card.checkId);
  return index === -1 ? SETUP_FIRST.length : index;
}

export function flattenCheckCards(groupedSections, envChecks = []) {
  const envChecksById = new Map(envChecks.map((check) => [check.id, check]));
  const mergedCheckIds = new Set(
    Object.values(ENV_CARD_META).flatMap(({ checkIds = [] }) =>
      checkIds.slice(1),
    ),
  );
  const envCards = envChecks
    .filter((check) => !mergedCheckIds.has(check.id))
    .map((check) => {
      const meta = ENV_CARD_META[check.id] ?? {
        agent: "other",
        logo: "logo-terminal",
        description: `準備 ${check.label}，讓後面的課堂步驟可以正常進行。`,
      };
      const checks = (meta.checkIds ?? [check.id])
        .map((id) => envChecksById.get(id))
        .filter((candidate) => candidate !== undefined);
      return {
        ...checkCard("env", meta, checks[0]),
        label: meta.label ?? checks[0].label,
        checks,
        // 掛了人工項目的環境卡（Claude Code 的全螢幕選擇），裝好＋登入了還不算完，
        // 那三項也要勾完——不然那個 modal 會留到規則段的行為驗證中途才彈出來。
        manualIds: (CARD_GATES[check.id] ?? []).map((gate) => gate.id),
      };
    })
    .sort(
      (left, right) =>
        AGENT_ORDER.indexOf(left.agent) - AGENT_ORDER.indexOf(right.agent),
    );
  const sections = [
    {
      sectionId: "env",
      cards: [
        {
          sectionId: "env",
          checkId: "env-config",
          agent: "shared",
          label: "選工具 + 選語言",
          logo: "logo-terminal",
          detail: "先選這次要設定的工具與規則檔語言。",
          check: null,
          checks: [],
          kind: "setup",
        },
        ...envCards,
      ],
    },
  ];

  for (const section of groupedSections) {
    const cards = section.cards.flatMap((card) =>
      card.checks.map((check) => checkCard(section.sectionId, card, check)),
    );

    sections.push({
      sectionId: section.sectionId,
      cards: cards.sort(
        (left, right) => setupOrder(left) - setupOrder(right),
      ),
    });
  }

  return sections;
}

export function configQuery({ tools, lang }) {
  const toolValues = CONFIG_TOOL_CHOICES.map((choice) => choice.value);

  if (!toolValues.includes(tools) || !CONFIG_LANGUAGES.includes(lang)) {
    throw new Error("規則檔工具或語言不合法");
  }

  return `tools=${tools}&lang=${lang}`;
}
