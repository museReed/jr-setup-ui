// 把 View 的事件、Model 的請求、ViewModel 的判斷接起來。
// 這裡只做接線與狀態保管，判斷邏輯在 viewmodel.js、畫面操作在 view.js。
import * as api from "./api.js";
import * as view from "./view.js";
import {
  CONFIG_LANGUAGES,
  CONFIG_TOOL_CHOICES,
  LOGIN_CHECK_IDS,
  LOGIN_POLL_INTERVAL_MS,
  VERIFIED_BY_ACTION,
  agentNameFor,
  behaviorFallbackState,
  configSummary,
  envButtonState,
  extractLoginHints,
  installStatusMessage,
  isLoginAction,
  loginWaitStep,
  rowRunOptions,
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
  configCheckInProgress: false,
  loginWait: null,
  // 這一頁開著的期間，哪幾列已經驗過行為了。重新整理就歸零——那是刻意的：
  // 驗證證明的是「那個當下生效」，換一次環境就該重驗。
  verifiedSteps: new Set(),
};

function renderControls() {
  view.renderRunControls(
    runControlsState({
      runInProgress: state.runInProgress,
      runId: state.runId,
      acceptsInput: state.acceptsInput,
      envCheckInProgress: state.envCheckInProgress,
      configCheckInProgress: state.configCheckInProgress,
    }),
  );
}

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
  renderControls();
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

async function checkConfigs() {
  if (state.configCheckInProgress) {
    return;
  }

  state.configCheckInProgress = true;
  renderControls();
  view.renderConfigLoading();
  const tools = view.elements.configTools.value;
  const lang = view.elements.configLang.value;

  try {
    const result = await api.fetchConfigs({ tools, lang });
    view.renderConfigs(
      result.checks,
      (action, button, step) =>
        run(
          action,
          undefined,
          button,
          rowRunOptions({ step, lang: result.lang, tools }),
        ),
      {
        verifiedSteps: state.verifiedSteps,
        onEyeToggle: (step, checked) => {
          if (checked) {
            state.verifiedSteps.add(step);
          } else {
            state.verifiedSteps.delete(step);
          }

          checkConfigs();
        },
      },
    );
    view.renderConfigSummary(
      configSummary(result.checks, state.verifiedSteps),
    );
  } catch (error) {
    view.renderConfigFailure(error.message);
  } finally {
    state.configCheckInProgress = false;
    renderControls();
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

function handleDone(action, envButton, configAction, result) {
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

  if (!outcome.succeeded) {
    return;
  }

  // 驗證過了才記——失敗的話上面就 return 了，這裡不會留下假的已驗證。
  const verifiedByThisRun = VERIFIED_BY_ACTION[action];

  if (verifiedByThisRun !== undefined) {
    for (const step of verifiedByThisRun) {
      state.verifiedSteps.add(step);
    }

    checkConfigs();
    return;
  }

  if (configAction) {
    checkConfigs();
    return;
  }

  if (!wasEnvAction) {
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

async function run(action, promptText, button = null, options) {
  const configAction = options !== undefined && action !== "verify-behavior";
  const envButton = options === undefined ? button : null;

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

    if (options !== undefined) {
      body.options = options;
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
      const result = JSON.parse(event.data);

      if (action === "verify-behavior") {
        view.renderBehaviorFallback(behaviorFallbackState(result));
      }

      handleDone(action, envButton, configAction, result);
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

view.elements.copyBehaviorQuestion.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(
      view.elements.behaviorQuestion.textContent,
    );
    view.elements.copyBehaviorQuestion.textContent = "已複製";
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
view.renderConfigChoices(CONFIG_TOOL_CHOICES, CONFIG_LANGUAGES);
view.elements.recheckConfigs.addEventListener("click", checkConfigs);
view.elements.configTools.addEventListener("change", checkConfigs);
view.elements.configLang.addEventListener("change", checkConfigs);
view.elements.verifyConfigs.addEventListener("click", () => {
  run("verify-configs", undefined, view.elements.verifyConfigs, {
    lang: view.elements.configLang.value,
    tools: view.elements.configTools.value,
  });
});
view.elements.verifyBehavior.addEventListener("click", () => {
  view.renderBehaviorFallback({ visible: false });
  run("verify-behavior", undefined, view.elements.verifyBehavior, {
    tools: view.elements.configTools.value,
  });
});
// 這顆不帶 options（驗的是「Claude Code 有沒有真的載入 hook」，跟語言與工具無關），
// 也不把按鈕傳進去——傳了會被當成環境檢查那區的動作，跑完誤觸發環境重查與
// 「安裝完成」訊息。按鈕的鎖定由 configControlsDisabled 統一處理。
view.elements.verifyHookLive.addEventListener("click", () => {
  run("verify-hook-live", undefined, null);
});
// 同上：不帶 options、不傳按鈕。
view.elements.verifyNaming.addEventListener("click", () => {
  run("verify-hooks-live", undefined, null);
});
checkEnvironment();
checkConfigs();
