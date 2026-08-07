// 執行單一個安裝步驟。嚮導每一列的「安裝」按鈕都是叫這支。
//
//   node scripts/install-configs.mjs --step=hook --lang=zh-TW
//
// 每做一件事就印一行，讓網頁那邊即時看得到。
import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import {
  applySubstitutions,
  CLAUDE_HUD,
  describeStep,
  OBSIDIAN_GIT,
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

// 跑一條指令，把它的輸出直接串到畫面上。回傳 exit code，由呼叫端決定成敗——
// 這幾支工具（winget / brew / gh）對「本來就裝好了」都會回非 0。
async function runTool(cmd, args, hint) {
  // GIT_TERMINAL_PROMPT=0：憑證拿不到時直接錯，不要停在那裡等一個不會來的輸入。
  //
  // 我們 spawn 的子程序沒有 tty，git 的密碼提問會讓整張卡永遠轉圈——畫面上最後
  // 一行停在「執行：git push」，學生只能按取消（Reed 在 VM 上實測撞到）。
  const env = { ...(await spawnEnv()), GIT_TERMINAL_PROMPT: "0" };
  const spawnable = resolveLaunch(cmd, args, { env });

  return new Promise((resolve, reject) => {
    console.log(`執行：${cmd} ${args.join(" ")}`);
    const child = spawn(spawnable.cmd, spawnable.args, {
      stdio: "inherit",
      shell: false,
      env,
      ...(spawnable.spawnOptions ?? {}),
    });
    child.once("error", (error) =>
      reject(new Error(`叫不到 ${cmd}——${hint}（${error.message}）`)),
    );
    child.once("close", (exitCode) => resolve(exitCode ?? 1));
  });
}

function findObsidian(step) {
  return (step.apps ?? [step.app]).find((candidate) => existsSync(candidate));
}

async function obsidianAppStep(step) {
  const already = findObsidian(step);

  if (already !== undefined) {
    logProgress(`Obsidian 本來就裝好了（${already}）`);
    return;
  }

  if (process.platform === "win32") {
    // --source winget 不能省。
    //
    // 不指定的話 winget 會連 msstore 一起查，而那個來源在 VM 上常常掛掉
    //（0x8a15005e：伺服器憑證對不上）。更麻煩的是它掛掉之後 winget 不會退回只用
    // 能用的那個來源，而是說「好幾個來源都有這個套件，請指定一個」然後整條失敗
    //（Windows VM 實測）。指定了就不會去碰 msstore。
    //
    // --disable-interactivity：我們 spawn 的子程序沒有人在打字，跳出提問等於卡死。
    await runTool(
      "winget",
      [
        "install",
        "-e",
        "--id",
        step.winget,
        "--source",
        "winget",
        "--accept-source-agreements",
        "--accept-package-agreements",
        "--silent",
        "--disable-interactivity",
      ],
      "請確認 Windows 的「應用程式安裝程式」還在",
    );
  } else if ((await runTool("bash", ["-lc", "command -v brew"], "")) === 0) {
    await runTool("brew", ["install", "--cask", step.cask], "請先裝好 Homebrew");
  } else {
    // 沒有 brew 的全新 Mac：下載官方 dmg、掛載、複製、卸載。
    //
    // 嚮導不能代裝 brew——它的安裝腳本要 sudo 密碼，而我們 spawn 的子程序是
    // stdio: pipe、沒有 tty，sudo 讀不到密碼（docs/vm-setup-macos.md 有紀錄）。
    console.log("這台機器沒有 Homebrew，改用官方安裝檔（要下載幾百 MB，慢一點是正常的）");
    const dmg = path.join(tmpdir(), "obsidian.dmg");
    const mount = path.join(tmpdir(), "obsidian-mount");
    await runTool("curl", ["-fL", "--progress-bar", "-o", dmg, step.dmg], "請確認網路");
    await runTool("hdiutil", ["attach", dmg, "-nobrowse", "-quiet", "-mountpoint", mount], "");
    await runTool("cp", ["-R", path.join(mount, "Obsidian.app"), "/Applications/"], "");
    await runTool("hdiutil", ["detach", mount, "-quiet"], "");
  }

  const installed = findObsidian(step);

  if (installed === undefined) {
    // 不要猜原因。安裝工具自己印的那幾行就在上面，猜錯只會把學生指去錯的地方
    //（VM 實測：明明是 winget 來源的憑證問題，訊息卻說「多半是網路問題」）。
    //
    // 找過哪幾個位置也一起講：安裝工具說成功、我們卻說沒有的時候，這份清單是
    // 判斷「它到底裝去哪」的唯一線索。
    throw new Error(
      `Obsidian 沒有裝起來——這幾個位置都找過了：${(step.apps ?? [step.app]).join("、")}。` +
        "原因看上面那幾行安裝工具的輸出，修好之後可以重按一次",
    );
  }

  logProgress(`Obsidian 已安裝 → ${installed}`);
}

// 建 vault、接上自己的 private repo、把 obsidian-git 放進去並設定好。
//
// 這一步只做一次；重按時每一段都是冪等的（已經有的就跳過），因為學生按第二次
// 通常是因為前一次卡在某一段。
// Obsidian 開著的時候不能裝。
//
// 它把「我知道哪些筆記庫」那份名單放在記憶體裡，結束時整份寫回硬碟——我們登記的
// 那一筆會被連同刪掉，而且是安裝成功之後才發生的（Reed 實測：12:55 寫進去、
// 12:59 被蓋掉，卡片一路都是綠的，按驗證卻跳 Vault not found）。
//
// 所以這一關必須擋，不能只在文案提醒。擋在最前面：後面那幾步要下載，白跑很浪費。
async function obsidianRunning() {
  const cmd =
    process.platform === "win32"
      ? ["tasklist", ["/FI", "IMAGENAME eq Obsidian.exe", "/NH"]]
      : ["pgrep", ["-x", process.platform === "darwin" ? "Obsidian" : "obsidian"]];

  return new Promise((resolve) => {
    const child = spawn(cmd[0], cmd[1], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.once("error", () => resolve(false));
    child.once("close", () =>
      resolve(
        process.platform === "win32"
          ? out.toLowerCase().includes("obsidian.exe")
          : out.trim().length > 0,
      ),
    );
  });
}

// 跑一條指令，把 stdout 收回來（不印給學生看，通常是 token 之類的東西）。
async function capture(cmd, args) {
  const env = await spawnEnv();
  const spawnable = resolveLaunch(cmd, args, { env });

  return new Promise((resolve) => {
    const child = spawn(spawnable.cmd, spawnable.args, {
      stdio: ["ignore", "pipe", "ignore"],
      shell: false,
      env,
      ...(spawnable.spawnOptions ?? {}),
    });
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.once("error", () => resolve(null));
    child.once("close", (code) => resolve(code === 0 ? out.trim() : null));
  });
}

// 把 GitHub 的登入資料存進作業系統的鑰匙圈。
//
// 為什麼要這一步：Obsidian 裡的同步外掛跑的是系統 git，而它是被 GUI 程式叫起來
// 的——拿不到終端那份環境，也叫不動 gh 的 credential helper。結果就是 Obsidian
// 裡跳出一個「Username for https://github.com」的輸入框，同步整條斷在那裡
// （Reed 在 VM 上實測撞到）。
//
// git credential approve 會把資料交給「這台機器上設定的那個 helper」——mac 是
// osxkeychain、Windows 是認證管理員。所以這裡不挑平台，也不會把 token 寫成明文
// 檔案；它跟 gh 本來就存 token 的地方是同一類。
async function storeGitCredential() {
  const token = await capture("gh", ["auth", "token"]);
  const login = await capture("gh", ["api", "user", "--jq", ".login"]);

  if (token === null || login === null) {
    console.log("（還沒登入 GitHub，跳過鑰匙圈這一步）");
    return;
  }

  // gh 自己那份設定也補一下：學生之後在終端裡 git push 才不會被問。
  await runTool("gh", ["auth", "setup-git"], "請先裝好 GitHub CLI 並登入");

  // 一個 helper 都沒設的機器上，credential approve 會安靜地什麼都不做——存進去
  // 之後 Obsidian 照樣跳出輸入框，而且沒有任何錯誤訊息。所以先確認有 helper：
  //
  //   mac      osxkeychain（git 內建）
  //   Windows  manager（Git for Windows 內建的認證管理員，通常預設就設好了）
  const configured = await capture("git", ["config", "--get", "credential.helper"]);

  if (configured === null || configured === "") {
    await runTool(
      "git",
      [
        "config",
        "--global",
        "credential.helper",
        process.platform === "win32" ? "manager" : "osxkeychain",
      ],
      "請先裝好 Git",
    );
  }

  const env = await spawnEnv();
  const spawnable = resolveLaunch("git", ["credential", "approve"], { env });

  await new Promise((resolve) => {
    const child = spawn(spawnable.cmd, spawnable.args, {
      stdio: ["pipe", "ignore", "ignore"],
      shell: false,
      env,
      ...(spawnable.spawnOptions ?? {}),
    });
    child.once("error", () => resolve());
    child.once("close", () => resolve());
    child.stdin.end(
      `protocol=https\nhost=github.com\nusername=${login}\npassword=${token}\n\n`,
    );
  });

  logProgress("GitHub 的登入資料已經放進鑰匙圈，Obsidian 不會再問你帳號密碼");

  const name = await capture("git", ["config", "--global", "user.name"]);

  if (name === null || name === "") {
    await runTool("git", ["config", "--global", "user.name", login], "請先裝好 Git");
    await runTool(
      "git",
      ["config", "--global", "user.email", `${login}@users.noreply.github.com`],
      "請先裝好 Git",
    );
    logProgress(`改動歷史上的名字設成 ${login}`);
  }
}

async function obsidianVaultStep(step) {
  if (await obsidianRunning()) {
    throw new Error(
      "Obsidian 現在開著，請先完全關掉它（mac 按 ⌘Q，不是關視窗）再按一次安裝——" +
        "它結束時會把自己那份筆記庫名單整份寫回去，蓋掉我們剛登記的那一筆",
    );
  }

  await mkdir(path.join(step.vault, ".obsidian"), { recursive: true });

  const welcome = path.join(step.vault, "歡迎.md");

  if (!existsSync(welcome)) {
    await copyFile(sourcePath(step), welcome);
    logProgress("放了一篇「這是什麼」進去");
  }

  // .gitignore 在素材裡叫 gitignore：npm 打包時會把 .gitignore 吃掉。
  await copyFile(
    path.join(MATERIALS, step.gitignoreSource),
    path.join(step.vault, ".gitignore"),
  );

  // obsidian-git 的三個檔放進 plugins 目錄就等於裝好了，不必解壓縮。
  await mkdir(step.pluginDir, { recursive: true });

  for (const file of OBSIDIAN_GIT.files) {
    const target = path.join(step.pluginDir, file);
    const code = await runTool(
      "curl",
      ["-fL", "--silent", "--show-error", "-o", target, `${OBSIDIAN_GIT.release}/${file}`],
      "請確認網路",
    );

    if (code !== 0 || !existsSync(target)) {
      throw new Error(`下載 ${file} 失敗，多半是網路問題，可以重按一次`);
    }
  }

  logProgress("同步用的外掛已放進筆記庫");

  // 這一份是「哪些社群外掛要啟用」。沒有它的話檔案在、外掛卻是關的。
  await writeFile(
    path.join(step.configDir, "community-plugins.json"),
    `${JSON.stringify([OBSIDIAN_GIT.plugin], null, 2)}\n`,
  );

  const dataPath = path.join(step.pluginDir, "data.json");
  const current = existsSync(dataPath)
    ? JSON.parse(await readFile(dataPath, "utf8"))
    : {};
  await writeFile(
    dataPath,
    `${JSON.stringify({ ...current, ...OBSIDIAN_GIT.settings }, null, 2)}\n`,
  );
  logProgress("打開 vault 自動拉、每 10 分鐘自動存一次，已經設好");

  // 憑證要在任何一次 push 之前就位。原本排在最後面——第二次跑（remote 已經有了）
  // 走的是 push 那條路，憑證還沒放進鑰匙圈，git 就停在那裡等密碼（VM 實測）。
  await storeGitCredential();

  if (!existsSync(path.join(step.vault, ".git"))) {
    await runTool("git", ["-C", step.vault, "init", "-b", "main"], "請先裝好 Git");
  }

  // 三種情況都要走得通：
  //
  //   第一次        GitHub 上還沒有 → 建一個空的 private repo，接上去
  //   重按一次      本機接好了      → 直接推
  //   重灌過筆記庫  GitHub 上有、本機沒有（學生把資料夾砍了重來，或換一台機器）
  //                 → 接上去、把上面的東西抓下來當基礎，再把這次的疊上去
  //
  // 最後那種本來會死在「Name already exists」，而錯誤訊息還猜成「多半是還沒登入」
  //（VM 實測）。
  const hasRemote =
    (await runTool("git", ["-C", step.vault, "remote", "get-url", "origin"], "")) === 0;

  if (!hasRemote) {
    const url = await capture("gh", ["repo", "view", step.repo, "--json", "url", "--jq", ".url"]);

    if (url === null) {
      // 只建 repo，不帶 --source/--push：那兩個參數要求本機先有 commit，而我們
      // 這時候還沒 commit（順序不能反過來，見下面的 fetch）。
      const code = await runTool(
        "gh",
        ["repo", "create", step.repo, "--private"],
        "請先裝好 GitHub CLI 並登入",
      );

      if (code !== 0) {
        throw new Error(
          "GitHub 上那個 repo 建不起來——先確認你已經登入 GitHub（環境那一段的最後一張卡）",
        );
      }
    } else {
      logProgress("GitHub 上本來就有這個筆記庫了，直接接上去");
    }

    const remote =
      url ?? (await capture("gh", ["repo", "view", step.repo, "--json", "url", "--jq", ".url"]));

    if (remote === null) {
      throw new Error("找不到 GitHub 上那個筆記庫的網址，可以重按一次");
    }

    await runTool("git", ["-C", step.vault, "remote", "add", "origin", remote], "");
  }

  // 遠端已經有東西時，先把它當基礎——不然這次的 commit 跟上面那些是兩段沒有關係
  // 的歷史，push 會被擋下來（而學生看到的是一句他看不懂的 non-fast-forward）。
  //
  // reset --mixed 只動 HEAD 與索引，不碰工作目錄：我們剛寫好的那些檔案都還在，
  // 下面 add -A 會把「跟遠端不一樣的地方」變成這一次的改動。
  await runTool("git", ["-C", step.vault, "fetch", "origin"], "");

  if (
    (await runTool("git", ["-C", step.vault, "rev-parse", "--verify", "origin/main"], "")) === 0
  ) {
    await runTool("git", ["-C", step.vault, "reset", "--mixed", "origin/main"], "");
  }

  await runTool("git", ["-C", step.vault, "add", "-A"], "請先裝好 Git");
  // 沒有東西可 commit 時 git 回非 0，那不是失敗。
  await runTool(
    "git",
    ["-C", step.vault, "commit", "-m", "✨ 建立筆記庫"],
    "請先裝好 Git",
  );

  if ((await runTool("git", ["-C", step.vault, "push", "-u", "origin", "main"], "")) !== 0) {
    throw new Error(
      "推不上去——先確認你已經登入 GitHub（環境那一段的最後一張卡），再回來重按一次",
    );
  }

  await registerVault(step);
  logProgress(`筆記庫已接上 GitHub → ${step.vault}`);
}

// 把筆記庫登記進 Obsidian 自己那份名單。
//
// id 用路徑的雜湊，重按安裝不會長出第二筆。ts 是 Obsidian 用來排「最近開過」的，
// 給現在的時間就好。
//
// ⚠️ Obsidian 開著的時候它會在結束時把這個檔整份寫回去，我們剛寫的可能被蓋掉。
// 所以卡片文案要學生先把 Obsidian 關掉再按安裝。
async function registerVault(step) {
  const id = createHash("sha256").update(step.vault).digest("hex").slice(0, 16);
  const current = existsSync(step.registry)
    ? JSON.parse(await readFile(step.registry, "utf8"))
    : {};
  const vaults = current.vaults ?? {};

  if (vaults[id] !== undefined) {
    logProgress("Obsidian 本來就認得這個筆記庫了");
    return;
  }

  await mkdir(path.dirname(step.registry), { recursive: true });
  await writeFile(
    step.registry,
    `${JSON.stringify(
      { ...current, vaults: { ...vaults, [id]: { path: step.vault, ts: Date.now() } } },
      null,
      2,
    )}\n`,
  );
  logProgress("已經讓 Obsidian 認得這個筆記庫");
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
  } else if (step.kind === "obsidian-app") {
    await obsidianAppStep(step);
  } else if (step.kind === "obsidian-vault") {
    await obsidianVaultStep(step);
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
