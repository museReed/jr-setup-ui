import { spawn } from "node:child_process";

import { actions } from "./actions.js";
import {
  EXECUTION_POLICY_PROBE,
  parseExecutionPolicy,
} from "./execution-policy.js";
import { installActionId, resolveInstaller } from "./installers.js";
import { resolveSpawn } from "./spawn-command.js";

const TIMEOUT_MS = 5000;

const CHECKS = [
  { id: "claude", label: "Claude Code CLI" },
  { id: "claude-auth", label: "Claude Code 登入狀態" },
  { id: "codex", label: "Codex CLI" },
  { id: "codex-auth", label: "Codex 登入狀態" },
  { id: "git", label: "Git" },
  { id: "gh", label: "GitHub CLI" },
  { id: "gh-auth", label: "GitHub 登入狀態" },
  { id: "node", label: "Node.js" },
];

if (process.platform === "win32") {
  CHECKS.unshift({
    id: "execution-policy",
    label: "PowerShell 執行原則",
  });
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
export async function runProbe(cmd, args) {
  const first = await spawnProbe(cmd, args);

  if (
    process.platform === "win32" &&
    first.type === "error" &&
    first.error?.code === "ENOENT" &&
    !cmd.includes(".")
  ) {
    return normalizeNotFound(await spawnProbe(`${cmd}.cmd`, args));
  }

  return first;
}

// 退路是交給 cmd.exe 跑，而 cmd.exe 一定存在——它自己會啟動成功，
// 只是找不到目標指令並回 9009。不還原成 ENOENT 的話，「未安裝」會被
// 誤報成「檢查失敗」（實測 gh 未安裝時就是這樣）。
const CMD_NOT_FOUND_EXIT_CODE = 9009;

export function normalizeNotFound(result) {
  if (result.type === "close" && result.exitCode === CMD_NOT_FOUND_EXIT_CODE) {
    return { type: "error", error: { code: "ENOENT" } };
  }

  return result;
}

function spawnProbe(rawCmd, rawArgs) {
  const { cmd, args } = resolveSpawn(rawCmd, rawArgs);
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
  const installer =
    check.status === "missing"
      ? resolveInstaller(check.id, process.platform)
      : null;
  const fixActions = {
    "execution-policy":
      check.status === "ok" ? null : "fix-execution-policy",
    "claude-auth": check.status === "warn" ? "login-claude" : null,
    "codex-auth": check.status === "warn" ? "login-codex" : null,
    "gh-auth": check.status === "warn" ? "login-gh" : null,
  };
  const fixAction = fixActions[check.id] ?? null;

  return {
    ...check,
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
      return { id, label, status: "warn", detail: "檢查逾時" };
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

async function checkVersion(id, label, cmd, args) {
  try {
    const result = await runProbe(cmd, args);

    if (result.type === "timeout") {
      return { id, label, status: "missing", detail: "檢查逾時" };
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

async function checkClaudeAuth(installed) {
  const id = "claude-auth";
  const label = "Claude Code 登入狀態";

  try {
    if ((await installed).status !== "ok") {
      return { id, label, status: "missing", detail: "需要先安裝" };
    }

    const result = await runProbe("claude", ["auth", "status"]);

    if (result.type === "timeout") {
      return { id, label, status: "missing", detail: "檢查逾時" };
    }

    if (result.type === "error") {
      return { id, label, status: "missing", detail: "需要先安裝" };
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
    if ((await installed).status !== "ok") {
      return { id, label, status: "missing", detail: "需要先安裝" };
    }

    const result = await runProbe("codex", ["login", "status"]);

    if (result.type === "timeout") {
      return { id, label, status: "missing", detail: "檢查逾時" };
    }

    if (result.type === "error") {
      return { id, label, status: "missing", detail: "需要先安裝" };
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
    if ((await installed).status !== "ok") {
      return { id, label, status: "missing", detail: "需要先安裝" };
    }

    const result = await runProbe("gh", ["auth", "status"]);

    if (result.type === "timeout") {
      return { id, label, status: "missing", detail: "檢查逾時" };
    }

    if (result.type === "error") {
      return { id, label, status: "missing", detail: "需要先安裝" };
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

export async function runEnvCheck() {
  try {
    const claude = checkVersion(
      "claude",
      "Claude Code CLI",
      "claude",
      ["--version"],
    );
    const codex = checkVersion("codex", "Codex CLI", "codex", ["--version"]);
    const git = checkVersion("git", "Git", "git", ["--version"]);
    const gh = checkVersion("gh", "GitHub CLI", "gh", ["--version"]);
    const node = checkVersion("node", "Node.js", "node", ["--version"]);
    const checksToRun = [
      claude,
      checkClaudeAuth(claude),
      codex,
      checkCodexAuth(codex),
      git,
      gh,
      checkGhAuth(gh),
      node,
    ];

    if (process.platform === "win32") {
      checksToRun.unshift(checkExecutionPolicy());
    }

    const checks = await Promise.all(checksToRun);

    return {
      os: { platform: process.platform, arch: process.arch },
      checks: checks.map(withActions),
    };
  } catch {
    return {
      os: { platform: process.platform, arch: process.arch },
      checks: CHECKS.map(({ id, label }) => ({
        id,
        label,
        status: "missing",
        detail: "檢查失敗",
      })).map(withActions),
    };
  }
}
