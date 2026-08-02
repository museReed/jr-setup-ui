// 驗證規則檔「真的生效了嗎」，不是「指令有沒有跑完」。
//
//   node scripts/verify-configs.mjs --tools=claude,codex --lang=zh-TW
//
// 最關鍵的兩項會直接觸發腳本：擋下串接指令，並把名稱寫進同步檔。
// 這是真的行為驗證，不需要開 Claude session。
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import { probeRegisteredHook, runConfigCheck } from "../src/config-check.js";
import { findHookRegistration, hookFileName } from "../src/config-install.js";

const HOME = homedir();
const HOOK_PATH = path.join(HOME, ".claude", "hooks", "block-chained-bash.js");
const SET_NAME_PATH = path.join(
  HOME,
  ".claude",
  "hooks",
  hookFileName("set-session-name"),
);
const VERIFY_NAME = "🔧 驗證測試";

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

// 驗的是 settings.json 裡真正註冊的那條指令，不是我們自己拼一次路徑去跑腳本。
async function registeredHookCommand() {
  const settings = await readFile(
    path.join(HOME, ".claude", "settings.json"),
    "utf8",
  )
    .then(JSON.parse)
    .catch(() => null);
  return findHookRegistration(settings)?.command ?? null;
}

function runSetSessionName(syncFile) {
  const command = process.platform === "win32" ? "powershell.exe" : "bash";
  const args =
    process.platform === "win32"
      ? [
          "-NoProfile",
          // 自己寫出來的腳本不看機器的執行原則臉色：Windows 預設 Restricted 會直接
          // 擋掉，而這裡只會拿到一個沒說原因的失敗。Bypass 只影響這一個行程。
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          SET_NAME_PATH,
          VERIFY_NAME,
          String(process.pid),
        ]
      : [SET_NAME_PATH, VERIFY_NAME, String(process.pid)];

  return new Promise((resolve) => {
    let child;

    try {
      child = spawn(command, args, {
        shell: false,
        stdio: ["ignore", "ignore", "pipe"],
        env: { ...process.env, AI_TAB_SYNC_FILE: syncFile },
      });
    } catch (error) {
      resolve({ exitCode: null, stderr: error.message });
      return;
    }

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) =>
      resolve({ exitCode: null, stderr: error.message }),
    );
    child.once("close", (exitCode) => resolve({ exitCode, stderr }));
  });
}

let failures = 0;

function report(passed, label, detail) {
  if (!passed) {
    failures += 1;
  }

  console.log(`${passed ? "PASS" : "FAIL"}  ${label}${detail ? `：${detail}` : ""}`);
}

const args = parseArgs(process.argv.slice(2));
const tools = (args.tools ?? "claude").split(",").filter((t) => t.length > 0);
const lang = args.lang ?? "zh-TW";

console.log("── 檔案與設定 ──");
const { checks } = await runConfigCheck({ tools, lang });

for (const check of checks) {
  report(check.status === "ok", check.label, check.detail);
}

if (tools.includes("claude")) {
  console.log("");
  console.log("── 實際觸發 hook ──");

  const hookCommand = await registeredHookCommand();

  if (!existsSync(HOOK_PATH)) {
    report(false, "hook 檔案存在", "找不到，跳過行為測試");
  } else if (!hookCommand) {
    report(false, "hook 已註冊", "settings.json 裡沒有這個 hook，跳過行為測試");
  } else {
    const runHook = (command) => probeRegisteredHook(hookCommand, command);
    const blocked = await runHook("echo a && echo b");
    report(
      blocked.exitCode === 2 && blocked.stderr.includes("一次只跑一個指令"),
      "串接指令會被擋",
      `exit ${blocked.exitCode}`,
    );

    const allowed = await runHook("echo hi");
    report(allowed.exitCode === 0, "單一指令會放行", `exit ${allowed.exitCode}`);

    const quoted = await runHook('echo "a && b"');
    report(quoted.exitCode === 0, "引號內的 && 不會誤擋", `exit ${quoted.exitCode}`);
  }

  console.log("");
  console.log("── 實際觸發命名 ──");

  if (!existsSync(SET_NAME_PATH)) {
    report(false, "命名腳本存在", "找不到，跳過行為測試");
  } else {
    const syncFile = path.join(
      tmpdir(),
      `jr-hooks-name-${process.pid}-${Date.now()}.txt`,
    );

    try {
      await writeFile(syncFile, "");
      const result = await runSetSessionName(syncFile);
      const actual = (await readFile(syncFile, "utf8")).trim();
      report(
        result.exitCode === 0 && actual === VERIFY_NAME,
        "命名寫得進 sync 檔",
        result.exitCode === 0 ? actual : `exit ${result.exitCode}`,
      );
    } finally {
      await unlink(syncFile).catch(() => {});
    }
  }
}

console.log("");
console.log("── 要你自己看的（機器判斷不了）──");
console.log("開一個新的 Claude Code session，貼這題：");
console.log("  我想開始經營個人品牌，Instagram 和 YouTube 我該先從哪個開始？");
console.log("對照：① 第一行就是粗體結論 ② 比較用表格 ③ 沒有 emoji 或慶祝語氣");
console.log("     ④ 長度中等 ⑤ 結尾有「你可能會想問」");
console.log("");
console.log("⚠️ 設定只對新開的 session 生效，舊對話不會套用。");

console.log("");

if (failures > 0) {
  console.log(`${failures} 項沒過——紅色那幾列按「安裝」重跑一次。`);
  process.exit(1);
}

console.log("機器可判定的項目全部通過。");
