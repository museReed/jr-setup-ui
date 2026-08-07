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
import { openWalkthrough } from "./walkthrough.js";
import {
  CONFIG_LANGUAGES,
  CARD_HINTS,
  EYE_ROW_ACTIONS,
  CONFIG_TOOL_CHOICES,
  PLAYWRIGHT_SHOT_AGENTS,
  flattenCheckCards,
  groupChecks,
  nextInstallStep,
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
  behaviorRuleLine,
  behaviorTally,
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
  eyeVerifiedSteps,
  extractLoginHints,
  failureReason,
  guidanceModel,
  impliedVerifiedSteps,
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
  state.skippedCards.delete(stepId);

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
  }
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
  // 驗證失敗鎖住往前的路，但不能把人關死：環境真的過不了的學生要有一條出口。
  // 那條出口是一顆寫明白的「先跳過這張」，不是把箭頭留在那裡假裝一切正常。
  const verificationFailedHere = verifyRequiredChecks.some((check) =>
    state.failedVerificationSteps.has(check.id),
  );
  const nextUnlocked =
    card.kind === "setup"
      ? true
      : card.kind === "env"
        ? cardIsComplete(card, verified, state.manualCheckedIds) &&
          groups.manual.every((item) => item.checked)
        : state.skippedCards.has(card.checkId) ||
          nextCardUnlocked({
            installed,
            verificationRequired,
            verificationAttempted,
            manualItems: groups.manual,
          });
  // 只在「真的被鎖住、而且鎖住的原因是驗證失敗」時給出口。人工項沒勾、還沒安裝
  // 那種不給——那些他自己按得動，給了只是繞過去。
  const canSkip =
    card.kind === "config" && !nextUnlocked && verificationFailedHere;
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
  );
  // 合併的卡有兩份設定。按鈕要對著「還沒好的那一份」——兩份都好了才回到主 check，
  // 因為驗證掛在它身上。
  const rowCheck =
    cardChecks.find((candidate) => candidate.status !== "ok") ?? card.check;
  // 驗證按鈕只能有一個家：一個驗證就放卡片底下，多個就一律回到各自那一格。
  //
  // 兩邊都畫的話，底下那顆跑的永遠是 card.check——合併卡上它看起來像「全部重跑」，
  // 實際只重跑第一個驗證（VM 實測：白名單那格已驗過，底下按下去開的是「一次只跑
  // 一個指令」的終端）。一顆按鈕說謊比少一顆按鈕更糟。
  const verifyChecks = cardChecks.filter((check) => check.verifyAction != null);
  const perRowVerify = verifyChecks.length > 1;
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
                text: mergePending
                  ? "先按「用 AI 合併」"
                  : EYE_ROW_ACTIONS[card.checkId].text,
                rowId: `eye-${card.checkId}`,
                step: `eye-${card.checkId}`,
                options: EYE_ROW_ACTIONS[card.checkId].options ?? undefined,
                disabled: mergePending,
              },
            ]
          : []),
        ...(perRowVerify ? verifyChecks : []).map((check) => ({
          action: check.verifyAction,
          dataName: "verifyAction",
          text: mergePending
            ? "先按「用 AI 合併」"
            : verified.has(check.id)
              ? "重跑驗證"
              : "驗證",
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
    // 多個驗證的卡片不畫底下那顆——按鈕已經回到各自那一格了（見 perRowVerify）。
    showRetest: card.kind === "env" || (row?.showRetest === true && !perRowVerify),
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
  renderControls();
  // 分頁的鎖跟著一起更新。原本只有勾選、換工具、點分頁才會重算，於是「最後一張
  // 卡驗過了」的當下沒有人去看鎖狀態——下一段其實已經開了，畫面上還鎖著，等學生
  // 去點才發現。開鎖動畫也因此永遠錯過那一刻（VM 實測）。
  const lockStates = renderNavigation();
  renderWizardNav({
    cardSection,
    currentIndex,
    nextUnlocked,
    canSkip,
    cardId: card.checkId,
    lockStates,
    onNext: cardModel.onNext,
  });
  // 導覽排在最後：翻頁按鈕這時候才決定要不要露臉，太早問會指到一顆還 hidden 的
  // 按鈕，泡泡就貼到畫面左上角去了。
  onCardRendered({
    cardId: card.checkId,
    runInProgress: state.runInProgress,
    // 已經做完的卡不跳提示：那六張的提示全是「不先知道就會卡死或誤判」，卡片綠了
    // 之後那句話講的是一件已經發生過的事（見 tour-model.js 的 hintForCard）。
    cardDone,
  });
}

// 兩顆翻頁按鈕：位置固定在畫面兩側，內容跟著現在這張卡變。
//
// 驗證失敗時那一顆逃生按鈕。跟「下一張」共用同一個位置，但講的是別件事，所以字要
// 不一樣、不放解鎖特效（慶祝一件沒做成的事很怪），也不畫成主要動作。
//
// 按下去先把這張卡登記成「跳過」——下次回到這張，那顆按鈕就是正常的「下一張」，
// 不用再按一次逃生。完成與否仍然由 cardIsComplete 說了算，跳過的卡照樣是失敗。
function skipNavSpec(cardId, label, onSkip) {
  return {
    show: true,
    label,
    secondary: true,
    celebrate: false,
    onClick: () => {
      if (cardId !== null) state.skippedCards.add(cardId);
      view.addLine(`先跳過這一張，之後可以回來再驗一次。`, "agent-status");
      onSkip();
    },
  };
}

// 走到一段的最後一張時，「下一張」換成「下一段：⋯」——那一段做完了，下一步是換段，
// 不是回頭去點上面的分頁。點下去落在新那段的第一張。
function renderWizardNav({
  cardSection,
  currentIndex,
  nextUnlocked,
  canSkip = false,
  cardId = null,
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
  const nextSectionOpen =
    nextSection !== undefined && lockStates[nextSection.id]?.locked !== true;

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
    // 驗證失敗被鎖住時，那個位置換成一顆說實話的「先跳過這張」：它不慶祝、也不
    // 把卡片記成完成，只是承認學生現在過不了、讓他先往下走。原本這裡是「失敗也
    // 照樣顯示下一張」，箭頭跟旁邊那顆紅色的「失敗」徽章互相打架（Reed 截圖）。
    next: atLast
      ? canSkip && !nextSectionOpen
        ? skipNavSpec(cardId, `先跳過，${nextSection === undefined ? "留在這一段" : `往下一段：${nextSection.title}`}`, () => {
            if (nextSection !== undefined) goToSection(nextSection.id, "first");
          })
        : {
            show: nextSectionOpen,
            label: `下一段：${nextSection?.title ?? ""}`,
            onClick: () => goToSection(nextSection.id, "first"),
          }
      : canSkip
        ? skipNavSpec(cardId, "先跳過這張", onNext)
        : { show: nextUnlocked, label: "下一張", onClick: onNext },
  });
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
    // 腳本自己講的那句話：那一列的說明與白話區印的是同一句，兩邊不要各講各的。
    const reason = failureReason(runContext.rawOutput);

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
  // 重裝＝那一步的內容換了，上次驗過的結論不該延用。指紋不再自己作廢紀錄，所以
  // 這條路要自己講清楚：裝完會接著驗一次，那次的結果才算數。
  if (action === "install-config-step" && step !== null && step !== undefined) {
    forgetVerification(step);
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

  // 合併的卡有兩份設定。裝完第一份先接著裝第二份，兩份都好了才輪到驗證——不然驗的
  // 是只裝了一半的狀態。
  const sibling =
    action === "install-config-step"
      ? nextInstallStep(step, state.lastChecks)
      : null;

  if (sibling !== null) {
    view.addLine(`接著裝同一張卡的另一份：${sibling.label}`, "agent-status");
    runConfigCheckAction(sibling, "install-config-step");
    return;
  }

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
view.elements.copyDiagnostics.addEventListener("click", async () => {
  try {
    const diagnostics = {
      // 每張卡最近幾次執行的原始輸出。這一份才是真正判斷得了問題的東西——這顆按鈕
      // 原本只收鎖頭與導覽的狀態，學生按了貼回來，我們拿到的是動畫幀號。
      //
      // 而且它跨卡片：頁面上的 copy 只複製得到當下那張，但問題常常是前一張留下來的。
      output: view.rawOutputDiagnostics(),
      // 哪一段做完了、哪一段還鎖著。「為什麼我進不去下一段」是真的會問的問題，
      // 而那個答案在畫面上只表現成一個鎖頭圖示。
      sections: view.sectionLockStates(),
      // 導覽跑了什麼、為什麼沒跑。Reed 在 VM 上看到版面導覽沒出現就直接跳了元件
      // 導覽，而同一份 code 在 Mac 上重現不出來——沒有紀錄只能一路猜。
      tour: tourDiagnostics(),
    };
    await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
    view.setButtonLabel(view.elements.copyDiagnostics, "已複製");
    // 字要換回來：留著「已複製」的話，下次真的要按時看起來像已經按過了。
    window.setTimeout(() => {
      view.setButtonLabel(view.elements.copyDiagnostics, "複製診斷資料");
    }, 2000);
  } catch (error) {
    view.addLine(`無法複製診斷資料：${error.message}`, "failed");
  }
});
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
