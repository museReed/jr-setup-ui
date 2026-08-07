import assert from "node:assert/strict";

import {
  FULLSCREEN_PROMPT,
  FULLSCREEN_PROOF,
  GUIDANCE,
  SECTIONS,
  flattenCheckCards,
  groupChecks,
  matchesFullscreenProof,
  nextInstallStep,
} from "../public/model.js";
import {
  cardIsComplete,
  envLogoFor,
  progressSummary,
} from "../public/viewmodel.js";
import { STEP_IDS, describeStep } from "../src/config-install.js";

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
  // 筆記那一段排在主線之後：它是選配，跟前面四段沒有依賴關係。
  assert.deepEqual(
    SECTIONS.map(({ id }) => id),
    ["env", "rules", "skills", "demo", "notes"],
  );

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
  // mac 的順序：終端機那張排到最前面（跟 Windows 的「先準備好」同一格），Git 與
  // GitHub 合成一張，Node 與 Python 合成一張。
  assert.deepEqual(
    envSequence.cards.map(({ checkId }) => checkId),
    ["env-config", "ghostty", "claude", "codex", "git", "node"],
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
    ["env-config", "execution-policy", "claude", "git", "node"],
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
      // 擋串接與白名單寫的是同一個 settings.json，講的也是同一件事。hook 排前面：
      // 先看到「該擋的擋下來」，再看「不該問的不問」，順序才講得通。
      //
      // 主 check 跟著變成 allowlist（checks.at(-1)），MERGED_CARDS 的 key 也要跟著
      // 換——沒換的話標題與說明會靜靜退回單列的預設值，下面兩條 assert 就是在防這個。
      ["allowlist", "hook+allowlist"],
      ["codex-config", "codex-agents+codex-config"],
    ],
  );
  const permissionCard = mergedRules[1];
  assert.match(permissionCard.label, /什麼時候該停下來問你/);
  assert.match(permissionCard.detail, /改檔案不再逐次問你/);
  assert.deepEqual(
    permissionCard.checks.map(({ id }) => id),
    ["hook", "allowlist"],
    "先擋串接再講白名單",
  );
  ok("擋串接與白名單合成一張權限卡，hook 排前面、主 check 是 allowlist");
  assert.match(
    mergedRules[0].label,
    /規矩與回話風格/,
    "合併後的卡要有自己的標題，不能沿用其中一半的",
  );
  assert.match(mergedRules[0].detail, /兩份/);
  ok("規矩與回話風格合成一張卡，主 check 是帶驗證的那一份");

  // 裝完第一份要接著裝第二份，兩份都好了才輪到驗證。
  assert.equal(
    nextInstallStep("claude-md", [
      check("claude-md"),
      { ...check("output-style"), status: "missing" },
    ])?.id,
    "output-style",
  );
  // 第二份已經好了就沒有下一步，直接進驗證。
  assert.equal(
    nextInstallStep("claude-md", [check("claude-md"), check("output-style")]),
    null,
  );
  // 最後那份裝完之後也沒有下一步——它自己就是驗證要跑的那一份。
  assert.equal(nextInstallStep("output-style", [check("claude-md")]), null);
  // 沒有被合併的步驟照舊。
  assert.equal(nextInstallStep("hook", [check("hook")]), null);
  ok("裝完第一份會接著裝第二份，都好了才輪到驗證");

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
