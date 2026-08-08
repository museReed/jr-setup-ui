// 「這一頁卡住了」的回報內容。
//
// 送去哪裡：一個獨立的公開 repo，不是 jr-setup-ui 本身。主 repo 之後要轉 private
//（見 docs/go-private-checklist.md），而 private repo 的 issue 非協作者開不了——
// 回報管道跟原始碼綁在一起的話，轉那天學生就沒地方講話了。
export const FEEDBACK_REPO = "museReed/jr-setup-feedback";

// 網址長度是有極限的。GitHub 自己沒有明說，實務上 8k 左右就會被伺服器擋掉（414），
// 而原始輸出動不動就上萬字（winget 的轉圈符號一次就好幾百行）。
//
// 砍尾巴不砍頭：問題通常發生在最後，而開頭那幾行是「平台、Node 版本、嚮導來源」
// ——那三行對判斷問題最有用，所以另外抽出來放在最前面。
const MAX_LOG_CHARS = 3000;

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

// 只留最後那幾千字，並且講清楚被砍了。
//
// 不講的話，讀 issue 的人會以為那就是全部——而「前面沒有錯誤訊息」跟「前面被砍掉了」
// 是兩個完全不同的結論。
export function tail(text, limit = MAX_LOG_CHARS) {
  const value = typeof text === "string" ? text : "";

  if (value.length <= limit) {
    return value;
  }

  const cut = value.length - limit;
  return `…（前面 ${cut} 個字被截掉了，完整內容請按卡片上的「複製診斷資料」）\n${value.slice(-limit)}`;
}

// issue 的標題。帶上卡片名字，助教一眼看得出是哪一步——而那正是分類第一件要做的事。
export function issueTitle(card) {
  return `[嚮導] ${card?.label ?? "某一張卡"} 卡住了`;
}

// issue 的內容。
//
// 第一段是留給學生自己寫的，而且擺在最上面：他打開頁面第一眼看到的就是「請描述」，
// 不是一大坨 log。原本把 log 放前面的話，多數人會直接按送出，我們拿到一份沒有人話
// 的報告。
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
    tail(clean(log)).trimEnd() || "（這一張卡還沒有輸出）",
    "```",
    "",
    "---",
    "",
    "> 這份內容是嚮導幫你整理的，送出之前可以自己改。家目錄已經換成 `~`，但還是",
    "> 看一眼有沒有你不想公開的東西。",
  );

  return lines.join("\n");
}

// 預先填好的 issue 網址。
//
// ⚠️ 只是打開一個頁面，不會替學生送出。內容長什麼樣他在 GitHub 自己的畫面上看得到，
// 確認了才按送出——log 不會在他不知情的情況下被發佈（這是刻意選的，不是省事）。
export function issueUrl(repo, title, body) {
  const params = new URLSearchParams({ title, body });
  return `https://github.com/${repo}/issues/new?${params.toString()}`;
}
