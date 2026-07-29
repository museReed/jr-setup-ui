// 執行單一個安裝步驟。嚮導每一列的「安裝」按鈕都是叫這支。
//
//   node scripts/install-configs.mjs --step=hook --lang=zh-TW
//
// 每做一件事就印一行，讓網頁那邊即時看得到。
import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import {
  describeStep,
  expandAllowRules,
  mergeAllowRules,
  mergeHookRegistration,
  mergeOutputStyle,
} from "../src/config-install.js";
import { materialsDir } from "../src/paths.js";

const HOME = homedir();
const MATERIALS = materialsDir();

function parseArgs(argv) {
  const args = {};

  for (const entry of argv) {
    const match = entry.match(/^--([^=]+)=(.*)$/);

    if (match !== null) {
      args[match[1]] = match[2];
    }
  }

  return args;
}

function stamp() {
  return new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

async function backup(target) {
  if (!existsSync(target)) {
    return;
  }

  const backupPath = `${target}.bak.${stamp()}`;
  await copyFile(target, backupPath);
  console.log(`已備份 → ${path.basename(backupPath)}`);
}

function sourcePath(step) {
  const source = path.join(MATERIALS, step.source);

  if (!existsSync(source)) {
    throw new Error(`素材裡找不到 ${step.source}，請先按「下載」`);
  }

  return source;
}

async function readSettings(target) {
  if (!existsSync(target)) {
    return {};
  }

  return JSON.parse(await readFile(target, "utf8"));
}

async function writeSettings(target, settings) {
  await mkdir(path.dirname(target), { recursive: true });
  await backup(target);
  await writeFile(target, `${JSON.stringify(settings, null, 2)}\n`);
}

async function copyStep(step) {
  // 已經有的東西不蓋掉——那是使用者自己寫的內容，蓋了救不回來。
  if (step.protectExisting === true && existsSync(step.target)) {
    console.log(`${step.target} 已經存在，沒有覆蓋。`);
    console.log("這一列會顯示成「需要合併」，用旁邊的按鈕交給 AI 幫你併。");
    return;
  }

  const source = sourcePath(step);
  await mkdir(path.dirname(step.target), { recursive: true });
  await backup(step.target);
  await copyFile(source, step.target);
  console.log(`✓ ${step.label} → ${step.target}`);
}

async function outputStyleStep(step) {
  await copyStep(step);
  const settings = mergeOutputStyle(await readSettings(step.settingsTarget), {
    styleName: step.styleName,
  });
  await writeSettings(step.settingsTarget, settings);
  console.log(`✓ 已在 settings.json 啟用「${step.styleName}」`);
}

async function hookStep(step) {
  const source = sourcePath(step);
  await mkdir(path.dirname(step.target), { recursive: true });
  await copyFile(source, step.target);
  await chmod(step.target, 0o755);
  console.log(`✓ hook 檔案 → ${step.target}`);

  // 只複製檔案不算裝好：沒註冊進 settings.json 的話 hook 不會擋，
  // 而且不會有任何錯誤訊息。兩件事要一起做完才算數。
  const settings = mergeHookRegistration(await readSettings(step.settingsTarget), {
    hookPath: step.target,
  });
  await writeSettings(step.settingsTarget, settings);
  console.log("✓ 已註冊到 settings.json 的 PreToolUse");
}

async function allowlistStep(step) {
  const allowlist = JSON.parse(await readFile(sourcePath(step), "utf8"));
  const rules = expandAllowRules(allowlist.permissions.allow, HOME);
  const { settings, addedRules } = mergeAllowRules(
    await readSettings(step.settingsTarget),
    { allowRules: rules },
  );
  await writeSettings(step.settingsTarget, settings);
  console.log(`✓ ${step.label}：新增 ${addedRules} 條（共 ${rules.length} 條）`);
}

const args = parseArgs(process.argv.slice(2));

try {
  const step = describeStep(args.step, {
    lang: args.lang ?? "zh-TW",
    home: HOME,
  });

  if (step.kind === "copy") {
    await copyStep(step);
  } else if (step.kind === "output-style") {
    await outputStyleStep(step);
  } else if (step.kind === "hook") {
    await hookStep(step);
  } else if (step.kind === "allowlist") {
    await allowlistStep(step);
  } else {
    throw new Error(`不認得的步驟種類：${step.kind}`);
  }
} catch (error) {
  // 學生看到的是這一行，不是一整串 stack trace。
  console.error(error.message);
  process.exit(1);
}

console.log("");
console.log("這一步完成。設定要開新的 session 才會生效。");
