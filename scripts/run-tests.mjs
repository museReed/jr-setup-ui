// 跑 test/ 底下每一支測試，而且**跑完全部才收工**。
//
// ⚠️ 這支存在的理由是一次真的意外（2026-08-14）：
//
// package.json 原本把四十支檔案用 `&&` 串成一行。`&&` 的意思是「前一個成功才跑下
// 一個」——所以任何一支**載入就失敗**的檔案（改名、刪掉某個 export、打錯字，那是
// SyntaxError 不是測試失敗）會讓整串停在那裡，後面三十幾支根本沒跑。
//
// 而畫面上不會出現 `not ok`（那是斷言失敗才印的字），看起來就像全過。那次是靠
// 「ok 的數量掉下來」才發現的——如果數量剛好接近，就會直接 push 出去，而學生下一秒
// 就能用一行指令抓到那份沒被測過的程式碼。
//
// 所以這支做三件原本沒人做的事：
//
//   1. 一支壞掉不擋住其他支，全部跑完再一起報
//   2. 每一支各自報「跑了幾項」，載入就失敗的那種會是 0 項——那是最容易被漏看的一種
//   3. 收尾印「幾支/幾支、幾項」，任何一支非零就整體非零
//
// 檔案清單直接讀目錄，不維護第二份名單：新加的測試自動被跑到（原本要記得回頭改
// package.json，漏了就是靜靜地不跑）。
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = fileURLToPath(new URL("../test", import.meta.url));

const files = readdirSync(TEST_DIR, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".mjs"))
  .map((entry) => entry.name)
  .sort();

if (files.length === 0) {
  console.error("test/ 底下一支測試都沒有——這件事本身就不對。");
  process.exit(1);
}

const failed = [];
let passedFiles = 0;
let total = 0;

for (const name of files) {
  const result = spawnSync(process.execPath, [path.join(TEST_DIR, name)], {
    encoding: "utf8",
  });
  const stdout = result.stdout ?? "";
  const count = (stdout.match(/^ok - /gm) ?? []).length;

  process.stdout.write(stdout);

  if (result.stderr) process.stderr.write(result.stderr);

  if (result.status === 0) {
    passedFiles += 1;
    total += count;
    // ⚠️ exit 0 但一項都沒跑也算壞掉：檔案被清空、或整段被 try 吞掉時就是這樣，
    // 而那種「安靜的空跑」跟真的全過在畫面上長得一模一樣。
    if (count === 0) {
      failed.push({ name, why: "跑完了但一項都沒有——這支等於沒在測" });
      passedFiles -= 1;
    }
    continue;
  }

  failed.push({
    name,
    // 載入就失敗（SyntaxError、匯入不存在的 export）時 count 會是 0，講明白一點，
    // 不然看起來像「某一項斷言掛了」。
    why:
      count === 0
        ? `連載入都失敗（exit ${result.status}）——看上面的 stderr，多半是匯入了不存在的東西`
        : `跑到第 ${count + 1} 項時失敗（exit ${result.status}）`,
  });
}

console.log("");
console.log(`— ${passedFiles}/${files.length} 支測試檔通過，共 ${total} 項 —`);

if (failed.length > 0) {
  console.log("");

  for (const { name, why } of failed) {
    console.error(`✗ ${name}：${why}`);
  }

  process.exit(1);
}
