// 執行單一個安裝步驟。嚮導每一列的「安裝」按鈕都是叫這支。
//
//   node scripts/install-configs.mjs --step=hook --lang=zh-TW
//
// 每做一件事就印一行，讓網頁那邊即時看得到。
import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import {
  applySubstitutions,
  CLAUDE_HUD,
  describeStep,
  expandAllowRules,
  mergeAllowRules,
  mergeCodexModes,
  mergeAgentHookRegistrations,
  mergeHookRegistration,
  mergeOutputStyle,
  upsertBlock,
} from "../src/config-install.js";
import { checkExternalSkill } from "../src/config-check.js";
import { materialsDir } from "../src/paths.js";
import { spawnEnv } from "../src/env-path.js";
import { resolveLaunch } from "../src/spawn-command.js";

const HOME = homedir();
const MATERIALS = materialsDir();

function emitJr(event) {
  console.log(`@@JR ${JSON.stringify(event)}`);
}

function logProgress(text) {
  console.log(`✓ ${text}`);
  emitJr({ kind: "progress", text });
}

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
    throw new Error(
      `嚮導內建的素材少了 ${step.source}——請重新下載嚮導再試一次`,
    );
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

    // 但預設模式那兩個 key 還是要落地：交給 AI 合併的話結果不保證也不可重現，
    // 而 Claude Code 那邊的 defaultMode 是程式直接寫進去的。只補這兩行，其餘一個
    // 字都不動。
    if (step.mergeModes === true) {
      const current = await readFile(step.target, "utf8");
      const { content, added, retired } = mergeCodexModes(current);

      if (added.length > 0 || retired.length > 0) {
        await backup(step.target);
        await writeFile(step.target, content);
      }

      if (retired.length > 0) {
        // 講出來：我們動了他檔案裡本來就有的一行。備份在旁邊，還原得回去。
        logProgress(
          `已停用舊的 ${retired.join("、")}（跟 default_permissions 不能並存，留成註解）`,
        );
      }

      if (added.length > 0) {
        logProgress(`已補上預設模式：${added.join("、")}`);
      } else if (retired.length === 0) {
        logProgress("預設模式你已經設過了，沒有更動");
      }
    }

    console.log("其餘內容會顯示成「需要合併」，用旁邊的按鈕交給 AI 幫你併。");
    return;
  }

  const source = sourcePath(step);
  await mkdir(path.dirname(step.target), { recursive: true });
  await backup(step.target);
  await copyFile(source, step.target);
  logProgress(`${step.label} → ${step.target}`);
}

async function outputStyleStep(step) {
  await copyStep(step);
  const settings = mergeOutputStyle(await readSettings(step.settingsTarget), {
    styleName: step.styleName,
  });
  await writeSettings(step.settingsTarget, settings);
  logProgress(`已在 settings.json 啟用「${step.styleName}」`);
}

async function hookStep(step) {
  const source = sourcePath(step);
  await mkdir(path.dirname(step.target), { recursive: true });
  await copyFile(source, step.target);
  await chmod(step.target, 0o755);
  logProgress(`hook 檔案 → ${step.target}`);

  // 只複製檔案不算裝好：沒註冊進 settings.json 的話 hook 不會擋，
  // 而且不會有任何錯誤訊息。兩件事要一起做完才算數。
  const settings = mergeHookRegistration(await readSettings(step.settingsTarget), {
    hookPath: step.target,
  });
  await writeSettings(step.settingsTarget, settings);
  logProgress("已註冊到 settings.json 的 PreToolUse");
}

async function allowlistStep(step) {
  const allowlist = JSON.parse(await readFile(sourcePath(step), "utf8"));
  const rules = expandAllowRules(allowlist.permissions.allow, HOME);
  const { settings, addedRules, modeAdded } = mergeAllowRules(
    await readSettings(step.settingsTarget),
    { allowRules: rules },
  );
  await writeSettings(step.settingsTarget, settings);
  logProgress(`${step.label}：新增 ${addedRules} 條（共 ${rules.length} 條）`);

  // 講出來：這一步除了白名單還動了預設模式，學生按下去該知道自己同意了什麼。
  logProgress(
    modeAdded
      ? "預設模式設成 acceptEdits：工作區內改檔案不再逐次詢問"
      : `預設模式維持你原本設定的 ${settings.permissions.defaultMode}`,
  );
}

async function tabSyncStep(step) {
  const source = sourcePath({ source: step.watcherSource });
  await mkdir(path.dirname(step.target), { recursive: true });
  await backup(step.target);
  // PowerShell 5.1 靠 BOM 判讀中文字；二進位複製才不會在安裝時弄丟。
  await copyFile(source, step.target);

  if (process.platform !== "win32") {
    await chmod(step.target, 0o755);
  }

  const current = existsSync(step.rcTarget)
    ? await readFile(step.rcTarget, "utf8")
    : "";
  const next = upsertBlock(current, step.rcMarker, step.rcBlock);
  await mkdir(path.dirname(step.rcTarget), { recursive: true });
  await backup(step.rcTarget);
  // 新建的 Windows PowerShell profile 也要有 BOM，否則 5.1 會讀壞中文名稱。
  const rcContent =
    process.platform === "win32"
      ? `\ufeff${next.replace(/^\ufeff/, "")}`
      : next;
  await writeFile(step.rcTarget, rcContent);
  logProgress(`watcher → ${step.target}`);
  logProgress(`shell function → ${step.rcTarget}`);
}

async function agentHooksStep(step) {
  for (const file of [...step.hookFiles, ...step.supportFiles]) {
    const source = sourcePath(file);
    await mkdir(path.dirname(file.target), { recursive: true });
    // .ps1 必須保留 UTF-8 BOM，所以所有平台都直接做二進位複製。
    await backup(file.target);
    await copyFile(source, file.target);

    if (process.platform !== "win32" && file.base !== undefined) {
      await chmod(file.target, 0o755);
    }

    logProgress(`hook 檔案 → ${file.target}`);
  }

  let settings = mergeAgentHookRegistrations(
    await readSettings(step.settingsTarget),
    {
      registrations: step.registrations,
      hookMarkers: step.hookFiles.map((file) => file.base),
    },
  );

  // 命名指令要在白名單裡，否則模型每次要命名都跳權限詢問。
  // Windows 上跑的是 powershell 指令，跟 starter-allowlist 裡那條 .sh 規則對不上。
  if (step.namingAllowRule !== undefined) {
    const merged = mergeAllowRules(settings, {
      allowRules: [step.namingAllowRule],
    });
    settings = merged.settings;

    if (merged.addedRules > 0) {
      logProgress("已把命名指令加進白名單");
    }
  }

  await writeSettings(step.settingsTarget, settings);
  logProgress(`已註冊 3 筆 hook → ${step.settingsTarget}`);
}

async function skillStep(step) {
  for (const file of step.files) {
    const source = sourcePath(file);
    await mkdir(path.dirname(file.target), { recursive: true });
    await backup(file.target);
    const content = applySubstitutions(
      await readFile(source, "utf8"),
      step.substitutions,
    );
    await writeFile(file.target, content);
    logProgress(file.target);
  }

  logProgress(`${step.label} 已安裝`);
}

// 第三方 skill 用它們自己 GitHub 上定義的裝法，我們只負責把指令跑起來、把失敗
// 翻成學生看得懂的話。這一步要網路。
//
// ⚠️ 一定要走 resolveLaunch：Windows 上 npx / claude 都是 .cmd 包裝檔，沒有同名
// .exe，shell:false 的 spawn 找不到裸指令而丟 ENOENT——畫面上會變成「叫不到 npx，
// 請先裝 Node」，但 Node 明明就裝好了（VM 實測）。env 也要用 spawnEnv 取，
// 嚮導自己那份 PATH 未必看得到剛裝好的東西。
async function externalSkillStep(step) {
  const env = await spawnEnv();
  const spawnable = resolveLaunch(step.cmd, step.args, { env });

  return new Promise((resolve, reject) => {
    console.log(`執行：${step.cmd} ${step.args.join(" ")}`);
    console.log("（第三方 skill 要連網下載，慢一點是正常的）");
    const child = spawn(spawnable.cmd, spawnable.args, {
      stdio: "inherit",
      shell: false,
      env,
      ...(spawnable.spawnOptions ?? {}),
    });
    child.once("error", (error) =>
      reject(
        new Error(
          `叫不到 ${step.cmd}——${step.cmd === "npx" ? "請先裝 Node 18 以上" : "請先裝好 Claude Code"}（${error.message}）`,
        ),
      ),
    );
    child.once("close", async (exitCode) => {
      if (exitCode === 0) {
        logProgress(`${step.label} 安裝完成`);
        resolve();
        return;
      }

      // exit code 不是權威狀態，落點才是。
      //
      // `claude mcp add` 對「已經註冊過」回 exit 1（訊息是 MCP server playwright
      // already exists in user config）。照著 exit code 判就會變成：東西明明裝好
      // 了，卡片卻是紅的「安裝失敗，多半是網路問題」——猜錯原因，還把學生推去查
      // 網路（VM 實測）。重按一次也永遠是同一個結果。
      //
      // 所以先去問 checkExternalSkill：它在就是在，指令回什麼都不重要。
      const actual = await checkExternalSkill(step);

      if (actual.status === "ok") {
        logProgress(`${step.label} 本來就裝好了（${actual.detail}）`);
        resolve();
        return;
      }

      reject(new Error(`${step.label} 安裝失敗（exit ${exitCode}），多半是網路問題，可以重按一次`));
    });
  });
}

// claude-hud：兩條非互動 CLI + 兩次寫檔（規格見 docs/claude-hud-card.md）。
//
// 為什麼不開一個互動式 Claude session 讓它自己跑問答：學生會被中途的選項卡住、
// 答錯就裝出不一樣的 HUD、失敗了也很難判定卡在哪一步。
async function runClaude(args, what) {
  const env = await spawnEnv();
  const spawnable = resolveLaunch("claude", args, { env });

  await new Promise((resolve, reject) => {
    console.log(`執行：claude ${args.join(" ")}`);
    const child = spawn(spawnable.cmd, spawnable.args, {
      stdio: "inherit",
      shell: false,
      env,
      ...(spawnable.spawnOptions ?? {}),
    });
    child.once("error", (error) =>
      reject(new Error(`叫不到 claude——請先裝好 Claude Code（${error.message}）`)),
    );
    // exit code 不是權威狀態，落點才是（跟第三方 skill 那段同一個理由：重裝一次
    // 常常回非 0，東西卻本來就在）。所以這裡只記下來，成敗交給後面找 cache。
    child.once("close", (exitCode) => {
      if (exitCode !== 0) {
        console.log(`（${what} 回了 exit ${exitCode}，接下來看落點在不在）`);
      }

      resolve();
    });
  });
}

// cache 路徑長這樣：plugins/cache/<marketplace>/claude-hud/<version>/
// 中間那層是 marketplace 名，不能省。版號用數字排序取最新的一個。
export function newestPluginDir(cacheRoot, readDir = readdirSync, exists = existsSync) {
  const found = [];

  if (!exists(cacheRoot)) {
    return null;
  }

  for (const marketplace of readDir(cacheRoot)) {
    const pluginRoot = path.join(cacheRoot, marketplace, "claude-hud");

    if (!exists(pluginRoot)) continue;

    for (const version of readDir(pluginRoot)) {
      if (!/^[0-9]+(\.[0-9]+)+$/.test(version)) continue;
      if (!exists(path.join(pluginRoot, version, "dist", "index.js"))) continue;

      found.push({
        version: version.split(".").map(Number),
        dir: path.join(pluginRoot, version),
      });
    }
  }

  if (found.length === 0) {
    return null;
  }

  found.sort((a, b) => {
    for (let i = 0; i < Math.max(a.version.length, b.version.length); i += 1) {
      const diff = (a.version[i] ?? 0) - (b.version[i] ?? 0);

      if (diff !== 0) return diff;
    }

    return 0;
  });

  return found[found.length - 1].dir;
}

async function claudeHudStep(step) {
  await runClaude(["plugin", "marketplace", "add", step.marketplace], "加 marketplace");
  await runClaude(["plugin", "install", step.plugin, "-s", "user"], "裝 plugin");

  const pluginDir = newestPluginDir(step.cacheRoot);

  if (pluginDir === null) {
    throw new Error(
      `plugin 沒有落地——${step.cacheRoot} 底下找不到 claude-hud 的 dist/index.js，多半是網路問題，可以重按一次`,
    );
  }

  logProgress(`plugin 已就位 → ${pluginDir}`);

  // 固定用嚮導自己這支 node：Claude Code 本來就依賴它，一定存在。偵測 bun 會多一
  // 個「學生沒裝 bun」的失敗點，而且 bun 走的是 TypeScript 原始碼。
  const template = await readFile(
    path.join(MATERIALS, step.commandTemplate),
    "utf8",
  );
  const command = template.trim().replace("{RUNTIME}", process.execPath);
  const settings = await readSettings(step.settingsTarget);
  const previous = settings.statusLine?.command;

  // 學生已經在用別的狀態列（claude-pace、cc-statusline、自己寫的腳本）時，舊的那條
  // 先存起來再蓋——不然他換回去的唯一辦法是重寫一次。
  if (typeof previous === "string" && !previous.includes("claude-hud")) {
    await mkdir(path.dirname(step.previousTarget), { recursive: true });
    await writeFile(step.previousTarget, `${previous}\n`);
    logProgress(
      `你原本那條狀態列已經留一份在 ${step.previousTarget}，想換回去可以照著貼`,
    );
  }

  await writeSettings(step.settingsTarget, {
    ...settings,
    statusLine: {
      type: "command",
      command,
      refreshInterval: CLAUDE_HUD.refreshInterval,
    },
  });
  logProgress(`狀態列已寫進 ${step.settingsTarget}`);

  // config.json 已經有的話合併，不整份蓋掉。
  const existing = existsSync(step.configTarget)
    ? JSON.parse(await readFile(step.configTarget, "utf8"))
    : {};
  await mkdir(path.dirname(step.configTarget), { recursive: true });
  await writeFile(
    step.configTarget,
    `${JSON.stringify(
      {
        ...existing,
        ...CLAUDE_HUD.config,
        display: { ...(existing.display ?? {}), ...CLAUDE_HUD.config.display },
        gitStatus: { ...(existing.gitStatus ?? {}), ...CLAUDE_HUD.config.gitStatus },
      },
      null,
      2,
    )}\n`,
  );
  logProgress(`版面設定已寫進 ${step.configTarget}`);
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
  } else if (step.kind === "tab-sync") {
    await tabSyncStep(step);
  } else if (step.kind === "agent-hooks") {
    await agentHooksStep(step);
  } else if (step.kind === "skill") {
    await skillStep(step);
  } else if (step.kind === "external-skill") {
    await externalSkillStep(step);
  } else if (step.kind === "claude-hud") {
    await claudeHudStep(step);
  } else {
    throw new Error(`不認得的步驟種類：${step.kind}`);
  }
} catch (error) {
  // 學生看到的是這一行，不是一整串 stack trace。
  console.error(error.message);
  emitJr({ kind: "result", ok: false, summary: error.message });
  process.exit(1);
}

console.log("");
console.log("這一步完成。設定要開新的 session 才會生效。");
emitJr({
  kind: "result",
  ok: true,
  summary: "這一步完成。設定要開新的 session 才會生效。",
});
