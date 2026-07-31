// View：只負責把 ViewModel 算好的東西畫到畫面上，不做任何判斷。
import { groupChecks } from "./model.js";
import {
  configRowModel,
  envLogoFor,
  envRowModel,
  progressSummary,
} from "./viewmodel.js";

const elements = {
  output: document.querySelector("#output"),
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
  recheckConfigs: document.querySelector("#recheck-configs"),
  configSummary: document.querySelector("#config-summary"),
  configResults: document.querySelector("#config-results"),
  configToolbar: document.querySelector("#config-toolbar"),
  sectionNav: document.querySelector("#section-nav"),
  sectionButtons: [...document.querySelectorAll("[data-section-target]")],
  sectionPanels: [...document.querySelectorAll("[data-section-panel]")],
  sectionCards: {
    rules: document.querySelector("#rules-cards"),
    skills: document.querySelector("#skills-cards"),
    demo: document.querySelector("#demo-cards"),
  },
  progressBar: document.querySelector("#progress-bar"),
  progressFill: document.querySelector("#progress-fill"),
  progressDuck: document.querySelector("#progress-duck"),
  progressSummary: document.querySelector("#progress-summary"),
  behaviorFallback: document.querySelector("#behavior-fallback"),
  behaviorQuestion: document.querySelector("#behavior-question"),
  behaviorChecklist: document.querySelector("#behavior-checklist"),
  copyBehaviorQuestion: document.querySelector("#copy-behavior-question"),
};

export { elements };

let activeText = null;
let latestEnvChecks = null;
let latestConfigChecks = null;
let latestVerifiedSteps = new Set();

function showSection(sectionId) {
  for (const button of elements.sectionButtons) {
    const current = button.dataset.sectionTarget === sectionId;
    button.classList.toggle("current", current);

    if (current) {
      button.setAttribute("aria-current", "step");
    } else {
      button.removeAttribute("aria-current");
    }
  }

  for (const panel of elements.sectionPanels) {
    panel.hidden = panel.dataset.sectionPanel !== sectionId;
  }

  elements.configToolbar.hidden = sectionId === "env";
}

for (const button of elements.sectionButtons) {
  button.addEventListener("click", () =>
    showSection(button.dataset.sectionTarget),
  );
}

function createLogo(logo) {
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("class", "ds-toollogo-mark");
  icon.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#${logo}`);
  icon.append(use);
  return icon;
}

function updateProgress() {
  const summary = progressSummary(
    latestEnvChecks,
    latestConfigChecks,
    latestVerifiedSteps,
  );
  elements.progressBar.classList.toggle(
    "ds-pbar--indeterminate",
    summary.loading,
  );

  if (summary.loading) {
    elements.progressSummary.textContent = "正在計算…";
    elements.progressFill.style.width = "";
    elements.progressDuck.style.left = "0%";
    return;
  }

  elements.progressSummary.textContent = `${summary.done} / ${summary.total} 項就緒`;
  elements.progressFill.style.width = `${summary.percent}%`;
  elements.progressDuck.style.left = `${summary.percent}%`;
}

function createSkeleton() {
  const card = document.createElement("div");
  card.className = "ds-card config-skeleton";
  const skeleton = document.createElement("div");
  skeleton.className = "ds-skeleton";
  skeleton.setAttribute("aria-hidden", "true");

  for (const className of [
    "ds-skeleton-line ds-skeleton-line--title",
    "ds-skeleton-line",
    "ds-skeleton-line ds-skeleton-line--short",
  ]) {
    const line = document.createElement("div");
    line.className = className;
    skeleton.append(line);
  }

  card.append(skeleton);
  return card;
}

export function addLine(text, className = "") {
  const line = document.createElement("div");
  line.textContent = text;
  line.className = className;
  elements.output.append(line);
  elements.output.scrollTop = elements.output.scrollHeight;
}

// 代理的文字是一段一段串流進來的，要接在同一個區塊裡而不是每段一行。
export function addAgentEvent(agentEvent, agentName) {
  if (agentEvent.kind === "text") {
    if (activeText === null) {
      activeText = document.createElement("div");
      activeText.className = "agent-text";
      activeText.textContent = `${agentName} 回覆：`;
      elements.output.append(activeText);
    }

    activeText.append(document.createTextNode(agentEvent.text));
    elements.output.scrollTop = elements.output.scrollHeight;
    return;
  }

  activeText = null;
  addLine(agentEvent.text, `agent-${agentEvent.kind}`);
}

export function clearOutput() {
  elements.output.replaceChildren();
  activeText = null;
}

export function renderEnvLoading() {
  latestEnvChecks = null;
  const skeleton = document.createElement("div");
  skeleton.className = "ds-skeleton";
  skeleton.setAttribute("aria-hidden", "true");

  for (const className of [
    "ds-skeleton-line ds-skeleton-line--title",
    "ds-skeleton-line",
    "ds-skeleton-line ds-skeleton-line--short",
    "ds-skeleton-line",
  ]) {
    const line = document.createElement("div");
    line.className = className;
    skeleton.append(line);
  }

  elements.envResults.replaceChildren(skeleton);
  updateProgress();
}

export function renderEnvBusy(busy) {
  elements.envResults.setAttribute("aria-busy", busy ? "true" : "false");
}

export function renderEnvFailure(message) {
  latestEnvChecks = [];
  elements.envOs.textContent = "作業系統：無法取得";
  const paragraph = document.createElement("p");
  paragraph.className = "env-message failed";
  paragraph.textContent = `環境檢查失敗：${message}`;
  elements.envResults.replaceChildren(paragraph);
  updateProgress();
}

export function renderEnv(os, checks, onActionClick) {
  latestEnvChecks = checks;
  elements.envOs.textContent = `作業系統：${os.platform} / ${os.arch}`;
  const rows = checks.map((check) => {
    const model = envRowModel(check);
    const row = document.createElement("div");
    row.className = "env-row";
    row.dataset.status = model.status;

    const icon = document.createElement("span");
    icon.className = "env-icon";
    icon.textContent = model.symbol;
    icon.setAttribute("aria-label", model.ariaLabel);

    const logoName = envLogoFor(check.id);

    if (logoName !== null) {
      row.append(createLogo(logoName));
    } else {
      const spacer = document.createElement("span");
      spacer.className = "env-logo-spacer";
      spacer.setAttribute("aria-hidden", "true");
      row.append(spacer);
    }

    const label = document.createElement("strong");
    label.textContent = model.label;

    const detail = document.createElement("span");
    detail.className = "env-detail";
    detail.textContent = model.detail;

    row.prepend(icon);
    row.append(label, detail);

    const actions = document.createElement("div");
    actions.className = "env-actions";

    for (const button of model.buttons) {
      const element = document.createElement("button");
      element.type = "button";
      element.className = "env-action";
      element.dataset[button.dataName] = button.action;
      element.dataset.idleText = button.text;
      element.textContent = button.text;
      element.addEventListener("click", () =>
        onActionClick(button.action, element),
      );
      actions.append(element);
    }

    row.append(actions);
    return row;
  });
  elements.envResults.replaceChildren(...rows);
  updateProgress();
}

export function renderConfigChoices(toolChoices, languages) {
  const toolOptions = toolChoices.map((choice) => {
    const option = document.createElement("option");
    option.value = choice.value;
    option.textContent = choice.label;
    return option;
  });
  const languageOptions = languages.map((language) => {
    const option = document.createElement("option");
    option.value = language;
    option.textContent = language;
    return option;
  });
  elements.configTools.replaceChildren(...toolOptions);
  elements.configLang.replaceChildren(...languageOptions);
}

function createConfigRow(check, model, onActionClick, onEyeToggle) {
  const row = document.createElement("div");
  row.className = "env-row";
  row.dataset.status = model.status;

  const icon = document.createElement("span");
  icon.className = "env-icon";
  icon.textContent = model.symbol;
  icon.setAttribute("aria-label", model.ariaLabel);

  const label = document.createElement("strong");
  label.textContent = model.label;

  const detail = document.createElement("span");
  detail.className = "env-detail";
  detail.textContent = model.detail;

  row.append(icon, label, detail);

  const actions = document.createElement("div");
  actions.className = "env-actions";

  for (const button of model.buttons) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = "env-action";
    element.dataset[button.dataName] = button.action;
    element.dataset.step = button.step;
    element.textContent = button.text;
    element.addEventListener("click", () =>
      onActionClick(button.action, element, button.step, button.options),
    );
    actions.append(element);
  }

  row.append(actions);

  // 程式驗不到的那一格，明講要回終端看什麼，看完自己勾。
  if (model.eyeCheck !== null) {
    const eye = document.createElement("label");
    eye.className = "env-eye-check";

    const box = document.createElement("input");
    box.type = "checkbox";
    box.dataset.eyeStep = check.id;
    box.addEventListener("change", () => onEyeToggle(check.id, box.checked));

    const text = document.createElement("span");
    text.textContent = `我看到了：${model.eyeCheck}`;

    eye.append(box, text);
    row.append(eye);
  }

  return row;
}

function createConfigCard(
  card,
  onActionClick,
  verifiedSteps,
  onEyeToggle,
) {
  const models = card.checks.map((check) =>
    configRowModel(check, verifiedSteps.has(check.id)),
  );
  const done = models.filter((model) => model.status === "ok").length;
  const article = document.createElement("article");
  article.className = `ds-card-tilt config-card config-card--${card.agent}`;

  const face = document.createElement("div");
  face.className = "ds-card-tilt__face config-card-face";
  const header = document.createElement("header");
  header.className = "config-card-header";
  header.append(createLogo(card.logo));

  const title = document.createElement("h3");
  title.textContent = card.label;
  const count = document.createElement("span");
  count.textContent = `${card.checks.length} 項 / 已完成 ${done}`;
  const copy = document.createElement("div");
  copy.append(title, count);
  header.append(copy);

  const rows = card.checks.map((check, index) =>
    createConfigRow(check, models[index], onActionClick, onEyeToggle),
  );
  const body = document.createElement("div");
  body.className = "config-card-rows";
  body.append(...rows);
  face.append(header, body);
  article.append(face);
  return article;
}

export function renderConfigs(
  checks,
  onActionClick,
  { verifiedSteps = new Set(), onEyeToggle = () => {} } = {},
) {
  latestConfigChecks = checks;
  latestVerifiedSteps = verifiedSteps;

  for (const section of groupChecks(checks)) {
    const cards = section.cards.map((card) =>
      createConfigCard(card, onActionClick, verifiedSteps, onEyeToggle),
    );
    const container = elements.sectionCards[section.sectionId];

    if (cards.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-section ds-card";
      empty.textContent = "這個工具組合沒有此章節項目。";
      container.replaceChildren(empty);
    } else {
      container.replaceChildren(...cards);
    }
  }

  elements.configResults.setAttribute("aria-busy", "false");
  updateProgress();
}

export function renderConfigSummary(summary) {
  elements.configSummary.textContent = summary.text;
}

export function renderConfigLoading() {
  latestConfigChecks = null;
  elements.configResults.setAttribute("aria-busy", "true");

  for (const container of Object.values(elements.sectionCards)) {
    container.replaceChildren(createSkeleton());
  }

  updateProgress();
}

export function renderConfigFailure(message) {
  latestConfigChecks = [];
  elements.configResults.setAttribute("aria-busy", "false");

  for (const container of Object.values(elements.sectionCards)) {
    const paragraph = document.createElement("p");
    paragraph.className = "env-message failed ds-card";
    paragraph.textContent = `規則檔檢查失敗：${message}`;
    container.replaceChildren(paragraph);
  }

  updateProgress();
}

export function renderBehaviorFallback(state) {
  elements.behaviorQuestion.textContent = "";
  elements.behaviorChecklist.replaceChildren();
  elements.copyBehaviorQuestion.textContent = "複製";

  if (!state.visible) {
    elements.behaviorFallback.hidden = true;
    return;
  }

  const items = state.checklist.map((text) => {
    const item = document.createElement("li");
    item.textContent = text;
    return item;
  });
  elements.behaviorQuestion.textContent = state.question;
  elements.behaviorChecklist.replaceChildren(...items);
  elements.behaviorFallback.hidden = false;
}

export function configActionButtons() {
  return [
    ...elements.configResults.querySelectorAll(
      "[data-install-action], [data-merge-action]",
    ),
  ];
}

export function envActionButtons() {
  return [
    ...elements.envResults.querySelectorAll(
      "[data-install-action], [data-fix-action]",
    ),
  ];
}

export function renderEnvButton(button, state) {
  button.disabled = state.disabled;
  button.textContent = state.text;
}

export function renderRunControls(state) {
  for (const button of elements.actionButtons) {
    button.disabled = state.actionButtonsDisabled;
  }

  elements.prompt.disabled = state.promptDisabled;
  elements.allowWrite.disabled = state.allowWriteDisabled;
  elements.recheckEnv.disabled = state.recheckDisabled;
  elements.configTools.disabled = state.configControlsDisabled;
  elements.configLang.disabled = state.configControlsDisabled;
  elements.recheckConfigs.disabled = state.configControlsDisabled;

  for (const button of configActionButtons()) {
    button.disabled = state.configControlsDisabled;
  }

  elements.cancel.hidden = state.cancelHidden;
  elements.cancel.disabled = state.cancelDisabled;
  elements.runInput.hidden = state.inputHidden;
}

export function showInstallStatus(message) {
  elements.installStatus.textContent = message.text;
  elements.installStatus.classList.toggle("failed", message.failed);
  elements.installStatus.hidden = false;
}

export function hideInstallStatus() {
  elements.installStatus.hidden = true;
}

export function showLoginWaiting(onStop) {
  const message = document.createTextNode(
    "正在確認登入狀態，完成後這裡會自動更新。",
  );
  const stopButton = document.createElement("button");
  stopButton.type = "button";
  stopButton.textContent = "停止等待";
  stopButton.addEventListener("click", onStop);
  elements.loginWaitStatus.replaceChildren(message, stopButton);
  elements.loginWaitStatus.classList.remove("failed");
  elements.loginWaitStatus.hidden = false;
}

export function finishLoginWaiting(text, failed) {
  elements.loginWaitStatus.textContent = text;
  elements.loginWaitStatus.classList.toggle("failed", failed);
  elements.loginWaitStatus.hidden = false;
}

export function hideLoginWaiting() {
  elements.loginWaitStatus.hidden = true;
  elements.loginWaitStatus.replaceChildren();
}

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

  elements.loginHints.hidden =
    elements.loginUrl.hidden && elements.loginCodeRow.hidden;
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
