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
      { output: "正在請它回答一題標準問題…（要等十幾秒）" },
      LOADER_MODIFIERS.composing,
    ],
    [
      { output: "正在請它對照規則判定自己的回答…" },
      LOADER_MODIFIERS.solving,
    ],
    [
      { output: "已開啟一個新的終端視窗，正在跑驗證。" },
      LOADER_MODIFIERS.listening,
    ],
    [
      { action: "verify-in-terminal", options: { case: "demo" } },
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

  const gateId = "rules-new-terminal";
  assert.equal(sectionGateState("skills", new Set(), "claude").locked, true);
  assert.equal(
    sectionGateState("skills", new Set([gateId]), "claude").locked,
    false,
  );
  ok("人工關卡未勾時鎖住下一段，勾選後解鎖");

  assert.equal(
    sectionGateState(
      "demo",
      new Set(["skills-new-terminal"]),
      "claude",
    ).locked,
    false,
  );
  assert.equal(
    sectionGateState(
      "demo",
      new Set(["skills-new-terminal"]),
      "codex",
    ).locked,
    true,
  );
  ok("Codex hook 信任關卡只在選了 Codex 時生效");

  const behaviorScript = readFileSync(
    new URL("../scripts/verify-behavior.mjs", import.meta.url),
    "utf8",
  );
  const terminalScript = readFileSync(
    new URL("../scripts/verify-in-terminal.mjs", import.meta.url),
    "utf8",
  );

  for (const text of [
    "正在請它回答一題標準問題",
    "正在請它對照規則判定自己的回答",
  ]) {
    assert(
      behaviorScript.includes(text),
      `verify-behavior.mjs 缺少動畫切換字串「${text}」`,
    );
  }
  assert(
    terminalScript.includes("已開啟一個新的終端視窗"),
    "verify-in-terminal.mjs 缺少動畫切換字串",
  );
  ok("三個動畫切換字串真的存在於對應腳本");
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
