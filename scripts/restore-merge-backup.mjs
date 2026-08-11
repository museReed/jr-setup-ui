// 把合併前的那份檔案還原回去。
//
//   先看不動：  node scripts/restore-merge-backup.mjs --step=codex-config
//   真的還原：  node scripts/restore-merge-backup.mjs --step=codex-config --apply
//
// 用的是我們自己在合併前拍的快照（~/.jr-setup/merge-backups/），不是 AI 自己說它
// 有備份的那一份——那是請求不是保證，見 src/merge-backup.js 的說明。
//
// 「一顆做兩檔」的那一步兩份一起還原：只還原其中一份會產生一個從來沒存在過的組合。
import { copyFileSync, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";

import { describeStep } from "../src/config-install.js";
import { mergeGroupFor, restorePlan } from "../src/merge-backup.js";

const APPLY = process.argv.includes("--apply");
const HOME = homedir();
const stepArg = process.argv
  .find((entry) => entry.startsWith("--step="))
  ?.slice("--step=".length);

if (stepArg === undefined) {
  console.log("要指定 --step=<步驟 id>。");
  process.exit(1);
}

const group = mergeGroupFor(stepArg);

if (group === null) {
  console.log(`${stepArg} 不是需要合併的步驟，沒有快照可以還原。`);
  process.exit(1);
}

const files = group.steps.map(
  (id) => describeStep(id, { lang: "zh-TW", home: HOME }).target,
);
const stepRoot = `${HOME}/.jr-setup/merge-backups/${stepArg}`;
const stamps = existsSync(stepRoot)
  ? readdirSync(stepRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  : [];

const plan = restorePlan({ home: HOME, step: stepArg, stamps, files });

if (plan === null) {
  console.log("找不到合併前的快照——這一步還沒合併過，或快照被刪掉了。");
  process.exit(1);
}

console.log(`合併前的快照：${plan.dir}`);
console.log("");

// 快照裡缺的那幾份不還原：合併當下那個檔案本來就不存在（學生沒有自己的版本），
// 還原它等於憑空生出一個檔案。
const usable = plan.moves.filter((move) => existsSync(move.from));

if (usable.length === 0) {
  console.log("那份快照裡沒有可以還原的檔案。");
  process.exit(1);
}

for (const move of usable) {
  console.log(`  ${move.to}`);
}

if (!APPLY) {
  console.log("");
  console.log("以上只是先看不動。加 --apply 才會真的還原。");
  process.exit(0);
}

let restored = 0;

for (const move of usable) {
  try {
    copyFileSync(move.from, move.to);
    console.log(`✓ 已還原 ${move.to}`);
    restored += 1;
  } catch (error) {
    console.log(`✗ ${move.to} 還原失敗：${error.message}`);
  }
}

console.log("");

if (restored === usable.length) {
  console.log("還原完成。合併後的版本沒有留下來——要的話請重跑一次合併。");
  process.exit(0);
}

console.log(`還原 ${restored} 份，還有 ${usable.length - restored} 份沒動。`);
process.exit(1);
