// 行為驗證：讓學生自己的 AI 判定「回覆有沒有照規則」。
//
//   node scripts/verify-behavior.mjs
//
// 兩次呼叫：第一次問一題標準問題拿回答，第二次把回答丟回去請 AI 對照規則判定。
// 為什麼不是人工看：規則有五條，學生不知道該看什麼；AI 判定會給每條的理由。
// 為什麼可以用 -p：實測 -p 與互動 session 讀的是同一份 settings.json，
// output style 一樣會套用。
import { spawn } from "node:child_process";

import { resolveLaunch } from "../src/spawn-command.js";
import { spawnEnv } from "../src/env-path.js";

const TIMEOUT_MS = 180_000;

const QUESTION =
  "我想開始經營個人品牌，Instagram 和 YouTube 我該先從哪個開始？";

// advisory 的項目只顯示、不計入通過與否：它沒有客觀依據，判定會浮動，
// 誤報一次就會讓學生以為自己裝壞了。其他四條都是看得見的結構特徵。
const RULES = [
  { name: "結論先行", detail: "第一行就是粗體結論，不是「好問題！」這種開場白" },
  { name: "比較用表格", detail: "兩個平台的比較用 Markdown 表格，不是散文" },
  { name: "語氣中性", detail: "沒有 emoji、沒有「太棒了！」這類慶祝語氣" },
  { name: "追問清單", detail: "結尾有「你可能會想問」之類的追問清單" },
  { name: "長度中等", detail: "精簡到可以行動，不是長篇大論", advisory: true },
];

function judgePrompt(answer) {
  return [
    "以下是另一個 AI 的回答。請只依照格式規則判定，不要評論內容對錯。\n\n",
    "規則：\n",
    ...RULES.map(
      (rule, index) => `${index + 1}. ${rule.name}：${rule.detail}\n`,
    ),
    "\n只輸出 JSON，不要有其他文字，格式：\n",
    '{"results":[{"rule":"結論先行","pass":true,"reason":"一句話"}]}\n\n',
    "要判定的回答：\n---\n",
    answer,
    "\n---",
  ].join("");
}

function runClaude(prompt, env) {
  const { cmd, args } = resolveLaunch("claude", ["-p", "--", prompt], { env });

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

      if (exitCode !== 0 || stdout.trim().length === 0) {
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

const env = await spawnEnv();

console.log("正在請 Claude 回答一題標準問題…（要等十幾秒）");
const answer = await runClaude(QUESTION, env);

if (!answer.ok) {
  console.error(`叫不動 claude：${answer.text}`);
  console.error("確認上面的環境檢查裡 Claude Code 是綠的、而且已經登入。");
  process.exit(1);
}

console.log("");
console.log("── 它的回答（節錄前 12 行）──");

for (const line of answer.text.trim().split("\n").slice(0, 12)) {
  console.log(`  ${line}`);
}

console.log("");
console.log("正在請 Claude 對照規則判定自己的回答…");
const verdict = await runClaude(judgePrompt(answer.text), env);

if (!verdict.ok) {
  console.error(`判定失敗：${verdict.text}`);
  process.exit(1);
}

const parsed = extractJson(verdict.text);

if (parsed === null || !Array.isArray(parsed.results)) {
  console.error("判定結果不是預期的 JSON，原始輸出：");
  console.error(verdict.text.trim().slice(0, 500));
  process.exit(1);
}

console.log("");
console.log("── 判定結果 ──");
let failures = 0;

for (const rule of RULES) {
  const result = parsed.results.find((item) => item.rule === rule.name);
  const suffix = rule.advisory === true ? "（參考，不計入）" : "";

  if (result === undefined) {
    if (rule.advisory !== true) {
      failures += 1;
    }

    console.log(`FAIL  ${rule.name}${suffix}：沒有判定結果`);
    continue;
  }

  if (result.pass !== true && rule.advisory !== true) {
    failures += 1;
  }

  const mark = result.pass === true ? "PASS" : "FAIL";
  console.log(`${mark}  ${rule.name}${suffix}：${result.reason ?? ""}`);
}

console.log("");

if (failures > 0) {
  console.log(`${failures} 條沒過。設定只對新開的 session 生效——`);
  console.log("如果你剛裝完，這裡跑的是新的程序，理論上已經套用了；");
  console.log("仍然沒過的話，回上面看「回覆格式 Output Style」那一列是不是綠的。");
  process.exit(1);
}

console.log("格式規則全部通過——設定確實生效了。");
