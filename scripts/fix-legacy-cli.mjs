// 把上一輪用 npm 或 Homebrew 裝的 claude / codex 殘留搬進隔離區。
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
import { existsSync, mkdirSync, realpathSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { spawnEnv } from "../src/env-path.js";
import { resolveInstaller } from "../src/installers.js";
import { inspectCommand, removableEntries } from "../src/legacy-cli.js";
import { findAllExecutables } from "../src/spawn-command.js";

const APPLY = process.argv.includes("--apply");
const HOME = homedir();
const QUARANTINE_ROOT = path.join(HOME, ".jr-setup", "quarantine");

// 兩種殘留搬進不同分區。brew 那批之後還要去跑 brew uninstall（Cellar 裡的本體還在、
// brew 的清單上也還有它），混在一起就分不出哪幾支還沒了結。
function quarantineFor(entry) {
  return path.join(QUARANTINE_ROOT, entry.kind === "brew" ? "brew-cli" : "npm-cli");
}

function stamp() {
  return new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

const env = await spawnEnv();
// ⚠️ realpath 一定要傳，而且要跟 env-check.js 的 checkLegacyCli 傳同一套。
//
// 少了它，兩邊的判準會不一樣：那一列（有解 symlink）說「有 npm 殘留、來按這顆」，
// 按下去這支腳本（沒解）卻說「沒有要搬的東西」——學生按了沒反應，而畫面還是紅的。
//
// 真機實測（Reed 的 mac，2026-08-15）：nvm 管的 node 底下
// ~/.nvm/versions/node/v22.22.0/bin/codex 是一條指向 ../lib/node_modules/@openai/codex
// 的連結。路徑本身看不出 npm，只有解開才看得到 node_modules。
const reports = ["claude", "codex"].map((command) =>
  inspectCommand(
    command,
    findAllExecutables(command, env, { fileExists: existsSync }),
    {
      exists: existsSync,
      realpath: (candidate) => {
        try {
          return realpathSync(candidate);
        } catch {
          // 斷掉的連結、或沒有權限。當作解不開，交給後面那條路判。
          return null;
        }
      },
    },
  ),
);

// 這台裝得回來的那幾支。裝不回來的就不動——搬走了沒有東西補上。
const reinstallable = ["claude", "codex"].filter(
  (command) => resolveInstaller(command, process.platform) !== null,
);
const entries = removableEntries(reports, { reinstallable });
const skipped = reports.flatMap((report) =>
  [...report.npm, ...report.brew].filter((entry) => !entries.includes(entry)),
);

// 認不得的落點只講一句，一支都不動（Reed 拍板）。畫面上那一列也會說同一件事，
// 但按下按鈕的人在終端裡看到的才是完整清單——這裡可以放完整路徑，它不會被送上網。
for (const report of reports) {
  for (const entry of report.unknown) {
    console.log(
      `不動 ${entry.path}——這支不在 npm、Homebrew、官方安裝器的落點，我們認不得它是怎麼裝的。`,
    );
  }
}

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
  const why = entry.orphan
    ? "（指向空氣的孤兒）"
    : entry.kind === "brew"
      ? "（Homebrew 裝的）"
      : "";
  console.log(`  ${entry.path}${why}`);
}

console.log("");
console.log(`搬去：${QUARANTINE_ROOT}`);

// brew 那批搬完不等於了結：那條連結搬走了，Cellar 裡的本體還在、brew 的清單上也
// 還有它，之後 brew upgrade 有機會把連結重建回來。真正的收尾是 brew uninstall，
// 那會是另一張卡（Reed 拍板：先隔離，之後統一處理）。
if (entries.some((entry) => entry.kind === "brew")) {
  console.log("");
  console.log(
    "⚠️ Homebrew 那幾支只是把連結搬走，brew 的清單上還有它們——之後會有一張卡帶你跑 brew uninstall 收尾。",
  );
}

if (!APPLY) {
  console.log("");
  console.log("以上只是先看不動。加 --apply 才會真的搬走。");
  process.exit(0);
}

const suffix = stamp();
let moved = 0;

for (const entry of entries) {
  const area = quarantineFor(entry);

  mkdirSync(area, { recursive: true });

  const to = path.join(area, `${path.basename(entry.path)}-${suffix}`);

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
