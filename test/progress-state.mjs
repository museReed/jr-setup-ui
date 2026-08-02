import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  clearBehaviorVerified,
  clearStepVerified,
  loadBehaviorVerifiedSteps,
  loadManualChecked,
  loadSelection,
  loadVerifiedSteps,
  markBehaviorVerified,
  markStepVerified,
  saveManualChecked,
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

  // 有眼睛勾選框的列（tab-sync）：程式那半驗過了要記得住，但整列還不算綠。
  // 這兩件事分兩本帳，否則程式的結論無處可存，只能等學生勾眼睛時才一起變。
  await writeFile(target, "installed-v5\n");
  await markBehaviorVerified("claude-md", options);
  assert.deepEqual(await loadBehaviorVerifiedSteps(options), ["claude-md"]);
  assert.deepEqual(await loadVerifiedSteps(options), []);
  ok("程式驗證記進 behavior，不會讓整列被當成已驗證");

  await markStepVerified("claude-md", options);
  assert.deepEqual(await loadVerifiedSteps(options), ["claude-md"]);
  assert.deepEqual(await loadBehaviorVerifiedSteps(options), ["claude-md"]);
  ok("學生勾完眼睛後兩本帳都成立，互不覆蓋");

  // behavior 也吃指紋：裝的檔案一改，先前程式驗過的結論同樣不算數。
  await writeFile(target, "installed-v6\n");
  assert.deepEqual(await loadBehaviorVerifiedSteps(options), []);
  ok("target 內容改變後，程式驗證紀錄同樣自動失效");

  // 舊版 state.json 沒有 behavior 這本帳，讀的時候不該整份炸掉。
  await writeFile(
    stateFile,
    JSON.stringify({ version: 1, verified: {}, selection: null }),
  );
  assert.deepEqual(await loadBehaviorVerifiedSteps(options), []);
  ok("舊版 state.json 少了 behavior 欄位仍讀得動");

  // 人工勾選：整份覆蓋，取消勾選也要存得回去。逐筆新增的話取消就寫不進去。
  assert.deepEqual(await loadManualChecked(options), []);
  await saveManualChecked(["fullscreen-yes", "fullscreen-copy"], options);
  assert.deepEqual(await loadManualChecked(options), [
    "fullscreen-yes",
    "fullscreen-copy",
  ]);
  await saveManualChecked(["fullscreen-yes"], options);
  assert.deepEqual(await loadManualChecked(options), ["fullscreen-yes"]);
  ok("人工勾選整份覆蓋，取消勾選存得回去");

  // 不受指紋管轄：它是「學生說他看到了」，重裝檔案不該叫人重看一次畫面。
  await writeFile(target, "installed-v7\n");
  assert.deepEqual(await loadVerifiedSteps(options), []);
  assert.deepEqual(await loadManualChecked(options), ["fullscreen-yes"]);
  ok("驗證因指紋失效時，人工勾選不會跟著被清掉");

  // 重驗之前要能把上一輪的結論忘掉，而且要忘在檔案裡。只清瀏覽器記憶體的話，
  // 驗證失敗時畫面說沒過、重新整理之後上一輪的勾又回來了。
  await writeFile(target, "installed-v8\n");
  await markStepVerified("claude-md", options);
  await markBehaviorVerified("claude-md", options);
  assert.deepEqual(await loadVerifiedSteps(options), ["claude-md"]);

  assert.equal(await clearStepVerified("claude-md", options), true);
  assert.deepEqual(await loadVerifiedSteps(options), []);
  // 兩本帳分開清：清整列不該把程式那半的結論一起帶走。
  assert.deepEqual(await loadBehaviorVerifiedSteps(options), ["claude-md"]);

  assert.equal(await clearBehaviorVerified("claude-md", options), true);
  assert.deepEqual(await loadBehaviorVerifiedSteps(options), []);
  ok("重驗之前清得掉上一輪的結論，兩本帳各清各的");

  // 本來就沒記過的步驟：回 false，不要寫一次檔案也不要炸。
  assert.equal(await clearStepVerified("never-verified", options), false);
  ok("清一個沒記過的步驟不會出事");

  // 人工勾選不受影響——那是「學生說他看到了」，跟程式的結論是兩回事。
  assert.deepEqual(await loadManualChecked(options), ["fullscreen-yes"]);
  ok("清驗證結論時，人工勾選留著");
} finally {
  await rm(home, { recursive: true, force: true });
}
