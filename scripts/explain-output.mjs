import { spawn } from "node:child_process";

import { resolveLaunch } from "../src/spawn-command.js";

const FALLBACK = "（無法翻譯，請看下方原始輸出）";
const TIMEOUT_MS = 20_000;
const PROMPT =
  "你正在協助第一次使用命令列的學生。請讀取 stdin 裡的第三方指令輸出，" +
  "只輸出一行繁體中文：先說這段輸出在說什麼，再說學生現在該做什麼。" +
  "不要使用 Markdown、不要重貼原始輸出。";

let input = "";

for await (const chunk of process.stdin) {
  input += chunk;
}

if (input.trim().length === 0) {
  console.log(FALLBACK);
  process.exit(0);
}

const launch = resolveLaunch(
  "claude",
  ["-p", "--output-format", "text", "--", PROMPT],
  { env: process.env },
);

const explanation = await new Promise((resolve) => {
  let settled = false;
  let stdout = "";
  let child;
  let timer = null;
  const finish = (value) => {
    if (settled) {
      return;
    }

    settled = true;
    if (timer !== null) {
      clearTimeout(timer);
    }
    resolve(value);
  };

  try {
    child = spawn(launch.cmd, launch.args, {
      shell: false,
      stdio: ["pipe", "pipe", "ignore"],
      env: process.env,
      ...(launch.spawnOptions ?? {}),
    });
  } catch {
    finish(FALLBACK);
    return;
  }

  timer = setTimeout(() => {
    child.kill("SIGTERM");
    finish(FALLBACK);
  }, TIMEOUT_MS);

  timer.unref();
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.once("error", () => finish(FALLBACK));
  child.once("close", (code) => {
    const oneLine = stdout.replace(/\s+/g, " ").trim();
    finish(code === 0 && oneLine.length > 0 ? oneLine : FALLBACK);
  });
  child.stdin.on("error", () => {});
  child.stdin.end(input);
});

console.log(explanation);
process.exit(0);
