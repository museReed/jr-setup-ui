// 把一個上一輪工作坊留下的 skill 資料夾搬到隔離區。
//
//   node scripts/quarantine-skills.mjs --tools=claude,codex --lang=zh-TW --name=old-namer
//   node scripts/quarantine-skills.mjs --name=handoff --scope=legacy-codex
//
// ⚠️ 搬，不是刪。理由見 src/legacy.js 的 quarantineDir——誤判搬得回來，出事查得到。
//
// ⚠️ 一次只搬一個，而且一定要指名。「全部搬走」那種按鈕不能做：我們分不出「上一輪
// 發的」與「他自己裝的」，而多數人兩種都有——一顆按鈕把他自己寫的 skill 一起搬走，
// 比留著殘留糟糕得多。
//
// 網頁端送進來的只是一個名字，不是路徑。而且那個名字必須出現在這支自己重跑一次的
// 偵測結果裡（跟卡片上看到的是同一個函式）才會動手——伺服器那層擋形狀，這一層擋
// 「它到底是不是我認定的殘留」。
import { cp, mkdir, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import {
  legacyCodexSkillDirs,
  straySkillDirs,
} from "../src/config-check.js";
import { describeStep, stepsForTools } from "../src/config-install.js";
import {
  legacyCodexSkillRoot,
  quarantineDir,
  quarantineStamp,
} from "../src/legacy.js";

function arg(name, fallback) {
  const found = process.argv.find((value) => value.startsWith(`--${name}=`));
  return found === undefined ? fallback : found.slice(name.length + 3);
}

const tools = arg("tools", "claude").split(",");
const lang = arg("lang", "zh-TW");
const name = arg("name", "");
// 搬哪一份殘留。兩種殘留是兩個不同的資料夾，同一個名字可能兩邊都有：
//
//   stray         停發的名字，躺在現在的 skills 根目錄底下（RETIRED_SKILLS）
//   legacy-codex  我們發過的名字，躺在 codex 搬家前的 ~/.codex/skills 底下
//
// 預設留 stray，因為那是這支原本唯一做的事。
const scope = arg("scope", "stray");
const home = homedir();

if (name === "") {
  console.error("要搬哪一個沒有指定——這支不做「全部搬走」。");
  process.exit(1);
}

if (scope !== "stray" && scope !== "legacy-codex") {
  console.error(`--scope 只收 stray 或 legacy-codex，收到的是「${scope}」。`);
  process.exit(1);
}

// ⚠️ legacy-codex 那條一律用兩個 agent 的步驟，不跟著 --tools 走——偵測那邊
//（legacyCodexScanReport）就是寫死兩個。跟著選擇走的話，只勾了 claude 的學生看得到
// 那顆按鈕、按下去卻是「不在清單裡」：畫面上有、按了說沒有，正是最傷信任的那種不一致。
const steps = stepsForTools(scope === "legacy-codex" ? ["claude", "codex"] : tools).map(
  (id) => describeStep(id, { lang, home }),
);
// 第二層把關：名字要真的出現在我自己偵測出來的殘留清單裡。伺服器那層只擋形狀，
// 擋不掉「一個合法但不該碰的名字」——例如這一輪正在發的 skill。
//
// 兩個 scope 各自重跑自己的偵測，跟卡片上看到的是同一個函式——網頁送進來的仍然只有
// 一個名字，路徑一律是這支自己算的。
const found =
  scope === "stray"
    ? straySkillDirs(steps)
    : legacyCodexSkillDirs(steps, legacyCodexSkillRoot(home));
const target = found.find((stray) => stray.name === name);

if (target === undefined) {
  console.error(`「${name}」不在殘留清單裡（scope=${scope}），什麼都沒動。`);
  console.error("（清單是每次重新掃出來的：這一輪正在發的 skill 不會出現在裡面。）");
  process.exit(1);
}

const room = quarantineDir(home, quarantineStamp(new Date()));
await mkdir(room, { recursive: true });
const destination = path.join(room, target.name);

try {
  await rename(target.path, destination);
} catch (error) {
  // 跨磁碟或跨檔案系統時 rename 會回 EXDEV（Windows 的 %USERPROFILE% 與開發用磁碟
  // 不同槽時撞得到）。那時只能複製再刪。
  if (error.code !== "EXDEV") {
    throw error;
  }

  await cp(target.path, destination, { recursive: true });
  await rm(target.path, { recursive: true, force: true });
}

console.log(`已搬走：${target.path}`);
console.log(`搬到：${destination}`);
console.log("");
console.log("它沒有被刪掉。搬錯了的話，把那個資料夾搬回原本的位置就會恢復。");
