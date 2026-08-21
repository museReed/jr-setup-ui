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

import { terminalCommand } from "../src/terminal-window.js";

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
//
// ⚠️ 開視窗那一段搬進 src/terminal-window.js 之後，這裡改成**驗它真的產出什麼**，
// 不再掃原始碼文字。掃文字的版本只要有人換行改一下就假紅，而且搬家之後它守的是
// 一個已經不在這個檔案裡的東西。
const windowsArgs = terminalCommand("C:\\tmp\\jr.ps1", {
  platform: "win32",
  home: "C:\\Users\\Reed",
  exists: () => false,
}).args;

assert.deepEqual(
  windowsArgs.slice(-4),
  ["-ExecutionPolicy", "Bypass", "-File", "C:\\tmp\\jr.ps1"],
  "自己寫出來的臨時腳本一律帶 Bypass",
);
assert.ok(windowsArgs.includes("-NoExit"), "跑完要留著視窗給學生看");
assert.match(
  source,
  /Start-Process powershell\.exe -ArgumentList @\('-NoProfile','-ExecutionPolicy','Bypass','-File'/,
);
console.log("ok - 自己 spawn 的 PowerShell 腳本一律帶 Bypass，不依賴機器設定");

// zsh 的特殊變數不能拿來當一般變數名。
//
// 這幾個小寫的名字在 zsh 裡是綁定的：`path` 就是 `PATH`、`fpath` 是函式搜尋路徑、
// `status` 是上一個指令的結束碼。我們寫出來的啟動腳本是 #!/bin/zsh -i，所以
// `path=…` 那一行實際上是「把這個視窗的指令搜尋路徑換成一個不存在的資料夾」——
// 之後 sed、open 全部叫不到，瀏覽器不會開，而學生看到的是「command not found: sed」。
//
// ⚠️ 症狀跟原因完全對不上，靠讀程式碼看不出來（實際踩過一次）。所以用測試釘住。
//
// 掃之前先把註解拿掉：解釋這條規則的註解本身就會寫到 `path=`，不拿掉的話這一條
// 會被自己的說明文字絆倒（寫這條的時候當場踩到）。
const code = source
  .split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");

for (const reserved of ["path", "cdpath", "fpath", "manpath", "status", "argv"]) {
  assert.doesNotMatch(
    code,
    new RegExp(`[\`\\n]\\s*${reserved}=`),
    `shell 變數不能叫 ${reserved}——那是 zsh 的特殊變數，賦值會蓋掉它原本的意思`,
  );
}
console.log("ok - 寫出去的 shell 腳本不拿 zsh 的特殊變數當一般變數名");

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

// 白名單那題的關鍵在「跳了提示就不要按允許」那一句。
//
// 少了它，這一題會變成假驗證：學生按了允許 → 指令照樣跑 → 檔案裡照樣有 token →
// 驗證通過，而白名單其實沒生效。有那一句，檔案裡放的是提示原文，比對就會失敗
// ——那才是我們要的答案。
assert.match(source, /allowlist-ok-9d4b71/);
assert(
  /allowlist: \{[\s\S]*?不要按允許[\s\S]*?\},/.test(source),
  "白名單那題要明講「跳了提示不要按允許」，否則按了允許也會過",
);
// 題目要用單一指令。串接的話會先被隔壁那個 hook 擋下來，驗到的是 hook 不是白名單。
assert(
  /allowlist: \{[\s\S]*?echo \$\{ALLOWLIST_TOKEN\}[\s\S]*?\},/.test(source),
  "白名單那題要用單一的 echo——串接指令會先被 hook 擋掉",
);

// 覆蓋的是幾種形狀不同的規則，不是 39 條指令。少一種形狀，那種壞掉時卡片還是綠的。
const allowlistCase = source.slice(
  source.indexOf("  allowlist: {"),
  source.indexOf("  chained: {"),
);
for (const [shape, needle] of [
  ["完全精確、沒有萬用字元", "pwd"],
  ["兩字前綴", "git status"],
  ["非 Bash 工具、帶 specifier", "WebFetch"],
]) {
  assert(
    allowlistCase.includes(needle),
    `白名單那題少了「${shape}」這種規則（${needle}）`,
  );
}

// ⚠️ WebSearch 那條規則整個不驗（Reed 指定）：它在部分地區用不了，驗它等於在那些
// 地區製造一個永遠紅的燈——學生只會看到紅燈去重裝白名單，裝一百次也不會好。
// 「非 Bash 工具」這種形狀由 WebFetch 那條代表就夠了。
assert(
  !allowlistCase.includes("WebSearch"),
  "白名單那題不可以碰 WebSearch——它在部分地區用不了，會變成永遠紅的假燈",
);
assert(
  /四步全部都沒有跳提示的話/.test(allowlistCase),
  "判定條件的步數要跟提問裡列的一致",
);
console.log("ok - 白名單那題覆蓋四種規則形狀，按了允許不會過，不碰 WebSearch");

// 迴歸（Windows VM 實測）：題目只丟一個檔案路徑給模型、沒說資料夾已經在了，模型就會
// 防禦性地先跑一次「建立那個資料夾」——而那一步在 Windows 上撞權限牆（New-Item 不在
// 白名單裡，那 39 條全是 Bash(...) 的名字）。學生按了拒絕，整條驗證斷在那裡，結果檔
// 永遠不會出現。跑串接那題時就是這樣斷的，而且它影響的是每一題，不只那一題。
assert(
  source.includes("const RESULT_DIR_NOTE ="),
  "提到結果檔的題目都要附「資料夾已經存在」，否則模型會先去建目錄然後撞權限",
);
assert(
  /text\.includes\(resultFile\) \? `\$\{text\}\$\{RESULT_DIR_NOTE\}` : text/.test(
    source,
  ),
  "那句話要自動接在每一題後面，不能靠各題自己記得寫",
);
console.log("ok - 會寫結果檔的題目都被告知資料夾已經存在");

// 兩邊的記憶體提醒要對稱。codex 那張曾經被拿掉（理由是重疊、而且它兩次實測都誤判），
// 於是畫面上 Claude 那張要驗、Codex 這張直接綠燈——學生看到的是「這張是不是壞了」
//（Reed 實測就是這樣問的）。當初誤判的兩個原因（測試開關名字、比對關鍵字）都由上面
// 那兩條測試釘住了，所以加回來。
for (const step of ["claude-monitor", "codex-monitor"]) {
  assert.deepEqual(
    VERIFICATION[step]?.terminal,
    { case: "context", agent: step.startsWith("claude") ? "claude" : "codex" },
    `${step} 少了行為驗證——兩邊的記憶體提醒要對稱`,
  );
}
console.log("ok - Claude 與 Codex 的記憶體提醒都要真的跑一次");

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

// 標題那一格寫進去的字，要活得過這支 launcher 自己後面跑的東西。
//
// launcher 是 `zsh -i`（要讀 .zshrc 才有 wrapper），於是使用者的主題也跟著載入。
// oh-my-zsh 會在每個指令執行前把標題改成那個指令的名字——實測在裝了 powerlevel10k
// 的機器上，學生看到的標題是 `echo`，也就是腳本最後一個指令。
//
// 兩道保險缺一不可，所以兩個都釘住。
{
  const disableAt = source.indexOf("DISABLE_AUTO_TITLE=true");
  assert(disableAt >= 0, "標題 launcher 要關掉主題的自動標題");

  const echoAt = source.indexOf("標題測試結束——這個視窗的分頁標題現在是");
  const namerAt = source.indexOf('CLAUDE_PROJECT_DIR="$HOME" ${namer}');

  assert(echoAt >= 0, "找不到標題那一格的提示字");
  assert(namerAt >= 0, "找不到標題那一格呼叫命名腳本的那一行");
  assert(
    namerAt > echoAt,
    "命名腳本要放在最後一行——先印字後改標題，才沒有下一個指令能蓋掉標題",
  );

  console.log("ok - 標題 launcher 關掉主題自動標題，而且把改標題排在最後");
}
