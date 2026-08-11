// 把上一輪用 npm 裝的 claude / codex 殘留搬進隔離區。
//
//   先看不動：  node scripts/fix-legacy-cli.mjs
//   真的搬走：  node scripts/fix-legacy-cli.mjs --apply
//
// ⚠️ 只搬兩種：孤兒 shim（指向空氣、留著只會失敗），以及「已經有官方版當靠山」的
// npm 版。**只有 npm 版、沒有官方版的不動**——那是學生唯一叫得動的東西，清掉等於
// 把人家的工具拆了。判準全在 src/legacy-cli.js，這裡只負責搬。
//
// 為什麼是搬不是刪：跟舊 skill 同一個道理，學生想找回來還找得到。也不用 npm
// uninstall -g——孤兒那種 npm 自己也認不得（它以為沒裝），而且我們要處理的是
// 「PATH 上這一支」，不是「npm 的帳本」。
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { spawnEnv } from "../src/env-path.js";
import { resolveInstaller } from "../src/installers.js";
import { inspectCommand, removableEntries } from "../src/legacy-cli.js";
import { findAllExecutables } from "../src/spawn-command.js";

const APPLY = process.argv.includes("--apply");
const HOME = homedir();
const QUARANTINE = path.join(HOME, ".jr-setup", "quarantine", "npm-cli");

function stamp() {
  return new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

const env = await spawnEnv();
const reports = ["claude", "codex"].map((command) =>
  inspectCommand(
    command,
    findAllExecutables(command, env, { fileExists: existsSync }),
    { exists: existsSync },
  ),
);

// 這台裝得回來的那幾支。裝不回來的就不動——搬走了沒有東西補上。
const reinstallable = ["claude", "codex"].filter(
  (command) => resolveInstaller(command, process.platform) !== null,
);
const entries = removableEntries(reports, { reinstallable });
const skipped = reports.flatMap((report) =>
  report.npm.filter((entry) => !entries.includes(entry)),
);

for (const entry of skipped) {
  console.log(
    `略過 ${entry.path}——這是 ${entry.command} 目前唯一能用的版本，而這台裝不回官方版。`,
  );
}

// 會出現空窗的那幾支要講清楚：搬完到裝好官方版之前，這台沒有那支指令。
const stranded = [
  ...new Set(
    reports
      .filter((report) => report.official === 0)
      .flatMap((report) =>
        entries.filter((entry) => entry.command === report.command),
      )
      .map((entry) => entry.command),
  ),
];

for (const command of stranded) {
  console.log(
    `⚠️ 搬走之後這台暫時沒有 ${command}——請接著用「${command === "claude" ? "Claude Code" : "Codex CLI"}」那張卡的安裝鍵裝官方版。`,
  );
  console.log("   東西沒有被刪掉，都在隔離區裡，隨時搬得回來。");
}

if (entries.length === 0) {
  console.log(skipped.length === 0 ? "沒有要搬的東西。" : "");
  process.exit(0);
}

console.log("");
console.log("要搬走這幾支：");

for (const entry of entries) {
  console.log(`  ${entry.path}${entry.orphan ? "（指向空氣的孤兒）" : ""}`);
}

console.log("");
console.log(`搬去：${QUARANTINE}`);

if (!APPLY) {
  console.log("");
  console.log("以上只是先看不動。加 --apply 才會真的搬走。");
  process.exit(0);
}

mkdirSync(QUARANTINE, { recursive: true });

const suffix = stamp();
let moved = 0;

for (const entry of entries) {
  const to = path.join(QUARANTINE, `${path.basename(entry.path)}-${suffix}`);

  try {
    renameSync(entry.path, to);
    console.log(`✓ ${entry.path} → ${to}`);
    moved += 1;
  } catch (error) {
    console.log(`✗ ${entry.path} 搬不動：${error.message}`);
  }
}

console.log("");

if (moved === entries.length) {
  console.log("搬完了。要開一個新的終端視窗，改動才會生效。");
  process.exit(0);
}

console.log(`搬走 ${moved} 支，還有 ${entries.length - moved} 支沒動。`);
process.exit(1);
