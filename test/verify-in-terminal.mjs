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

// 我們自己寫出來的臨時腳本，不該看機器的執行原則臉色。
//
// Windows 預設是 Restricted：新開的視窗一跑就紅字「running scripts is disabled」，
// 而嚮導這邊看到的 exit code 還是 0——因為 cmd start 一開完就回來了（VM 實測，學生
// 按「開啟 Claude Code」直接撞到）。Restricted 連 profile 都不載入，wrapper 就住在
// 裡面，所以標題同步那一格等於根本沒在驗。
//
// Bypass 只影響那一個行程，不動機器設定。機器本身的執行原則另有一張卡在管。
for (const spawnSite of [
  /"powershell\.exe",\s*\n\s*"-NoExit",[\s\S]*?"-ExecutionPolicy",\s*\n\s*"Bypass",/,
  /Start-Process powershell\.exe -ArgumentList @\('-NoProfile','-ExecutionPolicy','Bypass','-File'/,
]) {
  assert.match(source, spawnSite);
}
console.log("ok - 自己 spawn 的 PowerShell 腳本一律帶 Bypass，不依賴機器設定");

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

// 列上寫的驗證情境，verify-in-terminal 與 actions 的白名單都要認得。少一邊的話按鈕
// 不是丟「不認得的驗證情境」就是被伺服器擋在門外——兩種都是按下去沒反應。
const { VERIFICATION } = await import("../src/config-check.js");
const { actions } = await import("../src/actions.js");
const allowedCases = actions["verify-in-terminal"].options.case;

for (const [step, spec] of Object.entries(VERIFICATION)) {
  if (spec.terminal === undefined) continue;

  // CASES 的鍵有引號的（帶連字號）也有沒引號的，兩種都要認。
  assert(
    new RegExp(`^\\s+"?${spec.terminal.case}"?:`, "m").test(source),
    `${step} 用的情境 ${spec.terminal.case} 在 verify-in-terminal 裡不存在`,
  );
  assert(
    allowedCases.includes(spec.terminal.case),
    `${step} 用的情境 ${spec.terminal.case} 不在 action 的白名單裡`,
  );
}
console.log("ok - 每一列的終端驗證情境，腳本與白名單兩邊都認得");

// handoff 那格靠「必讀檔案」判定：那四個字是 SKILL.md 規定的章節名，模型沒讀到
// skill 不會自己想到。SKILL.md 改了章節名而這裡沒跟著改，判定就永遠不會中。
for (const agent of ["claude", "codex"]) {
  assert(
    readFileSync(
      path.join(repoRoot, `materials/skills/skill-files/${agent}/handoff/SKILL.md`),
      "utf8",
    ).includes("必讀檔案"),
    `${agent} 的 handoff SKILL.md 裡沒有「必讀檔案」，比對永遠不會中`,
  );
}
console.log("ok - handoff 判定用的章節名真的在 SKILL.md 裡");

// Codex 的改名是兩段式：模型先寫中繼檔，要等「下一次 hook 事件」才套上標題。所以
// 每個會改名的情境都得叫它改完再做一次工具呼叫。漏掉的那一格會長成「檔案寫得出來、
// 標題不動」，看起來像 skill 壞掉（naming 與 skill-rename 早就補了，skill-handoff
// 漏掉，VM 實測才發現）。
const RENAME_CASES = ["naming", "skill-rename", "skill-handoff"];
assert.equal(
  source.split("讓 hook 有機會把名字套用上去").length - 1,
  RENAME_CASES.length,
  `會改名的 ${RENAME_CASES.length} 個情境都要補 Codex 的第二次工具呼叫`,
);
console.log("ok - 每個會改名的情境都給 Codex 補了第二次工具呼叫");

// Codex 的 SKILL.md 標了 user-invocable，要用 `$名字` 才會真的載入。只寫「請使用
// handoff skill」的話它當成一般描述，自己憑印象寫一份交出來——文件長得像、SKILL.md
// 裡的步驟一個都沒跑（mac VM 實測：交接檔有、改名整段沒提，/tmp 沒有任何 relay 檔）。
for (const skill of ["auto-rename", "handoff", "structured-questions"]) {
  assert(
    source.includes(`$${skill} `),
    `Codex 那一路要用 $${skill} 呼叫，不能只寫「請使用 ${skill} skill」`,
  );
}
console.log("ok - Codex 用 $ 形式呼叫 skill，不是自然語言描述");
