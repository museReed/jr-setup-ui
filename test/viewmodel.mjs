import assert from "node:assert/strict";

import {
  BEHAVIOR_CHECKLIST,
  BEHAVIOR_QUESTION,
  LOGIN_WAIT_TIMEOUT_MS,
  AUTO_VERIFY_ACTIONS,
  agentNameFor,
  appendTermLine,
  behaviorFallbackState,
  cardIsComplete,
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
  extractLoginHints,
  installStatusMessage,
  isLoginAction,
  loginCardModel,
  loginWaitStep,
  milestoneModels,
  nextCardUnlocked,
  rowRunOptions,
  runControlsState,
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
    mergeAction: "merge-config-step",
  });
  assert.deepEqual(configActions.buttons, [
    {
      action: "install-config-step",
      dataName: "installAction",
      text: "安裝",
      step: "claude-md",
    },
    {
      action: "merge-config-step",
      dataName: "mergeAction",
      text: "用 AI 合併",
      step: "claude-md",
    },
  ]);
  ok("規則檔同時可安裝與合併時安裝按鈕在前");

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
  assert.deepEqual(
    pending.buttons.map((button) => button.text),
    ["安裝"],
  );
  assert.equal(pending.showRetest, true);
  ok("結構齊全但沒驗過行為的列不給綠燈，且沒有會閃現的「驗證」按鈕");

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
  assert.deepEqual(
    verified.buttons.map(({ text, disabled }) => ({ text, disabled })),
    [{ text: "✅ 安裝", disabled: true }],
  );
  assert.equal(verified.showRetest, true);
  ok("驗過之後才變綠，安裝按鈕置灰並可再次驗證");

  const cards = [
    {
      kind: "config",
      checkId: "one",
      check: { id: "one", label: "一", status: "ok", detail: "完成" },
    },
    {
      kind: "config",
      checkId: "two",
      check: { id: "two", label: "二", status: "ok", detail: "完成" },
    },
    {
      kind: "config",
      checkId: "three",
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

  const milestones = milestoneModels(
    cards,
    new Set(["one"]),
    1,
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
  const atFirst = milestoneModels(cards, allIds, 0);
  assert.deepEqual(
    atFirst.map(({ reached }) => reached),
    [true, false, false],
  );
  assert.equal(atFirst[2].unlocked, false);
  ok("小鴨沒走到的圓點不算走過，就算那些檢查本來就通過");

  // 走到第 2 站、第 2 張的檢查沒過：那一顆不能亮。
  const secondNotDone = milestoneModels(cards, new Set(["one"]), 1);
  assert.deepEqual(
    secondNotDone.map(({ reached }) => reached),
    [true, false, false],
  );
  ok("走過但沒通過的圓點不算走過");

  // 卡片往哪邊展開要看落在條上的哪半邊。用「第幾顆」判的話，只有一站時那顆
  // （percent 100、貼最右）會被判成往右開，直接溢出畫面。
  assert.deepEqual(
    milestoneModels(cards, new Set(), 0).map(({ edgeClass }) => edgeClass),
    [
      "ds-milestone--edge-start",
      "ds-milestone--edge-end",
      "ds-milestone--edge-end",
    ],
  );
  assert.equal(
    milestoneModels([cards[0]], new Set(), 0)[0].edgeClass,
    "ds-milestone--edge-end",
  );
  ok("里程碑卡片往內側展開，只有一站時也不會往右溢出");

  assert.equal(sectionStatus(cards, allIds, 2), "這一段已完成。");
  assert.equal(sectionStatus(cards, allIds, 0), "還有 2 張要做。");
  assert.equal(sectionStatus(cards, new Set(["one"]), 1), "還有 2 張要做。");
  ok("段落狀態依未完成卡片數顯示完成或剩餘張數");

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
    [
      { text: "✅ 安裝", disabled: true },
      { text: "開始登入", disabled: false },
    ],
  );
  ok("按過安裝但伺服器仍回 missing 時，安裝按鈕不置灰，學生能重試");

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
  // 對照組：真的有 installer 的項目，裝好之後還是要留下已完成的 ✅ 安裝。
  assert.deepEqual(
    envCardRowModel(
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
    ).buttons.map(({ text, disabled }) => ({ text, disabled: !!disabled })),
    [{ text: "✅ 安裝", disabled: true }],
  );
  ok("沒有 installer 的設定類項目不放安裝按鈕，只放修正");

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
      cardStatusModel({ completed: true }),
      cardStatusModel({ failed: true }),
    ].map(({ text, className }) => ({ text, className })),
    [
      { text: "未安裝", className: "ds-pill" },
      { text: "安裝中…", className: "ds-pill" },
      { text: "待驗證", className: "ds-pill" },
      { text: "已完成", className: "ds-pill ds-pill-success" },
      { text: "失敗", className: "ds-pill card-status-danger" },
    ],
  );
  ok("status 徽章五種狀態對到正確文字與 class");

  assert.deepEqual(sectionManualItems("rules", 0, 2, "claude"), []);
  // 規則段結尾原本有「關掉分頁、開新的」——拿掉了，規則段的驗證全部走
  // verify-in-terminal，它每次都自己開一個全新的終端視窗。
  assert.deepEqual(sectionManualItems("rules", 1, 2, "claude"), []);
  assert.deepEqual(
    sectionManualItems("skills", 1, 2, "claude,codex").map(({ id }) => id),
    ["skills-new-terminal"],
  );
  ok("SECTION_GATES 只出現在段落最後一張，並依工具篩選");

  // codex 的信任提示原本是一格勾選框，拿掉了：同一張卡的 CARD_HINTS 已經把那兩題
  // 照原樣印出來（含要選哪一個），勾選框只是把同一件事再講一次，而且講得比較差
  // ——沒說畫面長什麼樣，也沒提第二題（sandbox 模式）。
  assert.deepEqual(
    sectionManualItems("rules", 0, 5, "claude,codex", "codex-namer"),
    [],
  );
  assert.ok(CARD_HINTS["codex-namer"].lines.length >= 2);
  ok("codex 的兩題改用 CARD_HINTS 照原樣印出來，不再多一格勾選框");

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
  assert.match(mergeOutcome[0].text, /再 check 一次/);
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
    { step: "claude-md", action: "merge-config-step", extra: null },
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
