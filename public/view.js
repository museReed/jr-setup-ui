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
  loginHints: document.querySelector("#login-hints"),
  loginUrl: document.querySelector("#login-url"),
  loginCodeRow: document.querySelector("#login-code-row"),
  loginCode: document.querySelector("#login-code"),
  copyLoginCode: document.querySelector("#copy-login-code"),
  runInput: document.querySelector("#run-input"),
  runInputText: document.querySelector("#run-input-text"),
  configTools: document.querySelector("#config-tools"),
  configLang: document.querySelector("#config-lang"),
  configChoicePanel: document.querySelector("#config-choice-panel"),
  recheckConfigs: document.querySelector("#recheck-configs"),
  configSummary: document.querySelector("#config-summary"),
  configResults: document.querySelector("#config-results"),
  sectionNav: document.querySelector("#section-nav"),
  sectionButtons: [...document.querySelectorAll("[data-section-target]")],
  sectionPanel: document.querySelector("[data-section-panel]"),
  sectionTitle: document.querySelector("#section-title"),
  sectionKicker: document.querySelector("#section-kicker"),
  sectionStatus: document.querySelector("#section-status"),
  currentCard: document.querySelector("#current-card"),
  milestoneBar: document.querySelector("#milestone-bar"),
  milestoneFill: document.querySelector("#milestone-fill"),
  milestonePoints: document.querySelector("#milestone-points"),
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
let stationTimer = null;
let arrivalTimer = null;

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

function firework(percent) {
  if (reducedMotion.matches) {
    return;
  }

  const burst = document.createElement("span");
  burst.className = "ds-firework";
  burst.style.setProperty("--firework-at", `${percent}%`);
  burst.setAttribute("aria-hidden", "true");

  for (let ray = 0; ray < 10; ray += 1) {
    const particle = document.createElement("i");
    particle.style.setProperty("--ray", `${ray * 36}deg`);
    burst.append(particle);
  }

  elements.milestoneBar.append(burst);
  window.setTimeout(() => burst.remove(), 800);
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
  elements.milestoneDuck.classList.toggle("left", station.index < previousIndex);
  elements.milestoneDuck.style.left = `${station.percent}%`;
  elements.milestoneFill.style.width = `${station.percent}%`;
  elements.milestoneFill.setAttribute("aria-valuenow", String(station.percent));

  if (!moving || reducedMotion.matches) {
    elements.milestoneDuck.classList.remove("is-running", "is-arriving");
    return;
  }

  elements.milestoneDuck.classList.add("is-running");
  stationTimer = window.setTimeout(() => {
    elements.milestoneDuck.classList.remove("is-running");
    elements.milestoneDuck.classList.add("is-arriving");
    arrivalTimer = window.setTimeout(() => {
      elements.milestoneDuck.classList.remove("is-arriving");
      firework(station.percent);
    }, 420);
  }, 1000);
}

function renderMilestones(sectionId, milestones, onSelect) {
  const points = milestones.map((station) => {
    const point = document.createElement("button");
    point.type = "button";
    point.className = "ds-milestone";
    point.style.setProperty("--at", `${station.percent}%`);
    point.dataset.value = String(station.percent);
    point.dataset.cardIndex = String(station.index);
    point.classList.toggle("is-reached", station.reached);
    point.classList.toggle("is-locked", !station.unlocked);
    point.disabled = !station.unlocked;
    point.setAttribute("aria-label", `${station.label}，第 ${station.index + 1} / ${milestones.length} 張`);

    if (station.index < Math.ceil(milestones.length / 2)) {
      point.classList.add("ds-milestone--edge-start");
    } else {
      point.classList.add("ds-milestone--edge-end");
    }

    const preview = document.createElement("span");
    preview.className = "ds-milestone-card";
    const close = document.createElement("span");
    close.className = "ds-milestone-card-close";
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
    point.addEventListener("click", () => onSelect(station.index));
    return point;
  });
  elements.milestonePoints.replaceChildren(...points);

  const current = milestones.find((station) => station.current);
  if (current !== undefined) {
    moveDuck(sectionId, current);
  }
}

function actionButton(spec, onActionClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `ds-btn ds-btn-sm ${spec.className ?? "ds-btn-primary"}`;
  button.dataset[spec.dataName] = spec.action;
  button.dataset.step = spec.step ?? "";
  button.textContent = spec.text;
  button.disabled = spec.disabled === true;
  button.classList.toggle("is-done", spec.done === true);
  button.addEventListener("click", () =>
    onActionClick(spec.action, button, spec.step, spec.options),
  );
  return button;
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
  const head = document.createElement("header");
  head.className = "ds-checklist-head";
  const title = document.createElement("strong");
  title.className = "ds-checklist-title";
  title.textContent = "驗證後自查";
  const count = document.createElement("span");
  count.className = "ds-checklist-count";
  count.textContent = `${checked} / ${items.length}`;
  head.append(title, count);
  checklist.append(head);

  for (const [heading, group] of [
    ["系統驗過的", groups.system],
    ["請你自己確認", groups.manual],
  ]) {
    if (group.length === 0) continue;
    const groupTitle = document.createElement("div");
    groupTitle.className = "ds-checklist-head";
    const groupName = document.createElement("span");
    groupName.className = "ds-checklist-title";
    groupName.textContent = heading;
    groupTitle.append(groupName);
    checklist.append(groupTitle);

    for (const item of group) {
      const label = document.createElement("label");
      label.className = "ds-check";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = item.checked;
      input.dataset.checklistId = item.id;
      const text = document.createElement("span");
      text.className = "ds-check-text";
      const visible = document.createElement("span");
      visible.className = "ds-check-label";
      visible.dataset.text = item.text;
      visible.textContent = item.text;
      text.append(visible);

      if (item.failedReason || item.detail) {
        const small = document.createElement("small");
        small.textContent = item.failedReason || item.detail;
        text.append(small);
      }

      if (item.automatic) {
        label.style.pointerEvents = "none";
        input.setAttribute("aria-disabled", "true");
      } else {
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
  header.append(copy);
  article.append(header);

  if (model.card.kind === "setup") {
    const body = document.createElement("div");
    body.className = "current-task-body";
    body.append(elements.configChoicePanel);
    article.append(body);
  } else {
    const body = document.createElement("div");
    body.className = "current-task-body";
    const status = document.createElement("p");
    status.textContent = model.row.detail;
    status.dataset.status = model.row.status;
    body.append(status);
    const actions = document.createElement("div");
    actions.className = "env-actions";
    for (const spec of model.row.buttons) {
      actions.append(actionButton(spec, model.onActionClick));
    }
    if (model.showRetest) {
      const retest = document.createElement("button");
      retest.type = "button";
      retest.className = "ds-btn ds-btn-ghost ds-btn-sm";
      retest.textContent = "Re-test";
      retest.addEventListener("click", model.onRetest);
      actions.append(retest);
    }
    body.append(actions);
    if (model.showChecklist) {
      body.append(checklistElement(model.checklist, model.onManualToggle));
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
  elements.sectionTitle.textContent = model.section.title;
  elements.sectionKicker.textContent = model.section.subtitle;
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
  for (const button of configActionButtons()) button.disabled = state.configControlsDisabled || button.classList.contains("is-done");
  elements.cancel.hidden = state.cancelHidden;
  elements.cancel.disabled = state.cancelDisabled;
  elements.runInput.hidden = state.inputHidden;
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

export function showLoginHints(hints) {
  if (hints.url !== null) {
    elements.loginUrl.href = hints.url;
    elements.loginUrl.textContent = hints.url;
    elements.loginUrl.hidden = false;
  }
  if (hints.code !== null) {
    elements.loginCode.textContent = hints.code;
    elements.loginCodeRow.hidden = false;
  }
  elements.loginHints.hidden = elements.loginUrl.hidden && elements.loginCodeRow.hidden;
}

export function clearLoginHints() {
  elements.loginUrl.hidden = true;
  elements.loginUrl.removeAttribute("href");
  elements.loginUrl.textContent = "";
  elements.loginCodeRow.hidden = true;
  elements.loginCode.textContent = "";
  elements.copyLoginCode.textContent = "複製";
  elements.loginHints.hidden = true;
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
