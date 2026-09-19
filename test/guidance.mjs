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
  const guidance = guidanceModel({ step: "hook", status: "warn" });
  assert.equal(guidance.symptom, GUIDANCE.hook.symptom);
  assert.equal(guidance.expected, GUIDANCE.hook.expected);
  assert.deepEqual(guidance.checks, GUIDANCE.hook.checks);
  ok("有登記的 step 在 warn 時產出就地引導");

  // ⚠️ missing（還沒裝）不給引導。GUIDANCE 每一段的文案都假設「已經裝了、但不
  // 生效」——「名字已經寫進同步檔，但終端分頁標題沒有動」。原本 missing 也顯示，
  // 於是每一張還沒開始做的卡都提前印一段講還沒發生的事的診斷（VM 實測：分頁標題
  // 那張 0/3 就在講標題沒換）。還沒裝的人需要的是安裝鍵。
  assert.equal(guidanceModel({ step: "hook", status: "missing" }), null);
  assert.equal(guidanceModel({ step: "not-registered", status: "warn" }), null);
  assert.equal(guidanceModel({ step: "hook", status: "ok" }), null);
  ok("還沒裝、沒登記的 step、成功狀態都不產出引導");

  assert.notEqual(
    guidanceModel({ step: "hook", status: "ok", failed: true }),
    null,
  );
  ok("剛執行失敗的已登記 step 仍會產出引導");

  // 一鍵診斷那顆按鈕的機制還在，但目前沒有任何一列掛得上——唯一掛過的是自動命名
  // 那幾列，已經隨 archive/auto-rename/ 下架。這裡守著「沒有人掛時不會冒出按鈕」。
  assert.equal(
    guidanceModel({ step: "hook", status: "warn" }).diagnoseButton,
    null,
  );
  assert.equal(
    guidanceModel({
      step: "shell-wrapper",
      status: "warn",
      availableActions: new Set(["fix-shell-wrapper"]),
    })?.diagnoseButton ?? null,
    null,
  );
  ok("沒有 step 掛診斷按鈕時，列上也不會冒出那顆")

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

  // 自動命名下架後，這兩顆診斷鍵跟著封存（archive/auto-rename/）。守著它們沒有
  // 被留下來——留著的話按下去會執行一支不存在的腳本。
  assert.equal(actions["diagnose-naming-block"], undefined);
  assert.equal(actions["diagnose-title-path"], undefined);

  // Windows 專屬 action 仍然只在 win32 註冊。
  if (process.platform === "win32") {
    assert.equal(actions["fix-execution-policy"].kind, "fixed");
  } else {
    assert.equal(actions["fix-execution-policy"], undefined);
  }
  ok("已下架的診斷鍵不再註冊，Windows 專屬 action 只在 win32 註冊");

  // ⚠️ 自救說明是給學生照著做的，不是給他讀的診斷報告。pwsh-store 那段原本八條，
  // 攤在卡片上是一整面字——而學生只需要「按那顆鍵 → 確認 → 按鈕失敗就下載 .msi」。
  //
  // 兩條特別不能回來（Reed 指定）：
  //
  //   unelevated 那條  它會**弱化沙箱**，學生照做時不知道自己放棄了什麼。那是助教
  //                    當場判斷的事，完整說法在 docs/returning-students.md
  //   issue 編號       「不是嚮導壞了」有安撫價值，但編號本身是噪音
  const pwshChecks = GUIDANCE["pwsh-store"].checks;
  assert.ok(
    pwshChecks.length <= 4,
    `自救說明超過四條就是在寫報告了：現在 ${pwshChecks.length} 條`,
  );
  assert.ok(!pwshChecks.some((line) => line.includes("unelevated")));
  assert.ok(!pwshChecks.some((line) => line.includes("#35871")));
  // 學生真正要做的那三件事還在。
  assert.ok(pwshChecks.some((line) => line.includes("換成一般安裝版")));
  assert.ok(pwshChecks.some((line) => line.includes("where.exe pwsh")));
  assert.ok(pwshChecks.some((line) => line.includes("aka.ms/PSWindows")));
  ok("Store 版那段只留學生做得到的四條，繞過沙箱的那條不在畫面上");
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
