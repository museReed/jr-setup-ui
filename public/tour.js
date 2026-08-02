// driver.js 的黏合層：唯一 import driver 的地方，也是唯一碰 DOM 的地方。
// 「要不要講、講什麼」在 tour-model.js，那邊完全是純函式，測得起來。
//
// driver 在這裡只做一件事：畫高亮泡泡。卡片順序、解鎖、完成判定全部還是
// model.js / viewmodel.js 說了算，不要把流程交給它管。

import { driver } from "/vendor/driver.mjs";
import {
  CARD_HINTS,
  HINT_SEEN_PREFIX,
  LAYOUT_TOUR_STEPS,
  TOUR_SEEN_KEY,
  hintForCard,
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

export function replayTour() {
  store.remove(TOUR_SEEN_KEY);
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
}
