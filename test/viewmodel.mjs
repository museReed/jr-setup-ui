import assert from "node:assert/strict";

import { FIX_ACTIONS } from "../src/env-check.js";
import { INSTALLERS } from "../src/installers.js";
import {
  BEHAVIOR_CHECKLIST,
  BEHAVIOR_QUESTION,
  LOADER_MODIFIERS,
  LOGIN_WAIT_TIMEOUT_MS,
  AUTO_VERIFY_ACTIONS,
  agentNameFor,
  appendTermLine,
  behaviorFallbackState,
  behaviorRuleLine,
  behaviorTally,
  cardIsComplete,
  completedCardIds,
  cardResultItems,
  cardResultText,
  cardStatusModel,
  checklistGroups,
  currentCardIndex,
  configRowModel,
  configSummary,
  envButtonState,
  envCardRowModel,
  envRowModel,
  eyeVerifiedSteps,
  extractLoginHints,
  FIX_BUTTON_TEXT,
  fixButtonText,
  impliedVerifiedSteps,
  installStatusMessage,
  isLoginAction,
  isVerifyAction,
  loaderLabel,
  loginCardModel,
  loginWaitStep,
  manualStepGroups,
  milestoneModels,
  nextCardUnlocked,
  rowRunOptions,
  runControlsState,
  sectionEndRecheck,
  failureReason,
  runOutcome,
  sectionManualItems,
  systemRowChecked,
  sectionStatus,
  terminalOutcomeLines,
  toggleToolSelection,
  toolSelectionValue,
} from "../public/viewmodel.js";
import {
  CARD_HINTS,
  CONFIG_LANGUAGES,
  CONFIG_TOOL_CHOICES,
  EYE_ONLY_VERIFY,
  configQuery,
} from "../public/model.js";
import { actions as ACTIONS } from "../src/actions.js";
import { VERIFICATION } from "../src/config-check.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

try {
  assert.deepEqual(CONFIG_LANGUAGES, ["zh-TW", "zh-CN", "en"]);
  assert.deepEqual(
    CONFIG_TOOL_CHOICES.map((choice) => choice.value),
    ["claude", "codex", "claude,codex"],
  );
  ok("規則檔語言與工具選項符合後端白名單");

  assert.equal(
    configQuery({ tools: "claude,codex", lang: "zh-TW" }),
    "tools=claude,codex&lang=zh-TW",
  );
  ok("規則檔查詢字串保留工具順序與逗號");

  for (const input of [
    { tools: "cursor", lang: "zh-TW" },
    { tools: "claude", lang: "ja" },
  ]) {
    assert.throws(() => configQuery(input));
  }
  ok("規則檔查詢拒絕不合法的工具與語言");

  assert.deepEqual(toggleToolSelection(["claude"], "claude"), ["claude"]);
  assert.deepEqual(toggleToolSelection(["claude"], "codex"), [
    "claude",
    "codex",
  ]);
  assert.equal(toolSelectionValue(["codex", "claude"]), "claude,codex");
  ok("工具 chips 至少保留一個，且送出值固定 Claude 在前");

  const configChecks = [
    { status: "ok", symbol: "✓", ariaLabel: "通過" },
    { status: "warn", symbol: "!", ariaLabel: "需處理" },
    { status: "missing", symbol: "✗", ariaLabel: "缺少" },
  ];
  for (const expected of configChecks) {
    const model = configRowModel({
      id: `${expected.status}-step`,
      label: "規則",
      status: expected.status,
      detail: "狀態",
      installAction: null,
      mergeAction: null,
    });
    assert.equal(model.symbol, expected.symbol);
    assert.equal(model.ariaLabel, expected.ariaLabel);
  }
  ok("規則檔三種狀態沿用環境檢查圖示與讀屏文字");

  const configActions = configRowModel({
    id: "claude-md",
    label: "行為規則 CLAUDE.md",
    status: "warn",
    detail: "需要合併",
    installAction: "install-config-step",
    mergeAction: "merge-in-terminal",
  });
  assert.deepEqual(configActions.buttons, [
    {
      action: "install-config-step",
      dataName: "installAction",
      text: "安裝",
      step: "claude-md",
      // ⚠️ rowId 決定這顆畫在哪一列。沒有 verifyAction 的列不拆成「安裝／驗證」
      // 兩格，所以兩顆都掛在 system-<id> 那一列上。
      rowId: "system-claude-md",
    },
    {
      action: "merge-in-terminal",
      dataName: "mergeAction",
      // 講明會開視窗：不講的話學生按下去看到新視窗跳出來會以為出事了，
      // 而那個視窗正是他要去回答問題的地方。
      text: "用 AI 合併（會開終端）",
      step: "claude-md",
      rowId: "system-claude-md",
    },
  ]);
  ok("規則檔同時可安裝與合併時安裝按鈕在前，而且各自掛回它負責的那一列");

  // ⚠️ 守門：每一顆按鈕的 rowId 都要對得到清單裡真的存在的那一列。
  //
  // view.js 的 inlineActions 是一張 Map，查不到就**什麼都不畫**——rowId 算錯的話
  // 按鈕不是跑錯位置，是**安靜地消失**。而拆不拆成「安裝／驗證」兩格的規則寫在
  // checklistGroups，兩邊要一模一樣。
  const rowShapes = [
    { id: "claude-md", label: "規矩", status: "warn", detail: "需要合併", installAction: "install-config-step", mergeAction: "merge-in-terminal", restoreAction: "restore-merge-backup" },
    { id: "output-style", label: "回話風格", status: "missing", detail: "尚未安裝", installAction: "install-config-step", verifyAction: "verify-behavior" },
    { id: "demo-claude", label: "跑一次", status: "ok", detail: "好了", noInstall: true, verifyAction: "verify-in-terminal", verifyKind: "terminal" },
    { id: "vault-agent-claude", label: "寫一篇", status: "ok", detail: "好了", eyeCheck: "看得到歷史", verifyAction: "verify-in-terminal", verifyKind: "terminal" },
  ];

  for (const shape of rowShapes) {
    const rows = new Set(
      checklistGroups({ checks: [shape], verifiedCheckIds: new Set() }).system.map(
        ({ id }) => id,
      ),
    );

    for (const button of configRowModel(shape).buttons) {
      if (button.rowId === undefined) continue;

      assert.ok(
        rows.has(button.rowId),
        `${shape.id} 的「${button.text}」掛到不存在的列 ${button.rowId}，畫面上會直接不見`,
      );
    }
  }
  ok("每一顆按鈕的 rowId 都對得到清單裡真的存在的那一列");

  // 合併過才有還原鍵，而且排在合併鍵後面——它是那顆的退路，不是另一個主動作。
  const withRestore = configRowModel({
    id: "codex-config",
    label: "Codex CLI 的規矩與回話風格",
    status: "warn",
    detail: "需要合併",
    installAction: null,
    mergeAction: "merge-in-terminal",
    mergeStep: "codex-config",
    restoreAction: "restore-merge-backup",
  });
  assert.deepEqual(
    withRestore.buttons.map((button) => button.dataName),
    ["installAction", "mergeAction", "restoreAction"],
  );
  assert.equal(withRestore.buttons[2].text, "還原成合併前");
  ok("合併過的列多一顆「還原成合併前」，排在合併鍵後面");

  // 迴歸（VM 實測）：Codex 那張卡的按鈕來自 codex-agents 那一列，但合併要送的是
  // 群組主人 codex-config——不折回去的話會只合一半，而且不會拍到另一份的快照。
  const followerRow = configRowModel({
    id: "codex-agents",
    label: "Codex CLI 做事的規矩",
    status: "warn",
    detail: "已有你自己的版本，需要合併",
    installAction: null,
    mergeAction: "merge-in-terminal",
    mergeStep: "codex-config",
  });
  assert.equal(
    followerRow.buttons.find((button) => button.dataName === "mergeAction").step,
    "codex-config",
  );
  ok("跟班那一列也有合併鍵，但送出的 step 折回群組主人");

  // 沒合併過就沒有快照，那顆按下去只會說「找不到快照」——不該出現。
  assert.deepEqual(
    configRowModel({
      id: "codex-config",
      label: "x",
      status: "warn",
      detail: "需要合併",
      installAction: null,
      mergeAction: "merge-in-terminal",
      restoreAction: null,
    }).buttons.map((button) => button.dataName),
    ["installAction", "mergeAction"],
  );
  ok("沒合併過時不長還原鍵");

  // 結構齊全不等於生效。實測踩過四次「裝好了、綠燈、就是不生效」，所以還沒驗過
  // 行為的列不能是綠的，而且要留著安裝按鈕讓學生能重跑。
  const pending = configRowModel({
    id: "hook",
    label: "Shell 不串接 hook",
    status: "ok",
    detail: "已安裝",
    installAction: null,
    mergeAction: null,
    verifyAction: "verify-behavior",
    eyeCheck: null,
  });
  assert.equal(pending.status, "unverified");
  assert.match(pending.detail, /尚未驗證/);
  // 不放「驗證」按鈕：安裝完會自動接驗證，那顆只會閃一下就消失，學生不知道驗了沒
  // （Reed 實測）。重驗一律走「再 check 一次」，而它一直都在。
  //
  // 裝好了就整顆收掉，即使還沒驗過：安裝按鈕只管安裝。原本這一態給可按的「重裝」，
  // 於是「只差看一眼」的列也長出一顆安裝按鈕，學生按下去畫面說「正在安裝」——
  // 他要的只是再驗一次（Reed 實測 claude-namer）。後來改成灰色的「✅ 已安裝」，
  // 現在整顆拿掉：那一列的狀態已經說完同一件事（Reed 指定）。驗證請按「重跑驗證」。
  assert.deepEqual(pending.buttons, []);
  assert.equal(pending.showRetest, true);
  ok("裝好但沒驗過的列：安裝按鈕整顆收掉，驗證交給「重跑驗證」");

  // 例外：reinstallable 的列裝好之後仍然留一顆次要的「重新設定」。
  // 筆記庫那列的登記會被 Obsidian 結束時整份寫回去蓋掉——四個檢查點全綠、按驗證
  // 卻跳 Vault not found（Reed 實測），沒有這顆按鈕就沒有自救手段。
  const redoable = configRowModel(
    {
      id: "obsidian-vault",
      label: "接到 GitHub 的筆記庫",
      status: "ok",
      detail: "已接上 GitHub",
      installAction: "install-config-step",
      reinstallable: true,
    },
    true,
  );
  assert.deepEqual(
    redoable.buttons.map(({ text, secondary }) => [text, secondary === true]),
    [["重新設定", true]],
  );
  ok("設定會被別的程式改掉的列，裝好之後仍然留一顆次要的重新設定");

  // 例外：驗證真的失敗過的時候那顆要活過來。裝歪了（舊版、裝一半）而 check 仍是
  // ok 的情況存在，那時重跑安裝是唯一的自救手段。
  const rescue = configRowModel(
    {
      id: "hook",
      label: "Shell 不串接 hook",
      status: "ok",
      detail: "已安裝",
      installAction: null,
      mergeAction: null,
      verifyAction: "verify-behavior",
      eyeCheck: null,
    },
    false,
    { verificationFailed: true },
  );
  assert.deepEqual(
    rescue.buttons.map(({ text, secondary, disabled }) => ({
      text,
      secondary,
      disabled,
    })),
    [{ text: "重裝", secondary: true, disabled: undefined }],
  );
  ok("驗證失敗過的列才把「重裝」放回來，而且不是主要動作");

  // ⚠️ 迴歸：伺服器說這一列不 ok 時，那顆也要活過來——即使這次已經驗過了。
  //
  // installationDone 吃 installed / verified 這兩份「本次開著的網頁」的記憶。舊的
  // service_tier = "default" 還在時檢查回 warn，而學生這次驗過 → 整顆被收掉，可是
  // 那一列的說明正寫著「按這一列的安裝鍵會把它停用」，指向一顆不存在的按鈕
  //（Reed 在畫面前問「那個 button 在哪邊」）。本次的樂觀記憶不能蓋過伺服器。
  const staleAfterVerify = configRowModel(
    {
      id: "codex-config",
      label: "Codex CLI 的規矩與回話風格",
      status: "warn",
      detail: '已併入工作坊設定，但舊的 service_tier = "default" 還在',
      installAction: "install-config-step",
      mergeAction: null,
      verifyAction: "verify-behavior",
      eyeCheck: null,
    },
    true,
  );
  assert.ok(
    staleAfterVerify.buttons.some((button) => button.dataName === "installAction"),
    "檢查說不 ok 的列一定要留得住安裝鍵，那是停用舊設定的唯一入口",
  );
  ok("伺服器說這一列不 ok 時，安裝鍵不會被「這次驗過了」收掉");

  // ⚠️ 但等著合併的列不給安裝鍵：那個檔案是 protectExisting 的，安裝刻意不覆蓋學生
  // 自己的內容，按下去只會印一句「已有你自己的 X，沒有覆蓋，請按『用 AI 合併』」。
  // 而那顆「用 AI 合併」就在同一列旁邊——再放一顆按了沒事的鍵只是分散注意力
  //（Reed 在畫面前指出）。
  const awaitingMergeRow = configRowModel(
    {
      id: "claude-md",
      label: "Claude Code CLI 做事的規矩",
      status: "warn",
      detail: "已有你自己的版本，需要合併",
      installAction: "install-config-step",
      mergeAction: "merge-in-terminal",
      needsMerge: true,
    },
    true,
  );
  assert.ok(
    !awaitingMergeRow.buttons.some(
      (button) => button.dataName === "installAction",
    ),
    "等著合併的列不該有安裝鍵——按下去什麼都不會發生",
  );
  assert.ok(
    awaitingMergeRow.buttons.some((button) => button.dataName === "mergeAction"),
    "那一列真正該按的是「用 AI 合併」",
  );
  ok("等著合併的列只給合併鍵，不給按了沒事的安裝鍵");

  // ⚠️ 還沒按過安裝的那一輪也一樣不給。Reed 在 Codex 那張卡上按了好幾次那顆「安裝」，
  // 畫面除了一句「已有你自己的版本，沒有覆蓋」以外沒有任何變化——他的話是「點了之後
  // 沒有任何反應，也不能確定有沒有安裝成功」。那顆鍵存在本身就是誤導。
  const freshMergeRow = configRowModel({
    id: "codex-agents",
    label: "Codex CLI 做事的規矩",
    status: "warn",
    detail: "已有你自己的版本，需要合併",
    installAction: "install-config-step",
    mergeAction: "merge-in-terminal",
    needsMerge: true,
  });
  assert.ok(
    !freshMergeRow.buttons.some(
      (button) => button.dataName === "installAction",
    ),
    "沒按過安裝的合併列也不給安裝鍵——按下去一樣什麼都不會發生",
  );
  // 合併鍵掛在「安裝：…」那一格，不是「驗證：…」那一格：合併改的是檔案本身，而那
  // 一格的說明正寫著「已有你自己的版本，需要合併」。
  const mergeButton = freshMergeRow.buttons.find(
    (button) => button.dataName === "mergeAction",
  );
  assert.equal(mergeButton.rowId, "system-codex-agents");
  const splitMergeRow = configRowModel({
    id: "codex-config",
    label: "Codex CLI 的規矩與回話風格",
    status: "warn",
    detail: "已有你自己的版本，需要合併",
    mergeAction: "merge-in-terminal",
    verifyAction: "verify-behavior",
    needsMerge: true,
  });
  assert.equal(
    splitMergeRow.buttons.find((button) => button.dataName === "mergeAction")
      .rowId,
    "install-codex-config",
  );
  ok("合併鍵掛在講「需要合併」的那一格，拆成兩格時掛安裝那半");

  // 還沒裝的列才是「安裝」，而且是主要動作。
  const notInstalledYet = configRowModel({
    id: "hook",
    label: "Shell 不串接 hook",
    status: "missing",
    detail: "未安裝",
    installAction: "install-config-step",
    verifyAction: "verify-behavior",
    eyeCheck: null,
  });
  assert.deepEqual(
    notInstalledYet.buttons.map(({ text, secondary }) => ({ text, secondary })),
    [{ text: "安裝", secondary: undefined }],
  );
  ok("還沒裝的列才給主要動作的「安裝」");

  // demo 那種 noInstall 的列從頭到尾沒有「安裝」這個概念。原本會補一顆按不動的
  // 佔位按鈕（為了讓每列的按鈕位置對齊），學生盯著它想「是不是要先按這個」。
  const demoRow = configRowModel({
    id: "demo-claude",
    label: "跑一條龍 demo（Claude）",
    status: "ok",
    detail: "按右邊開終端跑一次",
    noInstall: true,
    installAction: null,
    verifyAction: "verify-in-terminal",
    verifyKind: "terminal",
    verifyOptions: { case: "demo", agent: "claude" },
    eyeCheck: "左邊逐字打 code、右邊即時長出網頁",
  });
  assert.deepEqual(
    demoRow.buttons.map(({ text }) => text),
    ["開終端跑"],
  );
  assert.equal(demoRow.showRetest, false);
  ok("noInstall 的列只有「開終端跑」，不補按不動的安裝佔位");

  // 跑過一次之後才寫「重」——所有跑驗證的按鈕都同一套（app.js 的 retestText、
  // 格內那顆、這顆）。沒跑過就寫「重跑」，學生會以為自己漏掉了前面某一步。
  const demoRowRan = configRowModel(
    {
      id: "demo-claude",
      label: "跑一條龍 demo（Claude）",
      status: "ok",
      detail: "按右邊開終端跑一次",
      noInstall: true,
      installAction: null,
      verifyAction: "verify-in-terminal",
      verifyKind: "terminal",
      verifyOptions: { case: "demo", agent: "claude" },
      eyeCheck: "左邊逐字打 code、右邊即時長出網頁",
    },
    true,
  );
  assert.deepEqual(
    demoRowRan.buttons.map(({ text }) => text),
    ["重跑一次"],
  );
  ok("跑過的 demo 列按鈕才改叫「重跑一次」");

  const verified = configRowModel(
    {
      id: "hook",
      label: "Shell 不串接 hook",
      status: "ok",
      detail: "已安裝",
      installAction: null,
      mergeAction: null,
      verifyAction: "verify-behavior",
      eyeCheck: null,
    },
    true,
  );
  assert.equal(verified.status, "ok");
  assert.deepEqual(verified.buttons, []);
  assert.equal(verified.showRetest, true);
  ok("驗過之後才變綠，安裝按鈕收掉並可再次驗證");

  // ⚠️ card.label 一定要有。真的資料一律由 checkCard 帶上（見 model.js），而
  // sectionStatus 要拿它指名擋著的卡——少了它畫面上會出現「「undefined」（第 2 張）」。
  const cards = [
    {
      kind: "config",
      checkId: "one",
      label: "一",
      check: { id: "one", label: "一", status: "ok", detail: "完成" },
    },
    {
      kind: "config",
      checkId: "two",
      label: "二",
      check: { id: "two", label: "二", status: "ok", detail: "完成" },
    },
    {
      kind: "config",
      checkId: "three",
      label: "三",
      check: {
        id: "three",
        label: "三",
        status: "missing",
        detail: "未完成",
      },
    },
  ];
  assert.equal(currentCardIndex(cards, new Set()), 2);
  assert.equal(
    currentCardIndex(
      cards.map((card) => ({
        ...card,
        check: { ...card.check, status: "missing" },
      })),
    ),
    0,
  );
  assert.equal(
    currentCardIndex(
      cards.map((card) => ({
        ...card,
        check: { ...card.check, status: "ok" },
      })),
    ),
    2,
  );
  ok("目前卡片會推導成第一張未完成卡，整段完成則停在最後一張");

  // 「這張卡完成了嗎」全站只有一個答案。稽核（docs/audit-card-logic.md）找到進度條
  // 另外收了三條路：setup 自己判、目前這張卡改看 nextUnlocked、其他卡看
  // attempted && installed。後兩條讓圓點比徽章寬鬆——同一張卡「圓點亮了、徽章還是
  // 待驗證」，而且第三條連驗證有沒有成功都不看。
  //
  // 這條測試把那三條路釘死：completedCardIds 的結果必須等於逐張 cardIsComplete。
  const completed = completedCardIds(cards, new Set(), new Set());
  assert.deepEqual(
    [...completed],
    cards
      .filter((card) => cardIsComplete(card, new Set(), new Set()))
      .map(({ checkId }) => checkId),
  );
  assert.deepEqual([...completed], ["one", "two"]);
  ok("進度條的完成集合＝逐張 cardIsComplete，沒有別的路徑");

  // 驗證失敗但「試過了」不算完成——那是「下一張」的條件，不是完成的條件。
  const attemptedOnly = [
    {
      kind: "config",
      checkId: "pending-one",
      check: {
        id: "pending-one",
        label: "待驗證",
        status: "ok",
        detail: "已安裝",
        verifyAction: "verify-behavior",
        eyeCheck: null,
      },
    },
  ];
  assert.deepEqual([...completedCardIds(attemptedOnly, new Set(), new Set())], []);
  ok("裝好但沒驗過的卡不算完成，就算學生已經按過驗證");

  const seen = (...ids) => new Set(ids);

  const milestones = milestoneModels(
    cards,
    new Set(["one"]),
    1,
    seen("one", "two"),
  );
  assert.equal(milestones[1].unlocked, true);
  assert.equal(milestones[2].unlocked, false);
  assert.deepEqual(
    milestones.map(({ percent }) => percent),
    [33, 67, 100],
  );
  ok("前面有未完成卡時，後面的里程碑保持鎖定");

  const allIds = new Set(["one", "two", "three"]);

  // 本機環境全綠（三張卡的檢查都通過）但小鴨還在第一站：後面兩顆不能亮。
  const atFirst = milestoneModels(cards, allIds, 0, seen("one"));
  assert.deepEqual(
    atFirst.map(({ reached }) => reached),
    [true, false, false],
  );
  assert.equal(atFirst[2].unlocked, false);
  ok("小鴨沒走到的圓點不算走過，就算那些檢查本來就通過");

  // 走到第 2 站、第 2 張的檢查沒過：那一顆不能亮。
  const secondNotDone = milestoneModels(
    cards,
    new Set(["one"]),
    1,
    seen("one", "two"),
  );
  assert.deepEqual(
    secondNotDone.map(({ reached }) => reached),
    [true, false, false],
  );
  ok("走過但沒通過的圓點不算走過");

  // 迴歸（VM 實測）：只選 codex 做完所有卡，回第一頁加選 claude——加選會把停留位置
  // 重置、而 claude 的卡排在前面，於是位置被拉回開頭，已完成的 codex 卡通通變灰。
  // 走過就是走過，往回站不該讓它們熄掉。
  const walkedBackToFirst = milestoneModels(
    cards,
    allIds,
    0,
    seen("one", "two", "three"),
  );
  assert.deepEqual(
    walkedBackToFirst.map(({ reached }) => reached),
    [true, true, true],
  );
  ok("往回看不會讓已經走過且完成的圓點變灰");

  // 同一個迴歸的另一半：記索引就會壞在這裡。完成到第 3 張之後，加選工具在中間插入
  // 兩張新卡，原本的第 2、3 張被推到第 4、5 位——記索引的話它們會超過高水位而重新
  // 變灰，記 ID 則不受位移影響。
  const afterInsert = [
    cards[0],
    { checkId: "new-a" },
    { checkId: "new-b" },
    cards[1],
    cards[2],
  ];
  const inserted = milestoneModels(
    afterInsert,
    allIds,
    1,
    seen("one", "two", "three"),
  );
  assert.deepEqual(
    inserted.map(({ reached }) => reached),
    [true, false, false, true, true],
  );
  ok("中間插入新卡後，已完成的舊卡不會因為位移而變灰");

  // 卡片往哪邊展開要看落在條上的哪半邊。用「第幾顆」判的話，只有一站時那顆
  // （percent 100、貼最右）會被判成往右開，直接溢出畫面。
  assert.deepEqual(
    milestoneModels(cards, new Set(), 0, seen()).map(
      ({ edgeClass }) => edgeClass,
    ),
    [
      "ds-milestone--edge-start",
      "ds-milestone--edge-end",
      "ds-milestone--edge-end",
    ],
  );
  assert.equal(
    milestoneModels([cards[0]], new Set(), 0, seen())[0].edgeClass,
    "ds-milestone--edge-end",
  );
  ok("里程碑卡片往內側展開，只有一站時也不會往右溢出");

  assert.equal(
    sectionStatus(cards, allIds, seen("one", "two", "three")),
    "這一段已完成。",
  );
  // A7：擋著的卡要指名，不能只講張數。學生站在最後一張、畫面顯示已完成，被告知
  // 「還有 2 張要做」等於叫他自己一張一張往回翻（VM 實測，跟段落閘門同一個毛病）。
  assert.equal(
    sectionStatus(cards, allIds, seen("one")),
    "還沒做完：「二」（第 2 張）、「三」（第 3 張）。",
  );
  assert.equal(
    sectionStatus(cards, new Set(["one"]), seen("one", "two")),
    "還沒做完：「二」（第 2 張）、「三」（第 3 張）。",
  );
  ok("段落狀態把擋著的卡指名出來，不是只講剩幾張");

  // 只講前兩張，後面用「等 N 張」帶過——列滿七張只會變成另一種看不懂，而且這一行
  // 擠在進度條上面，長了會換行把條推下去。
  const many = ["一", "二", "三", "四"].map((label, index) => ({
    kind: "config",
    checkId: `card-${index}`,
    label,
    check: { id: `card-${index}`, label, status: "missing", detail: "未完成" },
  }));
  const manyStatus = sectionStatus(
    many,
    new Set(),
    seen("card-0", "card-1", "card-2", "card-3"),
  );
  assert.ok(manyStatus.includes("「一」（第 1 張）"));
  assert.ok(manyStatus.includes("「二」（第 2 張）"));
  assert.ok(!manyStatus.includes("「三」"));
  assert.ok(manyStatus.includes("等 4 張"));
  ok("擋著的卡超過兩張時只點名前兩張，其餘講數量");

  // 沒有這個判準的話 renderWizard 與重查會互相呼叫成無限迴圈——alreadyDone 是唯一
  // 的煞車，而它必須連「正在跑東西」一起擋（跑到一半的狀態不是結論）。
  const atEnd = { sectionId: "rules", currentIndex: 2, cardCount: 3 };
  assert.equal(sectionEndRecheck(atEnd), "configs");
  assert.equal(sectionEndRecheck({ ...atEnd, sectionId: "env" }), "env");
  assert.equal(sectionEndRecheck({ ...atEnd, alreadyDone: true }), null);
  assert.equal(sectionEndRecheck({ ...atEnd, busy: true }), null);
  assert.equal(sectionEndRecheck({ ...atEnd, currentIndex: 1 }), null);
  assert.equal(
    sectionEndRecheck({ sectionId: "env", currentIndex: 0, cardCount: 0 }),
    null,
  );
  // ⚠️ 已完成的段落不查。VM 實測踩到的：卡片上寫著「這一段已完成。」，它還是
  // 重查了一次——環境段十三項併行 spawn，Windows 上 8.3 秒，純粹白跑。
  assert.equal(sectionEndRecheck({ ...atEnd, sectionDone: true }), null);
  // 資料還沒回來（undefined）要當成沒完成——那時重查正是我們要的。
  assert.equal(
    sectionEndRecheck({ ...atEnd, sectionDone: undefined }),
    "configs",
  );
  ok("只有站在最後一張、這段還沒完成、又沒別的事在跑時才自動重查");

  const checkingLine = {
    className: "ds-term-line ds-term-line--dim",
    text: "正在檢查目前狀態。",
  };
  const otherLine = {
    className: "ds-term-line ds-term-line--ok",
    text: "檢查完成。",
  };
  const once = appendTermLine([], checkingLine);
  assert.strictEqual(appendTermLine(once, checkingLine), once);
  assert.deepEqual(
    appendTermLine(appendTermLine(once, otherLine), checkingLine),
    [checkingLine, otherLine, checkingLine],
  );
  ok("終端白話只略過連續重複，中間有別行時仍會追加");

  // 輪詢重試時「正在檢查／失敗」交替出現，兩者都不連續，只擋連續重複會讓同一句
  // 錯誤洗滿終端（實測連出六次）。同一則失敗訊息全域只留一則。
  const failLine = {
    className: "ds-term-line ds-term-line--err",
    text: "環境檢查失敗：Failed to fetch",
  };
  const spam = [checkingLine, failLine, checkingLine].reduce(
    appendTermLine,
    [],
  );
  assert.deepEqual(appendTermLine(spam, failLine), spam);
  assert.equal(
    spam.filter((line) => line.text === failLine.text).length,
    1,
  );
  ok("同一則失敗訊息只記一次，不會被輪詢洗版");

  const groupedChecklist = checklistGroups({
    check: {
      id: "tab-sync",
      label: "終端標題同步",
      eyeCheck: "分頁標題已改變",
    },
    verified: false,
    verificationAttempted: true,
    verificationFailed: true,
    manualItems: [{ id: "gate", text: "開新終端" }],
    checkedManualIds: new Set(["eye-tab-sync"]),
  });
  assert.deepEqual(
    groupedChecklist.system.map(({ id, automatic }) => ({ id, automatic })),
    [{ id: "system-tab-sync", automatic: true }],
  );
  assert.deepEqual(
    groupedChecklist.manual.map(({ id, automatic }) => ({ id, automatic })),
    [
      { id: "eye-tab-sync", automatic: false },
      { id: "gate", automatic: false },
    ],
  );
  assert.equal(
    nextCardUnlocked({
      verificationRequired: true,
      verificationAttempted: true,
      manualItems: groupedChecklist.manual,
    }),
    false,
  );
  assert.equal(
    nextCardUnlocked({
      verificationRequired: true,
      verificationAttempted: true,
      manualItems: groupedChecklist.manual.map((item) => ({
        ...item,
        checked: true,
      })),
    }),
    true,
  );
  ok("checklist 正確分組，手動項全勾才解鎖且系統失敗不阻擋");

  assert.equal(groupedChecklist.system[0].disabled, true);
  assert(
    groupedChecklist.manual.every(({ disabled }) => disabled === false),
  );
  ok("系統 checklist 項帶 disabled，人工項保持可操作");

  const mergedCard = {
    kind: "env",
    checkId: "claude",
    detail: "安裝並登入 Claude Code，才能開始課堂任務。",
    checks: [
      { id: "claude", label: "Claude Code CLI", status: "ok", detail: "1.2.3" },
      {
        id: "claude-auth",
        label: "Claude Code 登入狀態",
        status: "warn",
        detail: "未登入",
      },
    ],
  };
  assert.equal(cardIsComplete(mergedCard), false);
  assert.equal(
    cardIsComplete({
      ...mergedCard,
      checks: mergedCard.checks.map((check) => ({ ...check, status: "ok" })),
    }),
    true,
  );
  ok("合併卡必須 CLI 與登入兩個 check 都通過才完成");

  // 假綠燈防線：按過安裝不等於裝好。伺服器仍回 missing 時，安裝按鈕必須留著可按，
  // 否則學生看到一顆灰掉的「✅ 安裝」和一個裝不起來的項目，連重試都沒得按
  // （VM 實測 gh 就是這樣）。
  const ghMissing = {
    id: "gh",
    label: "GitHub CLI",
    status: "missing",
    detail: "未安裝",
    installAction: "install-gh",
    fixAction: null,
  };
  const ghAuthBlocked = {
    id: "gh-auth",
    label: "GitHub 登入狀態",
    status: "missing",
    detail: "需要先安裝",
    installAction: null,
    fixAction: null,
  };
  assert.deepEqual(
    envCardRowModel(
      { kind: "env", checkId: "gh", checks: [ghMissing, ghAuthBlocked] },
      new Set(["gh"]),
    ).buttons.map(({ text, disabled }) => ({ text, disabled: !!disabled })),
    [{ text: "安裝", disabled: false }],
  );
  assert.deepEqual(
    envCardRowModel(
      {
        kind: "env",
        checkId: "gh",
        checks: [
          { ...ghMissing, status: "ok", detail: "gh 2.87.2" },
          { ...ghAuthBlocked, status: "warn", fixAction: "login-gh" },
        ],
      },
      new Set(["gh"]),
    ).buttons.map(({ text, disabled }) => ({ text, disabled: !!disabled })),
    // 裝好之後安裝鍵整顆收掉，只剩下一步該做的「開始登入」。
    [{ text: "開始登入", disabled: false }],
  );
  ok("裝好之後安裝按鈕消失，卡片上只剩下一步要做的事");

  // ⚠️ 沒有按鈕可按的那幾列，自救說明是唯一的出口。原本 envCardRowModel 根本不算
  // guidance（configRowModel 有算），於是「PowerShell 版本」「中文編碼」「Store 版」
  // 是黃燈、沒按鈕、也沒有任何文字告訴學生怎麼辦——完全的死路。
  const oldPowerShell = envCardRowModel(
    {
      kind: "env",
      checkId: "execution-policy",
      checks: [
        { id: "execution-policy", label: "執行原則", status: "ok", detail: "" },
        {
          id: "powershell-version",
          label: "PowerShell 版本",
          status: "warn",
          detail: "需要 PowerShell 5.1 或 7 以上",
        },
      ],
    },
    new Set(),
  );
  assert.notEqual(oldPowerShell.guidance, null);
  assert.ok(oldPowerShell.guidance.checks.length > 0);
  ok("黃燈又沒按鈕的那一列，卡片上帶得出自救步驟");

  // 全綠的卡不該掛一段自救說明——那是在解一個沒發生的問題。
  assert.equal(
    envCardRowModel(
      {
        kind: "env",
        checkId: "execution-policy",
        checks: [
          {
            id: "powershell-version",
            label: "PowerShell 版本",
            status: "ok",
            detail: "5.1.26100",
          },
        ],
      },
      new Set(),
    ).guidance,
    null,
  );
  ok("全綠時不掛自救說明");

  // 迴歸：envRowModel 裝好後不再給按鈕，envCardRowModel 少了 installed 判斷就會
  // 掉進「補一顆停用佔位」那支，反而長出灰色的「安裝」——比原本的「已安裝」更難解讀。
  assert(
    !envCardRowModel(
      {
        kind: "env",
        checkId: "node",
        checks: [
          {
            id: "node",
            label: "Node.js",
            status: "ok",
            detail: "v24",
            installAction: null,
            fixAction: null,
            hasInstaller: true,
          },
        ],
      },
      new Set(["node"]),
    ).buttons.some((button) => button.dataName === "installAction"),
    "裝好的項目不該補出停用的安裝佔位",
  );
  ok("裝好之後不會掉進佔位分支長出灰色的「安裝」");

  // 安裝鍵要掛回清單裡它負責的那一格（靠 checkId），不留在卡片底部的按鈕列——
  // 「CLI 未安裝」在清單裡、按鈕在清單外，學生得自己把兩者連起來（Reed 指定）。
  // 「開始登入」當初就是為了同一個理由搬進去的，兩顆現在一致。
  const stillMissing = envCardRowModel(
    { kind: "env", checkId: "gh", checks: [ghMissing, ghAuthBlocked] },
    new Set(["gh"]),
  ).buttons.find((button) => button.dataName === "installAction");
  assert.equal(stillMissing.checkId, "gh");
  ok("安裝按鈕帶著 checkId，畫在清單裡對應的那一格");

  // 迴歸（Windows VM 實測）：合併卡裡每一個可安裝的列都要有自己的安裝按鈕。
  //
  // 這裡原本只取第一個非登入的列當 primary，其餘列的安裝按鈕被過濾掉。環境卡合併
  // 之後三張卡都有兩個以上可安裝的列，於是 GitHub CLI、Python、終端機視窗全都拿不到
  // 按鈕——畫面上寫著「未安裝」卻沒有任何可按的東西。
  const installTargets = (card) =>
    envCardRowModel(card)
      .buttons.filter((button) => button.dataName === "installAction")
      .map((button) => button.checkId);

  // 版本控制與 GitHub：Git 已裝、gh 沒裝。gh 那列一定要有按鈕。
  assert.deepEqual(
    installTargets({
      kind: "env",
      checkId: "git",
      checks: [
        { id: "git", label: "Git", status: "ok", detail: "2.55.0" },
        ghMissing,
        ghAuthBlocked,
      ],
    }),
    ["gh"],
  );

  // Python 與 Node.js 是最糟的一個：Node 永遠已安裝，所以舊寫法的 primary 永遠指向
  // 一個不需要安裝的東西，Python 從頭到尾按不到。
  assert.deepEqual(
    installTargets({
      kind: "env",
      checkId: "node",
      checks: [
        { id: "node", label: "Node.js", status: "ok", detail: "v24" },
        {
          id: "python",
          label: "Python 3",
          status: "missing",
          detail: "未安裝",
          installAction: "install-python",
        },
      ],
    }),
    ["python"],
  );
  ok("合併卡裡每個可安裝的列都有自己的安裝按鈕");

  // 設定類項目（execution-policy）沒有 installer，它要的是「修正」。
  // 補一顆永遠按不下去的「安裝」只會讓學生問「安裝什麼？」（Reed 實測提問）。
  const policyCheck = {
    id: "execution-policy",
    label: "PowerShell 執行原則",
    status: "ok",
    detail: "目前是 RemoteSigned",
    installAction: null,
    fixAction: null,
    hasInstaller: false,
  };
  const policyCard = (check) => ({
    kind: "env",
    checkId: "execution-policy",
    checks: [check],
  });
  assert.deepEqual(
    envCardRowModel(policyCard(policyCheck), new Set(["execution-policy"])).buttons,
    [],
  );
  assert.deepEqual(
    envCardRowModel(
      policyCard({
        ...policyCheck,
        status: "warn",
        fixAction: "fix-execution-policy",
      }),
      new Set(),
    ).buttons.map(({ text }) => text),
    ["修正"],
  );
  ok("沒有 installer 的設定類項目不放安裝按鈕，只放修正");
  // 原本這裡有個對照組：有 installer 的項目裝好之後仍留一顆「已安裝」，用來跟
  // 設定類項目的「什麼都不放」對比。安裝鍵改成裝好就收掉之後，兩者的結果都是空的，
  // 對照不出東西——那個情境改由上面「不會掉進佔位分支」那條守住。

  assert.notEqual(mergedCard.detail, cardResultText(mergedCard));
  ok("卡片 description 與執行結果使用不同文字");

  // 合併卡有兩個檢查，結果要一項一行——串成一段的話兩件事會黏在一起。
  const resultItems = cardResultItems(mergedCard);
  assert.equal(resultItems.length, 2);
  assert.deepEqual(
    resultItems.map(({ label, value }) => ({ label, value })),
    mergedCard.checks.map((check) => ({
      label: check.label,
      value: check.detail,
    })),
  );
  assert(resultItems.every(({ value }) => !String(value).includes("；")));
  ok("執行結果一個檢查一項，不用分號串成一段");

  // 結果掛在自查清單每一項底下，不另外開一塊——名稱與結果分兩處講，讀的人要自己配對。
  const withResults = checklistGroups({
    checks: mergedCard.checks,
    verifiedCheckIds: new Set(),
    resultTexts: new Map([["claude", "2.1.220 (Claude Code)"]]),
  });
  assert.deepEqual(
    withResults.system.map(({ text, detail }) => ({ text, detail })),
    [
      { text: "Claude Code CLI", detail: "2.1.220 (Claude Code)" },
      { text: "Claude Code 登入狀態", detail: "未登入" },
    ],
  );
  ok("自查清單每一項底下就是那個檢查的執行結果");

  assert.deepEqual(
    [
      cardStatusModel(),
      cardStatusModel({ running: true }),
      cardStatusModel({ installed: true }),
      cardStatusModel({ awaitingMerge: true }),
      cardStatusModel({ completed: true }),
      cardStatusModel({ failed: true }),
    ].map(({ text, className }) => ({ text, className })),
    [
      { text: "未安裝", className: "ds-pill" },
      { text: "安裝中…", className: "ds-pill" },
      { text: "待驗證", className: "ds-pill" },
      { text: "等你合併", className: "ds-pill" },
      { text: "已完成", className: "ds-pill ds-pill-success" },
      { text: "失敗", className: "ds-pill card-status-danger" },
    ],
  );
  ok("status 徽章六種狀態對到正確文字與 class");

  // 迴歸（Reed 在 VM 上看到的）：那張卡上兩件事——另一份裝好也驗過了、CLAUDE.md
  // 等著合併——徽章卻寫「未安裝」。學生照著去按安裝，而安裝刻意不覆蓋，原地打轉。
  assert.equal(
    cardStatusModel({ installed: true, awaitingMerge: true }).text,
    "等你合併",
  );
  ok("同時「裝好了」與「等合併」時，講學生現在該做的那件");

  // 但已經完成或正在跑的時候不能被它蓋掉——那兩個是更即時的狀態。
  assert.equal(
    cardStatusModel({ awaitingMerge: true, completed: true }).text,
    "已完成",
  );
  assert.equal(
    cardStatusModel({ awaitingMerge: true, running: true }).text,
    "安裝中…",
  );
  ok("完成與進行中的狀態優先於「等你合併」");

  assert.deepEqual(sectionManualItems("rules", 0, 2, "claude"), []);
  // 規則段結尾原本有「關掉分頁、開新的」——拿掉了，規則段的驗證全部走
  // verify-in-terminal，它每次都自己開一個全新的終端視窗。
  assert.deepEqual(sectionManualItems("rules", 1, 2, "claude"), []);
  // demo 段前面那道「再開一次新的分頁」也拿掉了：技能包與 demo 的驗證全部走
  // verify-in-terminal，它每次都自己開一個全新的終端視窗，skill 一定載入過。
  assert.deepEqual(sectionManualItems("skills", 1, 2, "claude,codex"), []);
  ok("段落閘門已全數移除——驗證自己會開新的終端視窗");

  // codex 的信任提示原本是一格勾選框，後來改成卡片上照原樣印出那兩題，現在整塊
  // 搬進「怎麼做」彈窗——那裡每一題各一步，有畫面示意也寫了要選哪一個。卡片上
  // 再印一次是同一件事講兩遍。
  assert.deepEqual(
    sectionManualItems("rules", 0, 5, "claude,codex", "codex-namer"),
    [],
  );
  assert.deepEqual(CARD_HINTS, {});
  ok("codex 的兩題搬進彈窗，卡片上不再多一格勾選框也不再印一次");

  // 失敗時白話區印的是腳本自己講的那句話，不是罐頭句。
  //
  // 迴歸（Reed 實測截圖）：安裝擋下來的理由是「Obsidian 現在開著，請先完全關掉它
  // 再按一次安裝」，那句話只出現在原始輸出與那一列的說明裡，白話區卻寫「請檢查
  // 原始輸出後再試一次」——把學生推去讀一堆他看不懂的東西，而答案就在裡面。
  const withReason = terminalOutcomeLines({
    action: "install-config-step",
    succeeded: false,
    check: { label: "接到 GitHub 的筆記庫" },
    guidance: null,
    reason: "Obsidian 現在開著，請先完全關掉它再按一次安裝",
  });
  assert.equal(withReason.length, 1);
  assert.equal(withReason[0].text, "Obsidian 現在開著，請先完全關掉它再按一次安裝");
  // 腳本沒講話時才退回罐頭句。
  const withoutReason = terminalOutcomeLines({
    action: "install-config-step",
    succeeded: false,
    check: { label: "接到 GitHub 的筆記庫" },
    guidance: null,
  });
  assert.match(withoutReason[0].text, /請檢查原始輸出/);
  ok("安裝失敗時白話區印腳本自己講的那句話，沒講才退回罐頭句");

  // 清單第一格該不該打勾——三種情況各錯過一次，所以三種都釘住。
  const okRow = { id: "x", label: "x", status: "ok", detail: "" };
  assert.equal(
    systemRowChecked(okRow, { rowVerified: true, behaviorVerified: false }),
    true,
  );
  // 有眼睛勾選框的列不會變成 ok，但程式那半確實過了——第一格要立刻反映。
  const eyeRow = { ...okRow, eyeCheck: "看畫面" };
  assert.equal(
    systemRowChecked(eyeRow, { rowVerified: false, behaviorVerified: true }),
    true,
  );
  assert.equal(
    systemRowChecked(eyeRow, { rowVerified: false, behaviorVerified: false }),
    false,
  );
  // 驗過之後檔案又壞了（needsMerge / 被改掉）：不能再照著上一輪的結論打勾，
  // 否則畫面會是「1/1 全綠卻沒有下一張」（VM 實測 codex-config）。
  const mergeRow = { ...okRow, status: "warn", detail: "已有你自己的版本，需要合併" };
  assert.equal(
    systemRowChecked(mergeRow, { rowVerified: false, behaviorVerified: true }),
    false,
  );
  ok("程式驗過的勾，只在那一列現在還是好的時候才算數");

  // 安裝與驗證是兩件事，跑起來的時候畫面也要分開講。原本只有一個 running 狀態，
  // 按「重跑驗證」時徽章寫「安裝中…」、終端寫「正在安裝」——學生只是想再驗一次
  // （Reed 實測 claude-namer）。
  assert.equal(cardStatusModel({ running: true }).text, "安裝中…");
  assert.equal(
    cardStatusModel({ running: true, verifying: true }).text,
    "驗證中…",
  );
  assert.equal(isVerifyAction("verify-in-terminal"), true);
  assert.equal(isVerifyAction("install-config-step"), false);
  // 登入、開視窗那些兩者都不是，不能被當成驗證。
  assert.equal(isVerifyAction("login-claude"), false);
  assert.equal(isVerifyAction(""), false);
  ok("安裝中與驗證中是兩種狀態，靠 action 前綴分");

  // verify-in-terminal 沒有自己的動畫，會落回 working 那顆——而那顆的預設字是
  // 「正在安裝」。字要跟著動作走，不是跟著動畫走。
  assert.equal(
    loaderLabel({
      action: "verify-in-terminal",
      modifier: LOADER_MODIFIERS.working,
    }),
    "正在驗證，完成後會自動更新。",
  );
  assert.equal(
    loaderLabel({
      action: "install-config-step",
      modifier: LOADER_MODIFIERS.working,
    }),
    null,
  );
  // 其他動畫本來就有對的字，不要蓋掉。
  assert.equal(
    loaderLabel({
      action: "verify-in-terminal",
      modifier: LOADER_MODIFIERS.listening,
    }),
    null,
  );
  ok("借用安裝那顆動畫的驗證，字改講驗證");

  // 同一張清單裡兩種項目並存時才加前綴：第一格講的是程式查得到的結構，第二格是
  // 學生要自己看的畫面。原本兩格共用一種句型，學生看到檔案明明都在卻沒打勾。
  const mixedGroups = checklistGroups({
    checks: [{ ...eyeRow, label: "自動命名 hook", detail: "檔案與註冊都在" }],
    verifiedCheckIds: new Set(),
  });
  assert.match(mixedGroups.system[0].text, /^程式檢查：/);
  assert.match(mixedGroups.manual[0].text, /^你要看的：/);
  // 整張都是程式檢查的卡不加前綴——每一行都掛「程式檢查：」只是噪音。
  const systemOnly = checklistGroups({
    checks: [{ id: "node", label: "Node.js", status: "ok", detail: "20.x" }],
    verifiedCheckIds: new Set(),
  });
  assert.equal(systemOnly.system[0].text, "Node.js");
  ok("程式檢查與眼睛確認並存時才加前綴，分清楚哪一格是誰的事");

  // ⚠️ 筆記那兩張的「驗證」格要整個消失。它的 expect 回 null（沒有可輪詢的落點），
  // 腳本開完視窗就 exit 0，而 verify-in-terminal 在 AUTO_VERIFY_ACTIONS 裡——拆出來
  // 的那一格會在視窗剛開的瞬間就打勾，而 AI 才剛開始做事（VM 實測）。
  for (const id of EYE_ONLY_VERIFY) {
    const eyeOnly = checklistGroups({
      checks: [
        {
          id,
          label: "叫 AI 寫一篇進去",
          detail: "按右邊開終端跑一次",
          eyeCheck: "GitHub 上看得到你的改動歷史",
          verifyAction: "verify-in-terminal",
        },
      ],
      verifiedCheckIds: new Set(),
    });
    assert.equal(eyeOnly.system.length, 1, `${id} 不該拆成安裝／驗證兩格`);
    assert.ok(!eyeOnly.system[0].text.startsWith("驗證："));
    assert.equal(eyeOnly.manual.length, 1, `${id} 的眼睛那格要留著`);
  }
  ok("沒有可輪詢落點的那幾列不長「驗證」格，判定交給眼睛那一格");

  // 結構都對了卻還沒打勾的那一格，要說清楚它在等什麼——不然畫面是「都已生效」
  // 配一個空格，看起來像壞掉。
  const notRunYet = checklistGroups({
    checks: [
      {
        ...eyeRow,
        label: "自動命名 hook",
        detail: "hook 檔案與 3 筆註冊都已生效",
        verifyAction: "verify-in-terminal",
      },
    ],
    verifiedCheckIds: new Set(),
  });
  // 有自動驗證的檢查拆成兩格：第一格「安裝」、第二格「驗證」。
  assert.deepEqual(
    notRunYet.system.map(({ id, text, checked }) => ({ id, text, checked })),
    [
      { id: "install-x", text: "安裝：自動命名 hook", checked: true },
      { id: "system-x", text: "驗證：自動命名 hook", checked: false },
    ],
  );
  // 安裝那一格講安裝的事，驗證那一格講它在等什麼——兩句話不再擠在同一格。
  assert.equal(notRunYet.system[0].detail, "hook 檔案與 3 筆註冊都已生效");
  assert.match(notRunYet.system[1].detail, /還沒實際跑跑看/);
  const ranAlready = checklistGroups({
    checks: [
      {
        ...eyeRow,
        label: "自動命名 hook",
        detail: "hook 檔案與 3 筆註冊都已生效",
        verifyAction: "verify-in-terminal",
      },
    ],
    verifiedCheckIds: new Set(["x"]),
  });
  assert.doesNotMatch(ranAlready.system[1].detail, /還沒實際跑跑看/);
  ok("安裝與驗證各自一格，驗證那格會說自己在等什麼");

  // 迴歸（VM 實測）：安裝成功了，「安裝」那一格要當場打勾，不等驗證跑完、也不等
  // 下一次伺服器檢查回來。原本兩件事共用一個勾，畫面停在空格 + 上一次留下的
  // 「尚未安裝」，學生看到的是「我明明裝好了，它說沒裝」。
  const justInstalled = checklistGroups({
    checks: [
      {
        ...eyeRow,
        label: "自動命名 hook",
        status: "missing",
        detail: "尚未安裝",
        verifyAction: "verify-in-terminal",
      },
    ],
    verifiedCheckIds: new Set(),
    installedCheckIds: new Set(["x"]),
  });
  assert.equal(justInstalled.system[0].checked, true);
  assert.equal(justInstalled.system[1].checked, false);
  ok("剛按完安裝：安裝那格當場打勾，驗證那格還空著");

  // ⚠️ 同一格的勾與說明不能互相打架。勾來自本次的樂觀記憶，說明來自上一次檢查——
  // 安裝完接著跑驗證的那幾秒，畫面上是綠勾配一句「尚未安裝」（Reed 在畫面前抓到的
  // auto-rename）。勾是對的，過期的是那句話。
  assert.doesNotMatch(justInstalled.system[0].detail, /尚未安裝/);
  assert.match(justInstalled.system[0].detail, /已安裝/);
  ok("剛裝完那一格不會綠勾配「尚未安裝」");

  // ⚠️ 只換掉 missing 那種。warn 講的是別的事（例如舊的 service_tier 還在，而那句
  // 話正指著學生該按的按鈕），換掉會把真正該讀的訊息蓋掉。
  const staleButInstalled = checklistGroups({
    checks: [
      {
        ...eyeRow,
        label: "Codex 的規矩",
        status: "warn",
        detail: '舊的 service_tier = "default" 還在',
        verifyAction: "verify-in-terminal",
      },
    ],
    verifiedCheckIds: new Set(),
    installedCheckIds: new Set(["x"]),
  });
  assert.match(staleButInstalled.system[0].detail, /service_tier/);
  ok("warn 那種說明留著，不會被「已安裝」蓋掉");

  // ⚠️ 這句不可以寫死「重跑驗證」：那顆按鈕沒驗過時叫「驗證」，而這句話出現的時機
  // 正是還沒驗過。指名一個當下不存在的字，學生會在畫面上找一顆不存在的按鈕。
  assert.ok(!notRunYet.system[1].detail.includes("重跑驗證"));
  assert.match(notRunYet.system[1].detail, /這一列的驗證鍵/);
  ok("等驗證那句話指得到當下真的存在的那顆按鈕");

  // 沒有自動驗證的檢查不拆——硬拆會長出一格永遠不知道該不該打勾的東西。
  assert.equal(systemOnly.system.length, 1);
  assert.equal(systemOnly.system[0].id, "system-node");
  ok("沒有自動驗證的檢查維持單格");

  // 迴歸（VM 實測，合併卡的第一列）：合併卡的驗證掛在最後那一份身上，前半份沒有
  // verifyAction、不會被拆——但它那一格講的就是「這件事成了沒」，而唯一的達成方式
  // 就是安裝。剛裝完也要當場打勾，不然畫面是「終端印安裝成功、這一列寫尚未安裝」。
  const mergedFirstHalf = checklistGroups({
    checks: [
      {
        id: "claude-md",
        label: "Claude Code CLI 做事的規矩",
        status: "missing",
        detail: "尚未安裝",
      },
    ],
    verifiedCheckIds: new Set(),
    installedCheckIds: new Set(["claude-md"]),
  });
  assert.equal(mergedFirstHalf.system.length, 1);
  assert.equal(mergedFirstHalf.system[0].checked, true);
  ok("沒有自動驗證的列，剛裝完也當場打勾");

  // 驗過之後檔案被動過：勾留著，補一句提醒。改的可能是學生自己那半（合併過的
  // CLAUDE.md，工作坊那段還在所以檢查照樣說 ok），程式看不出來會不會影響驗過的
  // 行為——這種情況值得提醒，不值得直接作廢。
  const changed = checklistGroups({
    checks: [{ id: "claude-md", label: "CLAUDE.md", status: "ok", detail: "已安裝" }],
    verifiedCheckIds: new Set(["claude-md"]),
    changedCheckIds: new Set(["claude-md"]),
  });
  assert.equal(changed.system[0].checked, true);
  assert.match(changed.system[0].detail, /在你驗證之後被改過/);
  // 沒被動過就不要多那句話。
  const untouched = checklistGroups({
    checks: [{ id: "claude-md", label: "CLAUDE.md", status: "ok", detail: "已安裝" }],
    verifiedCheckIds: new Set(["claude-md"]),
  });
  assert.doesNotMatch(untouched.system[0].detail, /被改過/);
  // 還沒驗過的那一格不講這句：它要的是「按重跑驗證」，不是「要不要再驗一次」。
  const notVerified = checklistGroups({
    checks: [{ id: "claude-md", label: "CLAUDE.md", status: "ok", detail: "已安裝" }],
    verifiedCheckIds: new Set(),
    changedCheckIds: new Set(["claude-md"]),
  });
  assert.doesNotMatch(notVerified.system[0].detail, /被改過/);
  ok("驗過之後被動過的那一格：勾留著，多一句提醒");

  // 沒有眼睛項的列：程式驗過了就是整列過了，不必等第二本帳也寫成功。
  //
  // VM 實測 ext-playwright-claude 只寫進 behavior、沒寫進 verified，於是清單那格
  // 打勾、徽章卻是待驗證，學生被要求重跑一次要開瀏覽器的驗證。旁邊 codex 那筆差
  // 128 毫秒、兩本都成功——同一段程式，一次成功一次沒有。
  const behaviorOnly = new Set(["ext-playwright-claude", "claude-namer"]);
  assert.deepEqual(
    [
      ...impliedVerifiedSteps(
        [
          { id: "ext-playwright-claude", eyeCheck: null },
          // 有眼睛項的列不算：那種列的「整列過了」本來就要學生看完說了算。
          { id: "claude-namer", eyeCheck: "分頁標題變成…" },
          { id: "hook", eyeCheck: null },
        ],
        behaviorOnly,
      ),
    ],
    ["ext-playwright-claude"],
  );
  ok("沒有眼睛項的列，程式驗過就等於整列過了");

  // 反過來，有眼睛項的列要兩半都成立。原本只要學生勾眼睛就算整列過——他可以完全
  // 不跑驗證直接勾，卡片變成已完成並長出「下一張」，清單卻還停在 1 / 2
  //（VM 實測 skill-claude-handoff）。
  const eyeChecks = [
    { id: "skill-claude-handoff", eyeCheck: "標題變成 📦…", verifyAction: "verify-in-terminal" },
    // 沒有程式那半可跑的列不在此限：只有學生看得到，勾了就是過了。
    { id: "look-only", eyeCheck: "看畫面", verifyAction: null },
  ];
  const ticked = new Set(["eye-skill-claude-handoff", "eye-look-only"]);
  assert.deepEqual(
    [...eyeVerifiedSteps(eyeChecks, ticked, new Set())],
    ["look-only"],
  );
  assert.deepEqual(
    [...eyeVerifiedSteps(eyeChecks, ticked, new Set(["skill-claude-handoff"]))],
    ["skill-claude-handoff", "look-only"],
  );
  // 沒勾眼睛的話，程式那半過了也不算整列過。
  assert.deepEqual(
    [...eyeVerifiedSteps(eyeChecks, new Set(), new Set(["skill-claude-handoff"]))],
    [],
  );
  ok("有眼睛項的列要兩半都成立：程式跑過，而且學生看過");

  // 行為驗證逐條判定五條規則，腳本每判完一條就送一個事件。原本這些事件只拿來換
  // 轉圈圈的動畫，畫面上只留一句「驗證成功」——學生不知道驗了什麼、也不知道是不是
  // 全過（Reed 實測就是這樣問的）。
  assert.deepEqual(
    behaviorRuleLine({ kind: "rule", name: "結論先行", pass: true }),
    { text: "　✓ 結論先行", className: "ds-term-line ds-term-line--ok" },
  );
  // 沒過的那條要說為什麼——門檻是「五條中過幾條」，所以通過的那次也可能有沒過的。
  assert.deepEqual(
    behaviorRuleLine({
      kind: "rule",
      name: "比較用表格",
      pass: false,
      reason: "用了條列",
    }),
    {
      text: "　✗ 比較用表格——用了條列",
      className: "ds-term-line ds-term-line--err",
    },
  );
  assert.equal(behaviorRuleLine({ kind: "stage", stage: "judging" }), null);
  assert.equal(behaviorRuleLine(null), null);
  ok("逐條判定的結果印成一行，沒過的那條附上原因");

  assert.equal(
    behaviorTally([{ pass: true }, { pass: true }, { pass: false }]).text,
    "3 條規則中通過 2 條。",
  );
  assert.match(
    behaviorTally([{ pass: true }]).className,
    /ds-term-line--ok/,
  );
  ok("判完之後說總共過幾條");

  // 全螢幕那三格其實是兩步：前兩件在同一個視窗做完，第三件要另一個視窗（終端裡
  // 得先有一行代碼才圈選得到）。原本畫成「三格 + 兩顆不知道對應誰的按鈕」，學生
  // 要自己配對（Reed 實測）。
  const fullscreenSteps = manualStepGroups(
    sectionManualItems("env", 0, 3, "claude", "claude"),
  );
  assert.deepEqual(
    fullscreenSteps.map(({ id, buttonText, items }) => ({
      id,
      buttonText,
      ids: items.map((item) => item.id),
    })),
    [
      {
        id: "fullscreen-open",
        buttonText: "開啟 Claude Code",
        ids: ["fullscreen-yes", "fullscreen-mouse"],
      },
      {
        id: "fullscreen-proof",
        buttonText: "開啟並送出測試句",
        ids: ["fullscreen-copy"],
      },
    ],
  );
  ok("全螢幕三格照兩步分組，每一步配自己的按鈕");

  // 沒有 stepId 的人工項目（段落閘門那種）不長出標題，照原樣排成一組。
  const plain = manualStepGroups([{ id: "a", text: "隨便一格" }]);
  assert.equal(plain.length, 1);
  assert.equal(plain[0].title, null);
  assert.equal(plain[0].action, null);
  ok("沒有分步的人工項目不會被硬塞一個標題");

  // 檔案已經是學生自己的版本時，安裝刻意不覆蓋，腳本什麼都沒做就 exit 0。
  // 照著 exit code 印「安裝成功，已完成」是騙人的——列上還寫著「需要合併」。
  const mergeOutcome = terminalOutcomeLines({
    action: "install-config-step",
    succeeded: true,
    check: { label: "Codex config.toml", needsMerge: true },
  });
  assert.doesNotMatch(mergeOutcome[0].text, /安裝成功/);
  assert.match(mergeOutcome[0].text, /沒有覆蓋/);
  assert.match(mergeOutcome[0].text, /用 AI 合併/);
  // ⚠️ 不寫死「重跑驗證」：那顆沒驗過時叫「驗證」，而這句話出現的時機正是還沒驗過。
  assert.ok(!mergeOutcome[0].text.includes("重跑驗證"));
  assert.match(mergeOutcome[0].text, /這一列的驗證鍵/);
  // 設計系統只有 prompt / ok / err，用不存在的 class 只會靜靜地沒有樣式。
  assert.match(mergeOutcome[0].className, /ds-term-line--(prompt|ok|err)$/);
  ok("需要合併的列不印假的「安裝成功」，改成講下一步");

  // 一般的列不受影響，仍然報安裝成功。
  const normalOutcome = terminalOutcomeLines({
    action: "install-config-step",
    succeeded: true,
    check: { label: "行為規則 CLAUDE.md" },
  });
  assert.match(normalOutcome[0].text, /安裝成功/);
  ok("沒有需要合併的列照常報安裝成功");

  assert.deepEqual(
    terminalOutcomeLines({
      action: "install-config-step",
      succeeded: true,
      check: { label: "規則檔" },
    }),
    [
      {
        className: "ds-term-line ds-term-line--ok",
        text: "✅ 安裝成功，已完成規則檔。",
      },
    ],
  );
  const failedTerminal = terminalOutcomeLines({
    action: "verify-behavior",
    succeeded: false,
    check: { label: "回覆格式" },
    guidance: {
      symptom: "跑 `echo a && echo b` 時格式不對",
      expected: "第一行是結論",
      checks: ["重新開啟終端"],
    },
  });
  assert.equal(failedTerminal[0].className, "ds-term-line ds-term-line--err");
  assert.match(failedTerminal[0].text, /格式不對/);
  assert.doesNotMatch(failedTerminal[0].text, /echo a/);
  assert(failedTerminal.some((line) => line.text.includes("第一行是結論")));
  ok("終端成功與失敗都產生中文白話 class 與文案");

  // 程式驗不到的那一格要明講看什麼，不能只留一個空的勾選框。
  const eyeOnly = configRowModel({
    id: "tab-sync",
    label: "終端機標題同步",
    status: "ok",
    detail: "已安裝",
    installAction: null,
    mergeAction: null,
    verifyAction: null,
    eyeCheck: "看分頁標題有沒有變",
  });
  assert.equal(eyeOnly.status, "unverified");
  assert.equal(eyeOnly.eyeCheck, "看分頁標題有沒有變");
  assert(
    !eyeOnly.buttons.some((button) => button.text === "驗證"),
    "驗不到的列不該給一顆按了也證明不了什麼的驗證按鈕",
  );
  ok("只能靠眼睛的列附上要看什麼，且不給驗證按鈕");

  // 兩張表分別住在 src/config-check.js 與 public/viewmodel.js，對不上的話那一列
  // 永遠停在待驗證——沒有錯誤訊息，只是永遠不會變綠。
  for (const [step, entry] of Object.entries(VERIFICATION)) {
    if (entry.behavior === undefined) continue;
    assert(
      AUTO_VERIFY_ACTIONS.has(entry.behavior),
      `${step} 用 ${entry.behavior} 驗，但它不在會自動標綠的清單裡——那一列永遠不會變綠`,
    );
  }
  ok("會自動標綠的驗證動作跟各列宣告的對得上");

  // 行為驗證是整份嚮導最慢最貴的一步（每次兩趟 LLM：先問一題、再把回答餵回去逐條
  // 判定），而格式規則在兩份檔案裡各有一份——四列各驗一次等於同一個測試跑四遍。
  // 一個 agent 剛好一列，多了是浪費、少了那個 agent 就沒有行為驗證。
  const behaviorRows = Object.entries(VERIFICATION).filter(
    ([, entry]) => entry.behavior !== undefined,
  );

  for (const tools of ["claude", "codex"]) {
    const owned = behaviorRows.filter(
      ([, entry]) => entry.options?.tools === tools,
    );
    assert.equal(
      owned.length,
      1,
      `${tools} 應該剛好有一列做行為驗證，現在有 ${owned.length} 列：${owned
        .map(([step]) => step)
        .join(", ")}`,
    );
  }
  // 掛在「有開關、會靜默失效」的那一列：CLAUDE.md / AGENTS.md 放著就讀，結構對
  // 就是生效；output-style 要 settings.json 啟用、config.toml 要 Codex 讀到，
  // 沒生效時兩者都不會報錯。
  assert.deepEqual(
    behaviorRows.map(([step]) => step).sort(),
    ["codex-config", "output-style"],
  );
  ok("每個 agent 剛好一列做行為驗證，且掛在會靜默失效的那一列");

  // 開終端驗證分兩種：抓得到副產物的自動判定，抓不到的才給勾選框。給了勾選框
  // 就一定要寫明要看什麼，否則學生看著視窗不知道該看哪裡，只能亂勾。
  for (const [step, entry] of Object.entries(VERIFICATION)) {
    if (entry.terminal === undefined) continue;
    assert(
      entry.behavior === undefined,
      `${step} 同時掛了兩種驗證，畫面會冒出兩顆按鈕`,
    );

    if (entry.eye !== undefined) {
      assert(
        typeof entry.eye === "string" && entry.eye.length > 0,
        `${step} 給了勾選框，卻沒寫要看什麼`,
      );
    }
  }
  ok("要學生用眼睛驗的列都寫明了要看什麼");

  // 列上的按鈕少帶一個參數，伺服器就回「options.X 不在允許的值裡」，按鈕等於是死
  // 的——而且畫面上只看得到一行錯誤，看不出少的是哪個。逐列拿 actions 自己宣告的
  // schema 對賬：那一列會送出的參數，必須覆蓋它要按的 action 所宣告的每一個。
  const rowSends = [
    ...Object.entries(VERIFICATION).map(([step, entry]) => ({
      step,
      action: entry.behavior ?? "verify-in-terminal",
      extra: entry.terminal ?? entry.options ?? null,
    })),
    { step: "claude-md", action: "install-config-step", extra: null },
    { step: "claude-md", action: "merge-in-terminal", extra: null },
    { step: "codex-config", action: "merge-in-terminal", extra: null },
    { step: "codex-config", action: "restore-merge-backup", extra: null },
  ];

  for (const { step, action, extra } of rowSends) {
    const options = rowRunOptions({
      step,
      lang: "zh-TW",
      tools: "claude",
      extra,
    });

    for (const [name, allowed] of Object.entries(
      ACTIONS[action].options ?? {},
    )) {
      assert(
        allowed.includes(options[name]),
        `${step} 按 ${action} 時的 options.${name} 是「${options[name]}」，不在允許清單裡`,
      );
    }
  }
  ok("每一列送出的參數都覆蓋且符合該 action 宣告的 schema");

  assert.deepEqual(configSummary([]), {
    done: 0,
    total: 0,
    allOk: false,
    text: "尚未檢查",
  });
  ok("空的規則檔檢查顯示尚未檢查");

  assert.deepEqual(
    configSummary([{ status: "ok" }, { status: "warn" }]),
    {
      done: 1,
      total: 2,
      allOk: false,
      text: "2 項中 1 項就緒",
    },
  );
  ok("規則檔摘要算出部分完成數量");

  assert.deepEqual(extractLoginHints("請開 https://example.com/device 並輸入"), {
    url: "https://example.com/device",
    code: null,
  });
  assert.equal(
    extractLoginHints("網址是 https://example.com/device.").url,
    "https://example.com/device",
  );
  ok("網址結尾的標點不會被當成網址的一部分");

  assert.equal(extractLoginHints("代碼：ABCD-1234").code, "ABCD-1234");
  assert.deepEqual(extractLoginHints(null), { url: null, code: null });
  ok("認得出裝置代碼，非字串輸入不會炸");

  const loginChecks = [{ id: "codex-auth" }];
  // 兩種登入長得不一樣：codex 走裝置碼（先給代碼），Claude 走純瀏覽器授權
  // （不給代碼，但網頁授權完會給一串授權碼要貼回終端）。輸入格若綁在「有沒有
  // 撈到代碼」上，Claude 那張卡就沒有地方貼，學生走到一半卡死（VM 實測）。
  assert.deepEqual(
    loginCardModel({
      checks: [{ id: "claude-auth" }],
      hints: { url: "https://claude.ai/oauth", code: null },
      acceptsInput: true,
      runInProgress: true,
      runId: "run-1",
    }),
    {
      action: "login-claude",
      linkText: "開啟 Anthropic 授權頁",
      authCheckId: "claude-auth",
      url: "https://claude.ai/oauth",
      code: null,
      showLink: true,
      showCode: false,
      showInput: true,
    },
  );
  ok("沒有裝置代碼的登入（Claude）一樣要有貼回授權碼的輸入格");

  assert.deepEqual(
    loginCardModel({
      checks: loginChecks,
      hints: { url: "https://example.com", code: "ABCD-1234" },
      acceptsInput: true,
      runInProgress: true,
      runId: "run-1",
    }),
    {
      action: "login-codex",
      // codex 一定會自己開瀏覽器（不吃 BROWSER，--device-auth 要帳號層級開關），
      // 所以連結是備援不是主要入口，文案與樣式都跟另外兩個服務不同。
      linkText: "瀏覽器沒開？點這裡開啟 OpenAI 授權頁",
      autoOpens: true,
      authCheckId: "codex-auth",
      url: "https://example.com",
      code: "ABCD-1234",
      showLink: true,
      showCode: true,
      showInput: true,
    },
  );
  assert.equal(
    loginCardModel({
      checks: loginChecks,
      hints: { url: null, code: "ABCD-1234" },
      acceptsInput: false,
      runInProgress: true,
      runId: "run-1",
    }).showInput,
    false,
  );
  ok("複製區只在撈到代碼時出現；輸入格看的是程序還活著且吃得下 stdin");

  assert.equal(isLoginAction("login-claude"), true);
  assert.equal(isLoginAction("install-claude"), false);
  assert.equal(agentNameFor("claude-free"), "Claude");
  assert.equal(agentNameFor("codex-hello"), "Codex");
  // 合併那顆跟著第一張卡的工具選擇走：只要 Codex 的學生機器上沒有 claude。
  assert.equal(agentNameFor("merge-config-step", "codex"), "Codex");
  assert.equal(agentNameFor("merge-config-step", "claude"), "Claude");
  // 兩個都選時優先 Claude——它是課堂主線，而且它那邊裝好的 acceptEdits 讓合併
  // 不會停下來問。
  assert.equal(agentNameFor("merge-config-step", "claude,codex"), "Claude");
  // 名字要跟實際跑的那一支對得上（見 actions.js 的 engine）。少改一處的話，Codex
  // 那張卡的終端會印著「Claude：思考中…」。
  assert.equal(
    agentNameFor("merge-config-step", "claude,codex", "codex-config"),
    "Codex",
  );
  assert.equal(
    agentNameFor("merge-config-step", "claude,codex", "claude-md"),
    "Claude",
  );
  assert.equal(agentNameFor("merge-config-step", "claude", "codex-config"), "Claude");
  assert.equal(agentNameFor("merge-config-step"), "Claude");
  assert.equal(agentNameFor("hello"), "");
  ok("能從 action 名稱判斷類型與代理名稱");

  const missing = envRowModel({
    id: "gh",
    label: "GitHub CLI",
    status: "missing",
    detail: "未安裝",
    installAction: "install-gh",
    fixAction: null,
  });
  assert.equal(missing.symbol, "✗");
  assert.deepEqual(
    missing.buttons.map((button) => button.text),
    ["安裝"],
  );
  ok("缺少的項目給一顆安裝按鈕");

  const policy = envRowModel({
    id: "execution-policy",
    label: "PowerShell 執行原則",
    status: "warn",
    detail: "目前是 Restricted",
    installAction: null,
    fixAction: "fix-execution-policy",
  });
  assert.deepEqual(
    policy.buttons.map((button) => button.text),
    ["修正"],
  );
  const auth = envRowModel({
    id: "gh-auth",
    label: "GitHub 登入狀態",
    status: "warn",
    detail: "未登入",
    installAction: null,
    fixAction: "login-gh",
  });
  assert.deepEqual(
    auth.buttons.map((button) => button.text),
    ["開始登入"],
  );
  ok("執行原則是「修正」、登入狀態是「開始登入」");

  // 迴歸：這張對照表原本只有 execution-policy 一個特例，其他一律「開始登入」——
  // 新加的 shell-wrapper 那一列於是長出一顆寫著「開始登入」的清除鍵。
  // 文字改由那一列自己給，因為它要指名壞掉的是 claude 還是 codex。
  const wrapper = envRowModel({
    id: "shell-wrapper",
    label: "終端機裡的 claude / codex 是活的",
    status: "warn",
    detail: "你的設定檔裡有一個 codex，指到一個已經不在的檔案",
    installAction: null,
    fixAction: "fix-shell-wrapper",
    fixLabel: "清除廢棄的 codex 引用",
  });
  assert.deepEqual(
    wrapper.buttons.map((button) => button.text),
    ["清除廢棄的 codex 引用"],
  );
  assert.equal(wrapper.buttons[0].checkId, "shell-wrapper");
  ok("那一列自己給了 fixLabel 時，按鈕就用它的文字");

  // 守門：走訪後端所有可能掛出來的修復鍵，確認沒有一顆是「掉進預設值」才對的。
  // 預設值現在是「修正」（通用、講錯了也還算通順），但預設值本身不是答案——
  // 新加一顆修復鍵就要在這裡決定它該說什麼，不能靠 fallback 蒙混過去。
  //
  // 這支測試是為了擋 fix-shell-wrapper 那次：它沒對到表，於是清除鍵上寫著
  // 「開始登入」，測試全綠、只有真的開起來才看得到。
  const NEEDS_ROW_LABEL = new Set([
    "fix-shell-wrapper",
    "fix-codex-sandbox",
    // 沙箱拆成兩列之後多的那一顆。文字由那一列自己給（「開終端設定沙箱」），
    // 因為它跟接檔案那顆長得很像，只有寫清楚「開終端」學生才知道會發生什麼事。
    "setup-codex-sandbox",
    "fix-legacy-skills",
    "fix-legacy-cli",
    // ⚠️ 這一顆是安裝器（INSTALLERS 的 pwsh-store），但掛在 fixAction 上
    // ——那一列是黃燈不是紅燈，走不到 installAction 那條路。文字由那一列自己
    // 給（「換成一般安裝版」），不是預設的「安裝」。
    "install-pwsh-store",
  ]);

  for (const [checkId, resolve] of Object.entries(FIX_ACTIONS)) {
    for (const status of ["ok", "warn", "missing"]) {
      // 有幾列的按鈕不只看 status（npm 殘留那列同樣是黃燈，但「只有 npm 版」時
      // 不能給清理鍵）。這裡餵一個「該有按鈕」的形狀，讓那幾顆也走得到守門。
      const fixAction = resolve(status, { status, fixLabel: "（測試用）" });

      if (fixAction === null) {
        continue;
      }

      assert.ok(
        Object.hasOwn(FIX_BUTTON_TEXT, fixAction) ||
          NEEDS_ROW_LABEL.has(fixAction),
        `${fixAction} 沒人決定按鈕上要寫什麼——加進 FIX_BUTTON_TEXT，` +
          `或讓那一列自己回 fixLabel 並登記在 NEEDS_ROW_LABEL`,
      );

      // 「開始登入」只准出現在真的是登入的那幾顆上。
      const text = fixButtonText({ id: checkId, fixAction });
      assert.equal(
        isLoginAction(fixAction),
        text === "開始登入",
        `${fixAction} 的按鈕文字與它是不是登入動作對不起來`,
      );
    }
  }
  ok("後端掛得出來的每一顆修復鍵都有人決定過按鈕文字");

  // ⚠️ 同一列不准同時掛得出「安裝」與「修復」——兩顆的落點都是 system-<id>，畫出來
  // 就是同一格裡兩顆按鈕，而學生分不出該按哪一顆。
  //
  // 這條是 2026-08-14 那次「GitHub CLI 那一列出現兩顆安裝」之後補的守門。那次的來源
  // 不在這張表（是 app.js 補了第二顆），但同一個畫面症狀還有這條路可以走到，所以一起
  // 釘住。目前唯一兩邊都登記的是 pwsh-store：它的修復鍵只在黃燈出現，而安裝鍵只在
  // 紅燈出現，兩者互斥。
  for (const [checkId, resolve] of Object.entries(FIX_ACTIONS)) {
    if (!Object.hasOwn(INSTALLERS, checkId)) {
      continue;
    }

    assert.equal(
      resolve("missing", { status: "missing", fixLabel: "（測試用）" }),
      null,
      `${checkId} 在紅燈時同時掛得出安裝鍵與修復鍵——那一列會出現兩顆按鈕`,
    );
  }
  ok("有安裝器的那幾列不會在紅燈時又長出一顆修復鍵");

  // 修某一格的按鈕要說得出它修的是哪一格：畫面上它掛回那一格底下（見 view.js 的
  // inlineActions）。原本「未登入」在清單裡、按鈕在清單外的按鈕列，學生要自己把
  // 兩者連起來（Reed 實測）。
  assert.equal(auth.buttons[0].checkId, "gh-auth");
  assert.equal(
    envRowModel({
      id: "execution-policy",
      label: "PowerShell 執行原則",
      status: "warn",
      detail: "未設定",
      installAction: null,
      fixAction: "fix-execution-policy",
    }).buttons[0].checkId,
    "execution-policy",
  );
  ok("修某一格的按鈕帶著那一格的 id，畫面才擺得回它旁邊");

  // 迴歸：逾時曾被歸成 missing，長出安裝按鈕叫人重裝已經裝好的東西。
  const timedOut = envRowModel({
    id: "codex",
    label: "Codex CLI",
    status: "warn",
    detail: "檢查逾時，請再按一次重新檢查",
    installAction: null,
    fixAction: null,
  });
  assert.deepEqual(timedOut.buttons, []);
  assert.equal(timedOut.symbol, "!");
  ok("逾時的項目不長按鈕");

  assert.deepEqual(
    envButtonState({
      action: "install-gh",
      idleText: "安裝",
      runInProgress: false,
      currentEnvAction: null,
      waitingAction: null,
    }),
    { disabled: false, text: "安裝" },
  );
  assert.deepEqual(
    envButtonState({
      action: "install-gh",
      idleText: "安裝",
      runInProgress: true,
      currentEnvAction: "install-gh",
      waitingAction: null,
    }),
    { disabled: true, text: "安裝中…" },
  );
  assert.deepEqual(
    envButtonState({
      action: "install-claude",
      idleText: "安裝",
      runInProgress: true,
      currentEnvAction: "install-gh",
      waitingAction: null,
    }),
    { disabled: true, text: "安裝" },
  );
  assert.deepEqual(
    envButtonState({
      action: "login-gh",
      idleText: "登入",
      runInProgress: false,
      currentEnvAction: null,
      waitingAction: "login-gh",
    }),
    { disabled: true, text: "等待登入中…" },
  );
  ok("按鈕文字分得出「正在跑的那顆」「其他顆」「等登入的那顆」");

  const idle = runControlsState({
    runInProgress: false,
    runId: null,
    acceptsInput: false,
    envCheckInProgress: false,
  });
  assert.equal(idle.cancelHidden, true);
  assert.equal(idle.inputHidden, true);
  assert.equal(idle.recheckDisabled, false);
  assert.equal(idle.configControlsDisabled, false);

  const running = runControlsState({
    runInProgress: true,
    runId: "r1",
    acceptsInput: true,
    envCheckInProgress: false,
  });
  assert.equal(running.cancelHidden, false);
  assert.equal(running.cancelDisabled, false);
  assert.equal(running.inputHidden, false);
  assert.equal(running.actionButtonsDisabled, true);
  assert.equal(running.configControlsDisabled, true);

  // 不接受輸入的動作不該冒出那格貼代碼的輸入列。
  assert.equal(
    runControlsState({
      runInProgress: true,
      runId: "r1",
      acceptsInput: false,
      envCheckInProgress: false,
    }).inputHidden,
    true,
  );
  // 已經送出但還沒拿到 runId 時不能按取消。
  assert.equal(
    runControlsState({
      runInProgress: true,
      runId: null,
      acceptsInput: true,
      envCheckInProgress: false,
    }).cancelDisabled,
    true,
  );
  assert.equal(
    runControlsState({
      runInProgress: false,
      runId: null,
      acceptsInput: false,
      envCheckInProgress: true,
    }).recheckDisabled,
    true,
  );
  assert.equal(
    runControlsState({
      runInProgress: false,
      runId: null,
      acceptsInput: false,
      envCheckInProgress: false,
      configCheckInProgress: true,
    }).configControlsDisabled,
    true,
  );
  ok("執行中／閒置時各控制項的開關正確");

  assert.deepEqual(runOutcome({ exitCode: 0, signal: null }), {
    succeeded: true,
    summary: "exit code: 0",
    className: "succeeded",
  });
  assert.equal(runOutcome({ exitCode: 3, signal: null }).succeeded, false);
  // 迴歸：winget 回報「已經裝好了」是非零，但那不是失敗。
  assert.equal(
    runOutcome({ exitCode: 2316632107, signal: null, benign: true }).succeeded,
    true,
  );
  assert.equal(
    runOutcome({ exitCode: null, signal: "SIGKILL" }).summary,
    "已停止：SIGKILL",
  );
  ok("成功判定含 benign 退出碼，被中止時顯示訊號");

  // 迴歸（乾淨 macOS VM 實測的真實輸出）：最有用的 EACCES 在整段的第 5 行，
  // 結尾則是 npm notice 與 log 檔路徑。抓最後一行等於給學生一句廢話。
  const npmEacces = [
    "npm error code EACCES",
    "npm error syscall mkdir",
    "npm error path /usr/local/lib/node_modules/@anthropic-ai",
    "npm error errno -13",
    "npm error Error: EACCES: permission denied, mkdir '/usr/local/lib/node_modules/@anthropic-ai'",
    "npm error     at async mkdir (node:internal/fs/promises:859:10)",
    "npm error The operation was rejected by your operating system.",
    "npm notice",
    "npm error A complete log of this run can be found in: /Users/reed/.npm/_logs/x.log",
  ];
  assert.equal(
    failureReason(npmEacces),
    "npm error Error: EACCES: permission denied, mkdir '/usr/local/lib/node_modules/@anthropic-ai'",
  );
  ok("npm 權限失敗時挑出 EACCES 那一行，不是 log 路徑");

  // 只有錯誤代碼、沒有敘述句時退而求其次。
  assert.equal(
    failureReason([
      "npm error code E404",
      "npm error A complete log of this run can be found in: x",
    ]),
    "npm error code E404",
  );
  ok("沒有敘述句時退回錯誤代碼那一行");

  // winget 的繁中輸出沒有 error 字樣——不能因此吐空的，要維持原本「最後一行」的行為。
  assert.equal(
    failureReason(["找到 Claude Code [Anthropic.ClaudeCode]", "安裝程式雜湊不符合"]),
    "安裝程式雜湊不符合",
  );
  assert.equal(failureReason([]), undefined);
  assert.equal(failureReason(undefined), undefined);
  ok("沒有錯誤特徵時退回最後一行，空輸入不拋錯");

  // ⚠️ 嚮導自己的內部日誌不算「理由」。學生按取消時 [terminateRun] 那行是最後一行，
  // 而沒有錯誤特徵時我們拿最後一行當理由——於是那一列寫著
  //「GitHub CLI：[terminateRun] 中止子行程，來源：cancel-endpoint」（Reed 在 VM 上
  // 看到）。那句話對學生沒有意義，還看起來像出了系統級的錯。
  assert.equal(
    failureReason([
      "正在安裝 GitHub CLI",
      "[terminateRun] 中止子行程，來源：cancel-endpoint",
    ]),
    "正在安裝 GitHub CLI",
  );
  ok("嚮導自己的內部日誌不會被當成失敗的理由");

  assert.deepEqual(
    behaviorFallbackState({ exitCode: 0, signal: null }),
    { visible: false, question: "", checklist: [] },
  );
  ok("行為驗證 exit 0 時不顯示手動退路");

  assert.deepEqual(
    behaviorFallbackState({ exitCode: 1, signal: null }),
    {
      visible: true,
      question: BEHAVIOR_QUESTION,
      checklist: BEHAVIOR_CHECKLIST,
    },
  );
  ok("行為驗證 exit 1 時顯示問題與五項檢查清單");

  assert.deepEqual(
    behaviorFallbackState({ exitCode: 1, signal: null, benign: true }),
    { visible: false, question: "", checklist: [] },
  );
  ok("行為驗證 benign 結果沿用成功判定且不顯示手動退路");

  assert.deepEqual(
    installStatusMessage("install-gh", { exitCode: 0, signal: null }),
    { text: "安裝完成，狀態已更新。", failed: false },
  );
  assert.deepEqual(
    installStatusMessage("install-gh", {
      exitCode: 1,
      signal: null,
      benign: true,
    }),
    { text: "這個項目本來就已經裝好了，狀態已更新。", failed: false },
  );
  assert.deepEqual(
    installStatusMessage("fix-execution-policy", { exitCode: 0, signal: null }),
    { text: "已改為 RemoteSigned，狀態已更新。", failed: false },
  );
  assert.deepEqual(
    installStatusMessage("install-gh", { exitCode: 1, signal: null }),
    { text: "安裝失敗，請看下方輸出", failed: true },
  );
  assert.deepEqual(
    installStatusMessage("fix-execution-policy", { exitCode: 1, signal: null }),
    { text: "執行失敗，請看下方輸出", failed: true },
  );
  // 登入成功不在這裡報告——要等輪詢確認狀態真的變綠才算數。
  assert.equal(
    installStatusMessage("login-gh", { exitCode: 0, signal: null }),
    null,
  );
  ok("安裝／修正／登入各自回報正確的狀態文字");

  const startedAt = 1_000;
  assert.deepEqual(
    loginWaitStep({
      startedAt,
      now: startedAt + 1_000,
      checks: [{ id: "gh-auth", status: "ok" }],
      checkId: "gh-auth",
    }),
    { kind: "done", text: "登入成功。", failed: false },
  );
  assert.equal(
    loginWaitStep({
      startedAt,
      now: startedAt + 1_000,
      checks: [{ id: "gh-auth", status: "warn" }],
      checkId: "gh-auth",
    }).kind,
    "pending",
  );
  assert.equal(
    loginWaitStep({
      startedAt,
      now: startedAt + LOGIN_WAIT_TIMEOUT_MS,
      checks: null,
      checkId: "gh-auth",
    }).kind,
    "timeout",
  );
  // 已經變綠就算超過時間也算成功，不該報逾時。
  assert.equal(
    loginWaitStep({
      startedAt,
      now: startedAt + LOGIN_WAIT_TIMEOUT_MS,
      checks: [{ id: "gh-auth", status: "ok" }],
      checkId: "gh-auth",
    }).kind,
    "done",
  );
  ok("等登入的輪詢分得出成功、繼續等、逾時");
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
