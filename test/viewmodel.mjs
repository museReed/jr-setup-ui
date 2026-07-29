import assert from "node:assert/strict";

import {
  CONFIG_LANGUAGES,
  CONFIG_TOOL_CHOICES,
  LOGIN_WAIT_TIMEOUT_MS,
  agentNameFor,
  configQuery,
  configRowModel,
  configSummary,
  envButtonState,
  envRowModel,
  extractLoginHints,
  installStatusMessage,
  isLoginAction,
  loginWaitStep,
  runControlsState,
  runOutcome,
} from "../public/viewmodel.js";

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
    ["登入"],
  );
  ok("執行原則是「修正」、登入狀態是「登入」");

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
