// View：只把 app 傳進來的畫面模型畫成 DOM，不做流程判斷或資料請求。
import { LOADER_MODIFIERS, appendTermLine } from "./viewmodel.js";
import { lottieControl } from "./lottie-player.js";

const elements = {
  output: document.querySelector("#output"),
  terminal: document.querySelector("#terminal"),
  terminalLines: document.querySelector("#terminal-lines"),
  actionButtons: [...document.querySelectorAll("[data-action]")],
  prompt: document.querySelector("#prompt"),
  allowWrite: document.querySelector("#allow-write"),
  cancel: document.querySelector("#cancel"),
  envOs: document.querySelector("#env-os"),
  envResults: document.querySelector("#env-results"),
  recheckEnv: document.querySelector("#recheck-env"),
  installStatus: document.querySelector("#install-status"),
  loginWaitStatus: document.querySelector("#login-wait-status"),
  configTools: document.querySelector("#config-tools"),
  configLang: document.querySelector("#config-lang"),
  configChoicePanel: document.querySelector("#config-choice-panel"),
  recheckConfigs: document.querySelector("#recheck-configs"),
  configSummary: document.querySelector("#config-summary"),
  configResults: document.querySelector("#config-results"),
  sectionNav: document.querySelector("#section-nav"),
  sectionButtons: [...document.querySelectorAll("[data-section-target]")],
  sectionPanel: document.querySelector("[data-section-panel]"),
  sectionStatus: document.querySelector("#section-status"),
  replayTour: document.querySelector("#replay-tour"),
  copyDiagnostics: document.querySelector("#copy-diagnostics"),
  copyRawOutput: document.querySelector("#copy-raw-output"),
  currentCard: document.querySelector("#current-card"),
  milestoneBar: document.querySelector("#milestone-bar"),
  milestoneFill: document.querySelector("#milestone-fill"),
  milestoneDuck: document.querySelector("#milestone-duck"),
  milestoneCat: document.querySelector("#milestone-cat"),
  sectionLockMessage: document.querySelector("#section-lock-message"),
  wizardPrev: document.querySelector("#wizard-prev"),
  wizardNext: document.querySelector("#wizard-next"),
  wizardUnlock: document.querySelector("#wizard-unlock"),
  behaviorFallback: document.querySelector("#behavior-fallback"),
  behaviorQuestion: document.querySelector("#behavior-question"),
  behaviorChecklist: document.querySelector("#behavior-checklist"),
  copyBehaviorQuestion: document.querySelector("#copy-behavior-question"),
  terminalMascot: document.querySelector("#terminal-mascot"),
  verifyModal: document.querySelector("#verify-modal"),
  verifyModalConfirm: document.querySelector("#verify-modal-confirm"),
  verifyModalLater: document.querySelector("#verify-modal-later"),
};

export { elements };

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let renderedStation = null;
let pinnedStation = null;
let milestoneBusy = false;
let stationTimer = null;
let arrivalTimer = null;
let fireworkTimer = null;
let autoUnpinTimer = null;

function createLogo(logo) {
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("class", "ds-toollogo-mark");
  icon.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#${logo}`);
  icon.append(use);
  return icon;
}

function checkMark() {
  const box = document.createElement("span");
  box.className = "ds-check-box";
  box.setAttribute("aria-hidden", "true");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M5 12.5 10 17l9-10");
  svg.append(path);
  box.append(svg);
  return box;
}

function unpinAll() {
  for (const point of elements.milestoneBar.querySelectorAll(
    ".ds-milestone",
  )) {
    point.querySelector(".ds-milestone-card").classList.remove("is-pinned");
    point.setAttribute("aria-hidden", "true");
  }
}

function unpin(point) {
  point.querySelector(".ds-milestone-card").classList.remove("is-pinned");
  point.setAttribute("aria-hidden", "true");
  pinnedStation = null;
}

function pin(point, key) {
  point.querySelector(".ds-milestone-card").classList.add("is-pinned");
  point.removeAttribute("aria-hidden");
  pinnedStation = key;
  milestoneBusy = false;
}

// 小鴨抵達時自己跳出來的那張預覽，三秒後自己收掉。
//
// 它是報喜用的，不是要學生讀完的東西——留著會蓋住下一張卡的標題（VM 實測）。
// 滑鼠移上去就取消倒數：那代表學生真的在讀，這時收掉最惹人厭。
//
// 記的是「收掉的時刻」而不是「還剩幾秒」。renderWizard 跑得很勤（驗證時每一行輸出
// 都會重畫），而每次重畫都會重建里程碑、清掉計時器再重新釘住——只記剩餘秒數的話，
// 那三秒永遠重新開始，預覽就再也不會關（VM 實測：驗證中的卡片，預覽一直掛著）。
let closePreviewAt = null;

function scheduleUnpin(point) {
  window.clearTimeout(autoUnpinTimer);

  if (closePreviewAt === null) return;

  const left = closePreviewAt - Date.now();

  if (left <= 0) {
    closePreviewAt = null;
    unpin(point);
    return;
  }

  autoUnpinTimer = window.setTimeout(() => {
    closePreviewAt = null;
    unpin(point);
  }, left);
}

function autoUnpin(point) {
  closePreviewAt = Date.now() + 3000;
  scheduleUnpin(point);
}

function keepPreviewOpen() {
  closePreviewAt = null;
  window.clearTimeout(autoUnpinTimer);
}

// 進度條上那隻只有一個，開頁時掛一次就好——每次重畫都重掛的話，那隻 261KB 的
// 逐格動畫會被重新解析一遍，而且動作會從第一格重來（走一半突然重播）。
const milestoneCat = lottieControl({
  url: "/vendor/milestone-cat.json",
  className: "milestone-cat-art",
});
elements.milestoneCat.append(milestoneCat.box);

// 停下來之後的原地小動作。
//
// 那支動畫整段 33 格是一次翻滾（蹲下 → 縮成球 → 翻過去 → 站回來）。移動時就播
// 整段，停下來之後再一直翻就變成「站在原地一直跌倒」——所以改成只在最後那三格
// 之間來回：30 → 31 → 32 → 31 → …。那三格都是站姿，來回播看起來像原地踏步。
//
// 用計時器一格一格 goToAndStop，不用 lottie 的反向區間：反向的區間它只往前播，
// 會停在中間某一格不動（分頁鎖頭那邊已經踩過一次）。
// 只有三格來回會一格一格跳（Reed 回報：不流暢）。往前多借三格：27–29 是同一段
// 站起來的過程（蹲坐 → 撐起 → 站直），跟 30–32 是連續的，湊成六格，來回一輪
// 十格。步距也縮到 110 毫秒。
//
// 六格是這支動畫給得起的上限——33 格裡站姿只有這幾格，其餘都在翻滾。剩下的順暢
// 感靠 CSS 補：踏步時外面那層做一個連續的上下微幅起伏（見 .is-stepping），
// 逐格跳的斷點被那個連續運動蓋過去。
const CAT_IDLE_FRAMES = [27, 28, 29, 30, 31, 32, 31, 30, 29, 28];
const CAT_IDLE_STEP_MS = 110;
let catIdleTimer = null;
// 「現在應該原地踏步嗎」。動畫是非同步載入的，所以要記下意圖：等 promise 回來時
// 學生可能已經又往下一站走了，這時候不能接手。
let catIdleWanted = false;

export function stopCatIdle() {
  catIdleWanted = false;
  elements.milestoneDuck.classList.remove("is-stepping");

  if (catIdleTimer === null) return;

  window.clearInterval(catIdleTimer);
  catIdleTimer = null;
  // 回去播整段翻滾——移動中要的是那個。
  milestoneCat.ready.then((animation) => {
    if (catIdleWanted) return;
    animation?.play();
  });
}

export function startCatIdle() {
  if (reducedMotion.matches || catIdleTimer !== null) return;

  catIdleWanted = true;
  milestoneCat.ready.then((animation) => {
    if (!catIdleWanted || catIdleTimer !== null) return;
    if (animation === null || animation === undefined) return;

    animation.pause();
    elements.milestoneDuck.classList.add("is-stepping");
    let index = 0;
    catIdleTimer = window.setInterval(() => {
      animation.goToAndStop(CAT_IDLE_FRAMES[index], true);
      index = (index + 1) % CAT_IDLE_FRAMES.length;
    }, CAT_IDLE_STEP_MS);
  });
}

function finishArrival(point, station, key) {
  // 彈跳（is-arriving）剛演完，接手成原地踏步。
  startCatIdle();
  const firework = document.createElement("span");
  firework.className = "ds-firework";
  firework.style.setProperty("--firework-at", `${station.percent}%`);
  firework.setAttribute("aria-hidden", "true");
  for (let ray = 0; ray < 10; ray += 1) {
    const particle = document.createElement("i");
    particle.style.setProperty("--ray", `${ray * 36}deg`);
    firework.append(particle);
  }
  elements.milestoneBar.append(firework);
  fireworkTimer = window.setTimeout(() => {
    firework.remove();
    pin(point, key);
    autoUnpin(point);
  }, 800);
}

// 進出場：牠從螢幕外面滾進來，換段時滾到螢幕外面去。
//
// 起訖點是「進度條邊緣再往外半個螢幕寬」。原本只給 ±8%（約 90px），那只是滾到
// 進度條旁邊——學生還看得到牠停在那裡，不像真的離場（Reed 回報）。
//
// left 吃的是進度條寬度的百分比，所以半個螢幕要換算成百分比，而且每次都重算：
// 視窗縮放、側邊欄出現都會改變進度條寬度，寫死的數字馬上就不是半個螢幕了。
const CAT_OFFSCREEN_RATIO = 0.5;
const CAT_EXIT_MS = 600;
const CAT_ENTER_MS = 900;
let catTimer = null;

function offscreenPercent() {
  const bar = elements.milestoneBar.getBoundingClientRect().width;

  // 還沒排版完（寬度 0）就給一個夠遠的保底值，不要算出 Infinity。
  if (bar === 0) return 120;

  return ((window.innerWidth * CAT_OFFSCREEN_RATIO) / bar) * 100;
}

// 換位置但不要有過渡——把牠瞬間搬到畫面外面，準備滾進來。
function placeCatInstantly(percent) {
  elements.milestoneDuck.classList.add("no-transition");
  elements.milestoneDuck.style.left = `${percent}%`;
  // 讀一次 offsetWidth 逼瀏覽器把這個位置結算掉，不然移掉 no-transition 之後
  // 瀏覽器會把「搬過去」跟「滾回來」合併成一次過渡，等於沒搬。
  void elements.milestoneDuck.offsetWidth;
  elements.milestoneDuck.classList.remove("no-transition");
}

function rollIn(percent) {
  stopCatIdle();
  placeCatInstantly(-offscreenPercent());
  elements.milestoneDuck.classList.add("is-rolling", "is-entering");
  elements.milestoneDuck.style.left = `${percent}%`;
  catTimer = window.setTimeout(() => {
    elements.milestoneDuck.classList.remove("is-rolling", "is-entering");
    // 滾到定位就站著踏步。這一段沒有 is-arriving 的彈跳（那是站到站之間才有的），
    // 所以直接接手。
    startCatIdle();
  }, CAT_ENTER_MS);
}

function moveDuck(sectionId, station) {
  const nextKey = `${sectionId}:${station.index}`;
  const previousIndex = renderedStation?.sectionId === sectionId
    ? renderedStation.index
    : station.index;
  const moving = renderedStation !== null && nextKey !== renderedStation.key;
  const firstPaint = renderedStation === null;
  const sectionChanged =
    !firstPaint && renderedStation.sectionId !== sectionId;
  renderedStation = { key: nextKey, sectionId, index: station.index };
  window.clearTimeout(stationTimer);
  window.clearTimeout(arrivalTimer);
  window.clearTimeout(fireworkTimer);
  window.clearTimeout(autoUnpinTimer);
  elements.milestoneBar.querySelector(".ds-firework")?.remove();
  elements.milestoneDuck.classList.toggle("left", station.index < previousIndex);
  elements.milestoneFill.style.width = `${station.percent}%`;
  elements.milestoneFill.setAttribute("aria-valuenow", String(station.percent));

  // 進場與退場自己管位置，不要在這裡先把 left 設成目的地——設了就等於直接
  // 跳到定位，滾進來那一段永遠看不到。
  if (!reducedMotion.matches && (firstPaint || sectionChanged)) {
    // 只有真的要重新開一輪進出場時才收掉上一輪的計時器。無條件清掉的話，環境檢查
    // 期間的每一次重畫都會把「滾完了要收手」那一刀清掉——牠就一直轉下去。
    window.clearTimeout(catTimer);
    elements.milestoneDuck.classList.remove("is-running", "is-arriving");
    unpinAll();

    if (firstPaint) {
      rollIn(station.percent);
      return;
    }

    // 換段：先滾出右邊，出去了再從左邊滾回來。中間不能有第三種狀態——
    // 牠一路都在滾，只是位置從畫面外的一邊換到另一邊。
    stopCatIdle();
    elements.milestoneDuck.classList.add("is-rolling", "is-exiting");
    elements.milestoneDuck.style.left = `${100 + offscreenPercent()}%`;
    catTimer = window.setTimeout(() => {
      elements.milestoneDuck.classList.remove("is-exiting");
      rollIn(station.percent);
    }, CAT_EXIT_MS);
    return;
  }

  elements.milestoneDuck.style.left = `${station.percent}%`;

  const point = elements.milestoneBar.querySelector(
    `[data-card-index="${station.index}"]`,
  );

  if (!moving) {
    elements.milestoneDuck.classList.remove("is-running", "is-arriving");
    // 站在原地的重畫（勾一個項目、檢查回來）也要維持踏步。startCatIdle 本身
    // 有擋重入，重複叫沒有副作用。
    startCatIdle();

    // 重畫時把原本釘著的那張還原——連同它原本要收掉的時刻。上面剛清掉計時器，
    // 這裡不重新排的話，這張預覽就再也不會關。
    if (pinnedStation === nextKey) {
      pin(point, nextKey);
      scheduleUnpin(point);
    }

    return;
  }

  unpinAll();
  milestoneBusy = true;
  if (reducedMotion.matches) {
    elements.milestoneDuck.classList.remove("is-running", "is-arriving");
    pin(point, nextKey);
    autoUnpin(point);
    return;
  }

  // 要移動了：把原地踏步收掉，回去播整段翻滾。
  stopCatIdle();
  elements.milestoneDuck.classList.add("is-running");
  stationTimer = window.setTimeout(() => {
    elements.milestoneDuck.classList.remove("is-running");
    elements.milestoneDuck.classList.add("is-arriving");
    arrivalTimer = window.setTimeout(() => {
      elements.milestoneDuck.classList.remove("is-arriving");
      finishArrival(point, station, nextKey);
    }, 420);
  }, 1000);
}

function renderMilestones(sectionId, milestones, onSelect) {
  const points = milestones.map((station) => {
    const point = document.createElement("span");
    point.className = "ds-milestone wizard-milestone";
    point.style.setProperty("--at", `${station.percent}%`);
    point.dataset.value = String(station.percent);
    point.dataset.cardIndex = String(station.index);
    point.classList.toggle("is-reached", station.reached);
    point.classList.toggle("is-locked", !station.unlocked);
    point.setAttribute("aria-hidden", "true");

    point.classList.add(station.edgeClass);

    const preview = document.createElement("span");
    preview.className = "ds-milestone-card";
    const close = document.createElement("button");
    close.className = "ds-milestone-card-close";
    close.type = "button";
    close.setAttribute("aria-label", "關閉");
    close.textContent = "×";
    const name = document.createElement("strong");
    name.className = "ds-milestone-card-name";
    name.textContent = station.label;
    const value = document.createElement("span");
    value.className = "ds-milestone-card-value";
    value.textContent = `第 ${station.index + 1} / ${milestones.length} 張`;
    const description = document.createElement("span");
    description.className = "ds-milestone-card-desc";
    description.textContent = station.detail;
    preview.append(close, name, value, description);
    point.append(preview);
    point.addEventListener("mouseenter", () => point.classList.add("is-active"));
    point.addEventListener("mouseleave", () => point.classList.remove("is-active"));
    // 滑鼠移到預覽上就別再倒數了：那代表學生正在讀它。放開也不重新倒數——要收就
    // 按 ×，或等小鴨移動到下一站。
    preview.addEventListener("mouseenter", keepPreviewOpen);
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      keepPreviewOpen();
      unpin(point);
    });
    point.addEventListener("click", () => {
      if (!milestoneBusy && station.unlocked) onSelect(station.index);
    });
    return point;
  });
  for (const point of elements.milestoneBar.querySelectorAll(
    ".wizard-milestone",
  )) {
    point.remove();
  }
  elements.milestoneDuck.before(...points);

  const current = milestones.find((station) => station.current);
  if (current !== undefined) {
    moveDuck(sectionId, current);
  }
}

// 設計系統只給了品牌 logo，沒有通用的動作 icon，所以這裡自己畫。一律 24×24、
// 線條、不填色——填色的話 .ds-btn-fill 的 fill:currentColor 會把它塗成一塊。
const ICONS = {
  install: "M12 4v10m0 0 4-4m-4 4-4-4M5 19h14",
  reinstall: "M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4",
  verify: "M4 6h16M4 6l4 4-4 4M12 18h8",
  terminal: "M3 5h18v14H3zM7 10l2.5 2L7 14M12.5 15H17",
  send: "M4 12 20 5l-3 7 3 7z",
  link: "M14 4h6v6M20 4l-8 8M18 14v5H5V6h5",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  merge: "M7 4v9a4 4 0 0 0 4 4h6M17 13l3 4-3 4",
  cancel: "M6 6l12 12M18 6 6 18",
  stop: "M7 7h10v10H7z",
  later: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  check: "M4 13l5 5L20 6",
};

function iconSvg(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", ICONS[name] ?? ICONS.check);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "2");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
}

// 會產生副作用的按鈕包一層：這一下還沒做完就不接第二下。
//
// 要防的是連點——開視窗那顆連點兩下會真的開兩個終端視窗，安裝那顆會跑兩次同一個
// 安裝（Reed 指定）。冪等的按鈕（複製、翻頁、切分頁）不包，包了只會讓翻頁點快一點
// 就沒反應。
//
// 不用時間型 debounce：那只擋得住「很快的第二下」，隔 300ms 再點一次照樣出事。
// 鎖到這一下真的做完才是實的。
//
// 鎖的是這個閉包不是 button.disabled：disabled 由每一輪重畫依真正的狀態決定
//（runInProgress、permanentlyDisabled…），在這裡動它會跟重畫互相蓋來蓋去。
function guardClick(handler) {
  let busy = false;

  return async (...args) => {
    if (busy) return;

    busy = true;

    try {
      await handler(...args);
    } finally {
      busy = false;
    }
  };
}

// .ds-btn-fill：平常空心，滑上去顏色從左邊灌滿。它的結構本來就是 svg + span。
//
// 主要動作預先灌滿（is-primary）——這顆按鈕本身沒有主次之分，但「現在該按哪顆」
// 是這幾輪一直在修的事，不能為了統一風格把它丟掉。
function fillButton({ icon, text, primary = false, onClick, small = true }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `ds-btn-fill${small ? " is-sm" : ""}${
    primary ? " is-primary" : ""
  }`;
  const label = document.createElement("span");
  label.textContent = text;
  button.append(iconSvg(icon), label);

  if (onClick !== undefined) {
    // 灌色按鈕全是「按下去會發生事情」的那種（安裝、開視窗、重驗、送出、複製），
    // 統一在這裡防連點。複製那種冪等的包了也沒有壞處——它只是把第二下吃掉。
    button.addEventListener("click", guardClick(onClick));
  }

  return button;
}

// 按鈕上的 icon 跟著「這顆在做什麼」走，不是跟著文字走：文字會改（安裝／重裝），
// 做的事沒變。
function actionIcon(spec) {
  if (spec.dataName === "mergeAction") return "merge";
  if (spec.dataName === "verifyAction") return "terminal";
  return spec.secondary === true ? "reinstall" : "install";
}

function actionButton(spec, onActionClick) {
  // 按不動的那顆（✅ 已安裝）留在舊元件上：空心按鈕灰掉之後很難看出它是「已完成」
  // 而不是「壞了」。能按的才換成會灌色的那種。
  if (spec.disabled === true || spec.done === true) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ds-btn ds-btn-sm ds-btn-primary";
    button.dataset[spec.dataName] = spec.action;
    button.dataset.step = spec.step ?? "";
    button.dataset.idleText = spec.text;
    button.dataset.permanentlyDisabled = String(spec.disabled === true);
    button.textContent = spec.text;
    button.disabled = spec.disabled === true;
    button.classList.toggle("is-done", spec.done === true);
    return button;
  }

  // secondary：按得動、但不是這張卡的主要動作（例如驗證失敗過才出現的「重裝」）。
  // 兩顆都灌滿的話，學生分不出哪一顆才是現在該按的。
  const button = fillButton({
    icon: actionIcon(spec),
    text: spec.text,
    // hoverFill：掛在清單裡那幾顆（「開始登入」）要的是滑上去才灌滿的動作，
    // 不預先灌色（Reed 指定，跟旁邊兩顆開視窗的一致）。
    primary: spec.hoverFill === true ? false : spec.secondary !== true,
    onClick: () => onActionClick(spec.action, button, spec.step, spec.options),
  });
  button.dataset[spec.dataName] = spec.action;
  button.dataset.step = spec.step ?? "";
  button.dataset.idleText = spec.text;
  button.dataset.permanentlyDisabled = "false";
  return button;
}

// 貼上證明用的欄位。貼對了那一格自己打勾——這是整份嚮導唯一「學生交得出副產物」
// 的人工項目，其餘的人眼判定只能靠自己說了算。
// 不顯示那句要貼進終端的話：按鈕已經會把它送進去了，印出來只是多一份要學生自己
// 一字不差複製的東西——而那正是按鈕要取代的手動步驟。字串本身仍然由
// test/fullscreen-proof.mjs 釘住，確保按鈕送的跟要比對的一致。
function pasteProofElement({ value, matched, onInput }) {
  const wrap = document.createElement("div");
  wrap.className = "paste-proof";

  // 開視窗的按鈕不在這裡：它掛在清單裡它負責的那一步旁邊（見 checklistElement）。
  // 原本兩顆都擠在欄位上方，學生要自己猜哪顆帶他做哪一格。
  const field = document.createElement("input");
  field.type = "text";
  field.className = "ds-input paste-proof-input";
  field.placeholder = "把圈選到的那一行貼在這裡";
  field.value = value;
  field.addEventListener("input", (event) => onInput(event.target.value));

  const status = document.createElement("span");
  status.className = matched
    ? "paste-proof-status is-matched"
    : "paste-proof-status";
  status.textContent = matched
    ? "對上了，這一項算過。"
    : value.trim() === ""
      ? ""
      : "跟代碼對不起來，再圈選一次整行試試。";

  wrap.append(field, status);
  return wrap;
}

// 清單上那顆問號：進操作步驟的入口。
//
// 不是「怎麼做」三個字——那一列本來就有兩行文字加上可能的安裝／登入鍵，再塞一顆
// 有字的按鈕會把它擠成兩截，而「有問題點這裡」是問號本來就在講的事。
//
// 滑鼠移上去先把問號播一次，播完才開彈窗；中途移開就不開——不擋的話，滑過去拿別
// 顆按鈕都會彈出一個蓋住半個畫面的東西。直接點就不等動畫。
function walkthroughButton(item, rowText, onWalkthrough) {
  const how = document.createElement("button");
  how.type = "button";
  how.className = "checklist-how";
  how.title = "怎麼做";
  how.setAttribute("aria-label", `怎麼做：${rowText}`);
  how.dataset.walkthrough = item.id;

  const { box, ready } = lottieControl({
    url: "/vendor/question-mark.json",
    className: "checklist-how-anim",
    loop: false,
    autoplay: false,
  });
  how.append(box);

  // 平常停在最後一格，也就是問號畫完的樣子。第一格只有一個空圈圈——停在那裡的話
  // 那一列右邊掛的是一個看不出是什麼的圓，學生不會知道那可以點（Reed 指出）。
  //
  // 讀完動畫自己的長度而不是寫死格號：換一份 json 進來也不會靜靜停在中間某一格。
  const settle = async () => {
    const animation = await ready;
    animation?.goToAndStop(animation.totalFrames - 1, true);
  };

  settle();

  // 從按鈕的正中央長出來。彈窗算 transform-origin 要的是這個點。
  const origin = () => {
    const rect = how.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  };

  let hovering = false;

  how.addEventListener("pointerenter", async () => {
    hovering = true;
    const animation = await ready;

    if (animation === null) return;

    animation.goToAndPlay(0, true);
    animation.addEventListener("complete", function onDone() {
      animation.removeEventListener("complete", onDone);
      // 播完的時候滑鼠可能已經移走了。移走了就當作他只是路過。
      if (hovering) onWalkthrough(item.id, origin());
    });
  });

  how.addEventListener("pointerleave", () => {
    hovering = false;
    settle();
  });

  how.addEventListener("click", (event) => {
    // 它住在 <label> 裡面：不擋的話按問號會順手把那一格的勾打上，等於在學生還沒
    // 做之前就替他宣告做完了。
    event.preventDefault();
    event.stopPropagation();
    hovering = false;
    onWalkthrough(item.id, origin());
  });

  return how;
}

function checklistElement(
  groups,
  onManualToggle,
  {
    manualSteps = [],
    pasteProof = null,
    login = null,
    onOpen = () => {},
    // 掛在某一格底下的按鈕（目前是登入那顆），key 是那一格的 check id。
    inlineActions = new Map(),
    // 哪幾格有操作步驟可以看（id → {title, description}），以及按下去要做什麼。
    walkthroughs = new Map(),
    onWalkthrough = () => {},
  } = {},
) {
  const items = [...groups.system, ...groups.manual];
  const checked = items.filter((item) => item.checked).length;
  const checklist = document.createElement("section");
  checklist.className = "ds-checklist ds-checklist--glitch";
  checklist.classList.toggle(
    "is-complete",
    items.length > 0 && checked === items.length,
  );
  // 不放標題列與分組標題——兩組靠顏色分（青=系統驗的、橘=你自己勾的），
  // 標題只是把同一件事再講一次，還把卡片撐高。只留右上角的計數。
  const head = document.createElement("header");
  head.className = "ds-checklist-head";
  const count = document.createElement("span");
  count.className = "ds-checklist-count";
  count.textContent = `${checked} / ${items.length}`;
  head.append(count);
  checklist.append(head);

  const appendItems = (list) => {
    for (const item of list) {
      // 這一列的標題與說明可以住在 content/ 裡（文案審閱者改得動的地方）。沒寫的
      // 話照舊用 src/ 帶過來的那一份。
      //
      // 寫法的規矩：title 一句話講清楚這一格在檢查什麼、不加標點；description 最多
      // 兩句（一個逗號）講它的目的。
      const copy = walkthroughs.get(item.id);
      const rowText = copy?.title || item.text;
      const rowDetail = copy?.description || item.detail;

      const label = document.createElement("label");
      label.className = "ds-check";
      label.classList.add(item.automatic ? "is-system" : "is-manual");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = item.checked;
      input.disabled = item.disabled;
      input.dataset.checklistId = item.id;
      const text = document.createElement("span");
      text.className = "ds-check-text";
      const visible = document.createElement("span");
      visible.className = "ds-check-label";
      visible.setAttribute("data-text", rowText);
      visible.textContent = rowText;
      text.append(visible);

      if (item.failedReason || rowDetail) {
        const small = document.createElement("small");
        // 自己的 class：設計系統對 small 的配色寫死了青色（見 styles.css 那條
        // .check-detail），橘色那半要靠一個掛得上鉤子的名字才改得動。
        small.className = "check-detail";
        small.textContent = item.failedReason || rowDetail;
        text.append(small);
      }

      if (!item.automatic) {
        input.addEventListener("change", () =>
          onManualToggle(item.id, input.checked),
        );
      }

      label.append(input, checkMark(), text);

      // 修那一格的按鈕（「開始登入」）就放在那一格裡面、靠右。原本擺在清單外的
      // 按鈕列，「未登入」在清單裡、按鈕在清單外，學生要自己把兩者連起來
      //（Reed 實測）。
      //
      // 放在同一列而不是另起一列：另起一列會把清單撐高一截，而這一列本來就有
      // 兩行文字的高度，塞得下一顆小按鈕（Reed 指定）。
      const inline = inlineActions.get(item.id);

      if (inline !== undefined) {
        inline.classList.add("checklist-inline-action");
        label.append(inline);
      }

      // 「怎麼做」跟登入那顆一樣待在它負責的那一格裡：操作步驟講的就是這一格，
      // 放到清單外面學生又要自己把兩者連起來。
      //
      // 它住在 <label> 裡面，所以一定要擋掉預設行為——不擋的話按「怎麼做」會順手
      // 把那一格的勾打上，等於在他還沒做之前就替他宣告做完了。
      if (copy !== undefined) {
        label.append(walkthroughButton(item, rowText, onWalkthrough));
      }

      checklist.append(label);

      // 登入那一塊（授權連結與代碼）跟著同一格，接在它下面。
      if (login !== null && item.id === `system-${login.authCheckId}`) {
        checklist.append(loginControlsElement(login));
      }
    }
  };

  appendItems(groups.system);

  // 人工項目照步驟分組：一步一個標題 + 一顆把視窗開起來的按鈕。原本按鈕全擠在
  // 清單下面，學生要自己猜哪顆帶他做哪一格。
  for (const step of manualSteps) {
    if (step.title !== null) {
      const head = document.createElement("div");
      head.className = "checklist-step";
      const title = document.createElement("span");
      title.className = "checklist-step-title";
      title.textContent = step.title;
      head.append(title);

      if (step.action !== null) {
        const open = fillButton({
          // 第二步是「開視窗並自動送出一句話」，所以是紙飛機不是視窗。
          icon: step.action === "fullscreen-proof" ? "send" : "terminal",
          text: step.buttonText,
          // 不預先灌滿：清單裡這幾顆要的是滑上去從左往右灌滿的那個動作
          //（Reed 指定）。代價是少了「現在該按哪一顆」的預先灌色，靠位置與文字辨識。
          primary: false,
          onClick: () => onOpen(step.action),
        });
        // 導覽要指得到這顆（見 tour-model.js 的 CARD_TOUR_STEPS）。按文字找不行，
        // 每張卡的字都不一樣。
        open.dataset.stepAction = step.action;
        head.append(open);
      }

      checklist.append(head);
    }

    appendItems(step.items);

    // 貼上欄位就放在它證明的那一格底下——放在清單外面的話，學生貼完不會馬上看到
    // 那一格被打勾。
    if (pasteProof !== null && step.id === "fullscreen-proof") {
      checklist.append(pasteProofElement(pasteProof));
    }
  }

  return checklist;
}

// 卡片裡「照原樣印出來給你對照」的那幾塊，畫成設計系統的靜態終端（.ds-term）：
// 跟右邊那個會動的終端同一套視覺，學生一眼看得出「這是終端裡會出現的字」。
function staticTerminal(lines) {
  const term = document.createElement("div");
  term.className = "ds-term card-hints-term";
  const chrome = document.createElement("div");
  chrome.className = "ds-term-chrome";

  for (const color of ["--red-4", "--amber-4", "--teal-4"]) {
    const dot = document.createElement("span");
    dot.className = "ds-term-dot";
    dot.style.background = `var(${color})`;
    dot.setAttribute("aria-hidden", "true");
    chrome.append(dot);
  }

  const body = document.createElement("div");
  body.className = "ds-term-body";

  for (const text of lines) {
    const line = document.createElement("div");
    line.className = "ds-term-line";
    line.textContent = text;
    body.append(line);
  }

  term.append(chrome, body);
  return term;
}

function loginControlsElement(model) {
  const hints = document.createElement("div");
  hints.id = "login-hints";
  hints.className = "login-hints";
  hints.hidden = !model.showLink && !model.showCode;
  const link = document.createElement("a");
  link.id = "login-url";
  // 會自己開瀏覽器的服務（codex），連結只是備援，不該長得像主要入口。
  link.className = model.autoOpens
    ? "ds-btn-fill is-sm"
    : "ds-btn-fill is-sm is-primary";
  link.append(iconSvg("link"));
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  const linkLabel = document.createElement("span");
  linkLabel.textContent = model.linkText;
  link.append(linkLabel);
  link.hidden = !model.showLink;
  if (model.url !== null) link.href = model.url;
  const codeRow = document.createElement("div");
  codeRow.id = "login-code-row";
  codeRow.hidden = !model.showCode;
  const code = document.createElement("code");
  code.id = "login-code";
  code.textContent = model.code ?? "";
  const copy = fillButton({
    icon: "copy",
    text: "複製",
    onClick: () => model.onCopyLoginCode(code.textContent, copy),
  });
  copy.id = "copy-login-code";
  codeRow.append(code, copy);
  const form = document.createElement("form");
  form.id = "run-input";
  form.hidden = !model.showInput;
  const input = document.createElement("input");
  input.id = "run-input-text";
  input.type = "text";
  input.maxLength = 500;
  input.autocomplete = "off";
  input.placeholder = "把授權代碼貼在這裡，再按送出";
  const submit = fillButton({ icon: "send", text: "送出", primary: true });
  submit.type = "submit";
  form.append(input, submit);
  // 送出那顆是 type=submit，真正的動作掛在 form 上，所以防連點要包在這裡——
  // 授權碼送兩次，第二次一定是錯的（碼已經被用掉了），學生看到的是一個看不懂的
  // 失敗。
  form.addEventListener(
    "submit",
    guardClick((event) => {
      event.preventDefault();
      return model.onLoginInput(input.value, input);
    }),
  );
  hints.append(link, codeRow, form);
  return hints;
}

function renderCard(model) {
  elements.configChoicePanel.hidden = model.card.kind !== "setup";
  const article = document.createElement("article");
  article.className = `ds-card current-task-card current-task-card--${model.card.agent}`;
  // 導覽要指得到「現在這張卡」。卡片每次都是重畫一張新的 article，所以身分要寫在
  // 元素上，tour.js 才有東西可以 querySelector。
  article.dataset.cardId = model.card.checkId ?? "";
  const header = document.createElement("header");
  header.className = "config-card-header";
  header.append(createLogo(model.card.logo));
  const copy = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = model.card.label;
  const detail = document.createElement("span");
  detail.textContent = model.card.detail;
  copy.append(title, detail);
  const pill = document.createElement("span");
  pill.className = model.status.className;
  pill.textContent = model.status.text;
  pill.dataset.cardStatus = model.status.status;
  header.append(copy, pill);
  article.append(header);

  if (model.card.kind === "setup") {
    const body = document.createElement("div");
    body.className = "current-task-body";
    body.append(elements.configChoicePanel);
    article.append(body);
  } else {
    const body = document.createElement("div");
    body.className = "current-task-body";
    // 執行結果不另外開一塊——它掛在自查清單每一項底下（見 checklistGroups），
    // 同一個檢查的名稱與結果放在一起，讀的人不用自己配對。
    // 登入那一塊畫在清單裡它對應的那一格底下（見 checklistElement）。清單沒出現時
    // 才退回畫在外面——不然那張卡會完全沒有登入入口。
    const loginInChecklist =
      model.showChecklist === true && model.login !== null;

    // 修某一格的按鈕（「開始登入」）掛回那一格底下，不留在下面的按鈕列。清單沒出現
    // 時才退回按鈕列——不然那張卡會完全沒有那顆按鈕。
    const inlineSpecs = model.showChecklist
      ? (model.row?.buttons ?? []).filter((spec) => spec.checkId !== undefined)
      : [];
    const inlineActions = new Map(
      inlineSpecs.map((spec) => [
        `system-${spec.checkId}`,
        actionButton({ ...spec, hoverFill: true }, model.onActionClick),
      ]),
    );

    if (model.showChecklist) {
      body.append(
        checklistElement(model.checklist, model.onManualToggle, {
          manualSteps: model.manualSteps ?? [],
          pasteProof: model.pasteProof ?? null,
          login: loginInChecklist
            ? {
                ...model.login,
                onCopyLoginCode: model.onCopyLoginCode,
                onLoginInput: model.onLoginInput,
              }
            : null,
          onOpen: model.onOpenStep ?? (() => {}),
          inlineActions,
          walkthroughs: model.walkthroughs ?? new Map(),
          onWalkthrough: model.onWalkthrough ?? (() => {}),
        }),
      );
    }
    // 驗證留下的截圖直接貼在卡片上。這一格的證據就是那個檔案，看得到那片圖牆，
    // 「真的有一顆瀏覽器被開起來」才不只是一句話。
    if (model.verifyShot !== null && model.verifyShot !== undefined) {
      const figure = document.createElement("figure");
      figure.className = "verify-shot";
      const image = document.createElement("img");
      image.src = model.verifyShot;
      image.alt = "Playwright 驗證時抓到的網頁截圖";
      image.loading = "lazy";
      // 檔案不在（還沒驗過、或被刪了）就整塊收掉，不要留一個破圖示。
      image.addEventListener("error", () => figure.remove());
      const caption = document.createElement("figcaption");
      caption.textContent = "這張圖是剛才那顆瀏覽器截的";
      figure.append(image, caption);
      body.append(figure);
    }
    if (model.hints !== null && model.hints !== undefined) {
      const hints = document.createElement("div");
      hints.className = "card-hints";
      const title = document.createElement("p");
      title.className = "paste-proof-hint";
      title.textContent = model.hints.title;
      // 這一塊照原樣印終端裡會出現的字，所以就畫成一個終端。原本是一個裸的 <code>
      //（淺底、跟卡片同色），學生要自己想像它在終端裡長什麼樣。
      hints.append(title, staticTerminal(model.hints.lines));
      body.append(hints);
    }
    // 貼上欄位已經被畫在清單裡它證明的那一格底下時，這裡就不再畫一次。
    const pasteInChecklist =
      model.showChecklist === true &&
      (model.manualSteps ?? []).some((step) => step.id === "fullscreen-proof");

    if (
      !pasteInChecklist &&
      model.pasteProof !== null &&
      model.pasteProof !== undefined
    ) {
      body.append(pasteProofElement(model.pasteProof));
    }
    const actions = document.createElement("div");
    actions.className = "env-actions";
    // 純人工的卡（全螢幕模式）沒有 row：沒有安裝也沒有驗證，自然沒有按鈕。
    // 這裡少一個 ?. 會讓整個 render 中止，畫面停在上一張、「下一張」按了沒反應——
    // 而且錯誤只留在 console，學生只看到按鈕壞掉（VM 實測）。
    //
    // 已經畫進清單的那幾顆不再重複一次。
    for (const spec of model.row?.buttons ?? []) {
      if (inlineActions.has(`system-${spec.checkId}`)) continue;

      actions.append(actionButton(spec, model.onActionClick));
    }
    if (model.showRetest) {
      // 裝好了、只差驗證的那張卡，主要動作就是這一顆——安裝按鈕已經灰掉了，
      // 這裡不預先灌滿的話整張卡會找不到「現在該按哪顆」。
      const retest = fillButton({
        // env 卡按下去是重掃一次狀態，config 卡是真的開終端跑。
        icon: model.retestText === "再 check 一次" ? "reinstall" : "terminal",
        text: model.retestText ?? "再 check 一次",
        primary: model.retestPrimary === true,
        onClick: model.onRetest,
      });
      // 導覽要指得到這顆（見 tour-model.js 的 COMPONENT_TOUR_STEPS）。
      retest.dataset.retest = "true";
      // 兩顆長得一樣、做的事不一樣：env 卡是重掃電腦狀態，config 卡是真的開一個
      // 終端跑一遍。導覽要當成兩個元件各講一次，不然學生第一次遇到會開終端的那顆
      // 時，說明已經在環境段被當成「講過了」。
      retest.dataset.retestKind =
        model.retestText === "再 check 一次" ? "rescan" : "verify";
      actions.append(retest);
    }
    body.append(actions);
    if (!loginInChecklist && model.login !== null) {
      body.append(
        loginControlsElement({
          ...model.login,
          onCopyLoginCode: model.onCopyLoginCode,
          onLoginInput: model.onLoginInput,
        }),
      );
    }
    article.append(body);
  }

  // 翻頁按鈕不在卡片裡：它釘在畫面兩側，位置固定（見 renderWizardNav）。
  elements.currentCard.replaceChildren(article);
  elements.currentCard.setAttribute("aria-busy", "false");
}

// 上一次兩顆翻頁按鈕露臉了沒。慶祝只在「原本沒有、現在出現」那一刻放——每次重畫
// 都放的話，勾一個項目就會炸一次煙火。
const shownNav = { prev: false, next: false };

function renderNavButton(button, spec, key) {
  const show = spec.show === true;

  if (show) {
    button.querySelector(".wizard-nav-label").textContent = spec.label;
    button.onclick = spec.onClick;
  }

  button.hidden = !show;

  // 解鎖那一刻放一段施法特效。回頭的那顆不用——它出現不是成就，只是「你可以往回看」。
  if (show && !shownNav[key] && key === "next" && !reducedMotion.matches) {
    playUnlockSpell(button);
  }

  shownNav[key] = show;
}

// 解鎖下一張時的那一段（Reed 指定的順序）：
//
//   1. 巫師在按鈕的位置施法，演完
//   2. 爆炸開始的同時，巫師縮到最小再消失——縮的時間跟爆炸一樣長
//   3. 爆炸演完收掉
//   4. 按鈕淡進來
//
// 施法期間按鈕是隱形的，但仍然佔著位置：拿掉的話它旁邊的東西會位移，特效的中心點
// 也跟著跑掉。
let castingSpell = false;

function playUnlockSpell(button) {
  // 同一輪只放一次。renderWizardNav 每次重畫都會叫，中途再叫一次會把演到一半的
  // 特效洗掉。
  if (castingSpell) return;

  const stage = elements.wizardUnlock;

  if (stage === null) return;

  castingSpell = true;
  stage.replaceChildren();
  stage.classList.add("is-casting");
  button.classList.add("is-casting");

  const finish = () => {
    castingSpell = false;
    stage.classList.remove("is-casting");
    stage.replaceChildren();
    button.classList.remove("is-casting");
    button.classList.add("is-revealing");
    window.setTimeout(() => button.classList.remove("is-revealing"), 600);
  };

  const wizard = lottieControl({
    url: "/vendor/wizard.json",
    className: "wizard-unlock-wizard",
    loop: false,
    autoplay: false,
  });
  stage.append(wizard.box);

  wizard.ready.then((wizardAnimation) => {
    // 動畫載不到就別讓按鈕卡在隱形狀態——少一段特效不該把「下一張」弄不見。
    if (wizardAnimation === null) {
      finish();
      return;
    }

    wizardAnimation.addEventListener("complete", () => {
      const blast = lottieControl({
        url: "/vendor/explosion.json",
        className: "wizard-unlock-blast",
        loop: false,
        autoplay: false,
      });
      stage.append(blast.box);

      blast.ready.then((blastAnimation) => {
        if (blastAnimation === null) {
          finish();
          return;
        }

        // 縮小的時間就是爆炸的時間——問動畫本人，不要另外寫一個會跟它對不起來的
        // 常數（換一版動畫長度就變了）。
        const seconds = blastAnimation.getDuration(false);
        wizard.box.style.setProperty("--spell-shrink", `${seconds}s`);
        // 先讓瀏覽器結算一次，transition 才會從原本的大小開始跑，而不是直接跳到底。
        void wizard.box.offsetWidth;
        wizard.box.classList.add("is-shrinking");
        blastAnimation.addEventListener("complete", finish);
        blastAnimation.play();
      });
    });

    wizardAnimation.play();
  });
}

export function renderWizardNav({ prev, next }) {
  renderNavButton(elements.wizardPrev, prev, "prev");
  renderNavButton(elements.wizardNext, next, "next");
}

export function renderWizard(model) {
  elements.sectionStatus.textContent = model.sectionStatus;
  showSection(model.section.id);
  renderMilestones(model.section.id, model.milestones, model.onMilestoneSelect);
  renderCard(model.cardModel);
}

export function showSection(sectionId) {
  for (const button of elements.sectionButtons) {
    const current = button.dataset.sectionTarget === sectionId;
    button.classList.toggle("current", current);
    if (current) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
  }
}

export function onSectionSelect(handler) {
  for (const button of elements.sectionButtons) {
    button.addEventListener("click", () => {
      // 開鎖動畫在這裡放，不在剛達成條件的那一刻放。剛開的時候學生多半人在別的
      // 分頁上做事，動畫演完他也沒看到——那正是要提醒他的那件事。
      openPendingLock(button);
      handler(button.dataset.sectionTarget);
    });
  }
}

// 鎖頭畫在標題前面。原本鎖住的分頁只是淡一點——淡的東西看起來像「還沒載入」或
// 「壞掉」，不像「做完前面才會開」。鎖頭一眼就說得清楚。
//
// 改用 lottie（Reed 指定的 LOCK WITH GREEN TICK）之後，鎖頭變成一個三態的東西，
// 剛好對上分頁的三種狀態。那支動畫整段是「組裝 → 上鎖 → 晃 → 開鎖 → 打勾」：
//
//   0 – 31    組裝（一個點長成一把鎖）——沒有任何狀態要演這段，會一直在動
//   32        鎖成形、靜止              ← 鎖著（前面還沒做完）
//   60        鎖環開了、鎖身還在        ← 開了，但這一段還沒做完
//   140       綠色打勾                  ← 這一段最後一張也驗過了
//
// 三個數字都是把每一格畫出來看出來的（這支沒有 markers 可以照），不是猜的。
// 60 特別挑過：61 之後鎖身開始傾斜縮小要離場，停在那裡看起來像畫到一半。
const LOCK_CLOSED_FRAME = 32;
const LOCK_OPEN_FRAME = 60;
const LOCK_DONE_FRAME = 140;
// 原速 30fps。開鎖 28 格、打勾 80 格，照原速是 0.9 秒與 2.7 秒——後者對一個分頁
// 上的小圖示太久，所以各自加速。
const LOCK_UNLOCK_SPEED = 1.5;
const LOCK_DONE_SPEED = 2;

// 每個分頁的鎖頭各有一份動畫實例與目前停在哪一態，狀態變了才播。
const lockAnimations = new WeakMap();

function lockIcon(button) {
  const { box, ready } = lottieControl({
    url: "/vendor/lock.json",
    className: "section-tab-lock",
    loop: false,
    autoplay: false,
    startFrame: LOCK_CLOSED_FRAME,
  });
  lockAnimations.set(button, ready);
  return box;
}

// 三態在動畫上是由早到晚的三格，順序有意義（見底下只往前演的規則）。
const LOCK_STATES = ["locked", "open", "done"];
const LOCK_FRAMES = {
  locked: LOCK_CLOSED_FRAME,
  open: LOCK_OPEN_FRAME,
  done: LOCK_DONE_FRAME,
};

// 剛達成解鎖條件、但學生還沒點進去的那幾個分頁。
//
// 這一刻不放開鎖動畫：學生人在別的分頁上做事，演完他也沒看到——而那正是最需要
// 讓他知道的一件事。所以鎖頭留在上鎖那一格，改成放大兩倍加輕微左右搖（見
// styles.css 的 .is-announcing），一直招手到他點進來為止。點進來才放開鎖動畫，
// 演完定格在開鎖那一格，再縮回原尺寸（Reed 指定的順序）。
const pendingUnlock = new Set();

function openPendingLock(button) {
  const id = button.dataset.sectionTarget;

  if (!pendingUnlock.has(id)) return;

  pendingUnlock.delete(id);
  const lock = button.querySelector(".section-tab-lock");

  // 先收掉搖晃，但尺寸留到動畫演完才縮——邊開鎖邊縮小的話，那 0.6 秒只看得到
  // 一個越來越小的東西，看不清楚它在開。
  lock?.classList.remove("is-announcing");
  lock?.classList.add("is-opening");

  lockAnimations.get(button)?.then((animation) => {
    if (animation === null || animation === undefined) {
      lock?.classList.remove("is-opening");
      return;
    }

    const shrink = () => {
      animation.removeEventListener("complete", shrink);
      lock?.classList.remove("is-opening");
      // 同 playLockTo：播過區間之後 currentFrame 變成相對值，要收回來才對得上。
      animation.resetSegments(true);
      animation.goToAndStop(LOCK_OPEN_FRAME, true);
    };

    if (reducedMotion.matches) {
      animation.goToAndStop(LOCK_OPEN_FRAME, true);
      shrink();
      return;
    }

    animation.addEventListener("complete", shrink);
    animation.setSpeed(LOCK_UNLOCK_SPEED);
    animation.playSegments([LOCK_CLOSED_FRAME, LOCK_OPEN_FRAME], true);
  });
}

// 從哪一態走到哪一態，就播那一段。三種情況不演，直接跳到該停的那一格：
//
//   第一次畫       一開頁四個鎖頭一起演，學生根本不知道那是在演什麼
//   往回退         例如換了工具選項害某一段又鎖回去。往回不是慶祝，不用演；
//                  而且 lottie 的 playSegments 只往前播，餵一段反向的區間會停在
//                  中間某一格不動（實際踩到：兩個鎖頭卡在開到一半的姿勢，
//                  程式問它在第幾格還是回答對的那一格，對不起來）
//   減少動態       系統設定要尊重，但狀態還是要看得到
function playLockTo(button, state, previous) {
  const lock = button.querySelector(".section-tab-lock");

  lockAnimations.get(button)?.then((animation) => {
    if (animation === null || animation === undefined) return;

    const frame = LOCK_FRAMES[state];
    const forward =
      previous !== null &&
      LOCK_STATES.indexOf(state) > LOCK_STATES.indexOf(previous);

    if (!forward || reducedMotion.matches) {
      animation.goToAndStop(frame, true);
      return;
    }

    // 演完一定要回到定格。原本只靠 playSegments 自己停，被打斷就停在半路——
    // VM 上看到打勾那段停在綠底、勾還沒畫出來的那一格（Reed 回報）。
    const settle = () => {
      animation.removeEventListener("complete", settle);
      lock?.classList.remove("is-playing");
      // resetSegments 一定要在 goToAndStop 之前。播過區間之後，lottie 的
      // currentFrame 是「從區間起點算起」的相對值——播完 [32, 60] 它會回報 27
      // （32 + 27 = 59），診斷資料上看起來像停在還沒成形的那一格。
      animation.resetSegments(true);
      animation.goToAndStop(frame, true);
    };

    lock?.classList.add("is-playing");
    animation.addEventListener("complete", settle);
    animation.setSpeed(state === "done" ? LOCK_DONE_SPEED : LOCK_UNLOCK_SPEED);
    animation.playSegments([LOCK_FRAMES[previous], frame], true);
  });
}

function fireworkAt(percent) {
  const firework = document.createElement("span");
  firework.className = "ds-firework";
  firework.style.setProperty("--firework-at", `${percent}%`);
  firework.setAttribute("aria-hidden", "true");
  for (let ray = 0; ray < 10; ray += 1) {
    const particle = document.createElement("i");
    particle.style.setProperty("--ray", `${ray * 36}deg`);
    firework.append(particle);
  }
  return firework;
}

// 上一次每個分頁停在哪一態。動畫只在「真的換了一態」那一刻放——每次重畫都放的話，
// 光是勾一個項目就會炸一次煙火。
let renderedLocks = null;
// 上一次「算出來」的狀態。跟上面那份的差別是：這份照單全收，上面那份只收連續
// 兩次算出同一個答案的（見 confirmedState）。
let observedLocks = null;

// 只出現一次的狀態不算數。
//
// VM 實測：規矩段才做到第一張，分頁上的鎖頭卻開始播打勾，播到一半又被打斷，
// 停在「綠底、勾還沒畫完」那一格。事後去問每一格的狀態，答案全是對的——代表
// 完成度在某一次重畫時短暫算成了 true，下一次又回到 false。
//
// 那種一閃而過的值不該觸發一秒多的動畫。所以要連續兩次算出同一個狀態才承認，
// 中間那一次不一致就沿用上次承認過的。第一次畫沒有東西可比，直接承認。
//
// 這沒有修掉「為什麼會短暫算錯」——那要另外查。但一次性的雜訊本來就不該讓畫面
// 演一段慶祝動畫，這道關卡該有，跟根因是什麼無關。
// 「複製診斷資料」帶走的段落狀態：哪一段做完了、哪一段還鎖著。
//
// 這裡曾經有兩樣東西也一起送：一份 200 筆的鎖頭逐筆變化紀錄，以及每個分頁的 lottie
// 幀號與 class。兩樣都是為了查「完成度會短暫算錯、於是畫面演一段不該演的動畫」那個
// bug——那個瞬間本機重現不出來，只能請 VM 上的人整包送回來。
//
// 那個 bug 查完也修好了，而診斷資料現在帶的是原始輸出，真正判斷得了問題的東西。
// 幀號留著只會把它淹掉，而且它講的事下面這一行已經直說了（Reed 指定移除）。
//
// 真的又需要那些細節時，git log 找得回來——它們的價值在當時，不在常駐。
export function sectionLockStates() {
  return { ...renderedLocks };
}

// 這裡曾經有一道「要連續兩次算出同一個狀態才承認」的關卡（confirmedState），
// 用來擋掉疑似一閃而過的完成度。紀錄器裝上去之後，VM 的實際 log 推翻了那個假設：
//
//   8387   skills / demo 算出 locked，畫面上到 17131 才變 locked（慢了 8.7 秒）
//   19920  env 算出 done，打勾到 30938 才演（慢了 11 秒）
//
// 每一筆狀態變化都是持久的，沒有任何一筆閃一下就回去。那道關卡沒擋到雜訊，只是
// 讓每一次真實的變化都慢一整輪重畫——而重畫是事件驅動的，兩輪之間可能隔十幾秒。
// 已經拿掉。紀錄器留著：綠圈圈那個畫面如果再出現，這次會有完整的軌跡可以看。

// 鎖著 → 開了 → 打勾。三態各對應鎖頭動畫的一格（見 LOCK_FRAMES）。
//
// 判斷順序有意義：一段可以「開了但還沒做完」，但不可能「做完了還鎖著」——
// 所以先看鎖，再看做完沒。
function lockStateOf(lockStates, done, id) {
  if (lockStates[id]?.locked === true) return "locked";
  // undefined 是「還不知道」（資料還沒回來），那就當還沒做完，不要先給人打勾。
  return done?.[id] === true ? "done" : "open";
}

// 煙火只放在解鎖與完成那兩刻，而且只放一次。
function celebrate(button) {
  if (reducedMotion.matches) return;
  button.classList.remove("is-unlocking");
  // 讀一次 offsetWidth 逼瀏覽器結算，不然連續兩次解鎖的第二次不會重播動畫。
  void button.offsetWidth;
  button.classList.add("is-unlocking");
  const firework = fireworkAt(50);
  button.append(firework);
  window.setTimeout(() => {
    button.classList.remove("is-unlocking");
    firework.remove();
  }, 900);
}

export function renderSectionLocks(lockStates, done = {}) {
  const next = {};
  const observed = {};

  for (const button of elements.sectionButtons) {
    const id = button.dataset.sectionTarget;
    const state = lockStateOf(lockStates, done, id);
    const previous = renderedLocks?.[id] ?? null;
    // observed 記的是「這一輪算出來的原始狀態」，跟 next（承認的）分開存——
    // confirmedState 那段的關卡就是靠兩者的差別在判斷。
    observed[id] = state;
    next[id] = state;

    if (button.querySelector(".section-tab-lock") === null) {
      button.prepend(lockIcon(button));
    }

    // 剛從鎖著變成開了：先不演，改成招手（放大＋搖晃），等學生點進來才開鎖。
    // 減少動態時不招手，照常直接開——會動的東西是提醒，關掉就得換個方式講，
    // 而這裡「換個方式」就是分頁本來就變得可以點了。
    const justOpened =
      previous === "locked" && state === "open" && !reducedMotion.matches;

    if (justOpened) {
      pendingUnlock.add(id);
    }

    // 又鎖回去、或整段已經做完了，就沒有什麼好招手的。
    if (state !== "open") {
      pendingUnlock.delete(id);
    }

    // 招手期間鎖頭留在上鎖那一格。這裡不能餵真正的 state，餵了它就直接跳到開鎖，
    // 學生點進來也沒東西可演。
    const pending = pendingUnlock.has(id);
    const lock = button.querySelector(".section-tab-lock");

    // 開鎖動畫正在演的那 0.6 秒不要碰它。這個函式每次重畫都會跑（勾一個項目、
    // 環境檢查回來都算），這時候餵它 open 就是 goToAndStop 到最後一格——動畫演到
    // 一半被切掉，學生只看到鎖突然變成開的。
    // is-playing 是同一件事的另一半：打勾那 1.35 秒也不能被重畫打斷（見 playLockTo）。
    if (
      !lock?.classList.contains("is-opening") &&
      !lock?.classList.contains("is-playing")
    ) {
      // 第一次畫不放動畫：一開頁就炸煙火的話，學生根本不知道那是在慶祝什麼。
      playLockTo(button, pending ? "locked" : state, pending ? null : previous);
    }
    lock?.classList.toggle("is-announcing", pending);

    // 慶祝只給往前走的那一步。往回退（例如換了工具選項害某一段又鎖回去）不是
    // 成就，炸煙火只會讓人以為自己做對了什麼。
    if (
      previous !== null &&
      LOCK_STATES.indexOf(state) > LOCK_STATES.indexOf(previous)
    ) {
      celebrate(button);
    }

    const locked = state === "locked";
    button.classList.toggle("is-locked", locked);
    button.classList.toggle("is-section-done", state === "done");
    if (locked) button.setAttribute("aria-disabled", "true");
    else button.removeAttribute("aria-disabled");
  }

  renderedLocks = next;
  observedLocks = observed;
}

export function showSectionLockMessage(message) {
  elements.sectionLockMessage.textContent = message;
  elements.sectionLockMessage.hidden = false;
}

export function hideSectionLockMessage() {
  elements.sectionLockMessage.hidden = true;
}

export function renderGateVisibility() {}
export function onGateToggle() {}

export function renderConfigChoices(toolChoices, languages) {
  const toolButtons = toolChoices
    .filter((choice) => !choice.value.includes(","))
    .map((choice) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ds-pill";
      button.dataset.tool = choice.value;
      button.textContent = `#${choice.label}`;
      button.setAttribute("aria-pressed", "false");
      return button;
    });
  const languageButtons = languages.map((language) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ds-pill";
    button.dataset.lang = language;
    button.textContent = `#${language}`;
    button.setAttribute("aria-pressed", "false");
    return button;
  });
  elements.configTools.replaceChildren(...toolButtons);
  elements.configLang.replaceChildren(...languageButtons);
  setConfigSelection(["claude"], "zh-TW");
}

export function setConfigSelection(tools, lang) {
  elements.configTools.dataset.value = tools.join(",");
  elements.configLang.dataset.value = lang;
  for (const button of elements.configTools.querySelectorAll("[data-tool]")) {
    const selected = tools.includes(button.dataset.tool);
    button.classList.toggle("ds-pill-accent", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
  for (const button of elements.configLang.querySelectorAll("[data-lang]")) {
    const selected = button.dataset.lang === lang;
    button.classList.toggle("ds-pill-accent", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
}

export function configValues() {
  return {
    tools: elements.configTools.dataset.value,
    lang: elements.configLang.dataset.value,
  };
}

export function onToolSelect(handler) {
  elements.configTools.addEventListener("click", (event) => {
    const button = event.target.closest("[data-tool]");
    if (button !== null) handler(button.dataset.tool);
  });
}

export function onLanguageSelect(handler) {
  elements.configLang.addEventListener("click", (event) => {
    const button = event.target.closest("[data-lang]");
    if (button !== null) handler(button.dataset.lang);
  });
}

// 終端頂欄那隻常駐的小人。
//
// 原本轉圈圈是「一次一輪、跟著訊息行走、跑完收回池子」：一件事做完它就消失，
// 學生看著一個空掉的終端，也分不出「還在跑」與「跑完了」。改成一直在，用三段
// 動作講現在是什麼狀態（Reed 指定）。
//
// 三段的幀號是拿 tools/loader-frame-inspector.html 逐幀圈出來的（決策與否決的
// 路線見 docs/loader-frame-inspector.md）：這支動畫沒有 marker、也沒有圖片資產，
// 只能靠幀號切。改動畫之後這三組數字要重圈。
// 四段，不是三段：「抽出電腦」是過場，只能演一次。
//
// 一開始把 9–35 整段當成「工作中」循環播，畫面上每 2.25 秒就重演一次抽電腦——
// 看起來像動畫在輪播，不像一直在做同一件事（Reed 實測指出）。過場拆出來之後，
// 循環的只剩真的在打字的那 20 幀。
//
// 幀號是拿 tools/loader-frame-inspector.html 逐幀圈出來的（決策與否決的路線見
// docs/loader-frame-inspector.md）：這支動畫沒有 marker、也沒有圖片資產，只能靠
// 幀號切。動畫是逐格的（0–42 每一幀都是關鍵幀），換動畫之後這幾組數字要重圈。
const MASCOT_SEGMENTS = {
  idle: [0, 8],
  "work-in": [9, 15],
  work: [16, 35],
  outro: [36, 42],
};

// 演完就自己走到下一個狀態的那兩段。循環的兩段不在這裡。
const MASCOT_NEXT = {
  "work-in": "work",
  outro: "idle",
};

let mascotAnimation = null;
let mascotState = "idle";

function applyMascotState(state) {
  if (mascotAnimation === null) return;

  const segment = MASCOT_SEGMENTS[state];

  if (segment === undefined) return;

  // 系統設了「減少動態」就只換姿勢不播——動畫是氣氛，不是資訊。
  if (reducedMotion.matches) {
    mascotAnimation.goToAndStop(segment[0], true);
    return;
  }

  // 每一段都自己播到底（loop = false），循環那兩段的「再來一次」由 complete 接手
  // 倒著播回來——正播完直接跳回起點會有一下跳接，來回播就沒有接縫。
  //
  // 換段時方向一定要歸零：上一段可能停在倒播，不歸零的話新的一段會從尾巴往回演。
  mascotAnimation.loop = false;
  mascotAnimation.setDirection(1);
  mascotAnimation.playSegments(segment, true);
}

// 沒事＝待機、開跑＝抽出電腦再打字、跑完＝收電腦再回待機。
//
// 已經在工作就不重來：renderLoaders 每印一行就會叫一次，每次都從頭抽電腦的話，
// 小人會卡在過場裡永遠打不到字。收電腦同理。
export function setMascotState(state) {
  if (state === "work" && (mascotState === "work" || mascotState === "work-in")) {
    return;
  }

  if (state === "outro" && (mascotState === "outro" || mascotState === "idle")) {
    return;
  }

  if (state === mascotState) return;

  mascotState = state === "work" ? "work-in" : state;
  applyMascotState(mascotState);
}

const mascot = lottieControl({
  url: "/vendor/loader-claude.json",
  className: "terminal-mascot-art",
  loop: true,
  autoplay: false,
});
elements.terminalMascot.append(mascot.box);
mascot.ready.then((animation) => {
  if (animation === null) return;

  mascotAnimation = animation;
  animation.addEventListener("complete", () => {
    // 過場演完就走到下一個狀態：抽完電腦接著打字，收完電腦回到待機。
    const next = MASCOT_NEXT[mascotState];

    if (next !== undefined) {
      mascotState = next;
      applyMascotState(next);
      return;
    }

    // 循環那兩段（待機、打字）改成來回播：正播到底就倒著播回來，倒到底再正播。
    // 直接跳回起點會有一下跳接，來回播沒有接縫。
    animation.setDirection(animation.playDirection * -1);
    animation.play();
  });
  applyMascotState(mascotState);
});

const loaderLabels = {
  [LOADER_MODIFIERS.working]: "正在安裝，完成後會自動更新。",
  [LOADER_MODIFIERS.searching]: "正在檢查目前狀態。",
  [LOADER_MODIFIERS.listening]: "新終端已開啟，正在等驗證結果。",
  [LOADER_MODIFIERS.solving]: "正在判定結果。",
  [LOADER_MODIFIERS.composing]: "正在檢查回覆格式。",
  [LOADER_MODIFIERS.shaping]: "正在產出示範畫面。",
};
// 每張卡各有一份終端內容。原本全站共用一份，於是換一張卡就看到上一張的驗證訊息
// ——那些話講的是別的東西，留在畫面上只會讓學生以為現在這張已經跑過了。翻回上一張
// 時也要看得到當時那一份，不然「剛才那句錯誤訊息寫什麼」就再也查不到了。
const transcripts = new Map();
const rawOutputs = new Map();
const INITIAL_TRANSCRIPT = "__opening__";
let activeTranscriptId = INITIAL_TRANSCRIPT;

// 跑起來之後就釘住：驗證跑到一半學生翻回上一張卡，結果仍然要記在發動它的那張卡
// 上，不能印到他現在正在看的這張。
let pinnedTranscriptId = null;

transcripts.set(
  INITIAL_TRANSCRIPT,
  [...elements.terminalLines.children].map((line) => ({
    className: line.className,
    text: line.textContent,
  })),
);

function linesOf(id) {
  if (!transcripts.has(id)) {
    transcripts.set(id, []);
  }

  return transcripts.get(id);
}

function writeTargetId() {
  return pinnedTranscriptId ?? activeTranscriptId;
}

// 收下這一行嗎？收下的話還要回答「現在看得到嗎」——寫進別張卡的那一份時只存不畫。
function acceptsTerminalLine(spec) {
  const id = writeTargetId();
  const lines = linesOf(id);
  const next = appendTermLine(lines, spec);

  if (next === lines) {
    return false;
  }

  transcripts.set(id, next);
  return id === activeTranscriptId;
}

// 這裡曾經有一個永遠待在最後一行字尾的閃爍游標。拿掉了（Reed 指定）：終端裡本來
// 就有逐字打字與轉圈圈兩種東西在動，再多一個一直閃的方塊只是把視線扯走。
//
// 保留這個空函式的位置沒有意義，呼叫端也一併清掉了。


// 新的一行逐字打出來，像真的終端在跑。
//
// 三條規矩，都是為了「動畫不能拖慢真的進度」：
//   排隊超過三行就整批直接印完——驗證一次會噴很多行，一行一行演會落後好幾秒
//   系統設了「減少動態」就不演
//   翻回舊卡片的紀錄不演（那是歷史，不是正在發生的事）
// 一秒二十個字（Reed 指定）。一句 15 字的白話進度約 0.75 秒打完——看得出在打字，
// 又不會讓學生等著讀完。
const TYPING_CHARS_PER_SECOND = 20;
const TYPING_STEP_MS = Math.round(1000 / TYPING_CHARS_PER_SECOND);
const TYPING_CHARS_PER_STEP = 1;
const typingQueue = [];
let typingTimer = null;

function stopTyping() {
  window.clearInterval(typingTimer);
  typingTimer = null;
}

function flushTyping() {
  for (const job of typingQueue) {
    job.line.textContent = job.text;
  }

  typingQueue.length = 0;
  stopTyping();
}

function startTyping() {
  if (typingQueue.length > 3) {
    flushTyping();
    return;
  }

  if (typingTimer !== null) return;

  typingTimer = window.setInterval(() => {
    const job = typingQueue[0];

    if (job === undefined) {
      stopTyping();
      return;
    }

    job.at += TYPING_CHARS_PER_STEP;
    job.line.textContent = job.text.slice(0, job.at);

    if (job.at >= job.text.length) {
      typingQueue.shift();
    }
  }, TYPING_STEP_MS);
}

function typeInto(line, text) {
  if (reducedMotion.matches) {
    line.textContent = text;
    return;
  }

  line.textContent = "";
  typingQueue.push({ line, text, at: 0 });
  startTyping();
}

function paintTranscript(id) {
  // 換卡片時把還在演的那幾行直接印完，不然它們會打在新那張卡的終端上。
  flushTyping();
  elements.terminalLines.replaceChildren();

  for (const spec of linesOf(id)) {
    const line = document.createElement("div");
    line.className = spec.className;
    line.textContent = spec.text;
    elements.terminalLines.append(line);
  }

  // 還原的是歷史，不是正在發生的事：直接印，也不留轉圈圈。
  elements.output.textContent = rawOutputs.get(id) ?? "";
}

// 切到某一張卡的終端。沒看過的卡從空的開始——開場白那份留在它自己的位置上。
export function showTranscript(id) {
  if (id === activeTranscriptId) return;
  hideLoaders();
  activeTranscriptId = id;
  paintTranscript(id);
}

export function pinTranscript(id) {
  pinnedTranscriptId = id;
}

export function unpinTranscript() {
  pinnedTranscriptId = null;
}

// 事情做完了：小人收電腦，收完自己回到待機。名字留著不改，呼叫端講的仍是同一件事。
export function hideLoaders() {
  setMascotState("outro");
}

export function renderLoaders({ modifier, paused = false, label = null }) {
  if (loaderLabels[modifier] === undefined) return;

  // 轉圈圈不再跟著這一行走——小人常駐在終端頂欄，這裡只負責印字與換小人的狀態。
  // 停下來的時候也讓它收電腦：畫面上「處理已停止。」跟一隻還在打字的小人是矛盾的。
  setMascotState(paused ? "outro" : "work");

  const spec = {
    className: "ds-term-line ds-term-line--dim",
    // label 是呼叫端指定的字：同一種狀態可以用在不只一件事上（驗證借用安裝那句），
    // 預設字只在沒指定時才算數。
    text: paused ? "處理已停止。" : (label ?? loaderLabels[modifier]),
  };

  // 同一句話不重複印。
  //
  // 這裡曾經還要「把轉圈圈重新掛回最後那一行」：學生在環境卡上按「再 check 一次」，
  // 那句「正在檢查目前狀態。」跟上一次一模一樣，去重把整個 renderLoaders 擋掉，
  // 連轉圈圈都沒出現，看起來就是按了完全沒反應（VM 實測）。小人常駐之後這個坑
  // 消失了——它不在那一行上，狀態在上面已經換好了。
  if (!acceptsTerminalLine(spec)) return;

  const line = document.createElement("div");
  line.className = spec.className;
  const text = document.createElement("span");
  line.append(text);
  elements.terminalLines.append(line);
  typeInto(text, spec.text);
}

// 一張卡保留最近幾次執行。
//
// 這裡原本每跑一輪就把上一輪整個清掉，理由是「留著會分不清哪段是剛才那次」。分段
// 的問題用一條分隔線就解決了，而清掉的代價要大得多：學生遇到失敗的第一個動作就是
// 再按一次，那時失敗那次的輸出已經沒了——而我們要判斷的正是失敗那次。
//
// 三次是拿捏過的：夠涵蓋「失敗 → 重試 → 再失敗」這條最常見的求助情境，又不會讓
// 一直重按的卡片把剪貼簿塞爆。
const MAX_KEPT_RUNS = 3;
const RUN_SEPARATOR = "──────────────── 上一次執行到此 ────────────────";

// 每張卡存一個陣列，一格一次執行。存字串再靠分隔線切回來也做得到，但那樣「保留幾
// 次」就變成字串處理，而分隔線本身也可能出現在子行程的輸出裡。
const rawRuns = new Map();

function runsOf(id) {
  return rawRuns.get(id) ?? [];
}

function renderRawOutput(id) {
  return runsOf(id).join(`\n${RUN_SEPARATOR}\n\n`);
}

// 開始新的一輪：推一格新的，並把太舊的丟掉。
export function clearRawOutput() {
  const id = writeTargetId();
  const runs = [...runsOf(id), ""].slice(-MAX_KEPT_RUNS);
  rawRuns.set(id, runs);
  rawOutputs.set(id, renderRawOutput(id));

  if (id === activeTranscriptId) {
    elements.output.textContent = rawOutputs.get(id);
  }
}

// 目前這張卡的原始輸出。讀 rawOutputs 而不是 DOM 的 textContent：那兩份平常一致，
// 但切卡片的空檔會差一拍，而學生按複製鍵的時機正好就在那種時候。
export function rawOutputText() {
  return rawOutputs.get(activeTranscriptId) ?? "";
}

// 按「複製診斷資料」時一起帶走的東西：每張卡最近幾次執行的原始輸出。
//
// 那顆按鈕原本只收鎖頭與導覽的狀態——名字叫「診斷資料」，學生按了貼回來，我們拿到
// 的是動畫幀號。真正判斷得了問題的是這一份，而且它跨卡片：學生只複製得到當下那張，
// 但問題常常是前一張留下來的（環境重查拖累了規則卡的安裝）。
export function rawOutputDiagnostics() {
  return Object.fromEntries(
    [...rawRuns.keys()]
      .map((id) => [id, renderRawOutput(id)])
      .filter(([, text]) => text.trim() !== ""),
  );
}

// at 是「距這次執行開始幾毫秒」。標在原始輸出上，判斷問題時才看得出哪一步卡住
// ——今天查 winget 被中止那次，最硬的線索是「27 MB 下載跑了三分鐘」，而那件事完全
// 不在 log 裡。相對不是絕對：學生 VM 的時鐘常常是歪的，而我們要的是「花了多久」。
//
// 只標有帶 at 的行。環境檢查那幾列是一支 HTTP 請求的結果、不是逐字稿，標了沒有意義。
function stamp(at) {
  return typeof at === "number" ? `[+${(at / 1000).toFixed(1)}s] ` : "";
}

export function addRawLine(text, at = null) {
  const id = writeTargetId();
  const line = `${stamp(at)}${text}\n`;
  // 沒有人叫過 clearRawOutput 就先開一格：環境檢查那幾列是直接寫進來的，不走
  // 「開始一次執行」那條路。
  const runs = runsOf(id).length === 0 ? [""] : [...runsOf(id)];
  runs[runs.length - 1] += line;
  rawRuns.set(id, runs);
  rawOutputs.set(id, renderRawOutput(id));

  if (id === activeTranscriptId) {
    elements.output.textContent += line;
  }
}

export function addLine(text, className = "") {
  const spec = {
    className: `ds-term-line ${
      ["failed", "stderr", "agent-error"].includes(className)
        ? "ds-term-line--err"
        : className === "succeeded"
          ? "ds-term-line--ok"
          : "ds-term-line--dim"
    }`,
    text,
  };
  if (!acceptsTerminalLine(spec)) return;
  const line = document.createElement("div");
  line.className = spec.className;
  elements.terminalLines.append(line);
  typeInto(line, spec.text);
}

export function addTerminalLines(lines) {
  for (const spec of lines) {
    if (!acceptsTerminalLine(spec)) continue;
    const line = document.createElement("div");
    line.className = spec.className;
    elements.terminalLines.append(line);
    typeInto(line, spec.text);
  }
}

export function addAgentEvent(agentEvent, agentName) {
  addRawLine(`${agentName}${agentName ? "：" : ""}${agentEvent.text}`);
}

export function shakeTerminal() {
  if (reducedMotion.matches) return;
  elements.terminal.classList.remove("term-shake");
  requestAnimationFrame(() => elements.terminal.classList.add("term-shake"));
  window.setTimeout(() => elements.terminal.classList.remove("term-shake"), 400);
}

export function renderFailureGuidance({ guidance, explanation = null }) {
  if (guidance === null && explanation === null) return;
  if (explanation !== null) addLine(`白話說明：${explanation}`, "agent-status");
}

export function renderConfigSummary(summary) {
  elements.configSummary.textContent = summary.text;
}

export function renderConfigLoading() {
  elements.currentCard.setAttribute("aria-busy", "true");
}

export function renderConfigFailure(message) {
  addLine(`規則檔檢查失敗：${message}`, "failed");
}

export function renderEnvLoading() {
  elements.currentCard.setAttribute("aria-busy", "true");
}

export function renderEnvBusy(busy) {
  elements.currentCard.setAttribute("aria-busy", busy ? "true" : "false");
}

export function renderEnvFailure(message) {
  addLine(`環境檢查失敗：${message}`, "failed");
}

export function renderBehaviorFallback(state) {
  if (!state.visible) return;
  addLine("自動驗證沒有通過，可以照卡片上的自查項目確認。", "failed");
}

export function configActionButtons() {
  return [...elements.currentCard.querySelectorAll("[data-install-action], [data-merge-action], [data-verify-action], [data-diagnose-action]")];
}

export function envActionButtons() {
  return [...elements.currentCard.querySelectorAll("[data-install-action], [data-fix-action]")];
}

// 換字只換那個 <span>。整顆 textContent 洗掉的話，會把前面那個 icon 一起清掉，
// 按鈕從此變成一顆沒有圖示的空心藥丸（灌色按鈕的結構是 svg + span）。
export function setButtonLabel(button, text) {
  const label = button.querySelector("span");

  if (label === null) {
    button.textContent = text;
    return;
  }

  label.textContent = text;
}

export function renderEnvButton(button, state) {
  button.disabled = state.disabled;
  setButtonLabel(button, state.text);
}

export function renderRunControls(state) {
  for (const button of elements.actionButtons) button.disabled = state.actionButtonsDisabled;
  elements.prompt.disabled = state.promptDisabled;
  elements.allowWrite.disabled = state.allowWriteDisabled;
  elements.recheckEnv.disabled = state.recheckDisabled;
  elements.recheckConfigs.disabled = state.configControlsDisabled;
  for (const button of elements.configTools.querySelectorAll("button")) button.disabled = state.configControlsDisabled;
  for (const button of elements.configLang.querySelectorAll("button")) button.disabled = state.configControlsDisabled;
  for (const button of configActionButtons()) {
    button.disabled =
      state.configControlsDisabled ||
      button.classList.contains("is-done") ||
      button.dataset.permanentlyDisabled === "true";
  }
  elements.cancel.hidden = state.cancelHidden;
  elements.cancel.disabled = state.cancelDisabled;
  const runInput = elements.currentCard.querySelector("#run-input");
  if (runInput !== null && state.inputHidden) runInput.hidden = true;
}

export function showInstallStatus(message) {
  addLine(message.text, message.failed ? "failed" : "succeeded");
}

export function hideInstallStatus() {}

// 「停止等待」那顆的參照。等待一結束就要把它拿掉——留著的話學生看到一顆按下去
// 什麼都不會發生的按鈕（VM 實測：登入成功之後它還留在終端裡）。
//
// 只收按鈕、不收那一行字：那句「正在確認登入狀態…」是紀錄，留著讀得出經過。
let loginWaitingButton = null;

export function showLoginWaiting(onStop) {
  // 上一輪沒收乾淨就先收，不然畫面會出現兩顆。
  hideLoginWaiting();
  const line = document.createElement("div");
  line.className = "ds-term-line ds-term-line--dim";
  line.textContent = "正在確認登入狀態，完成後這裡會自動更新。";
  loginWaitingButton = fillButton({
    icon: "stop",
    text: "停止等待",
    onClick: onStop,
  });
  // 跟頂欄那顆取消鍵同一套：兩顆都站在深色的終端上（Reed 指定）。
  loginWaitingButton.classList.add("is-on-dark");
  line.append(loginWaitingButton);
  elements.terminalLines.append(line);
}

export function finishLoginWaiting(text, failed) {
  hideLoginWaiting();
  addLine(text, failed ? "failed" : "succeeded");
}

export function hideLoginWaiting() {
  // 換卡時終端內容會整份換掉，這顆可能已經不在畫面上——remove() 對脫離的節點
  // 也是安全的，不用先判斷。
  loginWaitingButton?.remove();
  loginWaitingButton = null;
}

export function showLoginHints(model) {
  if (model === null) return;
  const hints = elements.currentCard.querySelector("#login-hints");
  const link = elements.currentCard.querySelector("#login-url");
  const codeRow = elements.currentCard.querySelector("#login-code-row");
  const code = elements.currentCard.querySelector("#login-code");
  const runInput = elements.currentCard.querySelector("#run-input");
  if (hints === null) return;
  if (model.url !== null) {
    link.href = model.url;
    // 只換那個 <span>，不要洗掉整顆按鈕的內容。
    //
    // 灌色按鈕的結構是 svg + span，而且只有這兩者被拉到灌色層上面（設計系統的
    // .ds-btn-fill > svg, > span 有 z-index:1）。整顆 textContent 洗掉的話，icon
    // 沒了、字變成一個裸文字節點沉到灌色底下——畫面上就是一塊空的橘色方塊
    //（Reed 實測截圖）。setButtonLabel 存在就是為了這件事，這裡漏用了。
    setButtonLabel(link, model.linkText);
    link.hidden = false;
  }
  if (model.code !== null) {
    code.textContent = model.code;
    codeRow.hidden = false;
  }
  runInput.hidden = !model.showInput;
  hints.hidden = link.hidden && codeRow.hidden;
}

export function clearLoginHints() {
  const hints = elements.currentCard.querySelector("#login-hints");
  if (hints === null) return;
  const link = hints.querySelector("#login-url");
  const codeRow = hints.querySelector("#login-code-row");
  const code = hints.querySelector("#login-code");
  const copy = hints.querySelector("#copy-login-code");
  const runInput = hints.querySelector("#run-input");
  link.hidden = true;
  link.removeAttribute("href");
  codeRow.hidden = true;
  code.textContent = "";
  // 同上：只換 <span>。整顆洗掉會把 icon 一起清掉，「複製」按下去變「已複製」再
  // 回來之後就沒有圖示了。
  setButtonLabel(copy, "複製");
  runInput.hidden = true;
  hints.hidden = true;
}

export function showVerifyModal() {
  elements.verifyModal.hidden = false;
  requestAnimationFrame(() => elements.verifyModal.classList.add("open"));
}

export function hideVerifyModal() {
  elements.verifyModal.classList.remove("open");
  window.setTimeout(() => {
    elements.verifyModal.hidden = true;
  }, 200);
}

export function onVerifyModal(confirm, later) {
  // 「確認」會真的開一個終端跑驗證，連點兩下就跑兩次。「稍後」只是關掉這個框，
  // 冪等，不需要包。
  elements.verifyModalConfirm.addEventListener("click", guardClick(confirm));
  elements.verifyModalLater.addEventListener("click", later);
  elements.verifyModal.addEventListener("click", (event) => {
    if (event.target === elements.verifyModal) later();
  });
}
