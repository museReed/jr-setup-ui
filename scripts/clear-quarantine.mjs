// 把隔離區清空。
//
//   先看不動：  node scripts/clear-quarantine.mjs
//   真的刪掉：  node scripts/clear-quarantine.mjs --apply
//
// ⚠️ 這是整個嚮導裡唯一真的刪東西、而且刪掉回不來的動作。所以：
//
//   1. 範圍寫死在 ~/.jr-setup/quarantine/<分區>/ 底下的第一層，一層都不多走
//   2. 同一層的 ~/.jr-setup/merge-backups（合併的還原點）與各 profile 旁邊的
//      .bak.<時間戳> 一個都不碰——那是另一件事，也是唯一能把學生自己寫的規則
//      救回來的東西（Reed 拍板：.bak 不一起刪）
//   3. 畫面上那顆按鈕按下去之前，卡片已經把要刪的東西一條一條列出來了
//      （見 src/quarantine.js 的 guidance）
import { existsSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";

import { quarantineEntries, quarantineHome } from "../src/quarantine.js";

const APPLY = process.argv.includes("--apply");
const HOME = homedir();

const entries = quarantineEntries(HOME, {
  list: (dir) =>
    existsSync(dir)
      ? readdirSync(dir, { withFileTypes: true }).map((entry) => entry.name)
      : [],
});

if (entries.length === 0) {
  console.log("隔離區是空的，沒東西要刪。");
  process.exit(0);
}

console.log("要刪掉這幾樣：");

for (const entry of entries) {
  console.log(`  ${entry.path}（${entry.what}）`);
}

console.log("");
console.log(`不會動到：${quarantineHome(HOME)} 以外的任何東西。`);
console.log("  合併的還原點與設定檔旁邊的 .bak 都留著。");

if (!APPLY) {
  console.log("");
  console.log("以上只是先看不動。加 --apply 才會真的刪掉。");
  process.exit(0);
}

console.log("");

let removed = 0;

for (const entry of entries) {
  try {
    rmSync(entry.path, { recursive: true, force: true });
    console.log(`✓ 刪掉 ${entry.path}`);
    removed += 1;
  } catch (error) {
    // 一樣刪不掉不該讓其他幾樣也停下來——跟兩顆搬移鍵同一個理由。
    console.log(`✗ ${entry.path} 刪不掉：${error.message}`);
  }
}

console.log("");

if (removed === entries.length) {
  console.log("清乾淨了。");
  process.exit(0);
}

console.log(`刪掉 ${removed} 樣，還有 ${entries.length - removed} 樣沒動。`);
process.exit(1);
