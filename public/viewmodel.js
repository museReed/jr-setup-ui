// ViewModel：畫面「該長什麼樣」的所有判斷都在這裡。
// 不碰 DOM、不碰 fetch，所以可以在 Node 裡直接單元測試。
// View 只負責把這裡算出來的結果畫出去。

export const LOGIN_CHECK_IDS = {
  "login-claude": "claude-auth",
  "login-codex": "codex-auth",
  "login-gh": "gh-auth",
};

export const LOGIN_POLL_INTERVAL_MS = 5_000;
export const LOGIN_WAIT_TIMEOUT_MS = 5 * 60_000;

export const BEHAVIOR_QUESTION =
  "我想開始經營個人品牌，Instagram 和 YouTube 我該先從哪個開始？";
// 這五條要跟 scripts/verify-behavior.mjs 裡 AI 判定用的規則一字對得上，
// 否則學生照清單自己看，會跟按鈕跑出來的結果不一致。
export const BEHAVIOR_CHECKLIST = [
  "結論先行：第一行就是粗體結論，不是「好問題！」這種開場白。",
  "比較用表格：兩個平台的比較用表格，不是散文。",
  "語氣中性：沒有 emoji、沒有「太棒了！」這類慶祝語氣。",
  "長度中等：精簡到可以行動，不是長篇大論。",
  "追問清單：結尾有「你可能會想問」之類的追問清單。",
];

const STATUS_DISPLAY = {
  ok: { symbol: "✓", label: "通過" },
  missing: { symbol: "✗", label: "缺少" },
  warn: { symbol: "!", label: "需處理" },
  unverified: { symbol: "◐", label: "待驗證" },
};

const ENV_LOGOS = {
  claude: "logo-claude",
  "claude-auth": "logo-claude",
  codex: "logo-openai",
  "codex-auth": "logo-openai",
  git: "logo-git",
  gh: "logo-github",
  "gh-auth": "logo-github",
  node: "logo-nodejs",
  "execution-policy": "logo-powershell",
  "powershell-version": "logo-powershell",
  "powershell-encoding": "logo-powershell",
  "windows-terminal": "logo-terminal",
  ghostty: "logo-terminal",
  terminal: "logo-terminal",
  homebrew: "logo-homebrew",
};

export function envLogoFor(checkId) {
  return ENV_LOGOS[checkId] ?? null;
}

// 列上的按鈕一律帶齊這三個參數。伺服器只認 action 自己宣告的那幾個、其餘忽略，
// 所以多帶不會出事，少帶會被擋（實測：列上的「驗證回覆格式」只帶了 step 與 lang，
// 伺服器回「options.tools 不在允許的值裡」，按鈕等於是死的）。
export function rowRunOptions({ step, lang, tools, extra = null }) {
  return { step, lang, tools, ...(extra ?? {}) };
}

// 只有「跑完就知道結果」的驗證能自動標綠，而且只標「被按的那一列」。
//
// 先前是一顆按鈕標一整組（verify-behavior 一次標四列），結果按 CLAUDE.md 那列
// 的驗證，codex 的兩列跟著變綠、按鈕消失——它們根本沒被測到（VM 實測）。又是
// 假綠燈。
//
// 開終端那種不在這裡：按下去只是開了一個視窗，證明什麼要由學生看完再勾。
export const AUTO_VERIFY_ACTIONS = new Set([
  "verify-behavior",
  "verify-in-terminal",
]);

export function isLoginAction(action) {
  return typeof action === "string" && action.startsWith("login-");
}

export function agentNameFor(action) {
  if (typeof action !== "string") {
    return "";
  }

  if (action.startsWith("claude") || action === "merge-config-step") {
    return "Claude";
  }

  return action.startsWith("codex") ? "Codex" : "";
}

// 登入指令把網址和代碼混在一般輸出裡，要挑出來變成可點的連結與可複製的代碼。
export function extractLoginHints(text) {
  if (typeof text !== "string") {
    return { url: null, code: null };
  }

  const urlMatch = text.match(/https:\/\/\S+/);
  const codeMatch = text.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/i);

  return {
    url: urlMatch === null ? null : urlMatch[0].replace(/[.,)]+$/, ""),
    code: codeMatch === null ? null : codeMatch[0],
  };
}

// 一列環境檢查結果要畫成什麼：圖示、文字、後面掛哪幾顆按鈕。
export function envRowModel(check) {
  const display = STATUS_DISPLAY[check.status] ?? STATUS_DISPLAY.warn;
  const buttons = [];

  if (check.installAction !== null && check.installAction !== undefined) {
    buttons.push({
      action: check.installAction,
      dataName: "installAction",
      text: "安裝",
    });
  }

  if (check.fixAction !== null && check.fixAction !== undefined) {
    buttons.push({
      action: check.fixAction,
      dataName: "fixAction",
      text: check.id === "execution-policy" ? "修正" : "登入",
    });
  }

  return {
    status: check.status,
    symbol: display.symbol,
    ariaLabel: display.label,
    label: check.label,
    detail: check.detail,
    buttons,
  };
}

// 結構齊全但行為還沒驗過的列不給綠燈：綠燈就沒有安裝按鈕，學生連重跑的機會都
// 沒有。實測踩過四次「裝好了、綠燈、就是不生效」，詳見
// docs/wizard-verification-design.md。
export function configRowModel(check, verified = false) {
  const pending =
    check.status === "ok" &&
    !verified &&
    (check.verifyAction != null || check.eyeCheck != null);
  const status = pending ? "unverified" : check.status;
  const display = STATUS_DISPLAY[status] ?? STATUS_DISPLAY.warn;
  const buttons = [];

  // 待驗證的列也要留安裝按鈕——重跑安裝是學生手上唯一的自救手段。
  // 例外是 demo 那種「沒有東西可裝」的列（noInstall）：補了按鈕按下去只會失敗。
  const installAction =
    check.installAction ??
    (pending && check.noInstall !== true ? "install-config-step" : null);

  if (installAction !== null && installAction !== undefined) {
    buttons.push({
      action: installAction,
      dataName: "installAction",
      text: "安裝",
      step: check.id,
    });
  }

  if (check.verifyAction != null && !verified) {
    buttons.push({
      action: check.verifyAction,
      dataName: "verifyAction",
      // demo 那列按下去是「跑給你看」不是「驗證有沒有裝好」，按鈕跟著改字。
      text:
        check.verifyKind !== "terminal"
          ? "驗證"
          : check.noInstall === true
            ? "開終端跑"
            : "開終端驗證",
      step: check.id,
      options: check.verifyOptions ?? undefined,
    });
  }

  if (check.mergeAction !== null && check.mergeAction !== undefined) {
    buttons.push({
      action: check.mergeAction,
      dataName: "mergeAction",
      text: "用 AI 合併",
      step: check.id,
    });
  }

  return {
    status,
    symbol: display.symbol,
    ariaLabel: display.label,
    label: check.label,
    detail: pending ? `${check.detail}——尚未驗證真的生效` : check.detail,
    buttons,
    // 只有真終端看得到的那一格：程式驗不到，讓學生看完回來勾。
    eyeCheck: pending && check.eyeCheck != null ? check.eyeCheck : null,
    verified,
  };
}

export function configSummary(checks, verifiedSteps = new Set()) {
  const total = checks.length;

  if (total === 0) {
    return {
      done: 0,
      total: 0,
      allOk: false,
      text: "尚未檢查",
    };
  }

  // 「就緒」的門檻跟列上的綠燈同一條：結構齊全，而且該驗的行為也驗過了。
  const done = checks.filter(
    (check) =>
      configRowModel(check, verifiedSteps.has(check.id)).status === "ok",
  ).length;

  return {
    done,
    total,
    allOk: done === total,
    text: `${total} 項中 ${done} 項就緒`,
  };
}

export function progressSummary(
  envChecks,
  configChecks,
  verifiedSteps = new Set(),
) {
  if (envChecks === null || configChecks === null) {
    return { loading: true, done: 0, total: 0, percent: 0 };
  }

  const envDone = envChecks.filter((check) => check.status === "ok").length;
  const configDone = configChecks.filter(
    (check) =>
      configRowModel(check, verifiedSteps.has(check.id)).status === "ok",
  ).length;
  const total = envChecks.length + configChecks.length;
  const done = envDone + configDone;

  return {
    loading: false,
    done,
    total,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
  };
}

// 環境檢查那一區的按鈕：跑東西時全部鎖住，正在跑的那顆改成「安裝中…」，
// 等登入結果的那顆改成「等待登入中…」。
export function envButtonState({
  action,
  idleText,
  runInProgress,
  currentEnvAction,
  waitingAction,
}) {
  const waiting = waitingAction === action;

  if (waiting) {
    return { disabled: true, text: "等待登入中…" };
  }

  if (runInProgress && action === currentEnvAction) {
    return { disabled: true, text: `${idleText}中…` };
  }

  return { disabled: Boolean(runInProgress), text: idleText };
}

// 執行中／閒置時，畫面上各個控制項的開關。
export function runControlsState({
  runInProgress,
  runId,
  acceptsInput,
  envCheckInProgress,
  configCheckInProgress,
}) {
  const hasRun = runId !== null && runId !== undefined;

  return {
    actionButtonsDisabled: runInProgress,
    promptDisabled: runInProgress,
    allowWriteDisabled: runInProgress,
    recheckDisabled: runInProgress || envCheckInProgress,
    configControlsDisabled: Boolean(runInProgress || configCheckInProgress),
    cancelHidden: !runInProgress,
    cancelDisabled: !runInProgress || !hasRun,
    // 只有「會等輸入」的動作才給那格貼代碼的輸入列。
    inputHidden: !runInProgress || !hasRun || !acceptsInput,
  };
}

// benign：安裝器回報「已經裝好了／沒有可用更新」，那不是失敗。
export function runOutcome(result) {
  const succeeded = result.exitCode === 0 || result.benign === true;

  return {
    succeeded,
    summary:
      result.signal === null || result.signal === undefined
        ? `exit code: ${result.exitCode}`
        : `已停止：${result.signal}`,
    className: succeeded ? "succeeded" : "failed",
  };
}

export function behaviorFallbackState(result) {
  const { succeeded } = runOutcome(result);

  return {
    visible: !succeeded,
    question: succeeded ? "" : BEHAVIOR_QUESTION,
    checklist: succeeded ? [] : BEHAVIOR_CHECKLIST,
  };
}

// 環境檢查那一區的狀態列要說什麼。null 代表不用顯示。
export function installStatusMessage(action, result) {
  const { succeeded } = runOutcome(result);

  if (!succeeded) {
    return {
      text: action.startsWith("install-")
        ? "安裝失敗，請看下方輸出"
        : "執行失敗，請看下方輸出",
      failed: true,
    };
  }

  if (isLoginAction(action)) {
    // 登入成功不在這裡報告——要等輪詢確認狀態真的變綠。
    return null;
  }

  if (action === "fix-execution-policy") {
    return { text: "已改為 RemoteSigned，狀態已更新。", failed: false };
  }

  return {
    text:
      result.benign === true
        ? "這個項目本來就已經裝好了，狀態已更新。"
        : "安裝完成，狀態已更新。",
    failed: false,
  };
}

// 等登入變綠的輪詢：該收工、該再等一輪、還是逾時放棄。
export function loginWaitStep({ startedAt, now, checks, checkId }) {
  if (Array.isArray(checks)) {
    const check = checks.find((candidate) => candidate.id === checkId);

    if (check?.status === "ok") {
      return { kind: "done", text: "登入成功。", failed: false };
    }
  }

  if (now - startedAt >= LOGIN_WAIT_TIMEOUT_MS) {
    return {
      kind: "timeout",
      text: "等待逾時，請確認登入是否完成，或按重新檢查。",
      failed: true,
    };
  }

  return { kind: "pending" };
}
