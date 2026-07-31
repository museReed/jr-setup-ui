import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  loadVerifiedSteps,
  markStepVerified,
} from "../src/progress-state.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

const home = await mkdtemp(path.join(tmpdir(), "jr-progress-"));
const stateFile = path.join(home, ".jr-setup", "state.json");
const target = path.join(home, ".claude", "CLAUDE.md");
const options = { home, stateFile, platform: "linux" };

try {
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, "installed-v1\n");
  await markStepVerified("claude-md", options);

  assert.deepEqual(await loadVerifiedSteps(options), ["claude-md"]);
  const stored = JSON.parse(await readFile(stateFile, "utf8"));
  assert.equal(stored.version, 1);
  assert.match(stored.verified["claude-md"].at, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(stored.verified["claude-md"].fingerprint, /^[a-f0-9]{64}$/);
  ok("寫入後能讀回仍有效的驗證步驟");

  await writeFile(target, "installed-v2\n");
  assert.deepEqual(await loadVerifiedSteps(options), []);
  ok("target 內容改變後，原驗證紀錄自動失效");

  await writeFile(stateFile, "{ broken json");
  assert.deepEqual(await loadVerifiedSteps(options), []);
  ok("state.json 壞掉時回空狀態");
} finally {
  await rm(home, { recursive: true, force: true });
}
