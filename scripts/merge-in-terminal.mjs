// 在「真的終端視窗」裡做合併，而且合完檢查有沒有把學生原本的行弄丟。
//
//   node scripts/merge-in-terminal.mjs --step=codex-config --lang=zh-TW
//
// 為什麼要真終端（A3）：合併是 agent 改學生自己的檔案，中途它可能反問「這兩條規則
// 衝突，要留哪一個」。在嚮導裡跑的話那句問話沒人回得了——畫面上只是一段停住的文字
// 流，最後 agent 自己猜一個。開真視窗學生就能當場回答，也來得及在它做壞事前攔下來。
//
// 三件事按順序做，缺一不可：
//
//   1. 先拍快照   退路不能靠 AI 自己備份（見 src/merge-backup.js）
//   2. 開視窗合併  等一個完成標記檔出現，不是等視窗關掉——學生常忘了關
//   3. 比對缺行    AI 最常見的壞法是「順手潤飾」掉幾行，不是合失敗
import { spawn } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import { describeStep } from "../src/config-install.js";
import {
  mergeGroupFor,
  mergeLeaderFor,
  snapshotDir,
  snapshotFile,
} from "../src/merge-backup.js";
import { mergeReport } from "../src/merge-report.js";
import { materialsDir } from "../src/paths.js";

const POLL_INTERVAL_MS = 1_000;
// 合併比驗證慢得多：兩個檔案、要先讀完學生原本的內容，中間還可能停下來問。
const TIMEOUT_MS = 600_000;
const HOME = homedir();

function arg(name) {
  return process.argv
    .find((entry) => entry.startsWith(`--${name}=`))
    ?.slice(name.length + 3);
}

const requested = arg("step");
// ⚠️ 收到跟班那一步（codex-agents）時要自己折回群組主人，不能拒絕。
// 畫面上兩列都有合併鍵，而按鈕帶哪一步取決於「第一個還沒好的那一列」——真機上送
// 進來的就是 codex-agents，腳本直接回「不是需要合併的步驟」，整條路斷掉。
// 折在這裡是因為這是唯一的入口：前端怎麼改都不會再撞到。
const step = requested === undefined ? undefined : mergeLeaderFor(requested);
const lang = arg("lang") ?? "zh-TW";
const group = step === undefined || step === null ? null : mergeGroupFor(step);

if (group === null) {
  console.log(`${requested ?? "(沒給 --step)"} 不是需要合併的步驟。`);
  process.exit(1);
}

if (step !== requested) {
  console.log(`${requested} 跟 ${step} 是同一組設定，一起合併。`);
}

const steps = group.steps.map((id) => describeStep(id, { lang, home: HOME }));
const existing = steps.filter((entry) => existsSync(entry.target));

if (existing.length === 0) {
  console.log("這幾個檔案都還不存在，直接按「安裝」就好，不需要合併。");
  process.exit(1);
}

// ── 1. 先拍快照 ────────────────────────────────────────────────────────────
const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
const snapshot = snapshotDir(HOME, step, stamp);
mkdirSync(snapshot, { recursive: true });

const before = new Map();

for (const entry of existing) {
  const saved = snapshotFile(snapshot, entry.target);
  copyFileSync(entry.target, saved);
  before.set(entry.target, readFileSync(entry.target, "utf8"));
}

console.log(`合併前的樣子已經存起來了：${snapshot}`);
console.log("（合併結果不滿意的話，卡片上有「還原成合併前」）");
console.log("");

// ── 2. 開視窗合併 ──────────────────────────────────────────────────────────
//
// 完成標記檔：等它出現，不是等視窗關掉。學生看完結果常常就把視窗留著去按下一步，
// 等關閉的話這支會一直卡著（verify-in-terminal 同一個做法）。
const doneFile = path.join(tmpdir(), `jr-merge-${step}-${stamp}.done`);
const materials = materialsDir();
const prompt = [
  `我要把工作坊的設定合併進我已經有的檔案，語言版本是 ${lang}。`,
  `要處理這 ${existing.length} 份：`,
  ...existing.map(
    (entry) => `- 我的檔案 ${entry.target}，工作坊的新版在 ${path.join(materials, entry.source)}`,
  ),
  "請先把兩邊都讀完，再把工作坊的規則合併進我的檔案。",
  // 這三句是針對「AI 潤飾造成的缺行」寫的——那是這一步最常見的壞法。
  "⚠️ 我原本寫的每一行都要留著，一個字都不要改寫、不要精簡、不要幫我潤飾語氣。",
  "⚠️ 順序可以重排、可以把同類的規則收在一起，但內容不能動。",
  "⚠️ 兩邊真的衝突時不要自己決定，停下來問我。",
  `全部做完之後，執行一次：echo done > "${doneFile}"`,
].join("\n");

function launcher() {
  const body = `${group.agent} '${prompt.replace(/'/g, "''")}'`;

  if (process.platform === "win32") {
    const file = path.join(tmpdir(), `jr-merge-${stamp}.ps1`);
    // 不加 -NoProfile：wrapper 住在 profile 裡，跳過它跑的就不是學生平常那一支。
    writeFileSync(file, `﻿${body}\n`, "utf8");
    return file;
  }

  const file = path.join(tmpdir(), `jr-merge-${stamp}.command`);
  // -i 讓 zsh 讀 ~/.zshrc，理由同上。
  writeFileSync(file, `#!/bin/zsh -i\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

function openTerminal(file) {
  if (process.platform === "win32") {
    return {
      cmd: "cmd.exe",
      args: [
        "/c",
        "start",
        "",
        "wt.exe",
        "powershell.exe",
        "-NoExit",
        // 我們自己寫出來的臨時腳本不該看機器的執行原則臉色。Restricted 的機器上
        // 新視窗會直接紅字，而這邊看到的 exit code 還是 0（VM 實測）。
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        file,
      ],
    };
  }

  return { cmd: "open", args: [file] };
}

const script = launcher();
const { cmd, args } = openTerminal(script);
spawn(cmd, args, { stdio: "ignore", detached: true }).unref();

console.log("已經開了一個新的終端視窗，合併在那裡進行。");
console.log("請看那個視窗——它可能會問你問題，回答完它才會繼續。");
console.log("");

const deadline = Date.now() + TIMEOUT_MS;

while (!existsSync(doneFile)) {
  if (Date.now() > deadline) {
    console.log("等太久了，先不等了。那個視窗如果還在跑，跑完再回來按「重新檢查」。");
    console.log(`合併前的樣子還在 ${snapshot}，隨時還原得回去。`);
    process.exit(1);
  }

  await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
}

rmSync(doneFile, { force: true });
rmSync(script, { force: true });

// ── 3. 比對缺行 ────────────────────────────────────────────────────────────
const report = mergeReport(
  existing.map((entry) => ({
    target: entry.target,
    before: before.get(entry.target),
    after: existsSync(entry.target) ? readFileSync(entry.target, "utf8") : "",
  })),
);

console.log("");
console.log(report.summary);

for (const result of report.results) {
  if (result.missing.length === 0) {
    continue;
  }

  console.log("");
  console.log(`${result.target}：`);

  for (const entry of result.missing) {
    console.log(`  第 ${entry.line} 行  ${entry.text}`);
  }
}

if (!report.ok) {
  console.log("");
  console.log("（只是換位置的不算在內，這裡列的是真的找不到了的。）");
}

process.exit(0);
