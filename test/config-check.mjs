import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  VERIFICATION,
  checkAgentHooks,
  checkCopyStep,
  checkTabSync,
  probeHook,
  resolveBash,
  straySkillDirs,
  wiredToScript,
} from "../src/config-check.js";
import {
  describeStep,
  mergeAgentHookRegistrations,
  upsertBlock,
} from "../src/config-install.js";
import { materialsDir } from "../src/paths.js";

const MATERIALS = materialsDir();

// 裝進去的內容必須跟 materials 逐字相同，否則會被判成舊版——所以測試也要照真的裝。
function installFrom(source, target) {
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(path.join(MATERIALS, source), target);
}

function ok(description) {
  console.log(`ok - ${description}`);
}

const dir = mkdtempSync(path.join(tmpdir(), "jr-hook-"));

function hookAt(name, source) {
  const target = path.join(dir, name);
  writeFileSync(target, source);
  return target;
}

try {
  // 會擋的 hook：讀 stdin、看到串接符號就 exit 2。
  const real = hookAt(
    "real.js",
    `let raw = "";
process.stdin.on("data", (c) => { raw += c; });
process.stdin.on("end", () => {
  const cmd = JSON.parse(raw).tool_input.command;
  if (/&&|\\|\\||;/.test(cmd)) { process.stderr.write("擋下"); process.exit(2); }
  process.exit(0);
});`,
  );

  const blocked = await probeHook(real, "echo a && echo b");
  assert.equal(blocked.exitCode, 2);
  assert.equal(blocked.stderr, "擋下");
  ok("串接指令餵進去會拿到 exit 2 與訊息");

  const allowed = await probeHook(real, "echo hi");
  assert.equal(allowed.exitCode, 0);
  ok("單一指令餵進去會放行");

  // 這是關鍵情境：檔案在、也註冊了，但實際上什麼都不做。
  // 只看「檔案存不存在」的檢查會誤判成裝好了。
  const neutered = hookAt("neutered.js", "process.exit(0)\n");
  assert.equal((await probeHook(neutered, "echo a && echo b")).exitCode, 0);
  ok("失效的 hook 會回 exit 0——檢查據此判定「沒擋下來」");

  // 檔案根本不在時不能整個爆掉，要回一個能判讀的結果。
  const missing = await probeHook(path.join(dir, "不存在.js"), "echo a && echo b");
  assert.notEqual(missing.exitCode, 2);
  ok("hook 檔案不存在時不會爆掉，也不會誤判成有擋");

  // Windows 上嚮導的 PATH 未必看得到 Git Bash，但機器上幾乎一定有它——Claude Code
  // 本來就要。找得到就用絕對路徑，別把一句學生修不了的 ENOENT 丟到畫面上。
  assert.equal(resolveBash(() => true, "darwin"), "bash");
  assert.equal(
    resolveBash((p) => p.endsWith("/Git/bin/bash.exe"), "win32").endsWith(
      "/Git/bin/bash.exe",
    ),
    true,
  );
  assert.equal(resolveBash(() => false, "win32"), "bash");
  ok("Windows 上會去常見位置找 Git Bash，找不到才退回 PATH");

  const tabStep = describeStep("tab-sync", {
    lang: "zh-TW",
    home: dir,
    platform: "linux",
  });
  mkdirSync(path.dirname(tabStep.target), { recursive: true });
  writeFileSync(tabStep.target, "watcher");
  // 標題是文案，會跟著改。這裡要驗的是「檢查結果對不對」，所以照 step 自己的
  // label 比，不要把當下的字釘進測試。
  assert.deepEqual(await checkTabSync(tabStep, MATERIALS), {
    id: "tab-sync",
    label: tabStep.label,
    status: "warn",
    detail: "檔案在，但 shell function 沒寫進去",
  });
  writeFileSync(
    tabStep.rcTarget,
    upsertBlock("", tabStep.rcMarker, tabStep.rcBlock),
  );
  // 這裡的 watcher 還是那個假的 "watcher" 字串——內容跟 materials 不同，
  // 舊版就長這樣：檔案在、標記在，但標題不會變。
  const staleWatcher = await checkTabSync(tabStep, MATERIALS);
  assert.equal(staleWatcher.status, "warn");
  assert.match(staleWatcher.detail, /舊版/);
  ok("watcher 是舊版時不給綠燈——只看檔案在不在會漏掉");

  // protectExisting 的列不能用逐字相同當作完成：那些檔案的正常狀態就是「工作坊的
  // 內容 + 學生自己的內容」。實測踩到——學生按了「用 AI 合併」，工作坊那段確實整段
  // 併進去了，列上還是寫「需要合併」，再按幾次都一樣，那張卡永遠完成不了。
  const codexStep = describeStep("codex-config", {
    lang: "zh-TW",
    home: dir,
    platform: "linux",
  });
  const template = readFileSync(
    path.join(MATERIALS, codexStep.source),
    "utf8",
  );
  mkdirSync(path.dirname(codexStep.target), { recursive: true });

  writeFileSync(codexStep.target, 'personality = "friendly"\n');
  const needsMerge = await checkCopyStep(MATERIALS, codexStep);
  assert.equal(needsMerge.status, "warn");
  assert.equal(needsMerge.needsMerge, true);
  ok("只有自己的內容、沒有工作坊那段時要求合併");

  // 併過之後：工作坊那段整段在，後面接著學生自己的 section。
  writeFileSync(
    codexStep.target,
    `${template}\n[projects."C:/x"]\ntrust_level = "trusted"\n\n[windows]\nsandbox = "elevated"\n`,
  );
  const mergedRow = await checkCopyStep(MATERIALS, codexStep);
  assert.equal(mergedRow.status, "ok");
  assert.equal(mergedRow.needsMerge, undefined);
  assert.match(mergedRow.detail, /你自己的內容也還在/);
  ok("併過工作坊設定、又有自己的區塊時算完成，不再要求重複合併");

  // 「用 AI 合併」那條路最容易壞的地方：整段內容都併進去了（所以檔案層算完成），
  // 但被放在某個 [section] 後面——TOML 的最上層到第一個 [section] 為止，於是那三個
  // key 變成那個 section 底下的設定，Codex 讀不到，行為完全沒變。
  //
  // 這正是模式檢查存在的理由：檔案層看得到「工作坊那段在裡面」，看不到「它有沒有
  // 站在對的位置」。
  writeFileSync(
    codexStep.target,
    `[mcp_servers.foo]\ncommand = "x"\n\n${template}`,
  );
  const nested = await checkCopyStep(MATERIALS, codexStep);
  assert.equal(nested.status, "warn");
  assert.match(nested.detail, /approvals_reviewer/);
  ok("工作坊那段被塞進 [section] 底下時不給綠燈——模式其實沒生效");

  // 三個 key 都在最上層、其中一個是學生自己的值（工作坊那段被 AI 併到後面的
  // section 裡）。這時不能叫他重裝——安裝那條刻意不覆蓋他設過的值，按了不會有事
  // 發生。話要講成「你自己設過 X」，跟上一條的「少了 X，重跑安裝就會補上」分開。
  writeFileSync(
    codexStep.target,
    [
      'default_permissions = ":workspace"',
      'approval_policy = "untrusted"',
      'approvals_reviewer = "auto_review"',
      "",
      "[mcp_servers.foo]",
      'command = "x"',
      "",
      template,
    ].join("\n"),
  );
  const studentChanged = await checkCopyStep(MATERIALS, codexStep);
  assert.equal(studentChanged.status, "warn");
  assert.match(studentChanged.detail, /你自己設過/);
  assert.match(studentChanged.detail, /untrusted/);
  ok("學生自己改過模式時說得出他設的是什麼，不會被講成沒裝");

  // 迴歸（Windows VM 實測）：已經裝過的機器上舊的 sandbox_mode 還留著，它跟
  // default_permissions 不能並存——新的那個就算值是對的也沒生效，權限選單停在
  // Read Only。三個新 key 全對也不能給綠燈。
  writeFileSync(
    codexStep.target,
    `sandbox_mode = "workspace-write"\n${template}`,
  );
  const staleKey = await checkCopyStep(MATERIALS, codexStep);
  assert.equal(staleKey.status, "warn");
  assert.match(staleKey.detail, /sandbox_mode/);
  assert.match(staleKey.detail, /重跑安裝/);
  ok("舊的 sandbox_mode 還在時不給綠燈——它會讓新設定失效");

  // 少了其中一行就不算——併一半跟沒併一樣會壞。
  writeFileSync(
    codexStep.target,
    template.replace(/^approval_policy.*$/m, ""),
  );
  assert.equal((await checkCopyStep(MATERIALS, codexStep)).status, "warn");
  ok("工作坊那段少一行就不算併好");

  // Markdown 的 # 是標題不是註解，不能跟 TOML 一樣丟掉——丟了的話學生把整份章節
  // 標題砍光也會被判成併好。AGENTS.md 也是 protectExisting（學生會往裡面加規則）。
  const agentsStep = describeStep("codex-agents", {
    lang: "zh-TW",
    home: dir,
    platform: "linux",
  });
  const agentsTpl = readFileSync(path.join(MATERIALS, agentsStep.source), "utf8");
  mkdirSync(path.dirname(agentsStep.target), { recursive: true });
  writeFileSync(agentsStep.target, `${agentsTpl}\n## 我自己的規則\n- 一律用繁體\n`);
  assert.equal((await checkCopyStep(MATERIALS, agentsStep)).status, "ok");

  const firstHeading = agentsTpl
    .split("\n")
    .find((line) => line.trim().startsWith("#"));
  writeFileSync(agentsStep.target, agentsTpl.replace(firstHeading, ""));
  assert.equal((await checkCopyStep(MATERIALS, agentsStep)).status, "warn");
  ok("AGENTS.md 也受保護，且 Markdown 標題算實質內容");

  installFrom(tabStep.watcherSource, tabStep.target);
  assert.equal((await checkTabSync(tabStep, MATERIALS)).status, "ok");
  ok("tab sync 要 watcher 內容與 rc 區塊都是這一版才算生效");

  const agentStep = describeStep("claude-namer", {
    lang: "zh-TW",
    home: dir,
    platform: "linux",
  });
  for (const file of agentStep.hookFiles) {
    installFrom(file.source, file.target);
  }
  assert.deepEqual(await checkAgentHooks(agentStep, MATERIALS), {
    id: "claude-namer",
    label: agentStep.label,
    status: "warn",
    detail: "檔案在，但沒註冊——不會被觸發",
  });
  const settings = mergeAgentHookRegistrations(
    {},
    {
      registrations: agentStep.registrations,
      hookMarkers: agentStep.hookFiles.map((file) => file.base),
    },
  );
  writeFileSync(agentStep.settingsTarget, JSON.stringify(settings));

  // 迴歸：白名單也要算進去。少了它模型每次命名都被權限層擋下，功能是死的；
  // 只驗檔案與註冊的話會給假綠燈，而綠燈就沒有安裝按鈕，學生連重跑都做不到。
  const withoutRule = await checkAgentHooks(agentStep, MATERIALS);
  assert.equal(withoutRule.status, "warn");
  assert.match(withoutRule.detail, /白名單/);
  ok("命名指令沒進白名單時不給綠燈");

  writeFileSync(
    agentStep.settingsTarget,
    JSON.stringify({
      ...settings,
      permissions: { allow: [agentStep.namingAllowRule] },
    }),
  );
  assert.equal((await checkAgentHooks(agentStep, MATERIALS)).status, "ok");
  ok("檔案、註冊、白名單三者都在才算生效");

  // 舊版 hook 檔案：三項全綠，但模型每次命名還是會被權限層擋下。
  writeFileSync(agentStep.hookFiles[0].target, "舊版內容");
  const staleHook = await checkAgentHooks(agentStep, MATERIALS);
  assert.equal(staleHook.status, "warn");
  assert.match(staleHook.detail, /舊版/);
  ok("hook 檔案是舊版時不給綠燈——註冊與白名單都對也一樣");

  // 清單第一格「程式那半驗過了嗎」只認 behavior 那一筆。所以一列如果要學生用眼睛
  // 確認，就必須同時有程式驗得到的那半，否則第一格永遠空著、學生的 2/2 湊不齊。
  for (const [id, spec] of Object.entries(VERIFICATION)) {
    if (spec?.eye == null) continue;
    assert(
      spec.terminal != null || spec.behavior != null,
      `${id} 有眼睛確認項卻沒有程式驗證那半——清單第一格會永遠勾不起來`,
    );
  }
  ok("每個要用眼睛確認的檢查都有程式驗證那半");

  // 反過來的那半條規則：程式驗得到就不該再問學生，程式驗不到的才配一格眼睛。
  //
  // 這條沒辦法自動判斷（「程式驗不驗得到」不是資料裡的欄位），所以改成把名單釘住：
  // 加一格或拿掉一格都會在這裡紅，逼人回來說明理由。每一格眼睛驗的都是嚮導這端看
  // 不到的東西——另一個終端視窗的分頁標題、瀏覽器裡長出來的網頁、跳出來的選單。
  const EYE_CHECKS = [
    "tab-sync",
    // HUD 只在「下一次互動之後」才畫出來——設定檔全對，畫面上仍可能是空的。
    "claude-hud",
    "claude-namer",
    // 底部狀態列：設定檔寫對了但 Codex 沒重開，那條還是舊的，而檔案比對一路都綠。
    "codex-config",
    "codex-namer",
    "skill-claude-auto-rename",
    "skill-codex-auto-rename",
    "skill-claude-handoff",
    "skill-codex-handoff",
    "skill-claude-structured-questions",
    "skill-codex-structured-questions",
    "demo-claude",
    "demo-codex",
    // 設定寫對了不代表 Obsidian 真的會自己拉——那要有人把 app 打開看左邊那排。
    "obsidian-vault",
    // 證據在 GitHub 上，不在這台機器上——嚮導看不到學生的瀏覽器。
    "vault-agent-claude",
    "vault-agent-codex",
  ];
  assert.deepEqual(
    Object.entries(VERIFICATION)
      .filter(([, spec]) => spec?.eye != null)
      .map(([id]) => id)
      .sort(),
    [...EYE_CHECKS].sort(),
    "眼睛項的名單變了——程式驗得到就不該問學生，改動要說得出理由",
  );
  ok("眼睛項的名單釘住：程式驗得到的不問學生");

  // Windows 的狀態列升級路徑。舊版把整段 PowerShell 塞進 settings.json 當一行指令，
  // 那一行裡也有 claude-hud 字樣——只認字樣的話，已經裝過舊版的機器永遠是綠的、沒有
  // 安裝鍵，狀態列卻永遠不出現（Windows VM 實測，又一個假綠燈）。
  const ps1 = path.join(dir, "statusline.ps1");
  writeFileSync(ps1, "# statusline\n");
  const oldStyle =
    "powershell -NoProfile -Command \"& { $dir = Get-ChildItem " +
    "'.claude\\plugins\\cache\\*\\claude-hud\\*' }\"";
  assert.equal(wiredToScript(oldStyle, ps1), false, "舊的一行寫法不算接上");
  assert.equal(
    wiredToScript(`powershell -NoProfile -File "${ps1}"`, ps1),
    true,
    "指到那支腳本才算接上",
  );
  // 反斜線／大小寫都不算數：settings.json 裡是反斜線，而 Windows 的路徑不分大小寫。
  assert.equal(
    wiredToScript(
      `powershell -File "${ps1.replaceAll("/", "\\").toUpperCase()}"`,
      ps1,
    ),
    true,
    "斜線方向與大小寫要正規化後再比",
  );
  // 指到一個不存在的檔案，跟沒接上是同一件事。
  assert.equal(
    wiredToScript(
      `powershell -File "${path.join(dir, "gone.ps1")}"`,
      path.join(dir, "gone.ps1"),
    ),
    false,
    "腳本檔不在就不算接上",
  );
  // mac 沒有腳本檔，那一列本來就是一行指令，一律當通過。
  assert.equal(wiredToScript("bash -c '...'", null), true, "mac 不受這條限制");
  ok("Windows 的狀態列必須指到落地的 .ps1，舊的一行寫法會被判成要重裝");

  // 上過舊一輪工作坊的機器上，改名或停發的 skill 會留在那裡——skill 是覆蓋不刪除的，
  // 而 Claude 照樣會載入它。hook 註冊、rc 區塊、Codex 的舊 key 都有主動清理，skill 沒有。
  const skillRoot = path.join(dir, "skills");
  const claudeSkills = path.join(skillRoot, ".claude", "skills");
  mkdirSync(path.join(claudeSkills, "handoff"), { recursive: true });
  writeFileSync(path.join(claudeSkills, "handoff", "SKILL.md"), "# 這一輪有發\n");
  mkdirSync(path.join(claudeSkills, "old-namer"), { recursive: true });
  writeFileSync(path.join(claudeSkills, "old-namer", "SKILL.md"), "# 上一輪的\n");
  // `_shared` 那種底線開頭的是附屬檔案的家，不是一個 skill。
  mkdirSync(path.join(claudeSkills, "_shared"), { recursive: true });
  writeFileSync(path.join(claudeSkills, "_shared", "SKILL.md"), "# 不算\n");
  // 沒有 SKILL.md 的資料夾不算——別把學生隨手放的東西講成殘留。
  mkdirSync(path.join(claudeSkills, "notes"), { recursive: true });

  const strays = straySkillDirs([
    {
      kind: "skill",
      files: [{ target: `${claudeSkills}/handoff/SKILL.md`.replaceAll("\\", "/") }],
    },
  ]);
  assert.deepEqual(
    strays.map((stray) => stray.name),
    ["old-namer"],
  );
  ok("掃得出上一輪留下的 skill，_shared 與沒有 SKILL.md 的資料夾不算");

  // 學生只選了 Claude 時，~/.agents/skills 底下那些 codex skill 不該被講成多餘的
  // ——那個根目錄這一輪根本沒有步驟指過去。
  const codexSkills = path.join(skillRoot, ".agents", "skills");
  mkdirSync(path.join(codexSkills, "handoff"), { recursive: true });
  writeFileSync(path.join(codexSkills, "handoff", "SKILL.md"), "# codex 的\n");
  assert.equal(
    straySkillDirs([
      {
        kind: "skill",
        files: [
          { target: `${claudeSkills}/handoff/SKILL.md`.replaceAll("\\", "/") },
        ],
      },
    ]).some((stray) => stray.path.includes(".agents")),
    false,
    "沒有步驟指過去的根目錄不掃",
  );
  ok("只掃這一輪真的有步驟指過去的 skills 根目錄");

  // 白名單是這條規則唯一的例外，而且是刻意的（Reed 拍板拿掉那格眼睛）。
  //
  // 程式抓得到「指令真的跑起來了」，抓不到「有沒有先跳一個詢問」——學生按了允許的
  // 話指令一樣會跑。所以按上面那條規則它「應該」要有一格眼睛。拿掉的理由是行為驗證
  // 的題目本來就要模型自己回報一次，兩邊在問學生同一件事。
  //
  // 代價寫在這裡而不是只寫在註解裡：這一格的正面判定現在完全靠模型自我回報，沒有
  // 第二道人眼把關。哪天有人「順手補回來」，先看懂這段再決定。
  assert.equal(
    VERIFICATION.allowlist.eye,
    undefined,
    "白名單那格的眼睛是刻意拿掉的，補回去之前先讀這段註解",
  );
  assert(VERIFICATION.allowlist.terminal != null);
  ok("白名單是眼睛項規則的唯一例外，而且是刻意的");
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
