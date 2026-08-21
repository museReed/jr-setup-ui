// 把 View 的事件、Model 的請求、ViewModel 的判斷接起來。
// 這裡只做接線與狀態保管，判斷邏輯在 viewmodel.js、畫面操作在 view.js。
import * as api from "./api.js";
import * as view from "./view.js";
import {
  initTour,
  onCardRendered,
  replayTour,
  tourDiagnostics,
} from "./tour.js";
import { buildIssue } from "./report.js";
import { openWalkthrough } from "./walkthrough.js";
import {
  CONFIG_LANGUAGES,
  CARD_HINTS,
  EYE_ROW_ACTIONS,
  CONFIG_TOOL_CHOICES,
  PLAYWRIGHT_SHOT_AGENTS,
  flattenCheckCards,
  groupChecks,
  mergeInvalidates,
  pendingMergeSibling,
  matchesFullscreenProof,
  matchesMasterPasscode,
  matchesSectionPasscode,
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
  behaviorRuleLine,
  behaviorTally,
  cardIsComplete,
  completedCardIds,
  cardResultItems,
  cardResultText,
  cardStatusModel,
  checklistGroups,
  checklistRowIds,
  configRowModel,
  configSummary,
  currentCardIndex,
  envButtonState,
  envCardRowModel,
  eyeVerifiedSteps,
  extractLoginHints,
  failureReason,
  guidanceModel,
  impliedVerifiedSteps,
  initialChecksReady,
  installVerificationFollowUp,
  installStatusMessage,
  isLoginAction,
  isVerifyAction,
  loaderLabel,
  loaderModifier,
  loginCardModel,
  loginWaitStep,
  manualStepGroups,
  rowRunOptions,
  runControlsState,
  runOutcome,
  sectionManualItems,
  sectionEndRecheck,
  sectionStatus,
  systemRowChecked,
  milestoneModels,
  prunedSkippedCards,
  skippedListModel,
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
  // 規則檢查進行中又切換選項時，收尾後要用最新選項再跑一輪。
  configCheckQueued: false,
  loginWait: null,
  // 後端只會載入內容指紋仍相同的紀錄；素材重裝或檔案被改過，這裡就不會拿到。
  verifiedSteps: new Set(),
  behaviorVerifiedSteps: new Set(),
  // 驗過之後那一步的檔案被動過。不影響勾，只在卡片上多一句提醒。
  changedSteps: new Set(),
  completedGateIds: new Set(),
  // handleDone 要知道被按的那一列是不是「程式抓得到證據」的那種。
  lastChecks: [],
  availableActions: new Set(["diagnose-naming-block"]),
  envChecks: [],
  // 撞上「還在跑」而被擋下來的那次重查，等當前那次收尾再補跑。null 代表沒有排隊。
  envCheckQueued: null,
  activeSectionId: "env",
  viewingCardIndex: {},
  // 曾經被顯示過的卡片 ID，只增不減。記 ID 不記索引：加選工具會在中間插入新卡，
  // 索引會位移，已完成的卡會被推到高水位之後而重新變灰。
  seenCardIds: new Set(),
  setupCompleted: false,
  // 第一張卡的兩份初始檢查都收完後，只在終端報一次完成。
  initialChecksAnnounced: false,
  installedSteps: new Set(),
  verificationAttempted: new Set(),
  failedVerificationSteps: new Set(),
  failedSteps: new Set(),
  resultTexts: new Map(),
  deferredVerificationSteps: new Set(),
  // 驗證失敗、學生按了「先跳過這張」的卡。只放行「下一張」，不算完成——徽章、圓點、
  // 進度條走的仍然是 cardIsComplete，跳過的卡在那裡照樣是失敗。
  skippedCards: new Set(),
  manualCheckedIds: new Set(),
  // 用當日密碼打開過的段（見 model.js 的 SECTION_PASSCODES）。伺服器記著，重開
  // 嚮導不用再問一次講師。
  unlockedSections: new Set(),
  // 講師用萬用密碼開過的段：那一段的鎖整個跳過，不管前面做完沒。
  overriddenSections: new Set(),
  // 密碼框正在替哪一段問。關掉就清空——沒清的話下一次打對密碼會跳去上一次那段。
  pendingPasscodeSection: null,
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
  // 哪幾段「這一次走到最後一張」已經自動重查過了。沒有它 renderWizard 會跟重查
  // 互相呼叫成無限迴圈；往回翻就清掉，翻回來要算新的一次（見 sectionEndRecheck）。
  autoRecheckedSections: new Set(),
  pendingModalCheck: null,
  // 裝完一張卡之後，還排隊等著驗證的那幾列（只放 id）。合併卡會依序裝兩份，兩份都
  // 要各自驗一次，而驗證是串起來跑的——一次一分多鐘，所以畫面要說現在在驗第幾格，
  // 不然看起來像當掉。空陣列＝沒有串接在跑，這也是「這次驗證是不是自動接的」的判準。
  autoVerifyQueue: [],
  autoVerifyTotal: 0,
  loginHints: { url: null, code: null },
  // 哪幾格有操作步驟可看，以及那一列該寫什麼。開頁問一次——按鈕存在卻按出一個空
  // 彈窗，比沒有按鈕更讓人困惑。
  walkthroughs: new Map(),
};

async function loadWalkthroughIds() {
  try {
    const { items } = await api.fetchWalkthroughIds();
    state.walkthroughs = new Map(items.map((item) => [item.id, item]));
  } catch {
    // 拿不到就當作都沒有：少幾顆按鈕不影響學生做事，是可以退的。
    state.walkthroughs = new Map();
  }
}

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

// 重跑之前先把上一輪的結論忘掉：清單先退回未勾，再照這一次的結果打勾。
//
// 不清的話畫面會停在上一輪的答案上——重驗跑到一半，清單還是全綠；驗證失敗了，
// 那個勾也還在。學生按下重驗就是在說「上次那個結論我不算數了」。
//
// 眼睛那格一起清：重驗會開一個新的視窗，上次看到的是上一個視窗的事。
function forgetVerification(stepId, manualIds = []) {
  state.verifiedSteps.delete(stepId);
  state.behaviorVerifiedSteps.delete(stepId);
  state.failedVerificationSteps.delete(stepId);
  state.verificationAttempted.delete(stepId);
  state.deferredVerificationSteps.delete(stepId);
  // 重驗＝他回來把這張卡做完了，那顆「先跳過」的通行證跟著上一輪的結論一起作廢。
  if (state.skippedCards.delete(stepId)) {
    persistSkippedCards();
  }

  forgetManualChecked([`eye-${stepId}`, ...manualIds]);

  api
    .forgetVerification(stepId)
    .catch((error) => view.addLine(`無法清除舊的驗證結果：${error.message}`, "failed"));
}

// 只退學生手上那幾格的勾，程式那半原封不動。
//
// 眼睛那一格按「開終端驗證」是「這一格從頭看一次」，不是「這一列重驗一次」。原本
// 走的是整列的那一版（拿卡片的 checkId 去清），於是行為驗證 5 條全過、終端印著「驗證
// 通過」，學生接著按開終端看狀態列，那個結論就被一起刪掉——清單上那一格永遠回到
// 「還沒實際跑跑看」（Reed 貼的 log：兩次 verify-behavior 都過，中間夾一次
// verify-in-terminal，之後就沒勾了）。
function forgetManualChecked(ids) {
  for (const id of ids) {
    state.manualCheckedIds.delete(id);
    state.completedGateIds.delete(id);
  }

  api
    .saveManualChecked([...state.manualCheckedIds])
    .catch((error) => view.addLine(`無法保存勾選：${error.message}`, "failed"));
}

// 程式那半過了就記，不管那一列有沒有眼睛勾選框——清單第一格要立刻反映終端剛印的
// 「驗證成功」，不能等學生勾完眼睛才一起變。
// installedSteps 是「這一輪按過安裝」的樂觀記憶，用途只有一個：撐住「終端印了安裝
// 成功」到「下一次檢查回來」之間那幾秒，不然那一列會停在「尚未安裝」。
//
// 但它只該活到結果回來為止。新的結果說 missing 還留著的話，同一格會同時是「打勾」
// 與「未安裝」，旁邊還有一顆安裝鍵，右上角計數照樣寫 3/3——三個地方各講各的
// （Windows VM 實測 git：winget 印 Successfully installed，探測仍抓不到）。
//
// 只清 missing 那幾筆：ok 不用清（權威狀態自己就會打勾），warn 也不清（那是「裝了
// 但有問題」，不是沒裝）。
function forgetStaleInstalls(checks) {
  for (const check of checks) {
    if (check.status === "missing") {
      state.installedSteps.delete(check.id);
    }
  }
}

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
    state.changedSteps = new Set(result.changed ?? []);
    state.manualCheckedIds = new Set(result.manual ?? []);
    state.skippedCards = new Set(result.skipped ?? []);
    state.unlockedSections = new Set(result.unlocked ?? []);
    state.overriddenSections = new Set(result.overridden ?? []);

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
    state.changedSteps = new Set();
    state.manualCheckedIds = new Set();
    state.skippedCards = new Set();
    state.unlockedSections = new Set();
    state.overriddenSections = new Set();
  }
}

// 「先略過這張」按下去／自動移除都走這裡，記憶體與伺服器一起改。
//
// 存不進去只講一句話、不回滾：學生現在就在等這張卡放行，為了一次寫入失敗把他關
// 回去沒有意義——最壞的情況是重整之後要再按一次。
function persistSkippedCards() {
  api
    .saveSkippedCards([...state.skippedCards])
    .catch((error) =>
      view.addLine(`無法保存跳過清單：${error.message}`, "failed"),
    );
}

function effectiveVerifiedSteps() {
  const verified = new Set(state.verifiedSteps);

  // 有眼睛項的列：兩半都要成立才算整列過了。只勾眼睛的話，卡片會說已完成、清單
  // 卻還停在 1 / 2。
  for (const id of eyeVerifiedSteps(
    state.lastChecks,
    state.manualCheckedIds,
    state.behaviorVerifiedSteps,
  )) {
    verified.add(id);
  }

  // 沒有眼睛項的列，程式驗過了就是整列過了——不必等第二本帳也寫成功。
  for (const id of impliedVerifiedSteps(
    state.lastChecks,
    state.behaviorVerifiedSteps,
  )) {
    verified.add(id);
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

// 一張卡有兩格要驗時，畫面上要看得出「現在在驗第幾格」。兩格串起來要跑兩分多鐘，
// 沒有這句話學生會以為當掉了（handoff 8/12 指定）。只有一格就不報——那句「1/1」
// 只會讓人以為還有下一格。
function announceVerifyStep(check) {
  if (state.autoVerifyTotal < 2) {
    return;
  }

  const index = state.autoVerifyTotal - state.autoVerifyQueue.length;

  view.addLine(
    `驗證 ${index}/${state.autoVerifyTotal}：${check.label}`,
    "agent-status",
  );
}

// 排隊中的下一格。開終端那種照樣先跳確認框——那顆按下去會真的開一個視窗，不先講
// 一聲的話學生會被第二個突然冒出來的終端嚇到。
function runNextAutoVerify() {
  while (state.autoVerifyQueue.length > 0) {
    const id = state.autoVerifyQueue.shift();
    const next = state.lastChecks.find((check) => check.id === id);

    // 這一輪重查之後那一列可能已經綠了（例如學生自己先驗過），跳過不重跑。
    if (
      next === undefined ||
      next.verifyAction == null ||
      next.needsMerge === true ||
      state.verificationAttempted.has(id)
    ) {
      continue;
    }

    announceVerifyStep(next);

    if (next.verifyKind === "terminal") {
      state.pendingModalCheck = next;
      view.showVerifyModal();
      renderWizard();
      return;
    }

    runConfigCheckAction(next, next.verifyAction, null, next.verifyOptions);
    return;
  }

  state.autoVerifyTotal = 0;
}

function stopAutoVerifyChain() {
  state.autoVerifyQueue = [];
  state.autoVerifyTotal = 0;
}

// 修好了就自己從跳過清單裡消失。每次重畫都算一次，因為「修好了」可能發生在任何
// 地方：驗證跑完、環境重掃、人工項勾完——挨個去記得清除的話，總有一條路會漏掉。
function pruneSkippedCards() {
  if (state.skippedCards.size === 0) {
    return;
  }

  // ⚠️ 檢查結果還沒回來的時候什麼都不要動。
  //
  // 開頁有一段空窗：跳過清單已經從 /state 讀回來了，環境與規則的檢查還在跑，於是
  // allCardSections() 只生得出第一張 setup 卡。這時候跑下面那條「卡片不見了就清掉」，
  // 會把整份清單當成死項目刪光，還順手寫回伺服器——學生重整一次，跳過的紀錄全沒了
  // （實測：重整後清單歸零，state.json 的 skipped 變成空陣列）。
  if (state.lastChecks.length === 0 || state.envChecks.length === 0) {
    return;
  }

  const verified = effectiveVerifiedSteps();
  const cards = allCardSections().flatMap((section) => section.cards);
  const remaining = prunedSkippedCards(
    cards,
    state.skippedCards,
    verified,
    state.manualCheckedIds,
  );

  if (remaining.size === state.skippedCards.size) {
    return;
  }

  for (const id of state.skippedCards) {
    if (remaining.has(id)) continue;
    const card = cards.find((candidate) => candidate.checkId === id);
    // 只在卡片還在時報喜。整批消失的那種（換工具選項）不是「修好了」，講出來會
    // 讓學生以為自己剛完成了一張根本看不到的卡。
    if (card !== undefined) {
      view.addLine(`「${card.label}」已經過了，從跳過清單移除。`, "succeeded");
    }
  }

  state.skippedCards = remaining;
  persistSkippedCards();
}

function renderWizard() {
  pruneSkippedCards();
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
  // 「這一頁卡住了」要講得出是哪一頁。那顆按鈕在頁首、不在卡片上，拿不到這裡的
  // 區域變數，所以每次畫的時候記下來。
  state.reportCard = card;

  // 走到這裡（含）為止的卡都算「顯示過」。里程碑要亮，除了完成還得走到過——
  // 這一行同時做兩件事：進來時把落點以前的卡一次補齊（重整後畫面跟原本一樣），
  // 之後按「下一張」再逐張累加。只增不減，所以往回看或加選工具都不會讓點變灰。
  for (const passed of cardSection.cards.slice(0, currentIndex + 1)) {
    state.seenCardIds.add(passed.checkId);
  }

  // 換卡也要留一句。renderWizard 每次環境檢查、每次勾選都會跑，所以只在真的換了
  // 那張卡的時候講——不然同一句話會洗滿整個終端。
  if (state.announcedCardId !== card.checkId) {
    state.announcedCardId = card.checkId;
    // 每張卡各有一份終端內容：切過去先換成它自己那份，翻回來時原樣還在。
    view.showTranscript(card.checkId);
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
          ? // 學生按下重掃的那段時間先退回未勾——結果還沒回來，畫面不該還掛著
            // 上一次的答案。掃完（通常一秒內）會照新結果重新打勾。
            check.status === "ok" && !state.manualRecheck
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
    // 驗過之後被動過的那幾步：勾留著，多一句提醒。
    changedCheckIds: state.changedSteps,
    // 「安裝」那一格要在按完安裝的當下就打勾，不等下一次伺服器檢查回來。
    installedCheckIds: state.installedSteps,
  });
  // 「這張卡裝好了嗎」只問裝得起來的那幾列。沒有安裝這回事的列（舊捷徑那張整張都是、
  // 執行原則與 PowerShell 探針也是）留在裡面的話，它一紅整張卡的徽章就寫「未安裝」
  // ——但那張卡上根本沒有任何東西可以安裝，學生看了只會問「安裝什麼」（VM 實測）。
  const installChecks = cardChecks.filter(
    (check) =>
      !check.id.endsWith("-auth") &&
      check.hasInstaller !== false &&
      // 等合併的那一份不算「還沒裝」：檔案就在，安裝鍵按下去也刻意不覆蓋。
      check.needsMerge !== true,
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
  // 「該驗的」是這張卡上的每一列，不是主 check 那一列。合併的卡有兩個驗證
  // （「一次只跑一個指令」與「常用指令不用每次問你」），原本只看 card.checkId，
  // 於是驗完其中一個就解鎖下一張，另一個從沒跑過也走得掉（VM 實測截圖）。
  const verifyRequiredChecks = cardChecks.filter(
    (check) => check.verifyAction != null || check.eyeCheck != null,
  );
  const verificationRequired = verifyRequiredChecks.length > 0;
  // 「跑過」不夠，要「沒失敗」。原本失敗也算放行——於是徽章寫著「失敗」、兩列都寫
  // 「自動驗證沒有通過」，箭頭卻是亮的，看起來像做完了（Reed 截圖）。
  //
  // 但不能只認 verified：開終端那種驗證程式判不了，跑完不會留下 verified，只留下
  // 一筆 attempted。所以條件是「試過而且沒被記成失敗」。
  const verificationAttempted =
    !verificationRequired ||
    verifyRequiredChecks.every(
      (check) =>
        verified.has(check.id) ||
        (state.verificationAttempted.has(check.id) &&
          !state.failedVerificationSteps.has(check.id)),
    );
  // 略過是常駐的（見 skipAvailable），所以每一種卡都要認它，不只規則卡。原本只有
  // config 那條 OR 吃 skippedCards——環境卡按了略過，箭頭照樣是暗的，按鈕變成一顆
  // 按了沒反應的東西。
  const cardSkipped = state.skippedCards.has(card.checkId);
  const nextUnlocked =
    card.kind === "setup"
      ? true
      : cardSkipped ||
        (card.kind === "env"
          ? cardIsComplete(card, verified, state.manualCheckedIds) &&
            groups.manual.every((item) => item.checked)
          : nextCardUnlocked({
              installed,
              verificationRequired,
              verificationAttempted,
              manualItems: groups.manual,
            }));
  // 略過鍵常駐，不再只在「驗證失敗而且被鎖住」時才出現。
  //
  // 原本那個條件（config 卡 + 驗證失敗）看起來很嚴謹，實際上把最需要它的人擋在
  // 外面：卡在環境段裝不起來 gh、卡在一個按下去沒反應的安裝鍵、卡在人工項看不懂
  // 該勾什麼——這些都不是「驗證失敗」，於是畫面上連一條出路都沒有。
  //
  // 只有第一張 setup 卡不給：那張選的是工具與語言，跳過它後面每一張卡都不知道要
  // 長什麼樣，等於跳過整個嚮導。
  const skipAvailable = card.kind !== "setup";
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
    state.seenCardIds,
    state.skippedCards,
  );
  // 合併的卡有兩份設定。按鈕要對著「還沒好的那一份」——兩份都好了才回到主 check，
  // 因為驗證掛在它身上。
  const rowCheck =
    cardChecks.find((candidate) => candidate.status !== "ok") ?? card.check;
  // 驗證按鈕只能有一個家，而那個家是**它負責的那一格**（Reed 指定）。
  //
  // 原本只有「一張卡兩個以上驗證」才回到各自那一格，一個驗證的卡把按鈕留在卡片
  // 底部。但那顆離它驗的那一格隔著一整段——清單裡寫著「驗證：輸入框下面那條狀態
  // 列」，按鈕卻在下面某處，學生要自己把兩者配起來（Reed 在 VM 上指出，跟當初把
  // 安裝鍵搬進清單是同一個理由）。
  //
  // 兩邊都畫的話還會說謊：底下那顆跑的永遠是 card.check——合併卡上它看起來像
  //「全部重跑」，實際只重跑第一個驗證（VM 實測）。一顆按鈕說謊比少一顆按鈕更糟。
  const verifyChecks = cardChecks.filter((check) => check.verifyAction != null);
  const perRowVerify = verifyChecks.length > 0;
  // 這張卡上還有檔案在等 AI 合併。驗證要等合併做完——驗一份還沒併進去的設定，拿到的
  // 結果跟列上那句「需要合併」互相矛盾，學生只能挑一句相信（VM 實測 codex-config：
  // 沒按「用 AI 合併」就跑了規矩與回話風格的測試）。
  const mergePending = cardChecks.some((check) => check.needsMerge === true);
  let row =
    card.kind === "env"
      ? envCardRowModel(card, state.installedSteps)
      : card.kind === "config"
        ? configRowModel(rowCheck, verified.has(card.checkId), {
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
      // 每一格「驗證：…」都要有自己那顆按鈕。
      //
      // 底下那顆「重跑驗證」跑的永遠是 card.check（見 onRetest）。合併卡有兩個驗證
      // 之後，第二格就完全沒有入口了——VM 實測：白名單那格寫著「按『重跑驗證』」，
      // 按下去開的卻是隔壁那題的終端（原始輸出寫著「正在跑『Shell 不串接』驗證」）。
      // 文案還把學生指向那顆錯的按鈕。
      //
      // 帶 checkId 的按鈕會被 view 畫進 `system-<id>` 那一格（清單裡的「驗證：…」
      // 就是那個 id），跟安裝鍵當初搬進清單是同一條規矩：按鈕要待在它負責的那一格。
      //
      // 驗過的那一格按鈕不收掉，改寫成「重跑驗證」：驗證會失敗、環境會變，學生要能
      // 在原地再驗一次。收掉的話那一格就再也沒有入口了（底下那顆已經不畫了）。
      buttons: [
        ...(row.buttons ?? []),
        // 眼睛那一格的按鈕落在它自己那一列（rowId），不是卡片底下的按鈕列。
        ...(EYE_ROW_ACTIONS[card.checkId] !== undefined &&
        cardChecks.some((check) => check.eyeCheck != null)
          ? [
              {
                action: EYE_ROW_ACTIONS[card.checkId].action,
                dataName: "verifyAction",
                // ⚠️ 按鈕上寫的是它自己做的事，不是「你該先做什麼」（Reed 在畫面前
                // 指定）。擋住的理由已經寫在卡片右上角的「等你合併」，按鈕再講一次
                // 只是把同一句話塞進一個按不動的地方。
                text: EYE_ROW_ACTIONS[card.checkId].text,
                rowId: `eye-${card.checkId}`,
                step: `eye-${card.checkId}`,
                options: EYE_ROW_ACTIONS[card.checkId].options ?? undefined,
                disabled: mergePending,
              },
            ]
          : []),
        // 每一格「安裝：…」也各自一顆按鈕，按下去**只裝那一格**（Reed 指定）。
        //
        // 原本整張卡只有一顆：按下去裝第一份，程式再自己接著裝第二份。畫面上的樣子是
        // 「第一格旁邊那顆按鈕，把兩件事都做了」，而第二格從頭到尾沒有自己的入口——
        // 學生沒辦法只重跑其中一件（Reed 在畫面前指出）。
        //
        // rowCheck 那一格不在這裡：它的按鈕由 configRowModel 給，那邊還要判斷「重裝／
        // 裝好了整顆收掉／等著合併不給」。這裡補的是同一張卡上的其他格，判斷跟著抄。
        //
        // ⚠️ 只有規則卡（config）要補。環境卡的 envCardRowModel **本來就已經**每一列
        // 各給一顆安裝鍵了，這裡再補一次的話那一列會長出兩顆一模一樣的「安裝」
        //（Reed 在 GitHub CLI 那一列看到，2026-08-14）。
        //
        // 這個 bug 之所以看得見，是因為同一天稍早把 view 的 inlineActions 從「一格
        // 一顆」改成陣列——在那之前，第二顆會安靜地把第一顆換掉，畫面上看不出來。
        ...(card.kind === "config" ? cardChecks : [])
          .filter(
            (check) =>
              check.id !== rowCheck.id &&
              check.installAction != null &&
              check.needsMerge !== true,
          )
          .map((check) => {
            const done =
              check.status === "ok" ||
              state.installedSteps.has(check.id) ||
              verified.has(check.id);

            return {
              action: check.installAction,
              dataName: "installAction",
              text: done ? "重裝" : "安裝",
              secondary: done,
              step: check.id,
              rowId: checklistRowIds(check).install,
            };
          }),
        // 等著合併的每一格也各自一顆「用 AI 合併」。
        //
        // ⚠️ 這一顆跟安裝／驗證不同：按哪一格都是**兩份一次合完**（step 折回群組
        // 主人）。看起來違反「一顆按鈕只做它那一格的事」，但合併本來就只能一次做完
        // ——兩個檔案要一起讀、一起判斷衝突。不給第二格按鈕的話那一格就是死的：
        // 它寫著「已有你自己的版本，需要合併」，旁邊什麼都沒有（Reed 在 Codex 那張
        // 卡上指出）。
        ...(card.kind === "config" ? cardChecks : [])
          .filter(
            (check) => check.id !== rowCheck.id && check.mergeAction != null,
          )
          .map((check) => ({
            action: check.mergeAction,
            dataName: "mergeAction",
            text: "用 AI 合併（會開終端）",
            step: check.mergeStep ?? check.id,
            rowId: checklistRowIds(check).install,
          })),
        // ⚠️ noInstall 那種列（demo、寫一篇筆記）跳過：configRowModel 已經給了它
        // 自己那顆，而且文案不一樣——那顆是「開終端跑」（跑給你看），不是驗證。
        // 兩顆的 rowId 一樣，view 的 inlineActions 是 Map，後放的會把它蓋掉。
        ...(perRowVerify
          ? verifyChecks.filter((check) => check.noInstall !== true)
          : []
        ).map((check) => ({
          action: check.verifyAction,
          dataName: "verifyAction",
          text: verified.has(check.id) ? "重跑驗證" : "驗證",
          checkId: check.id,
          step: check.id,
          disabled: mergePending,
          // 欄位名是 options 不是 extra——actionButton 傳給 onActionClick 的第四個
          // 參數讀的是 spec.options（view.js 的 actionButton）。
          options: check.verifyOptions,
        })),
      ],
    };
  }
  const activeCheckId =
    state.activeRunStep ??
    LOGIN_CHECK_IDS[state.currentEnvAction] ??
    (state.currentEnvAction?.startsWith("install-")
      ? state.currentEnvAction.slice("install-".length)
      : null);
  const cardDone = cardIsComplete(card, verified, state.manualCheckedIds);
  const status = cardStatusModel({
    completed: cardDone,
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
    // 「等你合併」自己一個狀態。它不是「未安裝」的一種——檔案就在，只是有學生自己
    // 的內容不能直接蓋。
    awaitingMerge: cardChecks.some((check) => check.needsMerge === true),
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
    // 人工項目照步驟分組，每一步配一顆把視窗開起來的按鈕。
    manualSteps: manualStepGroups(groups.manual),
    // 開一個新視窗＝那一步從頭做一次，所以那一步的勾先退掉。學生按第一步的按鈕，
    // 講的是「我要再做一次這兩件事」，不是「我做完了」。
    onOpenStep: (action) => {
      const step = manualStepGroups(groups.manual).find(
        (entry) => entry.action === action,
      );
      const ids = (step?.items ?? []).map((item) => item.id);

      if (ids.length > 0) {
        // 一樣只退這一步的勾。開一個新視窗重做那兩件事，跟這一列程式那半驗過沒
        // 驗過是兩回事。
        forgetManualChecked(ids);

        if (ids.includes("fullscreen-copy")) {
          state.pasteProofValue = "";
        }

        view.addLine(`先清掉這一步的勾，重新做一次：${step.title}`, "agent-status");
      }

      run("verify-in-terminal", undefined, undefined, {
        case: action,
        agent: "claude",
      });
    },
    showChecklist: card.kind !== "setup",
    // 「怎麼做」那顆：只有真的編過內容的那幾格才畫得出來。順便帶著那一列的
    // 標題與說明——它們也住在 content/ 裡。
    walkthroughs: state.walkthroughs,
    // origin 是那顆問號的中心點：彈窗要從它長出來。
    onWalkthrough: (id, origin) => {
      openWalkthrough(id, origin).catch((error) =>
        view.addLine(`打不開操作步驟：${error.message}`, "failed"),
      );
    },
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
          }
        : null,
    // 規則卡不再畫底下那顆——驗證鍵已經回到它負責的那一格了（見 perRowVerify）。
    // 環境卡的「再 check 一次」是另一回事：它重掃的是整張卡，本來就不屬於任何一格。
    //
    // ⚠️ 清單沒畫出來的話 inline 按鈕會**安靜地消失**（view.js 的 inlineActions
    // 是 Map，查不到就什麼都不畫），那時底下這顆是唯一的入口，要留著。
    showRetest:
      card.kind === "env" ||
      (row?.showRetest === true && !(perRowVerify && card.kind !== "setup")),
    // env 卡按下去是重新掃一次環境，config 卡按下去是真的跑一次驗證——同一顆按鈕
    // 兩件事，字要各講各的。原本一律叫「再 check 一次」，學生不知道它會開終端。
    //
    // 沒驗過的時候叫「驗證」，驗過了才改叫「重跑驗證」：第一次就寫「重跑」，學生會
    // 以為自己漏掉了前面某一步。跟格內那顆同一套判斷（見上面 verified.has）。
    retestText:
      card.kind === "env"
        ? "再 check 一次"
        : verified.has(card.checkId)
          ? "重跑驗證"
          : "驗證",
    // 這張卡還沒完成，「重跑驗證」就是現在該按的那顆——不繞過「待驗證」那個中間
    // 狀態去判斷。原本看的是那一列的狀態，於是驗證失敗、正在跑、或列的狀態是別的
    // 值時，按鈕就退回空心，學生看不出該按哪顆（VM 實測 tab-sync 那張）。
    retestPrimary: card.kind !== "env" && !cardDone,
    nextUnlocked,
    onActionClick: (action, button, step, extra) => {
      if (card.kind === "env") {
        run(action, undefined, button);
        return;
      }

      // 眼睛那一格的按鈕不是驗證，是「幫你把終端開起來看一眼」。走下面那條驗證
      // 分支的話，會把這張卡程式那半的結論一起清掉——那半跟這一格無關。
      //
      // 開一個新視窗＝這一格從頭看一次，所以先把它的勾退掉（跟 onOpenStep 同一套）。
      if (typeof step === "string" && step.startsWith("eye-")) {
        // resets 的那幾格＝「按下去這一格從頭看一次」，所以勾先退掉。開瀏覽器
        // 去看遠端不算重看——那一格勾過了還把它退掉，學生會以為自己剛才白勾了。
        if (EYE_ROW_ACTIONS[card.checkId]?.resets === true) {
          // 只退這一格的勾。這一列程式那半的結論（行為驗證）跟這一格無關，
          // 拿 forgetVerification 去清會把剛剛驗過的 5 條一起洗掉。
          forgetManualChecked([step]);
          view.addLine("先清掉這一格的勾，開一個新的視窗給你看。", "agent-status");
          renderWizard();
          run(action, undefined, null, extra);
          return;
        }

        run(action, undefined, button, extra);
        return;
      }

      // 安裝按鈕對著還沒好的那一份（rowCheck）。驗證按鈕對著它自己那一格——合併卡
      // 有兩個驗證，全部丟給 rowCheck 的話第二格會拿隔壁那格的參數去跑。
      const target =
        cardChecks.find((candidate) => candidate.id === step) ?? rowCheck;

      if (isVerifyAction(action)) {
        // 格內的「重跑驗證」跟底下那顆（onRetest）要做同一件事：先把上一輪的結論
        // 忘掉，清單退回未勾，再照這一次的結果打勾。
        //
        // 不清的話畫面會停在上一輪的答案上——重驗跑到一半，那一格還是綠的；這次
        // 失敗了，那個勾也還在。學生按下重驗就是在說「上次那個結論我不算數了」。
        // 底下那顆本來就這樣做，格內這顆漏了（VM 實測）。
        const rerun = verified.has(target.id);

        if (rerun) {
          forgetVerification(target.id);
          view.addLine(
            `先清掉「${target.label}」上一輪的結果，重新驗證。`,
            "agent-status",
          );
          renderWizard();
        }

        // 重畫過的話手上這顆 button 已經是被換掉的舊 DOM node，轉圈會轉在一顆不在
        // 畫面上的按鈕身上。onRetest 傳 null 也是同一個理由。
        runConfigCheckAction(target, action, rerun ? null : button, extra);
        return;
      }

      runConfigCheckAction(rowCheck, action, button, extra);
    },
    onRetest: () => {
      if (card.kind === "env") {
        checkEnvironment(true, { manual: true });
        return;
      }

      // 先退回未勾，再照這一次的結果打勾。
      forgetVerification(card.check.id);
      view.addLine("先清掉上一輪的結果，重新驗證。", "agent-status");
      renderWizard();
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
        view.setButtonLabel(button, "已複製");
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
      // renderWizard 自己會重算鎖狀態，不用在這裡先叫一次。
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

      renderWizard();
    },
    onNext: () => {
      if (card.kind === "setup") state.setupCompleted = true;
      state.viewingCardIndex[state.activeSectionId] = currentIndex + 1;
      renderWizard();
    },
    // 卡片標題列上那顆常駐的「先略過這張」。它不是「下一張」的替身——按了之後這張
    // 卡照樣是沒完成的，只是不再擋路，而且會被記進底下那條跳過清單。
    //
    // 再按一次就是取消：學生自己回來看了一眼發現沒問題，總得有辦法把它撤掉，而不用
    // 去跑一次驗證。
    skip: {
      // 已經做完的卡不給——按下去只會被 pruneSkippedCards 立刻移除，變成一顆
      // 「按了什麼都沒發生」的按鈕（環境段有幾張 optional 的卡天生就是完成狀態）。
      show: skipAvailable && !cardDone,
      skipped: cardSkipped,
      onToggle: () => {
        if (cardSkipped) {
          state.skippedCards.delete(card.checkId);
          persistSkippedCards();
          view.addLine(`把「${card.label}」從跳過清單移除。`, "agent-status");
          renderWizard();
          return;
        }

        state.skippedCards.add(card.checkId);
        persistSkippedCards();
        view.addLine(
          `先略過「${card.label}」，之後可以從底下的清單回來。`,
          "agent-status",
        );
        // 按下去就往下走：卡住的人要的是繼續，不是站在原地看它變灰。最後一張就
        // 換段——留在原地的話「略過」看起來像沒有作用。
        advancePastCard(cardSection, currentIndex);
      },
    },
  };
  view.renderWizard({
    section,
    sectionStatus: sectionStatus(
      cardSection.cards,
      completedIds,
      state.seenCardIds,
    ),
    milestones,
    cardModel,
    onMilestoneSelect: (index) => {
      if (!milestones[index].unlocked) return;
      state.viewingCardIndex[state.activeSectionId] = index;
      renderWizard();
    },
  });
  renderSkippedTray();
  renderControls();
  // 分頁的鎖跟著一起更新。原本只有勾選、換工具、點分頁才會重算，於是「最後一張
  // 卡驗過了」的當下沒有人去看鎖狀態——下一段其實已經開了，畫面上還鎖著，等學生
  // 去點才發現。開鎖動畫也因此永遠錯過那一刻（VM 實測）。
  const lockStates = renderNavigation();
  renderWizardNav({
    cardSection,
    currentIndex,
    nextUnlocked,
    lockStates,
    onNext: cardModel.onNext,
  });
  // 導覽排在最後：翻頁按鈕這時候才決定要不要露臉，太早問會指到一顆還 hidden 的
  // 按鈕，泡泡就貼到畫面左上角去了。
  onCardRendered({ runInProgress: state.runInProgress });
  maybeRecheckAtSectionEnd(section.id, currentIndex, cardSection.cards.length);
}

// A7：翻到一段的最後一張就自己重查一次，讓段落閘門看到的是現在的狀態而不是快照。
// 該不該查的判準在 viewmodel 的 sectionEndRecheck，這裡只負責記憶與副作用。
function maybeRecheckAtSectionEnd(sectionId, currentIndex, cardCount) {
  // 離開最後一張就把記憶清掉。往回翻再翻回來是新的一次——中間他多半又做了什麼，
  // 拿上一輪的結論擋著等於白翻。
  if (currentIndex !== cardCount - 1) {
    state.autoRecheckedSections.delete(sectionId);
    return;
  }

  const target = sectionEndRecheck({
    sectionId,
    currentIndex,
    cardCount,
    alreadyDone: state.autoRecheckedSections.has(sectionId),
    // 這一段已經完成就不查——沒有東西需要被解鎖，查了只是花 8 秒證明一件已經
    // 成立的事（VM 實測：卡片上寫著「這一段已完成。」，它還是重查了）。
    sectionDone: sectionCompletion()[sectionId] === true,
    // 有東西在跑就先不查：安裝／驗證跑到一半的狀態本來就不是結論，
    // 而且那一支跑完自己會觸發重查。
    busy:
      state.runInProgress ||
      state.envCheckInProgress ||
      state.configCheckInProgress,
  });

  if (target === null) {
    return;
  }

  state.autoRecheckedSections.add(sectionId);
  // 不開 loading 遮罩：學生正在看最後一張卡，把它蓋掉只會像畫面壞了。
  // 這一句留在終端上，是為了讓「卡片突然自己變綠」講得出原因。
  view.addLine("走到這一段的最後一張，順手重新確認一次狀態。", "agent-status");
  void (target === "env" ? checkEnvironment(false) : checkConfigs());
}

// 兩顆翻頁按鈕：位置固定在畫面兩側，內容跟著現在這張卡變。
// 走到一段的最後一張時，「下一張」換成「下一段：⋯」——那一段做完了，下一步是換段，
// 不是回頭去點上面的分頁。點下去落在新那段的第一張。
function renderWizardNav({
  cardSection,
  currentIndex,
  nextUnlocked,
  lockStates,
  onNext,
}) {
  const cards = cardSection.cards;
  const sectionIndex = SECTIONS.findIndex(
    (section) => section.id === state.activeSectionId,
  );
  const previousSection = SECTIONS[sectionIndex - 1];
  const nextSection = SECTIONS[sectionIndex + 1];
  const atLast = currentIndex >= cards.length - 1;
  const nextGate =
    nextSection === undefined ? undefined : lockStates[nextSection.id];
  const nextSectionOpen = nextSection !== undefined && nextGate?.locked !== true;
  // 下一段只差當日密碼時，按鈕照樣要出現——藏起來的話學生做完這一段就沒有任何
  // 可按的東西，看起來像嚮導走完了，而他其實還差最後一段（那顆按鈕會彈密碼框）。
  const nextNeedsPasscode = nextGate?.needsPasscode === true;

  view.renderWizardNav({
    prev: {
      show: currentIndex > 0 || previousSection !== undefined,
      label: currentIndex > 0 ? "上一張" : `上一段：${previousSection?.title ?? ""}`,
      onClick: () => {
        if (currentIndex > 0) {
          state.viewingCardIndex[state.activeSectionId] = currentIndex - 1;
          renderWizard();
          return;
        }

        goToSection(previousSection.id, "last");
      },
    },
    // 逃生口不再借用這顆按鈕。它以前在驗證失敗時會變成「先跳過這張」——那顆只在
    // 「config 卡 + 驗證失敗 + 被鎖住」三個條件同時成立時才出現，而學生卡住的樣子
    // 遠不只那一種。現在略過鍵常駐在卡片標題列上（見 skipAvailable），這裡回到單純
    // 的「能不能往前」，不再一顆按鈕講兩件事。
    next: atLast
      ? {
          show: nextSectionOpen || nextNeedsPasscode,
          label: `下一段：${nextSection?.title ?? ""}`,
          onClick: () => {
            if (nextNeedsPasscode) {
              askPasscode(nextSection.id, nextGate);
              return;
            }

            goToSection(nextSection.id, "first");
          },
        }
      : { show: nextUnlocked, label: "下一張", onClick: onNext },
  });
}

// 底部那條「已跳過 N 張」。跨段落列，因為卡住的那幾張不會剛好都在同一段——只列
// 當前這一段的話，翻到下一段清單就空了，看起來像紀錄不見了。
function renderSkippedTray() {
  view.renderSkippedTray({
    items: skippedListModel(allCardSections(), state.skippedCards),
    onSelect: (entry) => {
      // 直接落在那張卡上。段落的鎖不擋這一條路：那是他自己按過略過的卡，已經看過
      // 一次了，回頭修的時候再要求他「先把前面做完」等於把出口也鎖上。
      state.activeSectionId = entry.sectionId;
      state.viewingCardIndex[entry.sectionId] = entry.index;
      view.hideSectionLockMessage();
      view.addLine(`回到「${entry.label}」。`, "agent-status");
      renderWizard();
    },
  });
}

// 略過之後往哪走：同一段還有下一張就翻頁，已經是最後一張就換段。下一段還鎖著
// （前面另有沒做完的卡）就留在原地重畫——那張卡這時已經變成「已跳過」的樣子，
// 學生看得出按鈕生效了。
function advancePastCard(cardSection, currentIndex) {
  if (currentIndex < cardSection.cards.length - 1) {
    state.viewingCardIndex[state.activeSectionId] = currentIndex + 1;
    renderWizard();
    return;
  }

  const sectionIndex = SECTIONS.findIndex(
    (section) => section.id === state.activeSectionId,
  );
  const nextSection = SECTIONS[sectionIndex + 1];

  if (nextSection === undefined) {
    renderWizard();
    return;
  }

  // 鎖狀態要用剛剛加進 skippedCards 之後的結果算，所以在這裡重新問一次。
  const lockStates = renderNavigation();

  if (lockStates[nextSection.id]?.locked === true) {
    renderWizard();
    return;
  }

  goToSection(nextSection.id, "first");
}

function goToSection(sectionId, landing) {
  state.activeSectionId = sectionId;
  view.hideSectionLockMessage();

  if (landing === "first") {
    state.viewingCardIndex[sectionId] = 0;
  } else {
    const found = allCardSections().find(
      (section) => section.sectionId === sectionId,
    );
    state.viewingCardIndex[sectionId] = Math.max(
      (found?.cards.length ?? 1) - 1,
      0,
    );
  }

  renderWizard();
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

// 「還擋著人的卡」＝沒完成、而且學生也沒按過略過。
//
// 跟 incompleteCards 分成兩支，是因為它們回答兩個不同的問題，而合成一支就得二選一：
//
//   incompleteCards  這一段真的做完了嗎 —— 進度、綠色打勾、「這一段已完成。」
//   blockingCards    還可以往下走嗎     —— 段落的鎖、擋人時要點名哪幾張
//
// 略過的卡在前者裡照樣是沒做完（不假裝），在後者裡放行（不把人關死）。這正是
// milestoneModels 裡 done / passable 那一組的段落版本。
function blockingCards(cards, verified) {
  return incompleteCards(cards, verified).filter(
    ({ index }) => !state.skippedCards.has(cards[index].checkId),
  );
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
      blockingCards(cards, verified),
    ]),
  );
  // 鎖看的是「還擋著人的卡」，綠色打勾看的仍然是「真的做完了」。同一個 done 餵給
  // 兩邊的話，略過一張就會讓那一段打上完成的勾——畫面說做完了，而學生手上還有一張
  // 卡是灰的。
  const passable = Object.fromEntries(
    Object.entries(blockers).map(([sectionId, cards]) => [
      sectionId,
      done[sectionId] === undefined ? undefined : cards.length === 0,
    ]),
  );
  const lockStates = Object.fromEntries(
    SECTIONS.map((section) => [
      section.id,
      sectionGateState(
        section.id,
        state.completedGateIds,
        tools,
        passable,
        blockers,
        state.unlockedSections,
        state.overriddenSections,
      ),
    ]),
  );
  view.renderSectionLocks(lockStates, done);
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
  // 控制列先畫：取消鈕要露臉之後，卡片那邊的導覽才指得到它。反過來的話，導覽問
  // 「取消鈕在不在」時它還 hidden，那一步會被當成指不到而跳過——取消鈕就永遠
  // 沒人講（它只有正在跑的時候才出現，沒有第二次機會）。
  renderControls();
  renderWizard();
  renderEnvActionButtons();
}

function resetRun({ keepLoader = false } = {}) {
  // 跑完就鬆開：接下來的輸出（環境重掃、勾選）屬於學生現在看的那張卡。
  view.unpinTranscript();
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

function finishInitialChecks() {
  if (
    !initialChecksReady({
      envCheckInProgress: state.envCheckInProgress,
      configCheckInProgress: state.configCheckInProgress,
      envCheckQueued: state.envCheckQueued,
      configCheckQueued: state.configCheckQueued,
      envChecks: state.envChecks,
      configChecks: state.lastChecks,
    })
  ) {
    return;
  }

  const cardChanged = !state.setupCompleted;
  state.setupCompleted = true;

  if (cardChanged) {
    renderWizard();
  }

  if (!state.initialChecksAnnounced) {
    state.initialChecksAnnounced = true;
    view.addLine("環境與規則檢查完成，狀態已更新。", "succeeded");
  }
}

function restartInitialChecks() {
  state.setupCompleted = false;
  state.initialChecksAnnounced = false;
  renderWizard();
  view.addLine(
    "選項已變更，正在重新檢查目前環境與規則。",
    "agent-status",
  );
}

async function checkEnvironment(showLoading = true, { manual = false } = {}) {
  if (state.envCheckInProgress) {
    // 這一次不能直接丟掉。安裝完成後的重查若撞上還在跑的那次，畫面就永遠停在
    // 安裝前的快照——卡片寫「未安裝」、清單不打勾，而且不會自己好（Windows VM
    // 實測：gh 裝好了、新終端叫得到、runEnvCheck 也回 ok，畫面就是不動）。
    //
    // 也不能改成共用那次的結果：它是安裝開始前就出發的，答案本來就過期。
    // 所以排隊，等當前那次收尾再補跑一次。
    //
    // 撞上的機會不小：runEnvCheck 在 Windows 實測要 8.3 秒（十三項併行 spawn）。
    state.envCheckQueued = {
      showLoading,
      // 排隊期間只要有一次是學生手動按的，補跑那次就算手動——手動才會先退勾。
      manual: state.envCheckQueued?.manual === true || manual,
    };
    return null;
  }

  state.manualRecheck = manual;
  state.envCheckInProgress = true;

  // 先畫一次，讓清單當場退回未勾——不畫的話學生只會在結果回來時看到「沒有變化」。
  if (manual) {
    renderWizard();
  }

  view.elements.recheckEnv.disabled = true;
  view.renderEnvBusy(true);
  renderCheckingLoader();

  if (showLoading) {
    view.renderEnvLoading();
  }

  try {
    const { os, checks } = await api.fetchEnv(
      toolSelectionValue(state.selectedTools),
    );
    state.envChecks = checks;
    // 回報那一份要用到：平台寫進 issue，家目錄用來把學生的本名換成 ~。
    // 家目錄只有伺服器知道，瀏覽器問不到——不帶回來的話遮蔽就做不了。
    state.envOs = os;
    forgetStaleInstalls(checks);
    view.elements.envOs.textContent = `作業系統：${os.platform} / ${os.arch}`;
    // 結果回來的那一刻就把「重掃中」關掉，再畫。留到 finally 才關的話，這一次
    // renderWizard 畫出來的清單還是退勾的狀態，而後面沒有人再畫一次——畫面就停在
    // 「0 / 1、但徽章寫已完成」（VM 實測 Node.js 那張）。
    state.manualRecheck = false;
    renderWizard();
    renderEnvActionButtons();

    // 學生自己按的那次要有結尾。重掃通常一秒內回來，只有轉圈圈閃一下的話，
    // 按鈕看起來還是像沒反應——而且多數時候狀態本來就不會變。
    //
    // 原始輸出那塊也要有東西：環境檢查是一支 HTTP 請求，不是跑一個程式，沒有
    // 逐字稿可印。把每一列的結果寫進去，「看原始輸出」才不是空的。
    if (manual) {
      for (const check of checks) {
        view.addRawLine(
          `[${check.status}] ${check.label}：${check.detail ?? ""}`,
        );
      }

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
    state.manualRecheck = false;
    view.renderEnvFailure(error.message);
    renderWizard();
    return null;
  } finally {
    state.envCheckInProgress = false;
    // 成功那條路上已經關掉了，這裡是失敗／例外的退路——不關的話清單會一直退勾。
    state.manualRecheck = false;
    view.renderEnvBusy(false);
    view.elements.recheckEnv.disabled = state.runInProgress;
    renderCheckingLoader();

    finishInitialChecks();

    // 排在後面那次補跑。一次只留一筆，所以不會無限接力。
    const queued = state.envCheckQueued;

    if (queued !== null) {
      state.envCheckQueued = null;
      void checkEnvironment(queued.showLoading, { manual: queued.manual });
    }
  }
}

async function checkConfigs() {
  if (state.configCheckInProgress) {
    state.configCheckQueued = true;
    return null;
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
    forgetStaleInstalls(result.checks);
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
    finishInitialChecks();

    if (state.configCheckQueued) {
      state.configCheckQueued = false;
      void checkConfigs();
    }
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
  view.addRawLine(outcome.summary, result.at);
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
    // 一格沒過就不要接著跑下一格：畫面現在要講的是這一格為什麼失敗，再開一個終端
    // 只會把那段說明推走。剩下那幾格學生自己按「重跑驗證」。
    stopAutoVerifyChain();
    // 腳本自己講的那句話：那一列的說明與白話區印的是同一句，兩邊不要各講各的。
    //
    // ⚠️ 學生自己按取消時不要去輸出裡找理由——那不是失敗，是他的決定。找出來的會是
    // 中止前的最後一行（多半是我們自己的內部日誌），那一列於是寫著一句他看不懂、又
    // 像是出了系統級錯誤的話（Reed 在 GitHub CLI 那一列看到）。
    const reason =
      result.signal !== null && result.signal !== undefined
        ? "你按了取消，這一步沒有做完"
        : failureReason(runContext.rawOutput);

    if (step !== null && step !== undefined) {
      state.failedSteps.add(step);
      state.resultTexts.set(
        step,
        `${check?.label ?? "這個項目"}：${reason ?? outcome.summary}`,
      );
    }

    view.addTerminalLines(
      terminalOutcomeLines({ action, succeeded: false, check, guidance, reason }),
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
  // ⚠️ 等合併的那幾列不能記成「已安裝」。
  //
  // CLAUDE.md、codex 的 config.toml 與 AGENTS.md 是 protectExisting 的：學生已經有
  // 檔案時「安裝」**刻意什麼都不做**，腳本照樣 exit 0。只看「是不是 install-* 而且
  // 成功」的話，一個還等著合併的列會當場被打勾，而卡片右上角同時寫著「等你合併」
  // ——畫面自相矛盾，而且那個勾是在說一件沒發生的事（VM 實測）。
  //
  // 樂觀記憶的用途是撐住「終端印了安裝成功、這一列還寫尚未安裝」那幾秒，前提是
  // 那次安裝**真的做了事**。needsMerge 的那次沒有，所以不該進來。
  if (
    step !== null &&
    step !== undefined &&
    installedCheck?.needsMerge !== true &&
    (action.startsWith("install-") || action === "merge-config-step")
  ) {
    state.installedSteps.add(step);
  }
  if (step !== null && step !== undefined) {
    state.failedSteps.delete(step);
    state.resultTexts.delete(step);
  }
  // 重裝＝那一步的內容換了，上次驗過的結論不該延用。指紋不再自己作廢紀錄，所以
  // 這條路要自己講清楚：裝完會接著驗一次，那次的結果才算數。
  if (action === "install-config-step" && step !== null && step !== undefined) {
    forgetVerification(step);
  }
  // 合併也是「那一步的內容換了」，而且影響的不只自己那一列：CLAUDE.md 合併之後，
  // 同一張卡上那個「問一次 Claude 看它怎麼回」的行為驗證就不算數了——它驗的正是
  // Claude 讀完 CLAUDE.md 之後的行為（Reed 在 VM 上看到勾還留著）。
  //
  // 這就是 C1 說的「每個 action 宣告它讓哪份資料失效」。這條分支沒有 banner，
  // 但這裡有：合併讓同卡的驗證結論失效。
  //
  // ⚠️ 還原走同一條。還原把兩份檔案退回合併前，那次驗證驗的是**合併後**的內容，
  // 退回去之後就不算數了。少了這條，那顆按鈕會停在「重跑驗證」——它在說「你驗過
  // 了」，而那件事剛剛被你自己取消掉（Reed 按下還原之後看到的）。
  if (
    (action === "merge-in-terminal" || action === "restore-merge-backup") &&
    step !== null &&
    step !== undefined
  ) {
    for (const sibling of mergeInvalidates(step, state.lastChecks)) {
      forgetVerification(sibling);
    }
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

  // ⚠️ 一顆安裝鍵只做它那一格的事（Reed 指定）。
  //
  // 這裡曾經自動接著裝同一張卡的另一份，而且驗證是整張卡排隊跑。
  // 畫面上的樣子是「第一格旁邊那顆按鈕，把兩件事都做了」——學生沒辦法只重跑其中
  // 一件，而每一格現在都有自己的安裝鍵了，那條自動接力就是多餘的意外。
  //
  // 代價寫在這裡免得下次又被接回去：兩份都要裝的卡，學生要按兩次。這是刻意的——
  // 兩顆按鈕各自說得出自己做了什麼，比一顆按鈕做兩件事好懂。
  const justInstalled =
    action === "install-config-step"
      ? (state.lastChecks.find((candidate) => candidate.id === step) ?? null)
      : null;
  // 需要合併的不驗（驗的是半完成的狀態）、已經驗過的不重驗（學生手動驗過再按重裝，
  // 不該又被拉去跑一次）。
  const verifyQueue =
    justInstalled !== null &&
    justInstalled.verifyAction != null &&
    justInstalled.needsMerge !== true &&
    !state.verificationAttempted.has(justInstalled.id)
      ? [justInstalled]
      : [];
  const verifyTarget = verifyQueue[0] ?? null;
  const followUp = installVerificationFollowUp({
    action,
    result,
    check: verifyTarget,
  });

  // 同一張卡上還有東西等著合併的話，先不要驗——驗的是半完成的狀態，而且合併完
  // 學生本來就要再驗一次（見 model.js 的 pendingMergeSibling）。
  const awaitingMerge = pendingMergeSibling(step, state.lastChecks);

  if (followUp === "auto" && awaitingMerge !== null) {
    state.deferredVerificationSteps.add(verifyTarget.id);
    view.addLine(
      // 同樣不寫死「重跑驗證」：沒驗過時那顆寫的是「驗證」（見 retestText 與格內
      // 那顆），指名一個當下不存在的字，學生會去找一顆找不到的按鈕。
      `先不驗證：這張卡的「${awaitingMerge.label}」還等著合併。合併完再按這一列的驗證鍵。`,
      "agent-status",
    );
    renderWizard();
    return;
  }

  if (followUp === "auto" || followUp === "prompt") {
    state.autoVerifyQueue = verifyQueue.slice(1).map((check) => check.id);
    state.autoVerifyTotal = verifyQueue.length;
    announceVerifyStep(verifyTarget);
  }

  if (followUp === "auto") {
    run(
      verifyTarget.verifyAction,
      undefined,
      null,
      rowRunOptions({
        step: verifyTarget.id,
        lang: options.lang,
        tools: options.tools,
        extra: verifyTarget.verifyOptions,
      }),
    );
    return;
  }

  if (followUp === "prompt") {
    state.pendingModalCheck = verifyTarget;
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

    // 重查完才輪下一格：排隊那幾格的 needsMerge／已驗過與否，要看這一輪的最新結果。
    await checkConfigs();
    runNextAutoVerify();
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

  // 這一輪的輸出屬於發動它的那張卡。釘住之後，學生跑到一半翻去看別張，結果仍然
  // 記在原來那張上，不會印進他正在看的那一份。
  if (state.announcedCardId !== null) {
    view.pinTranscript(state.announcedCardId);
  }

  view.clearRawOutput();
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
    // 行為驗證逐條判定的結果，收齊了才數得出「五條中過幾條」。
    rules: [],
    explanation: null,
  };

  if (action !== "install-config-step" && state.activeRunStep !== null) {
    state.deferredVerificationSteps.delete(state.activeRunStep);
  }

  if (envButton !== null) {
    view.hideInstallStatus();
  }

  state.agentName = agentNameFor(
    action,
    toolSelectionValue(state.selectedTools),
    state.activeRunStep,
  );
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

      // 時間戳只進原始輸出，不進 runContext.rawOutput——那一份要餵給挑失敗原因
      // 那條與 LLM 翻譯，前綴會干擾它們的比對。
      view.addRawLine(line.text, line.at);
    });

    events.addEventListener("agent", (event) => {
      const agentEvent = JSON.parse(event.data);

      // 指令根本不存在時，伺服器產生的是一句完整的人話（「找不到 brew 指令，請先
      // 安裝並確認它在 PATH 裡」），但它走 agent 事件、不走 line——rawOutput 是空的，
      // 卡片上只好退回「exit code: null」。最常見的一類失敗，摘要卻最沒有資訊。
      if (agentEvent.kind === "error" && typeof agentEvent.text === "string") {
        runContext.rawOutput.push(agentEvent.text);
      }

      view.addAgentEvent(agentEvent, state.agentName);
    });

    events.addEventListener("jr", (event) => {
      const jrEvent = JSON.parse(event.data);
      const nextModifier = loaderModifier({ action, options, jrEvent });

      if (nextModifier !== null) {
        renderRunLoader(nextModifier);
      }

      // 逐條判定的結果直接印在終端上：驗了哪幾條、哪幾條過。只留一句「驗證成功」
      // 的話，學生不知道驗了什麼，也不知道是不是全過。
      const ruleLine = behaviorRuleLine(jrEvent);

      if (ruleLine !== null) {
        runContext.rules.push(jrEvent);
        view.addTerminalLines([ruleLine]);
        return;
      }

      if (jrEvent.kind === "result" && runContext.rules.length > 0) {
        view.addTerminalLines([behaviorTally(runContext.rules)]);
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

initTour();
view.elements.replayTour.addEventListener("click", () => replayTour());
// 分頁鎖頭演錯、或導覽該跳沒跳時按這顆，整包貼給助教。收集在 view 與 tour 那邊
//（那裡才看得到動畫實例與變化紀錄），這裡只負責把它變成一段文字丟進剪貼簿。
// 「這一頁卡住了」取代了原本的「複製診斷資料」。
//
// 舊的那顆只是把 JSON 丟進剪貼簿，然後學生要自己找地方貼——多數人貼在課堂聊天室，
// 訊息一長就被捲走，也沒有地方回覆他。現在直接開成一則 issue，用他自己的 GitHub
// 帳號，助教在下面回。
//
// ⚠️ 先開框讓他看過再送：那份內容裡有他機器上的路徑與每一張卡的原始輸出，送出去
// 就是一則公開的 issue。
function currentReportInput(description = "") {
  const os = state.envOs ?? {};

  return {
    card: state.reportCard,
    platform: `${os.platform ?? ""} ${os.arch ?? ""}`.trim(),
    status: state.failedSteps.size > 0 ? "有失敗的步驟" : "沒有明顯失敗",
    // 跨卡片的原始輸出。問題常常是前一張留下來的，只送當下那張會漏掉真正的線索。
    log: JSON.stringify(view.rawOutputDiagnostics(), null, 2),
    sections: view.sectionLockStates(),
    // 家目錄只有伺服器知道（瀏覽器問不到），跟著 /env 一起帶回來。少了它，
    // 學生的本名會原封不動出現在一則公開的 issue 上。
    home: os.home ?? "",
    description,
  };
}

view.elements.reportIssue.addEventListener("click", () => {
  view.showReportModal(buildIssue(currentReportInput()).body);
});

view.onReportModal(
  async () => {
    const { title, body } = buildIssue(
      currentReportInput(view.reportDescription()),
    );

    view.setReportStatus("送出中……", { sending: true });

    const result = await api.sendReport(title, body);

    if (result.ok === true) {
      // 截圖只能在 GitHub 自己的頁面上拖進去——`gh issue create` 沒有附件功能，
      // Contents API 又要寫入權限（學生對回報 repo 沒有）。所以送完直接把那則
      // issue 開起來，學生在那個他熟悉的畫面上拖圖就好。
      view.setReportStatus(
        `送出去了。要附截圖的話，把圖直接拖進剛打開的那個頁面的留言框。\n${result.url}`,
      );
      view.addLine(`已回報：${result.url}`, "succeeded");
      window.open(result.url, "_blank", "noopener");
      return;
    }

    // 失敗留在框裡不關掉——關掉的話學生剛打的那段描述就沒了。
    view.setReportStatus(result.message ?? "送不出去，請再試一次。");

    if (result.detail) {
      view.addLine(result.detail, "failed");
    }
  },
  () => view.hideReportModal(),
);
// 安裝失敗時要貼給助教的就是這一段。原本只能用滑鼠圈——那個面板會邊跑邊長，圈到
// 一半又冒出新的一行，學生很難剛好圈完整（Reed 實測貼回來的都是殘缺的）。
view.elements.copyRawOutput.addEventListener("click", async () => {
  const text = view.rawOutputText();

  // 空的時候不要靜靜地複製一個空字串：學生會以為複製好了，貼出去才發現什麼都沒有。
  if (text.trim() === "") {
    view.addLine("目前沒有原始輸出可以複製。", "agent-status");
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    // 這顆的字用 copy / copied，不跟其他按鈕的中文一致（Reed 指定）：它站在原始輸出
    // 那一列上，旁邊全是英文的終端內容。
    view.setButtonLabel(view.elements.copyRawOutput, "copied");
    // 字要換回來，理由跟「複製診斷資料」那顆一樣：留著會看起來像已經按過了。
    window.setTimeout(() => {
      view.setButtonLabel(view.elements.copyRawOutput, "copy");
    }, 2000);
  } catch (error) {
    view.addLine(`無法複製原始輸出：${error.message}`, "failed");
  }
});
view.elements.recheckEnv.addEventListener("click", () => checkEnvironment());
view.renderConfigChoices(CONFIG_TOOL_CHOICES, CONFIG_LANGUAGES);
view.elements.recheckConfigs.addEventListener("click", checkConfigs);
view.onToolSelect((tool) => {
  state.selectedTools = toggleToolSelection(state.selectedTools, tool);
  saveSelection();
  view.setConfigSelection(state.selectedTools, state.selectedLanguage);
  restartInitialChecks();
  // 只清掉「學生不在」的那些段落——它們的卡片清單跟著工具變了，舊的位置可能指到
  // 別張卡。學生正看著的這一段不能清：清了之後下一輪 render 會重新推導成「第一張
  // 沒完成的卡」，於是人明明停在選工具卡上，按一下工具就被丟回剛才那張（VM 實測）。
  //
  // 旁證：選語言那顆從來沒清過，換語言就不會跳。
  state.viewingCardIndex = {
    [state.activeSectionId]:
      state.viewingCardIndex[state.activeSectionId] ?? 0,
  };
  renderNavigation();
  view.hideSectionLockMessage();
  // 環境段的卡片也跟著選擇走，所以改選之後要重查——只重查規則檔的話，取消勾選的
  // 那個工具的安裝與登入卡會留在畫面上。
  checkEnvironment();
  checkConfigs();
});
view.onLanguageSelect((language) => {
  state.selectedLanguage = language;
  saveSelection();
  view.setConfigSelection(state.selectedTools, state.selectedLanguage);
  restartInitialChecks();
  checkConfigs();
});
function openSection(sectionId) {
  view.hideSectionLockMessage();
  state.activeSectionId = sectionId;
  renderWizard();
}

// 鎖著的分頁點下去彈的那個框。兩種情況共用同一個框，但講的話不一樣：
//
//   只差當日密碼    「這一段要當天才開」，打 0822 就進得去
//   前面還沒做完    直接把擋著的那張卡講出來，只有講師的萬用密碼打得開
//
// 說明每次打開都重寫。共用一句話的話，其中一種一定是錯的——而學生看到一句對不上
// 自己處境的話，只會更不知道要做什麼。
function askPasscode(sectionId, gate) {
  state.pendingPasscodeSection = sectionId;
  view.showPasscodeModal(
    gate.needsPasscode
      ? {
          title: "這一段要當天才開",
          hint: "輸入講師在課堂上報出來的四位數字，就會解鎖。",
        }
      : { title: "這一段還沒輪到", hint: gate.reason },
  );
}

view.onSectionSelect((sectionId) => {
  const gate = renderNavigation()[sectionId];

  if (gate.locked) {
    // 鎖著的理由照樣寫在分頁底下那一行：框關掉之後學生還看得到自己差什麼。
    view.showSectionLockMessage(gate.reason);
    askPasscode(sectionId, gate);
    return;
  }

  openSection(sectionId);
});
view.onPasscodeModal(
  (entered) => {
    const sectionId = state.pendingPasscodeSection;

    if (sectionId === null) return;

    // 萬用密碼先比：它連「前面沒做完」都跳過，所以不能被下面那道擋掉。
    const master = matchesMasterPasscode(entered);
    const gate = renderNavigation()[sectionId];

    if (master) {
      state.overriddenSections.add(sectionId);
    } else if (gate.needsPasscode && matchesSectionPasscode(sectionId, entered)) {
      state.unlockedSections.add(sectionId);
    } else {
      // 前面沒做完的時候，當日密碼打對了也不算——講清楚是哪一種不對，不然學生會
      // 一直重打那組他明明沒記錯的數字。
      view.showPasscodeError(
        gate.needsPasscode
          ? "密碼不對，再確認一次講師報的數字。"
          : "這組密碼打不開還沒輪到的段落。先做完上面那句講的，或請講師來開。",
      );
      return;
    }

    state.pendingPasscodeSection = null;
    view.hidePasscodeModal();
    // 存不進去只講一句話、不擋人：學生現在就要進去上課，為了一次寫入失敗把他關
    // 在外面沒有意義——最壞的情況是重開嚮導要再打一次密碼。
    const persist = master
      ? api.saveOverriddenSections([...state.overriddenSections])
      : api.saveUnlockedSections([...state.unlockedSections]);

    persist.catch((error) =>
      view.addLine(`無法保存解鎖狀態：${error.message}`, "failed"),
    );
    // 先重畫導覽列讓那個鎖頭開起來，再進去——不然分頁還掛著鎖，看起來像沒解開。
    renderNavigation();
    openSection(sectionId);
  },
  () => {
    state.pendingPasscodeSection = null;
    view.hidePasscodeModal();
  },
);
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
      // 按了「稍後」就是整張卡都稍後，別再把排隊的下一格推上來——學生會覺得關不掉。
      for (const id of state.autoVerifyQueue) {
        state.deferredVerificationSteps.add(id);
      }
      stopAutoVerifyChain();
      renderWizard();
    }
  },
);
renderNavigation();

async function initialize() {
  // 兩件事互不相干，一起等：哪幾格有操作步驟只影響要不要畫那顆按鈕，
  // 序列跑的話開頁多等一趟來回。
  await Promise.all([loadVerifiedSteps(), loadWalkthroughIds()]);
  // 選擇是 loadVerifiedSteps 從伺服器帶回來的，所以 chips 要在它之後才套。
  // 擺在前面的話畫面永遠停在預設值，卡片卻照著存下來的選擇跑，兩邊對不上。
  view.setConfigSelection(state.selectedTools, state.selectedLanguage);
  checkEnvironment();
  checkConfigs();
}

initialize();
