// 把「清掉上一輪套件管理器裝的舊版」對 npm 那批做到一半的事收完。
//
//   先看不動：  node scripts/finish-npm-uninstall.mjs
//   真的卸載：  node scripts/finish-npm-uninstall.mjs --apply
//
// 前一步（scripts/fix-legacy-cli.mjs）把 PATH 上那支 shim 搬進隔離區的 npm-cli 分區，
// 但 npm 的全域 node_modules 裡本體還在、npm 自己的帳本上也還記得它。下一次
// `npm i -g` 同一支、或換 Node 版本時重裝全域套件，那支捷徑就會被建回來。
//
// ⚠️ 範圍只有「隔離區 npm-cli 分區裡那幾支」——也就是**我們剛才親手搬走的**那幾支，
// 而且只認 NPM_PACKAGES 那張表上的套件名。學生自己 npm 裝的其他全域套件一律不碰。
//
// ⚠️ 這一步刻意排在「清掉隔離區」之前：那顆按鈕會把備份刪掉，而萬一這裡失敗，
// 那份備份是唯一還原得回去的東西。
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";

import { NPM_PACKAGES } from "../src/legacy-cli.js";
import { leftoverCommands } from "../src/leftovers.js";
import { quarantineHome } from "../src/quarantine.js";

const APPLY = process.argv.includes("--apply");
const DIR = `${quarantineHome(homedir())}/npm-cli`;

if (!existsSync(DIR)) {
  console.log("隔離區裡沒有 npm 裝的舊版，這一步不用做。");
  process.exit(0);
}

const commands = leftoverCommands(
  readdirSync(DIR, { withFileTypes: true }).map((entry) => entry.name),
);
const packages = commands
  .map((command) => NPM_PACKAGES[command])
  .filter((name) => name !== undefined);

if (packages.length === 0) {
  console.log("隔離區裡沒有我們認得的 npm 套件，這一步不用做。");
  process.exit(0);
}

function npm(args) {
  return spawnSync("npm", args, { encoding: "utf8", shell: process.platform === "win32" });
}

// 本體還在的才要卸。看的是全域目錄底下有沒有那個資料夾，不是 `npm ls -g` 的輸出
// ——孤兒的情況 npm 自己也認不得（見 src/legacy-cli.js 開頭）。
const root = npm(["root", "-g"]);

if (root.status !== 0) {
  console.log("問不到 npm 的全域目錄，這一步先跳過。");
  process.exit(0);
}

const base = root.stdout.trim().split("\n").at(-1).trim();
const pending = packages.filter((name) =>
  existsSync(`${base}/${name.split("/").join("/")}`),
);

if (pending.length === 0) {
  console.log("npm 那邊已經收乾淨了，沒有東西要卸載。");
  process.exit(0);
}

console.log("這幾個套件的本體還在 npm 的全域目錄裡，要卸載掉：");

for (const name of pending) {
  console.log(`  ${name}`);
}

console.log("");
console.log("⚠️ 只動這幾個——你自己 npm 裝的其他全域套件不在範圍內。");

if (!APPLY) {
  console.log("");
  console.log("以上只是先看不動。加 --apply 才會真的卸載。");
  process.exit(0);
}

console.log("");

let done = 0;

for (const name of pending) {
  if (npm(["uninstall", "-g", name]).status === 0) {
    console.log(`✓ 已卸載 ${name}`);
    done += 1;
    continue;
  }

  // 卸不掉不是災難：捷徑已經搬走了，學生現在用的是官方版。講清楚他可以自己收尾。
  console.log(`✗ ${name} 卸不掉——可以自己跑：npm uninstall -g ${name}`);
}

console.log("");

if (done === pending.length) {
  console.log("npm 那邊收乾淨了。捷徑不會再被重新建回來。");
  process.exit(0);
}

console.log(`卸掉 ${done} 個，還有 ${pending.length - done} 個沒動。`);
