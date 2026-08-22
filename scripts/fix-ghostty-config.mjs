// 把 Ghostty 與 zsh 那幾個開關打開。
//
//   先看不動：  node scripts/fix-ghostty-config.mjs
//   真的寫入：  node scripts/fix-ghostty-config.mjs --apply
//
// 判準與內容全部在 src/ghostty-config.js，這裡只負責備份、寫檔、把做了什麼印給
// 學生看。
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import {
  applyGhosttyBlock,
  applyZshBlock,
  ghosttyConfigPath,
  zshrcPath,
} from "../src/ghostty-config.js";

const APPLY = process.argv.includes("--apply");
const HOME = homedir();

function stamp() {
  return new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

// 已經有的檔案才備份。第一次裝的人根本沒有 ~/.config/ghostty/config，備份一個不存在
// 的檔會炸，而那是最常見的情況。
async function backup(target) {
  if (!existsSync(target)) {
    return;
  }

  const backupPath = `${target}.bak.${stamp()}`;
  await copyFile(target, backupPath);
  console.log(`已備份 → ${path.basename(backupPath)}`);
}

async function readOrEmpty(target) {
  try {
    return await readFile(target, "utf8");
  } catch {
    return "";
  }
}

const targets = [
  {
    file: ghosttyConfigPath(HOME),
    apply: applyGhosttyBlock,
    what: "Ghostty 的設定",
  },
  { file: zshrcPath(HOME), apply: applyZshBlock, what: "終端機的設定" },
];

let changed = 0;

for (const target of targets) {
  const before = await readOrEmpty(target.file);
  const after = target.apply(before);

  if (before === after) {
    console.log(`已經是最新的：${target.what}`);
    continue;
  }

  if (!APPLY) {
    console.log(`要更新：${target.what}（${target.file}）`);
    changed += 1;
    continue;
  }

  await backup(target.file);
  // Ghostty 的設定目錄不一定存在——沒開過設定的機器就沒有 ~/.config/ghostty。
  await mkdir(path.dirname(target.file), { recursive: true });
  await writeFile(target.file, after);
  console.log(`已更新 → ${target.file}`);
  changed += 1;
}

if (changed === 0) {
  console.log("");
  console.log("沒有東西要改，這一步已經完成。");
} else if (APPLY) {
  console.log("");
  // ⚠️ 這一句不能省。Ghostty 不會自己重讀設定檔，而學生改完看不到任何變化時，
  // 合理的結論是「按鈕沒有用」，然後再按一次、再一次。
  console.log("設定寫好了。要看到效果，請按 Cmd+Shift+, 重新載入 Ghostty 設定，");
  console.log("或直接關掉 Ghostty 再開一次。");
  console.log("拖資料夾進終端機那一項要新開一個分頁才會生效。");
} else {
  console.log("");
  console.log("這是預覽。真的要寫入請加 --apply。");
}
