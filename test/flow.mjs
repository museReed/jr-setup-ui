import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { sectionGateState } from "../public/model.js";
import {
  LOADER_MODIFIERS,
  installVerificationFollowUp,
  loaderModifier,
} from "../public/viewmodel.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

try {
  const success = { exitCode: 0, signal: null };

  assert.equal(
    installVerificationFollowUp({
      action: "install-config-step",
      result: success,
      check: {
        verifyAction: "verify-behavior",
        verifyKind: "page",
      },
    }),
    "auto",
  );
  ok("安裝成功後，頁面驗證會自動接著跑");

  assert.equal(
    installVerificationFollowUp({
      action: "install-config-step",
      result: success,
      check: {
        verifyAction: "verify-in-terminal",
        verifyKind: "terminal",
      },
    }),
    "prompt",
  );
  ok("安裝成功後，終端驗證會先詢問");

  assert.equal(
    installVerificationFollowUp({
      action: "install-config-step",
      result: { exitCode: 1, signal: null },
      check: {
        verifyAction: "verify-behavior",
        verifyKind: "page",
      },
    }),
    "none",
  );
  ok("安裝失敗後不接驗證");

  const loaderCases = [
    [{ checking: true }, LOADER_MODIFIERS.searching],
    [{ action: "install-config-step" }, LOADER_MODIFIERS.working],
    [
      { jrEvent: { kind: "stage", stage: "asking" } },
      LOADER_MODIFIERS.composing,
    ],
    [
      { jrEvent: { kind: "stage", stage: "judging" } },
      LOADER_MODIFIERS.solving,
    ],
    [
      { jrEvent: { kind: "stage", stage: "waiting" } },
      LOADER_MODIFIERS.listening,
    ],
    [
      { jrEvent: { kind: "stage", stage: "shaping" } },
      LOADER_MODIFIERS.shaping,
    ],
    [
      { result: { exitCode: null, signal: "SIGTERM" } },
      LOADER_MODIFIERS.paused,
    ],
    [
      { result: { exitCode: 1, signal: null } },
      LOADER_MODIFIERS.paused,
    ],
  ];

  for (const [context, expected] of loaderCases) {
    assert.equal(loaderModifier(context), expected);
  }
  ok("檢查、安裝、行為驗證、終端等待、demo 與停止狀態各用正確動畫");

  for (const [output, expected] of [
    ["正在請它回答一題標準問題", LOADER_MODIFIERS.composing],
    ["正在請它對照規則判定自己的回答", LOADER_MODIFIERS.solving],
    ["已開啟一個新的終端視窗", LOADER_MODIFIERS.listening],
  ]) {
    assert.equal(loaderModifier({ output }), expected);
  }
  ok("舊版腳本的中文輸出仍可切換動畫");

  // 兩道「關掉分頁、開新的」都拿掉了：所有驗證都走 verify-in-terminal，它每次自己
  // 開一個全新的終端視窗。段落現在只由「上一段做完了沒」決定，不再有人工關卡。
  assert.equal(
    sectionGateState("skills", new Set(), "claude", { env: true, rules: true })
      .locked,
    false,
  );
  assert.equal(
    sectionGateState("demo", new Set(), "claude", {
      env: true,
      rules: true,
      skills: true,
    }).locked,
    false,
  );
  assert.equal(
    sectionGateState("demo", new Set(), "claude", {
      env: true,
      rules: true,
      skills: false,
    }).locked,
    true,
  );
  ok("段落只由前面幾段是否完成決定，沒有人工關卡");

  // 只看上一段的話會出現「①鎖著②開著③又開了」這種自相矛盾的畫面：第一段沒做完
  // 鎖住第二段，第二段做完了卻把第三段開了（Reed 實測）。卡片之間有相依性，跳著
  // 做的話後面那段做了也不會過，所以前面任一段沒完成就一路鎖到底。
  const skippedFirst = sectionGateState("skills", new Set(), "claude", {
    env: false,
    rules: true,
  });
  assert.equal(skippedFirst.locked, true);
  // 點名最早那一段，不是上一段——中間幾段擋人的理由都源自它。
  assert.match(skippedFirst.reason, /讓 AI 能跑起來/);
  assert.equal(
    sectionGateState("demo", new Set(), "claude", {
      env: false,
      rules: true,
      skills: true,
    }).locked,
    true,
  );
  ok("前面任一段沒做完就一路鎖住後面所有段，訊息點名最早那一段");

  // 第一段永遠沒有上一段，所以永遠是開的——學生一進來就有事可做。
  assert.equal(sectionGateState("env", new Set(), "claude").locked, false);
  ok("第一段永遠不鎖");

  // 資料還沒回來（undefined）也算沒做完，一樣擋著。
  //
  // 原本只擋 false，理由是「寧可放行也不要在載入中把人鎖在外面」。VM 的紀錄器
  // 顯示那個代價是實的：開頁最初 8.4 秒，技能包與 demo 兩段都是解鎖狀態，手快的
  // 學生點得進去，然後才被鎖回來。
  const checking = sectionGateState("skills", new Set(), "claude");
  assert.equal(checking.locked, true);
  assert.match(checking.reason, /正在檢查目前進度/);
  // 話要跟「確定沒做完」分開講：資料還沒回來時說「先把某某做完」是在講一件我們
  // 並不知道的事。
  assert.doesNotMatch(checking.reason, /先把/);
  ok("上一段的資料還沒回來時擋著，而且說的是「正在檢查」不是「先去做完」");

  // 擋人的時候要指名是哪一張卡。只說「先把上一段做完」的話，學生站在那一段的最後
  // 一張、畫面顯示已完成，卻被告知這段沒做完——只能一張一張往回翻（VM 實測）。
  const blockedOne = sectionGateState(
    "skills",
    new Set(),
    "claude",
    { env: true, rules: false },
    { rules: [{ label: "Claude 自動命名 hook", index: 5 }] },
  );
  assert.equal(blockedOne.locked, true);
  assert.match(blockedOne.reason, /Claude 自動命名 hook/);
  assert.match(blockedOne.reason, /第 6 張/);
  ok("鎖定訊息指名還沒完成的那張卡與它是第幾張");

  // 列滿七張只會變成另一種看不懂，所以只點名前兩張。
  const blockedMany = sectionGateState(
    "skills",
    new Set(),
    "claude",
    { env: true, rules: false },
    {
      rules: [
        { label: "A", index: 0 },
        { label: "B", index: 1 },
        { label: "C", index: 2 },
      ],
    },
  );
  assert.match(blockedMany.reason, /「A」（第 1 張）、「B」（第 2 張）等 3 張/);
  ok("沒完成的卡超過兩張時只點名前兩張，其餘用張數帶過");

  // 拿不到清單時仍要有話講，不能變成空訊息。
  const noBlockers = sectionGateState("skills", new Set(), "claude", {
    env: true,
    rules: false,
  });
  assert.match(noBlockers.reason, /讓它照你的規矩回話/);
  ok("沒有卡片清單時退回原本的段落名稱訊息");

  assert.equal(
    sectionGateState(
      "demo",
      new Set(["skills-new-terminal"]),
      "claude",
      { env: true, rules: true, skills: true },
    ).locked,
    false,
  );
  ok("Demo 段的人工關卡勾完就解鎖");

  // 解鎖還要看前一段是不是真的做完，不能只看勾選框——勾選框是學生自己宣告，
  // 擋不住「前面根本沒做完」。規則段沒裝好就跳去裝技能包，skill 裝了也叫不動。
  assert.equal(
    sectionGateState("rules", new Set(), "claude", { env: false }).locked,
    true,
  );
  assert.equal(
    sectionGateState("rules", new Set(), "claude", { env: true }).locked,
    false,
  );
  assert.equal(
    sectionGateState(
      "skills",
      new Set(["rules-new-terminal"]),
      "claude",
      { env: true, rules: false },
    ).locked,
    true,
  );
  // 資料還沒回來時是 undefined，一樣擋著（見上面「正在檢查目前進度」那一段的
  // 理由：放行的那幾秒學生真的點得進去）。
  assert.equal(
    sectionGateState("rules", new Set(), "claude", {}).locked,
    true,
  );
  ok("前一段沒真的完成就鎖住下一段，狀態未知時也擋");

  const behaviorScript = readFileSync(
    new URL("../scripts/verify-behavior.mjs", import.meta.url),
    "utf8",
  );
  const terminalScript = readFileSync(
    new URL("../scripts/verify-in-terminal.mjs", import.meta.url),
    "utf8",
  );

  for (const stage of ["asking", "judging"]) {
    assert(
      behaviorScript.includes(`stage: "${stage}"`),
      `verify-behavior.mjs 缺少 stage 事件「${stage}」`,
    );
  }
  for (const stage of ["waiting", "shaping"]) {
    assert(
      terminalScript.includes(`"${stage}"`),
      `verify-in-terminal.mjs 缺少 stage 事件「${stage}」`,
    );
  }
  ok("四個 stage 事件真的存在於對應腳本");
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
