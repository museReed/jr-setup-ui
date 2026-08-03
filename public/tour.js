// driver.js 的黏合層：唯一 import driver 的地方，也是唯一碰 DOM 的地方。
// 「要不要講、講什麼」在 tour-model.js，那邊完全是純函式，測得起來。
//
// driver 在這裡只做一件事：畫高亮泡泡。卡片順序、解鎖、完成判定全部還是
// model.js / viewmodel.js 說了算，不要把流程交給它管。

import { driver } from "/vendor/driver.mjs";
import {
  CARD_HINTS,
  COMPONENT_SEEN_PREFIX,
  COMPONENT_TOUR_STEPS,
  HINT_SEEN_PREFIX,
  LAYOUT_TOUR_STEPS,
  TOUR_SEEN_KEY,
  hintForCard,
  newComponentSteps,
  replayableSteps,
  shouldRunLayoutTour,
} from "./tour-model.js";

// 學生的 VM 上 localStorage 一定在，但開發時用 file:// 或無痕開會丟例外，
// 導覽壞掉不該把整個設定流程一起帶走。
const store = {
  get(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // 記不住就每次都跳一遍，比整頁壞掉好。
    }
  },
  remove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // 同上。
    }
  },
};

const seenHints = new Set();
const seenComponents = new Set();
let tourRunning = false;

// 導覽跑了什麼、為什麼沒跑，全部記下來，跟著「複製診斷資料」一起交出去。
//
// 起因：Reed 在 VM 上看到版面導覽沒出現就直接跳了元件導覽，而同一份 code 在 Mac
// 上重現不出來。沒有紀錄的話只能一路猜——鎖頭那邊裝了紀錄器之後推翻了兩個猜錯的
// 假設，這裡照做。
const tourLog = [];

function logTour(event, detail = {}) {
  // 只留最近幾十筆：每畫一輪卡片都會問一次，跑久了會長到複製不動。
  if (tourLog.length > 80) tourLog.shift();
  tourLog.push({ at: Math.round(performance.now()), event, ...detail });
}

export function tourDiagnostics() {
  return {
    layoutSeen: store.get(TOUR_SEEN_KEY),
    seenComponents: [...seenComponents],
    seenHints: [...seenHints],
    tourRunning,
    log: tourLog,
  };
}
let layoutDriver = null;
let cardDriver = null;
let hintDriver = null;

function makeDriver(options) {
  return driver({
    popoverClass: "jr-tour",
    overlayColor: "#0b1020",
    overlayOpacity: 0.62,
    stagePadding: 6,
    stageRadius: 12,
    ...options,
  });
}

function layoutTour() {
  layoutDriver ??= makeDriver({
    showProgress: true,
    progressText: "{{current}} / {{total}}",
    nextBtnText: "下一個",
    prevBtnText: "上一個",
    doneBtnText: "開始設定",
    steps: LAYOUT_TOUR_STEPS.map(({ element, title, description }) => ({
      element,
      popover: { title, description },
    })),
    onDestroyed: (element, step, options) => {
      tourRunning = false;
      // 停在第幾步一起記：整份走完、中途按叉、或是根本沒畫出來就被收掉，三者的
      // 差別只有這個數字看得出來。
      logTour("layout-destroyed", {
        activeIndex: options?.state?.activeIndex ?? null,
        steps: options?.config?.steps?.length ?? null,
      });
      store.set(TOUR_SEEN_KEY, "1");
      // 版面導覽一結束就馬上接卡片導覽，不要等下一次重畫。
      //
      // 原本只在 onCardRendered 裡試，而那是「畫完一輪卡片」才會跑的。學生如果
      // 已經停在一張有清單的卡上（重整之後很常見），版面導覽收掉之後畫面沒有任何
      // 事情發生，也就沒有人再問一次「該跳卡片導覽了嗎」——那一輪永遠不會出現
      //（Reed 在 VM 上就是這樣：清掉紀錄重整，卡片導覽還是沒跳）。
      //
      // 等一拍再叫：driver 的收尾會把遮罩與泡泡移掉，同一個 tick 裡就開下一輪的話
      // 兩者會疊在一起。
      window.setTimeout(() => startComponentTour({}), 0);
    },
  });
  return layoutDriver;
}

// 「這頁怎麼用」跟著這張卡上有沒有講得出來的元件走：有就留著，沒有就收起來。
//
// 原本是整份說明講完就永久收起來，於是後面才第一次出現的元件（貼證明的輸入框、
// 會開終端的「重跑驗證」）連手動重看都沒辦法（Reed 在 VM 上實際卡到）。
function showReplay(show) {
  const button = document.querySelector("#replay-tour");

  if (button !== null) button.hidden = !show;
}

// 這一輪講完的元件記起來，下次遇到同一個就不再打斷。
function markSeen(steps) {
  for (const { id } of steps) {
    seenComponents.add(id);
    store.set(`${COMPONENT_SEEN_PREFIX}${id}`, "1");
  }
}

// driver 實例是共用的（只建一次），所以「這一輪結束要記哪些元件」不能綁在建構
// 時的閉包上——每一輪開跑前換掉這個。
let onCardTourDone = null;

function cardTour() {
  cardDriver ??= makeDriver({
    showProgress: true,
    progressText: "{{current}} / {{total}}",
    nextBtnText: "下一個",
    prevBtnText: "上一個",
    doneBtnText: "知道了",
    onDestroyed: () => {
      tourRunning = false;
      onCardTourDone?.();
    },
  });
  return cardDriver;
}

function singleHint() {
  hintDriver ??= makeDriver({
    allowClose: true,
    overlayClickBehavior: "close",
  });
  return hintDriver;
}

// 翻頁按鈕平常是 hidden 的（第一張沒有「上一張」），指一個 hidden 的元素
// driver 會把泡泡貼到畫面左上角。看得到的才留下來。
//
// 判定不能用 offsetParent：position: fixed 的元素它一律回 null，而翻頁那一列正是
// fixed（釘在畫面左右、垂直置中）——用 offsetParent 的話，版面導覽會靜靜地少掉
// 「做完就往下一張」那一步，六步變五步而且沒有人會發現。
// getClientRects 看的是「有沒有畫出來」：display: none 與 hidden 都是空的，
// fixed 則照常回傳矩形。
function visibleSteps(steps) {
  return steps.filter(({ element }) => {
    const node = document.querySelector(element);
    return node !== null && node.getClientRects().length > 0;
  });
}

export function startLayoutTour({ force = false } = {}) {
  if (tourRunning) return false;

  const seen = store.get(TOUR_SEEN_KEY) === "1";
  const cardReady = cardIsPainted();

  if (!force && !shouldRunLayoutTour({ seen, cardReady })) {
    logTour("layout-skipped", { seen, cardReady });
    return false;
  }

  const steps = visibleSteps(LAYOUT_TOUR_STEPS);

  // 一步都指不到的話什麼都不做，而且不記「看過了」——記了的話學生永遠等不到它，
  // 而元件導覽會以為版面導覽已經講完（它就是靠這個旗標排隊的）。
  if (steps.length === 0) {
    logTour("layout-no-visible-steps", {
      elements: LAYOUT_TOUR_STEPS.map(({ element }) => element),
    });
    return false;
  }

  logTour("layout-start", { steps: steps.map(({ element }) => element) });

  tourRunning = true;
  const instance = layoutTour();
  instance.setSteps(
    steps.map(({ element, title, description }) => ({
      element,
      popover: { title, description },
    })),
  );
  instance.drive();
  return true;
}

// 現在畫面上真的指得到的元件有哪些。判定跟 visibleSteps 同一條：元素在、而且
// 沒被藏起來（指一個 hidden 的元素，driver 會把泡泡貼到畫面左上角）。
function presentComponents() {
  return new Set(visibleSteps(COMPONENT_TOUR_STEPS).map(({ id }) => id));
}

function driveCardTour(steps, onDone) {
  if (steps.length === 0) return false;

  tourRunning = true;
  onCardTourDone = onDone;
  const instance = cardTour();
  instance.setSteps(
    steps.map(({ element, title, description }) => ({
      element,
      popover: { title, description },
    })),
  );
  instance.drive();
  return true;
}

// 這張卡上有沒有「沒講過」的元件，有就講那幾個。
//
// 以元件為單位，不是以卡為單位：手動清單要到第三張卡才第一次出現，貼證明的輸入框
// 只有 Claude Code 那張有，「重跑驗證」跟環境段的「再 check 一次」是兩件事——
// 這些都是後面才第一次遇到的，以卡為單位的話它們永遠沒人講。
export function startComponentTour({ runInProgress } = {}) {
  const present = presentComponents();
  const steps = newComponentSteps({
    present,
    seenIds: seenComponents,
    layoutSeen: store.get(TOUR_SEEN_KEY) === "1",
    runInProgress,
    tourRunning,
  });

  if (steps.length > 0) {
    logTour("component-start", {
      present: [...present],
      steps: steps.map(({ id }) => id),
      runInProgress: runInProgress === true,
    });
  }

  return driveCardTour(steps, () => markSeen(steps));
}

// 「這頁怎麼用」：把這張卡上所有元件重講一遍，包含已經講過的。
//
// 重看不該把「看過了」的紀錄清掉：清掉的話翻到下一張又會自動跳一次，變成手動重看
// 反而害自己多被打斷一輪。
export function replayTour() {
  if (tourRunning) return false;

  const steps = replayableSteps({ present: presentComponents() });

  return driveCardTour(steps, () => markSeen(steps));
}

function cardIsPainted() {
  const holder = document.querySelector("#current-card");
  return holder !== null && holder.childElementCount > 0;
}

function loadSeenHints() {
  for (const cardId of Object.keys(CARD_HINTS)) {
    if (store.get(`${HINT_SEEN_PREFIX}${cardId}`) === "1") {
      seenHints.add(cardId);
    }
  }

  for (const { id } of COMPONENT_TOUR_STEPS) {
    if (store.get(`${COMPONENT_SEEN_PREFIX}${id}`) === "1") {
      seenComponents.add(id);
    }
  }
}

// app.js 每畫完一輪卡片就叫這個。第一輪負責把版面導覽跑起來，之後負責元件導覽
// 與單張提示。
export function onCardRendered({ cardId, runInProgress, cardDone }) {
  // 「這頁怎麼用」跟著這張卡有沒有元件走，每一輪重畫都要重算——上一張有、這一張
  // 沒有的話按下去會是一場空白的導覽。
  showReplay(replayableSteps({ present: presentComponents() }).length > 0);

  if (startLayoutTour()) return;
  if (startComponentTour({ runInProgress })) return;

  const hint = hintForCard({
    cardId,
    seenIds: seenHints,
    runInProgress,
    tourRunning,
    cardDone,
  });

  if (hint === null) return;

  const anchor = document.querySelector(
    `[data-card-id="${cardId}"] .current-task-body, [data-card-id="${cardId}"]`,
  );

  if (anchor === null) return;

  seenHints.add(cardId);
  store.set(`${HINT_SEEN_PREFIX}${cardId}`, "1");
  singleHint().highlight({
    element: anchor,
    popover: { title: "先看這個", description: hint.description },
  });
}

export function initTour() {
  loadSeenHints();

  // 第一張卡還沒畫出來之前沒有元件可講，先收著；onCardRendered 每一輪會重算。
  showReplay(false);
}
