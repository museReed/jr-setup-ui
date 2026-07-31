import assert from "node:assert/strict";

import { GUIDANCE } from "../public/model.js";
import { guidanceModel } from "../public/viewmodel.js";
import {
  actions,
  shouldExplainOutput,
} from "../src/actions.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

try {
  for (const status of ["warn", "missing"]) {
    const guidance = guidanceModel({ step: "hook", status });
    assert.equal(guidance.symptom, GUIDANCE.hook.symptom);
    assert.equal(guidance.expected, GUIDANCE.hook.expected);
    assert.deepEqual(guidance.checks, GUIDANCE.hook.checks);
  }
  ok("有登記的 step 在 warn / missing 時產出就地引導");

  assert.equal(guidanceModel({ step: "not-registered", status: "warn" }), null);
  assert.equal(guidanceModel({ step: "hook", status: "ok" }), null);
  ok("沒登記的 step 與成功狀態不產出引導");

  assert.notEqual(
    guidanceModel({ step: "hook", status: "ok", failed: true }),
    null,
  );
  ok("剛執行失敗的已登記 step 仍會產出引導");

  const withDiagnose = guidanceModel({
    step: "claude-namer",
    status: "warn",
    availableActions: new Set(["diagnose-naming-block"]),
  });
  assert.deepEqual(withDiagnose.diagnoseButton, {
    action: "diagnose-naming-block",
    text: "一鍵診斷",
    step: "claude-namer",
  });
  assert.equal(
    guidanceModel({ step: "hook", status: "warn" }).diagnoseButton,
    null,
  );
  ok("有 diagnose 的 step 掛診斷按鈕，沒有的 step 不掛");

  assert.equal(
    guidanceModel({
      step: "tab-sync",
      status: "warn",
      availableActions: new Set(["diagnose-naming-block"]),
    }).diagnoseButton,
    null,
  );
  ok("目前平台沒註冊的診斷 action 不會出現在列上");

  for (const step of [
    "ext-frontend-design-claude",
    "ext-frontend-design-codex",
    "ext-skill-creator-claude",
    "ext-playwright-codex",
    "ext-playwright-claude",
  ]) {
    assert.notEqual(GUIDANCE[step], undefined);
  }
  ok("所有第三方 ext-* 列都有具體的失敗引導");

  const failed = { exitCode: 1, signal: null, benign: false };
  assert.equal(
    shouldExplainOutput({ action: "install-gh", result: failed }),
    true,
  );
  assert.equal(
    shouldExplainOutput({
      action: "install-config-step",
      options: { step: "ext-playwright-codex" },
      result: failed,
    }),
    true,
  );
  assert.equal(
    shouldExplainOutput({ action: "ext-custom-skill", result: failed }),
    true,
  );
  assert.equal(
    shouldExplainOutput({
      action: "install-config-step",
      options: { step: "hook" },
      result: failed,
    }),
    false,
  );
  assert.equal(
    shouldExplainOutput({ action: "verify-hook-live", result: failed }),
    false,
  );
  assert.equal(
    shouldExplainOutput({
      action: "install-gh",
      result: { exitCode: 0, signal: null, benign: false },
    }),
    false,
  );
  ok("只翻譯失敗的環境安裝與 ext-* 第三方 action");

  assert.equal(actions["diagnose-naming-block"].kind, "fixed");
  assert.deepEqual(actions["diagnose-naming-block"].options.step, [
    "claude-namer",
    "skill-claude-handoff",
  ]);

  if (process.platform === "win32") {
    assert.equal(actions["diagnose-title-path"].kind, "fixed");
  } else {
    assert.equal(actions["diagnose-title-path"], undefined);
  }
  ok("診斷 action 使用固定指令，Windows 專屬 action 只在 win32 註冊");
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
