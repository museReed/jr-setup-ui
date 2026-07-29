// 驗證最後一哩：Claude Code 真的有觸發 session-auto-namer 嗎？
//
//   node scripts/verify-hooks-live.mjs
//
// 命名結果由 hook 寫進暫存 sync 檔；prompt 一律走 stdin，避免 Windows 的
// cmd.exe 把內容重新解讀。
import { spawn } from "node:child_process";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { spawnEnv } from "../src/env-path.js";
import { resolveLaunch } from "../src/spawn-command.js";

const TIMEOUT_MS = 180_000;
const WAITING_NAME = "(等待命名)";
const PROMPT =
  "請檢查目前目錄的 package.json，簡短說明這個專案的用途與主要測試指令。";

function runClaude(prompt, env) {
  const { cmd, args } = resolveLaunch(
    "claude",
    ["-p", "--allowedTools", "Bash"],
    { env },
  );

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    let child;

    try {
      child = spawn(cmd, args, {
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        env,
      });
    } catch (error) {
      finish({ ok: false, text: error.message });
      return;
    }

    child.stdin.end(prompt);
    child.stdout.resume();

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ ok: false, text: "等太久沒回應（超過 3 分鐘）" });
    }, TIMEOUT_MS);

    child.once("error", (error) => {
      clearTimeout(timer);
      finish({ ok: false, text: error.message });
    });
    child.once("close", (exitCode) => {
      clearTimeout(timer);

      if (exitCode !== 0) {
        finish({
          ok: false,
          text: stderr.trim() || `claude 結束於 exit ${exitCode}`,
        });
        return;
      }

      finish({ ok: true });
    });
  });
}

const syncFile = path.join(
  tmpdir(),
  `jr-hooks-live-${process.pid}-${Date.now()}.txt`,
);

try {
  await writeFile(syncFile, WAITING_NAME);
  const baseEnv = await spawnEnv();
  const result = await runClaude(PROMPT, {
    ...baseEnv,
    AI_TAB_SYNC_FILE: syncFile,
  });

  if (!result.ok) {
    console.log(`FAIL  叫不動 claude：${result.text}`);
    console.log("確認 Claude Code 已安裝、登入，且 hooks 已在新 session 生效。");
    process.exitCode = 1;
  } else {
    const actual = (await readFile(syncFile, "utf8")).trim();

    if (actual !== WAITING_NAME) {
      console.log(`PASS  Claude hook 寫入 session 名稱：${actual}`);
    } else {
      console.log("無法確認  sync 檔仍是等待命名。");
      console.log("可能沒有開新 session，或 session-auto-namer hook 尚未註冊。");
      // 只看 sync 檔的話，失敗時完全不知道卡在哪：hook 沒觸發？模型沒照做？
      // 指令跑了但失敗？把模型實際說的話印出來，才有東西可查。
      console.log("");
      console.log("── Claude 實際的回覆（最後 15 行，用來判斷卡在哪）──");

      for (const line of result.text.trim().split("\n").slice(-15)) {
        console.log(`  ${line}`);
      }
    }
  }
} finally {
  await unlink(syncFile).catch(() => {});
}
