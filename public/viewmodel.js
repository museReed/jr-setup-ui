// ViewModel：畫面「該長什麼樣」的所有判斷都在這裡。
// 不碰 DOM、不碰 fetch，所以可以在 Node 裡直接單元測試。
// View 只負責把這裡算出來的結果畫出去。
import {
  agentForCheck,
  CARD_GATES,
  EYE_ONLY_VERIFY,
  GUIDANCE,
  MANUAL_STEPS,
  SECTION_GATES,
  SECTIONS,
} from "./model.js";

export const LOGIN_CHECK_IDS = {
  "login-claude": "claude-auth",
  "login-codex": "codex-auth",
  "login-gh": "gh-auth",
};

export const LOGIN_POLL_INTERVAL_MS = 5_000;
export const LOGIN_WAIT_TIMEOUT_MS = 5 * 60_000;

export const BEHAVIOR_QUESTION =
  "我想開始經營個人品牌，Instagram 和 YouTube 我該先從哪個開始？";
export const LOADER_MODIFIERS = {
  working: "ds-loader-orbs--working",
  searching: "ds-loader-orbs--searching",
  listening: "ds-loader-orbs--listening",
  solving: "ds-loader-orbs--solving",
  composing: "ds-loader-orbs--composing",
  shaping: "ds-loader-orbs--shaping",
  paused: "ds-loader-orbs--on-dark",
};

const BEHAVIOR_COMPOSING_LINE = "正在請它回答一題標準問題";
const BEHAVIOR_SOLVING_LINE = "正在請它對照規則判定自己的回答";
const TERMINAL_LISTENING_LINE = "已開啟一個新的終端視窗";
const STAGE_MODIFIERS = {
  asking: LOADER_MODIFIERS.composing,
  judging: LOADER_MODIFIERS.solving,
  waiting: LOADER_MODIFIERS.listening,
  shaping: LOADER_MODIFIERS.shaping,
};

// 這五條要跟 scripts/verify-behavior.mjs 裡 AI 判定用的規則一字對得上，
// 否則學生照清單自己看，會跟按鈕跑出來的結果不一致。
export const BEHAVIOR_CHECKLIST = [
  "結論先行：第一行就是粗體結論，不是「好問題！」這種開場白。",
  "比較用表格：兩個平台的比較用表格，不是散文。",
  "語氣中性：沒有 emoji、沒有「太棒了！」這類慶祝語氣。",
  "長度中等：精簡到可以行動，不是長篇大論。",
  "追問清單：結尾有「你可能會想問」之類的追問清單。",
];

const STATUS_DISPLAY = {
  ok: { symbol: "✓", label: "通過" },
  missing: { symbol: "✗", label: "缺少" },
  warn: { symbol: "!", label: "需處理" },
  unverified: { symbol: "◐", label: "待驗證" },
};

const CARD_STATUS_DISPLAY = {
  uninstalled: { text: "未安裝", className: "ds-pill" },
  installing: { text: "安裝中…", className: "ds-pill" },
  verifying: { text: "驗證中…", className: "ds-pill" },
  pending: { text: "待驗證", className: "ds-pill" },
  // 「等你合併」不是「未安裝」的一種。那張卡上的檔案就在，只是有你自己的內容不能
  // 直接蓋——寫「未安裝」的話學生會去按安裝，而安裝刻意不覆蓋，他就原地打轉
  // （Reed 在 VM 上看到的）。
  "awaiting-merge": { text: "等你合併", className: "ds-pill" },
  complete: { text: "已完成", className: "ds-pill ds-pill-success" },
  failed: { text: "失敗", className: "ds-pill card-status-danger" },
};

// 安裝與驗證是兩件事，跑起來的時候也要分開講。原本只有一個 running 狀態，於是按
// 「重跑驗證」時徽章寫「安裝中…」——學生剛裝完、只是想再驗一次，畫面卻說在裝
// （Reed 實測）。
export function cardStatusModel({
  completed = false,
  running = false,
  verifying = false,
  failed = false,
  installed = false,
  awaitingMerge = false,
} = {}) {
  const status = running
    ? verifying
      ? "verifying"
      : "installing"
    : completed
      ? "complete"
      : failed
        ? "failed"
        : // 等合併排在 installed 之前：那張卡通常兩者都成立（另一份裝好了、這一份
          // 等合併），而學生現在該做的是合併，不是驗證。
          awaitingMerge
          ? "awaiting-merge"
          : installed
            ? "pending"
            : "uninstalled";

  return { status, ...CARD_STATUS_DISPLAY[status] };
}

// 動作是不是「驗證」而不是「安裝」。徽章與 loader 那行字都靠它分岔。
// 認前綴不認反面：登入、開視窗那些動作兩者都不是，不能被當成驗證。
export function isVerifyAction(action = "") {
  return action.startsWith("verify-");
}

// loader 那行字。verify-in-terminal 沒有自己的動畫，會落回 working 那顆，而 working
// 的預設字是「正在安裝」——學生按「重跑驗證」卻看到系統說在安裝（Reed 實測）。
// 回 null 表示照那顆動畫本來的字。
export function loaderLabel({ action = "", modifier = null } = {}) {
  if (modifier !== LOADER_MODIFIERS.working) {
    return null;
  }

  return isVerifyAction(action) ? "正在驗證，完成後會自動更新。" : null;
}

const ENV_LOGOS = {
  claude: "logo-claude",
  "claude-auth": "logo-claude",
  codex: "logo-openai",
  "codex-auth": "logo-openai",
  git: "logo-git",
  gh: "logo-github",
  "gh-auth": "logo-github",
  node: "logo-nodejs",
  "execution-policy": "logo-powershell",
  "powershell-version": "logo-powershell",
  "powershell-encoding": "logo-powershell",
  "windows-terminal": "logo-terminal",
  ghostty: "logo-terminal",
  terminal: "logo-terminal",
  homebrew: "logo-homebrew",
};

export function envLogoFor(checkId) {
  return ENV_LOGOS[checkId] ?? null;
}

// 列上的按鈕一律帶齊這三個參數。伺服器只認 action 自己宣告的那幾個、其餘忽略，
// 所以多帶不會出事，少帶會被擋（實測：列上的「驗證回覆格式」只帶了 step 與 lang，
// 伺服器回「options.tools 不在允許的值裡」，按鈕等於是死的）。
export function rowRunOptions({ step, lang, tools, extra = null }) {
  return { step, lang, tools, ...(extra ?? {}) };
}

// 只有「跑完就知道結果」的驗證能自動標綠，而且只標「被按的那一列」。
//
// 先前是一顆按鈕標一整組（verify-behavior 一次標四列），結果按 CLAUDE.md 那列
// 的驗證，codex 的兩列跟著變綠、按鈕消失——它們根本沒被測到（VM 實測）。又是
// 假綠燈。
//
// 開終端那種不在這裡：按下去只是開了一個視窗，證明什麼要由學生看完再勾。
export const AUTO_VERIFY_ACTIONS = new Set([
  "verify-behavior",
  "verify-in-terminal",
]);

export function isLoginAction(action) {
  return typeof action === "string" && action.startsWith("login-");
}

// 終端上那個「誰在講話」的前綴。合併那顆的 agent 跟著第一張卡的工具選擇走，所以
// 它的名字也要——寫死「Claude」的話，選了只要 Codex 的學生會看到 Codex 的輸出掛著
// Claude 的名字。
export function agentNameFor(action, tools = null, step = null) {
  if (typeof action !== "string") {
    return "";
  }

  if (action === "merge-config-step") {
    // 跟 actions.js 的 engine 同一條規矩：誰家的設定就是誰在跑。少改一處的話，
    // 畫面上的名字會跟實際動手的那一支對不上（Reed 實測：Codex 那張卡印著 Claude）。
    const selected = String(tools ?? "").split(",");
    const owner = agentForCheck(step);

    if (owner !== null && selected.includes(owner)) {
      return owner === "codex" ? "Codex" : "Claude";
    }

    return selected.includes("claude") || tools === null ? "Claude" : "Codex";
  }

  if (action.startsWith("claude")) {
    return "Claude";
  }

  return action.startsWith("codex") ? "Codex" : "";
}

// 登入指令把網址和代碼混在一般輸出裡，要挑出來變成可點的連結與可複製的代碼。
//
// 兩個踩過的坑（2026-07-31 用 codex login --device-auth 的真實輸出驗出來）：
//
// 1. CLI 會上色，色碼會黏在網址尾巴——撈到的是
//    `https://auth.openai.com/codex/device\x1b[0m`，href 直接是壞的。
//    所以先把 ANSI 逃逸序列清掉再比對。
//
// 2. 代碼長度不能寫死。原本寫 [A-Z0-9]{4}-[A-Z0-9]{4}，但 OpenAI 給的是
//    `1REC-UZZL1`（4 碼-5 碼）。更糟的是後面的 \b 遇到第 5 個字元不算邊界，
//    整條匹配失敗——不是撈到半截，是**完全撈不到**，畫面只剩網址按鈕、
//    沒有代碼可複製。
export function extractLoginHints(text) {
  if (typeof text !== "string") {
    return { url: null, code: null };
  }

  const plain = text.replace(/\u001b\[[0-9;]*m/g, "");
  const urlMatch = plain.match(/https:\/\/\S+/);
  // 不加 /i：裝置代碼一律大寫，加了會撈到說明文字裡的 "one-time" 這種英文連字詞。
  const codeMatch = plain.match(/\b[A-Z0-9]{3,6}-[A-Z0-9]{3,6}\b/);

  return {
    url: urlMatch === null ? null : urlMatch[0].replace(/[.,)]+$/, ""),
    code: codeMatch === null ? null : codeMatch[0],
  };
}

// 修復鍵上面要寫什麼。三層，由具體到通用：
//
//   1. 那一列自己給的 fixLabel——文字要跟著偵測結果變的（壞掉的是 claude 還是
//      codex）只有後端知道，寫不進這張靜態表
//   2. 這張表——文字固定、跟偵測結果無關的
//   3. 「修正」——沒對到的一律走這裡
//
// ⚠️ 第 3 層以前是「開始登入」。那個預設值咬過一次：新加的 shell-wrapper 那一列
// 沒對到表，於是清除鍵上寫著「開始登入」。預設值要選一個「講錯了也還算通順」的，
// 不能拿某個特例當通用值。真正的守門在 test/viewmodel.mjs——新的 fixAction 沒給
// 文字就會紅。
export const FIX_BUTTON_TEXT = {
  "fix-execution-policy": "修正",
  // 這顆的文字永遠一樣（不像清除舊捷徑那幾顆要指名壞掉的是哪一支），所以寫在
  // 表裡就夠，不必讓那一列自己回 fixLabel。
  "clear-quarantine": "清掉隔離區",
  "login-claude": "開始登入",
  "login-codex": "開始登入",
  "login-gh": "開始登入",
};

export function fixButtonText(check) {
  return check.fixLabel ?? FIX_BUTTON_TEXT[check.fixAction] ?? "修正";
}

// 一列環境檢查結果要畫成什麼：圖示、文字、後面掛哪幾顆按鈕。
export function envRowModel(check, installed = false) {
  const display = STATUS_DISPLAY[check.status] ?? STATUS_DISPLAY.warn;
  const buttons = [];

  // checkId 決定這顆按鈕畫在哪：帶了它就掛回清單裡它負責的那一格，沒帶就落到卡片
  // 底部的按鈕列。安裝鍵原本沒帶，於是「Claude Code CLI 未安裝」在清單裡、按鈕在
  // 清單外，學生得自己把兩者連起來——跟「開始登入」當初的問題一模一樣（Reed 指定）。
  //
  // 裝好之後整顆收掉，不留灰色的「已安裝」：那一列的打勾已經說完同一件事，一顆按不動
  // 的按鈕只是佔著位置又不能用（Reed 指定）。
  if (
    !installed &&
    check.installAction !== null &&
    check.installAction !== undefined
  ) {
    buttons.push({
      action: check.installAction,
      dataName: "installAction",
      text: "安裝",
      checkId: check.id,
    });
  }

  if (check.fixAction !== null && check.fixAction !== undefined) {
    buttons.push({
      action: check.fixAction,
      dataName: "fixAction",
      text: fixButtonText(check),
      // 這顆修的是哪一格。畫面上要把它擺回那一格旁邊——「未登入」在清單裡，按鈕卻
      // 在清單外的按鈕列，學生得自己把兩者連起來（Reed 實測）。
      checkId: check.id,
    });
  }

  return {
    status: check.status,
    symbol: display.symbol,
    ariaLabel: display.label,
    label: check.label,
    detail: check.detail,
    buttons,
  };
}

// 一張合併卡有兩個檢查（CLI + 登入），結果要一項一行。
// 原本用「；」串成一段，兩件事黏在一起、換行處還會斷在奇怪的地方。
export function cardResultItems(card, resultTexts = new Map()) {
  return (card.checks ?? (card.check == null ? [] : [card.check])).map(
    (check) => ({
      id: check.id,
      label: check.label,
      value: resultTexts.get(check.id) ?? check.detail,
    }),
  );
}

export function cardResultText(card, resultTexts = new Map()) {
  return cardResultItems(card, resultTexts)
    .map(({ label, value }) => `${label}：${value}`)
    .join("；");
}

export function envCardRowModel(card, installedSteps = new Set()) {
  const checks = card.checks ?? [card.check];
  const buttons = [];

  // 每一個「可以安裝的列」都要有自己的安裝按鈕。
  //
  // 這裡原本只取第一個非登入的列當 primary，其餘列的安裝按鈕在下面被過濾掉。在
  // 合併之前那是對的——一張環境卡最多就是「一個可安裝的東西 + 一個登入列」。
  //
  // 環境卡合併之後三張卡都有兩個以上可安裝的列，於是 GitHub CLI、Python、終端機
  // 視窗全都拿不到安裝按鈕，畫面上寫著「未安裝」卻沒有任何可按的東西（VM 實測）。
  // Python 那張最糟：primary 是 Node，而 Node 永遠已安裝，所以那張卡的安裝按鈕
  // 永遠指向一個不需要安裝的東西。
  //
  // 登入那種列不在此列：它不是「裝起來」而是「登進去」，按鈕由下面那一輪產生。
  for (const check of checks) {
    if (check.id.endsWith("-auth")) {
      continue;
    }

    // installedSteps 只是「這一輪按過安裝」的樂觀記憶，不能凌駕伺服器的權威狀態。
    // 擺成單純的 OR 會讓按過一次安裝的項目永久置灰，就算安裝其實失敗、伺服器回的
    // 還是 missing——學生看到灰掉的「✅ 安裝」和裝不起來的項目，連重試都沒得按
    // （VM 實測：gh 的 status 是 missing，按鈕卻是灰的）。
    const installed =
      check.status === "ok" ||
      (installedSteps.has(check.id) && check.status !== "missing");
    const install = envRowModel(check, installed).buttons.find(
      (button) => button.dataName === "installAction",
    );
    // 沒有 installer 的項目（執行原則那種設定類、PowerShell 版本那種純探針）不放
    // 安裝按鈕。它們要的是「修正」或「自己去改」，補一顆永遠按不下去的「安裝」
    // 只會讓學生問安裝什麼。
    //
    // installed 也要擋在佔位那一支之前：裝好之後 envRowModel 不再給按鈕，
    // 少了這個判斷就會掉進下面的佔位分支，反而長出一顆灰色的「安裝」——
    // 比原本的「已安裝」更難解讀。
    if (install !== undefined) {
      buttons.push(install);
    } else if (!installed && check.hasInstaller !== false) {
      buttons.push({
        action: "",
        dataName: "installAction",
        text: "安裝",
        checkId: check.id,
        disabled: true,
      });
    }
  }

  for (const check of checks) {
    buttons.push(
      ...envRowModel(check, installedSteps.has(check.id)).buttons.filter(
        (button) => button.dataName !== "installAction",
      ),
    );
  }

  return {
    detail: cardResultText(card),
    results: cardResultItems(card),
    buttons,
    // 環境那半原本完全沒有自救說明——configRowModel 有算，envCardRowModel 沒有。
    // 於是「PowerShell 版本」「中文編碼」「Store 版判斷」那幾列是黃燈、沒按鈕、
    // 也沒有任何文字告訴學生怎麼辦。
    //
    // 挑第一列講得出話的：一張卡上通常只有一列出問題，兩列以上時先講最前面那個
    // ——一次丟三段自救步驟，學生一段都不會讀。
    //
    // check.guidance 優先於那張靜態表：隔離區那一列要列出「這次會刪掉哪幾樣」，
    // 而那是每台機器都不一樣的東西，寫不進 GUIDANCE。它也是唯一一列綠燈還要說話的
    // ——guidanceModel 只對 missing / warn 開口（綠燈還在講自救步驟才是怪事）。
    guidance:
      checks
        .map(
          (check) =>
            check.guidance ??
            guidanceModel({
              step: check.id,
              status: check.status,
              failed: false,
            }),
        )
        .find((model) => model !== null && model !== undefined) ?? null,
  };
}

// 結構齊全但行為還沒驗過的列不給綠燈：綠燈就沒有安裝按鈕，學生連重跑的機會都
// 沒有。實測踩過四次「裝好了、綠燈、就是不生效」，詳見
// docs/wizard-verification-design.md。
export function guidanceModel({
  step,
  status,
  failed = false,
  availableActions = null,
}) {
  const guidance = GUIDANCE[step];

  // ⚠️ `missing`（還沒裝）**不給**自救步驟。
  //
  // GUIDANCE 每一段的文案都假設「你已經裝了、但它不生效」——「名字已經寫進同步檔，
  // 但終端分頁標題沒有動」、「交接檔已經寫出來，分頁標題卻沒有變成 📦」。原本的
  // 條件把 missing 也算進去，於是**每一張還沒開始做的卡都提前顯示一段診斷**，
  // 講的是一件還沒發生的事（VM 實測，分頁標題那張 0/3 就在講標題沒換）。
  //
  // 還沒裝的人需要的是那顆安裝鍵，不是自救步驟。環境段那幾列本來就都是 warn，
  // 不受這個改動影響。
  if (guidance === undefined || (!failed && status !== "warn")) {
    return null;
  }

  const diagnoseAvailable =
    guidance.diagnose !== null &&
    (availableActions === null || availableActions.has(guidance.diagnose));

  return {
    ...guidance,
    diagnoseButton: diagnoseAvailable
      ? {
          action: guidance.diagnose,
          text: "一鍵診斷",
          step,
        }
      : null,
  };
}

export function configRowModel(
  check,
  verified = false,
  {
    failed = false,
    availableActions = null,
    installed = false,
    verificationAttempted = false,
    verificationFailed = false,
    verificationDeferred = false,
  } = {},
) {
  // 「裝好了沒」的權威來源是伺服器剛跑完的檢查（status === "ok"），不是「這次
  // 開著的網頁裡有沒有按過安裝」。
  //
  // 原本只看 installed（本次 session 的樂觀記憶）與 verified。於是一個早就裝好、
  // 只差行為驗證的列——例如 Playwright MCP 顯示「已註冊 MCP server：playwright」
  // ——按鈕仍然是橘色的「安裝」，看起來像「你還沒裝，按這裡」。學生按下去，指令
  // 回「already exists」，什麼也沒發生（VM 實測）。
  const alreadyInstalled = check.status === "ok";
  const installationDone = installed || verified || alreadyInstalled;
  const pending =
    check.status === "ok" &&
    !verified &&
    (check.verifyAction != null || check.eyeCheck != null);
  const status = pending ? "unverified" : check.status;
  const display = STATUS_DISPLAY[status] ?? STATUS_DISPLAY.warn;
  const buttons = [];

  // 待驗證的列也要留安裝按鈕——重跑安裝是學生手上唯一的自救手段。
  // 例外是 demo 那種「沒有東西可裝」的列（noInstall）：補了按鈕按下去只會失敗。
  const installAction =
    check.installAction ??
    (pending && check.noInstall !== true ? "install-config-step" : null);

  if (installAction !== null && installAction !== undefined) {
    // 安裝按鈕只管安裝：
    //
    //   還沒裝                「安裝」      主要動作，橘色
    //   裝好了                （整顆收掉）   沒事可做，要驗證請按「重跑驗證」
    //   裝好了但驗證失敗過      「重裝」      按得動但不是主角
    //
    // 中間那態原本一律是可按的「重裝」，於是「裝好、只差看一眼」的列也長出一顆安裝
    // 按鈕，學生按下去畫面說「正在安裝」——他要的只是再驗一次（Reed 實測 claude-namer）。
    // 後來改成灰色的「✅ 已安裝」，現在再進一步整顆收掉：那一列的狀態已經說完同一件
    // 事，一顆按不動的按鈕只是佔著位置又不能用（Reed 指定）。
    //
    // 但驗證失敗時那顆要活過來：裝歪了（舊版、裝一半）而 check 仍是 ok 的情況存在，
    // 那時重跑安裝是唯一的自救手段，拿掉就沒路走了。
    const rescueReinstall = installationDone && verificationFailed;
    // 有些列裝好之後仍然要留一顆（check.reinstallable，見 config-check）：那些
    // 設定會被別的程式改掉，重跑安裝是唯一的自救手段。它不是主要動作，畫成次要的。
    const canRedo = installationDone && !rescueReinstall && check.reinstallable === true;

    if (canRedo) {
      buttons.push({
        action: installAction,
        dataName: "installAction",
        text: "重新設定",
        step: check.id,
        secondary: true,
      });
    } else if (rescueReinstall) {
      buttons.push({
        action: installAction,
        dataName: "installAction",
        text: "重裝",
        step: check.id,
        secondary: true,
      });
    } else if (!installationDone) {
      buttons.push({
        action: installAction,
        dataName: "installAction",
        text: "安裝",
        step: check.id,
      });
    }
  } else if (check.noInstall !== true && !installationDone) {
    // 沒有安裝動作時補一顆停用的佔位，讓每一列的按鈕位置對齊。
    //
    // 但 demo 那種 noInstall 的列不補：它從頭到尾就沒有「安裝」這個概念，補一顆
    // 按不動的按鈕只會讓學生盯著它想「是不是要先按這個」（VM 實測）。那一列的動作
    // 是「開終端跑」，那顆自己會在。
    //
    // 裝好之後同樣不補：佔位是為了跟「還有安裝鍵的列」對齊，而那些列裝好之後也
    // 沒有按鈕了，繼續佔位反而變成唯一凸出來的東西。
    buttons.push({
      action: "",
      dataName: "installAction",
      text: "安裝",
      step: check.id,
      disabled: true,
    });
  }

  // 不放「驗證」按鈕：安裝完會自動接驗證，那顆按鈕只會閃一下就消失，學生根本
  // 不知道到底驗了沒（Reed 實測）。要重驗一律走一直都在的「再 check 一次」。
  //
  // 唯一的例外是 demo 那種 noInstall 的列：按下去是「跑給你看」不是驗證，
  // 沒有安裝動作可以接，所以那顆要留著。
  if (
    check.verifyAction != null &&
    check.verifyKind === "terminal" &&
    check.noInstall === true
  ) {
    // 跑過一次之後才寫「重」——跟其他驗證按鈕同一套（見 app.js 的 retestText 與
    // 格內那顆）。沒跑過就寫「重跑」的話，學生會以為自己漏掉了前面某一步。
    buttons.push({
      action: check.verifyAction,
      dataName: "verifyAction",
      text: verified ? "重跑一次" : "開終端跑",
      step: check.id,
      options: check.verifyOptions ?? undefined,
    });
  }

  if (check.mergeAction !== null && check.mergeAction !== undefined) {
    buttons.push({
      action: check.mergeAction,
      dataName: "mergeAction",
      // 講明會開視窗。不講的話學生按下去看到一個新視窗跳出來會以為出事了，
      // 而那個視窗正是他要去回答問題的地方。
      text: "用 AI 合併（會開終端）",
      // 折回群組主人：同一張卡上兩列都給了按鈕（不然卡片可能一顆都沒有），
      // 但按哪一列都是「兩份一次合完」。
      step: check.mergeStep ?? check.id,
    });
  }

  // 合併過才有這顆。合併是唯一會改寫學生自己內容的動作，退路要一直留著——
  // 他可能過幾張卡之後才發現自己的規則怪怪的。
  if (check.restoreAction !== null && check.restoreAction !== undefined) {
    buttons.push({
      action: check.restoreAction,
      dataName: "restoreAction",
      text: "還原成合併前",
      step: check.id,
    });
  }

  return {
    status,
    symbol: display.symbol,
    ariaLabel: display.label,
    label: check.label,
    detail: pending ? `${check.detail}——尚未驗證真的生效` : check.detail,
    buttons,
    // 只有真終端看得到的那一格：程式驗不到，讓學生看完回來勾。
    eyeCheck: pending && check.eyeCheck != null ? check.eyeCheck : null,
    verified,
    // 「再 check 一次」一直都在（只要這一列有得驗）。既然拿掉了會閃現的「驗證」
    // 按鈕，這顆就是學生唯一的重驗入口，不能等驗過一次才出現——上一輪重新整理
    // 之後就沒有安裝事件可以接，會變成完全驗不了。
    // 等著合併的列不給驗證入口：那顆按下去驗的是一份還沒併進去的設定，會拿到一個
    // 跟列上「需要合併」互相矛盾的結果。合併完檢查會重跑，needsMerge 消失，這顆
    // 自己就回來了。
    showRetest:
      check.verifyAction != null &&
      check.noInstall !== true &&
      check.needsMerge !== true,
    guidance: guidanceModel({
      step: check.id,
      status,
      failed,
      availableActions,
    }),
  };
}

export function sectionManualItems(
  sectionId,
  cardIndex,
  cardCount,
  tools,
  cardId = null,
) {
  const codexSelected = tools.split(",").includes("codex");
  const usable = (gates) =>
    gates
      .filter((gate) => gate.codexOnly !== true || codexSelected)
      .map((gate) => ({
        id: gate.id,
        text: gate.title,
        detail: gate.detail,
        // 這一格屬於哪一步。沒有 stepId 的（段落閘門那種）就不分步。
        stepId: gate.stepId ?? null,
      }));

  // 掛在這張卡上的關卡：在真正需要它的那一張就提醒，不是等走完整段。
  const cardGates = usable(CARD_GATES[cardId] ?? []);

  if (cardIndex !== cardCount - 1) {
    return cardGates;
  }

  const sectionIndex = SECTIONS.findIndex((section) => section.id === sectionId);
  const nextSection = SECTIONS[sectionIndex + 1];

  if (nextSection === undefined) {
    return cardGates;
  }

  return [...cardGates, ...usable(SECTION_GATES[nextSection.id] ?? [])];
}

// 人工項目照「步驟」分組：同一步的項目在同一個視窗裡做完，那一步配一顆把視窗開
// 起來的按鈕。沒有 stepId 的項目照原樣排在最後，不長出標題。
export function manualStepGroups(items, steps = MANUAL_STEPS) {
  const groups = [];
  const byStep = new Map();

  for (const item of items) {
    const step = item.stepId == null ? null : steps[item.stepId];
    const key = step === undefined || step === null ? null : item.stepId;

    if (!byStep.has(key)) {
      const group = {
        id: key,
        title: step?.title ?? null,
        action: step?.action ?? null,
        buttonText: step?.buttonText ?? null,
        items: [],
      };
      byStep.set(key, group);
      groups.push(group);
    }

    byStep.get(key).items.push(item);
  }

  return groups;
}

export function toggleToolSelection(selectedTools, tool) {
  const selected = new Set(selectedTools);

  if (selected.has(tool)) {
    if (selected.size > 1) {
      selected.delete(tool);
    }
  } else {
    selected.add(tool);
  }

  return ["claude", "codex"].filter((value) => selected.has(value));
}

export function toolSelectionValue(selectedTools) {
  return ["claude", "codex"]
    .filter((value) => selectedTools.includes(value))
    .join(",");
}

export function cardIsComplete(
  card,
  verifiedSteps = new Set(),
  checkedManualIds = new Set(),
) {
  if (card.kind === "setup") {
    return card.completed === true;
  }

  // 整張卡都是人工項目，沒有安裝也沒有程式驗證——勾滿才算走完。
  if (card.kind === "manual") {
    return (card.manualIds ?? []).every((id) => checkedManualIds.has(id));
  }

  if (card.kind === "env") {
    return (
      (card.checks ?? [card.check]).every((check) => check.status === "ok") &&
      (card.manualIds ?? []).every((id) => checkedManualIds.has(id))
    );
  }

  return (card.checks ?? [card.check]).every(
    (check) =>
      configRowModel(check, verifiedSteps.has(check.id)).status === "ok",
  );
}

// 一段裡「已完成」的卡有哪些。全站只有這一個答案，五個顯示位置（徽章、清單、
// 里程碑、段落狀態、tab 解鎖）都從這裡或 cardIsComplete 出發。
//
// 抽成純函式是為了測得到。它原本內嵌在 renderWizard 裡，於是額外的完成路徑可以
// 悄悄長出來而沒有任何測試會紅——稽核報告七項不一致裡有三項就是這樣來的。
export function completedCardIds(
  cards,
  verifiedSteps = new Set(),
  checkedManualIds = new Set(),
) {
  return new Set(
    cards
      .filter((card) => cardIsComplete(card, verifiedSteps, checkedManualIds))
      .map(({ checkId }) => checkId),
  );
}

// 沒有眼睛項的列：「程式驗過了」就是「整列過了」，不需要第二本帳來確認。
//
// 兩本帳分兩次寫，而寫成功一半就會卡住：VM 實測 ext-playwright-claude 只寫進
// behavior、沒寫進 verified，於是清單那格打勾、徽章卻是待驗證，學生被要求重跑一次
// 要開瀏覽器的驗證。旁邊 codex 那筆差 128 毫秒、兩本都成功——同一段程式，一次成功
// 一次沒有。與其追那次為什麼漏，不如讓它不需要兩本都成立。
//
// 有眼睛項的列不在此列：那種列的「整列過了」本來就要學生看完說了算。
export function impliedVerifiedSteps(checks, behaviorVerified = new Set()) {
  return new Set(
    checks
      .filter(
        (check) => check.eyeCheck == null && behaviorVerified.has(check.id),
      )
      .map((check) => check.id),
  );
}

// 有眼睛項的列，「整列過了」要兩半都成立：程式那半跑過，而且學生看過畫面說對了。
//
// 原本只要學生勾眼睛就算整列過——於是他可以完全不跑驗證、直接勾，卡片就變成已完成
// 並長出「下一張」，而清單還停在 1 / 2（VM 實測 skill-claude-handoff）。徽章與清單
// 講的是同一件事，不能一邊說完成、一邊說還差一項。
//
// 沒有程式那半可跑的列（沒有 verifyAction）不在此限：那種列只有學生看得到，勾了
// 就是過了。
export function eyeVerifiedSteps(
  checks,
  checkedManualIds = new Set(),
  behaviorVerified = new Set(),
) {
  const done = new Set();

  for (const id of checkedManualIds) {
    if (!id.startsWith("eye-")) continue;
    const stepId = id.slice("eye-".length);
    const check = checks.find((candidate) => candidate.id === stepId);

    if (check?.verifyAction != null && !behaviorVerified.has(stepId)) {
      continue;
    }

    done.add(stepId);
  }

  return done;
}

export function currentCardIndex(
  cards,
  verifiedSteps = new Set(),
  checkedManualIds = new Set(),
) {
  if (cards.length === 0) {
    return 0;
  }

  const firstIncomplete = cards.findIndex(
    (card) => !cardIsComplete(card, verifiedSteps, checkedManualIds),
  );
  return firstIncomplete === -1 ? cards.length - 1 : firstIncomplete;
}

// 一張卡要算完成，光是「這台機器上本來就裝好了」不夠——使用者還得走到那裡。
// 少了後面那半，本機環境全綠時整條進度條會在小鴨還停在第一站時就全部亮起來，
// 段落也會在第 2/10 站就宣告「已完成」。
//
// 「走到那裡」原本用 index <= currentIndex 表示，也就是拿「現在站在哪」代表
// 「走到哪」。往前走時兩者一致，一往回走就開始說謊：
//
//   VM 實測——只選 codex、做完所有 codex 卡，再回第一頁加選 claude。加選會把
//   停留位置重置，而 claude 的卡排在 codex 前面，於是位置被拉回開頭，已經做完的
//   codex 卡通通變灰。資料完全沒變，變的只是顯示。
//
// 改成記「曾經被顯示過的卡片 ID」。用 ID 不用索引是必要的：加選工具會在中間插入
// 新卡，索引會位移——記索引的話，完成到第 7 張、中間插 3 張，原本的第 5~7 張會被
// 推到第 8~10 位而重新變灰，等於沒修。
//
// 小鴨當前那一張算不算，交給 completedCardIds 決定：呼叫端只有在該卡真的做完
// （裝好 + 該驗的驗過 + 手動項勾完）時才會把它放進去。
function cardsDone(cards, completedCardIds, seenCardIds) {
  return cards.map(
    (card) =>
      completedCardIds.has(card.checkId) && seenCardIds.has(card.checkId),
  );
}

export function milestoneModels(
  cards,
  completedCardIds,
  currentIndex,
  seenCardIds = new Set(),
) {
  const done = cardsDone(cards, completedCardIds, seenCardIds);

  return cards.map((card, index) => {
    const completed = done[index];
    const unlocked = completed || done.slice(0, index).every(Boolean);
    const percent = Math.round(((index + 1) / cards.length) * 100);

    return {
      ...card,
      index,
      percent,
      completed,
      unlocked,
      reached: completed,
      current: index === currentIndex,
      // 卡片往哪邊展開看這一站落在條上的哪半邊，不是它排第幾顆。
      // 用「第幾顆」的話，只有一站時那顆（percent 100、貼最右）會被判成往右開，
      // 直接溢出畫面。
      edgeClass:
        percent > 50 ? "ds-milestone--edge-end" : "ds-milestone--edge-start",
    };
  });
}

// 進度條上面那一行。原本只講「還有 3 張要做」——那句話對站在最後一張的學生沒有用：
// 他眼前這張是綠的，卻被告知還有三張，只能一張一張往回翻找是哪三張（VM 實測，
// 跟段落閘門當初那句「先把上一段做完」是同一個毛病）。
//
// 所以指名。點名規則跟 sectionGateState 對齊：只講前兩張，後面用「等 N 張」帶過
// ——列滿七張只會變成另一種看不懂，而且這一行擠在進度條上面，長了會換行把條推下去。
export function sectionStatus(cards, completedCardIds, seenCardIds = new Set()) {
  const done = cardsDone(cards, completedCardIds, seenCardIds);
  const blocking = cards
    .map((card, index) => ({ label: card.label, index }))
    .filter((_, index) => !done[index]);

  if (blocking.length === 0) {
    return "這一段已完成。";
  }

  const named = blocking
    .slice(0, 2)
    .map(({ label, index }) => `「${label}」（第 ${index + 1} 張）`)
    .join("、");
  const rest = blocking.length > 2 ? `等 ${blocking.length} 張` : "";

  return `還沒做完：${named}${rest}。`;
}

// 走到一段的最後一張時，自己重查一次。
//
// 為什麼需要：段落閘門看的是「每張卡的實際狀態」，而那些狀態來自上一次檢查的快照。
// 學生在卡片上按完安裝、驗證、清理之後往下翻，翻到最後一張時快照多半已經過期
// ——畫面說這一段還沒完，下一段因此鎖著，而他手上沒有任何線索該回去點哪裡。
// 唯一的自救是自己找到「重新檢查」那顆按鈕，而那顆在畫面另一頭（VM 實測）。
//
// 回哪一種：這一段的完成度是誰算出來的，就重查誰。環境段十三項併行 spawn，
// Windows 上實測 8.3 秒——為了規則段的一張卡順手把它一起重跑是很貴的。
//
// alreadyDone 是「這一次走到最後一張，已經查過了」。沒有它會無限迴圈：查完會
// renderWizard，renderWizard 又走到這裡。往回翻再翻回來要算新的一次，所以那個
// 記憶由呼叫端在離開最後一張時清掉。
// ⚠️ sectionDone 這道是 VM 實測之後補的：學生站在最後一張、上面明明寫著
// 「這一段已完成。」，它還是重查了一次。那一次什麼都不會改變——環境段十三項併行
// spawn、Windows 上實測 8.3 秒，純粹白跑，而且往回翻再翻回來又跑一次。
//
// 已完成的段落沒有任何東西需要被解鎖。而這支要救的那個情境（卡在最後一張、下一段
// 鎖著、不知道該回去點哪裡）前提正是「這一段沒完成」，所以加這道不影響它。
//
// undefined（資料還沒回來）當成「還沒完成」：那時重查一次正是我們要的。
export function sectionEndRecheck({
  sectionId,
  currentIndex,
  cardCount,
  alreadyDone = false,
  busy = false,
  sectionDone = false,
}) {
  if (
    alreadyDone ||
    busy ||
    sectionDone === true ||
    cardCount === 0 ||
    currentIndex !== cardCount - 1
  ) {
    return null;
  }

  return sectionId === "env" ? "env" : "configs";
}

export function appendTermLine(lines, next) {
  if (lines.at(-1)?.text === next.text) {
    return lines;
  }

  // 同一則失敗訊息只講一次。輪詢重試時畫面會「正在檢查／失敗」交替，兩者都不連續，
  // 只擋連續重複的話同一句 Failed to fetch 會洗滿整個終端（實測連出六次）。
  // 進度行照舊只擋連續重複——它重複出現是有意義的，錯誤重複則沒有新資訊。
  const isFailure = next.className?.includes("ds-term-line--err") === true;

  if (isFailure && lines.some((line) => line.text === next.text)) {
    return lines;
  }

  return [...lines, next];
}

// 清單第一格（程式驗證那一列）該不該打勾。
//
// 三種情況都要對，而且它們曾經各錯過一次：
//   整列已經綠了            → 勾（configRowModel 說 ok）
//   程式那半驗過、列還是好的 → 勾（有眼睛勾選框的列不會變 ok，但程式那半確實過了）
//   程式那半驗過、列壞掉了   → 不勾 ← 這格漏了會變成「1/1 全綠卻沒有下一張」
//
// 最後那個是實測踩到的：codex-config 驗過之後檔案又變成「需要合併」（status warn），
// behaviorVerified 是開頁時載入的、不會跟著更新，於是照著上一輪的結論打勾。
export function systemRowChecked(check, { rowVerified, behaviorVerified }) {
  if (configRowModel(check, rowVerified).status === "ok") return true;
  return behaviorVerified && check.status === "ok";
}

// 「結構都對了，但還沒實際跑跑看」——這句只在該跑而還沒跑的時候補。
const PENDING_RUN_HINT = "還沒實際跑跑看——按「重跑驗證」";

// 驗過之後那一步的檔案被動過。不作廢那個勾，只提醒——改的可能是學生自己那半
// （合併過的 CLAUDE.md），程式看不出來會不會影響，決定權給他。
const CHANGED_HINT = "這個檔案在你驗證之後被改過，要不要再驗一次？";

function appendHint(detail, hint) {
  if (hint === null) return detail;
  return detail === "" ? hint : `${detail}，${hint}`;
}

function appendPendingRunHint(detail, pending) {
  return appendHint(detail, pending ? PENDING_RUN_HINT : null);
}

export function checklistGroups({
  check,
  checks = check == null ? [] : [check],
  verified = false,
  verifiedCheckIds = null,
  verificationAttempted = false,
  verificationFailed = false,
  manualItems = [],
  checkedManualIds = new Set(),
  resultTexts = new Map(),
  changedCheckIds = new Set(),
  // 這一輪按過安裝的樂觀記憶。權威還是伺服器的 status === "ok"，這份只是讓
  // 「剛裝完、還沒重查」那幾秒的畫面別停在「尚未安裝」。
  installedCheckIds = new Set(),
}) {
  const system = [];
  // 前綴只在同一張清單裡兩種項目並存時才加。整張都是程式檢查的卡（環境那幾張）
  // 每一行都掛「程式檢查：」只是噪音。
  const mixed =
    checks.some((candidate) => candidate.eyeCheck != null) ||
    manualItems.length > 0;

  for (const candidate of checks) {
    const checked =
      verifiedCheckIds === null ? verified : verifiedCheckIds.has(candidate.id);

    // 「裝好了」與「驗過了」是兩件事，各自一格（Reed 指定）。原本共用一個勾，於是
    // 安裝成功之後那一格仍是空的、旁邊還寫著上一次檢查留下的「尚未安裝」——學生看到
    // 的是「我明明裝好了，它說沒裝」（VM 實測）。
    //
    // 只有「有自動驗證」的檢查才拆：沒有 verifyAction 的（CLI 在不在、登入了沒、
    // Node 的版本）本來就只有一件事要講，硬拆會長出一格永遠不知道該不該打勾的東西。
    //
    // 「裝好了沒」的判定沿用 configRowModel 那一條，不另開一條路——這個 repo 有過
    // 「多個完成判定各自為政」的稽核紀錄（見 completedCardIds 上面的說明）。
    // ⚠️ EYE_ONLY_VERIFY 的那幾列不拆。它們的「驗證」只是把終端開起來、沒有可以
    // 輪詢的落點，拆出來的那一格會在視窗剛開的瞬間就打勾（見 model.js 的說明）。
    if (candidate.verifyAction != null && !EYE_ONLY_VERIFY.has(candidate.id)) {
      const installedThis =
        candidate.status === "ok" ||
        checked ||
        installedCheckIds.has(candidate.id);
      system.push({
        id: `install-${candidate.id}`,
        text: `安裝：${candidate.label}`,
        detail: resultTexts.get(candidate.id) ?? candidate.detail ?? "",
        checked: installedThis,
        automatic: true,
        disabled: true,
        failedReason: "",
      });
      system.push({
        id: `system-${candidate.id}`,
        text: `驗證：${candidate.label}`,
        // 這一格的說明只講驗證：還沒驗就說在等什麼，驗過但檔案被動過就補一句提醒。
        detail: appendHint(
          appendPendingRunHint("", !checked && installedThis),
          checked && changedCheckIds.has(candidate.id) ? CHANGED_HINT : null,
        ),
        checked,
        automatic: true,
        disabled: true,
        failedReason:
          verificationAttempted && verificationFailed
            ? "自動驗證沒有通過，修正後可以重新測試。"
            : "",
      });
      continue;
    }

    // 沒有自動驗證的列（合併卡的前半份、環境卡那些）：這一格講的就是「這件事成了
    // 沒」，而它唯一的達成方式就是安裝。所以剛裝完也要當場打勾，不等下一次伺服器
    // 檢查回來——不然會出現「終端印安裝成功、這一列還寫尚未安裝」（VM 實測，
    // 合併卡的第一列）。
    //
    // 這份記憶只該活到下一次檢查回來為止：新的結果說 missing 時，那一筆會在
    // app.js 的 forgetStaleInstalls 被清掉，這裡不必再擋一次。
    const settled = checked || installedCheckIds.has(candidate.id);

    system.push({
      id: `system-${candidate.id}`,
      // 前綴講清楚這一格在問什麼。原本第一格寫「自動命名 hook／hook 檔案與 3 筆註冊
      // 都已生效」——那句話講的是檔案在不在，但那個勾代表的是「真的跑起來了」。
      // 兩件事共用一句話，學生看到檔案明明都在卻沒打勾，只能猜（Reed 實測）。
      text: mixed ? `程式檢查：${candidate.label}` : candidate.label,
      // 執行結果就掛在這一項底下，不另外開一塊「結果」——同一個檢查的名稱與結果
      // 分兩個地方講，讀的人要自己配對。
      //
      // 還沒驗過就補一句說明那個空格在等什麼。少了它，畫面是「檔案與註冊都已生效」
      // 配一個空格，看起來像壞掉。
      //
      // 已經驗過、但那一步的檔案之後被動過：勾留著，補一句提醒就好。改的可能是
      // 學生自己那半（合併過的 CLAUDE.md），程式看不出來會不會影響驗過的行為。
      detail: appendHint(
        appendPendingRunHint(
          resultTexts.get(candidate.id) ?? candidate.detail ?? "",
          !checked &&
            candidate.status === "ok" &&
            candidate.verifyAction != null,
        ),
        checked && changedCheckIds.has(candidate.id) ? CHANGED_HINT : null,
      ),
      checked: settled,
      automatic: true,
      disabled: true,
      failedReason:
        verificationAttempted && verificationFailed
          ? "自動驗證沒有通過，修正後可以重新測試。"
          : "",
    });
  }

  const manual = [
    ...checks.filter((candidate) => candidate.eyeCheck != null).map(
      (candidate) =>
        ({
          id: `eye-${candidate.id}`,
          // 跟第一格的「程式檢查：」對稱：一眼看得出哪一格是程式的事、哪一格是你的事。
          text: `你要看的：${candidate.eyeCheck}`,
          detail: "這一項程式驗不到，要你看畫面確認。",
        }),
    ),
    ...manualItems,
  ].map((item) => ({
    ...item,
    checked: checkedManualIds.has(item.id),
    automatic: false,
    disabled: false,
  }));

  return { system, manual };
}

const LOGIN_CARD_SERVICES = {
  "claude-auth": {
    action: "login-claude",
    linkText: "開啟 Anthropic 授權頁",
  },
  "codex-auth": {
    action: "login-codex",
    // codex 一定會自己開瀏覽器（不吃 BROWSER，--device-auth 又要帳號層級先開關，
    // 詳見 src/actions.js 的說明）。所以這裡不假裝連結是主要入口，改成備援用字：
    // 自動開了就不用點，沒開才點。
    linkText: "瀏覽器沒開？點這裡開啟 OpenAI 授權頁",
    autoOpens: true,
  },
  "gh-auth": {
    action: "login-gh",
    linkText: "開啟 GitHub 授權頁",
  },
};

export function loginCardModel({
  checks = [],
  hints = { url: null, code: null },
  acceptsInput = false,
  runInProgress = false,
  runId = null,
} = {}) {
  const authCheck = checks.find((check) => LOGIN_CARD_SERVICES[check.id]);

  if (authCheck === undefined) {
    return null;
  }

  const service = LOGIN_CARD_SERVICES[authCheck.id];
  const showCode = hints.code !== null;

  return {
    ...service,
    authCheckId: authCheck.id,
    url: hints.url,
    code: hints.code,
    showLink: hints.url !== null,
    showCode,
    // 輸入格不能綁在「有沒有撈到代碼」上。
    //
    // 兩種登入長得不一樣：codex 走裝置碼（先給你一組代碼，貼到網頁），Claude 走
    // 純瀏覽器授權（不給代碼，但網頁授權完會給你一串授權碼，要貼回終端）。
    // 綁在 showCode 上的話，Claude 那張卡只有網址按鈕、沒有地方貼授權碼——
    // 學生走到一半就卡死（VM 實測）。
    //
    // 正確的條件是「這個程序還活著而且吃得下 stdin」，那就是可以貼回的時機。
    showInput: acceptsInput && runInProgress && runId !== null,
  };
}

export function nextCardUnlocked({
  installed = true,
  verificationRequired = false,
  verificationAttempted = false,
  manualItems = [],
}) {
  return (
    installed &&
    (!verificationRequired || verificationAttempted) &&
    manualItems.every((item) => item.checked)
  );
}

export function terminalOutcomeLines({
  action,
  succeeded,
  check = null,
  guidance = null,
  reason = null,
}) {
  const label = check?.label ?? "這個項目";
  const plain = (text) => text.replace(/`[^`]+`/g, "指定測試");

  if (succeeded) {
    const verification =
      action.startsWith("verify-") || action.startsWith("diagnose-");

    // 檔案已經是學生自己的版本時，安裝刻意不覆蓋（覆蓋會弄丟他寫的東西），腳本
    // 什麼都沒做就 exit 0。照著 exit code 印「安裝成功，已完成」是騙人的——列上
    // 還寫著「需要合併」，兩句話互相矛盾，學生只能挑一句相信（VM 實測 codex-config）。
    //
    // 這是這個 repo 反覆踩的假綠燈：exit 0 只代表「沒有出錯」，不代表「做完了」。
    if (!verification && check?.needsMerge === true) {
      return [
        {
          // 設計系統只有 prompt / ok / err 三個修飾 class，沒有 warn——用不存在的
          // class 不會報錯，只會靜靜地沒有樣式。這句不是錯誤，是「還要你做一件事」。
          className: "ds-term-line ds-term-line--prompt",
          text: `已有你自己的${label}，沒有覆蓋。請按「用 AI 合併」把工作坊的設定併進去，再按「重跑驗證」。`,
        },
      ];
    }

    return [
      {
        className: "ds-term-line ds-term-line--ok",
        text: verification
          ? `✅ 驗證成功，已確認${label}可以正常使用。`
          : `✅ 安裝成功，已完成${label}。`,
      },
    ];
  }

  if (guidance === null) {
    // 腳本自己講出來的那句話優先。它通常是「該怎麼辦」（Obsidian 現在開著，請先
    // 完全關掉它再按一次安裝），而罐頭句只是叫學生去讀一堆他看不懂的原始輸出
    // ——那句話明明就在裡面（Reed 實測截圖）。
    if (typeof reason === "string" && reason.trim() !== "") {
      return [
        {
          className: "ds-term-line ds-term-line--err",
          text: reason.trim(),
        },
      ];
    }

    return [
      {
        className: "ds-term-line ds-term-line--err",
        text: `沒有完成${label}，請檢查原始輸出後再試一次。`,
      },
    ];
  }

  return [
    {
      className: "ds-term-line ds-term-line--err",
      text: `現在的狀況：${plain(guidance.symptom)}`,
    },
    {
      className: "ds-term-line ds-term-line--dim",
      text: `完成後應該看到：${plain(guidance.expected)}`,
    },
    ...guidance.checks.map((text) => ({
      className: "ds-term-line ds-term-line--dim",
      text: `請確認：${plain(text)}`,
    })),
  ];
}

export function configSummary(checks, verifiedSteps = new Set()) {
  const total = checks.length;

  if (total === 0) {
    return {
      done: 0,
      total: 0,
      allOk: false,
      text: "尚未檢查",
    };
  }

  // 「就緒」的門檻跟列上的綠燈同一條：結構齊全，而且該驗的行為也驗過了。
  const done = checks.filter(
    (check) =>
      configRowModel(check, verifiedSteps.has(check.id)).status === "ok",
  ).length;

  return {
    done,
    total,
    allOk: done === total,
    text: `${total} 項中 ${done} 項就緒`,
  };
}

export function progressSummary(
  envChecks,
  configChecks,
  verifiedSteps = new Set(),
) {
  if (envChecks === null || configChecks === null) {
    return { loading: true, done: 0, total: 0, percent: 0 };
  }

  const envDone = envChecks.filter((check) => check.status === "ok").length;
  const configDone = configChecks.filter(
    (check) =>
      configRowModel(check, verifiedSteps.has(check.id)).status === "ok",
  ).length;
  const total = envChecks.length + configChecks.length;
  const done = envDone + configDone;

  return {
    loading: false,
    done,
    total,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
  };
}

export function installVerificationFollowUp({ action, result, check }) {
  if (
    action !== "install-config-step" ||
    result.signal != null ||
    (result.exitCode !== 0 && result.benign !== true) ||
    check?.verifyAction == null
  ) {
    return "none";
  }

  // 還沒合併就不接驗證。protectExisting 的檔案（codex 的 config.toml / AGENTS.md、
  // CLAUDE.md）安裝時刻意什麼都不做，腳本照樣 exit 0——照著 exit code 往下接，
  // 學生會被直接帶進終端去驗一份根本還沒併進去的設定（VM 實測 codex-config：
  // 沒按「用 AI 合併」就跑了規矩與回話風格的測試）。
  //
  // 正確的順序是：合併 → 檢查重跑 → needsMerge 消失 → 才輪到驗證。
  if (check.needsMerge === true) {
    return "none";
  }

  if (check.verifyKind === "page") {
    return "auto";
  }

  return check.verifyKind === "terminal" ? "prompt" : "none";
}

// 行為驗證會逐條判定五條規則，腳本每判完一條就送一個事件過來。原本這些事件只拿來
// 換轉圈圈的動畫，結果畫面上只留一句「驗證成功」——學生不知道驗了什麼、也不知道
// 是不是全過（實測就是這樣問的：五條裡過幾條？）。
//
// 門檻是「五條中過幾條」而不是「全過」，所以通過的那次也要把沒過的那條印出來。
export function behaviorRuleLine(jrEvent) {
  if (jrEvent?.kind !== "rule") {
    return null;
  }

  const mark = jrEvent.pass === true ? "✓" : "✗";
  const reason =
    jrEvent.pass === true || !jrEvent.reason ? "" : `——${jrEvent.reason}`;

  return {
    text: `　${mark} ${jrEvent.name}${reason}`,
    className: `ds-term-line ${
      jrEvent.pass === true ? "ds-term-line--ok" : "ds-term-line--err"
    }`,
  };
}

// 判完之後的總結：五條中過幾條。
export function behaviorTally(rules) {
  const passed = rules.filter((rule) => rule.pass === true).length;

  return {
    text: `${rules.length} 條規則中通過 ${passed} 條。`,
    className: `ds-term-line ${
      passed === rules.length ? "ds-term-line--ok" : "ds-term-line--dim"
    }`,
  };
}

export function loaderModifier({
  checking = false,
  action = "",
  options = null,
  output = "",
  jrEvent = null,
  result = null,
} = {}) {
  if (
    result !== null &&
    (result.signal != null || result.exitCode !== 0)
  ) {
    return LOADER_MODIFIERS.paused;
  }

  if (checking) {
    return LOADER_MODIFIERS.searching;
  }

  if (jrEvent?.kind === "stage") {
    return STAGE_MODIFIERS[jrEvent.stage] ?? null;
  }

  if (action === "verify-in-terminal" && options?.case === "demo") {
    return LOADER_MODIFIERS.shaping;
  }

  if (output.includes(BEHAVIOR_SOLVING_LINE)) {
    return LOADER_MODIFIERS.solving;
  }

  if (output.includes(BEHAVIOR_COMPOSING_LINE)) {
    return LOADER_MODIFIERS.composing;
  }

  if (output.includes(TERMINAL_LISTENING_LINE)) {
    return LOADER_MODIFIERS.listening;
  }

  if (action.startsWith("install-")) {
    return LOADER_MODIFIERS.working;
  }

  return null;
}

// 環境檢查那一區的按鈕：跑東西時全部鎖住，正在跑的那顆改成「安裝中…」，
// 等登入結果的那顆改成「等待登入中…」。
export function envButtonState({
  action,
  idleText,
  permanentlyDisabled = false,
  runInProgress,
  currentEnvAction,
  waitingAction,
}) {
  if (permanentlyDisabled) {
    return { disabled: true, text: idleText };
  }

  const waiting = waitingAction === action;

  if (waiting) {
    return { disabled: true, text: "等待登入中…" };
  }

  if (runInProgress && action === currentEnvAction) {
    return { disabled: true, text: `${idleText}中…` };
  }

  return { disabled: Boolean(runInProgress), text: idleText };
}

// 執行中／閒置時，畫面上各個控制項的開關。
export function runControlsState({
  runInProgress,
  runId,
  acceptsInput,
  envCheckInProgress,
  configCheckInProgress,
}) {
  const hasRun = runId !== null && runId !== undefined;

  return {
    actionButtonsDisabled: runInProgress,
    promptDisabled: runInProgress,
    allowWriteDisabled: runInProgress,
    recheckDisabled: runInProgress || envCheckInProgress,
    configControlsDisabled: Boolean(runInProgress || configCheckInProgress),
    cancelHidden: !runInProgress,
    cancelDisabled: !runInProgress || !hasRun,
    // 只有「會等輸入」的動作才給那格貼代碼的輸入列。
    inputHidden: !runInProgress || !hasRun || !acceptsInput,
  };
}

// 卡片上那一行「為什麼失敗」要從整段輸出裡挑一行出來。挑最後一行是錯的：
// npm 失敗時結尾固定是 npm notice 與 "A complete log of this run can be found in: …"，
// 而真正的 "EACCES: permission denied" 在整段的第 5 行——最有用的資訊在最前面，
// 程式卻去撈最後面，學生看到的等於一句廢話（VM 實測）。
//
// 也不能只認 npm 的格式：winget / brew / curl 都會走到這裡。所以改成分級挑：
// 帶錯誤內容的那種最好，其次是錯誤代碼，都沒有才退回原本的最後一行。
const NOISE_PATTERNS = [
  /complete log of this run/i,
  // npm 會把整段 async 堆疊當成 error 印出來，那是給維護者看的，不是給學生看的。
  /^\s*(npm error\s+)?at\s/i,
  /^\s*(npm )?(notice|warn|debug)\b/i,
];

const REASON_TIERS = [
  // "Error: EACCES: permission denied, mkdir '/usr/local/lib/node_modules/…'"
  /error:\s*\S/i,
  // "npm error code EACCES"
  /\berr(or)?\s+code\b/i,
  /\berror\b/i,
];

export function failureReason(rawOutput) {
  const lines = (Array.isArray(rawOutput) ? rawOutput : [])
    .map((line) => (typeof line === "string" ? line : ""))
    .filter((line) => line.trim() !== "");
  const usable = lines.filter(
    (line) => !NOISE_PATTERNS.some((pattern) => pattern.test(line)),
  );

  for (const tier of REASON_TIERS) {
    const hit = usable.find((line) => tier.test(line));

    if (hit !== undefined) {
      return hit;
    }
  }

  // 沒有任何一行看起來像錯誤時，最後一行仍然是最好的猜測。
  return usable.at(-1) ?? lines.at(-1);
}

// benign：安裝器回報「已經裝好了／沒有可用更新」，那不是失敗。
export function runOutcome(result) {
  const succeeded =
    result.signal == null &&
    (result.exitCode === 0 || result.benign === true);

  return {
    succeeded,
    summary:
      result.signal === null || result.signal === undefined
        ? `exit code: ${result.exitCode}`
        : `已停止：${result.signal}`,
    className: succeeded ? "succeeded" : "failed",
  };
}

export function behaviorFallbackState(result) {
  const { succeeded } = runOutcome(result);

  return {
    visible: !succeeded,
    question: succeeded ? "" : BEHAVIOR_QUESTION,
    checklist: succeeded ? [] : BEHAVIOR_CHECKLIST,
  };
}

// 環境檢查那一區的狀態列要說什麼。null 代表不用顯示。
export function installStatusMessage(action, result) {
  const { succeeded } = runOutcome(result);

  if (!succeeded) {
    return {
      text: action.startsWith("install-")
        ? "安裝失敗，請看下方輸出"
        : "執行失敗，請看下方輸出",
      failed: true,
    };
  }

  if (isLoginAction(action)) {
    // 登入成功不在這裡報告——要等輪詢確認狀態真的變綠。
    return null;
  }

  if (action === "fix-execution-policy") {
    return { text: "已改為 RemoteSigned，狀態已更新。", failed: false };
  }

  // 這一項跟其他修復不一樣：狀態雖然當場就變綠，但學生手上那個終端視窗還是舊的
  // ——設定檔是開視窗時讀的。不講的話他會以為修好了，回去打指令還是失敗。
  if (action === "fix-shell-wrapper") {
    return {
      text: "已清除廢棄的引用。要開一個新的終端視窗，改動才會生效。",
      failed: false,
    };
  }

  if (action === "fix-codex-sandbox") {
    return { text: "已接回沙箱檔案，狀態已更新。", failed: false };
  }

  if (action === "fix-legacy-cli") {
    return {
      text: "npm 裝的舊版已搬進隔離區。要開一個新的終端視窗，改動才會生效。",
      failed: false,
    };
  }

  if (action === "fix-legacy-skills") {
    return {
      text: "舊 skill 已搬進隔離區。要開一個新的 Codex session 才會生效。",
      failed: false,
    };
  }

  return {
    text:
      result.benign === true
        ? "這個項目本來就已經裝好了，狀態已更新。"
        : "安裝完成，狀態已更新。",
    failed: false,
  };
}

// 等登入變綠的輪詢：該收工、該再等一輪、還是逾時放棄。
export function loginWaitStep({ startedAt, now, checks, checkId }) {
  if (Array.isArray(checks)) {
    const check = checks.find((candidate) => candidate.id === checkId);

    if (check?.status === "ok") {
      return { kind: "done", text: "登入成功。", failed: false };
    }
  }

  if (now - startedAt >= LOGIN_WAIT_TIMEOUT_MS) {
    return {
      kind: "timeout",
      text: "等待逾時，請確認登入是否完成，或按重新檢查。",
      failed: true,
    };
  }

  return { kind: "pending" };
}
