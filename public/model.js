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
  // 選配的一段，排在主線之後：它跟前面四段沒有依賴關係，學生跑完主線再做。
  {
    id: "notes",
    title: "使用 Obsidian 管理你的知識庫",
    subtitle: "Obsidian 與 GitHub",
  },
];

// 選配的段不看前面做完沒。筆記那段跟主線沒有相依性——Obsidian 與筆記庫不需要
// 任何一段裝好的東西（只有建 repo 那步要 GitHub 登入，而那步自己的錯誤訊息會把
// 人指回去）。鎖著只會讓想先做的人卡在一句「先把某某做完」。
const OPTIONAL_SECTIONS = new Set(["notes"]);

export const SECTION_GATES = {
  // 規則段結束時原本要學生「關掉終端分頁、開一個新的」。拿掉了：規則段的驗證全部
  // 走 verify-in-terminal，它每次都自己開一個全新的終端視窗（畫面上就寫著「新終端
  // 已開啟」），wrapper 一定是載入過的。叫學生再手動開一次是多的一步，而且會讓人
  // 以為剛才那些驗證用的是舊分頁、結果不算數。
  skills: [],
  // demo 段前面原本要學生「再開一次新的分頁」，理由是 skill 只在 session 啟動時掃
  // 目錄。拿掉了，跟規則段那道同一個理由：技能包與 demo 的驗證全部走
  // verify-in-terminal，它每次都自己開一個全新的終端視窗，skill 一定載入過。
  //
  // 留著反而有害：學生剛看完「新終端已開啟」的驗證，下一步又被叫去手動開分頁，
  // 會以為剛才那些驗證用的是舊 session、結果不算數。
  demo: [],
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

// 三格其實是兩步：前兩件在同一個視窗裡做完，第三件要另一個視窗（終端裡得先有
// 一行代碼才圈選得到）。原本畫成「三格 + 兩顆不知道對應誰的按鈕」，學生要自己
// 配對哪顆按鈕帶他做哪一格（Reed 實測）。stepId 把它們綁回去。
export const MANUAL_STEPS = {
  "fullscreen-open": {
    title: "第一步：開一個視窗，把這兩件做完",
    action: "fullscreen-open",
    buttonText: "開啟 Claude Code",
  },
  "fullscreen-proof": {
    title: "第二步：再開一個，圈選代碼貼回來",
    action: "fullscreen-proof",
    buttonText: "開啟並送出測試句",
  },
};

export const FULLSCREEN_ITEMS = [
  {
    id: "fullscreen-yes",
    stepId: "fullscreen-open",
    title: "跳出方框時按 1. Yes, try it",
    detail: "畫面會整個重畫一次，方框消失",
  },
  {
    id: "fullscreen-mouse",
    stepId: "fullscreen-open",
    title: "打一句話，用滑鼠點那句話中間",
    // 同一個視窗，不用再開一個——沒講的話學生會以為每一格都要按一次按鈕。
    detail: "就在剛才那個視窗裡；游標會跳到你點的位置，不用按左右鍵移過去",
  },
  {
    id: "fullscreen-copy",
    stepId: "fullscreen-proof",
    title: "圈選代碼那一行，貼進下面的欄位",
    detail: "放開滑鼠就複製好了，不要按 Ctrl+C——在這個模式下它是中斷執行",
  },
];

// 這兩列驗證完會留一張截圖，卡片要把它貼出來。一個 agent 一個檔，兩張卡各看各的
// ——共用一個檔的話先驗 claude 再驗 codex，claude 那張顯示的會是 codex 截的圖。
export const PLAYWRIGHT_SHOT_AGENTS = {
  "ext-playwright-claude": "claude",
  "ext-playwright-codex": "codex",
};

// 第一次跑 codex 會連續跳兩個問句。原本照原樣印在卡片上，現在搬進「怎麼做」
// 彈窗——那裡有畫面示意、有要選哪一個，卡片上再印一次是同一件事講兩遍。
export const CARD_HINTS = {};

// 眼睛那一格自己的按鈕：那一格要學生去別的地方看，這顆帶他過去。
//
// 多數眼睛項不需要——它們的卡片底下那顆驗證本來就會開終端，看的就是那個視窗。
// 這兩種不一樣：
//
//   底部狀態列  那半的驗證是 headless 的，學生從頭到尾看不到任何視窗
//   GitHub 那格 證據在遠端，而學生未必記得自己的 repo 網址
//
// key 是卡片的 checkId。resets 表示「按下去等於這一格重看一次」，勾要先退掉——
// 開瀏覽器不算重看，所以那兩格是 false。
export const EYE_ROW_ACTIONS = {
  "codex-config": {
    action: "verify-in-terminal",
    text: "開終端驗證",
    options: { case: "statusline", agent: "codex" },
    resets: true,
  },
  "vault-agent-claude": {
    action: "open-vault-repo",
    text: "看改動歷史",
    options: null,
    resets: false,
  },
  "vault-agent-codex": {
    action: "open-vault-repo",
    text: "看改動歷史",
    options: null,
    resets: false,
  },
};

export const CARD_GATES = {
  // 掛在 Claude Code 那張卡上：那張已經是「裝 CLI + 登入」，接上全螢幕選擇之後
  // 順序就是裝 → 登入 → 第一次跑起來選畫面模式，完整是一條線。
  claude: FULLSCREEN_ITEMS,
  // codex-namer 原本有一格「第一次跑 codex 要接受 hook 信任提示」。拿掉了：
  // 那兩題在「怎麼做」彈窗裡各有一步（含畫面與要選哪一個），勾選框
  // 只是把同一件事再講一次，而且講得比較差——它沒說畫面長什麼樣、也沒提第二題。
  "codex-namer": [],
};

export const GUIDANCE = {
  // 這一列的說明只有一行（放長了會把修復鍵擠出畫面），完整的說法寫在這裡。
  // 它是整段唯一「東西都裝好了、但還是叫不動」的狀況，不講清楚學生會以為是誤報。
  "shell-wrapper": {
    symptom: "終端機打 codex 說找不到指令，但這裡明明顯示已安裝",
    expected: "打 codex 會回版本號",
    checks: [
      "你的 shell 設定檔裡有一個同名的舊捷徑，指向上一輪課程留下、後來被移除的檔案",
      "它排在真正的程式前面，所以每次都是它接手——不清掉的話，重裝幾次都一樣",
      "按那一列的「清除廢棄的引用」，清完要開一個新的終端視窗才會生效",
    ],
    diagnose: null,
  },
  // 這兩列沒有安裝按鈕：它們只是探針，壞了只回一個提醒，程式沒有東西可以幫他按。
  // 合併之後它們坐在整段第一張卡裡，所以自救步驟一定要寫出來——否則學生開場就卡在
  // 一句「檢查失敗」，而畫面上沒有任何可按的東西。
  "powershell-version": {
    symptom: "那一列寫「需要 PowerShell 5.1 或 7 以上」",
    expected: "顯示你目前的版本號，例如 5.1.26100",
    checks: [
      "先確認你是用 Windows Terminal 開的，不是舊的命令提示字元",
      "版本太舊的話到 https://aka.ms/PSWindows 裝 PowerShell 7，裝完關掉嚮導重跑一次",
    ],
    diagnose: null,
  },
  "powershell-encoding": {
    symptom: "那一列寫「無法確認」，或終端印出來的中文變成問號與方框",
    expected: "那一列顯示已設定，終端的中文看得清楚",
    checks: [
      "在終端執行 `chcp 65001` 之後重按這一列的重新檢查",
      "還是不行的話，Windows 設定 → 語言與地區 → 系統管理語言設定，勾選「Beta：使用 UTF-8 提供全球語言支援」，重開機",
    ],
    diagnose: null,
  },
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
  sectionBlockers = {},
) {
  const codexSelected = tools.split(",").includes("codex");
  const required = (SECTION_GATES[sectionId] ?? []).filter(
    (gate) => gate.codexOnly !== true || codexSelected,
  );
  const missing = required.filter((gate) => !completedGateIds.has(gate.id));

  const index = SECTIONS.findIndex((section) => section.id === sectionId);
  // 前面「任何一段」沒回報做完就擋著，不是只看上一段。undefined（資料還沒回來）
  // 也算沒做完。
  //
  // 原本只擋 false，理由是「寧可放行也不要在載入中把人鎖在外面」。VM 的紀錄器
  // 顯示那個代價是實的：開頁最初 8.4 秒，技能包與 demo 兩段都是解鎖狀態，手快的
  // 學生點得進去，然後才被鎖回來。
  //
  // 「把人鎖在外面」的疑慮其實不成立：第一段永遠沒有前面的段，所以永遠是開的，
  // 學生一進來就有事可做；其餘幾段等檢查結果回來就會自己開。
  //
  // 只看上一段不夠：卡片之間有相依性（技能包那支 auto-rename 呼叫的是規則段裝的
  // 命名 hook），跳著做的話後面那段就算做完也是空的。而且畫面會自相矛盾——第一段
  // 沒做完鎖住第二段，第二段做完了卻把第三段開了（Reed 實測看到一三開、二鎖）。
  //
  // 點名最早那一段：中間幾段擋人的理由都源自它，那才是學生該回去的地方。
  const previousPending = OPTIONAL_SECTIONS.has(sectionId)
    ? null
    : SECTIONS.slice(0, index).find(
        (section) => sectionDone[section.id] !== true,
      ) ?? null;
  const previousDone =
    previousPending === null ? true : sectionDone[previousPending.id];
  // 分開記「還不知道」與「確定沒做完」：兩者都擋，但話要講得不一樣——資料還沒
  // 回來時說「先把某某做完」是在講一件我們並不知道的事。
  const stillChecking = previousPending !== null && previousDone === undefined;

  // 「先把上一段做完」對學生沒有用——他人在那一段的最後一張，畫面顯示已完成，被
  // 告知這段沒做完卻無從下手，只能一張一張往回翻（VM 實測）。
  //
  // 會走到這裡通常是因為「下一張」放行了沒完成的卡：那顆按鈕只要求驗證「試過」，
  // 不要求通過（刻意的，否則過不了的驗證會把人卡死）。放行就放行，但擋人的時候
  // 得說清楚是哪一張。
  //
  // 只點名前兩張，後面用「等 N 張」帶過——列滿七張只會變成另一種看不懂。
  const blocked = previousPending === null
    ? []
    : (sectionBlockers[previousPending.id] ?? []);
  const named = blocked
    .slice(0, 2)
    .map(({ label, index }) => `「${label}」（第 ${index + 1} 張）`)
    .join("、");
  const rest = blocked.length > 2 ? `等 ${blocked.length} 張` : "";

  const reasons = [
    ...(previousPending === null
      ? []
      : [
          stillChecking
            ? "正在檢查目前進度，等一下就會開"
            : named === ""
              ? `先把「${previousPending.title}」做完`
              : `先回去做完${named}${rest}`,
        ]),
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
    "claude-hud",
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

// 這一格是誰家的設定。跟後端 config-install.js 的 agentForStep 是同一條規矩——
// 合併按鈕會用這一家的 agent 去跑，終端上印的名字要跟著它走。
export function agentForCheck(id) {
  if (RULE_CHECK_IDS.claude.has(id)) return "claude";

  return RULE_CHECK_IDS.codex.has(id) ? "codex" : null;
}

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
  notes: [
    {
      agent: "other",
      label: "筆記庫",
      logo: "logo-obsidian",
      // 只認這兩張。用 NOTE_CHECK_IDS 的話會連 vault-agent-* 一起吃進來，而那兩張
      // 下面的 Claude / Codex 組也認——同一張卡被畫兩次，里程碑那條也多兩個點
      //（Reed 實測截圖）。那個 Set 是給分段用的，不是給分組用的。
      includes: (id) => id === "obsidian" || id === "obsidian-vault",
    },
    {
      agent: "claude",
      label: "Claude",
      logo: "logo-claude",
      includes: (id) =>
        id === "skill-claude-vault-sync" || id === "vault-agent-claude",
    },
    {
      agent: "codex",
      label: "Codex",
      logo: "logo-openai",
      includes: (id) =>
        id === "skill-codex-vault-sync" || id === "vault-agent-codex",
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

// 筆記那一段的成員。vault-sync 那支 skill 也算——它管的是筆記庫，跟「給它技能包」
// 那段的三支不是同一件事，混在一起學生會以為那是主線的一部分。
const NOTE_CHECK_IDS = new Set([
  "obsidian",
  "obsidian-vault",
  "vault-agent-claude",
  "vault-agent-codex",
]);

function sectionForCheck(id) {
  if (NOTE_CHECK_IDS.has(id) || id.endsWith("-vault-sync")) {
    return "notes";
  }

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

// 環境這一段的標題大多是產品名（Claude Code、Git、Node.js）——那是學生本來就要
// 認得、也查得到的東西，不算術語，所以留著。
//
// 例外是 PowerShell 那三張與終端機那張：「執行原則」「中文編碼」講的是設定項的名字，
// 學生沒看過那個畫面之前不知道那是什麼，所以改成講他會遇到的狀況。
//
// 描述一律回答「做完你會多出什麼」，不寫「安裝 X，才能…」——那種句型只是把標題
// 再講一次。
const ENV_CARD_META = {
  // 排在 CLI 那幾張之前（見 ENV_FIRST）：舊捷徑擋著的話，後面每一張裝完都叫不動，
  // 排在最後等於讓學生把整段做完才被告知「剛才那些其實還不能用」。
  //
  // 沒登記在這裡的話會走預設模板，標題被塞成「準備 <整句 label>，讓後面的課堂步驟
  // 可以正常進行。」——讀起來像機器寫的（VM 實測）。
  "shell-wrapper": {
    agent: "other",
    label: "清掉上一輪留下的舊捷徑",
    logo: "logo-terminal",
    description:
      "上過課的機器常留著指向已刪程式的舊捷徑，會讓後面裝好的東西全都叫不動。這張把它清掉",
  },
  claude: {
    agent: "claude",
    label: "Claude Code",
    logo: "logo-claude",
    description: "課堂上大部分的事都會請它做，這張裝好它、登入，再帶你把它第一次跑起來",
    checkIds: ["claude", "claude-auth"],
  },
  codex: {
    agent: "codex",
    label: "Codex CLI",
    logo: "logo-openai",
    description: "另一個 AI 助手，課堂上會拿它跟 Claude 對照著看有什麼不一樣",
    checkIds: ["codex", "codex-auth"],
  },
  // Git 與 GitHub CLI 合成一張：學生腦中那是同一件事（把東西存起來、推上去），
  // 拆兩張只是把一個念頭切成兩半讓他做兩次。
  git: {
    agent: "shared",
    label: "版本控制與 GitHub",
    logo: "logo-git",
    description:
      "改了什麼都留得下紀錄，改壞了回得去，也能把東西存到 GitHub 上",
    checkIds: ["git", "gh", "gh-auth"],
  },
  // Node 與 Python 合成一張：兩張都是「別的東西要靠它」，沒有登入、沒有行為驗證，
  // 學生按完就走——最適合疊在一起的一組。
  //
  // 標題直接寫兩個名字，不用「底座」那種抽象詞：Node 是 bootstrap 在開嚮導之前就裝
  // 好的（沒有它嚮導根本起不來），所以這張卡實際上只有 Python 要按，講抽象反而讓
  // 學生以為有兩件事要做。
  node: {
    agent: "shared",
    label: "Python 與 Node.js",
    logo: "logo-python",
    description:
      "這一張只有 Python 要按，Node 在開這個嚮導時就裝好了，這裡只是確認它還在",
    checkIds: ["node", "python"],
  },
  // Windows 的四列合成一張，站在整段最前面（見 ENV_FIRST）：全都是「這台機器本身
  // 準備好了嗎」，而且四列各只有一項，分四張很浪費。
  //
  // ⚠️ 其中兩列沒有安裝按鈕（PowerShell 版本與中文編碼只是探針，壞了只回一個提醒），
  // 所以它們的自救步驟寫在 GUIDANCE 裡——這是整段唯一「卡住了沒東西可按」的地方，
  // 而它現在站在第一張，不能只丟一句「檢查失敗」給學生。
  "execution-policy": {
    agent: "other",
    label: "Windows 先準備好",
    logo: "logo-powershell",
    description:
      "四件事一起確認：願意跑課堂指令、終端機視窗是對的、版本夠新、中文不會變亂碼。後面每一步都站在這上面",
    checkIds: [
      "execution-policy",
      "windows-terminal",
      "powershell-version",
      "powershell-encoding",
    ],
  },
  // Mac 這邊只有終端機一列，沒得合。仍然給它一張自己的卡、並排到最前面，讓兩個平台
  // 的卡片序長得一樣——講師帶兩種機器的學生時講同一套話。
  //
  // 提前的理由本身也成立：它是「後面每一步都在這個視窗裡做」的東西，排最後等於學生
  // 做完七張才被告知該換終端機。不過要誠實說，它比 Windows 那張弱：Windows Terminal
  // 那列會看 WT_SESSION（沒用它開就是紅的），Ghostty 只檢查檔案在不在。
  ghostty: {
    agent: "other",
    label: "換上課堂用的終端機",
    logo: "logo-terminal",
    description: "後面每一步都在終端機視窗裡做，先換成跟講師一樣的那個",
  },
  terminal: {
    agent: "other",
    label: "好用的終端機視窗",
    logo: "logo-terminal",
    description: "後面每一步都在這個視窗裡做，先確認它是好的",
  },
};

const AGENT_ORDER = ["claude", "codex", "shared", "other"];

// 卡片標題下的那一行：回答「做完之後我會多出什麼」。
//
// 原本十一張共用一句「設定 X，讓這項功能能在接下來的課程中正常使用」——那句話對
// 每一張都成立，所以對每一張都等於沒說。學生要的是「做完會發生什麼事」。
//
// 寫法：講學生會看到的現象，不講實作（不出現 hook、settings.json 這些字，那些留在
// 清單與終端訊息裡）。
export const CARD_DESCRIPTIONS = {
  "claude-md": "每次開新對話它都會先讀這份規矩，你不用每次重講一遍",
  "output-style": "它會先給答案再解釋，比較用表格，不寫長篇大論",
  // hook 與 allowlist 合併成一張卡之後，這一行由 MERGED_CARDS.allowlist 提供，這裡不再
  // 是它的來源。留著是因為 checkCard 的 fallback 仍會查這張表——合併若哪天拆回去，
  // 沒有這兩行就會退回那句「設定 X，讓這項功能能在接下來的課程中正常使用」。
  hook: "擋下把好幾個指令串成一串跑，出錯時看得出是卡在哪一步",
  allowlist: "安全的指令與工作區內的改檔案不再逐次問你",
  "claude-hud":
    "輸入框下面多一行，隨時看得到現在用哪個模型、對話塞多滿、額度還剩多少",
  "codex-config": "Codex 這邊也照同一套規矩回話",
  "codex-agents": "同上，這一份是 Codex 會讀的規矩",
  "tab-sync": "開十個終端視窗也認得出哪個在做什麼",
  "claude-namer": "你講第一句話之後，分頁標題就變成這次在做的事",
  // 這兩張的驗證要跑一分多鐘（每次兩趟 LLM）。不寫的話畫面看起來像當掉了，
  // 學生會去按取消——這是唯一「慢到需要先講」的兩張，所以寫在描述裡而不是跳泡泡。
  "claude-monitor":
    "對話太長它快忘記前面講過什麼時會提早叫你收尾，這張的驗證要跑一分多鐘",
  "codex-namer": "Codex 這邊也一樣，講完第一句話標題就自己換掉",
  "codex-monitor":
    "Codex 快忘記前面講過什麼時也會提早叫你收尾，這張的驗證一樣要跑一分多鐘",
  // skill 的描述要回答「這支是拿來做什麼的」——標題已經是它的名字了。
  "skill-claude-auto-rename":
    "幫這次對話重新取名，前面那張是它自己取，這一支是你不滿意時可以叫它重取",
  "skill-codex-auto-rename":
    "幫這次對話重新取名，前面那張是它自己取，這一支是你不滿意時可以叫它重取",
  "skill-claude-handoff":
    "把這次做到哪、卡在哪寫成一份交接文件，下次開新對話貼給它就接得回來",
  "skill-codex-handoff":
    "把這次做到哪、卡在哪寫成一份交接文件，下次開新對話貼給它就接得回來",
  "skill-claude-structured-questions":
    "要你做決定時跳出選項讓你點，不用自己想怎麼描述需求",
  "skill-codex-structured-questions":
    "要你做決定時跳出選項讓你點，不用自己想怎麼描述需求",
  "ext-frontend-design-claude":
    "叫它做網頁時會先想版面與配色，做出來的不會每個都長一樣",
  "ext-frontend-design-codex":
    "叫它做網頁時會先想版面與配色，做出來的不會每個都長一樣",
  "ext-skill-creator-claude":
    "把你反覆做的流程包成一支新的 skill，以後一句話就叫得動",
  "ext-playwright-claude":
    "讓它能開瀏覽器自己點按鈕、填表單，還會截圖回來給你看，第一次要先下載瀏覽器可能要等幾分鐘",
  "ext-playwright-codex":
    "讓它能開瀏覽器自己點按鈕、填表單，還會截圖回來給你看，第一次要先下載瀏覽器可能要等幾分鐘",
  obsidian:
    "一個寫筆記的地方：東西存在你自己電腦上、不進別人的雲，筆記之間可以互相連起來，" +
    "而且每一篇都只是純文字檔，哪天不用它了還是打得開",
  "obsidian-vault":
    "你的筆記自動存到自己的 GitHub，換電腦、電腦壞掉都還在，別人看不到",
  "vault-agent-claude":
    "叫它寫一篇筆記進去，存之前它會問你這次要記成哪一句，之後翻得回來",
  "vault-agent-codex":
    "叫它寫一篇筆記進去，存之前它會問你這次要記成哪一句，之後翻得回來",
  "skill-claude-vault-sync":
    "叫它「幫我把筆記存起來」「筆記有衝突」就好，git 指令它自己下",
  "skill-codex-vault-sync":
    "叫它「幫我把筆記存起來」「筆記有衝突」就好，git 指令它自己下",
  "demo-claude": "它問你要什麼配色，然後從零做一個網頁，右邊即時長出來給你看，這一張要跑幾分鐘",
  "demo-codex": "它問你要什麼配色，然後從零做一個網頁，右邊即時長出來給你看，這一張要跑幾分鐘",
};

function checkCard(sectionId, card, check) {
  return {
    sectionId,
    checkId: check.id,
    agent: card.agent,
    label: check.label,
    logo: card.logo,
    detail:
      card.description ??
      CARD_DESCRIPTIONS[check.id] ??
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
//
// 筆記那段的三張也在這裡：那張「接到 GitHub 的筆記庫」的操作步驟第三步要學生
// 叫 AI 存一次，skill 沒先裝好的話那一步叫不動。
const SETUP_FIRST = [
  "tab-sync",
  "obsidian",
  "skill-claude-vault-sync",
  "skill-codex-vault-sync",
];

function setupOrder(card) {
  const index = SETUP_FIRST.indexOf(card.checkId);
  return index === -1 ? SETUP_FIRST.length : index;
}

// 環境這一段也有一張「後面全靠它」的卡：Windows 的執行原則。
//
// 它原本被歸在 other，照 agent 排序落到整段最後面。但學生在第一張（Claude Code）
// 就會按「開啟 Claude Code」，那顆會開一個新視窗跑我們寫出來的 .ps1——執行原則還是
// Restricted 的話，新視窗直接紅字「running scripts is disabled」，而嚮導這邊看到的
// exit code 還是 0（VM 實測）。
//
// 我們自己 spawn 的腳本已經改成帶 Bypass，不再依賴這張卡；但學生自己在終端跑
// claude 時仍然要靠它，所以順序也要對：擋路的先修。
// mac 的終端機那張跟著排到最前面（Reed 拍板）：兩個平台的卡片序一致，講師帶兩種
// 機器的學生時講同一套話。理由本身也成立——後面每一步都在那個視窗裡做。
// 舊捷徑那張緊接在後、排在所有 CLI 之前，理由跟執行原則同一種：擋路的先修。
// 它擋的是「裝好了卻叫不動」——排在後面的話，學生會先把 Claude Code、Codex 全部
// 裝完並登入，然後在第一次真的打指令時才發現全都不能用。
const ENV_FIRST = ["execution-policy", "ghostty", "shell-wrapper"];

function envOrder(card) {
  const index = ENV_FIRST.indexOf(card.checkId);
  return index === -1 ? ENV_FIRST.length : index;
}

// 幾份設定合成一張卡：規矩與回話風格是同一件事的兩半，分兩張卡只是把「設定它怎麼
// 做事」這件事切成兩半讓學生做兩次。兩份都裝好之後才跑一次驗證——分開驗的話，先驗
// 的那次跑的是只裝了一半的狀態。
//
// key 是「最後裝的那一份」，也就是身上掛著行為驗證的那一份。
const MERGED_CARDS = {
  // key 跟著 MERGE_ORDER 的最後一個走。這張卡把 hook 排到前面之後，最後那一份是
  // allowlist——key 沒跟著換的話整張卡的標題與說明會靜靜退回單列的預設值。
  allowlist: {
    label: "它什麼時候該停下來問你",
    detail:
      "兩件事一起設：危險的指令一定擋下來，安全的指令與工作區內的改檔案不再" +
      "逐次問你，裝好之後會開一個真的終端，當場試兩題給你看",
  },
  "output-style": {
    label: "Claude Code CLI 做事的規矩與回話風格",
    detail:
      "兩份一起裝：一份是它每次開新對話都會先讀的規矩，一份決定它回話的樣子，" +
      "先給答案再解釋、比較用表格，裝好會真的問它一題來驗，要跑一分多鐘",
  },
  "codex-config": {
    label: "Codex CLI 做事的規矩與回話風格",
    detail:
      "跟上一張同一件事，這是 Codex 這邊的兩份，裝好會真的問它一題來驗，" +
      "一樣要跑一分多鐘",
  },
};

// 合併之後，同一張卡的 checks 依「安裝順序」排，最後那個帶驗證。
const MERGE_ORDER = {
  "output-style": ["claude-md", "output-style"],
  "codex-config": ["codex-agents", "codex-config"],
  // 白名單與擋串接寫的是同一個檔案（~/.claude/settings.json），講的也是同一件事：
  // 它什麼時候該停下來問你。分兩張卡的話學生會以為是兩個無關的設定，而其中一張
  // （白名單）的實際效果——連改檔案都不再問——根本沒出現在標題上（Reed 拍板合併）。
  //
  // hook 排前面：它是「該擋的擋」，白名單是「不該問的不問」。先看到被攔下來的畫面，
  // 再看什麼情況不會攔，順序才講得通——反過來的話學生先學到「都不問了」，再被告知
  // 「但這種會問」。
  //
  // 原本 hook 在後面是因為「合併卡的驗證掛在最後那一份身上，而只有 hook 有驗證」。
  // 那個理由已經不成立：白名單現在也有自己的行為驗證，兩格各有各的按鈕（app.js 的
  // perRowVerify），驗證不再靠排序決定掛在誰身上。
  hook: ["hook", "allowlist"],
};

export function mergeCardChecks(checks) {
  const byId = new Map(checks.map((check) => [check.id, check]));
  const swallowed = new Set(
    Object.values(MERGE_ORDER)
      .flat()
      .filter((id) => MERGE_ORDER[id] === undefined),
  );
  const groups = [];

  for (const check of checks) {
    const order = MERGE_ORDER[check.id];

    if (order !== undefined) {
      // 缺了其中一份（例如伺服器沒回那一列）就照常單獨出現，不要整張卡消失。
      const merged = order
        .map((id) => byId.get(id))
        .filter((candidate) => candidate !== undefined);
      groups.push(merged);
      continue;
    }

    if (swallowed.has(check.id) && [...byId.keys()].some((id) => MERGE_ORDER[id]?.includes(check.id))) {
      continue;
    }

    groups.push([check]);
  }

  return groups;
}

// 剛裝完 stepId 之後，同一張卡還有沒有沒裝的另一份。有的話先把它裝完再驗證。
export function nextInstallStep(stepId, checks = []) {
  const order = Object.values(MERGE_ORDER).find((ids) => ids.includes(stepId));

  if (order === undefined) {
    return null;
  }

  const byId = new Map(checks.map((check) => [check.id, check]));

  for (const id of order.slice(order.indexOf(stepId) + 1)) {
    const check = byId.get(id);

    if (check !== undefined && check.status !== "ok") {
      return check;
    }
  }

  return null;
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
        envOrder(left) - envOrder(right) ||
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
          detail: "先選這次要設定哪些工具、規矩要用哪個語言寫",
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
      mergeCardChecks(card.checks).map((checks) => ({
        ...checkCard(section.sectionId, card, checks.at(-1)),
        // 主 check 是最後那個：它身上掛著行為驗證，而驗證要在兩份都裝好之後才跑。
        checks,
        ...(MERGED_CARDS[checks.at(-1).id] ?? {}),
      })),
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
