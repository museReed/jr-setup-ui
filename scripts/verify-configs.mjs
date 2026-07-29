// 驗證規則檔「真的生效了嗎」，不是「指令有沒有跑完」。
//
//   node scripts/verify-configs.mjs --tools=claude,codex --lang=zh-TW
//
// 最關鍵的一項是直接觸發 hook：餵一段串接指令進去，看它回不回 exit 2。
// 這是真的行為驗證，不需要開 Claude session。
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { probeHook, runConfigCheck } from "../src/config-check.js";

const HOME = homedir();
const HOOK_PATH = path.join(HOME, ".claude", "hooks", "block-chained-bash.js");

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

// 探測本身跟畫面那一列共用同一支，兩邊不會對不上。
const runHook = (command) => probeHook(HOOK_PATH, command);

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

  if (!existsSync(HOOK_PATH)) {
    report(false, "hook 檔案存在", "找不到，跳過行為測試");
  } else {
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
