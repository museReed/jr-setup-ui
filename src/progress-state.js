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
