// 把 View 的事件、Model 的請求、ViewModel 的判斷接起來。
// 這裡只做接線與狀態保管，判斷邏輯在 viewmodel.js、畫面操作在 view.js。
import * as api from "./api.js";
import * as view from "./view.js";
import {
  CONFIG_LANGUAGES,
  CARD_HINTS,
  CONFIG_TOOL_CHOICES,
  PLAYWRIGHT_SHOT_AGENTS,
  flattenCheckCards,
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
  completedCardIds,
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
  isVerifyAction,
  loaderLabel,
  loaderModifier,
  loginCardModel,
  loginWaitStep,
  rowRunOptions,
  runControlsState,
  runOutcome,
  sectionManualItems,
  sectionStatus,
  systemRowChecked,
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
  // 每跑完一次驗證就 +1，讓截圖的網址跟著變——不然瀏覽器會拿快取裡的舊圖。
  verifyShotVersion: 0,
  selectedTools: ["claude"],
  selectedLanguage: "zh-TW",
  // 正在跑的是哪個 action。徽章與 loader 的字要靠它分「安裝中」與「驗證中」。
  currentRunAction: "",
  // 這次的環境檢查是學生自己按的，還是開頁／裝完自己跑的。只有前者要講話。
  manualRecheck: false,
  // 終端上已經報過的那張卡。renderWizard 跑得很勤，沒有它會一直重複同一句。
  announcedCardId: null,
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

  // 一到這張卡就釘住，之後只有學生按「下一張」才會動。
  //
  // 原本每次 render 都重算 derivedIndex（＝第一張沒完成的卡），於是驗證一過，卡片
  // 自己就跳走了——學生正在看終端印出來的「驗證成功」，眼角瞄到畫面換了一張，不
  // 知道剛才那張到底過了沒，也來不及看那句話寫什麼（VM 實測）。
  //
  // 釘的是「進來時算出來的位置」而不是固定值：重新整理或換段落時仍然會落在第一張
  // 沒做完的卡上，只是到了之後不再自己移動。
  if (requestedIndex === undefined) {
    state.viewingCardIndex[state.activeSectionId] = derivedIndex;
  }
  const card = cardSection.cards[currentIndex];

  // 換卡也要留一句。renderWizard 每次環境檢查、每次勾選都會跑，所以只在真的換了
  // 那張卡的時候講——不然同一句話會洗滿整個終端。
  if (state.announcedCardId !== card.checkId) {
    state.announcedCardId = card.checkId;
    view.addLine(`現在這張：${card.label}`, "agent-status");
  }

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
          : systemRowChecked(check, {
              // 這裡刻意用沒有加眼睛別名的 state.verifiedSteps。
              //
              // effectiveVerifiedSteps() 會把學生勾的 eye-xxx 換算成「xxx 驗過了」，
              // 那是給「這張卡做完了沒」用的。第一格講的是程式那半，不能跟著眼睛動：
              // 學生把眼睛那格取消，第一格「hook 檔案與 3 筆註冊都已生效」也跟著退勾、
              // 2/2 變 0/2，看起來像整張卡被重置（VM 實測 claude-namer）。
              //
              // 檔案在不在跟學生看到什麼是兩件事，取消勾選只是在說「我看到的畫面不對」。
              rowVerified: state.verifiedSteps.has(check.id),
              behaviorVerified: state.behaviorVerifiedSteps.has(check.id),
            }),
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
  // 「這張卡完成了嗎」全站只有一個答案：cardIsComplete。
  //
  // 這裡原本另外收三條路：
  //   1. setup 自己看 completed          —— cardIsComplete 裡面本來就有這條，重複
  //   2. 目前這張卡改看 nextUnlocked      —— 「能往前」不等於「已完成」
  //   3. 其他卡看 attempted && installed —— 驗證失敗也算 attempted
  //
  // 後兩條讓進度條比徽章寬鬆：同一張卡「圓點亮了、徽章還是待驗證」。第 3 條最寬——
  // 它不看驗證有沒有成功、不看最新狀態、也不看人工項有沒有勾（稽核報告第 1~3 項）。
  //
  // 「能往前」這個概念仍然存在，但它只該決定「下一張」按鈕，不該決定「完成」。
  // 那兩件事在這個嚮導裡刻意不同：驗證過不了的學生要能往前走，但那張卡不算做完。
  const completedIds = completedCardIds(
    cardSection.cards,
    verified,
    state.manualCheckedIds,
  );
  const milestones = milestoneModels(
    cardSection.cards,
    completedIds,
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
    verifying: isVerifyAction(state.currentRunAction),
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
    hints: CARD_HINTS[card.checkId] ?? null,
    // 只有 playwright 那兩列會留截圖。帶上驗證次數當 cache buster——重驗一次要看到
    // 新的那張，瀏覽器不會因為網址一樣就拿舊的。
    verifyShot: PLAYWRIGHT_SHOT_AGENTS[card.checkId]
      ? api.urlWithToken(
          `/verify-shot?agent=${PLAYWRIGHT_SHOT_AGENTS[card.checkId]}&v=${state.verifyShotVersion}`,
        )
      : null,
    pasteProof:
      card.checkId === "claude"
        ? {
            value: state.pasteProofValue,
            matched: matchesFullscreenProof(state.pasteProofValue),
            onInput: (value) => cardModel.onPasteProofInput(value),
            onOpen: (testCase) =>
              run("verify-in-terminal", undefined, undefined, {
                case: testCase,
                agent: "claude",
              }),
          }
        : null,
    showRetest: card.kind === "env" || row?.showRetest === true,
    // env 卡按下去是重新掃一次環境，config 卡按下去是真的跑一次驗證——同一顆按鈕
    // 兩件事，字要各講各的。原本一律叫「再 check 一次」，學生不知道它會開終端。
    retestText: card.kind === "env" ? "再 check 一次" : "重跑驗證",
    retestPrimary: card.kind !== "env" && row?.status === "unverified",
    showNext: currentIndex < cardSection.cards.length - 1 && nextUnlocked,
    nextUnlocked,
    onActionClick: (action, button, step, extra) => {
      if (card.kind === "env") run(action, undefined, button);
      else runConfigCheckAction(card.check, action, button, extra);
    },
    onRetest: () => {
      if (card.kind === "env") {
        checkEnvironment(true, { manual: true });
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
    // 終端是「現在正在做什麼」，學生的每一個動作都要在裡面留下一句話。勾一格卻
    // 什麼都沒發生的話，學生不知道那一勾有沒有被記住（重整之後才會發現）。
    onManualToggle: (id, checked) => {
      const item = groups.manual.find((entry) => entry.id === id);
      setManualChecked(id, checked);
      view.addLine(
        `${checked ? "已勾選" : "取消勾選"}：${item?.text ?? id}`,
        checked ? "succeeded" : "",
      );
      renderNavigation();
      renderWizard();
    },
    // 貼對了就自己打勾，貼錯或清空就取消——學生不用再多按一次勾選框。
    onPasteProofInput: (value) => {
      const wasMatched = matchesFullscreenProof(state.pasteProofValue);
      const matched = matchesFullscreenProof(value);
      state.pasteProofValue = value;
      setManualChecked("fullscreen-copy", matched);

      // 只在「對上」那一刻講一次。每打一個字都講的話，貼的過程會洗出一整片。
      if (matched && !wasMatched) {
        view.addLine("貼上的代碼對上了，這一項算過。", "succeeded");
      }

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
      completedIds,
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
      // 學生自己按的那次要講得更明確。開頁時的自動檢查說「正在檢查目前狀態」就夠，
      // 但按鈕按下去看到同一句話（而且是已經在畫面上的那句），等於沒有回饋。
      label: state.manualRecheck ? "正在重新檢查環境狀態。" : null,
    });
  } else if (!state.loaderPaused) {
    view.hideLoaders();
  }
}

// 這一段裡還沒完成的卡，帶著名稱與第幾張——擋人的時候要指名，不能只說「這段沒
// 做完」（學生站在最後一張、畫面顯示已完成，那句話等於叫他自己一張張往回翻）。
function incompleteCards(cards, verified) {
  return cards
    .map((card, index) => ({ card, index }))
    // setup 不再另外判：cardIsComplete 裡面已經有 setup 那條，寫兩次只會有一天
    // 只改到其中一邊。
    .filter(({ card }) => !cardIsComplete(card, verified, state.manualCheckedIds))
    .map(({ card, index }) => ({ label: card.label, index }));
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

      return [section.id, incompleteCards(found.cards, verified).length === 0];
    }),
  );
}

function renderNavigation() {
  const tools = toolSelectionValue(state.selectedTools);
  const done = sectionCompletion();
  const verified = effectiveVerifiedSteps();
  const sections = allCardSections();
  const blockers = Object.fromEntries(
    sections.map(({ sectionId, cards }) => [
      sectionId,
      incompleteCards(cards, verified),
    ]),
  );
  const lockStates = Object.fromEntries(
    SECTIONS.map((section) => [
      section.id,
      sectionGateState(
        section.id,
        state.completedGateIds,
        tools,
        done,
        blockers,
      ),
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
  const shown =
    paused && state.currentLoaderModifier === null
      ? LOADER_MODIFIERS.working
      : state.currentLoaderModifier;
  view.renderLoaders({
    modifier: shown,
    button: state.activeRunButton,
    step: state.activeRunStep,
    paused,
    label: loaderLabel({ action: state.currentRunAction, modifier: shown }),
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

async function checkEnvironment(showLoading = true, { manual = false } = {}) {
  if (state.envCheckInProgress) {
    return null;
  }

  state.manualRecheck = manual;
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

    // 學生自己按的那次要有結尾。重掃通常一秒內回來，只有轉圈圈閃一下的話，
    // 按鈕看起來還是像沒反應——而且多數時候狀態本來就不會變。
    if (manual) {
      view.addLine("環境檢查完成，狀態已更新。", "succeeded");
    }

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
    state.manualRecheck = false;
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

  state.verifyShotVersion += 1;

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
  state.currentRunAction = action;
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
