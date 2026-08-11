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
}) {
  const clean = (value) => redact(String(value ?? ""), home);

  const lines = [
    "## 發生什麼事",
    "",
    "（請在這裡寫一兩句：你按了什麼、期待看到什麼、實際看到什麼）",
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
