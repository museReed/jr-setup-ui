// 把 View 的事件、Model 的請求、ViewModel 的判斷接起來。
// 這裡只做接線與狀態保管，判斷邏輯在 viewmodel.js、畫面操作在 view.js。
import * as api from "./api.js";
import * as view from "./view.js";
import {
  LOGIN_CHECK_IDS,
  LOGIN_POLL_INTERVAL_MS,
  agentNameFor,
  envButtonState,
  extractLoginHints,
  installStatusMessage,
  isLoginAction,
  loginWaitStep,
  runControlsState,
  runOutcome,
} from "./viewmodel.js";

const state = {
  runInProgress: false,
  runId: null,
  acceptsInput: false,
  agentName: "",
  activeEnvButton: null,
  currentEnvAction: null,
  envCheckInProgress: false,
  loginWait: null,
};

function renderEnvActionButtons() {
  for (const button of view.envActionButtons()) {
    const action = button.dataset.installAction ?? button.dataset.fixAction;
    view.renderEnvButton(
      button,
      envButtonState({
        action,
        idleText: button.dataset.idleText,
        runInProgress: state.runInProgress,
        currentEnvAction: state.currentEnvAction,
        waitingAction: state.loginWait?.action ?? null,
      }),
    );
  }
}

function setRunning(running) {
  state.runInProgress = running;
  view.renderRunControls(
    runControlsState({
      runInProgress: running,
      runId: state.runId,
      acceptsInput: state.acceptsInput,
      envCheckInProgress: state.envCheckInProgress,
    }),
  );
  renderEnvActionButtons();
}

function resetRun() {
  state.runId = null;
  state.acceptsInput = false;
  state.activeEnvButton = null;
  state.currentEnvAction = null;
  view.clearLoginHints();
  setRunning(false);
}

function clearLoginWait() {
  if (state.loginWait !== null) {
    window.clearTimeout(state.loginWait.timerId);
    state.loginWait = null;
  }

  renderEnvActionButtons();
}

function stopLoginWait() {
  clearLoginWait();
  view.hideLoginWaiting();
}

function finishLoginWait(step) {
  clearLoginWait();
  view.finishLoginWaiting(step.text, step.failed);
}

async function checkEnvironment(showLoading = true) {
  if (state.envCheckInProgress) {
    return null;
  }

  state.envCheckInProgress = true;
  view.elements.recheckEnv.disabled = true;
  view.renderEnvBusy(true);

  if (showLoading) {
    view.renderEnvLoading();
  }

  try {
    const { os, checks } = await api.fetchEnv();
    view.renderEnv(os, checks, (action, button) => run(action, undefined, button));
    renderEnvActionButtons();

    if (state.loginWait !== null) {
      const step = loginWaitStep({
        startedAt: state.loginWait.startedAt,
        now: Date.now(),
        checks,
        checkId: state.loginWait.checkId,
      });

      if (step.kind === "done") {
        finishLoginWait(step);
      }
    }

    return checks;
  } catch (error) {
    view.renderEnvFailure(error.message);
    return null;
  } finally {
    state.envCheckInProgress = false;
    view.renderEnvBusy(false);
    view.elements.recheckEnv.disabled = state.runInProgress;
  }
}

async function pollLogin(wait) {
  if (state.loginWait !== wait) {
    return;
  }

  // 先判逾時再去查：查詢本身要花時間，逾時判定不該被它拖著。
  const step = loginWaitStep({
    startedAt: wait.startedAt,
    now: Date.now(),
    checks: null,
    checkId: wait.checkId,
  });

  if (step.kind === "timeout") {
    finishLoginWait(step);
    return;
  }

  await checkEnvironment(false);

  if (state.loginWait !== wait) {
    return;
  }

  wait.timerId = window.setTimeout(
    () => pollLogin(wait),
    LOGIN_POLL_INTERVAL_MS,
  );
}

function startLoginWait(action) {
  stopLoginWait();
  const wait = {
    action,
    checkId: LOGIN_CHECK_IDS[action],
    startedAt: Date.now(),
    timerId: null,
  };
  state.loginWait = wait;
  view.showLoginWaiting(stopLoginWait);
  renderEnvActionButtons();
  wait.timerId = window.setTimeout(
    () => pollLogin(wait),
    LOGIN_POLL_INTERVAL_MS,
  );
}

function handleDone(action, envButton, result) {
  const outcome = runOutcome(result);
  view.addLine(outcome.summary, outcome.className);

  if (state.activeEnvButton !== null) {
    const message = installStatusMessage(action, result);

    if (message !== null && message.failed) {
      view.showInstallStatus(message);
    }
  }

  const wasEnvAction = envButton !== null;
  resetRun();

  if (!wasEnvAction || !outcome.succeeded) {
    return;
  }

  if (isLoginAction(action)) {
    startLoginWait(action);
    return;
  }

  const message = installStatusMessage(action, result);

  if (message !== null) {
    view.showInstallStatus(message);
  }

  checkEnvironment();
}

async function run(action, promptText, envButton = null) {
  if (isLoginAction(action)) {
    stopLoginWait();
  }

  view.clearOutput();
  view.clearLoginHints();
  state.activeEnvButton = envButton;
  state.currentEnvAction = envButton === null ? null : action;

  if (envButton !== null) {
    view.hideInstallStatus();
  }

  state.agentName = agentNameFor(action);
  state.runId = null;
  state.acceptsInput = false;
  setRunning(true);

  try {
    const body = { action };

    if (promptText !== undefined) {
      body.prompt = promptText;

      if (view.elements.allowWrite.checked) {
        body.allowWrite = true;
      }
    }

    const { runId, acceptsInput } = await api.startRun(body);
    state.runId = runId;
    state.acceptsInput = acceptsInput;
    setRunning(true);

    const events = api.openStream(runId);
    let done = false;

    events.addEventListener("line", (event) => {
      const line = JSON.parse(event.data);

      if (isLoginAction(action)) {
        view.showLoginHints(extractLoginHints(line.text));
      }

      view.addLine(line.text, line.stream === "stderr" ? "stderr" : "");
    });

    events.addEventListener("agent", (event) => {
      view.addAgentEvent(JSON.parse(event.data), state.agentName);
    });

    events.addEventListener("done", (event) => {
      done = true;
      events.close();
      handleDone(action, envButton, JSON.parse(event.data));
    });

    events.onerror = () => {
      if (!done) {
        view.addLine("串流連線中斷", "failed");
        events.close();
        resetRun();
      }
    };
  } catch (error) {
    view.addLine(`無法執行：${error.message}`, "failed");
    resetRun();
  }
}

for (const button of view.elements.actionButtons) {
  button.addEventListener("click", () => {
    const action = button.dataset.action;
    run(
      action,
      action.endsWith("-free") ? view.elements.prompt.value : undefined,
    );
  });
}

view.elements.cancel.addEventListener("click", async () => {
  if (state.runId === null) {
    return;
  }

  view.elements.cancel.disabled = true;

  try {
    await api.cancelRun(state.runId);
    view.clearLoginHints();
    view.addLine("正在取消…", "agent-status");
  } catch (error) {
    view.addLine(`無法取消：${error.message}`, "failed");
    view.elements.cancel.disabled = false;
  }
});

view.elements.copyLoginCode.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(view.elements.loginCode.textContent);
    view.elements.copyLoginCode.textContent = "已複製";
  } catch (error) {
    view.addLine(`無法複製：${error.message}`, "failed");
  }
});

view.elements.runInput.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (state.runId === null || !state.acceptsInput) {
    return;
  }

  const text = view.elements.runInputText.value;

  try {
    await api.sendInput(state.runId, text);
    view.addLine(`> ${text}`, "agent-status");
    view.elements.runInputText.value = "";
  } catch (error) {
    view.addLine(`無法送出：${error.message}`, "failed");
  }
});

view.elements.recheckEnv.addEventListener("click", () => checkEnvironment());
checkEnvironment();
