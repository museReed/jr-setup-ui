import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  loadSelection,
  loadVerifiedSteps,
  markStepVerified,
  saveSelection,
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

  // 工具／語言的選擇存伺服器而不是 localStorage：後者綁 origin，而這個伺服器每次
  // 啟動都換 port，重開一次就等於沒存。學生勾了 Codex、重開嚮導卻默默退回只有
  // Claude，卡片少一半也沒提示（實測踩到）。
  assert.equal(await loadSelection(options), null);
  await saveSelection({ tools: ["claude", "codex"], lang: "en" }, options);
  assert.deepEqual(await loadSelection(options), {
    tools: ["claude", "codex"],
    lang: "en",
  });
  ok("工具與語言的選擇存得進 state.json 也讀得回來");

  // 選擇不受指紋管轄——它是偏好不是「裝過而且還有效」的宣稱，驗證作廢時不該跟著消失。
  await writeFile(target, "installed-v3\n");
  await markStepVerified("claude-md", options);
  await writeFile(target, "installed-v4\n");
  assert.deepEqual(await loadVerifiedSteps(options), []);
  assert.deepEqual((await loadSelection(options)).tools, ["claude", "codex"]);
  ok("驗證因指紋失效時，工具選擇不會跟著被清掉");
} finally {
  await rm(home, { recursive: true, force: true });
}
