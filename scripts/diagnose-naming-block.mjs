// 診斷「驗證自動命名」為什麼過不了：模型被權限層擋下，但擋在哪一格？
//
//   node scripts/diagnose-naming-block.mjs
//
// 只讀不寫（除了 hook 自己在暫存目錄留的計數檔），不碰 settings.json。
// 回答三個問題，順序就是失敗的可能位置：
//   1. 白名單規則到底有沒有寫進 settings.json？
//   2. hook 實際叫模型跑的指令，跟那條規則對得上嗎？
//   3. 兩者都對得上的話 → 剩下的只可能是 Claude Code 內建防護，要進 session 實測。
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const home = homedir().replaceAll("\\", "/");
const isWindows = process.platform === "win32";
const settingsPath = path.join(home, ".claude", "settings.json");
const hookPath = `${home}/.claude/hooks/session-auto-namer.${isWindows ? "ps1" : "sh"}`;

function runHook() {
  const [cmd, args] = isWindows
    ? [
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", hookPath, "prompt"],
      ]
    : ["bash", [hookPath, "prompt"]];

  return new Promise((resolve) => {
    const child = spawn(cmd, args, { shell: false, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => (stderr += chunk));
    // session_id 每次都不同：hook 只在該 session 的第 1 個 prompt 送出命名請求，
    // 沿用同一個 id 會讓第二次執行什麼都不印。
    child.stdin.end(JSON.stringify({ session_id: `diagnose-${Date.now()}` }));
    child.once("error", (error) => resolve({ ok: false, text: error.message }));
    child.once("close", (code) =>
      resolve(
        code === 0
          ? { ok: true, stdout }
          : { ok: false, text: stderr.trim() || `hook 結束於 exit ${code}` },
      ),
    );
  });
}

// hook 送出的 additionalContext 最後一段是「執行指令：\n<指令原文>」。
function extractWriteCommand(stdout) {
  const context = JSON.parse(stdout)?.hookSpecificOutput?.additionalContext ?? "";
  const lines = context.split("\n").map((line) => line.trim());
  const marker = lines.findIndex((line) => line.startsWith("執行指令："));
  return marker === -1 ? "" : lines.slice(marker + 1).find(Boolean) ?? "";
}

// Claude Code 的 Bash 規則兩種形狀：`Bash(<指令>)` 完全相同、`Bash(<前綴>:*)` 前綴相符。
function matchesRule(rule, command) {
  const inner = rule.match(/^Bash\((.*)\)$/s)?.[1];
  if (inner === undefined) return false;
  return inner.endsWith(":*")
    ? command.startsWith(inner.slice(0, -2))
    : command === inner;
}

const settings = await readFile(settingsPath, "utf8")
  .then(JSON.parse)
  .catch(() => null);

if (settings === null) {
  console.log(`FAIL  讀不到 ${settingsPath}——規則不可能生效。`);
  process.exit(1);
}

const allow = settings?.permissions?.allow ?? [];
const namingRules = allow.filter((rule) => rule.includes("set-session-name"));

console.log("── ① settings.json 裡跟命名有關的白名單規則 ──");
if (namingRules.length === 0) {
  console.log("  （一條都沒有）");
} else {
  for (const rule of namingRules) console.log(`  ${rule}`);
}

const hookResult = await runHook();
if (!hookResult.ok) {
  console.log(`\nFAIL  叫不動 hook：${hookResult.text}`);
  process.exit(1);
}

const writeCommand = extractWriteCommand(hookResult.stdout);
console.log("\n── ② hook 實際叫模型跑的指令 ──");
console.log(`  ${writeCommand || "（hook 沒送出命名請求）"}`);

if (!writeCommand) {
  console.log("\nFAIL  hook 沒送出命名請求，問題在 hook 本身而不是白名單。");
  process.exit(1);
}

const hit = namingRules.find((rule) => matchesRule(rule, writeCommand));
console.log("\n── ③ 判定 ──");

if (namingRules.length === 0) {
  console.log("  規則根本沒安裝 → 重跑「Claude Code hooks」安裝，或修安裝流程。");
} else if (!hit) {
  console.log("  規則在，但跟指令對不上 → 修 namingAllowRule 讓它逐字符合上面那行。");
  console.log(`  指令前 ${Math.min(writeCommand.length, 90)} 字：`);
  console.log(`    ${writeCommand.slice(0, 90)}`);
} else {
  console.log(`  規則逐字對得上：${hit}`);
  console.log("  → 白名單這一格是乾淨的。剩下唯一的可能是 Claude Code 內建防護");
  console.log("    （指令生出另一個直譯器子行程，前綴白名單救不回）。");
  console.log("    下一步：node scripts/verify-hooks-live.mjs，看模型被拒的原文。");
}
