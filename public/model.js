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
  // 選配的一段。它跟前面幾段沒有依賴關係，學生想先做就先做。
  {
    id: "notes",
    title: "使用 Obsidian 管理你的知識庫",
    subtitle: "Obsidian 與 GitHub",
  },
  // demo 排最後：它要當日密碼才開（見 SECTION_PASSCODES）。網頁嚮導會提早發出去
  // 讓學生先裝環境，這一段擺在最後，學生走完前面才會撞到那道鎖。
  { id: "demo", title: "跑一次給你看", subtitle: "Demo" },
];

// 要當天才開的那幾段，以及打得開它們的數字。
//
// 這跟其他的鎖不是同一種：其他的鎖是「做完前面就會開」，學生自己解得開；這一道
// 只有講師在課堂上報出來的數字打得開。理由是嚮導會提早幾天發給學生先裝環境，而
// demo 那段是當天要一起跑的。
export const SECTION_PASSCODES = { demo: "0822" };

// 前後常黏到空白（複製貼上、或手機鍵盤自動補一個空格），比對前先清乾淨。
export function matchesSectionPasscode(sectionId, entered) {
  const expected = SECTION_PASSCODES[sectionId];

  return (
    expected !== undefined &&
    typeof entered === "string" &&
    entered.trim() === expected
  );
}

// 講師的萬用密碼。跟上面那個當日密碼不是同一件事：
//
//   當日密碼  只解「今天才開」那一道，前面幾段沒做完照樣進不去
//   萬用密碼  把整段的鎖直接跳過，前面沒做完也開
//
// 給課堂上要跳著示範的人用（「先看最後那段長什麼樣」），以及助教在學生機器上排查
// 問題時不必真的把前面全跑一遍。學生用不到，但也沒有藏——它擋的是順手做過頭，
// 不是防作弊。
export const MASTER_PASSCODE = "admin";

export function matchesMasterPasscode(entered) {
  return typeof entered === "string" && entered.trim() === MASTER_PASSCODE;
}

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

// 這幾列的「驗證」那一格要整個拿掉——它是假的。
//
// `verify-in-terminal` 的 vault-note 那一格 `expect` 回 null（見那支腳本），也就是
// **沒有任何可以輪詢的落點**：它的工作只是把終端開起來，判定交給學生的眼睛。可是
// 腳本開完視窗就 exit 0，而 verify-in-terminal 在 AUTO_VERIFY_ACTIONS 裡，於是那一
// 格當場被打勾——畫面寫著「驗證：叫 AI 寫一篇進去 ✅」，而 codex 才剛開始做事
// （VM 實測）。
//
// ⚠️ app.js 的註解早就認得出這件事（「開終端驗證跑完 exit 0 不一定等於驗過了」），
// 但只擋了外層：有 eyeCheck 就不把**整列**標綠，那一格照樣打勾。
//
// 拿掉之後這張卡剩兩格：「按右邊開終端跑一次」（真的按了就打勾，誠實）與眼睛那格
// 「GitHub 上看得到你的改動歷史」（真正的證據）。
export const EYE_ONLY_VERIFY = new Set([
  "vault-agent-claude",
  "vault-agent-codex",
]);

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
    symptom: "終端機打 Claude 或 Codex 叫不動，或分頁標題沒有跟著 session 名稱更新",
    expected: "Claude 與 Codex 都叫得動，分頁標題也會走目前平台的命名路徑",
    checks: [
      "shell 設定檔可能同時留著失效的 Claude 捷徑，以及會接手 Codex 標題的舊 wrapper",
      "它們排在真正的程式前面，所以會讓 CLI 叫不動，或把 Codex 的平台命名路徑蓋掉",
      "按那一列的清除按鈕，清完要開一個新的終端視窗才會生效",
    ],
    diagnose: null,
  },
  // 這兩列沒有安裝按鈕：它們只是探針，壞了只回一個提醒，程式沒有東西可以幫他按。
  // 合併之後它們坐在整段第一張卡裡，所以自救步驟一定要寫出來——否則學生開場就卡在
  // 一句「檢查失敗」，而畫面上沒有任何可按的東西。
  // 這一列是「裝好了、看起來也對，但一跑就爆」，而且程式沒有東西可以幫他按——
  // 修法要離開嚮導自己動手，所以自救步驟一定要寫滿。
  //
  // 這一段拿掉過又加回來。8/11 拿掉的理由（「實測 Store 版底下沙箱正常」）是無效的
  // ——那次測的時候沙箱根本沒設定起來。8/12 把沙箱真的設定起來之後症狀立刻出現，
  // 完整的來龍去脈在 src/codex-sandbox.js 的檔頭。
  //
  // ⚠️ 這一列有一顆「換成一般安裝版」（8/12 加的，帶 --installer-type wix），但那顆
  // 不保證成功，所以文字要留一條學生自己走得完的退路。
  //
  // 八條砍成四條（Reed 指定）。拿掉的是：MSIX × 受限帳號為什麼互斥的機制、
  // `[windows] sandbox = "unelevated"` 那條繞過方案、上游 issue 編號。前兩者搬進
  // docs/returning-students.md，那是助教現場查的地方。
  //
  // ⚠️ unelevated 那條特別不能留在畫面上：它會**弱化沙箱**，而學生照做時不知道自己
  // 放棄了什麼。那是教室現場才該給的建議，不是一段自助說明。
  "pwsh-store": {
    symptom: "Codex 執行指令時噴 `CreateProcessAsUserW failed: 1920`（或 2）",
    expected: "那一列顯示「是一般安裝版」，或乾脆沒裝 PowerShell 7",
    checks: [
      "你的 PowerShell 7 是從 Microsoft Store 裝的，而 Codex 的沙箱叫不動那種版本——所以它改得了檔案、卻一個指令都執行不了",
      "按那一列的「換成一般安裝版」就會裝一份叫得動的 PowerShell 7（會跳一次系統的權限確認，要按同意）",
      "裝完在新視窗跑 `where.exe pwsh`，第一行要是 C:\\Program Files\\PowerShell\\7\\pwsh.exe 才算成功",
      "按鈕失敗的話可以自己來：到 https://aka.ms/PSWindows 下載 .msi 裝一份，落點一樣",
    ],
    diagnose: null,
  },
  "codex-sandbox": {
    symptom: "跑 Codex 時出現 `ShellExecuteExW failed to launch setup helper: 1223`",
    expected: "那一列顯示沙箱要用的檔案都在",
    checks: [
      "Codex 找不到它自己的沙箱輔助程式——PATH 上那條捷徑只指到 bin，找不到旁邊的資源目錄",
      "按那一列的修復鍵就會接好。接完第一次跑 Codex 會跳出「要設定哪種沙箱」，選第一個",
      "⚠️ 接著跳出來的 UAC 視窗要按「是」——**預設按鈕是「否」**，按到否就等於沒設定，而且畫面上不會有任何說明（那就是 1223，它的意思是「被取消」不是「找不到」）",
      "還是不行的話，把 Codex 移除重裝一次（用官方安裝檔，不要用 npm）",
      "這是 Codex 自己的已知問題（openai/codex #28278、#30829），不是嚮導裝壞了",
    ],
    diagnose: null,
  },
  // 上面那一列講「檔案接不接得上」，這一列講「設定做了沒」——兩件事各自一段自救。
  // 這一列有按鈕（開終端），所以重點不是「你要自己想辦法」，而是**按下去之後那個
  // 視窗裡要做什麼**：選單長什麼樣、UAC 那顆按哪個、怎麼知道成功了。
  "codex-sandbox-ready": {
    symptom: "合併或驗證時 Codex 一個指令都跑不動，或它每次都重問要設定哪種沙箱",
    expected: "那一列顯示沙箱已經設定好了",
    checks: [
      "Codex 的沙箱要先建兩個受限帳號才用得起來，而那只能由 Codex 自己來做",
      "按那一列的「開終端設定沙箱」，會開一個新視窗試著把沙箱跑起來",
      "那個視窗**直接印出 sandbox-ok** 就是成功了——帳號本來就在的話它什麼都不會問",
      "如果它跳出「要設定哪種沙箱」的選單，選 1（Set up default sandbox）再按 Enter",
      "⚠️ 接著跳出來的權限確認視窗要按「是」——**預設按鈕是「否」**，順手按 Enter 就等於取消，而且畫面上不會有任何說明（那就是 1223，它的意思是「被取消」不是「找不到」）",
      "設定好的那一刻嚮導就會自己往下走——不用關那個視窗，也不用按「重新檢查」",
      "上面那一列（沙箱要用的檔案）還是黃的話先修它——檔案接不上時，設定一定會失敗",
    ],
    diagnose: null,
  },
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
  // 這一列是退役，做的事是移除，所以自救說明講的是「按了還在怎麼辦」。
  hook: {
    symptom: "按了移除，這一列還在",
    expected: "這一列整個消失（沒裝過的人本來就看不到它）",
    checks: [
      "重按一次這一列的「重新檢查」——移除是即時的，但畫面要重查才會更新",
      "還在的話，手動刪掉 ~/.claude/hooks/block-chained-bash.js",
      "再打開 ~/.claude/settings.json，把 hooks 裡提到 block-chained-bash 的那幾行刪掉",
    ],
    diagnose: null,
  },
  "codex-monitor": {
    symptom: "按了移除，這一列還在",
    expected: "這一列整個消失（沒裝過的人本來就看不到它）",
    checks: [
      "重按一次這一列的「重新檢查」",
      "還在的話，手動刪掉 ~/.codex/hooks/codex-context-monitor.sh（Windows 是 .ps1）",
      "再打開 ~/.codex/hooks.json，把提到 codex-context-monitor 的那幾行刪掉",
    ],
    diagnose: null,
  },
  // 這是合併卡唯一的驗證，所以它的失敗有兩種來源，指引要同時涵蓋：
  // 標題留不住（同卡上一格的 wrapper 沒載入）、名字沒寫出來（這一格的 hook 沒跑）。
  //
  // ⚠️ 第一條講的是 wrapper。它排第一不是隨口——兩種失敗在畫面上長得一模一樣
  //（標題就是沒變），而 wrapper 那條的自救最簡單也最常中。
  "claude-namer": {
    symptom: "送出第一句話後，終端分頁標題沒有變",
    expected: "分頁標題會變成「emoji + 中文名稱」",
    checks: [
      "有沒有在**新開的**終端視窗啟動 Claude Code——舊視窗載不到這張卡寫進設定檔的那一段，標題留不住",
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
      "macOS / Linux：Codex 的 config.toml 有沒有設定 `terminal_title = [\"thread\"]`，app-server control socket 是否可連",
      "Windows：PowerShell profile 有沒有載入 Codex 共用 app-server wrapper，背景 app-server 是否在 127.0.0.1:4500",
    ],
    diagnose: null,
  },
  // ⚠️ 這一段以前寫的是「名字已經寫進同步檔，但終端分頁標題沒有動」——那是這一格
  // 觀察不到的症狀。它現在既不驗標題也不產生名字（標題那一半在同一張卡的下一格），
  // 講一個它看不到的現象，只會把學生推去查一條死路。
  //
  // 這一格自己的失敗只有一種形狀：那段設定寫進 rc 檔了，但新開的終端沒有載入它。
  "tab-sync": {
    symptom: "設定已經寫進 shell 設定檔，但新開的終端沒有載入它",
    expected: "新開的終端裡，claude 是一個 shell function（那段設定載進來了）",
    checks: [
      "有沒有關掉**所有**終端視窗再開一個新的——舊視窗不會重讀設定檔",
      "shell 設定檔裡那段 tab-sync 區塊還在不在",
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
      "macOS / Linux 與 Windows 都看 Codex 原生 terminal title；Windows 另確認背景 app-server 已啟動",
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
  unlockedSections = new Set(),
  overriddenSections = new Set(),
) {
  // 講師用萬用密碼開過的段：整段的鎖直接跳過，連算都不用算。放在最前面，因為它
  // 蓋掉的是「所有理由」——放在後面的話還要一條一條去減，減漏一條就等於沒開。
  if (overriddenSections.has(sectionId)) {
    return {
      locked: false,
      missing: [],
      previousPending: null,
      needsPasscode: false,
      reason: "",
    };
  }

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
  //
  // 選配的段自己不擋人，也不會擋住排在它後面的段——筆記那段排在 demo 前面之後，
  // 不濾掉的話「沒做選配的筆記」就會把 demo 鎖住，而那一段本來就可做可不做。
  const previousPending = OPTIONAL_SECTIONS.has(sectionId)
    ? null
    : SECTIONS.slice(0, index)
        .filter((section) => !OPTIONAL_SECTIONS.has(section.id))
        .find((section) => sectionDone[section.id] !== true) ?? null;
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

  // 當日密碼是最後一道，而且跟前面那幾道並存（Reed 拍板）：前面沒做完照樣要做完，
  // 密碼只是再加一層「今天才開」。
  //
  // needsPasscode 只在「其他理由都清掉了、只差密碼」時才是 true。前面還沒做完就先
  // 彈密碼框的話，學生打對了數字還是進不去，那個彈窗等於在騙他。
  const needsPasscode =
    SECTION_PASSCODES[sectionId] !== undefined &&
    !unlockedSections.has(sectionId);

  if (needsPasscode) {
    reasons.push("輸入講師當天報的密碼");
  }

  return {
    locked: reasons.length > 0,
    missing,
    previousPending,
    needsPasscode: needsPasscode && reasons.length === 1,
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
    // ⚠️ tab-sync 從 shared 搬過來（2026-08-21）。它從來就不是共用的：
    // stepsForTools 只在選了 claude 的時候才發這一步（config-install.js:285），
    // Codex 的命名走原生 app-server，根本沒有這張卡。
    //
    // 掛在 shared 有兩個實際後果：一是 agentForCheck 回 null，合併按鈕只能靠
    // viewmodel 那段 fallback 猜是誰在跑；二是它被分到「兩邊共用」那張卡，而
    // mergeCardChecks 是在**同一張卡的 checks 裡**合併——不搬過來，它跟
    // claude-namer 永遠碰不到彼此，合併卡就成立不了。
    "tab-sync",
  ]),
  codex: new Set([
    "codex-config",
    "codex-agents",
    "codex-namer",
    "codex-monitor",
  ]),
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
    // ⚠️ 這裡曾經有第三張「兩邊共用」。它只裝過一個成員（tab-sync），而那一個
    // 其實是 Claude 專屬的——搬回 Claude 那組之後這張卡沒有成員了，留著只會多一個
    // 永遠被 checks.length > 0 濾掉的定義。
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
  // 排在整段最前面（見 ENV_FIRST）。這一列只在真的有東西不是學生的時候才出現，
  // 而它一出現就代表後面每一顆按鈕都會撞到同一件事——排在後面的話，學生會照順序
  // 一路按下去，每一張卡各噴一次 permission denied，看起來像五個毛病。
  "home-perms": {
    agent: "other",
    label: "把被鎖住的設定檔改回你的",
    logo: "logo-terminal",
    description:
      "你家目錄裡有幾樣東西現在屬於系統管理員，你的帳號改不動——多半是先前某個帶 sudo 的指令留下的。這張把它們改回你自己的，後面的登入與設定才寫得進去",
  },
  "shell-wrapper": {
    agent: "other",
    label: "清掉上一輪留下的舊捷徑",
    logo: "logo-terminal",
    description:
      "上過課的機器可能同時留著 Claude 與 Codex 的舊捷徑，會讓 CLI 叫不動或蓋掉分頁標題。這張把它清掉",
  },
  // 跟上面那張同一個性質、同一段時機：都是「上一輪留下的東西擋著這一輪」。
  // 兩張都排在 CLI 之前（見 ENV_FIRST），不然學生會先裝完再發現裝的那支叫不到。
  "legacy-npm-cli": {
    agent: "other",
    label: "清掉上一輪 npm 裝的舊版",
    logo: "logo-terminal",
    description:
      "上一輪是用 npm 裝的，這次改用官方安裝器。兩份並存的話會搶著被叫到，這張處理掉",
  },
  // 隔離區原本掛在上面那張卡上，理由是「同一件事的後半段」。VM 實測之後拆出來
  // （Reed 指定），因為那張卡的標題在說謊：隔離區裝的是**兩顆**按鈕搬進去的東西，
  // 掛在其中一顆的卡上，另一半沒有名分——畫面上那 13 條裡就有一條是舊 skill。
  //
  // 還有兩個一起壞掉的地方：那張卡右上角寫「已完成」，底下卻還有一顆刪掉回不來的
  // 按鈕；而 13 條清單佔滿整張卡，其中九成跟卡片標題無關。
  //
  // 排在整段最後：它不在 ENV_FIRST 裡，agent 又是 other（AGENT_ORDER 的最後一個），
  // 所以自然落在尾巴。時機也對——它只在該清的都清完之後才存在，那時學生本來就
  // 走到段落尾端，多一站是往前走不是打斷。
  // 收尾那張卡的三種開頭。⚠️ 這三筆的內容要一致——它們是同一張卡，差別只在「這台
  // 機器上第一列是誰」。
  //
  // 為什麼要三筆：合併卡片的機制是拿「沒被合併掉的那個 id」去查這張表，所以 key 一定
  // 要是 checkIds 的第一個。而這三列各自可能不存在：
  //
  //   npm-leftover    隔離區的 npm-cli 分區有東西才會有（兩個平台都可能）
  //   brew-leftover   brew-cli 分區才有（實務上只有 mac）
  //   quarantine      只要搬過東西就有
  //
  // 少了這三筆的其中一筆，那台機器上的收尾卡就會退回機器寫的預設標題，或者更糟——
  // 第二列被藏起來卻沒有主人帶它出場（守門測試盯著這件事）。
  "npm-leftover": {
    agent: "other",
    label: "收尾：清掉留下來的東西",
    logo: "logo-terminal",
    checkIds: ["npm-leftover", "brew-leftover", "quarantine"],
    description:
      "前面那幾顆清理鍵只把東西搬走。這張把它們真的收完：套件管理器那邊要各跑一次卸載（不做的話捷徑會被建回來），搬走的備份則是刪不刪都可以",
  },
  // brew 那批的收尾跟隔離區清理擺同一張卡，兩列各一顆按鈕（Reed 拍板）。
  //
  // 為什麼不各自一張卡：兩者都是「這一段的收尾」，拆開會讓 mac 學生的里程碑比
  // Windows 多一站，兩邊進度看起來不一樣。為什麼不合成一顆按鈕：兩個都是不可逆的
  // 動作，綁在一起學生沒辦法只做其中一件。
  //
  // ⚠️ 順序是 brew 在前、刪備份在後，而且不能反過來：刪備份那顆會把隔離區清空，
  // 而 brew 這一步萬一失敗，那份備份就是唯一還原得回去的東西。
  //
  // ⚠️ 這一筆的 key 是 brew-leftover（checkIds 的第一個），不是 quarantine——
  // flattenCheckCards 是拿「沒被合併掉的那個 id」去查 ENV_CARD_META 的。Windows 上
  // brew-leftover 這一列根本不存在，那時底下 quarantine 那一筆自己會生成卡片。
  "brew-leftover": {
    agent: "other",
    label: "收尾：清掉留下來的東西",
    logo: "logo-terminal",
    checkIds: ["brew-leftover", "quarantine"],
    description:
      "前面那幾顆清理鍵只把東西搬走。這張把它們真的收完：Homebrew 那邊要跑一次卸載（不做的話連結會被裝回來），搬走的備份則是刪不刪都可以",
  },
  quarantine: {
    agent: "other",
    label: "清掉搬走的備份",
    logo: "logo-terminal",
    // ⚠️ 描述要自己講清楚「這張是可選的」。這一列是綠燈、卡片右上角也寫「已完成」，
    // 但底下的文案說「還留著」——三個訊號互相打架，Reed 自己看到都要問一次「所以
    // 清掉了沒」。學生更會。所以把「刪不刪都算完成」直接寫在最顯眼的那一行。
    description:
      "前面那兩顆清理鍵是「搬走」不是「刪掉」，東西還在隔離區裡。這張是可選的收尾——刪或不刪都不影響這張卡的完成",
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
    // 沙箱那一列跟著 Codex 走：它問的是「這支 codex 待會兒跑得起來嗎」，
    // 跟裝了沒、登入了沒是同一張卡上的三個面向。Windows 才有那一列。
    // ⚠️ 沙箱**兩列都要列在這裡**。沒登記的那一列會自己長成一張卡，標題走預設模板
    // ——「準備 Codex 沙箱設定好了，讓後面的課堂步驟可以正常進行。」，讀起來像機器
    // 寫的。拆成兩列那次就漏了一次，現在有守門測試擋（test/sections.mjs）。
    checkIds: [
      "codex",
      "codex-auth",
      "codex-sandbox",
      "codex-sandbox-ready",
      "codex-legacy-skills",
    ],
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
    // ⚠️ 不要寫死幾件事。選了 Codex 才會多出 pwsh-store 那一列（見
    // env-check.js 的 TOOL_ONLY_CHECKS），所以這張卡是四列或五列都可能——
    // 寫「四件事」的話，選了 Codex 的學生會看到卡片說四件、清單五列（VM 實測）。
    description:
      "先確認這台機器本身準備好了：願意跑課堂指令、終端機視窗是對的、版本夠新、中文不會變亂碼。後面每一步都站在這上面",
    checkIds: [
      "execution-policy",
      "windows-terminal",
      "powershell-version",
      "powershell-encoding",
      // Store 版那一列也在這張：光看路徑就判得出來，而它會讓後面的 Codex 沙箱
      // 起不來。放這裡等於「機器本身的毛病一次講完」。
      "pwsh-store",
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
  // 選用：這張卡不裝也算完成（那一列是 optional 燈）。放進來的理由是今天最花時間的
  // 不是操作而是「把需求講清楚」——用講的，學生會講得比打得完整。
  //
  // ⚠️ 描述裡一定要講「裝完要自己開一次授權」：安裝指令跑完 App 還不能用，
  // 沒講的話學生會以為壞掉。
  typeless: {
    agent: "other",
    label: "用講的代替打字（選用）",
    logo: "logo-terminal",
    description: "裝完自己開一次 Typeless 授權麥克風，之後長 prompt 用講的就好",
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
  // 已退役。auto mode 底下每一條指令都會被逐一審查，串接不再是問題——這支留著只會
  // 擋掉正常的指令。這張卡只有「以前裝過的人」看得到。
  hook:
    "這支已經退役了：以前它擋下把好幾個指令串成一串跑，是因為白名單逐個子指令比對、" +
    "串起來就對不上。現在改成 auto mode 逐一審查，留著只會擋掉正常的指令。按一下把它移除",
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
  // 已退役。這張卡只有「以前裝過的人」看得到，做的事是移除。
  "codex-monitor":
    "這支已經退役了：它會在對話快滿時叫你收尾、去開新的一輪。但 Codex 現在把可用的" +
    "容量收小，快滿時在同一個對話裡壓縮一下就能接著做——照它說的去開新對話，反而是" +
    "把還用得到的脈絡丟掉。按一下把它移除",
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
// 目前只有一張：分頁自己報上名字（wrapper + 命名 hook 的合併卡）。它把那段
// wrapper 寫進 shell profile，之後每個新開的終端標題才留得住。後面 auto-rename、
// handoff 那幾張 skill 都要學生「看標題有沒有變」，沒先裝這張就永遠看不到——
// 不是 skill 壞了，是根本沒人在聽（VM 實測：PowerShell profile 檔案不存在，
// 標題自然一直是預設值）。
//
// 舊版一頁攤開所有列，靠驗收文件提醒順序；改成強制線性流程之後，順序錯了就是
// 把學生推進一個必然失敗的驗證。
//
// 筆記那段的三張也在這裡：那張「接到 GitHub 的筆記庫」的操作步驟第三步要學生
// 叫 AI 存一次，skill 沒先裝好的話那一步叫不動。
const SETUP_FIRST = [
  // ⚠️ 這裡寫的是**合併卡的主 check**，也就是 MERGE_ORDER 的最後一個。
  // setupOrder 查的是 card.checkId，而合併之後那個 id 從 tab-sync 變成 claude-namer
  // ——沒跟著換的話查不到，整張卡靜靜掉到這一段的最後面。
  "claude-namer",
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
// GitHub 排在很前面是**回報管道**的需求，不是課程需求（Reed 拍板）。
//
// 「這一頁卡住了」那顆鈴鐺走的是 `gh issue create --body-file`——沒有長度限制、
// 不必管金鑰、而且用學生自己的身分開 issue，助教可以直接在下面問他。代價是它要
// gh 已裝已登入，所以那張卡必須排在「會出事的那些卡」前面。
//
// ⚠️ 但排不到最前面：執行原則（Windows）與終端機（mac）是真正的前置——執行原則還是
// Restricted 的話，後面每一支我們寫出來的腳本都跑不起來，包含裝 gh 那一步自己。
// 所以順序是「機器本身 → GitHub（回報管道）→ 清掉舊的 → CLI」。
const ENV_FIRST = [
  // ⚠️ 排在所有東西之前。這一張不是「一個項目」，是後面每一顆按鈕的前提：家目錄裡
  // 那幾樣不是學生的時候，登入存不進去、規則檔寫不進去、PATH 也加不上（實際回報
  // museReed/jr-setup-feedback#6：同一台機器上 gh 與 .zshrc 兩張卡各壞一次）。
  "home-perms",
  "execution-policy",
  "ghostty",
  "git",
  "legacy-npm-cli",
  "shell-wrapper",
];

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
  // ⚠️ key 跟著 MERGE_ORDER 的**最後一個**走，沒跟著換的話整張卡的標題與說明會
  // 靜靜退回單列的預設值（改過兩次，兩次都差點漏掉這件事）。
  // 這張卡現在是 ["allowlist", "hook"]，所以 key 是 hook。
  // 這張卡以前是「白名單 + 擋串接 hook」兩列合併。hook 退役之後只剩白名單一列，
  // 但標題留著——學生要的答案還是同一個問題：它什麼時候該停下來問你。
  allowlist: {
    label: "它什麼時候該停下來問你",
    // 分兩層講，因為它們解決的是兩件不同的事：
    //
    //   auto mode  誰來判斷「這條指令安不安全」——從你變成一個審查模型
    //   白名單     哪些指令連判斷都不用等——最高頻的那幾條直接放行
    //
    // 合成一句「常用指令不用每次問你」的話，學生會以為這一步就是那份清單，而真正
    // 改變他體感的是模式。反過來只講模式也不對：他會納悶為什麼 ls 是瞬間的、
    // 別的指令要停半秒。
    detail:
      "兩層一起設：預設模式改成 auto，由 Claude 自己判斷每一條指令安不安全，" +
      "危險的擋下來、安全的直接跑；另外加一份 39 條的常用指令清單，" +
      "這幾條連判斷都不用等。裝好之後會開一個真的終端試給你看",
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
  // ⚠️ key 是 claude-namer，跟著 MERGE_ORDER 的最後一個走。改順序沒跟著換的話，
  // 整張卡的標題與說明會靜靜退回單列的預設值（上面那條註解警告過兩次的坑）。
  //
  // 標題講成果，不講 wrapper：學生要的答案是「我怎麼認得出哪個視窗在做什麼」。
  // 兩格裝的東西不同，但對他來說是一件事，所以說明也只講一件事。
  "claude-namer": {
    label: "分頁自己報上名字",
    detail:
      "兩份一起裝：一份讓終端的分頁標題留得住，一份決定標題寫什麼。" +
      "裝好之後你講第一句話，分頁標題就變成這次在做的事——開十個視窗也認得出" +
      "哪個在做什麼。最後會開一個真的終端驗給你看，要跑一分多鐘",
  },
};

// 合併之後，同一張卡的 checks 依「安裝順序」排，最後那個帶驗證。
const MERGE_ORDER = {
  "output-style": ["claude-md", "output-style"],
  "codex-config": ["codex-agents", "codex-config"],
  // 分頁報上名字（rc 檔那段 wrapper）與對話自己取名字（命名 hook）是同一件事的
  // 兩半：wrapper 讓標題留得住，hook 決定標題寫什麼。少一半，學生看到的都是
  // 「標題沒動」。
  //
  // 分兩張卡的代價是一個繞不開的順序相依，而它換過方向兩次都沒消失：
  //
  //   ~8/20   tab-sync 驗標題 → 需要下一張才裝的命名腳本（每個人必撞，d474acf 止血）
  //   8/21 後 tab-sync 只驗 wrapper → claude-namer 的人眼判定反過來需要前一張的 wrapper
  //
  // 合併之後那個相依不再是相依，是同一張卡的兩格；驗證也終於驗得到學生在意的
  // 成果（標題真的變成這次在做的事），而不是「wrapper 載入了」這種中間狀態。
  //
  // ⚠️ 這是第一張跨 kind 的合併卡：tab-sync 的 kind 是 "tab-sync"（Windows 還要
  // 複製一支 watcher），claude-namer 是 hook。mergeCardChecks 只看 id 不看 kind。
  "claude-namer": ["tab-sync", "claude-namer"],
  // 白名單與擋串接寫的是同一個檔案（~/.claude/settings.json），講的也是同一件事：
  // 它什麼時候該停下來問你。分兩張卡的話學生會以為是兩個無關的設定，而其中一張
  // （白名單）的實際效果——連改檔案都不再問——根本沒出現在標題上（Reed 拍板合併）。
  //
  // ⚠️ 這一組的順序改過兩次，理由各自不同，所以兩次都寫下來：
  //
  //   最初      allowlist 在後  「合併卡的驗證掛在最後那一份身上，而只有 hook 有驗證」
  //   後來      hook 在前        講解順序：先看到被攔下來，再看什麼情況不會攔
  //   2026-08-12 allowlist 在前 （Reed 在 VM 上看著畫面指定）
  //
  // 第一個理由早就不成立了：白名單現在也有自己的行為驗證，兩格各有各的按鈕
  // （app.js 的 perRowVerify），驗證不再靠排序決定掛在誰身上。
  //
  // ⚠️ 換順序**一定要連 MERGED_CARDS 的 key 一起換**——它跟著最後那一個走，忘了換
  // 整張卡的標題與說明會靜靜退回單列的預設值。
  //
  // ⚠️ 2026-08-21：這一組解散了。擋串接那支 hook 退役之後，這張卡只剩白名單一列，
  // 而合併的意義本來就是「兩份設定是同一件事」——只剩一份就沒有東西要合。
  // MERGED_CARDS 的 key 跟著搬到 allowlist（那個註解警告過兩次的坑，這次記得了）。
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

// 合併完之後，哪幾步的驗證結論要作廢。
//
// 這是 C1「每個 action 宣告它讓哪份資料失效」在這條分支上唯一真的成立的地方：
// CLAUDE.md 合併之後，同一張卡那個「問一次 Claude 看它怎麼回」的行為驗證就不算數
// 了——它驗的正是 Claude 讀完 CLAUDE.md 之後的行為。不作廢的話，畫面上會留著一個
// 合併前跑出來的綠勾（Reed 在 VM 上看到的）。
//
// 連自己那一步一起回傳：合併本身也可能有驗證（之後加的話不必再改這裡）。
export function mergeInvalidates(stepId, checks = []) {
  const order = Object.values(MERGE_ORDER).find((ids) => ids.includes(stepId));

  if (order === undefined) {
    return [stepId];
  }

  const byId = new Map(checks.map((check) => [check.id, check]));

  return order.filter((id) => id === stepId || byId.has(id));
}

// 同一張卡上還有沒有「等著合併」的另一份。有的話不能自動驗證。
//
// nextInstallStep 只等「還沒裝」的那幾份，等不到「等合併」的——protectExisting 的列
// 按安裝不會覆蓋，它要的是學生按「用 AI 合併」。於是流程變成：CLAUDE.md 說「已有你
// 自己的版本」→ 接著裝 output-style → **馬上驗行為**（Reed 在 VM 上看到的）。
//
// 那次驗證驗的是一個半完成的狀態：行為驗證是真的問一次 Claude，而它怎麼回同時受
// output-style 與 CLAUDE.md 影響。現在過了不代表合併完還會過，而且那一輪要跑一分多鐘
// 又燒 token——卡片自己還會叫學生「合併完再按重跑驗證」，等於同一件事做兩次。
export function pendingMergeSibling(stepId, checks = []) {
  const order = Object.values(MERGE_ORDER).find((ids) => ids.includes(stepId));

  if (order === undefined) {
    return null;
  }

  const byId = new Map(checks.map((check) => [check.id, check]));

  return (
    order
      .map((id) => byId.get(id))
      .find((check) => check !== undefined && check.needsMerge === true) ?? null
  );
}

// ⚠️ 這裡曾經有 nextInstallStep：裝完一份自動接著裝同一張卡的另一份。拿掉了
//（Reed 指定）——每一格現在都有自己的安裝鍵（app.js 那段 perRowInstall），一顆按鈕
// 只做它那一格的事。代價是兩份都要裝的卡學生要按兩次，那是刻意的。

// ⚠️ 這裡曾經有 pendingVerifySteps：一張卡裝完之後，整張卡的驗證依序排隊跑。
//
// 它是 8/12 那個 bug 的解——當時裝完接驗證用的是「剛裝完的那一份」，而合併卡會自動
// 依序裝兩份，所以第一份的驗證從來沒被觸發過。
//
// 自動接力拿掉之後這個問題自己消失了：一顆安裝鍵只裝一格，接的驗證就是那一格
//（app.js 的 justInstalled）。排隊那套留著反而會在「只裝了一格」的時候跑去驗另一格。

export function flattenCheckCards(groupedSections, envChecks = []) {
  const envChecksById = new Map(envChecks.map((check) => [check.id, check]));
  const mergedCheckIds = new Set(
    // ⚠️ 只有「主人真的在」的時候才把跟班藏起來。
    //
    // 原本是無條件藏：只要哪張卡登記了 checkIds，後面那幾個 id 就永遠不會自己
    // 生成卡片。brew 收尾那張把 quarantine 收成第二列之後，這件事立刻咬人——
    // Windows 上根本沒有 brew-leftover 那一列，於是 quarantine 被藏起來、又沒有
    // 主人帶它出場，**整張「清掉搬走的備份」就消失了**（守門測試當場抓到）。
    Object.entries(ENV_CARD_META).flatMap(([primaryId, { checkIds = [] }]) =>
      envChecksById.has(primaryId) ? checkIds.slice(1) : [],
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
