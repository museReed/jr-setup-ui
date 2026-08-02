import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  clearBehaviorVerified,
  clearStepVerified,
  loadBehaviorVerifiedSteps,
  loadChangedSteps,
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

  // 檔案改了不作廢紀錄，只回報「驗過之後被動過」。
  //
  // 原本對不上就整筆丟掉。但「裝好了卻不生效」那條防線後來做進即時檢查裡了（缺少、
  // 開關被改掉、裝的是舊版都驗得出來），指紋變成第二套機制，抓的東西重疊卻用整檔
  // 比對，於是只剩誤傷——Output Style 驗過之後，裝 hook、裝白名單、裝命名 hook 都
  // 會把它作廢一次，學生被迫重跑最貴的那個驗證（VM 實測）。
  await writeFile(target, "installed-v2\n");
  assert.deepEqual(await loadVerifiedSteps(options), ["claude-md"]);
  assert.deepEqual(await loadChangedSteps(options), ["claude-md"]);
  ok("target 內容改變後紀錄留著，只回報被動過");

  await writeFile(target, "installed-v1\n");
  assert.deepEqual(await loadChangedSteps(options), []);
  ok("改回原樣就不再回報被動過");

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

  // 選擇不受指紋管轄——它是偏好不是「裝過而且還有效」的宣稱。
  await writeFile(target, "installed-v3\n");
  await markStepVerified("claude-md", options);
  await writeFile(target, "installed-v4\n");
  assert.deepEqual((await loadSelection(options)).tools, ["claude", "codex"]);
  ok("檔案被動過時，工具選擇不受影響");

  // 有眼睛勾選框的列（tab-sync）：程式那半驗過了要記得住，但整列還不算綠。
  // 這兩件事分兩本帳，否則程式的結論無處可存，只能等學生勾眼睛時才一起變。
  await writeFile(stateFile, JSON.stringify({ version: 1, verified: {}, behavior: {} }));
  await writeFile(target, "installed-v5\n");
  await markBehaviorVerified("claude-md", options);
  assert.deepEqual(await loadBehaviorVerifiedSteps(options), ["claude-md"]);
  assert.deepEqual(await loadVerifiedSteps(options), []);
  ok("程式驗證記進 behavior，不會讓整列被當成已驗證");

  await markStepVerified("claude-md", options);
  assert.deepEqual(await loadVerifiedSteps(options), ["claude-md"]);
  assert.deepEqual(await loadBehaviorVerifiedSteps(options), ["claude-md"]);
  ok("學生勾完眼睛後兩本帳都成立，互不覆蓋");

  // 兩本帳都留著，被動過的回報只算一次。
  await writeFile(target, "installed-v6\n");
  assert.deepEqual(await loadBehaviorVerifiedSteps(options), ["claude-md"]);
  assert.deepEqual(await loadChangedSteps(options), ["claude-md"]);
  ok("檔案被動過時兩本帳都留著，回報不重複");

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
  assert.deepEqual(await loadManualChecked(options), ["fullscreen-yes"]);
  ok("檔案被動過時，人工勾選不受影響");

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

  // settings.json 是大家共用的一本，每一步在上面寫自己那一段。整本一起算指紋的話，
  // 別人在別頁寫一行字就把我作廢——Output Style 驗過（最貴的一步，兩趟 LLM）之後，
  // 裝 hook、裝白名單、裝命名 hook 各作廢它一次（VM 實測）。
  const settingsPath = path.join(home, ".claude", "settings.json");
  const stylePath = path.join(
    home,
    ".claude",
    "output-styles",
    "concise-structured.md",
  );
  await mkdir(path.dirname(stylePath), { recursive: true });
  await writeFile(stylePath, "style-v1\n");
  await writeFile(
    settingsPath,
    JSON.stringify({ outputStyle: "Concise Structured" }),
  );
  await markBehaviorVerified("output-style", options);
  assert.deepEqual(await loadChangedSteps(options), []);

  // 別人寫別頁：裝白名單、裝 hook 註冊。Output Style 那一段沒被動到。
  await writeFile(
    settingsPath,
    JSON.stringify({
      outputStyle: "Concise Structured",
      permissions: { allow: ["Bash(ls:*)"] },
      hooks: { PreToolUse: [{ command: "block-chained-bash.js" }] },
    }),
  );
  assert.deepEqual(await loadChangedSteps(options), []);
  ok("別的步驟改 settings.json 的別頁，不會作廢這一步的驗證");

  // 自己那一段被改掉（開關關了）才算數。
  await writeFile(
    settingsPath,
    JSON.stringify({
      outputStyle: "別的樣式",
      permissions: { allow: ["Bash(ls:*)"] },
    }),
  );
  assert.deepEqual(await loadChangedSteps(options), ["output-style"]);
  ok("自己那一段被改掉才回報被動過");
} finally {
  await rm(home, { recursive: true, force: true });
}
