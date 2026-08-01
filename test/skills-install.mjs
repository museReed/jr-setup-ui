// Skill 安裝那幾列：檔案落點、$HOME 代換、舊版偵測、第三方落點。
//
// 這一段全部可以在 macOS 上跑完——skill 的坑跟 hook 同一家族（檔案在但內容是舊的、
// 路徑沒展開所以被權限層擋下），那些都是內容比對抓得到的事，不用等 VM。
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  EXTERNAL_SKILL_IDS,
  SKILL_NAMES,
  applySubstitutions,
  describeStep,
  skillStepId,
  stepsForTools,
} from "../src/config-install.js";
import {
  checkDemo,
  checkExternalSkill,
  checkSkill,
  withActions,
} from "../src/config-check.js";
import { configRowModel } from "../public/viewmodel.js";

const HOME = "/home/student";

// --- 步驟清單 ---

const claudeOnly = stepsForTools(["claude"]);
const codexOnly = stepsForTools(["codex"]);

for (const name of SKILL_NAMES) {
  assert(
    claudeOnly.includes(skillStepId("claude", name)),
    `只選 Claude 時少了 ${name}`,
  );
  assert(
    !claudeOnly.includes(skillStepId("codex", name)),
    `只選 Claude 卻裝了 Codex 的 ${name}`,
  );
  assert(codexOnly.includes(skillStepId("codex", name)), `只選 Codex 時少了 ${name}`);
}
console.log("ok - skill 步驟跟著選到的工具走，一個 skill 一列");

// hook 沒裝好的話 auto-rename skill 叫的那條指令也不會動，所以順序要在後面。
assert(
  claudeOnly.indexOf(skillStepId("claude", "auto-rename")) >
    claudeOnly.indexOf("claude-namer"),
  "skill 要排在命名 hook 後面",
);
console.log("ok - skill 排在對應的 hook 之後");

// --- 落點 ---

const claudeHandoff = describeStep(skillStepId("claude", "handoff"), {
  lang: "zh-TW",
  home: HOME,
});
assert.equal(claudeHandoff.kind, "skill");
assert.equal(
  claudeHandoff.files[0].target,
  `${HOME}/.claude/skills/handoff/SKILL.md`,
);

const codexHandoff = describeStep(skillStepId("codex", "handoff"), {
  lang: "zh-TW",
  home: HOME,
});
// Codex 的官方 user 目錄是 ~/.agents/skills，不是 ~/.codex/skills（那是舊版）。
assert.equal(
  codexHandoff.files[0].target,
  `${HOME}/.agents/skills/handoff/SKILL.md`,
);
// handoff 的 SKILL.md 會叫模型去 Read _shared，沒跟著裝的話改名那半段是死的。
assert(
  codexHandoff.files.some((file) =>
    file.target.endsWith("/_shared/codex-session-rename.md"),
  ),
  "Codex 的 handoff 要一起帶 _shared",
);
console.log("ok - Claude 與 Codex 的 skill 各自裝到自己的目錄");

// --- $HOME 代換 ---

const autoRename = describeStep(skillStepId("claude", "auto-rename"), {
  lang: "zh-TW",
  home: HOME,
});
// Bash() 白名單是字面比對、不展開 $HOME：SKILL.md 裡的 $HOME 沒換掉的話，模型照著
// 打出來的指令對不上白名單，每次命名都被擋（跟 hook 那邊同一個坑）。
assert.equal(
  applySubstitutions(
    "$HOME/.claude/hooks/set-session-name.sh '{名稱}' $PPID",
    autoRename.substitutions,
  ),
  `${HOME}/.claude/hooks/set-session-name.sh '{名稱}' $PPID`,
);
// handoff 收尾也會叫同一支命名腳本，所以代換套在所有 Claude skill 上。
assert.deepEqual(claudeHandoff.substitutions, autoRename.substitutions);
// Codex 那邊沒有這條路徑（改名走 _shared 的 relay 檔），不要亂動內容。
assert.deepEqual(codexHandoff.substitutions, []);
console.log("ok - Claude skill 的 $HOME 換成絕對路徑，Codex 不動");

// 改名指令不准自己拼串接：那種寫法會被 block-chained-bash hook 擋下（exit 2），
// 結果是交接檔寫得出來、分頁標題完全不動，畫面上還不會有人說為什麼（VM 實測）。
for (const name of ["auto-rename", "handoff"]) {
  const skill = readFileSync(
    new URL(`../materials/skills/skill-files/claude/${name}/SKILL.md`, import.meta.url),
    "utf8",
  );
  assert(
    skill.includes("set-session-name.sh"),
    `${name} 要透過包裝腳本改名`,
  );
  // 盯的是「串接指令」這個形狀（`&& \` 換行接下一段），不是 ps 這個字——
  // 內文解釋腳本內部怎麼運作時提到 ps 是正常的。
  assert(
    !/&&\s*\\/.test(skill),
    `${name} 又自己拼串接的改名指令了——會被 block-chained-bash 擋下`,
  );
}
console.log("ok - Claude skill 的改名一律走包裝腳本，不拼串接指令");

// --- 三態判定 ---

const workdir = mkdtempSync(path.join(tmpdir(), "jr-skill-"));
const materials = path.join(workdir, "materials");
const home = path.join(workdir, "home");
const sourceFile = path.join(
  materials,
  "skills/skill-files/claude/handoff/SKILL.md",
);
mkdirSync(path.dirname(sourceFile), { recursive: true });
writeFileSync(sourceFile, "# handoff\n必讀檔案\n");

const step = describeStep(skillStepId("claude", "handoff"), {
  lang: "zh-TW",
  home,
});

assert.equal((await checkSkill(step, materials)).status, "missing");

mkdirSync(path.dirname(step.files[0].target), { recursive: true });
writeFileSync(step.files[0].target, "# handoff\n舊版\n");
const stale = await checkSkill(step, materials);
// 「檔案在」不等於「是這一版」——只看存在與否會給綠燈，學生手上卻是舊的。
assert.equal(stale.status, "warn");
assert(stale.detail.includes("舊版"), stale.detail);

writeFileSync(step.files[0].target, "# handoff\n必讀檔案\n");
assert.equal((await checkSkill(step, materials)).status, "ok");
console.log("ok - skill 缺少／舊版／已安裝三態分得開");

// --- 第三方 ---

const external = EXTERNAL_SKILL_IDS.map((id) =>
  describeStep(id, { lang: "zh-TW", home }),
);
assert(external.every((entry) => entry.kind === "external-skill"));

const frontend = external.find((entry) => entry.id === "ext-frontend-design-claude");
assert.equal((await checkExternalSkill(frontend)).status, "missing");
mkdirSync(frontend.marker, { recursive: true });
assert.equal((await checkExternalSkill(frontend)).status, "ok");

// Claude 的 Playwright 是 MCP server 不是 skill，落點在 ~/.claude.json。
const mcp = external.find((entry) => entry.id === "ext-playwright-claude");
assert.equal((await checkExternalSkill(mcp)).status, "missing");
writeFileSync(
  mcp.mcpConfig,
  JSON.stringify({ mcpServers: { playwright: { command: "npx" } } }),
);
assert.equal((await checkExternalSkill(mcp)).status, "ok");
console.log("ok - 第三方 skill 認落點，MCP 認 ~/.claude.json 的註冊");

// --- 一條龍 demo 那一列 ---

// demo 排最後：它把前面裝的東西串起來跑一次，前面沒綠就沒必要跑。
assert.equal(claudeOnly.at(-1), "demo-claude");
assert.equal(codexOnly.at(-1), "demo-codex");

const demo = describeStep("demo-claude", { lang: "zh-TW", home: HOME });
assert.equal(demo.kind, "demo");

// 這一列沒有東西可裝，連鎖住的安裝按鈕都不補。
//
// 原本補一顆按不動的佔位（為了讓每列的按鈕位置對齊），但 demo 從頭到尾就沒有
// 「安裝」這個概念——學生會盯著那顆想「是不是要先按這個」（VM 實測）。那一列的
// 動作是「開終端跑」，那顆自己會在。
const demoCheck = withActions(checkDemo(demo));
assert.equal(demoCheck.noInstall, true);
assert.equal(demoCheck.status, "ok");

const demoRow = configRowModel(demoCheck, false);
assert.equal(demoRow.buttons.length, 1);
assert.equal(demoRow.buttons[0].dataName, "verifyAction");
assert.equal(demoRow.buttons[0].text, "開終端跑");
// 沒驗過之前不給綠燈，跟其他列同一條規則。
assert.equal(demoRow.status, "unverified");
assert.equal(configRowModel(demoCheck, true).status, "ok");
// 第三段「逐字打 code、右邊長出網頁」是純畫面，程式判不到——要有勾選框讓學生確認。
// 有 eyeCheck 的列不會被自動標綠（app.js 那條規則），綠燈以勾選為準。
assert(demoRow.eyeCheck != null, "demo 那列要有人眼確認的勾選框");
console.log("ok - demo 那列鎖住安裝按鈕，並附開終端與人眼確認");

// demo 第 3 步：內建的是自走版（產出的頁面打開就自己演，零依賴）。原版 type_hl.py
// 要 python playwright + chromium，現場多兩個安裝步驟，所以不帶——這裡釘住「帶的是
// 哪一版」，免得哪天同步腳本又把原版塞回來。
const demoDir = new URL("../materials/skills/demo/", import.meta.url);
assert(
  existsSync(new URL("live-preview-self/self_play.py", demoDir)),
  "內建素材少了自走版 self_play.py",
);
assert(
  !existsSync(new URL("live-preview/type_hl.py", demoDir)),
  "不要帶原版 type_hl.py——它要 python playwright，學生現場裝不動",
);

const terminalSource = readFileSync(
  new URL("../scripts/verify-in-terminal.mjs", import.meta.url),
  "utf8",
);
assert(
  terminalSource.includes("self_play.py"),
  "demo 的提問要指定自走版腳本，否則模型會照 prompt 去找另一個 repo 的路徑",
);
console.log("ok - demo 帶的是自走版腳本，提問也指到它");

// 嚮導是獨立的：學生只 clone 這一個 repo，機器上不會有 jr_ai_agent_skills /
// jr_ai_agent_configs。內建素材裡若還留著那些 repo 的路徑，模型會照著去找、找不到，
// 然後卡住（VM 實測，demo 第 3 步就是這樣卡的）。
//
// 只查「模型會讀到的內容」——scripts/sync-*.sh 是維護者用的同步工具，本來就要知道
// 上游在哪，不在此限。
for (const file of [
  "demo/demo-prompt-claude.md",
  "demo/demo-prompt-codex.md",
]) {
  const text = readFileSync(
    new URL(`../materials/skills/${file}`, import.meta.url),
    "utf8",
  );
  assert(
    !text.includes("jr_ai_agent_skills"),
    `${file} 還指著 jr_ai_agent_skills——學生機器上沒有那個 repo`,
  );
}
console.log("ok - 模型會讀到的內建素材不指向其他 repo");

// --- 第三方指令的 spawn 形狀 ---

// Windows 上 npx / claude 都是 .cmd 包裝檔，沒有同名 .exe：shell:false 的 spawn 找不到
// 裸指令，丟 ENOENT。畫面上會變成「叫不到 npx，請先裝 Node」，但 Node 明明裝好了
// （VM 實測）。resolveLaunch 就是為了這件事存在的，這裡確認第三方那段真的走它。
const installerSource = readFileSync(
  new URL("../scripts/install-configs.mjs", import.meta.url),
  "utf8",
);
assert(
  installerSource.includes("resolveLaunch(step.cmd, step.args"),
  "第三方 skill 的指令要先過 resolveLaunch，否則 Windows 上必 ENOENT",
);
assert(
  !/spawn\(step\.cmd/.test(installerSource),
  "不要直接 spawn(step.cmd)——那是 Windows 上叫不到 npx 的寫法",
);
console.log("ok - 第三方指令走 resolveLaunch，不直接 spawn 裸指令");

rmSync(workdir, { recursive: true, force: true });
