// 導覽的「要不要講、講什麼」全部在這裡，而且完全不碰 DOM，才測得起來。
// 真正畫泡泡的是 tour.js（它才 import driver）。
//
// 分成兩種，因為頁面同一時間只有一張卡在 DOM 裡（renderCard 每次都重畫一張
// article）。把每張卡排成 driver 的一連串 steps 會在第二步就指到已經被丟掉的
// 元素——所以：
//
//   A 版面導覽：只指不會被重畫的骨架（分頁列、里程碑、卡片區、終端、翻頁），
//              一次跑完，學生第一次進來看一遍。
//   B 單張提示：跟著卡片切換走，一次只高亮一個地方，順序仍然由 model.js 的
//              卡片順序決定——driver 只負責畫泡泡，不管流程。

export const TOUR_SEEN_KEY = "jr-setup-ui:tour-seen";
export const HINT_SEEN_PREFIX = "jr-setup-ui:hint-seen:";

// A：版面導覽。element 全是 index.html 裡寫死的骨架，不隨卡片重畫消失。
export const LAYOUT_TOUR_STEPS = [
  {
    element: "#section-nav",
    title: "整趟分成四段",
    description:
      "上面這四格是四個階段，從左往右做。還沒輪到的會鎖著，" +
      "前一段做完才會自己開。",
  },
  {
    element: "#milestone-bar",
    title: "你走到哪了",
    description: "這一段裡面有幾張卡、你在第幾張，看這條就知道。鴨子站的地方就是現在這張。",
  },
  {
    element: "#current-card",
    title: "一次只做一件事",
    description:
      "中間這張卡就是現在要做的事。上面寫做完你會多出什麼，下面是要按的按鈕。",
  },
  {
    element: "#terminal",
    title: "它正在幹嘛",
    description:
      "按下按鈕之後，右邊會一個字一個字印出它正在做什麼、成功還是失敗。" +
      "卡住的時候先看這裡。",
  },
  {
    // 指的是整列而不是「下一張」那顆按鈕本身：第一次進來時環境還在檢查，兩顆
    // 翻頁按鈕都還 hidden，指一顆 hidden 的元素 driver 會把泡泡貼到畫面左上角。
    element: "#wizard-nav-row",
    title: "做完就往下一張",
    description: "這張卡驗過了，右邊那顆才會亮。想回頭看做過的，左邊那顆可以往回翻。",
  },
];

// B：單張卡的提示。只挑「不講學生會踩坑」的那幾張，不是每張都要跳泡泡。
//
// key 是卡片的 checkId（renderCard 會把它寫進 data-card-id）。
export const CARD_HINTS = {
  "execution-policy": {
    description:
      "這張要排在最前面做。系統預設擋掉所有 .ps1 腳本，不先放行的話，" +
      "後面每一張卡按下去都會失敗——不是那些卡壞了。",
  },
  "tab-sync": {
    description:
      "這張裝好之後，之後每個新開的終端才會把自己的名字放到分頁標題上。" +
      "後面有幾張卡要你「看標題有沒有變」，靠的就是這個。",
  },
  "output-style": {
    description: "這張一次裝兩份設定，兩份都裝完才會去驗。中途停下來會驗不過。",
  },
  "codex-config": {
    description: "跟上一張同一件事，這是 Codex 這邊的兩份。一樣兩份都裝完才驗。",
  },
};

// 版面導覽只跑一次，而且要等第一張卡真的畫出來——骨架在、卡片區還空的話，
// 泡泡會指到一個沒有高度的方框。
export function shouldRunLayoutTour({ seen, cardReady }) {
  return cardReady === true && seen !== true;
}

// 跑到一半跳提示會蓋住終端正在印的字，所以 runInProgress 的時候一律不跳，
// 等它跑完那一輪 render 再說。
export function hintForCard({ cardId, seenIds, runInProgress, tourRunning }) {
  if (runInProgress === true || tourRunning === true) return null;
  if (typeof cardId !== "string" || cardId === "") return null;
  if (seenIds instanceof Set && seenIds.has(cardId)) return null;

  const hint = CARD_HINTS[cardId];

  if (hint === undefined) return null;

  return { cardId, ...hint };
}
