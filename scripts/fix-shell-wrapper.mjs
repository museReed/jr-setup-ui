// 把 shell 設定檔裡「指向已刪檔案的 claude / codex 函式」整段刪掉。
//
//   先看不動：  node scripts/fix-shell-wrapper.mjs
//   真的清掉：  node scripts/fix-shell-wrapper.mjs --apply
//
// 判準全部在 src/shell-wrapper.js，這裡只負責備份、寫檔、把做了什麼印給學生看。
import { existsSync } from "node:fs";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import {
  findDeadWrappers,
  removeWrapperBlocks,
  shellProfilePaths,
} from "../src/shell-wrapper.js";

const APPLY = process.argv.includes("--apply");

function stamp() {
  return new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

async function backup(target) {
  const backupPath = `${target}.bak.${stamp()}`;
  await copyFile(target, backupPath);
  console.log(`已備份 → ${path.basename(backupPath)}`);
}

let cleaned = 0;

for (const profile of shellProfilePaths(homedir())) {
  if (!existsSync(profile)) {
    continue;
  }

  const content = await readFile(profile, "utf8");
  const dead = findDeadWrappers(content, { exists: existsSync });

  if (dead.length === 0) {
    continue;
  }

  for (const block of dead) {
    console.log(
      `${path.basename(profile)}：${block.command} 指到 ${block.deadPath}（那個檔案已經不在）`,
    );
  }

  if (!APPLY) {
    cleaned += dead.length;
    continue;
  }

  await backup(profile);
  await writeFile(profile, removeWrapperBlocks(content, dead), "utf8");
  cleaned += dead.length;
  console.log(`✓ 已清掉 ${dead.length} 段 → ${profile}`);
}

if (cleaned === 0) {
  console.log("設定檔裡沒有指向空路徑的 claude / codex，不用清。");
} else if (APPLY) {
  console.log("");
  console.log("清完了。要開一個新的終端視窗，改動才會生效。");
} else {
  console.log("");
  console.log("以上只是先看不動。加 --apply 才會真的清掉。");
}
