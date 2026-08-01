// 把 View 的事件、Model 的請求、ViewModel 的判斷接起來。
// 這裡只做接線與狀態保管，判斷邏輯在 viewmodel.js、畫面操作在 view.js。
import * as api from "./api.js";
import * as view from "./view.js";
import {
  CONFIG_LANGUAGES,
  CONFIG_TOOL_CHOICES,
  flattenCheckCards,
  FULLSCREEN_PROMPT,
  groupChecks,
  matchesFullscreenProof,
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
  cardIsComplete,
  cardResultItems,
  cardResultText,
  cardStatusModel,
  checklistGroups,
  configRowModel,
  configSummary,
  currentCardIndex,
  envButtonState,
  envCardRowModel,
  extractLoginHints,
  guidanceModel,
  installVerificationFollowUp,
  installStatusMessage,
  isLoginAction,
  loaderModifier,
  loginCardModel,
  loginWaitStep,
  rowRunOptions,
  runControlsState,
  runOutcome,
  sectionManualItems,
  sectionStatus,
  milestoneModels,
  nextCardUnlocked,
  terminalOutcomeLines,
  toggleToolSelection,
  toolSelectionValue,
} from "./viewmodel.js";

// 工具與語言的選擇存在伺服器的 state.json，不是 localStorage。
//
// localStorage 綁在 origin 上，而這個伺服器每次啟動都換 port——重開一次 origin 就
// 變了，存的東西等於不見。學生勾了 Codex、重開嚮導就默默退回只有 Claude，卡片少
// 一半也沒有任何提示（實測踩到）。
async function saveSelection() {
  try {
    await api.saveSelection({
      tools: state.selectedTools,
      lang: state.selectedLanguage,
    });
  } catch {
    // 存不進去就算了，這一輪還是照常運作。
  }
}

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
  behaviorVerifiedSteps: new Set(),
  completedGateIds: new Set(),
  // handleDone 要知道被按的那一列是不是「程式抓得到證據」的那種。
  lastChecks: [],
  availableActions: new Set(["diagnose-naming-block"]),
  envChecks: [],
  activeSectionId: "env",
  viewingCardIndex: {},
  setupCompleted: false,
  installedSteps: new Set(),
  verificationAttempted: new Set(),
  failedVerificationSteps: new Set(),
  failedSteps: new Set(),
  resultTexts: new Map(),
  deferredVerificationSteps: new Set(),
  manualCheckedIds: new Set(),
  pasteProofValue: "",
  selectedTools: ["claude"],
  selectedLanguage: "zh-TW",
  pendingModalCheck: null,
  loginHints: { url: null, code: null },
};

async function rememberVerifiedStep(step) {
  state.verifiedSteps.add(step);

  try {
    await api.saveVerifiedStep(step);
  } catch (error) {
    view.addLine(`無法保存驗證進度：${error.message}`, "failed");
  }
}

// 人工勾選也存伺服器。以前只存在瀏覽器記憶體，重整一次全部退回未勾——「全螢幕
// 模式」那張卡整張都是人工項目，重整就等於整張重做。
function setManualChecked(id, checked) {
  if (checked) {
    state.manualCheckedIds.add(id);
    state.completedGateIds.add(id);
  } else {
    state.manualCheckedIds.delete(id);
    state.completedGateIds.delete(id);
  }

  api
    .saveManualChecked([...state.manualCheckedIds])
    .catch((error) => view.addLine(`無法保存勾選：${error.message}`, "failed"));
}

// 程式那半過了就記，不管那一列有沒有眼睛勾選框——清單第一格要立刻反映終端剛印的
// 「驗證成功」，不能等學生勾完眼睛才一起變。
async function rememberBehaviorVerified(step) {
  state.behaviorVerifiedSteps.add(step);

  try {
    await api.saveBehaviorVerified(step);
  } catch (error) {
    view.addLine(`無法保存驗證進度：${error.message}`, "failed");
  }
}

async function loadVerifiedSteps() {
  try {
    const result = await api.fetchState();
    state.verifiedSteps = new Set(result.verified);
    state.behaviorVerifiedSteps = new Set(result.behavior ?? []);
    state.manualCheckedIds = new Set(result.manual ?? []);

    for (const id of state.manualCheckedIds) {
      state.completedGateIds.add(id);
    }

    // 伺服器記著上次選的工具與語言，開頁時要套回來。
    if (result.selection?.tools?.length > 0) {
      state.selectedTools = result.selection.tools;
    }

    if (CONFIG_LANGUAGES.includes(result.selection?.lang)) {
      state.selectedLanguage = result.selection.lang;
    }
  } catch {
    state.verifiedSteps = new Set();
    state.behaviorVerifiedSteps = new Set();
    state.manualCheckedIds = new Set();
  }
}

function effectiveVerifiedSteps() {
  const verified = new Set(state.verifiedSteps);

  for (const id of state.manualCheckedIds) {
    if (id.startsWith("eye-")) {
      verified.add(id.slice("eye-".length));
    }
  }

  return verified;
}

function allCardSections() {
  return flattenCheckCards(groupChecks(state.lastChecks), state.envChecks).map(
    (section) => ({
      ...section,
      cards: section.cards.map((card) =>
        card.kind === "setup"
          ? { ...card, completed: state.setupCompleted }
          : card,
      ),
    }),
  );
}

function runConfigCheckAction(check, action, button, extra) {
  run(
    action,
    undefined,
    button,
    rowRunOptions({
      step: check.id,
      lang: state.selectedLanguage,
      tools: toolSelectionValue(state.selectedTools),
      extra,
    }),
  );
}

function renderWizard() {
  const section = SECTIONS.find(({ id }) => id === state.activeSectionId);
  const cardSection = allCardSections().find(
    ({ sectionId }) => sectionId === state.activeSectionId,
  );

  if (section === undefined || cardSection === undefined || cardSection.cards.length === 0) {
    return;
  }

  const verified = effectiveVerifiedSteps();
  const derivedIndex = currentCardIndex(cardSection.cards, verified, state.manualCheckedIds);
  const requestedIndex = state.viewingCardIndex[state.activeSectionId];
  const currentIndex =
    requestedIndex === undefined
      ? derivedIndex
      : Math.min(requestedIndex, cardSection.cards.length - 1);
  const card = cardSection.cards[currentIndex];
  const manualItems = sectionManualItems(
    section.id,
    currentIndex,
    cardSection.cards.length,
    toolSelectionValue(state.selectedTools),
    card.checkId,
  );
  const cardChecks = card.checks ?? (card.check == null ? [] : [card.check]);
  // 清單的勾要跟卡片右上角的狀態徽章講同一件事。
  //
  // 原本 config 卡只看 verified.has()，於是「不需要行為驗證」的項目（裝好就算數，
  // 沒有 verifyAction 也沒有 eyeCheck）永遠不會被勾——畫面變成徽章寫「已完成」、
  // 清單卻是 0/1（VM 實測 CLAUDE.md 那張）。
  //
  // 改成用 configRowModel 的最終狀態判斷：它已經把「裝好了但還沒驗行為」算成
  // unverified，所以不會放過真的該驗的項目。
  //
  // 再加一條：程式那半驗過的列，第一格立刻打勾，不等整列變綠。有眼睛勾選框的列
  // 本來就不會 status === "ok"（那要等學生勾），但清單第一格講的是「程式驗過了
  // 嗎」——終端都印「驗證成功」了還空著，學生只會以為驗證沒生效（Reed 實測）。
  const verifiedCheckIds = new Set(
    cardChecks
      .filter((check) =>
        card.kind === "env"
          ? check.status === "ok"
          : configRowModel(check, verified.has(check.id)).status === "ok" ||
            state.behaviorVerifiedSteps.has(check.id),
      )
      .map((check) => check.id),
  );
  const groups = checklistGroups({
    checks: cardChecks,
    verifiedCheckIds,
    verificationAttempted: state.verificationAttempted.has(card.checkId),
    verificationFailed: state.failedVerificationSteps.has(card.checkId),
    manualItems,
    checkedManualIds: state.manualCheckedIds,
    resultTexts: state.resultTexts,
  });
  const installChecks = cardChecks.filter(
    (check) => !check.id.endsWith("-auth"),
  );
  // installedSteps 只是「這一輪按過安裝」的樂觀記憶，不能凌駕伺服器回來的權威狀態。
  //
  // 原本 installedSteps.has() 擺在最前面當 OR，於是只要按過一次安裝，按鈕就永久
  // 置灰——即使安裝其實失敗、伺服器回的還是 missing。學生看到一顆灰掉的「✅ 安裝」
  // 和一個裝不起來的項目，連重試的機會都沒有（VM 實測：gh 的 status 是 missing，
  // 按鈕卻是灰的）。這是這個 repo 踩過很多次的假綠燈。
  //
  // 規則改成：權威狀態說 ok 才算裝好；樂觀記憶只在權威狀態還沒否定它時有效。
  const installed =
    card.kind === "setup" ||
    installChecks.every(
      (check) =>
        check.status === "ok" ||
        (card.kind === "config" && check.noInstall === true) ||
        (state.installedSteps.has(check.id) && check.status !== "missing"),
    );
  const verificationRequired =
    card.check?.verifyAction != null || card.check?.eyeCheck != null;
  const verificationAttempted =
    !verificationRequired ||
    verified.has(card.checkId) ||
    state.verificationAttempted.has(card.checkId);
  const nextUnlocked =
    card.kind === "setup"
      ? true
      : card.kind === "env"
        ? cardIsComplete(card, verified, state.manualCheckedIds) &&
          groups.manual.every((item) => item.checked)
        : nextCardUnlocked({
          installed,
          verificationRequired,
          verificationAttempted,
          manualItems: groups.manual,
        });
  const completedCardIds = new Set(
    cardSection.cards
      .filter((candidate) => {
        if (candidate.kind === "setup") return candidate.completed === true;
        if (cardIsComplete(candidate, verified, state.manualCheckedIds)) return true;
        if (candidate.checkId === card.checkId) return nextUnlocked;
        return state.verificationAttempted.has(candidate.checkId) &&
          state.installedSteps.has(candidate.checkId);
      })
      .map(({ checkId }) => checkId),
  );
  const milestones = milestoneModels(
    cardSection.cards,
    completedCardIds,
    currentIndex,
  );
  let row =
    card.kind === "env"
      ? envCardRowModel(card, state.installedSteps)
      : card.kind === "config"
        ? configRowModel(card.check, verified.has(card.checkId), {
            availableActions: state.availableActions,
            installed: state.installedSteps.has(card.checkId),
            verificationAttempted: state.verificationAttempted.has(
              card.checkId,
            ),
            verificationFailed: state.failedVerificationSteps.has(card.checkId),
            verificationDeferred: state.deferredVerificationSteps.has(card.checkId),
          })
        : null;
  if (row !== null) {
    row = {
      ...row,
      detail: cardResultText(card, state.resultTexts),
      results: cardResultItems(card, state.resultTexts),
    };
  }
  const activeCheckId =
    state.activeRunStep ??
    LOGIN_CHECK_IDS[state.currentEnvAction] ??
    (state.currentEnvAction?.startsWith("install-")
      ? state.currentEnvAction.slice("install-".length)
      : null);
  const status = cardStatusModel({
    completed: cardIsComplete(card, verified, state.manualCheckedIds),
    running:
      state.runInProgress &&
      (card.kind === "setup" ||
        cardChecks.some((check) => check.id === activeCheckId)),
    failed: cardChecks.some(
      (check) =>
        state.failedSteps.has(check.id) ||
        state.failedVerificationSteps.has(check.id),
    ),
    installed,
  });
  const login = loginCardModel({
    checks: cardChecks,
    hints: state.loginHints,
    acceptsInput: state.acceptsInput,
    runInProgress: state.runInProgress,
    runId: state.runId,
  });
  const cardModel = {
    card,
    row,
    status,
    login,
    checklist: groups,
    showChecklist: card.kind !== "setup",
    pasteProof:
      card.checkId === "fullscreen"
        ? {
            prompt: FULLSCREEN_PROMPT,
            value: state.pasteProofValue,
            matched: matchesFullscreenProof(state.pasteProofValue),
            onInput: (value) => cardModel.onPasteProofInput(value),
          }
        : null,
    showRetest: card.kind === "env" || row?.showRetest === true,
    showNext: currentIndex < cardSection.cards.length - 1 && nextUnlocked,
    nextUnlocked,
    onActionClick: (action, button, step, extra) => {
      if (card.kind === "env") run(action, undefined, button);
      else runConfigCheckAction(card.check, action, button, extra);
    },
    onRetest: () => {
      if (card.kind === "env") {
        checkEnvironment();
        return;
      }
      runConfigCheckAction(
        card.check,
        card.check.verifyAction,
        null,
        card.check.verifyOptions,
      );
    },
    onCopyLoginCode: async (code, button) => {
      try {
        await navigator.clipboard.writeText(code);
        button.textContent = "已複製";
      } catch (error) {
        view.addLine(`無法複製：${error.message}`, "failed");
      }
    },
    onLoginInput: async (text, input) => {
      if (state.runId === null || !state.acceptsInput) return;
      try {
        await api.sendInput(state.runId, text);
        view.addLine(`> ${text}`, "agent-status");
        input.value = "";
      } catch (error) {
        view.addLine(`無法送出：${error.message}`, "failed");
      }
    },
    onManualToggle: (id, checked) => {
      setManualChecked(id, checked);
      renderNavigation();
      renderWizard();
    },
    // 貼對了就自己打勾，貼錯或清空就取消——學生不用再多按一次勾選框。
    onPasteProofInput: (value) => {
      state.pasteProofValue = value;
      setManualChecked("fullscreen-copy", matchesFullscreenProof(value));
      renderNavigation();
      renderWizard();
    },
    onNext: () => {
      if (card.kind === "setup") state.setupCompleted = true;
      state.viewingCardIndex[state.activeSectionId] = currentIndex + 1;
      renderWizard();
    },
  };
  view.renderWizard({
    section,
    sectionStatus: sectionStatus(
      cardSection.cards,
      completedCardIds,
      currentIndex,
    ),
    milestones,
    cardModel,
    onMilestoneSelect: (index) => {
      if (!milestones[index].unlocked) return;
      state.viewingCardIndex[state.activeSectionId] = index;
      renderWizard();
    },
  });
  renderControls();
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

// 每一段是不是真的做完了——不是問學生，是看每張卡的實際狀態。
// 資料還沒回來時回 undefined，讓閘門知道「還不確定」而不是「沒做完」，
// 免得載入中把人鎖在外面。
function sectionCompletion() {
  const verified = effectiveVerifiedSteps();
  const sections = allCardSections();

  return Object.fromEntries(
    SECTIONS.map((section) => {
      const found = sections.find((s) => s.sectionId === section.id);

      if (found === undefined || found.cards.length === 0) {
        return [section.id, undefined];
      }

      return [
        section.id,
        found.cards.every(
          (card) =>
            card.kind === "setup"
              ? card.completed === true
              : cardIsComplete(card, verified, state.manualCheckedIds),
        ),
      ];
    }),
  );
}

function renderNavigation() {
  const tools = toolSelectionValue(state.selectedTools);
  const done = sectionCompletion();
  const lockStates = Object.fromEntries(
    SECTIONS.map((section) => [
      section.id,
      sectionGateState(section.id, state.completedGateIds, tools, done),
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
        permanentlyDisabled: button.dataset.permanentlyDisabled === "true",
        runInProgress: state.runInProgress,
        currentEnvAction: state.currentEnvAction,
        waitingAction: state.loginWait?.action ?? null,
      }),
    );
  }
}

function setRunning(running) {
  state.runInProgress = running;
  renderWizard();
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
  state.loginHints = { url: null, code: null };
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
    state.envChecks = checks;
    view.elements.envOs.textContent = `作業系統：${os.platform} / ${os.arch}`;
    renderWizard();
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
    state.envChecks = [];
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
  const tools = toolSelectionValue(state.selectedTools);
  const lang = state.selectedLanguage;

  try {
    const result = await api.fetchConfigs({ tools, lang });
    state.lastChecks = result.checks;
    state.availableActions = new Set([
      "diagnose-naming-block",
      ...(result.platform === "win32" ? ["diagnose-title-path"] : []),
    ]);
    renderWizard();
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

async function handleDone(
  action,
  envButton,
  configAction,
  result,
  options,
  runContext,
) {
  const outcome = runOutcome(result);
  view.addRawLine(outcome.summary);
  const step = options?.step ?? runContext.step;
  const check =
    state.lastChecks.find((candidate) => candidate.id === step) ??
    state.envChecks.find((candidate) => candidate.id === step) ??
    null;

  if (state.activeEnvButton !== null) {
    const message = installStatusMessage(action, result);

    if (message !== null && message.failed) {
      view.showInstallStatus(message);
    }
  }

  const wasEnvAction = envButton !== null;

  if (!outcome.succeeded) {
    const guidance = guidanceModel({
      step: runContext.step,
      status: "missing",
      failed: true,
      availableActions: state.availableActions,
    });
    const verification =
      action.startsWith("verify-") || AUTO_VERIFY_ACTIONS.has(action);

    if (verification && step !== null && step !== undefined) {
      state.verificationAttempted.add(step);
      state.failedVerificationSteps.add(step);
      state.deferredVerificationSteps.delete(step);
    }
    if (step !== null && step !== undefined) {
      state.failedSteps.add(step);
      const reason = runContext.rawOutput.findLast((line) => line.trim() !== "");
      state.resultTexts.set(
        step,
        `${check?.label ?? "這個項目"}：${reason ?? outcome.summary}`,
      );
    }

    view.addTerminalLines(
      terminalOutcomeLines({ action, succeeded: false, check, guidance }),
    );
    view.shakeTerminal();

    if (guidance !== null || result.explanationPending === true) {
      view.renderFailureGuidance({
        button: runContext.button,
        step: runContext.step,
        guidance,
        rawOutput:
          result.explanationPending === true
            ? runContext.rawOutput.join("\n")
            : "",
        onActionClick: (nextAction, nextButton, step) =>
          run(
            nextAction,
            undefined,
            nextButton,
            rowRunOptions({
              step,
              lang: state.selectedLanguage,
              tools: toolSelectionValue(state.selectedTools),
            }),
          ),
      });
    }

    renderRunLoader(
      loaderModifier({ action, options, result }),
      true,
    );
    resetRun({ keepLoader: true });
    renderWizard();
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
  if (
    step !== null &&
    step !== undefined &&
    (action.startsWith("install-") || action === "merge-config-step")
  ) {
    state.installedSteps.add(step);
  }
  if (step !== null && step !== undefined) {
    state.failedSteps.delete(step);
    state.resultTexts.delete(step);
  }
  if (
    verifiedStep !== undefined &&
    (action.startsWith("verify-") || AUTO_VERIFY_ACTIONS.has(action))
  ) {
    state.verificationAttempted.add(verifiedStep);
    state.failedVerificationSteps.delete(verifiedStep);
    state.deferredVerificationSteps.delete(verifiedStep);
  }
  view.addTerminalLines(
    terminalOutcomeLines({ action, succeeded: true, check }),
  );
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
    state.pendingModalCheck = installedCheck;
    view.showVerifyModal();
    renderWizard();
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

  if (AUTO_VERIFY_ACTIONS.has(action) && verifiedStep !== undefined) {
    // 程式那半的結論一律記下來。以前這裡是「有眼睛勾選框就整個不記」，於是那半
    // 的結果無處可存，清單第一格只好等學生勾眼睛時才順便變綠。
    await rememberBehaviorVerified(verifiedStep);

    if (verifiedCheck?.eyeCheck == null) {
      await rememberVerifiedStep(verifiedStep);
    }

    await checkConfigs();
    return;
  }

  if (configAction) {
    await checkConfigs();
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

  await checkEnvironment();
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
  const runContext = {
    button,
    step:
      options?.step ??
      LOGIN_CHECK_IDS[action] ??
      (action.startsWith("install-") ? action.slice("install-".length) : null),
    rawOutput: [],
    explanation: null,
  };

  if (action !== "install-config-step" && state.activeRunStep !== null) {
    state.deferredVerificationSteps.delete(state.activeRunStep);
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
      runContext.rawOutput.push(line.text);
      const nextModifier = loaderModifier({
        action,
        options,
        output: line.text,
      });

      if (nextModifier !== null) {
        renderRunLoader(nextModifier);
      }

      if (isLoginAction(action)) {
        const hints = extractLoginHints(line.text);
        state.loginHints = {
          url: hints.url ?? state.loginHints.url,
          code: hints.code ?? state.loginHints.code,
        };
        view.showLoginHints(
          loginCardModel({
            checks: state.envChecks.filter(
              (check) => check.id === LOGIN_CHECK_IDS[action],
            ),
            hints: state.loginHints,
            acceptsInput: state.acceptsInput,
            runInProgress: state.runInProgress,
            runId: state.runId,
          }),
        );
      }

      view.addRawLine(line.text);
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

    events.addEventListener("explain", (event) => {
      const explanation = JSON.parse(event.data);
      const targetButton =
        runContext.button?.isConnected === true ? runContext.button : null;

      if (explanation.kind === "start") {
        runContext.explanation = null;

        if (!state.runInProgress) {
          view.renderLoaders({
            modifier: LOADER_MODIFIERS.composing,
            button: targetButton,
            step: runContext.step,
          });
        }
      } else {
        runContext.explanation = explanation.text;
        events.close();

        if (!state.runInProgress) {
          state.currentLoaderModifier = null;
          state.loaderPaused = false;
          view.hideLoaders();
        }
      }

      view.renderFailureGuidance({
        button: targetButton,
        step: runContext.step,
        guidance: guidanceModel({
          step: runContext.step,
          status: "missing",
          failed: true,
          availableActions: state.availableActions,
        }),
        explanation: runContext.explanation,
        rawOutput: runContext.rawOutput.join("\n"),
        translating: explanation.kind === "start",
        onActionClick: (nextAction, nextButton, step) =>
          run(
            nextAction,
            undefined,
            nextButton,
            rowRunOptions({
              step,
              lang: state.selectedLanguage,
              tools: toolSelectionValue(state.selectedTools),
            }),
          ),
      });
      renderControls();
    });

    events.addEventListener("done", async (event) => {
      done = true;
      const result = JSON.parse(event.data);

      if (result.explanationPending !== true) {
        events.close();
      }

      if (action === "verify-behavior") {
        view.renderBehaviorFallback(behaviorFallbackState(result));
      }

      await handleDone(
        action,
        envButton,
        configAction,
        result,
        options,
        runContext,
      );
    });

    events.onerror = () => {
      events.close();

      if (!done) {
        view.addLine("串流連線中斷", "failed");
        if (runContext.step !== null && runContext.step !== undefined) {
          const failedCheck = [...state.lastChecks, ...state.envChecks].find(
            (candidate) => candidate.id === runContext.step,
          );
          state.failedSteps.add(runContext.step);
          state.resultTexts.set(
            runContext.step,
            `${failedCheck?.label ?? "這個項目"}：串流連線中斷`,
          );
        }
        resetRun();
      }
    };
  } catch (error) {
    view.addLine(`無法執行：${error.message}`, "failed");
    if (runContext.step !== null && runContext.step !== undefined) {
      const failedCheck = [...state.lastChecks, ...state.envChecks].find(
        (candidate) => candidate.id === runContext.step,
      );
      state.failedSteps.add(runContext.step);
      state.resultTexts.set(
        runContext.step,
        `${failedCheck?.label ?? "這個項目"}：無法執行，${error.message}`,
      );
    }
    const guidance = guidanceModel({
      step: options?.step,
      status: "missing",
      failed: true,
      availableActions: state.availableActions,
    });

    if (guidance !== null) {
      view.renderFailureGuidance({
        button: state.activeRunButton,
        step: options?.step,
        guidance,
        onActionClick: (nextAction, nextButton, step) =>
          run(
            nextAction,
            undefined,
            nextButton,
            rowRunOptions({
              step,
              lang: state.selectedLanguage,
              tools: toolSelectionValue(state.selectedTools),
            }),
          ),
      });
    }

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

view.elements.recheckEnv.addEventListener("click", () => checkEnvironment());
view.renderConfigChoices(CONFIG_TOOL_CHOICES, CONFIG_LANGUAGES);
view.elements.recheckConfigs.addEventListener("click", checkConfigs);
view.onToolSelect((tool) => {
  state.selectedTools = toggleToolSelection(state.selectedTools, tool);
  saveSelection();
  view.setConfigSelection(state.selectedTools, state.selectedLanguage);
  state.viewingCardIndex = {};
  renderNavigation();
  view.hideSectionLockMessage();
  checkConfigs();
});
view.onLanguageSelect((language) => {
  state.selectedLanguage = language;
  saveSelection();
  view.setConfigSelection(state.selectedTools, state.selectedLanguage);
  checkConfigs();
});
view.onSectionSelect((sectionId) => {
  const gate = renderNavigation()[sectionId];

  if (gate.locked) {
    view.showSectionLockMessage(gate.reason);
    return;
  }

  view.hideSectionLockMessage();
  state.activeSectionId = sectionId;
  renderWizard();
});
view.onVerifyModal(
  () => {
    const check = state.pendingModalCheck;
    state.pendingModalCheck = null;
    view.hideVerifyModal();
    if (check !== null) {
      runConfigCheckAction(check, check.verifyAction, null, check.verifyOptions);
    }
  },
  () => {
    const check = state.pendingModalCheck;
    state.pendingModalCheck = null;
    view.hideVerifyModal();
    if (check !== null) {
      state.deferredVerificationSteps.add(check.id);
      renderWizard();
    }
  },
);
renderNavigation();

async function initialize() {
  await loadVerifiedSteps();
  // 選擇是 loadVerifiedSteps 從伺服器帶回來的，所以 chips 要在它之後才套。
  // 擺在前面的話畫面永遠停在預設值，卡片卻照著存下來的選擇跑，兩邊對不上。
  view.setConfigSelection(state.selectedTools, state.selectedLanguage);
  checkEnvironment();
  checkConfigs();
}

initialize();
