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
//   2. 開視窗合併  等「工作坊那段真的進去了」，不是等視窗關掉、也不是等 agent
//                  給訊號（兩種都試過，見下面那段）
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

import { missingSourceLines } from "../src/config-check.js";
import { describeStep } from "../src/config-install.js";
import {
  mergeGroupFor,
  mergeLeaderFor,
  snapshotDir,
  snapshotFile,
} from "../src/merge-backup.js";
import { mergeReport } from "../src/merge-report.js";
import {
  stageMergeSources,
  withMergeSourceFailureCleanup,
} from "../src/merge-sources.js";
import { materialsDir } from "../src/paths.js";
import { terminalCommand } from "../src/terminal-window.js";

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
// ⚠️ **不要再用「請 agent 自己寫一個完成標記檔」當訊號。**
//
// 那是請求不是保證，跟「請你先備份」同一個性質——而備份我們早就改成自己拍了。
// 2026-08-12 在 VM 上連續兩次驗證：Claude 與 Codex **都沒有寫那個檔案**，其中一次
// 還在回報裡寫著「已寫入 jr-merge-claude-md-…done」。學生看到的是「合併明明成功了，
// 卡片卻停在安裝中」。
//
// 現在等的是**檔案內容**：工作坊那段每一行實質內容都出現在目標檔案裡了沒。判準用的
// 是 config-check 的 missingSourceLines——**跟畫面上那一列同一支函式**，不是各寫一份。
// 各寫一份的結果會是「終端說完成、卡片說需要合併」。
const materials = materialsDir();
const mergeSources = stageMergeSources(materials, existing);
const prompt = [
  `我要把工作坊的設定合併進我已經有的檔案，語言版本是 ${lang}。`,
  `要處理這 ${existing.length} 份：`,
  ...existing.map(
    (entry) =>
      `- 我的檔案 ${entry.target}，工作坊的新版在 ${mergeSources.sourceFor(entry)}`,
  ),
  "請先把兩邊都讀完，再把工作坊的規則合併進我的檔案。",
  // 這三句是針對「AI 潤飾造成的缺行」寫的——那是這一步最常見的壞法。
  "⚠️ 我原本寫的每一行都要留著，一個字都不要改寫、不要精簡、不要幫我潤飾語氣。",
  "⚠️ 順序可以重排、可以把同類的規則收在一起，但內容不能動。",
  // ⚠️ 這一句跟上面的完成判準是綁在一起的，不要為了讀起來順而拿掉。
  // 判準是逐行比對工作坊那段，而 AI 合併時本來就會潤飾——把兩行併成一行、改個標點，
  // 那幾行就對不上，於是它說做完了、嚮導永遠等不到。
  "⚠️ 工作坊那段請「一字不差」整段貼進去：不要改寫、不要潤飾、不要重排順序、" +
    "不要把兩行併成一行、不要改標點。系統是逐行比對的，改一個字就會判定沒完成。",
  // ⚠️ 「一字不差」跟重複的行會打架，而那是必然會發生的：學生上次上課裝的就是同
  // 一份設定，兩邊一模一樣。照字面貼進去就會出現重複；不貼又違反上面那條。VM 實測
  // Codex 停在那裡列了三個選項問人，而那三個選項其實都是對的——它只是不知道自己
  // 可以決定。
  //
  // 放行的根據：判準是 missingSourceLines，逐行問「這一行在不在」（Set 比對），
  // **不看有幾份**。所以留一份就算完成，刪掉重複的那份不影響。
  //
  // ⚠️ 理由要跟著 agent 走。Claude 這組只合併 CLAUDE.md（Markdown，沒有 TOML），
  // 拿「TOML 有重複鍵」當理由是一個**明顯不成立的前提**——在一份要求「一字不差」
  // 的 prompt 裡放假前提，等於賭它的判斷力，而這一步最貴的失敗正是它自己拿主意
  //（Reed 讀 prompt 時抓到的）。規則兩邊都要，理由各講各的。
  `⚠️ 兩邊完全相同的行，保留一份就好，不要貼成兩份——${
    group.agent === "codex"
      ? "TOML 有重複鍵會讓 Codex 載不進設定"
      : "同一條規則出現兩次只是雜訊"
  }。系統只看那一行在不在，不看有幾份，所以留一份就算完成。`,
  "⚠️ 除了上面那種「兩邊一模一樣」的重複之外，真的衝突時不要自己決定，停下來問我。",
  "全部做完之後告訴我每個檔案各加了什麼、有沒有衝突。",
].join("\n");

// 還沒併好的那幾份。null（來源或目標不在）不算——那是「安裝」要做的事。
async function pending() {
  const rest = [];

  for (const entry of existing) {
    const missing = await missingSourceLines(materials, entry);

    if (missing !== null && missing.length > 0) {
      rest.push({ entry, missing });
    }
  }

  return rest;
}

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

// ⚠️ loadProfile 一定要留 true：合併要跑學生平常那一支 claude / codex，而 wrapper
// 住在 profile 裡。沙箱那支刻意相反，別互相抄（判準在 src/terminal-window.js）。
function openTerminal(file) {
  return terminalCommand(file, {
    platform: process.platform,
    home: homedir(),
    exists: existsSync,
    loadProfile: true,
  });
}

const { outstanding, script } = await withMergeSourceFailureCleanup(
  mergeSources,
  async () => {
    let script = null;

    try {
      script = launcher();
      const { cmd, args } = openTerminal(script);
      spawn(cmd, args, { stdio: "ignore", detached: true }).unref();

      console.log("已經開了一個新的終端視窗，合併在那裡進行。");
      console.log("請看那個視窗——它可能會問你問題，回答完它才會繼續。");
      console.log("");

      // 等的是「工作坊那段真的進去了」，不是等視窗關掉、也不是等 agent 給訊號。
      //
      // ⚠️ **不要再回去用「請 agent 自己寫一個完成標記檔」。** 那是請求不是保證，跟
      // 「請你先備份」同一個性質——而備份我們早就改成自己拍了。2026-08-12 在 VM 上連續
      // 兩次驗證：Claude 與 Codex 都沒有寫那個檔案，其中一次還在回報裡寫著「已寫入
      // jr-merge-claude-md-…done」。學生看到的是「合併明明成功了，卡片卻停在安裝中」。
      //
      // 判準用 config-check 的 missingSourceLines——**跟畫面上那一列同一支函式**。
      // 各寫一份的結果會是「終端說完成、卡片說需要合併」。
      //
      // ⚠️ 要**全部**都到位才算完成。只看被按的那一份的話，AI 併完第一個就會被判成完成，
      // 而第二份根本沒動——那正是改成一顆按鈕之前的問題，不要用一個 bug 換另一個。
      const deadline = Date.now() + TIMEOUT_MS;
      let outstanding = await pending();
      let lastReportAt = 0;

      while (outstanding.length > 0 && Date.now() <= deadline) {
        // 三十秒講一次，不是每一輪都講：一秒一行的話，等五分鐘就是三百行，把上面那句
        // 「請看那個視窗」洗掉。逐檔講，學生才知道要回去跟 agent 說哪一份沒好。
        if (Date.now() - lastReportAt >= 30_000) {
          lastReportAt = Date.now();

          for (const { entry, missing } of outstanding) {
            console.log(`還差 ${missing.length} 行：${entry.target}`);
          }
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        outstanding = await pending();
      }

      return { outstanding, script };
    } catch (error) {
      if (script !== null) {
        rmSync(script, { force: true });
      }
      throw error;
    }
  },
);

rmSync(script, { force: true });

if (outstanding.length > 0) {
  // 逾時不等於失敗——他可能還在那個視窗裡跟 agent 討論。所以話要講成「還沒看到」，
  // 而且要給下一步，不要讓他以為得整個重來。
  console.log("");
  console.log("等太久了，這邊先停止等待——那個視窗還開著，沒有被中斷。");

  // ⚠️ 把差額整段印出來，這是逾時訊息裡唯一有行動力的東西。
  // 只講「還沒完成」的話學生沒有任何線索；印出來他可以直接貼回終端叫 agent 補。
  // 分檔印：兩份的缺行混在一起貼回去，agent 不知道哪幾行該進哪一份。
  for (const { entry, missing } of outstanding) {
    console.log("");
    console.log(`${entry.target} 還差 ${missing.length} 行。`);
    console.log("把下面這幾行複製起來，貼回那個終端視窗，跟它說：");
    console.log("「這幾行還沒進到那個檔案裡，請一字不差補進去，不要改寫也不要重排」");
    console.log("");
    console.log("--- 缺這幾行 ---");

    // 全部印出來、不截斷：截斷的話他補完前面幾行、嚮導還是不過，而他不知道還有下文。
    for (const line of missing) {
      console.log(line);
    }

    console.log("--- 到這裡 ---");
  }

  console.log("");
  console.log(`合併前的樣子還在 ${snapshot}，隨時還原得回去。`);
  process.exit(1);
}

mergeSources.cleanup();

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
