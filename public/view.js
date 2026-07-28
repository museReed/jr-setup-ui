// View：只負責把 ViewModel 算好的東西畫到畫面上，不做任何判斷。
import { envRowModel } from "./viewmodel.js";

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
};

export { elements };

let activeText = null;

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
  const loading = document.createElement("p");
  loading.className = "env-message";
  loading.textContent = "檢查中…";
  elements.envResults.replaceChildren(loading);
}

export function renderEnvBusy(busy) {
  elements.envResults.setAttribute("aria-busy", busy ? "true" : "false");
}

export function renderEnvFailure(message) {
  elements.envOs.textContent = "作業系統：無法取得";
  const paragraph = document.createElement("p");
  paragraph.className = "env-message failed";
  paragraph.textContent = `環境檢查失敗：${message}`;
  elements.envResults.replaceChildren(paragraph);
}

export function renderEnv(os, checks, onActionClick) {
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

    const label = document.createElement("strong");
    label.textContent = model.label;

    const detail = document.createElement("span");
    detail.className = "env-detail";
    detail.textContent = model.detail;

    row.append(icon, label, detail);

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
      row.append(element);
    }

    return row;
  });
  elements.envResults.replaceChildren(...rows);
}

export function envActionButtons() {
  return [
    ...document.querySelectorAll("[data-install-action], [data-fix-action]"),
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
