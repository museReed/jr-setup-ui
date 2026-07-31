// 把 View 的事件、Model 的請求、ViewModel 的判斷接起來。
// 這裡只做接線與狀態保管，判斷邏輯在 viewmodel.js、畫面操作在 view.js。
import * as api from "./api.js";
import * as view from "./view.js";
import {
  CONFIG_LANGUAGES,
  CONFIG_TOOL_CHOICES,
  SECTIONS,
  sectionGateState,
} from "./model.js";
import {
  LOGIN_CHECK_IDS,
  LOGIN_POLL_INTERVAL_MS,
  AUTO_VERIFY_ACTIONS,
  LOADER_MODIFIERS,
  agentNameFor,
  behaviorFallbackState,
  configSummary,
  envButtonState,
  extractLoginHints,
  installVerificationFollowUp,
  installStatusMessage,
  isLoginAction,
  loaderModifier,
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
  activeRunButton: null,
  activeRunStep: null,
  currentEnvAction: null,
  currentLoaderModifier: null,
  loaderPaused: false,
  envCheckInProgress: false,
  configCheckInProgress: false,
  loginWait: null,
  // 後端只會載入內容指紋仍相同的紀錄；素材重裝或檔案被改過，這裡就不會拿到。
  verifiedSteps: new Set(),
  verificationPrompts: new Set(),
  completedGateIds: new Set(),
  // handleDone 要知道被按的那一列是不是「程式抓得到證據」的那種。
  lastChecks: [],
};

async function rememberVerifiedStep(step) {
  state.verifiedSteps.add(step);

  try {
    await api.saveVerifiedStep(step);
  } catch (error) {
    view.addLine(`無法保存驗證進度：${error.message}`, "failed");
  }
}

async function loadVerifiedSteps() {
  try {
    const result = await api.fetchState();
    state.verifiedSteps = new Set(result.verified);
  } catch {
    state.verifiedSteps = new Set();
  }
}

function renderCheckingLoader() {
  if (state.runInProgress) {
    return;
  }

  if (state.envCheckInProgress || state.configCheckInProgress) {
    state.loaderPaused = false;
    view.renderLoaders({
      modifier: loaderModifier({ checking: true }),
      topOnly: true,
    });
  } else if (!state.loaderPaused) {
    view.hideLoaders();
  }
}

function renderNavigation() {
  const tools = view.elements.configTools.value;
  const lockStates = Object.fromEntries(
    SECTIONS.map((section) => [
      section.id,
      sectionGateState(section.id, state.completedGateIds, tools),
    ]),
  );
  view.renderSectionLocks(lockStates);
  view.renderGateVisibility(tools.split(",").includes("codex"));
  return lockStates;
}

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

function resetRun({ keepLoader = false } = {}) {
  state.runId = null;
  state.acceptsInput = false;
  state.activeEnvButton = null;
  state.activeRunButton = null;
  state.activeRunStep = null;
  state.currentEnvAction = null;
  view.clearLoginHints();

  if (!keepLoader) {
    state.currentLoaderModifier = null;
    state.loaderPaused = false;
    view.hideLoaders();
  }

  setRunning(false);
}

function renderRunLoader(modifier, paused = false) {
  if (modifier === null) {
    return;
  }

  if (!paused) {
    state.currentLoaderModifier = modifier;
  }

  state.loaderPaused = paused;
  view.renderLoaders({
    modifier:
      paused && state.currentLoaderModifier === null
        ? LOADER_MODIFIERS.working
        : state.currentLoaderModifier,
    button: state.activeRunButton,
    step: state.activeRunStep,
    paused,
  });
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
  renderCheckingLoader();

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
    renderCheckingLoader();
  }
}

async function checkConfigs() {
  if (state.configCheckInProgress) {
    return;
  }

  state.configCheckInProgress = true;
  renderControls();
  view.renderConfigLoading();
  renderCheckingLoader();
  const tools = view.elements.configTools.value;
  const lang = view.elements.configLang.value;

  try {
    const result = await api.fetchConfigs({ tools, lang });
    state.lastChecks = result.checks;
    view.renderConfigs(
      result.checks,
      (action, button, step, extra) =>
        run(
          action,
          undefined,
          button,
          rowRunOptions({ step, lang: result.lang, tools, extra }),
        ),
      {
        verifiedSteps: state.verifiedSteps,
        verificationPrompts: state.verificationPrompts,
        onEyeToggle: async (step, checked) => {
          if (checked) {
            await rememberVerifiedStep(step);
          } else {
            state.verifiedSteps.delete(step);
          }

          checkConfigs();
        },
        onVerifyNow: (check) => {
          state.verificationPrompts.delete(check.id);
          run(
            check.verifyAction,
            undefined,
            null,
            rowRunOptions({
              step: check.id,
              lang: result.lang,
              tools,
              extra: check.verifyOptions,
            }),
          );
        },
        onVerifyLater: (step) => {
          state.verificationPrompts.delete(step);
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
    renderCheckingLoader();
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

async function handleDone(action, envButton, configAction, result, options) {
  const outcome = runOutcome(result);
  view.addLine(outcome.summary, outcome.className);

  if (state.activeEnvButton !== null) {
    const message = installStatusMessage(action, result);

    if (message !== null && message.failed) {
      view.showInstallStatus(message);
    }
  }

  const wasEnvAction = envButton !== null;

  if (!outcome.succeeded) {
    renderRunLoader(
      loaderModifier({ action, options, result }),
      true,
    );
    resetRun({ keepLoader: true });
    return;
  }

  const verifiedStep = options?.step;
  const installedCheck = state.lastChecks.find(
    (check) => check.id === verifiedStep,
  );
  const followUp = installVerificationFollowUp({
    action,
    result,
    check: installedCheck,
  });
  resetRun();

  if (followUp === "auto") {
    run(
      installedCheck.verifyAction,
      undefined,
      null,
      rowRunOptions({
        step: installedCheck.id,
        lang: options.lang,
        tools: options.tools,
        extra: installedCheck.verifyOptions,
      }),
    );
    return;
  }

  if (followUp === "prompt") {
    state.verificationPrompts.add(installedCheck.id);
    checkConfigs();
    return;
  }

  // 驗證過了才記，而且只記被按的那一列——失敗的話上面就 return 了，這裡不會留下
  // 假的已驗證。
  // 有勾選框的列不自動標綠：那代表程式抓不到證據，只能由學生看完說了算。
  // 開終端驗證跑完 exit 0 不一定等於「驗過了」——codex 命名那格就是開完視窗
  // 直接結束，沒有可輪詢的落點。
  const verifiedCheck = state.lastChecks.find(
    (check) => check.id === verifiedStep,
  );

  if (
    AUTO_VERIFY_ACTIONS.has(action) &&
    verifiedStep !== undefined &&
    verifiedCheck?.eyeCheck == null
  ) {
    await rememberVerifiedStep(verifiedStep);
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
  state.activeRunButton = button;
  state.activeRunStep = options?.step ?? null;
  state.currentEnvAction = envButton === null ? null : action;
  state.loaderPaused = false;

  if (action !== "install-config-step" && state.activeRunStep !== null) {
    state.verificationPrompts.delete(state.activeRunStep);
  }

  if (envButton !== null) {
    view.hideInstallStatus();
  }

  state.agentName = agentNameFor(action);
  state.runId = null;
  state.acceptsInput = false;
  state.currentLoaderModifier =
    loaderModifier({ action, options }) ?? LOADER_MODIFIERS.working;
  renderRunLoader(state.currentLoaderModifier);
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
      const nextModifier = loaderModifier({
        action,
        options,
        output: line.text,
      });

      if (nextModifier !== null) {
        renderRunLoader(nextModifier);
      }

      if (isLoginAction(action)) {
        view.showLoginHints(extractLoginHints(line.text));
      }

      view.addLine(line.text, line.stream === "stderr" ? "stderr" : "");
    });

    events.addEventListener("agent", (event) => {
      view.addAgentEvent(JSON.parse(event.data), state.agentName);
    });

    events.addEventListener("jr", (event) => {
      const jrEvent = JSON.parse(event.data);
      const nextModifier = loaderModifier({ action, options, jrEvent });

      if (nextModifier !== null) {
        renderRunLoader(nextModifier);
      }
    });

    events.addEventListener("done", async (event) => {
      done = true;
      events.close();
      const result = JSON.parse(event.data);

      if (action === "verify-behavior") {
        view.renderBehaviorFallback(behaviorFallbackState(result));
      }

      await handleDone(action, envButton, configAction, result, options);
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
view.elements.configTools.addEventListener("change", () => {
  state.verificationPrompts.clear();
  renderNavigation();
  view.hideSectionLockMessage();
  checkConfigs();
});
view.elements.configLang.addEventListener("change", checkConfigs);
view.onSectionSelect((sectionId) => {
  const gate = renderNavigation()[sectionId];

  if (gate.locked) {
    view.showSectionLockMessage(gate.reason);
    return;
  }

  view.hideSectionLockMessage();
  view.showSection(sectionId);
});
view.onGateToggle((gateId, checked) => {
  if (checked) {
    state.completedGateIds.add(gateId);
  } else {
    state.completedGateIds.delete(gateId);
  }

  renderNavigation();
  view.hideSectionLockMessage();
});
renderNavigation();

async function initialize() {
  await loadVerifiedSteps();
  checkEnvironment();
  checkConfigs();
}

initialize();
