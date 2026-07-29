// 驗證最後一哩：Claude Code 真的會載入並執行那支 hook 嗎？
//
//   node scripts/verify-hook-live.mjs
//
// 前面兩層驗的是「settings.json 有註冊」與「hook 腳本自己會擋」，那都是推論到
// 生效為止。這一支叫真的 claude 去跑一個串接指令，從事件流裡找 hook 的攔截訊息。
//
// ⚠️ 難點：AI 可能因為 CLAUDE.md 的規則「自己」就拆成兩次跑，那樣看起來也像
// 有效果，但 hook 其實沒動。所以判定條件是「事件流裡出現 hook 的訊息」，
// 不是「AI 有沒有拆開」——找不到訊息就報「無法確認」，不報成功。
import { spawn } from "node:child_process";

import { HOOK_MARKER } from "../src/config-install.js";
import { spawnEnv } from "../src/env-path.js";
import { resolveLaunch } from "../src/spawn-command.js";

const TIMEOUT_MS = 180_000;
const HOOK_MESSAGE = "一次只跑一個指令";
// ⚠️ prompt 裡刻意不寫出那個串接指令的字面樣子。
// 事件流會包含 prompt 本身，寫進去的話「AI 有沒有真的送出串接指令」就永遠成立，
// 判定會變成永遠誤判（第一版就是這樣，看起來像 hook 沒生效其實是偵測錯）。
const PROMPT =
  "請只用一次 Bash 呼叫，在同一行裡用 shell 的 AND 串接符號" +
  "把 echo hi 跟 echo bye 兩個指令接起來執行。";

function runClaude(prompt, env) {
  const { cmd, args } = resolveLaunch(
    "claude",
    [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      // 只給 Bash：這一題就是要它去跑指令。
      "--allowedTools",
      "Bash",
    ],
    { env },
  );

  return new Promise((resolve) => {
    let child;

    try {
      child = spawn(cmd, args, {
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        env,
      });
    } catch (error) {
      resolve({ ok: false, text: error.message });
      return;
    }

    // prompt 走 stdin，指令參數裡不放任何內容（Windows 上會被 cmd.exe 吃掉）。
    child.stdin.end(prompt);

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ ok: false, text: "等太久沒回應（超過 3 分鐘）" });
    }, TIMEOUT_MS);

    child.once("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, text: error.message });
    });
    child.once("close", (exitCode) => {
      clearTimeout(timer);

      if (stdout.trim().length === 0) {
        resolve({
          ok: false,
          text: stderr.trim() || `claude 結束於 exit ${exitCode} 且沒有輸出`,
        });
        return;
      }

      resolve({ ok: true, text: stdout });
    });
  });
}

// 事件流是一行一個 JSON，但攔截訊息藏在巢狀的工具結果裡——直接對整段找字串，
// 比逐層猜結構穩。
export function inspectTranscript(transcript) {
  return {
    hookFired: transcript.includes(HOOK_MESSAGE) || transcript.includes(HOOK_MARKER),
    ranChained: /echo hi\s*&&\s*echo bye/.test(transcript),
  };
}

// 「有攔到」是強證據，「沒攔到」是弱證據——AI 可能照 CLAUDE.md 的規則自己就
// 拆成兩次跑，那一輪根本碰不到 hook（實測三次裡有兩次是這樣）。所以重試，
// 任何一輪攔到就算通過。
const MAX_ATTEMPTS = 3;

const env = await spawnEnv();

console.log("正在叫 Claude 跑一個串接指令，看 hook 會不會攔下來…");
console.log(`（問題：${PROMPT}）`);

let lastRanChained = false;

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
  if (attempt > 1) {
    console.log(`第 ${attempt} 次嘗試（上一輪 Claude 自己拆開了，沒碰到 hook）…`);
  }

  const result = await runClaude(PROMPT, env);

  if (!result.ok) {
    console.log(`FAIL  叫不動 claude：${result.text}`);
    console.log("確認上面環境檢查裡 Claude Code 是綠的、而且已經登入。");
    process.exit(1);
  }

  const { hookFired, ranChained } = inspectTranscript(result.text);
  lastRanChained = ranChained;

  if (hookFired) {
    console.log("");
    console.log("PASS  hook 有動作：Claude 嘗試跑串接指令時被攔下來了。");
    console.log("      這代表 Claude Code 真的載入並執行了那支 hook。");
    process.exit(0);
  }
}

console.log("");
console.log(`無法確認  試了 ${MAX_ATTEMPTS} 次都沒看到 hook 的攔截訊息。`);

if (!lastRanChained) {
  console.log("          Claude 每次都自己先拆成兩次跑，碰不到 hook——");
  console.log("          這不代表 hook 壞了，但這條路徑沒被驗到。");
} else {
  console.log("          Claude 送出了串接指令但沒被攔——hook 很可能沒生效。");
  console.log("          檢查：settings.json 的註冊路徑對不對、有沒有開新 session。");
}

process.exit(1);
