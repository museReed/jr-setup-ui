import assert from "node:assert/strict";

import {
  FULLSCREEN_PROMPT,
  FULLSCREEN_PROOF,
  SECTIONS,
  flattenCheckCards,
  groupChecks,
  matchesFullscreenProof,
} from "../public/model.js";
import {
  cardIsComplete,
  envLogoFor,
  progressSummary,
} from "../public/viewmodel.js";

function check(id) {
  return { id, label: id, status: "ok", detail: "已安裝" };
}

function section(groups, sectionId) {
  return groups.find((group) => group.sectionId === sectionId);
}

try {
  assert.deepEqual(
    SECTIONS.map(({ id }) => id),
    ["env", "rules", "skills", "demo"],
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
        "ghostty",
      ].map(check),
    ),
    "env",
  );
  // fullscreen 一定排在環境段最後：那個「換不換新畫面模式」的方框是第一次跑
  // claude 才跳，排在規則段的行為驗證之前才擋得住它中途彈出來吃掉腳本送的句子。
  assert.deepEqual(
    envSequence.cards.map(({ checkId }) => checkId),
    [
      "env-config",
      "claude",
      "codex",
      "git",
      "gh",
      "node",
      "ghostty",
      "fullscreen",
    ],
  );

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
  assert.equal(section(flattened, "env").cards.length, 5);
  assert.deepEqual(
    section(flattened, "env").cards.map(({ checkId }) => checkId),
    ["env-config", "claude", "codex", "node", "fullscreen"],
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

  // 全螢幕模式那張卡：整張都是人工項目，勾滿才算走完。
  const fullscreenCard = section(flattened, "env").cards.at(-1);
  assert.equal(fullscreenCard.kind, "manual");
  assert.deepEqual(fullscreenCard.manualIds, [
    "fullscreen-yes",
    "fullscreen-mouse",
    "fullscreen-copy",
  ]);
  assert.equal(cardIsComplete(fullscreenCard, new Set(), new Set()), false);
  assert.equal(
    cardIsComplete(
      fullscreenCard,
      new Set(),
      new Set(["fullscreen-yes", "fullscreen-mouse"]),
    ),
    false,
  );
  assert.equal(
    cardIsComplete(fullscreenCard, new Set(), new Set(fullscreenCard.manualIds)),
    true,
  );
  console.log("ok - 全螢幕模式卡勾滿三項才算完成");

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
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
