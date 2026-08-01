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
  assert.equal(sectionGateState("skills", new Set(), "claude").locked, false);
  assert.equal(sectionGateState("demo", new Set(), "claude").locked, false);
  assert.equal(
    sectionGateState("demo", new Set(), "claude", { skills: false }).locked,
    true,
  );
  ok("段落只由上一段是否完成決定，沒有人工關卡");

  // 擋人的時候要指名是哪一張卡。只說「先把上一段做完」的話，學生站在那一段的最後
  // 一張、畫面顯示已完成，卻被告知這段沒做完——只能一張一張往回翻（VM 實測）。
  const blockedOne = sectionGateState(
    "skills",
    new Set(),
    "claude",
    { rules: false },
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
    { rules: false },
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
    rules: false,
  });
  assert.match(noBlockers.reason, /讓它照你的規矩回話/);
  ok("沒有卡片清單時退回原本的段落名稱訊息");

  assert.equal(
    sectionGateState(
      "demo",
      new Set(["skills-new-terminal"]),
      "claude",
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
      { rules: false },
    ).locked,
    true,
  );
  // 資料還沒回來時是 undefined，不該把人鎖在外面。
  assert.equal(
    sectionGateState("rules", new Set(), "claude", {}).locked,
    false,
  );
  ok("前一段沒真的完成就鎖住下一段，狀態未知時不擋");

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
