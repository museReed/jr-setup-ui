// 行為驗證：讓學生自己的 AI 判定「回覆有沒有照規則」。
//
//   node scripts/verify-behavior.mjs --tools=claude,codex
//
// 每個工具都跑兩段：先問一題標準問題拿回答，再把回答丟回同一個工具，
// 請它對照規則逐條判定。Claude 與 Codex 走完全一樣的流程，只有啟動指令不同。
//
// 為什麼不是人工看：規則有五條，學生不知道該看什麼；AI 判定會給每條的理由。
// 為什麼可以用 -p / exec：實測 claude -p 與互動 session 讀同一份 settings.json，
// output style 一樣會套用；codex 讀的則是 ~/.codex/config.toml。
import { spawn } from "node:child_process";

import { spawnEnv } from "../src/env-path.js";
import { resolveLaunch } from "../src/spawn-command.js";

const TIMEOUT_MS = 180_000;

// 五條裡至少三條就算通過：判定本身有浮動（「長度中等」尤其主觀），
// 一條誤判就整個變紅會讓學生以為自己裝壞了。
const PASS_THRESHOLD = 3;

const QUESTION =
  "我想開始經營個人品牌，Instagram 和 YouTube 我該先從哪個開始？";

const RULES = [
  ["結論先行", "第一行就是粗體結論，不是「好問題！」這種開場白"],
  ["比較用表格", "兩個平台的比較用 Markdown 表格，不是散文"],
  ["語氣中性", "沒有 emoji、沒有「太棒了！」這類慶祝語氣"],
  ["長度中等", "精簡到可以行動，不是長篇大論"],
  ["追問清單", "結尾有「你可能會想問」之類的追問清單"],
];

const ENGINES = {
  claude: {
    label: "Claude Code",
    cmd: "claude",
    args: (prompt) => ["-p", "--", prompt],
    // claude -p 直接把回答印到 stdout。
    extract: (stdout) => stdout.trim(),
  },
  codex: {
    label: "Codex CLI",
    cmd: "codex",
    args: (prompt) => [
      "exec",
      "--json",
      "--color",
      "never",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "--",
      prompt,
    ],
    // codex exec --json 是一串事件，回答在 agent_message 裡。
    extract: (stdout) => {
      const messages = [];

      for (const line of stdout.split("\n")) {
        try {
          const value = JSON.parse(line);

          if (
            value?.type === "item.completed" &&
            value.item?.type === "agent_message" &&
            typeof value.item.text === "string"
          ) {
            messages.push(value.item.text);
          }
        } catch {
          // 事件流裡混著非 JSON 的行，跳過就好。
        }
      }

      return messages.at(-1)?.trim() ?? "";
    },
  },
};

function judgePrompt(answer) {
  return [
    "以下是另一個 AI 的回答。請只依照格式規則判定，不要評論內容對錯。\n\n",
    "規則：\n",
    ...RULES.map(([name, detail], index) => `${index + 1}. ${name}：${detail}\n`),
    "\n只輸出 JSON，不要有其他文字，格式：\n",
    '{"results":[{"rule":"結論先行","pass":true,"reason":"一句話"}]}\n\n',
    "要判定的回答：\n---\n",
    answer,
    "\n---",
  ].join("");
}

function runEngine(engine, prompt, env) {
  const { cmd, args } = resolveLaunch(engine.cmd, engine.args(prompt), { env });

  return new Promise((resolve) => {
    let child;

    try {
      child = spawn(cmd, args, {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env,
      });
    } catch (error) {
      resolve({ ok: false, text: error.message });
      return;
    }

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
      const answer = engine.extract(stdout);

      if (exitCode !== 0 || answer.length === 0) {
        resolve({
          ok: false,
          text: stderr.trim() || `結束於 exit ${exitCode} 且沒有取得回答`,
        });
        return;
      }

      resolve({ ok: true, text: answer });
    });
  });
}

// AI 有時會在 JSON 前後多寫一兩句，抓第一個完整的物件就好。
function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start === -1 || end <= start) {
    return null;
  }

  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function verifyEngine(engine, env) {
  console.log("");
  console.log(`── ${engine.label} ──`);
  console.log("正在請它回答一題標準問題…（要等十幾秒）");
  const answer = await runEngine(engine, QUESTION, env);

  if (!answer.ok) {
    console.log(`FAIL  叫不動 ${engine.label}：${answer.text}`);
    console.log("確認上面的環境檢查裡這個工具是綠的、而且已經登入。");
    return false;
  }

  console.log("");
  console.log("它的回答（前 8 行）：");

  for (const line of answer.text.split("\n").slice(0, 8)) {
    console.log(`  ${line}`);
  }

  console.log("");
  console.log("正在請它對照規則判定自己的回答…");
  const verdict = await runEngine(engine, judgePrompt(answer.text), env);

  if (!verdict.ok) {
    console.log(`FAIL  判定失敗：${verdict.text}`);
    return false;
  }

  const parsed = extractJson(verdict.text);

  if (parsed === null || !Array.isArray(parsed.results)) {
    console.log("FAIL  判定結果不是預期的 JSON，原始輸出：");
    console.log(verdict.text.trim().slice(0, 300));
    return false;
  }

  let passed = 0;

  for (const [name] of RULES) {
    const result = parsed.results.find((item) => item.rule === name);

    if (result?.pass === true) {
      passed += 1;
    }

    const mark = result?.pass === true ? "PASS" : "FAIL";
    console.log(`${mark}  ${name}：${result?.reason ?? "沒有判定結果"}`);
  }

  const ok = passed >= PASS_THRESHOLD;
  console.log("");
  console.log(
    `${engine.label}：${RULES.length} 條中 ${passed} 條通過` +
      `（門檻 ${PASS_THRESHOLD} 條）→ ${ok ? "通過" : "沒過"}`,
  );
  return ok;
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

const args = parseArgs(process.argv.slice(2));
const selected = (args.tools ?? "claude")
  .split(",")
  .filter((tool) => Object.hasOwn(ENGINES, tool));

if (selected.length === 0) {
  console.error("沒有指定要驗哪個工具（--tools=claude,codex）");
  process.exit(1);
}

const env = await spawnEnv();
let failures = 0;

for (const tool of selected) {
  const ok = await verifyEngine(ENGINES[tool], env);

  if (!ok) {
    failures += 1;
  }
}

console.log("");

if (failures > 0) {
  console.log(`${failures} 個工具沒通過。`);
  console.log("回上面看對應的那幾列是不是綠的——規則檔沒裝好，行為就不會變。");
  process.exit(1);
}

console.log("行為驗證通過——設定確實生效了。");
