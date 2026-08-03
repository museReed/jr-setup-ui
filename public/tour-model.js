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

// 「看過了」的紀錄帶版本號。
//
// 不帶版本的話，改過導覽內容之後，看過舊版的人永遠看不到新版——而且「這頁怎麼用」
// 那顆按鈕在他們身上已經收起來了，連手動重看都沒辦法（Reed 在 VM 上實際卡到）。
//
// 改導覽的步驟時把這個號碼加一，看過舊版的人會自動再看一次。
const TOUR_VERSION = 3;

export const TOUR_SEEN_KEY = `jr-setup-ui:tour-seen:v${TOUR_VERSION}`;
export const HINT_SEEN_PREFIX = `jr-setup-ui:hint-seen:v${TOUR_VERSION}:`;
export const COMPONENT_SEEN_PREFIX = `jr-setup-ui:comp-seen:v${TOUR_VERSION}:`;

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
    // 原始輸出是終端的一部分，跟上一步「它正在幹嘛」講的是同一塊東西，放在它後面
    // 一起講完。
    //
    // 它原本掛在元件導覽裡，但那會讓第一張卡（選工具＋選語言）跳一個 1/1 的泡泡：
    // 那張卡沒有清單也沒有按鈕，八個元件裡只有這個指得到，而它根本不是那張卡的東西
    //（Reed 實測看到的）。那時終端也只印了「正在檢查目前狀態」，講「卡住的時候看
    // 原始輸出」太早。
    element: "#raw-output-details",
    title: "卡住的時候點這裡",
    description:
      "右邊終端印的是白話版。點開這個會看到原封不動的原始輸出——" +
      "自己看不懂沒關係，把它整段複製給助教，那才是查得出原因的東西。",
  },
  {
    // 指「下一張」那顆的外殼，不是那一列、也不是按鈕本身。三者都試過：
    //
    //   那一列    是釘在畫面左右兩側的 fixed 元素、橫跨整個螢幕——高亮會變成一條
    //             貫穿畫面的長帶，泡泡被擠到左下角，看起來像壞掉（Reed 實測截圖）
    //   按鈕本身  導覽開跑的那一刻環境還在檢查，按鈕還 hidden，整步會被跳過
    //             （見 tour.js 的 visibleSteps）——六步靜靜地變成五步
    //   外殼      永遠在（不會 display: none），而 driver 每翻一步都會重新量一次，
    //             等按鈕露臉之後量到的就是按鈕那個 56px 的圓
    element: "#wizard-next-slot",
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

// C：卡片裡面那些元件怎麼用。
//
// 版面導覽講的是整頁的骨架，講不到卡片裡面——而卡片裡面才是學生真正要操作的東西：
// 哪幾格是系統驗的、哪幾格要他自己看了再勾、把視窗開起來的那顆、重驗的那顆、
// 貼證明的那格、原始輸出是什麼。
//
// 以「元件」為單位記，不是以「卡」為單位。
//
// 原本整份只在第一張有清單的卡上跑一次，跑完就把「這頁怎麼用」收起來。代價是後面
// 才第一次出現的元件永遠沒人講：手動清單（橘的）要到第三張卡才有、貼證明的輸入框
// 只有 Claude Code 那張有、「重跑驗證」會開終端跟 env 段的「再 check 一次」是兩件
// 事——學生第一次遇到它們時，說明早就收掉了（Reed 在 VM 上實際卡到）。
//
// 現在每個元件各記各的：某張卡上出現了沒講過的元件才跳，講過的不再打斷。實際會
// 觸發的只有三、四次（前兩張環境卡與規則段第一張），之後全是重複元件。
//
// id 是記憶的 key，改了等於當成新元件重講一次。
// whileRunning 的那一步反過來：只在「正在跑」的時候才指得到（見 tour.js）。
export const COMPONENT_TOUR_STEPS = [
  {
    id: "checklist-system",
    element: ".ds-checklist .ds-check.is-system",
    title: "青色的：系統自己驗",
    description:
      "這幾格是程式跑去查了才打勾的——檔案在不在、設定有沒有生效。" +
      "你不用動它，也點不動。",
  },
  {
    id: "checklist-manual",
    element: ".ds-checklist .ds-check.is-manual",
    title: "橘色的：要你自己看",
    description:
      "這幾格程式驗不到（像「分頁標題有沒有變」），只有你看得到。" +
      "照那句話去看，真的看到了再勾起來。沒看到就別勾——勾了只是騙自己。",
  },
  {
    id: "step-action",
    element: ".checklist-step [data-step-action]",
    title: "這顆幫你把視窗開起來",
    description:
      "橘色那幾格要你去別的視窗做事。與其自己找程式在哪，按這顆——它會把該開的" +
      "視窗開好，你只要照那幾句話做，回來把看到的勾起來。",
  },
  {
    id: "paste-proof",
    element: ".paste-proof-input",
    title: "把圈選到的那一行貼進來",
    description:
      "有些事只有你在那個視窗裡看得到，所以這裡要你把看到的那一行貼回來當證據。" +
      "貼對了這一格會自己打勾，貼錯了它會告訴你對不起來——不是你做錯，再圈一次整行就好。",
  },
  {
    id: "retest-rescan",
    element: "[data-retest][data-retest-kind='rescan']",
    title: "做完按這顆重看一次",
    description:
      "動過設定之後，程式那半要重跑才知道結果。按下去會重新掃一次你電腦上的狀態，" +
      "青色那幾格跟著更新。灰掉的按鈕代表那件事已經做完，不用再按。",
  },
  {
    id: "retest-verify",
    element: "[data-retest][data-retest-kind='verify']",
    title: "這顆會真的開一個終端跑",
    description:
      "跟環境那幾張的「再 check 一次」不一樣：這顆會開一個新的終端視窗，真的把" +
      "剛才裝的東西叫起來跑一遍。跑起來要一段時間，右邊終端會一路印它在做什麼。",
  },
  {
    id: "cancel-run",
    element: "#cancel",
    whileRunning: true,
    title: "跑太久想停下來按這顆",
    description:
      "正在跑的時候右上角會出現這顆。按下去會把它停掉，已經做完的部分不會消失，" +
      "回到原本的畫面再按一次就好。等它自己跑完也可以——不按不會怎麼樣。",
  },
];

// 版面導覽只跑一次，而且要等第一張卡真的畫出來——骨架在、卡片區還空的話，
// 泡泡會指到一個沒有高度的方框。
export function shouldRunLayoutTour({ seen, cardReady }) {
  return cardReady === true && seen !== true;
}

// 這張卡上有哪些「沒講過而且現在指得到」的元件。
//
// 正在跑的時候只挑 whileRunning 那幾步（目前只有取消鈕，它本來就只有跑起來才出現），
// 其餘一律等它跑完——泡泡會蓋住終端正在印的字。
//
// present 是呼叫端量出來的「現在畫面上真的看得到」那組 id，這裡不碰 DOM。
export function newComponentSteps({
  steps = COMPONENT_TOUR_STEPS,
  present,
  seenIds,
  layoutSeen,
  runInProgress,
  tourRunning,
}) {
  if (layoutSeen !== true || tourRunning === true) return [];

  return steps.filter((step) => {
    if ((step.whileRunning === true) !== (runInProgress === true)) return false;
    if (present instanceof Set && !present.has(step.id)) return false;
    return !(seenIds instanceof Set && seenIds.has(step.id));
  });
}

// 「這頁怎麼用」那顆的去留：這張卡上只要有講得出來的元件就留著，讓學生隨時能把
// 這一頁的說明重看一遍。
//
// 原本是整份講完就永久收起來，於是後面才第一次出現的元件連手動重看都沒辦法
//（Reed 在 VM 上實際卡到）。
export function replayableSteps({ steps = COMPONENT_TOUR_STEPS, present }) {
  return steps.filter(
    (step) =>
      step.whileRunning !== true &&
      (!(present instanceof Set) || present.has(step.id)),
  );
}

// 跑到一半跳提示會蓋住終端正在印的字，所以 runInProgress 的時候一律不跳，
// 等它跑完那一輪 render 再說。
//
// 已經完成的卡也不跳。這六張的提示全是「不先知道就會卡死或誤判」——「改完要重開
// 終端」「不先放行後面都會失敗」「第一次要等瀏覽器下載」——這些話只在還沒做成的
// 時候有用。卡片已經綠了還跳出來教人怎麼做，是在講一件已經發生過的事（Reed 在
// 中文編碼那張看到的：清單寫著「讀得到中文」，泡泡還在說改完要重開）。
export function hintForCard({
  cardId,
  seenIds,
  runInProgress,
  tourRunning,
  cardDone,
}) {
  if (runInProgress === true || tourRunning === true) return null;
  if (cardDone === true) return null;
  if (typeof cardId !== "string" || cardId === "") return null;
  if (seenIds instanceof Set && seenIds.has(cardId)) return null;

  const hint = CARD_HINTS[cardId];

  if (hint === undefined) return null;

  return { cardId, ...hint };
}
