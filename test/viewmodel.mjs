import assert from "node:assert/strict";

import {
  BEHAVIOR_CHECKLIST,
  BEHAVIOR_QUESTION,
  LOGIN_WAIT_TIMEOUT_MS,
  AUTO_VERIFY_ACTIONS,
  agentNameFor,
  behaviorFallbackState,
  configRowModel,
  configSummary,
  envButtonState,
  envRowModel,
  extractLoginHints,
  installStatusMessage,
  isLoginAction,
  loginWaitStep,
  rowRunOptions,
  runControlsState,
  runOutcome,
} from "../public/viewmodel.js";
import {
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
  assert.deepEqual(
    pending.buttons.map((button) => button.text),
    ["安裝", "驗證"],
  );
  ok("結構齊全但沒驗過行為的列不給綠燈，安裝與驗證按鈕都在");

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
  assert.deepEqual(verified.buttons, []);
  ok("驗過之後才變綠，按鈕收起來");

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
