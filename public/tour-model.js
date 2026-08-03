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
export const CARD_TOUR_SEEN_KEY = "jr-setup-ui:card-tour-seen";
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

// B：單張卡的提示。
//
// 三十張卡有二十張跳泡泡的話，第五張之後學生就開始無腦點掉了——泡泡的價值來自
// 它很少出現。所以只留「不講就會卡死或誤判」的那幾張，其餘的寫在卡片描述或
// 清單的眼睛文案裡（那些地方學生本來就會看，不用打斷他）。
//
// 留下來的四種訊息：
//   擋路的      執行原則沒放行，後面每張卡按下去都失敗
//   改完要重開  中文編碼在原本那個視窗永遠是亂碼
//   會被問一題  Codex 第一次跑會問信不信任 hook，不接受就永遠不會過
//   慢到像當掉  playwright 第一次要下載一顆瀏覽器
//
// 刻意沒有的：合併卡（「兩份一起裝」卡片描述已經整段講完了，泡泡只是再講一次）、
// 命名那幾張（「要看分頁標題」是清單裡眼睛那一格的文案，就在他要勾的地方）。
//
// key 是卡片的 checkId（renderCard 會把它寫進 data-card-id）。
export const CARD_HINTS = {
  "execution-policy": {
    description:
      "這張要排在最前面做。系統預設擋掉所有 .ps1 腳本，不先放行的話，" +
      "後面每一張卡按下去都會失敗——不是那些卡壞了。",
  },
  "powershell-encoding": {
    description:
      "改完要把現在這個終端關掉、重開一個新的才算數。原本那個視窗印出來的中文" +
      "還是會是問號，那不代表沒設定成功。",
  },
  "tab-sync": {
    description:
      "這張裝好之後，之後每個新開的終端才會把自己的名字放到分頁標題上。" +
      "後面有幾張卡要你「看標題有沒有變」，靠的就是這個。",
  },
  "codex-namer": {
    description:
      "第一次跑 Codex 會問你要不要信任 hook——一定要接受。沒接受的話 hook 不會跑，" +
      "分頁標題永遠不會變，看起來就像這張卡壞了。",
  },
  "ext-playwright-claude": {
    description:
      "這張會真的開一顆瀏覽器去截圖。第一次要先把瀏覽器下載下來，可能要等好幾分鐘，" +
      "畫面沒動不代表當掉了。",
  },
  "ext-playwright-codex": {
    description:
      "這張會真的開一顆瀏覽器去截圖。第一次要先把瀏覽器下載下來，可能要等好幾分鐘，" +
      "畫面沒動不代表當掉了。",
  },
};

// C：「這張卡怎麼用」。
//
// 版面導覽講的是整頁的骨架，講不到卡片裡面——而卡片裡面才是學生真正要操作的東西：
// 哪幾格是系統自己驗的、哪幾格要他自己看了再勾、按鈕什麼時候按、原始輸出是什麼。
//
// 這一輪只跑一次，而且要等第一張「真的有自查清單」的卡出現才跑：第一張卡是選工具
// 與選語言，它沒有清單，在那裡講清單學生看不到我們在指什麼。
export const CARD_TOUR_STEPS = [
  {
    element: ".ds-checklist .ds-check.is-system",
    title: "青色的：系統自己驗",
    description:
      "這幾格是程式跑去查了才打勾的——檔案在不在、設定有沒有生效。" +
      "你不用動它，也點不動。",
  },
  {
    element: ".ds-checklist .ds-check.is-manual",
    title: "橘色的：要你自己看",
    description:
      "這幾格程式驗不到（像「分頁標題有沒有變」），只有你看得到。" +
      "照那句話去看，真的看到了再勾起來。沒看到就別勾——勾了只是騙自己。",
  },
  {
    element: ".env-actions",
    title: "按鈕什麼時候按",
    description:
      "由左往右按。先按安裝那顆，等右邊終端跑完，再按驗證那顆。" +
      "已經做完的會變灰色，代表不用再按了。",
  },
  {
    element: "#raw-output-details",
    title: "卡住的時候點這裡",
    description:
      "右邊終端印的是白話版。點開這個會看到原封不動的原始輸出——" +
      "自己看不懂沒關係，把它整段複製給助教，那才是查得出原因的東西。",
  },
];

// 版面導覽只跑一次，而且要等第一張卡真的畫出來——骨架在、卡片區還空的話，
// 泡泡會指到一個沒有高度的方框。
export function shouldRunLayoutTour({ seen, cardReady }) {
  return cardReady === true && seen !== true;
}

// 「這張卡怎麼用」要等第一張真的有清單的卡，而且不能跟版面導覽疊在一起跑。
export function shouldRunCardTour({
  seen,
  hasChecklist,
  layoutSeen,
  runInProgress,
  tourRunning,
}) {
  if (runInProgress === true || tourRunning === true) return false;

  return hasChecklist === true && layoutSeen === true && seen !== true;
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
