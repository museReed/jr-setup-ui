// 把工作坊自己那幾支 skill 整個換新：舊資料夾搬到隔離區，再重裝一份乾淨的。
//
//   node scripts/reset-workshop-skills.mjs --tools=claude,codex --lang=zh-TW
//
// 為什麼「覆蓋」不夠：安裝只寫我們現在發的那幾個檔案，舊版留下的其他東西會一直躺在
// 同一個資料夾裡——例如以前有、現在沒有的附屬檔——而檢查只逐字比對我們發的那幾個，
// 完全看不到它們。Claude 載入 skill 時看的是整個資料夾。
//
// ⚠️ 只碰嚮導自己要裝的那幾個資料夾（stepsForTools 列出來的 skill 與 external-skill
// 步驟）。學生自己裝的 skill 一個都不會被動到。
//
// external-skill（npx skills add 裝的第三方 skill）也在範圍裡——Reed 拍板。它們跟
// 工作坊自己那幾支一樣是「覆蓋不刪」，舊版留下的檔案照樣會被 Claude 載入。代價是
// 重裝要連得上網（npx 會去抓），斷網時那幾支會失敗而工作坊那幾支不會——所以下面
// 分開報結果，不要讓一支第三方的失敗看起來像整批都壞了。
//
// ⚠️ 搬，不是刪。學生可能改過那支 skill——改動會原封不動留在隔離區裡，路徑印在下面。
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { describeStep, stepsForTools } from "../src/config-install.js";
import { quarantineDir, quarantineStamp } from "../src/legacy.js";
import { moduleFile } from "../src/paths.js";

const installConfigsScript = moduleFile(
  "./install-configs.mjs",
  import.meta.url,
);

function arg(name, fallback) {
  const found = process.argv.find((value) => value.startsWith(`--${name}=`));
  return found === undefined ? fallback : found.slice(name.length + 3);
}

const tools = arg("tools", "claude").split(",");
const lang = arg("lang", "zh-TW");
const home = homedir();

// 這一步的落點資料夾。
//
// 工作坊自己那幾支：第一個檔案一定是 <資料夾>/SKILL.md（見 config-install 的
// skillStep），附屬檔案都在同一個資料夾底下。
//
// 第三方那幾支：marker 就是落點目錄本身。Playwright（Claude）那筆例外——它是寫進
// ~/.claude.json 的 MCP 設定，沒有目錄，所以那個 includes("/skills/") 要留著。
function skillDirOf(step) {
  if (step.kind === "external-skill") {
    return step.marker?.includes("/skills/") ? step.marker : null;
  }

  const skillFile = (step.files ?? []).find((file) =>
    file.target.endsWith("/SKILL.md"),
  );
  return skillFile === undefined ? null : path.dirname(skillFile.target);
}

const steps = stepsForTools(tools)
  .map((id) => describeStep(id, { lang, home }))
  .filter(
    (step) => step.kind === "skill" || step.kind === "external-skill",
  );
const existing = steps
  .map((step) => ({ step, dir: skillDirOf(step) }))
  .filter(({ dir }) => dir !== null && existsSync(dir));

if (existing.length === 0) {
  console.log("這台機器上還沒有工作坊的 skill，直接按各張卡的安裝就好。");
  process.exit(0);
}

const room = quarantineDir(home, quarantineStamp(new Date()));
await mkdir(room, { recursive: true });

console.log(`要換新的有 ${existing.length} 支：`);

for (const { step, dir } of existing) {
  // 同一次操作可能同時搬 claude 與 codex 的同名 skill，所以隔離區裡也分兩層，
  // 不然後搬的那個會蓋掉先搬的。
  const agent = dir.includes("/.agents/") ? "codex" : "claude";
  const destination = path.join(room, agent, path.basename(dir));
  await mkdir(path.dirname(destination), { recursive: true });

  try {
    await rename(dir, destination);
  } catch (error) {
    // 跨磁碟時 rename 會回 EXDEV，那時只能複製再刪。
    if (error.code !== "EXDEV") {
      throw error;
    }

    await cp(dir, destination, { recursive: true });
    await rm(dir, { recursive: true, force: true });
  }

  console.log(`  搬走 ${step.label} → ${destination}`);
}

console.log("");
console.log("舊的都搬走了，現在裝一份乾淨的：");

let failed = false;

for (const { step } of existing) {
  const code = await install(step.id);

  if (code !== 0) {
    failed = true;
    console.error(`  ${step.label} 重裝失敗（exit ${code}）`);

    // 第三方那幾支是 npx 去網路上抓的，最常見的失敗原因就是連不上。分開講，
    // 不然學生看到「重裝失敗」會以為整批都壞了，而工作坊自己那幾支其實好好的。
    if (step.kind === "external-skill") {
      console.error("    這一支是從網路上抓的，連不上網時會失敗。");
      console.error(`    舊的那份還在隔離區，路徑在下面——搬得回來。`);
    }
  }
}

function install(stepId) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [installConfigsScript, `--step=${stepId}`, `--lang=${lang}`],
      { shell: false, stdio: ["ignore", "inherit", "inherit"] },
    );
    child.once("error", () => resolve(1));
    child.once("close", (code) => resolve(code ?? 1));
  });
}

console.log("");
console.log("舊的那幾份沒有被刪掉，都在：");
console.log(`  ${room}`);
console.log("你改過裡面的東西的話，可以從那裡把它找回來。");

if (failed) {
  process.exit(1);
}
