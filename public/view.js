// View：只把 app 傳進來的畫面模型畫成 DOM，不做流程判斷或資料請求。
import { LOADER_MODIFIERS, appendTermLine } from "./viewmodel.js";

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
  currentCard: document.querySelector("#current-card"),
  milestoneBar: document.querySelector("#milestone-bar"),
  milestoneFill: document.querySelector("#milestone-fill"),
  milestoneDuck: document.querySelector("#milestone-duck"),
  sectionLockMessage: document.querySelector("#section-lock-message"),
  behaviorFallback: document.querySelector("#behavior-fallback"),
  behaviorQuestion: document.querySelector("#behavior-question"),
  behaviorChecklist: document.querySelector("#behavior-checklist"),
  copyBehaviorQuestion: document.querySelector("#copy-behavior-question"),
  rowLoaderPool: document.querySelector("#row-loader-pool"),
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

function pin(point, key) {
  point.querySelector(".ds-milestone-card").classList.add("is-pinned");
  point.removeAttribute("aria-hidden");
  pinnedStation = key;
  milestoneBusy = false;
}

function finishArrival(point, station, key) {
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
  }, 800);
}

function moveDuck(sectionId, station) {
  const nextKey = `${sectionId}:${station.index}`;
  const previousIndex = renderedStation?.sectionId === sectionId
    ? renderedStation.index
    : station.index;
  const moving = renderedStation !== null && nextKey !== renderedStation.key;
  renderedStation = { key: nextKey, sectionId, index: station.index };
  window.clearTimeout(stationTimer);
  window.clearTimeout(arrivalTimer);
  window.clearTimeout(fireworkTimer);
  elements.milestoneBar.querySelector(".ds-firework")?.remove();
  elements.milestoneDuck.classList.toggle("left", station.index < previousIndex);
  elements.milestoneDuck.style.left = `${station.percent}%`;
  elements.milestoneFill.style.width = `${station.percent}%`;
  elements.milestoneFill.setAttribute("aria-valuenow", String(station.percent));

  const point = elements.milestoneBar.querySelector(
    `[data-card-index="${station.index}"]`,
  );

  if (!moving) {
    elements.milestoneDuck.classList.remove("is-running", "is-arriving");
    if (pinnedStation === nextKey) pin(point, nextKey);
    return;
  }

  unpinAll();
  milestoneBusy = true;
  if (reducedMotion.matches) {
    elements.milestoneDuck.classList.remove("is-running", "is-arriving");
    pin(point, nextKey);
    return;
  }

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
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      preview.classList.remove("is-pinned");
      point.setAttribute("aria-hidden", "true");
      pinnedStation = null;
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

function actionButton(spec, onActionClick) {
  const button = document.createElement("button");
  button.type = "button";
  // secondary：按得動、但不是這張卡的主要動作（例如已經裝好時的「重裝」）。
  // 兩顆都橘色的話，學生分不出哪一顆才是現在該按的。
  button.className = `ds-btn ds-btn-sm ${
    spec.className ?? (spec.secondary === true ? "ds-btn-ghost" : "ds-btn-primary")
  }`;
  button.dataset[spec.dataName] = spec.action;
  button.dataset.step = spec.step ?? "";
  button.dataset.idleText = spec.text;
  button.dataset.permanentlyDisabled = String(spec.disabled === true);
  button.textContent = spec.text;
  button.disabled = spec.disabled === true;
  button.classList.toggle("is-done", spec.done === true);
  button.addEventListener("click", () =>
    onActionClick(spec.action, button, spec.step, spec.options),
  );
  return button;
}

// 貼上證明用的欄位。貼對了那一格自己打勾——這是整份嚮導唯一「學生交得出副產物」
// 的人工項目，其餘的人眼判定只能靠自己說了算。
// 不顯示那句要貼進終端的話：按鈕已經會把它送進去了，印出來只是多一份要學生自己
// 一字不差複製的東西——而那正是按鈕要取代的手動步驟。字串本身仍然由
// test/fullscreen-proof.mjs 釘住，確保按鈕送的跟要比對的一致。
function pasteProofElement({ value, matched, onInput, onOpen }) {
  const wrap = document.createElement("div");
  wrap.className = "paste-proof";

  // 兩顆都只是「幫學生把終端開起來」——方框沒辦法代按，但至少不用叫學生自己去找
  // 終端、自己打 claude。第一顆開空的讓方框跳出來，第二顆連那句話一起送進去。
  const openRow = document.createElement("div");
  openRow.className = "paste-proof-actions";
  for (const [testCase, label] of [
    ["fullscreen-open", "開啟 Claude Code（讓方框跳出來）"],
    ["fullscreen-proof", "開啟並自動送出這句話"],
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ds-btn ds-btn-secondary ds-btn-sm";
    button.textContent = label;
    button.addEventListener("click", () => onOpen(testCase));
    openRow.append(button);
  }

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

  wrap.append(openRow, field, status);
  return wrap;
}

function checklistElement(groups, onManualToggle) {
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

  for (const group of [groups.system, groups.manual]) {
    for (const item of group) {
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
      visible.setAttribute("data-text", item.text);
      visible.textContent = item.text;
      text.append(visible);

      if (item.failedReason || item.detail) {
        const small = document.createElement("small");
        small.textContent = item.failedReason || item.detail;
        text.append(small);
      }

      if (!item.automatic) {
        input.addEventListener("change", () =>
          onManualToggle(item.id, input.checked),
        );
      }

      label.append(input, checkMark(), text);
      checklist.append(label);
    }
  }

  return checklist;
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
    ? "ds-btn ds-btn-ghost ds-btn-sm"
    : "ds-btn ds-btn-primary";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = model.linkText;
  link.hidden = !model.showLink;
  if (model.url !== null) link.href = model.url;
  const codeRow = document.createElement("div");
  codeRow.id = "login-code-row";
  codeRow.hidden = !model.showCode;
  const code = document.createElement("code");
  code.id = "login-code";
  code.textContent = model.code ?? "";
  const copy = document.createElement("button");
  copy.id = "copy-login-code";
  copy.type = "button";
  copy.className = "ds-btn ds-btn-ghost ds-btn-sm";
  copy.textContent = "複製";
  copy.addEventListener("click", () =>
    model.onCopyLoginCode(code.textContent, copy),
  );
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
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "ds-btn ds-btn-primary ds-btn-sm";
  submit.textContent = "送出";
  form.append(input, submit);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    model.onLoginInput(input.value, input);
  });
  hints.append(link, codeRow, form);
  return hints;
}

function renderCard(model) {
  elements.configChoicePanel.hidden = model.card.kind !== "setup";
  const article = document.createElement("article");
  article.className = `ds-card current-task-card current-task-card--${model.card.agent}`;
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
    if (model.showChecklist) {
      body.append(checklistElement(model.checklist, model.onManualToggle));
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
      const block = document.createElement("code");
      block.className = "paste-proof-command card-hints-block";
      block.textContent = model.hints.lines.join("\n");
      hints.append(title, block);
      body.append(hints);
    }
    if (model.pasteProof !== null && model.pasteProof !== undefined) {
      body.append(pasteProofElement(model.pasteProof));
    }
    const actions = document.createElement("div");
    actions.className = "env-actions";
    // 純人工的卡（全螢幕模式）沒有 row：沒有安裝也沒有驗證，自然沒有按鈕。
    // 這裡少一個 ?. 會讓整個 render 中止，畫面停在上一張、「下一張」按了沒反應——
    // 而且錯誤只留在 console，學生只看到按鈕壞掉（VM 實測）。
    for (const spec of model.row?.buttons ?? []) {
      actions.append(actionButton(spec, model.onActionClick));
    }
    if (model.showRetest) {
      const retest = document.createElement("button");
      retest.type = "button";
      retest.className = "ds-btn ds-btn-ghost ds-btn-sm";
      retest.textContent = "再 check 一次";
      retest.addEventListener("click", model.onRetest);
      actions.append(retest);
    }
    body.append(actions);
    if (model.login !== null) {
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

  if (model.showNext) {
    const footer = document.createElement("footer");
    const next = document.createElement("button");
    next.type = "button";
    next.className = "ds-btn ds-btn-primary";
    next.textContent = "下一張";
    next.disabled = !model.nextUnlocked;
    next.addEventListener("click", model.onNext);
    footer.append(next);
    article.append(footer);
  }
  elements.currentCard.replaceChildren(article);
  elements.currentCard.setAttribute("aria-busy", "false");
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
    button.addEventListener("click", () => handler(button.dataset.sectionTarget));
  }
}

export function renderSectionLocks(lockStates) {
  for (const button of elements.sectionButtons) {
    const locked = lockStates[button.dataset.sectionTarget]?.locked === true;
    button.classList.toggle("is-locked", locked);
    if (locked) button.setAttribute("aria-disabled", "true");
    else button.removeAttribute("aria-disabled");
  }
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

function appendDots(parent, count) {
  for (let index = 0; index < count; index += 1) {
    const dot = document.createElement("i");
    dot.style.setProperty("--i", index);
    dot.setAttribute("aria-hidden", "true");
    parent.append(dot);
  }
}

function createLoader(modifier) {
  const loader = document.createElement("span");
  loader.className = `ds-loader-orbs ds-loader-orbs--sm ds-loader-orbs--on-dark ${modifier}`;
  loader.setAttribute("role", "status");
  if (modifier === LOADER_MODIFIERS.working) {
    for (const [tilt, duration] of [["-22deg", "2.7s"], ["48deg", "2.2s"]]) {
      const orbit = document.createElement("span");
      orbit.className = "ds-loader-orbs__orbit";
      orbit.style.setProperty("--tilt", tilt);
      orbit.style.setProperty("--orbit-duration", duration);
      appendDots(orbit, 6);
      loader.append(orbit);
    }
  } else if (modifier === LOADER_MODIFIERS.searching) {
    [2, 4, 2].forEach((count, row) => {
      const latitude = document.createElement("span");
      latitude.className = "ds-loader-orbs__latitude";
      latitude.style.setProperty("--row", row);
      latitude.style.setProperty("--mid", (count - 1) / 2);
      latitude.style.setProperty("--step", "4.5px");
      latitude.style.setProperty("--delay-step", `${(-1.6 / count).toFixed(3)}s`);
      appendDots(latitude, count);
      loader.append(latitude);
    });
  } else if (modifier === LOADER_MODIFIERS.listening) {
    [3, 7].forEach((radius, ringIndex) => {
      const ring = document.createElement("span");
      ring.className = "ds-loader-orbs__ring";
      ring.style.setProperty("--ring", ringIndex);
      ring.style.setProperty("--ring-radius", `${radius}px`);
      appendDots(ring, 6);
      loader.append(ring);
    });
  }
  return loader;
}

const loaderLabels = {
  [LOADER_MODIFIERS.working]: "正在安裝，完成後會自動更新。",
  [LOADER_MODIFIERS.searching]: "正在檢查目前狀態。",
  [LOADER_MODIFIERS.listening]: "新終端已開啟，正在等驗證結果。",
  [LOADER_MODIFIERS.solving]: "正在判定結果。",
  [LOADER_MODIFIERS.composing]: "正在檢查回覆格式。",
  [LOADER_MODIFIERS.shaping]: "正在產出示範畫面。",
};
const loaders = new Map();
for (const modifier of Object.keys(loaderLabels)) {
  const loader = createLoader(modifier);
  loader.hidden = true;
  elements.rowLoaderPool.append(loader);
  loaders.set(modifier, loader);
}
let terminalLineModels = [...elements.terminalLines.children].map((line) => ({
  className: line.className,
  text: line.textContent,
}));

function acceptsTerminalLine(spec) {
  const next = appendTermLine(terminalLineModels, spec);

  if (next === terminalLineModels) {
    return false;
  }

  terminalLineModels = next;
  return true;
}

export function hideLoaders() {
  for (const loader of loaders.values()) {
    loader.hidden = true;
    loader.classList.remove("is-paused");
    elements.rowLoaderPool.append(loader);
  }
}

export function renderLoaders({ modifier, paused = false }) {
  const loader = loaders.get(modifier);
  if (loader === undefined) return;
  const spec = {
    className: "ds-term-line ds-term-line--dim terminal-loader-line",
    text: paused ? "處理已停止。" : loaderLabels[modifier],
  };
  if (!acceptsTerminalLine(spec)) return;
  hideLoaders();
  const line = document.createElement("div");
  line.className = spec.className;
  line.textContent = spec.text;
  loader.hidden = false;
  loader.classList.toggle("is-paused", paused);
  line.append(loader);
  elements.terminalLines.append(line);
}

export function clearOutput() {
  elements.output.textContent = "";
  elements.terminalLines.replaceChildren();
  terminalLineModels = [];
}

export function addRawLine(text) {
  elements.output.textContent += `${text}\n`;
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
  line.textContent = spec.text;
  elements.terminalLines.append(line);
}

export function addTerminalLines(lines) {
  for (const spec of lines) {
    if (!acceptsTerminalLine(spec)) continue;
    const line = document.createElement("div");
    line.className = spec.className;
    line.textContent = spec.text;
    elements.terminalLines.append(line);
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

export function renderEnvButton(button, state) {
  button.disabled = state.disabled;
  button.textContent = state.text;
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

export function showLoginWaiting(onStop) {
  const line = document.createElement("div");
  line.className = "ds-term-line ds-term-line--dim";
  line.textContent = "正在確認登入狀態，完成後這裡會自動更新。";
  const stop = document.createElement("button");
  stop.type = "button";
  stop.className = "ds-btn ds-btn-ghost ds-btn-sm";
  stop.textContent = "停止等待";
  stop.addEventListener("click", onStop);
  line.append(stop);
  elements.terminalLines.append(line);
}

export function finishLoginWaiting(text, failed) {
  addLine(text, failed ? "failed" : "succeeded");
}

export function hideLoginWaiting() {}

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
    link.textContent = model.linkText;
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
  copy.textContent = "複製";
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
  elements.verifyModalConfirm.addEventListener("click", confirm);
  elements.verifyModalLater.addEventListener("click", later);
  elements.verifyModal.addEventListener("click", (event) => {
    if (event.target === elements.verifyModal) later();
  });
}
