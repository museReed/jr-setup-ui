import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readlinkSync, realpathSync } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { actions } from "./actions.js";
import {
  EXECUTION_POLICY_PROBE,
  parseExecutionPolicy,
} from "./execution-policy.js";
import { spawnEnv } from "./env-path.js";
import { installActionId, resolveInstaller } from "./installers.js";
import {
  findSandboxHelper,
  isStorePowerShell,
  sandboxFilesStatus,
  sandboxAnswered,
  sandboxSetupStatus,
  storePowerShellStatus,
} from "./codex-sandbox.js";
import { SKILL_NAMES } from "./config-install.js";
import {
  NPM_PACKAGES,
  inspectCommand,
  legacyCliStatus,
} from "./legacy-cli.js";
import {
  findDeadWrappers,
  shellProfilePaths,
  shellWrapperStatus,
} from "./shell-wrapper.js";
import {
  quarantineHome,
  quarantineRow,
  quarantineState,
} from "./quarantine.js";
import {
  brewLeftoverRow,
  brewNameFromTarget,
  commandFromEntry,
  leftoverCommands,
  npmLeftoverRow,
} from "./leftovers.js";
import {
  conflictingLegacySkills,
  legacySkillRoot,
  legacySkillStatus,
} from "./skill-roots.js";
import {
  findAllExecutables,
  pickRunnable,
  resolveSpawn,
} from "./spawn-command.js";
import { ghosttyAppPaths } from "./terminal-window.js";

// 實測（Windows VM，全部進過快取之後）最慢一項 529ms、九項併行 1.5 秒。
// 但同學撞到的是「剛裝完的第一次啟動」——npm 剛寫完檔案、Defender 正在掃、
// node 第一次載入整包 bundle，那一次會破 5 秒，而且裝完自動重查一定撞得到。
const TIMEOUT_MS = 15000;

// 逾時只代表「這次沒問到」，不代表沒裝。歸成 missing 會長出安裝按鈕，
// 等於叫同學去重裝一個已經裝好的東西（實測 Codex CLI 就被這樣誤報）。
function timedOut(id, label) {
  return { id, label, status: "warn", detail: "檢查逾時，請再按一次重新檢查" };
}

// 哪幾列只屬於某一個工具。第一張卡選「只要 Codex」時，Claude Code 的安裝與登入
// 就不該再出現——原本這個選擇只送到 /configs（規則檔那一段），環境段完全不知道
// 有這回事，於是學生選了只要 Codex，還是被要求裝 Claude Code。
//
// 沒列在這裡的（git / gh / node / python / 終端機那些）是兩邊共用的前置，永遠都要查。
const TOOL_ONLY_CHECKS = {
  claude: ["claude", "claude-auth"],
  // ⚠️ pwsh-store 是 codex 專屬的。它從「只描述」改回黃燈之後（2026-08-12），
  // 那一列會擋住整張卡、進而擋住整個環境段——而它講的是 codex 沙箱跑不動指令，
  // 跟 Claude Code 一點關係都沒有。不放進來的話，只選 Claude 的學生會被一個
  // 他永遠不需要在意的問題卡住，而且那一列還沒有按鈕可以按。
  codex: [
    "codex",
    "codex-auth",
    "codex-sandbox",
    "codex-sandbox-ready",
    "codex-legacy-skills",
    "pwsh-store",
  ],
};

export function checksForTools(checks, tools) {
  // 空陣列＝沒指定，照舊全查。/env 在選擇載入之前也會被呼叫到。
  if (!Array.isArray(tools) || tools.length === 0) {
    return checks;
  }

  const dropped = new Set(
    Object.entries(TOOL_ONLY_CHECKS)
      .filter(([tool]) => !tools.includes(tool))
      .flatMap(([, ids]) => ids),
  );
  return checks.filter((check) => !dropped.has(check.id));
}

// 平台是參數不是全域狀態：copy-studio 要在 mac 上算得出「Windows 的學生會依序
// 遇到哪幾列」，才排得出兩個平台各自的順序。原本這份清單在 import 時就看
// process.platform 定死了，在 mac 上永遠問不到 Windows 那四列。
export function checksForPlatform(platform) {
  const checks = [
    { id: "claude", label: "Claude Code CLI" },
    { id: "claude-auth", label: "Claude Code 登入狀態" },
    { id: "codex", label: "Codex CLI" },
    { id: "codex-auth", label: "Codex 登入狀態" },
    // 沙箱那一列只有 Windows 有意義：junction 與 MSIX 都是 Windows 專屬的裝法。
    // ⚠️ 兩列不是一列：檔案接不接得上、設定好了沒，是兩件事、兩顆按鈕
    // （見 codex-sandbox.js）。檔案那列排前面——接不上的話設定一定會失敗。
    ...(platform === "win32"
      ? [
          { id: "codex-sandbox", label: "Codex 沙箱要用的檔案" },
          { id: "codex-sandbox-ready", label: "Codex 沙箱設定好了" },
        ]
      : []),
    // 兩個平台都要：~/.codex/skills 這個舊落點跟作業系統無關。
    { id: "codex-legacy-skills", label: "沒有打架的舊版 skill" },
    { id: "git", label: "Git" },
    { id: "gh", label: "GitHub CLI" },
    { id: "gh-auth", label: "GitHub 登入狀態" },
    { id: "node", label: "Node.js" },
    { id: "python", label: "Python 3" },
    { id: "shell-wrapper", label: "終端機裡的 claude / codex 是活的" },
    // 兩個平台都要：npm 全域安裝在 mac 上一樣會留下並存與孤兒 shim。
    { id: "legacy-npm-cli", label: "沒有上一輪套件管理器裝的殘留" },
  ];

  if (platform === "win32") {
    checks.unshift({ id: "execution-policy", label: "PowerShell 執行原則" });
    checks.push(
      { id: "windows-terminal", label: "終端機是 Windows Terminal" },
      { id: "powershell-version", label: "PowerShell 版本" },
      { id: "powershell-encoding", label: "PowerShell 中文編碼" },
      // 只是把「這台的 PowerShell 7 是哪一種」講出來，不是警告——實測 Store 版
      // 底下 Codex 沙箱是正常的（見 codex-sandbox.js 的說明）。
      { id: "pwsh-store", label: "PowerShell 7 的安裝方式" },
    );
  }

  if (platform === "darwin") {
    checks.push({ id: "ghostty", label: "Ghostty 終端機" });
  }

  // 兩個平台都有：mac 走 Homebrew cask，Windows 走 winget。
  // 這一列是**選用**的（狀態 optional，不擋卡片完成）——沒裝也能上完整堂課，
  // 但今天最花時間的是「把需求講清楚」，用講的比打字快，所以還是放進來。
  checks.push({ id: "typeless", label: "Typeless 語音輸入（選用）" });

  return checks;
}

const CHECKS = checksForPlatform(process.platform);

export function ghosttyStatus(paths, exists) {
  const installed = paths.some((path) => exists(path));
  return {
    status: installed ? "ok" : "missing",
    detail: installed ? "已安裝" : "未安裝",
  };
}

// 工作坊硬性要求跑在 Windows Terminal 上——沒有分頁就沒有標題可以命名，
// 而且舊主控台的中文常變方框。所以沒用它就是紅的，不是黃的提醒。
//
// 「沒安裝」與「裝了但沒用它開」要分開：前者給安裝按鈕，後者叫人換視窗重開。
// 兩者混在一起的話，已經有 Windows Terminal 的人會看到一顆沒有意義的安裝鍵。
export function windowsTerminalStatus(env, installed) {
  if (env.WT_SESSION) {
    return { status: "ok", detail: "是" };
  }

  if (installed) {
    return {
      status: "missing",
      detail: "請改用 Windows Terminal 開一個 PowerShell 分頁，再重新啟動嚮導",
      installable: false,
    };
  }

  return {
    status: "missing",
    detail: "尚未安裝 Windows Terminal",
    installable: true,
  };
}

export function parsePowerShellVersion(stdout) {
  const version = typeof stdout === "string" ? stdout.trim() : "";
  const match = version.match(/^(\d+)\.(\d+)(?:\.\d+)*$/);

  if (match === null) {
    return { version: null, supported: false };
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  return {
    version,
    supported: (major === 5 && minor >= 1) || major >= 7,
  };
}

export function encodingProbeSource(text, outputPath = "output.txt") {
  const escapedPath = outputPath.replaceAll("'", "''");
  const escapedText = text
    .replaceAll("`", "``")
    .replaceAll("$", "`$")
    .replaceAll('"', '`"');
  return `\uFEFF$out = '${escapedPath}'\n[System.IO.File]::WriteAllText($out, "${escapedText}", (New-Object System.Text.UTF8Encoding $false))\n`;
}

export function parseClaudeAuth(stdout) {
  try {
    const parsed = JSON.parse(typeof stdout === "string" ? stdout : "");

    if (
      parsed === null ||
      typeof parsed !== "object" ||
      !Object.hasOwn(parsed, "loggedIn")
    ) {
      return { loggedIn: false, detail: "無法判讀登入狀態" };
    }

    if (parsed.loggedIn !== true) {
      return { loggedIn: false, detail: "未登入" };
    }

    const detail =
      typeof parsed.subscriptionType === "string" &&
      parsed.subscriptionType.length > 0
        ? `已登入（${parsed.subscriptionType}）`
        : "已登入";
    return { loggedIn: true, detail };
  } catch {
    return { loggedIn: false, detail: "無法判讀登入狀態" };
  }
}

export function parseCodexAuth(stdout) {
  const loggedIn =
    typeof stdout === "string" && stdout.includes("Logged in");
  return {
    loggedIn,
    detail: loggedIn ? "已登入" : "未登入",
  };
}

// Windows 上 npm 安裝的 CLI 是 claude.cmd / codex.cmd 這種包裝檔，沒有同名 .exe。
// spawn 不開 shell 時找不到裸指令，必須補上 .cmd 再試一次。
// （實測：PowerShell 直接跑 `claude` 會去找 claude.ps1；spawn 則是整個找不到。）
// emptyFailureMeansMissing 只有版本探測能開：真的存在的 CLI 回答 --version
// 一定會寫 stdout，所以「沒 stdout 又非零」等於沒找到。
// ⚠️ 登入探測不能開——`codex login status` 未登入時就是「非零 + 空 stdout +
// 訊息寫在 stderr」，特徵跟指令不存在完全一樣，會被誤判成「需要先安裝」。
export async function runProbe(cmd, args, { emptyFailureMeansMissing = false } = {}) {
  const first = await spawnProbe(cmd, args);

  if (
    process.platform === "win32" &&
    first.type === "error" &&
    first.error?.code === "ENOENT" &&
    !cmd.includes(".")
  ) {
    const retried = await spawnProbe(`${cmd}.cmd`, args);
    return emptyFailureMeansMissing ? normalizeNotFound(retried) : retried;
  }

  return first;
}

// 退路是交給 cmd.exe 跑，而 cmd.exe 一定存在——它自己會啟動成功，只是找不到
// 目標指令。不還原成 ENOENT 的話，「未安裝」會被誤報成「檢查失敗」。
//
// ⚠️ 不能只認 9009：實測 gh 未安裝時 cmd.exe 回的是 exit code 1
// （'gh.cmd' is not recognized…）。也不能比對那句話——它會隨 Windows 語系變。
// 判準改成「完全沒有 stdout 又非零」：真的存在的 CLI 回答 --version 一定會寫 stdout。
export function normalizeNotFound(result) {
  if (
    result.type === "close" &&
    result.exitCode !== 0 &&
    (result.stdout ?? "").trim() === ""
  ) {
    return { type: "error", error: { code: "ENOENT" } };
  }

  return result;
}

async function spawnProbe(rawCmd, rawArgs) {
  // spawnOptions 不能漏：cmd.exe 包裝要 windowsVerbatimArguments，少了它 Node 會
  // 把整串指令再跳脫一次，探測必定失敗——畫面上是 Claude Code / Codex 明明裝了
  // 卻顯示「未安裝」（VM 實測）。
  const { cmd, args, spawnOptions } = resolveSpawn(rawCmd, rawArgs);
  const env = await spawnEnv();
  return new Promise((resolve) => {
    let child;
    let settled = false;
    let stdout = "";
    let stderr = "";

    const finish = (result) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    try {
      child = spawn(cmd, args, {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env,
        ...(spawnOptions ?? {}),
      });
    } catch (error) {
      resolve({ type: "error", error });
      return;
    }

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    // 有些 CLI 把狀態訊息寫到 stderr（實測 `codex login status` 就是），
    // 只讀 stdout 會誤判成「未登入」。
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ type: "timeout" });
    }, TIMEOUT_MS);

    child.once("error", (error) => {
      finish({ type: "error", error });
    });
    child.once("close", (exitCode) => {
      finish({ type: "close", exitCode, stdout, stderr, output: stdout + stderr });
    });
  });
}

// 哪一列在什麼狀態下掛哪一顆修復鍵。匯出是為了讓 test/viewmodel.mjs 走訪得到——
// 新加一顆修復鍵卻忘了給它按鈕文字時，那支測試會紅（實測 fix-shell-wrapper
// 就是這樣長出一顆寫著「開始登入」的清除鍵）。
export const FIX_ACTIONS = {
  "execution-policy": (status) =>
    status === "ok" ? null : "fix-execution-policy",
  "shell-wrapper": (status) => (status === "warn" ? "fix-shell-wrapper" : null),
  // 2026-08-12 接上了。8/11 不接的理由是「Store 版底下沙箱完全正常」——那次的
  // 測試無效（沙箱根本沒設定起來，見 codex-sandbox.js）。真的設定起來之後，
  // 市集版的 pwsh 在沙箱裡 20/20 失敗（上游 openai/codex#35871 量的）。
  //
  // ⚠️ 走 fixAction 不走 installAction：withActions 只在 missing 時給安裝鍵，
  // 而這一列是黃燈——東西裝了，只是裝錯種類。指向的仍然是 INSTALLERS 那支
  // （key 就叫 pwsh-store），所以 action 本身由 actions.js 的那個迴圈自動註冊。
  "pwsh-store": (status) =>
    status === "warn" ? installActionId("pwsh-store") : null,
  "codex-sandbox": (status) => (status === "warn" ? "fix-codex-sandbox" : null),
  // ⚠️ 這一列非有按鈕不可。沙箱的設定只能在 codex 自己的選單裡完成，而那個選單
  // 只在它第一次用到沙箱時跳出來——沒有按鈕的話學生看得到問題卻無事可做
  // （Reed 在畫面前指出）。這顆開一個真的終端把 codex 叫起來。
  "codex-sandbox-ready": (status) =>
    status === "warn" ? "setup-codex-sandbox" : null,
  "codex-legacy-skills": (status) =>
    status === "warn" ? "fix-legacy-skills" : null,
  // ⚠️ 這一列是綠燈才有按鈕，跟其他每一顆都相反。它不是在修毛病，是把前面兩顆
  // 清理鍵留下的備份收掉。
  //
  // ⚠️ 判準看的是 `clearable` 不是 status——清乾淨之後那一列**留著**（否則整張卡
  // 連同里程碑會消失），而那時它同樣是綠的，只是沒東西可刪了。
  quarantine: (status, check) => (check?.clearable === true ? "clear-quarantine" : null),
  // brew 的收尾。這一列是黃燈才有按鈕（跟隔離區那一列相反）——收乾淨之後它就是
  // 一列打勾的紀錄，沒有東西可按了。
  "brew-leftover": (status) =>
    status === "warn" ? "finish-brew-uninstall" : null,
  "npm-leftover": (status) =>
    status === "warn" ? "finish-npm-uninstall" : null,
  // ⚠️ 這一列的按鈕不是「黃燈就有」——只有 npm 版的情況也是黃燈，但那時不能清
  // （見 legacy-cli.js 的第 3 種）。所以按鈕跟著那一列自己回的 fixLabel 走。
  "legacy-npm-cli": (status, check) =>
    status === "warn" && check?.fixLabel != null ? "fix-legacy-cli" : null,
  "claude-auth": (status) => (status === "warn" ? "login-claude" : null),
  "codex-auth": (status) => (status === "warn" ? "login-codex" : null),
  "gh-auth": (status) => (status === "warn" ? "login-gh" : null),
};

function withActions(check) {
  // installable 為 false 的紅燈是「東西在、但用錯方式」——給安裝按鈕只會誤導。
  // optional 跟 missing 一樣要給安裝鍵：那一列是「選用但可以裝」，
  // 只認 missing 的話按鈕永遠不會出現，學生只看得到一句「未安裝」卻沒得按。
  const installer =
    (check.status === "missing" || check.status === "optional") &&
    check.installable !== false
      ? resolveInstaller(check.id, process.platform)
      : null;
  // 第二個參數是整列結果：有幾列的按鈕給不給不只看 status（npm 殘留那列同樣是黃燈，
  // 但「只有 npm 版」時不能給清理鍵）。
  const fixAction = FIX_ACTIONS[check.id]?.(check.status, check) ?? null;
  // installAction 在項目裝好之後也會變 null（installer 只在 missing 時才解析），
  // 所以前端光看它分不出「已經裝好」與「這根本不是可以安裝的東西」。
  // execution-policy 這種設定類項目沒有 installer，卡片上不該出現安裝按鈕——
  // 硬塞一顆永遠置灰的「安裝」只會讓學生問「安裝什麼？」（Reed 實測提問）。
  const hasInstaller =
    check.installable !== false &&
    resolveInstaller(check.id, process.platform) !== null;

  return {
    ...check,
    hasInstaller,
    installAction: installer === null ? null : installActionId(check.id),
    fixAction:
      fixAction !== null && Object.hasOwn(actions, fixAction)
        ? fixAction
        : null,
  };
}

async function checkExecutionPolicy() {
  const id = "execution-policy";
  const label = "PowerShell 執行原則";

  try {
    const result = await runProbe(
      EXECUTION_POLICY_PROBE.cmd,
      EXECUTION_POLICY_PROBE.args,
    );

    if (result.type === "timeout") {
      return timedOut(id, label);
    }

    if (result.type === "error" || result.exitCode !== 0) {
      return { id, label, status: "warn", detail: "檢查失敗" };
    }

    const policy = parseExecutionPolicy(result.stdout);
    return {
      id,
      label,
      status: policy.ok ? "ok" : "warn",
      detail: policy.detail,
    };
  } catch {
    return { id, label, status: "warn", detail: "檢查失敗" };
  }
}

// 這台裝了 Typeless 沒有。回傳的狀態只有 ok / optional 兩種——
// **永遠不會是 missing**，因為沒裝不是錯，只是還沒裝（見 STATUS_DISPLAY.optional）。
export function typelessStatus(installed) {
  return installed
    ? { status: "ok", detail: "已安裝" }
    : { status: "optional", detail: "未安裝——按右邊可以裝，不裝也能上課" };
}

// mac 的路徑固定：cask 一律裝進 /Applications。使用者自己搬走的情況不管，
// 那種人本來就知道自己在做什麼。
export function typelessAppPaths(home) {
  return ["/Applications/Typeless.app", `${home}/Applications/Typeless.app`];
}

async function checkTypeless() {
  const id = "typeless";
  const label = "Typeless 語音輸入（選用）";

  if (process.platform === "darwin") {
    const installed = typelessAppPaths(homedir()).some((path) =>
      existsSync(path),
    );
    return { id, label, ...typelessStatus(installed) };
  }

  // Windows：問 winget 本人，不去猜安裝路徑——它裝在哪由 installer 決定，
  // 而且 app execution alias 的位置會因安裝方式而不同（跟 wt.exe 同一個教訓）。
  const result = await runProbe("winget.exe", [
    "list",
    "-e",
    "--id",
    "SimplyCA.Typeless",
  ]);
  const installed =
    result.type === "close" &&
    result.code === 0 &&
    /SimplyCA\.Typeless/i.test(result.stdout ?? "");
  return { id, label, ...typelessStatus(installed) };
}

function checkGhostty() {
  const id = "ghostty";
  const label = "Ghostty 終端機";
  // ⚠️ 路徑清單跟 terminal-window.js 共用同一份。分兩份的話會長出「這一列說已安裝，
  // 驗證卻還是跑在系統 Terminal 上」這種矛盾——判「裝了沒」與判「用不用它開」看的
  // 必須是同一個地方。
  const status = ghosttyStatus(ghosttyAppPaths(homedir()), existsSync);
  return { id, label, ...status };
}

async function checkWindowsTerminal() {
  const id = "windows-terminal";
  const label = "終端機是 Windows Terminal";

  // 已經跑在裡面就不用查有沒有裝，省一次 spawn。
  if (process.env.WT_SESSION) {
    return { id, label, ...windowsTerminalStatus(process.env, true) };
  }

  // 問 PowerShell 本人，不去猜安裝路徑：app execution alias 的位置與可見性
  // 會因為安裝方式（Store / winget / 全機安裝）而不同，實測過檔案判定會漏。
  // 也不直接跑 wt.exe——那會真的開一個視窗出來。
  const result = await runProbe("powershell.exe", [
    "-NoProfile",
    "-Command",
    "if (Get-Command wt -ErrorAction SilentlyContinue) { 'installed' } else { 'missing' }",
  ]);
  const installed =
    result.type === "close" &&
    result.exitCode === 0 &&
    (result.stdout ?? "").includes("installed");

  return { id, label, ...windowsTerminalStatus(process.env, installed) };
}

async function checkPowerShellVersion() {
  const id = "powershell-version";
  const label = "PowerShell 版本";

  try {
    const result = await runProbe("powershell.exe", [
      "-NoProfile",
      "-Command",
      "$PSVersionTable.PSVersion.ToString()",
    ]);

    if (result.type === "timeout") {
      return timedOut(id, label);
    }

    const parsed = parsePowerShellVersion(
      result.type === "close" && result.exitCode === 0 ? result.stdout : "",
    );
    return {
      id,
      label,
      status: parsed.supported ? "ok" : "warn",
      detail: parsed.supported
        ? parsed.version
        : `需要 PowerShell 5.1 或 7 以上（目前 ${parsed.version ?? "無法辨識"}）`,
    };
  } catch {
    return {
      id,
      label,
      status: "warn",
      detail: "需要 PowerShell 5.1 或 7 以上（目前 無法辨識）",
    };
  }
}

async function checkPowerShellEncoding() {
  const id = "powershell-encoding";
  const label = "PowerShell 中文編碼";
  const expected = "中文編碼測試";
  const token = randomUUID();
  const sourcePath = join(tmpdir(), `jr-setup-${token}.ps1`);
  const outputPath = join(tmpdir(), `jr-setup-${token}.txt`);

  try {
    await writeFile(sourcePath, encodingProbeSource(expected, outputPath), "utf8");
    const result = await runProbe("powershell.exe", [
      "-NoProfile",
      // 這支探針是我們自己寫進暫存檔的。不帶 Bypass 的話，執行原則還是 Restricted
      // 的機器會直接被擋，而這一格只會顯示「無法確認」——學生完全不知道為什麼。
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      sourcePath,
    ]);

    if (result.type !== "close" || result.exitCode !== 0) {
      return { id, label, status: "warn", detail: "無法確認" };
    }

    const actual = await readFile(outputPath, "utf8");
    return {
      id,
      label,
      status: actual === expected ? "ok" : "warn",
      detail:
        actual === expected
          ? "讀得到中文"
          : "中文會變亂碼——之後裝的腳本會受影響",
    };
  } catch {
    return { id, label, status: "warn", detail: "無法確認" };
  } finally {
    await Promise.all([
      unlink(sourcePath).catch(() => {}),
      unlink(outputPath).catch(() => {}),
    ]);
  }
}

async function checkVersion(id, label, cmd, args) {
  try {
    const result = await runProbe(cmd, args, {
      emptyFailureMeansMissing: true,
    });

    if (result.type === "timeout") {
      return timedOut(id, label);
    }

    // ⚠️ 這三條路都判成 missing，所以畫面上一律講「尚未安裝」（Reed 指定）。
    //
    // 原本分成「未安裝」（ENOENT）與「檢查失敗」（跑得起來但非零）。那個分別對我們
    // 有意義、對學生沒有：兩種情況他要做的事一模一樣——按那顆安裝鍵。而「檢查失敗」
    // 讀起來像**嚮導壞了**，那一列旁邊還擺著一顆安裝鍵，兩個訊號互相矛盾。
    //
    // Python 在 Windows 上必然踩到後者：`python3` 指向 Store 的殼，它存在、跑得起來、
    // 跳出商店頁面、exit code 非零但不是 ENOENT（見 checkPython 上面那段）。
    //
    // 真正的「檢查整段壞掉」是另一條路（runEnvCheck 的 catch），那裡仍然講「檢查失敗」。
    if (result.type === "error") {
      return { id, label, status: "missing", detail: "尚未安裝" };
    }

    if (result.exitCode === 0) {
      return {
        id,
        label,
        status: "ok",
        // 只取第一行：gh --version 會多印一行 release 連結。
        detail: result.stdout.trim().split("\n")[0].trim(),
      };
    }

    return { id, label, status: "missing", detail: "尚未安裝" };
  } catch {
    return { id, label, status: "missing", detail: "尚未安裝" };
  }
}

// Python 在 Windows 上叫什麼，取決於誰裝的：
//
//   py -3        python.org 的安裝檔（winget 裝的就是它）附的啟動器，最可靠
//   python       同一個安裝檔會產生，但 PATH 上可能先撞到 Store 的殼
//   python3      **Windows 上根本不會有** ——那是 Unix 的慣例。python.org 的安裝檔
//                不產生 python3.exe，所以那個名字永遠指向 Store 的殼
//
// Store 的殼很難纏：它存在、跑得起來、跳出商店頁面，exit code 非零但也不是 ENOENT
// ——所以 checkVersion 會判成「檢查失敗」而不是「未安裝」。實測就是這樣：winget 明明
// 印了 Successfully installed、exit code 0，卡片還是紅的。
//
// 依序試，第一個 exit 0 的算數。macOS / Linux 只有 python3 一個候選。
async function checkPython() {
  const candidates =
    process.platform === "win32"
      ? [
          ["py", ["-3", "--version"]],
          ["python", ["--version"]],
        ]
      : [["python3", ["--version"]]];

  let last = null;

  for (const [cmd, args] of candidates) {
    last = await checkVersion("python", "Python 3", cmd, args);

    if (last.status === "ok") {
      return last;
    }
  }

  return last;
}

// 這一列查的不是「裝了沒」，是「在你自己的終端機打得動嗎」。兩者會不一致：
// 設定檔裡一個同名函式就能把裝好的執行檔整個蓋掉，而 PATH 上完全看不出異常。
async function checkShellWrapper() {
  const id = "shell-wrapper";
  const label = "終端機裡的 claude / codex 是活的";
  const dead = [];

  for (const profile of shellProfilePaths(homedir())) {
    if (!existsSync(profile)) {
      continue;
    }

    try {
      const content = await readFile(profile, "utf8");

      for (const block of findDeadWrappers(content, { exists: existsSync })) {
        dead.push({ ...block, profile });
      }
    } catch {
      // 讀不到就當作沒問題。這一列是額外的保險，不該因為權限之類的意外
      // 讓學生看到一個他修不了的紅燈。
    }
  }

  return { id, label, ...shellWrapperStatus(dead) };
}

// 這一列查的是「上一輪用套件管理器裝的還在不在，而且壞成哪一種」。判準在
// legacy-cli.js。查的是 PATH 上**所有**同名的執行檔，不是第一支——舊版與官方版
// 並存時，誰先誰後決定學生打指令會叫到誰，只看第一支等於只看到一半。
//
// ⚠️ id 仍然叫 legacy-npm-cli，雖然它現在也管 Homebrew。改 id 會同時動到隔離區的
// 分區來源、model.js 的卡片成員與好幾支守門測試，而那些都不會因此變得更正確——
// 這一列對學生顯示的是 label，id 只是內部的名字。
async function checkLegacyCli(tools) {
  const id = "legacy-npm-cli";
  const label = "沒有上一輪套件管理器裝的殘留";

  try {
    const env = await spawnEnv();
    const reports = tools.map((command) =>
      inspectCommand(
        command,
        findAllExecutables(command, env, { fileExists: existsSync }),
        {
          exists: existsSync,
          // 解得開就給真正的位置。Homebrew 裝的 Node 會把 npm 的全域 bin 放在
          // /opt/homebrew/bin——那條路徑裡看不出 npm 的痕跡，只有解開 symlink 才
          // 看得到 node_modules（Reed 的 mac VM 實測）。
          realpath: (candidate) => {
            try {
              return realpathSync(candidate);
            } catch {
              // 斷掉的連結、或沒有權限。當作解不開，交給後面那條路判。
              return null;
            }
          },
        },
      ),
    );

    // 「裝得回來」＝這個平台有官方安裝器。少了這個前提，在一台我們補不上的機器
    // 上會把學生唯一能用的 CLI 搬走、而且沒有東西補上。
    const reinstallable = tools.filter(
      (command) => resolveInstaller(command, process.platform) !== null,
    );

    return { id, label, ...legacyCliStatus(reports, { reinstallable }) };
  } catch {
    return { id, label, status: "ok", detail: "沒有上一輪套件管理器裝的殘留" };
  }
}

// 這一列查的是「舊落點有沒有東西會跟我們待會兒裝的打架」。判準寫在 skill-roots.js。
// 這次要裝的是 SKILL_NAMES 那三支加上 vault-sync——照 config-install 的 skillStep。
const OUR_CODEX_SKILLS = [...SKILL_NAMES, "vault-sync"];

function checkLegacySkills() {
  const id = "codex-legacy-skills";
  const label = "沒有打架的舊版 skill";
  const root = legacySkillRoot(homedir());

  if (!existsSync(root)) {
    return { id, label, ...legacySkillStatus([]) };
  }

  try {
    const names = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    return {
      id,
      label,
      ...legacySkillStatus(conflictingLegacySkills(names, OUR_CODEX_SKILLS)),
    };
  } catch {
    // 讀不到就當作沒問題：這一列是額外的保險，不該因為權限之類的意外
    // 讓學生看到一個他修不了的紅燈。
    return { id, label, ...legacySkillStatus([]) };
  }
}

// 隔離區那一列跟其他每一列都不同：它不是一次探測，是看完別人的結果才決定要不要
// 出現。所以它不在 CHECKS 清單裡，也沒有固定的位置——由 runEnvCheck 在最後補上。
function checkQuarantine(checks) {
  const id = "quarantine";
  const label = "先前搬走的東西還留著";

  try {
    const state = quarantineState(homedir(), {
      // ⚠️ 不存在回 null、空的回 []。兩者的意思完全不同，見 quarantine.js。
      list: (dir) =>
        existsSync(dir)
          ? readdirSync(dir, { withFileTypes: true }).map((entry) => entry.name)
          : null,
    });
    const row = quarantineRow(state, checks);

    return row === null ? null : { id, label, ...row };
  } catch {
    // 讀不到就當作沒有。這一列是收尾用的加分項，不該因為權限之類的意外
    // 在整段已經全綠之後又長出一個學生修不了的東西。
    return null;
  }
}

// brew 那批的收尾。跟隔離區那一列同一個性質——不是一次探測，是「前面那顆清理鍵
// 做到一半」才會出現，所以也不在 CHECKS 清單裡，由 runEnvCheck 在最後補上。
//
// 判準看的是隔離區 brew-cli 分區裡有誰，不是 brew 清單上有誰：只看 brew 的話，
// 學生自己裝來平常用的東西也會被我們點名（見 leftovers.js 開頭）。
async function checkBrewLeftover() {
  const id = "brew-leftover";
  const label = "Homebrew 那邊也收乾淨了";

  try {
    const dir = `${quarantineHome(homedir())}/brew-cli`;

    if (!existsSync(dir)) {
      return null;
    }

    const entries = readdirSync(dir, { withFileTypes: true }).map(
      (entry) => entry.name,
    );
    const commands = leftoverCommands(entries);

    if (commands.length === 0) {
      return null;
    }

    // ⚠️ 要問 brew 的是**brew 上的名字**，不是指令名字。搬進來的那條連結還是連結，
    // 讀得到它指向哪就還原得出來（codex 的 cask 就叫 codex，但 claude 的 cask 叫
    // claude-code——拿指令名字去問，那支永遠會得到「沒裝」）。
    const brewNames = new Map();

    for (const entry of entries) {
      const command = commandFromEntry(entry);

      if (command === null) continue;

      let name = command;

      try {
        name = brewNameFromTarget(readlinkSync(`${dir}/${entry}`)) ?? command;
      } catch {
        // 不是連結、或讀不到：退回指令名字，多數情況兩者相同。
      }

      brewNames.set(command, name);
    }

    // brew 清單上還有沒有它。
    //
    // ⚠️ **cask 與 formula 要各問一次**。`brew list --versions <名字>` 只查 formula，
    // 而 claude-code 與 codex 在 Homebrew 上都是 cask——只問前者的話一律得到「沒裝」，
    // 那一列一進來就是綠的，而 Caskroom 裡的東西原封不動（Reed 在 mac VM 上一眼看出
    // 不對：他的 codex 明明還在 brew 的清單上）。
    const stillInstalled = [];

    for (const command of commands) {
      const name = brewNames.get(command) ?? command;
      const probes = await Promise.all([
        runProbe("brew", ["list", "--versions", name]),
        runProbe("brew", ["list", "--cask", "--versions", name]),
      ]);

      if (
        probes.some(
          (result) => result.type === "close" && result.exitCode === 0,
        )
      ) {
        stillInstalled.push(command);
      }
    }

    const row = brewLeftoverRow({ commands, stillInstalled });
    return row === null ? null : { id, label, ...row };
  } catch {
    // 問不到 brew（沒裝、或這台不是 mac）就當作沒事。這一列是收尾用的，不該因為
    // 意外在整段已經全綠之後又長出一個學生修不了的東西。
    return null;
  }
}

// npm 那批的收尾，跟上面那支同一個形狀。兩個平台都要——npm 全域安裝在 Windows 上
// 一樣會留下套件本體（見 leftovers.js 的 npmLeftoverRow）。
//
// ⚠️ 「還在不在」問的是**套件本體在不在 npm 的全域目錄底下**，不是 `npm ls -g` 的
// 輸出。理由跟 legacy-cli.js 那則一樣：孤兒的情況 npm 自己也認不得（它以為沒裝），
// 而我們要判的是「重裝時會不會把捷徑建回來」——那看的是本體。
async function checkNpmLeftover() {
  const id = "npm-leftover";
  const label = "npm 那邊也收乾淨了";

  try {
    const dir = `${quarantineHome(homedir())}/npm-cli`;

    if (!existsSync(dir)) {
      return null;
    }

    const commands = leftoverCommands(
      readdirSync(dir, { withFileTypes: true }).map((entry) => entry.name),
    );

    if (commands.length === 0) {
      return null;
    }

    const root = await runProbe("npm", ["root", "-g"]);

    if (root.type !== "close" || root.exitCode !== 0) {
      // 問不到 npm 的全域目錄就不要猜。這一列寧可不出現，也不要在整段全綠之後
      // 長出一個學生修不了的黃燈。
      return null;
    }

    const base = root.stdout.trim().split("\n").at(-1)?.trim();

    if (!base) {
      return null;
    }

    const stillInstalled = commands.filter((command) => {
      const packageName = NPM_PACKAGES[command];

      return (
        packageName !== undefined &&
        existsSync(join(base, ...packageName.split("/")))
      );
    });

    const row = npmLeftoverRow({ commands, stillInstalled });
    return row === null ? null : { id, label, ...row };
  } catch {
    return null;
  }
}

// PATH 上第一支跑得動的 pwsh 落在哪。查路徑而不是跑指令：Store 版與一般版都答得出
// 版本號，分不出來——差別只在它裝在 WindowsApps 底下。
async function pwshSource() {
  const env = await spawnEnv();
  const candidates = findAllExecutables("pwsh", env, {
    platform: "win32",
    fileExists: existsSync,
  });

  return pickRunnable(candidates, { platform: "win32" });
}

async function checkPwshStore() {
  const id = "pwsh-store";
  const label = "PowerShell 7 的安裝方式";

  try {
    return { id, label, ...storePowerShellStatus(await pwshSource()) };
  } catch {
    // 查不到就當作沒問題：這一列是加分項，不該因為意外把學生擋在第一頁。
    return { id, label, status: "ok", detail: "沒有裝 PowerShell 7（不影響課程）" };
  }
}

// 沙箱那一列查的是「沙箱設定好了沒」——記錄在 ~/.codex/cap_sid，不是 .sandbox。
//
// ⚠️ 2026-08-12 換掉的判準。原本問「helper 找不找得到」，而 helper 只在第一次建
// 沙箱那一刻用得到，所以已經設定好的機器會被誤報黃燈、而「helper 在但從沒設定過」
// 的機器反而被判綠燈——後者才是真的會出事的人。完整理由見 codex-sandbox.js。
async function readCodexConfig() {
  try {
    return await readFile(join(homedir(), ".codex", "config.toml"), "utf8");
  } catch {
    // 檔案不在＝從來沒設定過，那正是我們要判的其中一種狀態。
    return null;
  }
}

// ⚠️ 這裡曾經查過 CodexSandboxOffline / Online 兩個本機帳號（`net user`），
// 已經拿掉：學生選完 1、codex 印了 Sandbox ready 之後，那兩個帳號**還沒生出來**
// （真機實測），於是那一列永遠等不到，按鈕變成一顆按不完的迴圈。
// 判準改看 config.toml 的 [windows] sandbox，理由見 codex-sandbox.js。
async function codexForSandbox() {
  const env = await spawnEnv();

  return pickRunnable(
    findAllExecutables("codex", env, {
      platform: "win32",
      fileExists: existsSync,
    }),
    { platform: "win32" },
  );
}

async function checkCodexSandbox() {
  const id = "codex-sandbox";
  const label = "Codex 沙箱要用的檔案";

  try {
    const codexPath = await codexForSandbox();

    return {
      id,
      label,
      ...sandboxFilesStatus({
        codexPath,
        helperPath:
          codexPath === null
            ? null
            : findSandboxHelper(codexPath, { exists: existsSync }),
        storePowerShell: isStorePowerShell(await pwshSource()),
      }),
    };
  } catch {
    return { id, label, status: "warn", detail: "檢查逾時，請再按一次重新檢查" };
  }
}

async function checkCodexSandboxReady() {
  const id = "codex-sandbox-ready";
  const label = "Codex 沙箱設定好了";

  try {
    return {
      id,
      label,
      ...sandboxSetupStatus({
        codexPath: await codexForSandbox(),
        answered: sandboxAnswered(await readCodexConfig()),
      }),
    };
  } catch {
    return { id, label, status: "warn", detail: "檢查逾時，請再按一次重新檢查" };
  }
}

async function checkClaudeAuth(installed) {
  const id = "claude-auth";
  const label = "Claude Code 登入狀態";

  try {
    const cli = await installed;

    if (cli.status !== "ok") {
      // CLI 那項自己逾時的話，這裡跟著說「需要先安裝」是二次誤導。
      return cli.status === "warn"
        ? timedOut(id, label)
        : { id, label, status: "missing", detail: "需要先安裝" };
    }

    const result = await runProbe("claude", ["auth", "status"]);

    if (result.type === "timeout") {
      return timedOut(id, label);
    }

    // 走到這裡代表版本探測已經成功，CLI 一定在——探測失敗只能是判讀不出來，
    // 不可以回報「需要先安裝」讓同學去重裝一個已經裝好的東西。
    if (result.type === "error") {
      return { id, label, status: "warn", detail: "無法判讀登入狀態" };
    }

    const auth = parseClaudeAuth(result.stdout);
    return {
      id,
      label,
      status: auth.loggedIn ? "ok" : "warn",
      detail: auth.detail,
    };
  } catch {
    return { id, label, status: "warn", detail: "無法判讀登入狀態" };
  }
}

async function checkCodexAuth(installed) {
  const id = "codex-auth";
  const label = "Codex 登入狀態";

  try {
    const cli = await installed;

    if (cli.status !== "ok") {
      // CLI 那項自己逾時的話，這裡跟著說「需要先安裝」是二次誤導。
      return cli.status === "warn"
        ? timedOut(id, label)
        : { id, label, status: "missing", detail: "需要先安裝" };
    }

    const result = await runProbe("codex", ["login", "status"]);

    if (result.type === "timeout") {
      return timedOut(id, label);
    }

    if (result.type === "error") {
      return { id, label, status: "warn", detail: "無法判讀登入狀態" };
    }

    const auth = parseCodexAuth(result.output);
    const loggedIn = result.exitCode === 0 && auth.loggedIn;
    return {
      id,
      label,
      status: loggedIn ? "ok" : "warn",
      detail: loggedIn ? auth.detail : "未登入",
    };
  } catch {
    return { id, label, status: "warn", detail: "無法判讀登入狀態" };
  }
}

async function checkGhAuth(installed) {
  const id = "gh-auth";
  const label = "GitHub 登入狀態";

  try {
    const cli = await installed;

    if (cli.status !== "ok") {
      // CLI 那項自己逾時的話，這裡跟著說「需要先安裝」是二次誤導。
      return cli.status === "warn"
        ? timedOut(id, label)
        : { id, label, status: "missing", detail: "需要先安裝" };
    }

    const result = await runProbe("gh", ["auth", "status"]);

    if (result.type === "timeout") {
      return timedOut(id, label);
    }

    if (result.type === "error") {
      return { id, label, status: "warn", detail: "無法判讀登入狀態" };
    }

    const loggedIn = result.exitCode === 0;
    return {
      id,
      label,
      status: loggedIn ? "ok" : "warn",
      detail: loggedIn ? "已登入" : "未登入",
    };
  } catch {
    return { id, label, status: "warn", detail: "無法判讀登入狀態" };
  }
}

export async function runEnvCheck(tools = []) {
  // 沒被選到的工具連查都不查，不只是畫面上藏起來——每一項都是一次 spawn。
  const wanted = new Set(checksForTools(CHECKS, tools).map((check) => check.id));

  try {
    const git = checkVersion("git", "Git", "git", ["--version"]);
    const gh = checkVersion("gh", "GitHub CLI", "gh", ["--version"]);
    const node = checkVersion("node", "Node.js", "node", ["--version"]);
    const python = checkPython();
    const checksToRun = [];

    if (wanted.has("claude")) {
      const claude = checkVersion("claude", "Claude Code CLI", "claude", [
        "--version",
      ]);
      checksToRun.push(claude, checkClaudeAuth(claude));
    }

    if (wanted.has("codex")) {
      const codex = checkVersion("codex", "Codex CLI", "codex", ["--version"]);
      checksToRun.push(codex, checkCodexAuth(codex));

      if (wanted.has("codex-sandbox")) {
        checksToRun.push(checkCodexSandbox());
      }

      if (wanted.has("codex-sandbox-ready")) {
        checksToRun.push(checkCodexSandboxReady());
      }

      checksToRun.push(checkLegacySkills());
    }

    checksToRun.push(
      git,
      gh,
      checkGhAuth(gh),
      node,
      python,
      checkShellWrapper(),
      // 只查學生這次選的那幾支：沒選 Claude 的人不該被要求處理 claude 的殘留。
      checkLegacyCli(
        ["claude", "codex"].filter((command) => wanted.has(command)),
      ),
    );

    if (process.platform === "win32") {
      checksToRun.unshift(checkExecutionPolicy());
      checksToRun.push(
        checkWindowsTerminal(),
        checkPowerShellVersion(),
        checkPowerShellEncoding(),
        checkPwshStore(),
      );
    }

    if (process.platform === "darwin") {
      checksToRun.push(checkGhostty());
    }

    checksToRun.push(checkTypeless());

    const checks = await Promise.all(checksToRun);
    // 補在最後：它要先看得到別人的結論才決定自己出不出現。
    const quarantine = checkQuarantine(checks);
    // 兩個收尾都排在隔離區清理**之前**：那顆按鈕會刪掉隔離區裡的東西，而收尾這兩步
    // 萬一失敗，那份備份就是唯一還原得回去的東西。
    const [npmLeftover, brewLeftover] = await Promise.all([
      checkNpmLeftover(),
      checkBrewLeftover(),
    ]);
    const tail = [npmLeftover, brewLeftover, quarantine].filter(
      (row) => row !== null,
    );

    return {
      os: { platform: process.platform, arch: process.arch, home: homedir() },
      checks: [...checks, ...tail].map(withActions),
    };
  } catch (error) {
    // ⚠️ 這個 catch 會把整段吞掉、每一列都變成「檢查失敗」，而 id 跟正常路徑一模一樣
    // ——測試因此看不出差別（加 codex-legacy-skills 那次就是這樣，全綠但真的跑起來
    // 整頁是紅的）。至少要留下原因，不然下一次又是從零開始猜。
    console.error("[runEnvCheck] 整段失敗：", error);

    return {
      os: { platform: process.platform, arch: process.arch, home: homedir() },
      checks: checksForTools(CHECKS, tools).map(({ id, label }) => ({
        id,
        label,
        status: "missing",
        detail: "檢查失敗",
      })).map(withActions),
    };
  }
}
