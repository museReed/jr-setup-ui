// 執行單一個安裝步驟。嚮導每一列的「安裝」按鈕都是叫這支。
//
//   node scripts/install-configs.mjs --step=hook --lang=zh-TW
//
// 每做一件事就印一行，讓網頁那邊即時看得到。
import { spawn } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import {
  describeStep,
  expandAllowRules,
  mergeAllowRules,
  mergeHookRegistration,
} from "../src/config-install.js";
import { materialsDir } from "../src/paths.js";

const CONFIGS_TARBALL =
  "https://codeload.github.com/museReed/jr_ai_agent_configs/tar.gz/refs/heads/main";
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

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (exitCode) => {
      if (exitCode === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} 失敗（exit ${exitCode}）：${stderr.trim()}`));
    });
  });
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

// 素材每次都重抓：同學可能在課程中途才更新，舊的留著只會裝到過期的規則。
async function downloadMaterials() {
  console.log("下載設定素材…");
  const response = await fetch(CONFIGS_TARBALL);

  if (!response.ok) {
    throw new Error(`下載設定素材失敗：HTTP ${response.status}`);
  }

  const temp = await mkdtemp(path.join(tmpdir(), "jr-configs-"));
  const tarball = path.join(temp, "configs.tar.gz");
  await writeFile(tarball, Buffer.from(await response.arrayBuffer()));

  await rm(MATERIALS, { recursive: true, force: true });
  await mkdir(MATERIALS, { recursive: true });
  // tar 在 macOS 內建，Windows 10 1803 之後也內建（bsdtar）。
  await run("tar", ["-xzf", tarball, "-C", MATERIALS, "--strip-components=1"]);
  await rm(temp, { recursive: true, force: true });
  console.log("✓ 素材已就緒");
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

  if (step.kind === "download") {
    await downloadMaterials();
  } else if (step.kind === "copy") {
    await copyStep(step);
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
