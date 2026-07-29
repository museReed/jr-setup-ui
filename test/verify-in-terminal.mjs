// 產給終端跑的那段 PowerShell，參數必須用陣列傳，不能拼成一個字串。
//
// 拼字串的話 PowerShell 會再解讀一次引號，而 JS 寫的 \" 在 .ps1 檔裡是「反斜線
// 加引號」不是跳脫（PowerShell 用反引號）——字串提早結束，路徑全變成位置參數，
// Start-Process 直接報 PositionalParameterNotFound（VM 實測）。
//
// 這條檢查的是原始碼的形狀，所以在 macOS 上就會紅，不用等 VM。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(
  path.join(repoRoot, "scripts/verify-in-terminal.mjs"),
  "utf8",
);

assert(
  source.includes("-ArgumentList @("),
  "Start-Process 的參數要用 @(...) 陣列傳",
);
assert(
  !source.includes('-ArgumentList "'),
  "不能把 Start-Process 的參數拼成一個字串——引號會被 PowerShell 再解讀一次",
);
console.log("ok - 終端啟動腳本用陣列傳參數，不靠引號");

// 兩支監控腳本的測試開關名字不一樣，設錯的話門檻沒降下來，hook 永遠不會出聲。
assert(
  source.includes("CODEX_TEST_MAX_CONTEXT_WINDOW"),
  "codex 的 context 測試開關名字不對",
);
assert(
  source.includes("CONTEXT_MONITOR_TEST_WINDOW"),
  "claude 的 context 測試開關名字不對",
);
console.log("ok - 兩個 agent 各用自己的 context 測試開關");

// 關鍵字必須真的出現在對應那支 hook 的訊息裡。實測踩過：codex 在測試模式下寫的是
// 「測試模式：Context 以小視窗 5000 計算」，裡面沒有「Context 已用」——hook 有觸發、
// 檔案也寫了，只有比對用的字串對不上，整格判成失敗。
const hookText = {
  claude: readFileSync(
    path.join(repoRoot, "materials/skills/hooks/context-monitor.sh"),
    "utf8",
  ),
  codex: readFileSync(
    path.join(repoRoot, "materials/skills/hooks/codex-context-monitor.sh"),
    "utf8",
  ),
};

for (const [agent, keyword] of [
  ["claude", "Context 已用"],
  ["codex", "[context-monitor]"],
]) {
  assert(
    source.includes(keyword),
    `verify-in-terminal 沒有用 ${agent} 的關鍵字「${keyword}」`,
  );
  assert(
    hookText[agent].includes(keyword),
    `${agent} 的 hook 訊息裡沒有「${keyword}」，比對永遠不會中`,
  );
}
console.log("ok - context 比對的關鍵字真的出現在對應 hook 的訊息裡");
