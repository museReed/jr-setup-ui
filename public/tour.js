// driver.js 的黏合層：唯一 import driver 的地方，也是唯一碰 DOM 的地方。
// 「要不要講、講什麼」在 tour-model.js，那邊完全是純函式，測得起來。
//
// driver 在這裡只做一件事：畫高亮泡泡。卡片順序、解鎖、完成判定全部還是
// model.js / viewmodel.js 說了算，不要把流程交給它管。

import { driver } from "/vendor/driver.mjs";
import {
  CARD_HINTS,
  CARD_TOUR_SEEN_KEY,
  CARD_TOUR_STEPS,
  HINT_SEEN_PREFIX,
  LAYOUT_TOUR_STEPS,
  TOUR_SEEN_KEY,
  hintForCard,
  shouldRunCardTour,
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
let tourRunning = false;
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
    onDestroyed: () => {
      tourRunning = false;
      store.set(TOUR_SEEN_KEY, "1");
    },
  });
  return layoutDriver;
}

// 說明講完就把「這頁怎麼用」收起來。前三張卡把該講的講完，之後畫面上不該再留
// 一顆隨時會打斷人的按鈕（Reed 指定）。
//
// 只是 hidden，不是從 DOM 拿掉：replayTour() 仍然叫得動（console 或之後想加回
// 一個入口都行），而且下一次重整時 initTour 會照紀錄決定要不要藏。
function hideReplay() {
  const button = document.querySelector("#replay-tour");

  if (button !== null) button.hidden = true;
}

function cardTour() {
  cardDriver ??= makeDriver({
    showProgress: true,
    progressText: "{{current}} / {{total}}",
    nextBtnText: "下一個",
    prevBtnText: "上一個",
    doneBtnText: "知道了",
    onDestroyed: () => {
      tourRunning = false;
      store.set(CARD_TOUR_SEEN_KEY, "1");
      hideReplay();
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
function visibleSteps(steps) {
  return steps.filter(({ element }) => {
    const node = document.querySelector(element);
    return node !== null && node.offsetParent !== null;
  });
}

export function startLayoutTour({ force = false } = {}) {
  if (tourRunning) return false;

  const seen = store.get(TOUR_SEEN_KEY) === "1";

  if (!force && !shouldRunLayoutTour({ seen, cardReady: cardIsPainted() })) {
    return false;
  }

  const steps = visibleSteps(LAYOUT_TOUR_STEPS);

  if (steps.length === 0) return false;

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

// 「這張卡怎麼用」：只在第一張真的有自查清單的卡上跑一次。
//
// 這四步指的是卡片內部的元素，翻到下一張就整批被丟掉重生——所以它是一次性的，
// 不像版面導覽那樣可以隨時重跑。要重看就從「這頁怎麼用」整套走一遍。
export function startCardTour({ runInProgress } = {}) {
  const checklist = document.querySelector(
    "#current-card .ds-checklist .ds-check.is-system",
  );

  if (
    !shouldRunCardTour({
      seen: store.get(CARD_TOUR_SEEN_KEY) === "1",
      hasChecklist: checklist !== null,
      layoutSeen: store.get(TOUR_SEEN_KEY) === "1",
      runInProgress,
      tourRunning,
    })
  ) {
    return false;
  }

  // 這張卡沒有「你自己勾」那一格（例如全是系統驗的），那一步就不講——指一個
  // 不存在的元素，泡泡會貼到畫面左上角。
  const steps = visibleSteps(CARD_TOUR_STEPS);

  if (steps.length === 0) return false;

  tourRunning = true;
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

export function replayTour() {
  const button = document.querySelector("#replay-tour");

  if (button !== null) button.hidden = false;

  store.remove(TOUR_SEEN_KEY);
  store.remove(CARD_TOUR_SEEN_KEY);
  for (const cardId of Object.keys(CARD_HINTS)) {
    store.remove(`${HINT_SEEN_PREFIX}${cardId}`);
    seenHints.delete(cardId);
  }
  return startLayoutTour({ force: true });
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
}

// app.js 每畫完一輪卡片就叫這個。第一輪負責把版面導覽跑起來，之後負責單張提示。
export function onCardRendered({ cardId, runInProgress }) {
  if (startLayoutTour()) return;
  if (startCardTour({ runInProgress })) return;

  const hint = hintForCard({
    cardId,
    seenIds: seenHints,
    runInProgress,
    tourRunning,
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

  // 重整之後也要維持收起來的狀態——說明已經看完了。
  if (store.get(CARD_TOUR_SEEN_KEY) === "1") hideReplay();
}
