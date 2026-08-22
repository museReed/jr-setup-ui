// 「這一頁卡住了」的回報內容。
//
// 送去哪裡：一個獨立的公開 repo，不是 jr-setup-ui 本身。主 repo 之後要轉 private，
// 而 private repo 的 issue 非協作者開不了——回報管道跟原始碼綁在一起的話，轉那天
// 學生就沒地方講話了。
// ⚠️ repo 名字的權威在 src/report-issue.js（真正去開 issue 的那一支）。這裡不再
// 匯出，免得兩邊各寫一份、改了一邊沒改另一邊。

// ⚠️ B1（「鈴鐺網址過長」）的結論：**不要用網址送**。
//
// 量出來的根因是中文 percent-encoding 一個字變九個字元（`中` → `%E4%B8%AD`，
// 實測 9.0 倍）。舊做法留 3000 個字元的 log，編碼後是 27000 字元，而 GitHub 實務上
// 8k 左右就回 414——我們的 log 幾乎全是中文，所以基本上送不出去。
//
// 可以把預算改成「編碼後長度」硬擠，但那只是把問題變小：學生最需要回報的時候
// （winget 噴了一大坨）正是 log 最長的時候，擠進去的那份反而缺了關鍵段落。
//
// 所以改走 `gh issue create --body-file`（Reed 拍板）：讀檔案、沒有長度限制、
// 不必在學生端放任何金鑰、而且用他自己的身分開 issue，助教可以直接在下面問他。
// 代價是 gh 要先裝好登入好——所以那張卡被排到很前面（見 model.js 的 ENV_FIRST）。
//
// 這裡因此**沒有任何截斷邏輯**。log 多長就送多長。

// 家目錄要換成 ~。學生的使用者名稱常常是本名（C:\Users\Reed Chen），而這份東西
// 會被貼到一個公開的 issue 上。
//
// 換的是「看得到的那幾種寫法」：正斜線、反斜線、以及 JSON 逃脫過的雙反斜線。
// gh 那條路走不通時的退路。
//
// ⚠️ 這個網址**只帶標題，不帶內容**——內容走剪貼簿。上面那段講的長度問題只發生在
// 「把 log 塞進網址」，標題是一行字，編碼後仍然很短，沒有這個問題。
//
// 為什麼這條退路必要：`gh issue create` 要 CLI 登入，而那是整條安裝路上最難的一關
// ——學生最可能卡住的時候，正是他還沒過那一關的時候。瀏覽器的 GitHub 登入多數人
// 早就有了，所以「複製 + 貼上」到得了的地方，比 gh 早得多。
//
// repo 名字在這裡與 src/report-issue.js 各有一份。那支是真正去開 issue 的，權威在
// 它；這裡只組一個給人點的網址，兩邊要一起改。
const FEEDBACK_REPO = "museReed/jr-setup-feedback";

// 最後一條退路：寄信給助教。
//
// GitHub 開 issue 一定要帳號並且登入——沒有匿名這回事。所以「還沒有 GitHub 帳號」
// 或「登入牆卡住了」的學生，前面兩條路都走不到底，而他正是最需要有人幫的那個。
//
// ⚠️ mailto 只帶主旨，**不帶內文**——理由跟檔頭那段預填網址完全一樣：網址有長度
// 上限，而中文 percent-encoding 一個字變九個字元。學生最需要回報的時候正是 log 最
// 長的時候，硬塞進去的那份反而缺了關鍵段落。內文一律走剪貼簿。
// 三個收件人一起收，不是只寄給一個人。
//
// 這條退路的使用者是「前面兩條都走不到底」的學生——最需要有人回他的那個。寄給單一
// 信箱的話，那個人沒空看就沒有第二個人知道；課堂當下等不到回音，學生就卡在那裡。
//
// ⚠️ 用逗號串、**中間不留空白**。mailto 的多收件人以逗號分隔（RFC 6068），而空白
// 在網址裡必須 percent-encode——留了空白就得多一層編碼，而這個字串同時還要當成
// 「畫面上給學生手抄／複製的那一行」。不留空白，兩種用途共用同一份就都對。
export const FEEDBACK_EMAILS = [
  "devlab20230424@gmail.com",
  "jimbo.90015@gmail.com",
  "muse.reed.hsin@gmail.com",
];

export const FEEDBACK_EMAIL = FEEDBACK_EMAILS.join(",");

export function mailtoUrl(title) {
  const subject =
    typeof title === "string" && title !== "" ? title : "jr-setup 卡住了";

  return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}`;
}

// ⚠️ body 帶的是**一行提示，不是 log**。
//
// 「內容在剪貼簿裡，請貼上」這句話原本只寫在嚮導的框裡——而學生按下按鈕之後人就在
// GitHub 那個分頁了，回頭看不到那句話。他看到的是一個標題填好、內文全空的表單，
// 合理的結論是「按鈕壞了」（Reed 實測第一個反應就是這個）。
//
// 提示要跟著他走，所以放進表單本身。一行字編碼後仍然很短，跟檔頭那段講的「把 log
// 塞進網址」是兩回事——那個坑是長度，這裡沒有長度問題（下面的測試釘住 500 字元）。
//
// 寫成 Markdown 的 HTML 註解：在編輯框裡看得到，送出之後**渲染不出來**。所以不必
// 叫學生「再刪掉這一行」——那是多的一步，而且忘了刪的話 issue 開頭就掛著一句對助教
// 沒有意義的話。它的行為就是一個 placeholder，只是 GitHub 的 placeholder 沒辦法從
// 網址設定，只能用這個方式做到同一件事。
//
// 尾巴留兩個換行：學生點進框通常是點到最後，游標就已經在下一行，貼上去不會跟提示
// 黏成一行。
const PASTE_HINT = "<!-- 把剛才複製的內容貼在這裡（Ctrl+V／⌘V） -->\n\n";

export function newIssueUrl(title) {
  const params = new URLSearchParams({ body: PASTE_HINT });

  if (typeof title === "string" && title !== "") {
    params.set("title", title);
  }

  return `https://github.com/${FEEDBACK_REPO}/issues/new?${params}`;
}

export function redact(text, home) {
  if (typeof text !== "string") {
    return "";
  }

  if (typeof home !== "string" || home.length < 3) {
    return text;
  }

  const forms = [
    home,
    home.replaceAll("\\", "/"),
    home.replaceAll("/", "\\"),
    home.replaceAll("\\", "\\\\"),
  ];
  let out = text;

  for (const form of new Set(forms)) {
    out = out.split(form).join("~");
  }

  return out;
}

// issue 的標題。帶上卡片名字，助教一眼看得出是哪一步——那正是分類第一件要做的事。
export function issueTitle(card) {
  return `[嚮導] ${card?.label ?? "某一張卡"} 卡住了`;
}

// issue 的內容。
//
// 第一段是留給學生自己寫的，而且擺在最上面：他打開頁面第一眼看到的就是「請描述」，
// 不是一大坨 log。log 放前面的話多數人會直接按送出，我們拿到一份沒有人話的報告。
export function issueBody({
  card,
  platform = "",
  source = "",
  status = "",
  log = "",
  sections = null,
  home = "",
  description = "",
}) {
  const clean = (value) => redact(String(value ?? ""), home);
  const written = clean(description).trim();

  const lines = [
    "## 發生什麼事",
    "",
    // 選填。沒寫的話留一句話講明「他沒寫」，而不是留一段空白——助教看到空白會
    // 以為是嚮導漏掉了，看到這句才知道要自己去問。
    written === "" ? "（學生沒有補充，請看下面的原始輸出）" : written,
    "",
    "## 這一步",
    "",
    `- 卡片：${clean(card?.label ?? "")}`,
    `- 狀態：${clean(status)}`,
    `- 平台：${clean(platform)}`,
    `- 嚮導來源：${clean(source)}`,
  ];

  if (sections !== null) {
    lines.push(
      "",
      "## 段落狀態",
      "",
      "```json",
      clean(JSON.stringify(sections, null, 2)),
      "```",
    );
  }

  lines.push(
    "",
    "## 這一張卡的原始輸出",
    "",
    "```",
    clean(log).trimEnd() || "（這一張卡還沒有輸出）",
    "```",
    "",
    "---",
    "",
    "> 這份內容是嚮導幫你整理的，送出之前可以自己改。家目錄已經換成 `~`，但還是",
    "> 看一眼有沒有你不想公開的東西。",
  );

  return lines.join("\n");
}

// 要送出去的那一份。標題與內容都在這裡定案，交給 gh 去開 issue。
export function buildIssue(input) {
  return { title: issueTitle(input.card), body: issueBody(input) };
}
