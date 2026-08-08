// 在「真的終端視窗」裡把工作坊的設定合併進學生已經有的檔案。
//
//   node scripts/merge-in-terminal.mjs --step=codex-agents --lang=zh-TW --tools=claude,codex
//
// ⚠️ 這支取代了原本在背景跑的 merge-config-step（Reed 指定）。背景跑有三個問題，
//    都是在 Windows 真機上撞出來的：
//
//   1. 看不到授權框。Codex 的 Windows 沙箱第一次用會跳 UAC，那個框跳在嚮導後面，
//      學生順手關掉——嚮導這邊只拿到 `ShellExecuteExW failed: 1223`（使用者取消），
//      畫面上是一張沒頭沒尾的紅卡。
//   2. 答不了問題。agent 中途要批准寫入時，背景那條沒有人可以回答，它只能自己放棄。
//   3. 燒錢燒得沒人看見。實測一次失敗的合併跑了 7 分鐘、53 萬 tokens——全部在
//      重試同一件做不到的事，而學生完全不知道。
//
// 開視窗之後這支不會馬上結束：它會輪詢目標檔案，等「工作坊那段真的進去了」才回報
// 完成。判準跟畫面上那一列用的是同一個函式（containsSourceContent），不是各寫一份。
import { spawn } from "node:child_process";
import { homedir } from "node:os";

import { containsSourceContent } from "../src/config-check.js";
import { agentForStep, describeStep } from "../src/config-install.js";
import { materialsDir } from "../src/paths.js";
import { openTerminal, writeLauncher } from "../src/terminal-window.js";

// 合併要讀兩份檔案、備份、再逐段併——比驗證那些單一動作久。而且中間可能停下來等
// 學生按授權，所以給得比 verify-in-terminal 的 240 秒寬。
const POLL_INTERVAL_MS = 2_000;
const TIMEOUT_MS = 900_000;

function arg(name, fallback) {
  const found = process.argv.find((value) => value.startsWith(`--${name}=`));
  return found === undefined ? fallback : found.slice(name.length + 3);
}

function emitJr(event) {
  console.log(`@@JR ${JSON.stringify(event)}`);
}

const stepId = arg("step", "");
const lang = arg("lang", "zh-TW");
const tools = arg("tools", "claude,codex").split(",");
const home = homedir();

if (stepId === "") {
  console.error("要帶 --step=<步驟 id>。");
  process.exit(1);
}

const step = describeStep(stepId, { lang, home });
const materials = materialsDir();

// 誰家的設定就用誰去合併，跟 actions.js 的 engine 同一條規矩。
//
// 那一家沒被選到才退回工具選擇：選「只要 Codex」的學生機器上根本沒有 claude，
// 開一個視窗跑 claude 只會得到「找不到指令」。
function pickAgent() {
  const owner = agentForStep(stepId);

  if (owner !== null && tools.includes(owner)) {
    return owner;
  }

  return tools.includes("claude") ? "claude" : "codex";
}

const agent = pickAgent();

// 提問跟背景版本一字不差（原本在 actions.js 的 buildPrompt）。
//
// 路徑寫死是刻意的：不講的話 agent 會自己去翻，翻得到沒人發現但每次都多燒一輪，
// 翻不到就只能瞎猜。實際落點是 app/materials/（實測回報）。
const prompt = [
  `我要把工作坊的設定合併進我已經有的檔案，語言版本是 ${lang}，這一步是 ${stepId}。`,
  `新版內容在 ~/.jr-setup/app/materials/ 底下（claude-code/${lang}/ 與 codex/${lang}/）。`,
  `我的檔案是 ${step.target}。`,
  "請先讀我現有的檔案和新版內容，備份現有檔案（加 .bak.時間戳），",
  "再把工作坊的規則合併進去——保留我原本的內容，不要整份覆蓋。",
  "改完告訴我你加了什麼、有沒有衝突。",
].join("");

const launcher = writeLauncher({
  body: `${agent} '${prompt}'`,
  prefix: "jr-merge",
});
const { cmd, args } = openTerminal(launcher);
const child = spawn(cmd, args, { stdio: "ignore", detached: true });
child.unref();

console.log(`已經開了一個新的終端視窗，${agent} 正在幫你合併 ${step.label}。`);
console.log("");
console.log("請看那個視窗：");
console.log("  · 它問你要不要修改檔案時，請回答「是」");
console.log("  · Windows 上第一次可能會跳一個要系統權限的框，那是正常的，按「是」");
console.log("");
console.log("合併好了這邊會自己知道，不用回來按什麼。");
emitJr({ kind: "stage", stage: "waiting" });

// 等「工作坊那段真的進去了」，不是等視窗關掉。
//
// 等視窗關掉是錯的判準：學生可能先關視窗再回來，也可能開著視窗去做別的事。真正
// 要知道的是檔案好了沒——而那件事讀檔就知道。
const startedAt = Date.now();

while (Date.now() - startedAt < TIMEOUT_MS) {
  if (await containsSourceContent(materials, step)) {
    console.log("");
    console.log(`✓ 合併完成——工作坊那段已經在 ${step.target} 裡了。`);
    console.log("你原本的內容都還在，備份在同一個資料夾底下（.bak.時間戳）。");
    process.exit(0);
  }

  await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
}

// 逾時不等於失敗——他可能還在那個視窗裡跟 agent 討論。所以話要講成「還沒看到」，
// 而且明確給下一步，不要讓他以為要重來一次。
console.log("");
console.log("等太久了，這邊先停止等待——但那個終端視窗還開著，沒有被中斷。");
console.log("");
console.log("那邊弄完之後，回來按這一列的「重新檢查」就會更新。");
console.log("那個視窗如果卡住了，關掉它再按一次這顆也可以。");
process.exit(1);
