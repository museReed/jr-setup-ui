// 把舊落點（~/.codex/skills）裡跟這次要裝的同名的 skill 搬進隔離區。
//
//   先看不動：  node scripts/fix-legacy-skills.mjs
//   真的搬走：  node scripts/fix-legacy-skills.mjs --apply
//
// 為什麼是「搬走」不是「刪掉」：那是學生上一輪的東西，可能被他改過。搬到隔離區
// 之後 codex 不會再讀它，但學生想找回來還找得到。
//
// ⚠️ 也不能只改名留在原地。codex 掃的是 skills 底下每一個子目錄——一個叫
// handoff.bak.20260811 的目錄照樣會被讀進去，而它 frontmatter 裡的 name 仍然是
// handoff，衝突原封不動。一定要搬出那個根目錄。
import { existsSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { SKILL_NAMES } from "../src/config-install.js";
import {
  conflictingLegacySkills,
  legacySkillRoot,
  quarantineRoot,
} from "../src/skill-roots.js";

const APPLY = process.argv.includes("--apply");
const HOME = homedir();
const OUR_CODEX_SKILLS = [...SKILL_NAMES, "vault-sync"];
const root = legacySkillRoot(HOME);

function stamp() {
  return new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

if (!existsSync(root)) {
  console.log("舊落點不存在，沒東西要處理。");
  process.exit(0);
}

const names = conflictingLegacySkills(
  readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name),
  OUR_CODEX_SKILLS,
);

if (names.length === 0) {
  console.log("舊落點沒有跟這次要裝的打架的 skill，不用處理。");
  process.exit(0);
}

const target = quarantineRoot(HOME);

console.log("這幾個舊 skill 會跟這次要裝的同名，Codex 兩份都會載入：");

for (const name of names) {
  console.log(`  ${path.join(root, name)}`);
}

console.log("");
console.log(`搬去：${target}`);

if (!APPLY) {
  console.log("");
  console.log("以上只是先看不動。加 --apply 才會真的搬走。");
  process.exit(0);
}

mkdirSync(target, { recursive: true });

const suffix = stamp();
let moved = 0;

for (const name of names) {
  const from = path.join(root, name);
  const to = path.join(target, `${name}-${suffix}`);

  try {
    renameSync(from, to);
    console.log(`✓ ${name} → ${to}`);
    moved += 1;
  } catch (error) {
    // 一支搬不動不該讓其他幾支也停下來——學生看到「搬了兩個、第三個失敗」
    // 比看到「全部沒動」好判斷。
    console.log(`✗ ${name} 搬不動：${error.message}`);
  }
}

console.log("");

if (moved === names.length) {
  console.log("搬完了。Codex 下次啟動就只會看到這次裝的那一份。");
  process.exit(0);
}

console.log(`搬走 ${moved} 個，還有 ${names.length - moved} 個沒動。`);
process.exit(1);
