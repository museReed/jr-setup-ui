// Skill 安裝那幾列：檔案落點、$HOME 代換、舊版偵測、第三方落點。
//
// 這一段全部可以在 macOS 上跑完——skill 的坑跟 hook 同一家族（檔案在但內容是舊的、
// 路徑沒展開所以被權限層擋下），那些都是內容比對抓得到的事，不用等 VM。
import assert from "node:assert/strict";
import {
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
import { checkExternalSkill, checkSkill } from "../src/config-check.js";

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
// 其他 skill 不需要代換，別亂動內容。
assert.deepEqual(claudeHandoff.substitutions, []);
console.log("ok - auto-rename 的 $HOME 換成絕對路徑，其他 skill 不動");

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
