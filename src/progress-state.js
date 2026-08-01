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

async function readStoredState(stateFile) {
  try {
    const state = JSON.parse(await readFile(stateFile, "utf8"));

    if (
      state?.version !== VERSION ||
      state.verified === null ||
      typeof state.verified !== "object" ||
      Array.isArray(state.verified)
    ) {
      return { version: VERSION, verified: {} };
    }

    return state;
  } catch {
    return { version: VERSION, verified: {} };
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

export async function loadVerifiedSteps(options = {}) {
  const resolved = locations(options);
  const state = await readStoredState(resolved.stateFile);
  const verified = [];

  for (const [stepId, record] of Object.entries(state.verified)) {
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

export async function markStepVerified(stepId, options = {}) {
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
  state.verified[stepId] = record;
  await mkdir(path.dirname(resolved.stateFile), { recursive: true });
  await writeFile(resolved.stateFile, `${JSON.stringify(state, null, 2)}\n`);
  return record;
}
