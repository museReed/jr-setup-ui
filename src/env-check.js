import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
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
  findDeadWrappers,
  shellProfilePaths,
} from "./shell-wrapper.js";
import { resolveSpawn } from "./spawn-command.js";

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
  codex: ["codex", "codex-auth"],
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
    { id: "git", label: "Git" },
    { id: "gh", label: "GitHub CLI" },
    { id: "gh-auth", label: "GitHub 登入狀態" },
    { id: "node", label: "Node.js" },
    { id: "python", label: "Python 3" },
    { id: "shell-wrapper", label: "終端機裡的 claude / codex 是活的" },
  ];

  if (platform === "win32") {
    checks.unshift({ id: "execution-policy", label: "PowerShell 執行原則" });
    checks.push(
      { id: "windows-terminal", label: "終端機是 Windows Terminal" },
      { id: "powershell-version", label: "PowerShell 版本" },
      { id: "powershell-encoding", label: "PowerShell 中文編碼" },
    );
  }

  if (platform === "darwin") {
    checks.push({ id: "ghostty", label: "Ghostty 終端機" });
  }

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

function withActions(check) {
  // installable 為 false 的紅燈是「東西在、但用錯方式」——給安裝按鈕只會誤導。
  const installer =
    check.status === "missing" && check.installable !== false
      ? resolveInstaller(check.id, process.platform)
      : null;
  const fixActions = {
    "execution-policy":
      check.status === "ok" ? null : "fix-execution-policy",
    "shell-wrapper": check.status === "warn" ? "fix-shell-wrapper" : null,
    "claude-auth": check.status === "warn" ? "login-claude" : null,
    "codex-auth": check.status === "warn" ? "login-codex" : null,
    "gh-auth": check.status === "warn" ? "login-gh" : null,
  };
  const fixAction = fixActions[check.id] ?? null;
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

function checkGhostty() {
  const id = "ghostty";
  const label = "Ghostty 終端機";
  const status = ghosttyStatus(
    [
      "/Applications/Ghostty.app",
      join(homedir(), "Applications", "Ghostty.app"),
    ],
    existsSync,
  );
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

    if (result.type === "error") {
      return {
        id,
        label,
        status: "missing",
        detail: result.error?.code === "ENOENT" ? "未安裝" : "檢查失敗",
      };
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

    return { id, label, status: "missing", detail: "檢查失敗" };
  } catch {
    return { id, label, status: "missing", detail: "檢查失敗" };
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

  if (dead.length === 0) {
    return { id, label, status: "ok", detail: "沒有舊設定擋在前面" };
  }

  const names = [...new Set(dead.map((block) => block.command))].join("、");

  return {
    id,
    label,
    status: "warn",
    installable: false,
    detail:
      `你的設定檔裡有一個 ${names}，指到一個已經不在的檔案（${dead[0].deadPath}）。` +
      `不清掉的話，之後每一張叫你在終端機打 ${names} 的卡都會說「找不到指令」，` +
      `但你去查又會發現它明明裝好了——按右邊那顆清掉就好。`,
  };
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
    }

    checksToRun.push(
      git,
      gh,
      checkGhAuth(gh),
      node,
      python,
      checkShellWrapper(),
    );

    if (process.platform === "win32") {
      checksToRun.unshift(checkExecutionPolicy());
      checksToRun.push(
        checkWindowsTerminal(),
        checkPowerShellVersion(),
        checkPowerShellEncoding(),
      );
    }

    if (process.platform === "darwin") {
      checksToRun.push(checkGhostty());
    }

    const checks = await Promise.all(checksToRun);

    return {
      os: { platform: process.platform, arch: process.arch },
      checks: checks.map(withActions),
    };
  } catch {
    return {
      os: { platform: process.platform, arch: process.arch },
      checks: checksForTools(CHECKS, tools).map(({ id, label }) => ({
        id,
        label,
        status: "missing",
        detail: "檢查失敗",
      })).map(withActions),
    };
  }
}
