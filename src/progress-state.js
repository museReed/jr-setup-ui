import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describeStep } from "./config-install.js";
import { ensureWorkDir } from "./paths.js";

const VERSION = 1;

function locations(options) {
  if (options.home !== undefined && options.stateFile !== undefined) {
    return { home: options.home, stateFile: options.stateFile };
  }

  const root = path.dirname(ensureWorkDir());

  return {
    home: options.home ?? path.dirname(root),
    stateFile: options.stateFile ?? path.join(root, "state.json"),
  };
}

function installedTargets(step) {
  if (step.kind === "copy") {
    return [step.target];
  }

  if (step.kind === "output-style" || step.kind === "hook") {
    return [step.target, step.settingsTarget];
  }

  if (step.kind === "allowlist") {
    return [step.settingsTarget];
  }

  if (step.kind === "tab-sync") {
    return [step.target, step.rcTarget];
  }

  if (step.kind === "agent-hooks") {
    return [
      ...step.hookFiles.map((file) => file.target),
      ...step.supportFiles.map((file) => file.target),
      step.settingsTarget,
    ];
  }

  if (step.kind === "skill") {
    return step.files.map((file) => file.target);
  }

  if (step.kind === "external-skill") {
    return [step.marker ?? step.mcpConfig];
  }

  return [];
}

// 兩本帳，因為它們回答的是兩個不同的問題：
//
//   verified  這一列整個綠了嗎——有眼睛勾選框的列，要學生看完畫面說了算
//   behavior  程式跑得出來的那半驗過了嗎——跟學生有沒有勾無關
//
// 原本只有一本，於是有眼睛的列連「程式驗過了」都無處可記，結果就被丟掉：終端印著
// 「驗證成功」，清單第一格卻還是空的，非要學生勾完眼睛才一起變（Reed 實測）。
//
// 兩本都吃同一套指紋失效：裝的檔案一改，先前驗過的結論就不算數。
const BUCKETS = ["verified", "behavior"];

async function readStoredState(stateFile) {
  const empty = () => ({ version: VERSION, verified: {}, behavior: {} });

  try {
    const state = JSON.parse(await readFile(stateFile, "utf8"));

    if (state?.version !== VERSION) {
      return empty();
    }

    for (const bucket of BUCKETS) {
      if (
        state[bucket] === null ||
        typeof state[bucket] !== "object" ||
        Array.isArray(state[bucket])
      ) {
        // 只有壞掉的那本歸零，另一本沒理由陪葬。
        state[bucket] = {};
      }
    }

    return state;
  } catch {
    return empty();
  }
}

// selection 不受指紋管轄，所以要在寫入 verified 時原樣帶著，別被蓋掉。

// 工具與語言的選擇存在 state.json，不是瀏覽器。
//
// localStorage 綁在 origin 上，而這個伺服器每次啟動都換一個 port——重開伺服器
// origin 就變了，存的東西等於不見。學生勾了 Codex、重開一次嚮導就默默退回只有
// Claude，卡片少了一半也沒有任何提示（Reed 實測踩到）。
//
// 這裡不需要指紋失效：它是使用者的偏好，不是「裝過而且還有效」的宣稱。
export async function loadSelection(options = {}) {
  const resolved = locations(options);
  const state = await readStoredState(resolved.stateFile);
  const selection = state.selection;

  if (selection === null || typeof selection !== "object") {
    return null;
  }

  const tools = Array.isArray(selection.tools)
    ? selection.tools.filter((tool) => tool === "claude" || tool === "codex")
    : [];

  return {
    tools: tools.length > 0 ? tools : null,
    lang: typeof selection.lang === "string" ? selection.lang : null,
  };
}

export async function saveSelection(selection, options = {}) {
  const resolved = locations(options);
  const state = await readStoredState(resolved.stateFile);

  state.version = VERSION;
  state.selection = selection;
  await mkdir(path.dirname(resolved.stateFile), { recursive: true });
  await writeFile(resolved.stateFile, `${JSON.stringify(state, null, 2)}\n`);
  return selection;
}

export async function fingerprintStep(
  stepId,
  { home, lang = "zh-TW", platform = process.platform, stateFile } = {},
) {
  const resolved = locations({ home, stateFile });
  const step = describeStep(stepId, {
    lang,
    home: resolved.home,
    platform,
  });
  const targets = installedTargets(step);

  if (targets.length === 0) {
    return "";
  }

  const contents = [];

  for (const target of targets) {
    try {
      contents.push(await readFile(target));
    } catch {
      return "";
    }
  }

  const hash = createHash("sha256");

  for (const content of contents) {
    hash.update(content);
  }

  return hash.digest("hex");
}

async function loadBucket(bucket, options) {
  const resolved = locations(options);
  const state = await readStoredState(resolved.stateFile);
  const verified = [];

  for (const [stepId, record] of Object.entries(state[bucket])) {
    if (
      record === null ||
      typeof record !== "object" ||
      typeof record.fingerprint !== "string"
    ) {
      continue;
    }

    try {
      const fingerprint = await fingerprintStep(stepId, {
        ...options,
        home: resolved.home,
        stateFile: resolved.stateFile,
      });

      if (fingerprint === record.fingerprint) {
        verified.push(stepId);
      }
    } catch {
      // 舊版或手改的未知 step 不該讓整份進度讀取失敗。
    }
  }

  return verified;
}

async function markBucket(bucket, stepId, options) {
  const resolved = locations(options);
  const state = await readStoredState(resolved.stateFile);
  const fingerprint = await fingerprintStep(stepId, {
    ...options,
    home: resolved.home,
    stateFile: resolved.stateFile,
  });
  const record = {
    at: new Date().toISOString(),
    fingerprint,
  };

  state.version = VERSION;
  state[bucket][stepId] = record;
  await mkdir(path.dirname(resolved.stateFile), { recursive: true });
  await writeFile(resolved.stateFile, `${JSON.stringify(state, null, 2)}\n`);
  return record;
}

export async function loadVerifiedSteps(options = {}) {
  return loadBucket("verified", options);
}

export async function markStepVerified(stepId, options = {}) {
  return markBucket("verified", stepId, options);
}

// 程式那半驗過了——有眼睛勾選框的列也記，整列綠不綠是另一本帳的事。
export async function loadBehaviorVerifiedSteps(options = {}) {
  return loadBucket("behavior", options);
}

export async function markBehaviorVerified(stepId, options = {}) {
  return markBucket("behavior", stepId, options);
}
