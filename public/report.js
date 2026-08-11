// 「這一頁卡住了」的回報內容。
//
// 送去哪裡：一個獨立的公開 repo，不是 jr-setup-ui 本身。主 repo 之後要轉 private，
// 而 private repo 的 issue 非協作者開不了——回報管道跟原始碼綁在一起的話，轉那天
// 學生就沒地方講話了。
export const FEEDBACK_REPO = "museReed/jr-setup-feedback";

// ⚠️ 這一段是 B1 的全部重點。
//
// 舊的做法是「log 只留最後 3000 個**字元**」。看起來很保守，實際上送不出去：
// 中文用 percent-encoding 一個字變九個字元（`中` → `%E4%B8%AD`，實測 9.0 倍）。
// 3000 個中文字編碼後是 27000 字元，而 GitHub 實務上 8k 左右就回 414。
// 我們的 log 幾乎全是中文，所以「基本上送不出去」。
//
// 判準改成**編碼後的長度**，而且抓的是整條網址而不是 log 本身——標題、段落狀態、
// 那幾行平台資訊都要一起算進去，不然湊起來還是會爆。
const MAX_URL_CHARS = 6000;

export function encodedLength(text) {
  return encodeURIComponent(text ?? "").length;
}

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

// 砍尾巴不砍頭：問題通常發生在最後。
//
// budget 是**編碼後**能用的字元數。用二分搜尋找「留幾個字剛好塞得下」——逐字加的話
// 一萬行的 log 會跑很久，而這支是按下鈴鐺當下同步跑的。
export function tailWithin(text, budget) {
  const value = typeof text === "string" ? text : "";

  if (value === "" || encodedLength(value) <= budget) {
    return value;
  }

  // 先確認「連提示都放不下」的極端情況。放不下就整段不送——送一個只有提示沒有內容
  // 的 log 只是浪費那幾千字元。
  const notice = (cut) =>
    `…（前面 ${cut} 個字被截掉了，完整內容請按卡片上的「複製診斷資料」）\n`;

  if (encodedLength(notice(value.length)) >= budget) {
    return "";
  }

  let low = 0;
  let high = value.length;

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = notice(value.length - mid) + value.slice(-mid);

    if (encodedLength(candidate) <= budget) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return low === 0 ? "" : notice(value.length - low) + value.slice(-low);
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

// 預先填好的 issue 網址。
//
// ⚠️ 只是打開一個頁面，不會替學生送出。內容長什麼樣他在 GitHub 自己的畫面上看得到，
// 確認了才按送出——log 不會在他不知情的情況下被發佈（這是刻意選的，不是省事）。
export function issueUrl(repo, title, body) {
  const params = new URLSearchParams({ title, body });
  return `https://github.com/${repo}/issues/new?${params.toString()}`;
}

// 一定送得出去的那一份。
//
// 做法是「先算沒有 log 的那條網址有多長，剩下的才是 log 的預算」——標題、段落狀態、
// 平台那幾行都是固定成本，先扣掉才不會湊起來爆掉。
export function buildIssue(input, { repo = FEEDBACK_REPO, limit = MAX_URL_CHARS } = {}) {
  const title = issueTitle(input.card);
  const withoutLog = issueBody({ ...input, log: "" });
  const budget = limit - issueUrl(repo, title, withoutLog).length;
  const log = tailWithin(redact(String(input.log ?? ""), input.home ?? ""), budget);
  const body = issueBody({ ...input, log, home: "" });

  return { title, body, url: issueUrl(repo, title, body) };
}
