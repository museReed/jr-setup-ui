// 把「清掉上一輪套件管理器裝的舊版」對 brew 那批做到一半的事收完。
//
//   先看不動：  node scripts/finish-brew-uninstall.mjs
//   真的卸載：  node scripts/finish-brew-uninstall.mjs --apply
//
// 前一步（scripts/fix-legacy-cli.mjs）把 /opt/homebrew/bin 底下那條連結搬進隔離區的
// brew-cli 分區，但 Caskroom / Cellar 裡的本體還在、brew 自己的清單上也還有它。
// 留著的話下一次 brew upgrade 有機會把連結重新建回來，PATH 上又變成兩份。
//
// ⚠️ 範圍只有「隔離區 brew-cli 分區裡那幾支」——也就是**我們剛才親手搬走的**那幾支。
// 學生自己用 brew 裝來平常用的東西一律不碰：那是他的機器、他的選擇，而且我們也說不出
// 它有什麼問題。
//
// ⚠️ 不用 sudo，也不會反問。cask 與 formula 都試：claude-code 與 codex 目前在
// Homebrew 上都是 cask，但哪天變成 formula 也不該讓這一步整個失效。
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";

import { leftoverCommands } from "../src/brew-cli.js";
import { quarantineHome } from "../src/quarantine.js";

const APPLY = process.argv.includes("--apply");
const DIR = `${quarantineHome(homedir())}/brew-cli`;

if (!existsSync(DIR)) {
  console.log("隔離區裡沒有 Homebrew 裝的舊版，這一步不用做。");
  process.exit(0);
}

const commands = leftoverCommands(
  readdirSync(DIR, { withFileTypes: true }).map((entry) => entry.name),
);

if (commands.length === 0) {
  console.log("隔離區裡沒有 Homebrew 裝的舊版，這一步不用做。");
  process.exit(0);
}

function brew(args) {
  return spawnSync("brew", args, { encoding: "utf8" });
}

// 還在 brew 清單上的才要卸。`--versions` 找不到時 exit code 非零。
const pending = commands.filter(
  (command) => brew(["list", "--versions", command]).status === 0,
);

if (pending.length === 0) {
  console.log("Homebrew 那邊已經收乾淨了，沒有東西要卸載。");
  process.exit(0);
}

console.log("這幾支還在 Homebrew 的清單上，要卸載掉：");

for (const command of pending) {
  console.log(`  ${command}`);
}

console.log("");
console.log("⚠️ 只動這幾支——你自己用 brew 裝的其他東西不在範圍內。");

if (!APPLY) {
  console.log("");
  console.log("以上只是先看不動。加 --apply 才會真的卸載。");
  process.exit(0);
}

console.log("");

let done = 0;

for (const command of pending) {
  // cask 先試（claude-code 與 codex 目前都是 cask），不行再試 formula。
  const result =
    brew(["uninstall", "--cask", command]).status === 0
      ? { ok: true }
      : brew(["uninstall", command]).status === 0
        ? { ok: true }
        : { ok: false };

  if (result.ok) {
    console.log(`✓ 已卸載 ${command}`);
    done += 1;
    continue;
  }

  // 卸不掉不是災難：連結已經搬走了，學生現在用的是官方版。講清楚他可以自己收尾。
  console.log(`✗ ${command} 卸不掉——可以自己跑：brew uninstall --cask ${command}`);
}

console.log("");

if (done === pending.length) {
  console.log("Homebrew 那邊收乾淨了。連結不會再被重新建回來。");
  process.exit(0);
}

console.log(`卸掉 ${done} 支，還有 ${pending.length - done} 支沒動。`);
