// 把一個上一輪工作坊留下的 skill 資料夾搬到隔離區。
//
//   node scripts/quarantine-skills.mjs --tools=claude,codex --lang=zh-TW --name=old-namer
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

import { straySkillDirs } from "../src/config-check.js";
import { describeStep, stepsForTools } from "../src/config-install.js";
import { quarantineDir, quarantineStamp } from "../src/legacy.js";

function arg(name, fallback) {
  const found = process.argv.find((value) => value.startsWith(`--${name}=`));
  return found === undefined ? fallback : found.slice(name.length + 3);
}

const tools = arg("tools", "claude").split(",");
const lang = arg("lang", "zh-TW");
const name = arg("name", "");
const home = homedir();

if (name === "") {
  console.error("要搬哪一個沒有指定——這支不做「全部搬走」。");
  process.exit(1);
}

const steps = stepsForTools(tools).map((id) =>
  describeStep(id, { lang, home }),
);
// 第二層把關：名字要真的出現在我自己偵測出來的殘留清單裡。伺服器那層只擋形狀，
// 擋不掉「一個合法但不該碰的名字」——例如這一輪正在發的 skill。
const target = straySkillDirs(steps).find((stray) => stray.name === name);

if (target === undefined) {
  console.error(`「${name}」不在殘留清單裡，什麼都沒動。`);
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
