import assert from "node:assert/strict";

import {
  FULLSCREEN_PROMPT,
  FULLSCREEN_PROOF,
  GUIDANCE,
  MASTER_PASSCODE,
  SECTIONS,
  SECTION_PASSCODES,
  flattenCheckCards,
  groupChecks,
  matchesFullscreenProof,
  matchesMasterPasscode,
  matchesSectionPasscode,
  mergeInvalidates,
  pendingMergeSibling,
  sectionGateState,
} from "../public/model.js";
import {
  cardIsComplete,
  envLogoFor,
  progressSummary,
} from "../public/viewmodel.js";
import {
  STEP_IDS,
  describeStep,
  stepsForTools,
} from "../src/config-install.js";
import { checksForPlatform } from "../src/env-check.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

function check(id) {
  return { id, label: id, status: "ok", detail: "已安裝" };
}

function section(groups, sectionId) {
  return groups.find((group) => group.sectionId === sectionId);
}

try {
  // demo 排在最後：它要當日密碼才開（嚮導會提早發給學生先裝環境）。筆記那段是
  // 選配，排在它前面，而且不會擋住 demo——見下面 sectionGateState 那幾條。
  assert.deepEqual(
    SECTIONS.map(({ id }) => id),
    ["env", "rules", "skills", "notes", "demo"],
  );

  // 當日密碼。這一段跟其他的鎖不同：它不是「做完前面就會開」，只有講師報的數字
  // 打得開。前後空白要清掉——複製貼上很容易多黏一個空格。
  assert.equal(SECTION_PASSCODES.demo, "0822");
  assert.equal(matchesSectionPasscode("demo", "0822"), true);
  assert.equal(matchesSectionPasscode("demo", " 0822\n"), true);
  assert.equal(matchesSectionPasscode("demo", "0823"), false);
  assert.equal(matchesSectionPasscode("demo", ""), false);
  assert.equal(matchesSectionPasscode("demo", undefined), false);
  // 沒有密碼的段永遠不該被密碼比對放行——回傳 true 的話那些段會多長出一道鎖。
  assert.equal(matchesSectionPasscode("notes", "0822"), false);
  ok("demo 的當日密碼是 0822，其他段沒有密碼");

  const doneAll = {
    env: true,
    rules: true,
    skills: true,
    notes: true,
    demo: true,
  };

  // 前面都做完了，密碼還沒打：擋著，而且只差這一件——彈密碼框的條件。
  const beforePasscode = sectionGateState(
    "demo",
    new Set(),
    "claude",
    doneAll,
    {},
    new Set(),
  );
  assert.equal(beforePasscode.locked, true);
  assert.equal(beforePasscode.needsPasscode, true);
  assert.match(beforePasscode.reason, /密碼/);

  // 打過密碼就開。
  assert.equal(
    sectionGateState("demo", new Set(), "claude", doneAll, {}, new Set(["demo"]))
      .locked,
    false,
  );

  // 前面沒做完的時候不彈密碼框：學生打對了數字仍然進不去，那個框等於在騙他。
  const stillPending = sectionGateState(
    "demo",
    new Set(),
    "claude",
    { ...doneAll, rules: false },
    {},
    new Set(),
  );
  assert.equal(stillPending.locked, true);
  assert.equal(stillPending.needsPasscode, false);
  ok("demo 只差密碼時才彈框，前面沒做完先講前面");

  // 選配的筆記段沒做完，不可以把排在它後面的 demo 鎖住——那一段本來就可做可不做。
  assert.equal(
    sectionGateState(
      "demo",
      new Set(),
      "claude",
      { env: true, rules: true, skills: true, notes: false },
      {},
      new Set(["demo"]),
    ).locked,
    false,
  );
  ok("沒做選配的筆記段不會擋住 demo");

  // 講師的萬用密碼。跟當日密碼是兩件事，所以分開存也分開比對——混在一起的話，
  // 學生用當日密碼開了 demo 就等於連「前面要做完」也一起免了。
  assert.equal(MASTER_PASSCODE, "admin");
  assert.equal(matchesMasterPasscode("admin"), true);
  assert.equal(matchesMasterPasscode(" admin\n"), true);
  assert.equal(matchesMasterPasscode("0822"), false);
  assert.equal(matchesMasterPasscode(undefined), false);
  // 當日密碼不可以被當成萬用密碼，反過來也不行。
  assert.equal(matchesSectionPasscode("demo", "admin"), false);
  ok("萬用密碼是 admin，跟當日密碼互不相通");

  // 萬用密碼開過的段：前面一段都沒做完也開，連沒有當日密碼的段也開。
  const nothingDone = { env: false, rules: false, skills: false };

  for (const sectionId of ["rules", "skills", "notes", "demo"]) {
    const overridden = sectionGateState(
      sectionId,
      new Set(),
      "claude",
      nothingDone,
      {},
      new Set(),
      new Set([sectionId]),
    );
    assert.equal(overridden.locked, false, `${sectionId} 應該被萬用密碼打開`);
    assert.equal(overridden.reason, "");
    assert.equal(overridden.needsPasscode, false);
  }

  // 只開被指名的那一段，不是全部——講師跳去看 demo，不該順手把技能包那段也開了。
  assert.equal(
    sectionGateState(
      "skills",
      new Set(),
      "claude",
      nothingDone,
      {},
      new Set(),
      new Set(["demo"]),
    ).locked,
    true,
  );
  ok("萬用密碼只開被指名的那一段，前面沒做完照樣開");

  const mergedEnv = section(
    flattenCheckCards(groupChecks([]), [
      check("claude"),
      { ...check("claude-auth"), label: "Claude Code 登入狀態" },
    ]),
    "env",
  );
  const claudeCard = mergedEnv.cards.find(({ checkId }) => checkId === "claude");
  assert.equal(
    mergedEnv.cards.filter(({ checkId }) =>
      ["claude", "claude-auth"].includes(checkId),
    ).length,
    1,
  );
  assert.deepEqual(
    claudeCard.checks.map(({ id }) => id),
    ["claude", "claude-auth"],
  );

  const envSequence = section(
    flattenCheckCards(
      groupChecks([]),
      [
        "claude",
        "claude-auth",
        "codex",
        "codex-auth",
        "git",
        "gh",
        "gh-auth",
        "node",
        "python",
        "ghostty",
      ].map(check),
    ),
    "env",
  );
  // mac 的順序：終端機那張排到最前面（跟 Windows 的「先準備好」同一格），接著是
  // GitHub，然後才是兩支 CLI。
  //
  // ⚠️ GitHub 排這麼前面是**回報管道**的需求（Reed 拍板）：「這一頁卡住了」那顆走
  // `gh issue create --body-file`，所以 gh 必須在「會出事的那些卡」之前就裝好登入好。
  // 課程上這不是第一步，但沒有回報管道的話學生卡住了只能自己截圖。
  assert.deepEqual(
    envSequence.cards.map(({ checkId }) => checkId),
    ["env-config", "ghostty", "git", "claude", "codex", "node"],
  );
  const gitCard = envSequence.cards.find(({ checkId }) => checkId === "git");
  assert.deepEqual(
    gitCard.checks.map(({ id }) => id),
    ["git", "gh", "gh-auth"],
  );
  assert.match(gitCard.label, /版本控制與 GitHub/);
  const runtimeCard = envSequence.cards.find(({ checkId }) => checkId === "node");
  assert.deepEqual(
    runtimeCard.checks.map(({ id }) => id),
    ["node", "python"],
  );

  // Windows：四列終端／PowerShell 相關的合成一張，而且站在整段最前面——擋路的先修。
  const windowsSequence = section(
    flattenCheckCards(
      groupChecks([]),
      [
        "execution-policy",
        "claude",
        "claude-auth",
        "git",
        "gh",
        "gh-auth",
        "node",
        "python",
        "windows-terminal",
        "powershell-version",
        "powershell-encoding",
      ].map(check),
    ),
    "env",
  );
  assert.deepEqual(
    windowsSequence.cards.map(({ checkId }) => checkId),
    ["env-config", "execution-policy", "git", "claude", "node"],
  );
  const windowsCard = windowsSequence.cards.find(
    ({ checkId }) => checkId === "execution-policy",
  );
  assert.deepEqual(
    windowsCard.checks.map(({ id }) => id),
    [
      "execution-policy",
      "windows-terminal",
      "powershell-version",
      "powershell-encoding",
    ],
  );
  assert.match(windowsCard.label, /Windows 先準備好/);
  ok("環境段合併：兩平台的卡片序一致，終端／PowerShell 那組排在最前面");

  // 那兩列沒有安裝按鈕（只是探針），合併後坐在第一張卡裡——沒有自救說明的話學生
  // 開場就卡在一句「檢查失敗」，而畫面上沒有任何可按的東西。
  for (const id of ["powershell-version", "powershell-encoding"]) {
    assert(GUIDANCE[id] !== undefined, `${id} 沒有安裝按鈕，一定要有自救說明`);
    assert(GUIDANCE[id].checks.length > 0);
  }
  ok("沒有安裝按鈕的兩列都有自救步驟");

  const rules = section(
    groupChecks([
      check("codex-config"),
      check("claude-md"),
      check("tab-sync"),
      check("codex-agents"),
      check("hook"),
    ]),
    "rules",
  );
  assert.deepEqual(
    rules.cards.map(({ agent, label, logo, checks }) => ({
      agent,
      label,
      logo,
      checks: checks.map(({ id }) => id),
    })),
    [
      {
        agent: "claude",
        label: "Claude",
        logo: "logo-claude",
        checks: ["claude-md", "hook"],
      },
      {
        agent: "codex",
        label: "Codex",
        logo: "logo-openai",
        checks: ["codex-config", "codex-agents"],
      },
      {
        agent: "shared",
        label: "兩邊共用",
        logo: "logo-terminal",
        checks: ["tab-sync"],
      },
    ],
  );

  // 終端機標題同步得排第一張：它把 watcher 裝進 shell profile，之後開的終端才有人
  // 把名字放上分頁標題。命名 hook 那幾張要學生「看標題有沒有變」，沒先裝這個就永遠
  // 看不到——VM 實測：PowerShell profile 檔案根本不存在，標題一直是預設值，學生被
  // 推進一個必然失敗的驗證。
  const rulesSequence = section(
    flattenCheckCards(
      groupChecks([
        check("claude-md"),
        check("claude-namer"),
        check("codex-namer"),
        check("tab-sync"),
      ]),
      [],
    ),
    "rules",
  );
  assert.equal(rulesSequence.cards[0].checkId, "tab-sync");
  assert.deepEqual(
    rulesSequence.cards.map(({ checkId }) => checkId),
    ["tab-sync", "claude-md", "claude-namer", "codex-namer"],
  );
  console.log(
    "ok - 終端機標題同步排在命名 hook 前面，後面那幾張要靠它才看得到標題變化",
  );

  const claudeOnly = groupChecks([
    check("claude-md"),
    check("skill-claude-handoff"),
    check("demo-claude"),
  ]);
  assert(
    claudeOnly.every((group) =>
      group.cards.every(({ agent }) => agent !== "codex"),
    ),
  );

  const withUnknown = section(
    groupChecks([check("claude-md"), check("future-config-step")]),
    "rules",
  );
  assert.equal(withUnknown.cards.at(-1).label, "其他");
  assert.deepEqual(
    withUnknown.cards.at(-1).checks.map(({ id }) => id),
    ["future-config-step"],
  );

  const progressChecks = [
    check("claude-md"),
    {
      ...check("output-style"),
      verifyAction: "verify-behavior",
    },
  ];
  assert.deepEqual(
    progressSummary(
      [check("claude"), { ...check("codex"), status: "missing" }],
      progressChecks,
    ),
    { loading: false, done: 2, total: 4, percent: 50 },
  );
  assert.equal(
    progressSummary(
      [check("claude"), { ...check("codex"), status: "missing" }],
      progressChecks,
      new Set(["output-style"]),
    ).percent,
    75,
  );
  assert.equal(progressSummary(null, progressChecks).loading, true);

  assert.equal(envLogoFor("claude-auth"), "logo-claude");
  assert.equal(envLogoFor("execution-policy"), "logo-powershell");
  assert.equal(envLogoFor("unknown"), null);

  const flattened = flattenCheckCards(
    groupChecks([
      check("tab-sync"),
      check("codex-config"),
      check("claude-md"),
      check("future-config-step"),
    ]),
    [check("node"), check("codex"), check("claude")],
  );
  assert.equal(section(flattened, "env").cards.length, 4);
  assert.deepEqual(
    section(flattened, "env").cards.map(({ checkId }) => checkId),
    ["env-config", "claude", "codex", "node"],
  );
  assert.deepEqual(
    section(flattened, "rules").cards.map(({ checkId, agent }) => ({
      checkId,
      agent,
    })),
    [
      // tab-sync 提到最前面：後面幾張的驗證要靠它裝的 watcher 才看得到標題變化。
      { checkId: "tab-sync", agent: "shared" },
      { checkId: "claude-md", agent: "claude" },
      { checkId: "codex-config", agent: "codex" },
      { checkId: "future-config-step", agent: "other" },
    ],
  );

  console.log("ok - sections 分組、單卡順序、進度、logo 與未知 step fallback");

  // 同一張卡不能被兩組都認走：畫面上會出現兩張一模一樣的卡，里程碑那條也多兩個點
  // （Reed 實測截圖：筆記那段的 vault-agent-* 同時被「筆記庫」組與 Claude/Codex 組
  // 認走，因為前者用的是「這一段有哪些成員」那個 Set 去分組）。
  for (const group of flattenCheckCards(
    groupChecks(stepsForTools(["claude", "codex"]).map((id) => check(id))),
  )) {
    const ids = group.cards.map(({ checkId }) => checkId);
    assert.deepEqual(
      ids.filter((id, index) => ids.indexOf(id) !== index),
      [],
      `${group.sectionId} 這一段有重複的卡片`,
    );
  }

  ok("同一張卡只會被一組認走，沒有重複的卡片與里程碑");

  // 標題下那一行要回答「做完之後我會多出什麼」。原本十一張共用一句「設定 X，讓
  // 這項功能能在接下來的課程中正常使用」——那句話對每一張都成立，所以對每一張都
  // 等於沒說。這條測試釘住「真的存在的步驟不准再落回那句罐頭話」。
  const rulesCards = section(flattened, "rules").cards;
  for (const card of rulesCards) {
    if (card.checkId === "future-config-step") continue; // 還不存在的步驟才准用 fallback
    assert.doesNotMatch(
      card.detail,
      /讓這項功能能在接下來的課程中正常使用/,
      `${card.checkId} 還在用罐頭描述`,
    );
  }
  // 沒收錄的步驟仍要有話可說，不能空著。
  const unknown = rulesCards.find(
    ({ checkId }) => checkId === "future-config-step",
  );
  assert(unknown.detail.length > 0);
  ok("每張卡的描述講的是做完會多出什麼，不是罐頭話");

  // 標題講學生會看到的事，不講做法。實作名詞留在清單與終端訊息裡。
  for (const id of STEP_IDS) {
    const { label } = describeStep(id, {
      lang: "zh-TW",
      home: "/home/x",
      platform: "win32",
    });
    assert.doesNotMatch(
      label,
      /hook|Output Style|config\.toml|CLAUDE\.md|AGENTS\.md|MCP|Skill：|第三方：/,
      `${id} 的標題還帶著實作名詞：${label}`,
    );
  }
  ok("卡片標題不帶實作名詞");

  // skill 的卡片標題就是 skill 的名字。其他卡裝好就在背後生效，skill 不一樣——學生
  // 要打那個名字才叫得動（Codex 那邊是 $handoff），標題不寫名字的話他知道有這個
  // 功能卻不知道怎麼呼叫。做什麼用的在描述裡。
  for (const [id, name] of [
    ["skill-claude-handoff", "handoff"],
    ["skill-codex-auto-rename", "auto-rename"],
    ["skill-claude-structured-questions", "structured-questions"],
    ["ext-frontend-design-claude", "frontend-design"],
    ["ext-skill-creator-claude", "skill-creator"],
    ["ext-playwright-codex", "playwright"],
  ]) {
    const { label } = describeStep(id, {
      lang: "zh-TW",
      home: "/home/x",
      platform: "win32",
    });
    assert(
      label.startsWith(name),
      `${id} 的標題要以 skill 名字開頭，現在是「${label}」`,
    );
  }
  ok("skill 卡片的標題就是 skill 的名字");

  // 環境那一段的描述也不准回到「安裝 X，才能…」——那種句型只是把標題再講一次，
  // 沒有回答「做完你會多出什麼」。
  for (const card of section(flattened, "env").cards) {
    assert.doesNotMatch(
      card.detail,
      /^(安裝|確認|調整)[^，]*，(才能|讓)/,
      `${card.checkId} 的描述只是把標題再講一次：${card.detail}`,
    );
  }
  ok("環境卡的描述講的也是做完會多出什麼");

  // 執行原則要排在環境段最前面。它原本歸在 other、照 agent 排序落到最後，於是學生
  // 在第一張卡就按「開啟 Claude Code」，新視窗直接紅字「running scripts is disabled」
  //（VM 實測）。我們自己 spawn 的腳本已經帶 Bypass 不靠它，但學生自己跑 claude 要靠。
  const windowsEnv = flattenCheckCards(groupChecks([]), [
    check("claude"),
    check("node"),
    check("execution-policy"),
  ]);
  assert.deepEqual(
    section(windowsEnv, "env").cards.map(({ checkId }) => checkId),
    ["env-config", "execution-policy", "claude", "node"],
  );
  ok("執行原則排在環境段最前面，擋路的先修");

  // 守門：後端會回的每一列環境檢查，都要有人認領。沒登記在 ENV_CARD_META 的
  // checkIds 裡就會自己長成一張卡，標題走預設模板（「準備 <整句 label>，讓後面的
  // 課堂步驟可以正常進行。」）——讀起來像機器寫的。
  //
  // ⚠️ 這支測試是為了擋沙箱拆成兩列那次：新的 codex-sandbox-ready 忘了加進 Codex
  // 那張卡，畫面上多出一張沒人要的卡，而測試全綠。同一種漏在這個檔案的註解裡
  // 已經寫過一次了，還是又漏了——所以改成用測試擋。
  const everyWindowsCheck = checksForPlatform("win32").map(({ id }) => id);
  const ownedCards = flattenCheckCards(
    groupChecks([]),
    everyWindowsCheck.map((id) => check(id)),
  );
  const ownRow = new Set(
    section(ownedCards, "env").cards.flatMap(({ checks }) =>
      checks.map(({ id }) => id),
    ),
  );

  for (const id of everyWindowsCheck) {
    assert.ok(ownRow.has(id), `${id} 沒有出現在任何一張環境卡的清單裡`);
  }

  // 每一列都要嘛是自己那張卡的主 check，要嘛被別人的 checkIds 收編——落單的那種
  // 會拿到預設模板的標題。
  for (const card of section(ownedCards, "env").cards) {
    if (card.kind === "setup") {
      continue;
    }

    assert.ok(
      !/^準備 .+，讓後面的課堂步驟可以正常進行。$/.test(card.detail ?? ""),
      `${card.checkId} 的說明是預設模板——它該被收進某張卡，或自己登記一段文案`,
    );
  }
  ok("環境段每一列都有卡片認領，沒有人落在預設模板上");

  // 規矩與回話風格是同一件事的兩半，合成一張卡。分兩張只是把「設定它怎麼做事」
  // 切成兩半讓學生做兩次，而且先驗的那次跑的是只裝了一半的狀態。
  const merged = flattenCheckCards(
    groupChecks([
      check("claude-md"),
      check("output-style"),
      check("hook"),
      check("allowlist"),
      check("codex-agents"),
      check("codex-config"),
    ]),
    [],
  );
  const mergedRules = section(merged, "rules").cards;
  assert.deepEqual(
    mergedRules.map(({ checkId, checks }) => [
      checkId,
      checks.map(({ id }) => id).join("+"),
    ]),
    [
      // 主 check 是最後那個：驗證掛在它身上，而驗證要等兩份都裝好。
      ["output-style", "claude-md+output-style"],
      // 擋串接與白名單寫的是同一個 settings.json，講的也是同一件事。
      // 2026-08-12 改成白名單排前面（Reed 在 VM 上看著畫面指定）。
      //
      // ⚠️ 主 check 是 checks.at(-1)，所以順序一換它就跟著換，而 MERGED_CARDS 的
      // key 也要一起換——沒換的話標題與說明會靜靜退回單列的預設值，下面兩條 assert
      // 就是在防這個。
      ["hook", "allowlist+hook"],
      ["codex-config", "codex-agents+codex-config"],
    ],
  );
  const permissionCard = mergedRules[1];
  assert.match(permissionCard.label, /什麼時候該停下來問你/);
  assert.match(permissionCard.detail, /改檔案不再逐次問你/);
  assert.deepEqual(
    permissionCard.checks.map(({ id }) => id),
    ["allowlist", "hook"],
    "先講白名單再擋串接",
  );
  ok("擋串接與白名單合成一張權限卡，白名單排前面、主 check 是 hook");
  assert.match(
    mergedRules[0].label,
    /規矩與回話風格/,
    "合併後的卡要有自己的標題，不能沿用其中一半的",
  );
  assert.match(mergedRules[0].detail, /兩份/);
  ok("規矩與回話風格合成一張卡，主 check 是帶驗證的那一份");

  // ⚠️ 這裡曾經有兩組測試：「裝完第一份會接著裝第二份」（nextInstallStep）與「裝完
  // 之後整張卡排隊驗證」（pendingVerifySteps）。兩支函式都拿掉了（Reed 指定）。
  //
  // 理由：那條自動接力在畫面上的樣子是「第一格旁邊那顆按鈕，把兩件事都做了」，而
  // 第二格從頭到尾沒有自己的入口，學生沒辦法只重跑其中一件。現在每一格都有自己的
  // 安裝鍵，一顆按鈕只做它那一格的事，接的驗證也就是那一格（app.js 的 justInstalled）。
  //
  // 排隊那套解掉的 8/12 bug（第一份的驗證從來沒被觸發）自己消失了：不再有「一次裝
  // 兩份」這件事。守門改在 test/frontend-layers.mjs——那裡禁止把接力接回去。

  // 迴歸（Reed 在 VM 上看到的）：CLAUDE.md 說「已有你自己的版本，需要合併」之後，
  // 流程照樣往下裝 output-style 然後**馬上驗行為**。那次驗的是半完成的狀態——行為
  // 驗證是真的問一次 Claude，而它怎麼回同時受 output-style 與 CLAUDE.md 影響。
  // 而且卡片自己還會叫學生「合併完再按重跑驗證」，等於同一件事做兩次。
  assert.equal(
    pendingMergeSibling("output-style", [
      { ...check("claude-md"), needsMerge: true },
      check("output-style"),
    ])?.id,
    "claude-md",
  );
  ok("同卡還有東西等合併時攔得到，不會先驗一次半完成的狀態");

  // 沒有人等合併就照舊——不能因為這道保險讓正常流程也停下來。
  assert.equal(
    pendingMergeSibling("output-style", [
      check("claude-md"),
      check("output-style"),
    ]),
    null,
  );
  assert.equal(pendingMergeSibling("hook", [check("hook")]), null);
  ok("沒有人等合併時不擋，沒被合併的步驟也照舊");

  // 合併完要讓同卡的驗證結論作廢：那個驗證問的是「Claude 讀完 CLAUDE.md 之後怎麼
  // 回話」，合併改的正是 CLAUDE.md。不作廢的話畫面上會留一個合併前跑出來的綠勾。
  assert.deepEqual(
    mergeInvalidates("claude-md", [check("claude-md"), check("output-style")]),
    ["claude-md", "output-style"],
  );
  ok("合併 CLAUDE.md 會一起作廢同卡那個行為驗證的勾");

  // 那張卡上不存在的步驟不要一起送——清一個伺服器沒見過的 step 只是白跑一趟。
  assert.deepEqual(
    mergeInvalidates("claude-md", [check("claude-md")]),
    ["claude-md"],
  );
  // 不在任何合併群組裡的步驟只作廢自己。
  assert.deepEqual(mergeInvalidates("hook", [check("hook")]), ["hook"]);
  ok("只作廢這張卡真的有的那幾步");

  // 伺服器少回其中一份時不要整張卡消失——另一份仍該自己出現。
  const half = flattenCheckCards(
    groupChecks([check("output-style"), check("hook")]),
    [],
  );
  assert.deepEqual(
    section(half, "rules").cards.map(({ checkId }) => checkId),
    ["output-style", "hook"],
  );
  ok("只有其中一份時仍然畫得出卡片");

  // 全螢幕的三項掛在 Claude Code 那張卡上：裝好、登入了都還不算完，那三項也要
  // 勾完——不然那個 modal 會留到規則段的行為驗證中途才彈出來吃掉腳本送的句子。
  const claudeManualCard = section(flattened, "env").cards.find(
    ({ checkId }) => checkId === "claude",
  );
  assert.deepEqual(claudeManualCard.manualIds, [
    "fullscreen-yes",
    "fullscreen-mouse",
    "fullscreen-copy",
  ]);
  assert.equal(cardIsComplete(claudeManualCard, new Set(), new Set()), false);
  assert.equal(
    cardIsComplete(
      claudeManualCard,
      new Set(),
      new Set(["fullscreen-yes", "fullscreen-mouse"]),
    ),
    false,
  );
  assert.equal(
    cardIsComplete(claudeManualCard, new Set(), new Set(claudeManualCard.manualIds)),
    true,
  );
  // 其他環境卡沒掛人工項目，維持「裝好就算完」。
  const nodeCard = section(flattened, "env").cards.find(
    ({ checkId }) => checkId === "node",
  );
  assert.deepEqual(nodeCard.manualIds, []);
  assert.equal(cardIsComplete(nodeCard, new Set(), new Set()), true);
  console.log("ok - Claude Code 卡要連全螢幕三項一起勾完才算完成");

  // 貼回來的代碼前後常黏到空白或換行——圈選很難剛好停在字尾。
  assert.equal(matchesFullscreenProof(FULLSCREEN_PROOF), true);
  assert.equal(matchesFullscreenProof(`  ${FULLSCREEN_PROOF}\n`), true);
  assert.equal(matchesFullscreenProof(`${FULLSCREEN_PROOF} 這一行`), false);
  assert.equal(matchesFullscreenProof(""), false);
  assert.equal(matchesFullscreenProof(undefined), false);
  console.log("ok - 貼上的代碼去掉前後空白後才比對，多貼到別的字不算過");

  // 那一句要學生原樣貼進終端的話裡，一定要含代碼本身，否則印出來的東西對不上。
  assert.ok(FULLSCREEN_PROMPT.includes(FULLSCREEN_PROOF));
  console.log("ok - 給學生貼的那句話含有要比對的代碼");

  // 「這張卡叫什麼名字」在兩種卡上用相反的取法，而這條規則原本沒寫在任何地方：
  //
  //   env 卡     主 check 是清單的第一個   裝了再登入，第一份才是卡片的主體
  //   config 卡  主 check 是清單的最後一個 兩份都裝完才驗證，驗證掛在最後那份
  //
  // 它是那種改對了看不出來、改錯了也看不出來的規則。實際咬過一次：hook 從清單尾端
  // 搬到最前面之後，主 check 靜靜從 hook 變成 allowlist，MERGED_CARDS 的 key 沒跟著
  // 換的話整張卡的標題與說明退回單列的預設值——不報錯，只是變醜。
  const allEnvIds = [
    "execution-policy",
    "windows-terminal",
    "powershell-version",
    "powershell-encoding",
    "claude",
    "claude-auth",
    "codex",
    "codex-auth",
    "git",
    "gh",
    "gh-auth",
    "node",
    "python",
  ];
  const everyCard = flattenCheckCards(
    groupChecks(STEP_IDS.map(check)),
    allEnvIds.map(check),
  ).flatMap((group) => group.cards);

  for (const card of everyCard) {
    const ids = (card.checks ?? []).map(({ id }) => id);

    if (ids.length === 0) continue; // 選工具那張沒有 check

    const expected = card.kind === "env" ? ids[0] : ids.at(-1);
    assert.equal(
      card.checkId,
      expected,
      `${card.checkId}：env 卡的主 check 取第一個、其餘取最後一個，這張取錯了`,
    );
  }
  console.log("ok - env 卡的主 check 是清單第一個，其餘卡是最後一個");

  // MERGED_CARDS 是用主 check 的 id 當 key 查的。查不到就退回單列的預設描述，而那句
  // 是「設定 X，讓這項功能能在接下來的課程中正常使用」——對每張卡都成立，所以對每張
  // 卡都等於沒說。合併卡一旦掉回那句就代表 key 沒跟著主 check 走。
  for (const card of everyCard) {
    if (card.kind !== "config" || (card.checks ?? []).length < 2) continue;

    assert(
      !/讓這項功能能在接下來的課程中正常使用/.test(card.detail ?? ""),
      `${card.checkId}：合併卡掉回預設描述了——MERGED_CARDS 的 key 要跟著主 check 走`,
    );
  }
  console.log("ok - 每張合併卡都查得到自己的標題與說明，沒退回預設值");
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
