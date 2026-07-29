// 照 src/config-install.js 算出來的清單，實際把規則檔裝到 User Level。
//
// 用法（嚮導按鈕會這樣叫）：
//   node scripts/install-configs.mjs --tools=claude,codex --lang=zh-TW
//
// 每做一件事就印一行，讓網頁那邊即時看得到進度。
import { spawn } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import {
  expandAllowRules,
  mergeClaudeSettings,
  planInstall,
} from "../src/config-install.js";

const CONFIGS_TARBALL =
  "https://codeload.github.com/museReed/jr_ai_agent_configs/tar.gz/refs/heads/main";
const HOME = homedir();
const MATERIALS_DIR = path.join(HOME, ".jr-setup", "configs");

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
  return new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .slice(0, 14);
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

// 素材每次都重抓：同學可能在課程中途才更新，舊的留著只會裝到過期的規則。
async function fetchMaterials() {
  console.log("下載設定素材…");
  const response = await fetch(CONFIGS_TARBALL);

  if (!response.ok) {
    throw new Error(`下載設定素材失敗：HTTP ${response.status}`);
  }

  const temp = await mkdtemp(path.join(tmpdir(), "jr-configs-"));
  const tarball = path.join(temp, "configs.tar.gz");
  await writeFile(tarball, Buffer.from(await response.arrayBuffer()));

  await rm(MATERIALS_DIR, { recursive: true, force: true });
  await mkdir(MATERIALS_DIR, { recursive: true });
  // tar 在 macOS 內建，Windows 10 1803 之後也內建（bsdtar）。
  await run("tar", ["-xzf", tarball, "-C", MATERIALS_DIR, "--strip-components=1"]);
  await rm(temp, { recursive: true, force: true });
  console.log("素材已就緒");
}

async function backup(target) {
  if (!existsSync(target)) {
    return;
  }

  const backupPath = `${target}.bak.${stamp()}`;
  await copyFile(target, backupPath);
  console.log(`已備份 → ${path.basename(backupPath)}`);
}

async function applyCopy(step) {
  const source = path.join(MATERIALS_DIR, step.source);

  if (!existsSync(source)) {
    throw new Error(`素材裡找不到 ${step.source}`);
  }

  await mkdir(path.dirname(step.target), { recursive: true });
  await backup(step.target);
  await copyFile(source, step.target);

  if (step.executable === true) {
    await chmod(step.target, 0o755);
  }

  console.log(`✓ ${step.label} → ${step.target}`);
}

async function applyClaudeSettings(step) {
  const allowlistPath = path.join(MATERIALS_DIR, step.allowlistSource);

  if (!existsSync(allowlistPath)) {
    throw new Error(`素材裡找不到 ${step.allowlistSource}`);
  }

  const allowlist = JSON.parse(await readFile(allowlistPath, "utf8"));
  const rules = expandAllowRules(allowlist.permissions.allow, HOME);

  await mkdir(path.dirname(step.target), { recursive: true });
  await backup(step.target);

  const current = existsSync(step.target)
    ? JSON.parse(await readFile(step.target, "utf8"))
    : {};
  const { settings, addedRules } = mergeClaudeSettings(current, {
    hookPath: step.hookPath,
    allowRules: rules,
  });

  await writeFile(step.target, `${JSON.stringify(settings, null, 2)}\n`);
  console.log(`✓ ${step.label}：新增 ${addedRules} 條白名單規則`);
}

const args = parseArgs(process.argv.slice(2));
const tools = (args.tools ?? "").split(",").filter((tool) => tool.length > 0);
const lang = args.lang ?? "zh-TW";

await fetchMaterials();

const { steps, manual } = planInstall({
  tools,
  lang,
  home: HOME,
  existing: {
    claudeMd: existsSync(path.join(HOME, ".claude", "CLAUDE.md")),
    codexConfig: existsSync(path.join(HOME, ".codex", "config.toml")),
  },
});

for (const step of steps) {
  if (step.kind === "copy") {
    await applyCopy(step);
  } else if (step.kind === "claude-settings") {
    await applyClaudeSettings(step);
  } else {
    throw new Error(`不認得的步驟：${step.kind}`);
  }
}

if (manual.length > 0) {
  console.log("");
  console.log("以下項目沒有自動處理，因為蓋掉會弄丟你原本的內容：");

  for (const item of manual) {
    console.log(`• ${item.label}：${item.detail}`);
  }
}

console.log("");
console.log("安裝完成。設定要開新的 session 才會生效。");
