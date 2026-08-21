// 把「這一頁卡住了」的內容交給 gh 開成 issue。
//
// ⚠️ 走 `gh issue create --body-file` 而不是預填網址（B1 的結論）：網址有長度上限，
// 而中文 percent-encoding 一個字變九個字元——學生最需要回報的時候（winget 噴了
// 一大坨）正是 log 最長的時候，塞得進網址的那份反而缺了關鍵段落。檔案沒有這個問題。
//
// 用學生自己的 gh 登入：不必在學生端放任何金鑰，而且 issue 掛在他名下，助教可以
// 直接在下面問他。代價是 gh 要先裝好登入好——所以那張卡被排到很前面
//（見 public/model.js 的 ENV_FIRST）。
import { spawn } from "node:child_process";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { spawnEnv } from "./env-path.js";
import { resolveLaunch } from "./spawn-command.js";

export const FEEDBACK_REPO = "museReed/jr-setup-feedback";

// gh 卡住的話學生會一直等。開 issue 是一次網路來回，20 秒綽綽有餘。
const TIMEOUT_MS = 20_000;

// gh 成功時把 issue 網址印在 stdout 的最後一行。
export function issueUrlFrom(stdout) {
  const last = String(stdout ?? "")
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("https://"))
    .pop();

  return last ?? "";
}

// gh 的錯誤訊息原樣帶回去，但前面加一句人話——「HTTP 401」對學生沒有意義，
// 「還沒登入」才有。
// ⚠️ 這幾句話都要指向**現在就按得動的那顆鍵**，不能只說「你少了什麼」。
//
// 學生最需要回報的時候，正是他還沒把 gh 裝好登入好的時候——而舊版的訊息是叫他回
// 去做那張他正卡住的卡。那等於把求助的人推回問題本身。
//
// 框裡那顆「複製內容並開 GitHub」不需要 gh，也不需要 CLI 登入：內容進剪貼簿，
// 他在本來就登入著的瀏覽器裡貼上就送得出去。
export function explainFailure(stderr) {
  const text = String(stderr ?? "").trim();

  if (/auth|login|credential|401|403/i.test(text)) {
    return "gh 還沒登入，這條路送不出去。請改按下面的「複製內容並開 GitHub」——在瀏覽器裡貼上就送得出去，不用先裝好 gh。";
  }

  if (/not found|404/i.test(text)) {
    return "找不到回報用的 repo。這是嚮導的問題，不是你的——請直接把畫面截圖給助教。";
  }

  return "送不出去，請改按「複製內容並開 GitHub」。下面是 gh 的原始訊息：";
}

export async function createFeedbackIssue({ title, body, repo = FEEDBACK_REPO }) {
  const file = path.join(tmpdir(), `jr-report-${Date.now()}.md`);
  await writeFile(file, body, "utf8");

  const env = await spawnEnv();
  const { cmd, args, spawnOptions } = resolveLaunch(
    "gh",
    ["issue", "create", "--repo", repo, "--title", title, "--body-file", file],
    { env },
  );

  try {
    const result = await run(cmd, args, { env, ...(spawnOptions ?? {}) });

    if (result.type === "error") {
      return {
        ok: false,
        message:
          "這台機器還沒有 gh。請改按「複製內容並開 GitHub」——在瀏覽器裡貼上就送得出去。",
        detail: result.message,
      };
    }

    if (result.type === "timeout") {
      return { ok: false, message: "gh 沒有回應，請再按一次。", detail: "" };
    }

    if (result.exitCode !== 0) {
      return {
        ok: false,
        message: explainFailure(result.stderr),
        detail: result.stderr.trim(),
      };
    }

    return { ok: true, url: issueUrlFrom(result.stdout) };
  } finally {
    // 暫存檔留著沒有意義，而且裡面是學生機器的狀態。
    await unlink(file).catch(() => {});
  }
}

function run(cmd, args, options) {
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
      child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...options });
    } catch (error) {
      resolve({ type: "error", message: error.message });
      return;
    }

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ type: "timeout" });
    }, TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) =>
      finish({ type: "error", message: error.message }),
    );
    child.once("close", (exitCode) =>
      finish({ type: "close", exitCode, stdout, stderr }),
    );
  });
}
