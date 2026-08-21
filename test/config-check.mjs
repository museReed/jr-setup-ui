import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import {
  VERIFICATION,
  checkAgentHooks,
  checkAllowlist,
  checkCopyStep,
  checkRetired,
  checkTabSync,
  missingSourceLines,
  probeHook,
  resolveBash,
  withActions as withConfigActions,
  wiredToScript,
} from "../src/config-check.js";
import {
  describeStep,
  expandAllowRules,
  mergeAgentHookRegistrations,
  transformStepSource,
  upsertBlock,
} from "../src/config-install.js";
import { materialsDir } from "../src/paths.js";

const MATERIALS = materialsDir();

for (const id of ["codex-config", "codex-namer"]) {
  const posix = withConfigActions({ id, status: "ok" }, "darwin");
  const windows = withConfigActions({ id, status: "ok" }, "win32");
  assert.match(posix.eyeCheck, /app-server|原生/);
  assert.match(windows.eyeCheck, /app-server|原生/);
  assert.doesNotMatch(windows.eyeCheck, /SQLite|tab-sync/);
}
ok("Codex config 與 namer 在 POSIX／Windows 都驗證原生 app-server 路徑");

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

  // POSIX 這一步只剩 rc 區塊：watcher 拿掉之後沒有檔案要裝，所以「沒裝」的唯一
  // 判準就是 rc 檔裡沒有那個區塊。
  const tabStep = describeStep("tab-sync", {
    lang: "zh-TW",
    home: dir,
    platform: "linux",
  });
  assert.equal(tabStep.target, undefined);
  // 標題是文案，會跟著改。這裡要驗的是「檢查結果對不對」，所以照 step 自己的
  // label 比，不要把當下的字釘進測試。
  assert.deepEqual(await checkTabSync(tabStep, MATERIALS), {
    id: "tab-sync",
    label: tabStep.label,
    status: "missing",
    detail: "尚未安裝",
  });
  ok("POSIX 沒有 rc 區塊時回報尚未安裝，不會因為缺檔案而爆掉");

  // 舊版的區塊：標記在、函式也在，但它會起 watcher 每秒重寫標題——只看「標記在
  // 不在」會給綠燈，於是學生留著舊行為卻以為已經更新（看背景 agent 時標題照閃）。
  writeFileSync(
    tabStep.rcTarget,
    upsertBlock(
      "",
      tabStep.rcMarker,
      'claude() {\n  AI_TAB_SYNC_FILE=/tmp/x command claude "$@"\n}',
    ),
  );
  const staleBlock = await checkTabSync(tabStep, MATERIALS);
  assert.equal(staleBlock.status, "warn");
  assert.match(staleBlock.detail, /舊版/);
  ok("rc 區塊是舊版（還在起 watcher）時不給綠燈");

  writeFileSync(
    tabStep.rcTarget,
    upsertBlock("", tabStep.rcMarker, tabStep.rcBlock),
  );
  const freshBlock = await checkTabSync(tabStep, MATERIALS);
  assert.equal(freshBlock.status, "ok");
  ok("rc 區塊是新版時給綠燈");

  // Windows 那條路沒有跟著改：仍然要有 watcher 檔，而且內容要跟 materials 一致。
  const winTabStep = describeStep("tab-sync", {
    lang: "zh-TW",
    home: dir,
    platform: "win32",
  });
  assert.notEqual(winTabStep.target, undefined);
  assert.deepEqual(await checkTabSync(winTabStep, MATERIALS), {
    id: "tab-sync",
    label: winTabStep.label,
    status: "missing",
    detail: "尚未安裝",
  });
  mkdirSync(path.dirname(winTabStep.target), { recursive: true });
  writeFileSync(winTabStep.target, "watcher");
  const winStale = await checkTabSync(winTabStep, MATERIALS);
  assert.equal(winStale.status, "warn");
  ok("Windows 仍然檢查 watcher 檔在不在、是不是舊版");

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

  const wrongStatusSection = [
    template.replace("[tui]", "[profiles.wrong]"),
    "[tui]",
    'status_line = ["context-used"]',
    'terminal_title = ["thread"]',
    "",
  ].join("\n");
  writeFileSync(codexStep.target, wrongStatusSection);
  const misplacedStatus = await checkCopyStep(MATERIALS, codexStep);
  assert.equal(misplacedStatus.status, "warn");
  assert.match(misplacedStatus.detail, /status_line.*thread-title/);
  ok("thread-title 只出現在其他 section 時不給綠燈");

  const wrongTerminalArray = [
    template.replace("[tui]", "[profiles.wrong]"),
    "[tui]",
    'status_line = ["thread-title", "context-used"]',
    'terminal_title = ["thread", "model"]',
    "",
  ].join("\n");
  writeFileSync(codexStep.target, wrongTerminalArray);
  const wrongTerminal = await checkCopyStep(MATERIALS, codexStep);
  assert.equal(wrongTerminal.status, "warn");
  assert.match(wrongTerminal.detail, /terminal_title.*\["thread"\]/);
  ok("[tui] terminal_title 是錯誤 array 時不給綠燈");

  const windowsCodexStep = describeStep("codex-config", {
    lang: "zh-TW",
    home: path.join(dir, "windows"),
    platform: "win32",
  });
  mkdirSync(path.dirname(windowsCodexStep.target), { recursive: true });
  const windowsTemplate = transformStepSource(template, windowsCodexStep);
  writeFileSync(windowsCodexStep.target, windowsTemplate);
  assert.equal((await checkCopyStep(MATERIALS, windowsCodexStep)).status, "ok");
  assert.match(windowsTemplate, /"thread-title"/);
  assert.match(windowsTemplate, /^terminal_title\s*=\s*\["thread"\]/m);
  ok("Windows config 也要求原生 thread-title 與 terminal_title");

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
  // ⚠️ 文案要指得到畫面上真的存在的那顆按鈕。原本寫「重跑安裝」，但那顆在畫面上叫
  // 「安裝」或「重裝」（看狀態）——三個名字講同一顆，學生要自己配對（Reed 在畫面前
  // 問「裡面講的重新安裝的 button 在哪邊」）。
  assert.match(staleKey.detail, /按這一列的安裝鍵/);
  assert.ok(!staleKey.detail.includes("重跑安裝"));
  ok("舊的 sandbox_mode 還在時不給綠燈，而且說明指得到真的存在的那顆按鈕");

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

  installFrom(winTabStep.watcherSource, winTabStep.target);
  mkdirSync(path.dirname(winTabStep.rcTarget), { recursive: true });
  writeFileSync(
    winTabStep.rcTarget,
    upsertBlock("", winTabStep.rcMarker, winTabStep.rcBlock),
  );
  assert.equal((await checkTabSync(winTabStep, MATERIALS)).status, "ok");
  ok("Windows 的 tab sync 要 watcher 內容與 rc 區塊都是這一版才算生效");

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

  const windowsAgentStep = describeStep("codex-namer", {
    lang: "zh-TW",
    home: path.join(dir, "windows-agent"),
    platform: "win32",
  });
  for (const file of windowsAgentStep.hookFiles) {
    installFrom(file.source, file.target);
  }
  const windowsSettings = mergeAgentHookRegistrations(
    {},
    {
      registrations: windowsAgentStep.registrations,
      hookMarkers: windowsAgentStep.hookFiles.map((file) => file.base),
    },
  );
  mkdirSync(path.dirname(windowsAgentStep.settingsTarget), { recursive: true });
  writeFileSync(windowsAgentStep.settingsTarget, JSON.stringify(windowsSettings));
  const missingProfile = await checkAgentHooks(windowsAgentStep, MATERIALS);
  assert.equal(missingProfile.status, "warn");
  assert.match(missingProfile.detail, /PowerShell profile/);
  mkdirSync(path.dirname(windowsAgentStep.windowsCodexProfile.target), {
    recursive: true,
  });
  writeFileSync(
    windowsAgentStep.windowsCodexProfile.target,
    upsertBlock(
      "",
      windowsAgentStep.windowsCodexProfile.marker,
      windowsAgentStep.windowsCodexProfile.block,
    ),
  );
  assert.equal(
    (await checkAgentHooks(windowsAgentStep, MATERIALS)).status,
    "ok",
  );
  ok("Windows Codex 命名要有共用 app-server profile 才給綠燈");

  const macAgentStep = describeStep("codex-namer", {
    lang: "zh-TW",
    home: path.join(dir, "mac-agent"),
    platform: "darwin",
  });
  for (const file of macAgentStep.hookFiles) {
    installFrom(file.source, file.target);
  }
  const macSettings = mergeAgentHookRegistrations(
    {},
    {
      registrations: macAgentStep.registrations,
      hookMarkers: macAgentStep.hookFiles.map((file) => file.base),
    },
  );
  mkdirSync(path.dirname(macAgentStep.settingsTarget), { recursive: true });
  writeFileSync(macAgentStep.settingsTarget, JSON.stringify(macSettings));
  const missingMacProfile = await checkAgentHooks(macAgentStep, MATERIALS);
  assert.equal(missingMacProfile.status, "warn");
  assert.match(missingMacProfile.detail, /shell profile/);
  writeFileSync(
    macAgentStep.posixCodexProfile.target,
    upsertBlock(
      "",
      macAgentStep.posixCodexProfile.marker,
      macAgentStep.posixCodexProfile.block,
    ),
  );
  assert.equal((await checkAgentHooks(macAgentStep, MATERIALS)).status, "ok");
  ok("macOS Codex 命名要有 core daemon profile 才給綠燈");

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

  // ⚠️ 這一支是合併的完成判準——`scripts/merge-in-terminal.mjs` 就是等它變成空陣列。
  // 兩邊共用同一支，不各寫一份：各寫一份的結果會是「終端說完成、卡片說需要合併」。
  const missDir = mkdtempSync(path.join(tmpdir(), "jr-miss-"));
  const sourceRel = "jr-test-source.md";
  writeFileSync(
    path.join(MATERIALS, sourceRel),
    "# 工作坊\n\n第一條規則\n第二條規則\n",
  );
  const targetPath = path.join(missDir, "mine.md");
  const step = { source: sourceRel, target: targetPath };

  try {
    // 目標還不存在＝還沒得比。那是「安裝」要做的事，不是合併——回 null 不是回 []，
    // 不然合併腳本會把「檔案根本不在」判成「已經併好了」。
    assert.equal(await missingSourceLines(MATERIALS, step), null);

    // 學生自己的內容原封不動、工作坊那段一行都沒進去。
    writeFileSync(targetPath, "# 我自己的規則\n一律用繁體中文\n");
    assert.deepEqual(await missingSourceLines(MATERIALS, step), [
      "# 工作坊",
      "第一條規則",
      "第二條規則",
    ]);

    // 潤飾掉一行就會被抓出來——那正是這一步最常見的壞法（真機撞過，AI 說合併完成、
    // 實際差 17 行）。回傳的是「還缺哪幾行」，逾時訊息才印得出可以貼回去的東西。
    writeFileSync(
      targetPath,
      "# 我自己的規則\n一律用繁體中文\n\n---\n\n# 工作坊\n\n第一條規則\n",
    );
    assert.deepEqual(await missingSourceLines(MATERIALS, step), ["第二條規則"]);

    // 學生自己的東西留著也不影響——只問「工作坊那段在不在」，不問「有沒有多」。
    writeFileSync(
      targetPath,
      "# 我自己的規則\n一律用繁體中文\n\n---\n\n# 工作坊\n\n第一條規則\n第二條規則\n",
    );
    assert.deepEqual(await missingSourceLines(MATERIALS, step), []);
    ok("合併的完成判準回「還缺哪幾行」，學生自己的內容不影響判定");

    // ⚠️ 迴歸（學員回報 jr-setup-feedback#4，2026-08-15）：白名單規則齊了、但學生
    // 自己把 defaultMode 設成別的值時，這一列**不可以判黃燈**。
    //
    // 判黃燈的連鎖反應：黃燈 → 「驗證：…」那一格永遠打不了勾（systemRowChecked 的
    // 第二條要求這一列 status === "ok"）→ 行為驗證明明 PASS 了，畫面還寫著「還沒
    // 實際跑跑看」→ 整張卡永遠完成不了。而旁邊那顆安裝鍵按下去也不會有事：安裝
    // 刻意尊重他的選擇、不覆蓋。
    //
    // 他設 auto 是合法的選擇，不是壞掉。
    const allowStep = describeStep("allowlist", {
      lang: "zh-TW",
      home: missDir,
      platform: "darwin",
    });
    const allowlistSource = JSON.parse(
      readFileSync(path.join(MATERIALS, allowStep.source), "utf8"),
    );
    mkdirSync(path.dirname(allowStep.settingsTarget), { recursive: true });
    // ⚠️ 規則要照 expandAllowRules 展開過再寫進去（有一條帶家目錄路徑）。直接寫
    // 原始那份的話會少一條，變成「38 / 39 條」——那是另一種黃燈，測不到這一條。
    const writeSettings = (defaultMode) =>
      writeFileSync(
        allowStep.settingsTarget,
        JSON.stringify({
          permissions: {
            ...allowlistSource.permissions,
            allow: expandAllowRules(allowlistSource.permissions.allow, homedir()),
            ...(defaultMode === null ? {} : { defaultMode }),
          },
        }),
      );

    // auto 現在是我們自己寫進去的值，所以是正常的綠燈。
    writeSettings("auto");
    const expected = await checkAllowlist(MATERIALS, allowStep);
    assert.equal(expected.status, "ok", expected.detail);

    // 學生自己挑了別的模式：仍然是綠燈，說明講清楚跟我們預期的不同。
    writeSettings("plan");
    const studentChose = await checkAllowlist(MATERIALS, allowStep);
    assert.equal(studentChose.status, "ok", studentChose.detail);
    assert.match(studentChose.detail, /你自己設的 plan/);

    // 但「根本沒設」仍然是黃燈——那一種重跑安裝真的會補上，按鈕有用。
    writeSettings(null);
    const notSet = await checkAllowlist(MATERIALS, allowStep);
    assert.equal(notSet.status, "warn");
    assert.match(notSet.detail, /重跑安裝/);
    assert.ok(notSet.detail.length <= 40, notSet.detail);

    // 上一輪嚮導寫進去的 acceptEdits 也是黃燈，同一個理由：重跑安裝會把它換掉。
    // 判成綠燈的話已經裝過的人永遠停在舊模式，畫面上還沒有任何按鈕可按。
    writeSettings("acceptEdits");
    const superseded = await checkAllowlist(MATERIALS, allowStep);
    assert.equal(superseded.status, "warn", superseded.detail);
    assert.match(superseded.detail, /換成 auto/);
    assert.ok(superseded.detail.length <= 40, superseded.detail);
    ok("預設模式：auto 綠、學生自選綠、沒設與上一輪的 acceptEdits 都是黃燈");
  } finally {
    rmSync(path.join(MATERIALS, sourceRel), { force: true });
    rmSync(missDir, { recursive: true, force: true });
  }

  // 退役那一列的三態。
  //
  // ⚠️ 第三態（移除完了還留著打勾）是 Reed 實測指出的：判準本來只有「還有沒有
  // 殘留」，於是學生按下移除的當下整張卡就消失了。他不會覺得做完了，他會覺得自己
  // 剛剛弄壞了什麼。leftovers.js 的隔離區那一列早就寫過同一條。
  const retireDir = path.join(tmpdir(), `jr-retire-${process.pid}`);

  try {
    const retireStep = describeStep("hook", {
      lang: "zh-TW",
      home: retireDir,
      platform: "darwin",
    });

    // ① 沒裝過：整列不出現。新學生不該看到一列「已移除你沒裝過的東西」。
    assert.equal(await checkRetired(retireStep, []), null);

    // ② 有殘留：黃燈，按鈕的字是「移除」不是「安裝」——它做的事正好相反。
    mkdirSync(path.dirname(retireStep.files[0]), { recursive: true });
    writeFileSync(retireStep.files[0], "// 舊的\n");
    const leftover = await checkRetired(retireStep, []);
    assert.equal(leftover.status, "warn");
    assert.equal(leftover.installLabel, "移除");
    assert.equal(leftover.retired, true);

    // 只剩註冊、檔案已經被學生自己刪掉，也要算殘留：那條註冊指向一個不存在的
    // 檔案，每次事件失敗一次，而畫面上看不出來。
    rmSync(retireStep.files[0], { force: true });
    mkdirSync(path.dirname(retireStep.settingsTarget), { recursive: true });
    writeFileSync(
      retireStep.settingsTarget,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [{ type: "command", command: "node /x/block-chained-bash.js" }],
            },
          ],
        },
      }),
    );
    assert.equal((await checkRetired(retireStep, [])).status, "warn");

    // ③ 移除完了：綠燈、留在畫面上、沒有按鈕。
    rmSync(retireStep.settingsTarget, { force: true });
    const done = await checkRetired(retireStep, ["hook"]);
    assert.notEqual(done, null, "按過移除之後這一列不可以消失");
    assert.equal(done.status, "ok");
    assert.equal(done.noInstall, true, "沒有東西可裝也沒有東西可驗，按鈕要收掉");

    // 記錄只認自己那一步：別人被移除過不會讓這一列冒出來。
    assert.equal(await checkRetired(retireStep, ["codex-monitor"]), null);
    ok("退役三態：沒裝過不出現、有殘留給移除鍵、移除完留著打勾不消失");
  } finally {
    rmSync(retireDir, { recursive: true, force: true });
  }
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
