// 驗證最後一哩：Claude Code 真的有觸發 session-auto-namer 嗎？
//
//   node scripts/verify-hooks-live.mjs
//
// 判準是「名字有沒有落地」——有沒有寫進 ~/.claude/session-names/<key>.txt。
// 挑這個檔當判準是因為 set-session-name 無條件寫它，之後才分岔（有
// AI_TAB_SYNC_FILE 就寫 sync 檔給 watcher、否則自己去改終端標題）。只看 sync
// 檔的話，判準會綁在其中一條分支上。
//
// sync 檔另外單獨報告：那是「終端機標題同步」那一步裝的 wrapper 走的路，學生
// 互動時實際用的就是它，所以這裡把 AI_TAB_SYNC_FILE 設起來模擬 wrapper。
//
// 再往下的 watcher → 終端標題這支驗不到：node 用 pipe 生出來的 claude 沒有掛
// 在任何終端上。那一格留給人眼，見輸出最後的提示。
//
// prompt 一律走 stdin，避免 Windows 的 cmd.exe 把內容重新解讀。
import { spawn } from "node:child_process";
import { readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import { spawnEnv } from "../src/env-path.js";
import { resolveLaunch } from "../src/spawn-command.js";

const TIMEOUT_MS = 180_000;
const PROMPT =
  "請檢查目前目錄的 package.json，簡短說明這個專案的用途與主要測試指令。";
const namesDir = path.join(homedir(), ".claude", "session-names");

// 回傳 檔名 → 修改時間。目錄不存在時給空的：那本身就是「沒命名過」的證據。
async function snapshotNames() {
  const entries = await readdir(namesDir).catch(() => []);
  const pairs = await Promise.all(
    entries.map(async (name) => {
      const info = await stat(path.join(namesDir, name)).catch(() => null);
      return info ? [name, info.mtimeMs] : null;
    }),
  );
  return new Map(pairs.filter(Boolean));
}

// 新增的、或被改寫的檔案都算——重跑驗證時 session key 可能撞到舊的。
async function findWrittenName(before) {
  const after = await snapshotNames();
  for (const [name, mtime] of after) {
    if (!before.has(name) || before.get(name) !== mtime) {
      const value = await readFile(path.join(namesDir, name), "utf8").catch(
        () => "",
      );
      if (value.trim()) return { file: name, value: value.trim() };
    }
  }
  return null;
}

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

    // 留著 stdout：命名沒發生時，模型說了什麼是唯一能判斷卡在哪的線索
    // （原本直接 resume() 丟掉，失敗時只剩「無法確認」四個字可看）。
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

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

      finish({ ok: true, text: stdout, stderr });
    });
  });
}

// wrapper 起 claude 時會先把這個檔填成「(等待命名)」再交給 watcher 盯，
// 這裡照做，讓 set-session-name 走到跟學生互動時同一條分支。
const syncFile = path.join(
  tmpdir(),
  `jr-hooks-live-${process.pid}-${Date.now()}.txt`,
);
const WAITING_NAME = "(等待命名)";

try {
  await writeFile(syncFile, WAITING_NAME);
  const before = await snapshotNames();
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
    const written = await findWrittenName(before);
    const synced = (await readFile(syncFile, "utf8").catch(() => "")).trim();

    if (written) {
      console.log(`PASS  Claude hook 寫入 session 名稱：${written.value}`);
      console.log(`      落點：${path.join(namesDir, written.file)}`);
      // 兩者不一致時多半是 wrapper 分支壞了，而不是命名壞了——分開報才看得出來。
      console.log(
        synced && synced !== WAITING_NAME
          ? `      sync 檔（wrapper 那條分支）也寫了：${synced}`
          : "      但 sync 檔還是「(等待命名)」——wrapper 分支沒寫成功，終端標題不會跟著變。",
      );
      console.log("");
      console.log("── 還有一格要你自己看 ──");
      console.log("  watcher 把名字放上終端標題這段驗不到（headless 沒有終端）。");
      console.log("  在你自己的終端機開一個新的 claude session、隨便問一句，");
      console.log("  然後看分頁標題有沒有變成「{emoji} 中文敘述」。");
    } else {
      console.log("無法確認  沒有任何 session 名稱檔被寫入。");
      console.log(`      應該要出現在：${namesDir}`);
      // 只看檔案的話，失敗時完全不知道卡在哪：hook 沒觸發？模型沒照做？
      // 指令跑了但失敗？把模型實際說的話印出來，才有東西可查。
      console.log("");
      console.log("── Claude 實際的回覆（最後 15 行，用來判斷卡在哪）──");
      const transcript = `${result.text ?? ""}\n${result.stderr ?? ""}`.trim();

      if (transcript.length === 0) {
        console.log("  （沒有任何輸出）");
      } else {
        for (const line of transcript.split("\n").slice(-15)) {
          console.log(`  ${line}`);
        }
      }
    }
  }
} finally {
  await unlink(syncFile).catch(() => {});
}
