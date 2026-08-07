import assert from "node:assert/strict";

import {
  countInstalledRules,
  describeStep,
  expandAllowRules,
  findHookRegistration,
  hasAgentHookRegistrations,
  hookFileName,
  mergeAllowRules,
  mergeCodexModes,
  readCodexModes,
  readDefaultMode,
  readRetiredCodexKeys,
  mergeAgentHookRegistrations,
  mergeHookRegistration,
  stepsForTools,
} from "../src/config-install.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

const HOME = "/Users/student";
const AT = { lang: "zh-TW", home: HOME };

try {
  assert.deepEqual(stepsForTools(["claude"]), [
    "claude-md",
    "output-style",
    "hook",
    "allowlist",
    "claude-hud",
    "tab-sync",
    "claude-namer",
    "claude-monitor",
    "skill-claude-auto-rename",
    "skill-claude-handoff",
    "skill-claude-structured-questions",
    "ext-frontend-design-claude",
    "ext-skill-creator-claude",
    "ext-playwright-claude",
    "demo-claude",
    "obsidian",
    "skill-claude-vault-sync",
    "obsidian-vault",
    "vault-agent-claude",
  ]);
  assert.deepEqual(stepsForTools(["codex"]), [
    "codex-config",
    "codex-agents",
    "tab-sync",
    "codex-namer",
    "codex-monitor",
    "skill-codex-auto-rename",
    "skill-codex-handoff",
    "skill-codex-structured-questions",
    "ext-frontend-design-codex",
    "ext-playwright-codex",
    "demo-codex",
    "obsidian",
    "skill-codex-vault-sync",
    "obsidian-vault",
    "vault-agent-codex",
  ]);
  assert.deepEqual(stepsForTools(["claude", "codex"]), [
    "claude-md",
    "output-style",
    "hook",
    "allowlist",
    "claude-hud",
    "codex-config",
    "codex-agents",
    "tab-sync",
    "claude-namer",
    "claude-monitor",
    "codex-namer",
    "codex-monitor",
    "skill-claude-auto-rename",
    "skill-claude-handoff",
    "skill-claude-structured-questions",
    "skill-codex-auto-rename",
    "skill-codex-handoff",
    "skill-codex-structured-questions",
    "ext-frontend-design-claude",
    "ext-skill-creator-claude",
    "ext-playwright-claude",
    "ext-frontend-design-codex",
    "ext-playwright-codex",
    "demo-claude",
    "demo-codex",
    "obsidian",
    "skill-claude-vault-sync",
    "skill-codex-vault-sync",
    "obsidian-vault",
    "vault-agent-claude",
    "vault-agent-codex",
  ]);
  assert.throws(() => stepsForTools([]));
  assert.throws(() => stepsForTools(["vim"]));
  ok("既有規則之後才出現共用 tab sync 與各工具的 hooks");

  assert.equal(hookFileName("context-monitor", "linux"), "context-monitor.sh");
  assert.equal(hookFileName("context-monitor", "darwin"), "context-monitor.sh");
  assert.equal(hookFileName("context-monitor", "win32"), "context-monitor.ps1");
  ok("hook 副檔名會依平台選 sh 或 ps1");

  assert.equal(
    describeStep("claude-md", AT).target,
    `${HOME}/.claude/CLAUDE.md`,
  );
  assert.equal(describeStep("claude-md", AT).protectExisting, true);
  assert.equal(
    describeStep("output-style", { ...AT, lang: "en" }).source,
    "claude-code/en/output-styles/concise-structured.md",
  );
  assert.equal(describeStep("codex-config", AT).protectExisting, true);
  // 三個規則檔都是學生會往裡面加東西的：安裝直接覆蓋就弄丟了，只留一個 .bak，
  // 而學生不會知道要去翻備份。
  assert.equal(describeStep("codex-agents", AT).protectExisting, true);
  ok("每步知道自己的來源與目標，會蓋掉使用者內容的步驟有標記");

  const tabSync = describeStep("tab-sync", { ...AT, platform: "linux" });
  assert.equal(tabSync.kind, "tab-sync");
  assert.equal(tabSync.watcherSource, "skills/bin/ai-tab-sync.sh");
  assert.equal(tabSync.target, `${HOME}/.local/bin/ai-tab-sync.sh`);
  assert.equal(tabSync.rcTarget, `${HOME}/.zshrc`);
  assert.match(tabSync.rcBlock, /command claude "\$@"/);
  assert.match(tabSync.rcBlock, /command codex "\$@"/);

  const windowsTabSync = describeStep("tab-sync", {
    ...AT,
    platform: "win32",
  });
  assert.equal(windowsTabSync.watcherSource, "skills/bin/ai-tab-sync.ps1");
  assert.equal(windowsTabSync.target, `${HOME}/.jr-setup/bin/ai-tab-sync.ps1`);
  assert.match(windowsTabSync.rcBlock, /Get-Command claude -CommandType Application/);
  ok("tab sync 會描述 watcher、rc 檔與跳過函式的真正指令");

  // watcher 用 [Console]::Title 改標題，那個 API 只作用在自己所在的 console。
  // -WindowStyle Hidden 會開一個新的 console，watcher 就改到自己的標題、碰不到
  // 學生的分頁——全綠但標題不動（VM 實測）。共用 console 的是 -NoNewWindow。
  assert(
    !windowsTabSync.rcBlock.includes("-WindowStyle Hidden"),
    "watcher 不能用 -WindowStyle Hidden 起，那會開新的 console",
  );
  assert.match(windowsTabSync.rcBlock, /-NoNewWindow/);
  ok("Windows watcher 用 -NoNewWindow 起，跟終端共用同一個 console");

  // Windows 的狀態列不能是 settings.json 裡的一行 powershell -Command：那一段含單
  // 引號、$ 變數與一個帶空白的 node 路徑，Claude Code 會把整條交給 cmd.exe 再解析
  // 一次，引號打架就整條不啟動，而且失敗是安靜的（VM 實測：狀態列不出現、沒錯誤）。
  // 所以要落地成一支 .ps1，settings.json 只留 -File 加路徑。
  const hudWin = describeStep("claude-hud", { ...AT, platform: "win32" });
  assert.equal(
    hudWin.commandTemplate,
    "claude-code/claude-hud/statusline.ps1.template",
  );
  assert.equal(
    hudWin.scriptTarget,
    `${HOME}/.claude/plugins/claude-hud/statusline.ps1`,
  );
  const hudMac = describeStep("claude-hud", { ...AT, platform: "darwin" });
  assert.equal(hudMac.scriptTarget, null, "mac 那條照舊直接寫進 settings.json");
  ok("Windows 的狀態列落地成一支 .ps1，mac 維持一行指令");

  const claudeHooks = describeStep("claude-namer", { ...AT, platform: "linux" });
  const claudeMonitor = describeStep("claude-monitor", {
    ...AT,
    platform: "linux",
  });
  const codexHooks = describeStep("codex-namer", { ...AT, platform: "win32" });
  const codexMonitor = describeStep("codex-monitor", {
    ...AT,
    platform: "win32",
  });

  // 命名 hook：兩支檔案（寫入腳本 + namer），兩筆註冊（工具跑完 + 送出訊息）。
  assert.equal(claudeHooks.hookFiles.length, 2);
  assert.equal(claudeHooks.registrations.length, 2);
  assert.equal(claudeHooks.settingsTarget, `${HOME}/.claude/settings.json`);
  assert(claudeHooks.namingAllowRule !== undefined);

  // 監控 hook：一支檔案、一筆註冊，而且不需要白名單——它不叫模型執行任何東西。
  assert.equal(claudeMonitor.hookFiles.length, 1);
  assert.equal(claudeMonitor.registrations.length, 1);
  assert.equal(claudeMonitor.namingAllowRule, undefined);
  assert.equal(claudeMonitor.supportFiles.length, 1);

  assert.equal(codexHooks.settingsTarget, `${HOME}/.codex/hooks.json`);
  assert.equal(codexHooks.namingAllowRule, undefined);
  assert(codexHooks.hookFiles.every((file) => file.target.endsWith(".ps1")));
  assert.equal(codexMonitor.registrations.length, 1);
  ok("命名與監控各自帶自己的檔案與註冊，監控不需要白名單");

  // 兩列共用同一個 settings 檔，靠檔名分辨。重裝其中一列不能掃掉另一列的註冊——
  // 綁在一起時這件事不存在，拆開之後它是最容易靜默壞掉的地方。
  const markers = new Set(claudeHooks.hookFiles.map((file) => file.base));
  for (const file of claudeMonitor.hookFiles) {
    assert(
      !markers.has(file.base),
      `${file.base} 同時屬於兩列，重裝會互相掃掉註冊`,
    );
  }
  ok("命名與監控的檔名沒有交集，重裝不會互相掃掉");

  assert.throws(() => describeStep("claude-md", { ...AT, lang: "ja" }));
  assert.throws(() => describeStep("不存在的步驟", AT));
  ok("語言不支援或步驟不認得時大聲報錯");

  // 迴歸：Bash() 白名單是字面比對，不會展開 ~。
  assert.deepEqual(
    expandAllowRules(
      ["Bash(~/Projects/**)", "Bash(git status)", "Read(~/notes)"],
      HOME,
    ),
    [`Bash(${HOME}/Projects/**)`, "Bash(git status)", "Read(~/notes)"],
  );
  ok("只展開 Bash() 規則裡的 ~，其他規則原樣保留");

  const hookPath = `${HOME}/.claude/hooks/block-chained-bash.js`;
  const registered = mergeHookRegistration({}, { hookPath });
  assert.deepEqual(registered.hooks.PreToolUse, [
    {
      matcher: "Bash",
      hooks: [{ type: "command", command: `node "${hookPath}"`, timeout: 5 }],
    },
  ]);
  ok("空的 settings.json 會長出 hook 註冊，指令是 node 不是 python3");

  // Windows 路徑不處理的話，bash 會把 C:\Users\Reed 的 \U \R 當跳脫序列吃掉，
  // 路徑變成 C:UsersReed → node 找不到檔案 → exit 1 → PreToolUse 當成「hook
  // 出錯，放行」，串接指令一路暢通。這條在 macOS 上就會紅，不用等 VM。
  const windowsHook = mergeHookRegistration(
    {},
    { hookPath: "C:\\Users\\Reed/.claude/hooks/block-chained-bash.js" },
  );
  const windowsCommand = windowsHook.hooks.PreToolUse[0].hooks[0].command;
  assert(
    !windowsCommand.includes("\\"),
    `註冊指令不能留反斜線，實際是：${windowsCommand}`,
  );
  assert.equal(
    windowsCommand,
    'node "C:/Users/Reed/.claude/hooks/block-chained-bash.js"',
  );
  ok("Windows 路徑轉正斜線並加引號，bash 不會把它吃掉");

  // 重跑安裝不能疊出兩份，也不能把別人的 hook 掃掉。
  const rerun = mergeHookRegistration(registered, { hookPath });
  assert.equal(rerun.hooks.PreToolUse.length, 1);
  ok("重跑安裝是冪等的：hook 不會疊出兩份");

  const withOthers = mergeHookRegistration(
    {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "node /別人的.js" }],
          },
        ],
        Stop: [{ hooks: [{ type: "command", command: "echo bye" }] }],
      },
      model: "opus",
    },
    { hookPath },
  );
  assert.equal(withOthers.hooks.PreToolUse.length, 2);
  assert.equal(withOthers.hooks.Stop.length, 1);
  assert.equal(withOthers.model, "opus");
  ok("不動使用者原本的其他 hook 與設定");

  const agentRegistered = mergeAgentHookRegistrations(
    {
      hooks: {
        PostToolUse: [
          { hooks: [{ type: "command", command: "bash /別人的.sh" }] },
        ],
        Stop: [{ hooks: [{ type: "command", command: "echo bye" }] }],
      },
      model: "opus",
    },
    {
      registrations: claudeHooks.registrations,
      hookMarkers: claudeHooks.hookFiles.map((file) => file.base),
    },
  );
  assert.equal(hasAgentHookRegistrations(agentRegistered, claudeHooks.registrations), true);
  // 別人的那筆 + 命名 hook 的一筆
  assert.equal(agentRegistered.hooks.PostToolUse.length, 2);
  assert.equal(agentRegistered.hooks.Stop.length, 1);
  assert.equal(agentRegistered.model, "opus");

  const agentRerun = mergeAgentHookRegistrations(agentRegistered, {
    registrations: claudeHooks.registrations,
    hookMarkers: claudeHooks.hookFiles.map((file) => file.base),
  });
  assert.equal(agentRerun.hooks.PostToolUse.length, 2);
  assert.equal(agentRerun.hooks.UserPromptSubmit.length, 1);

  // 接著裝監控那列：它不能把命名那筆掃掉，兩者要並存。
  const bothInstalled = mergeAgentHookRegistrations(agentRerun, {
    registrations: claudeMonitor.registrations,
    hookMarkers: claudeMonitor.hookFiles.map((file) => file.base),
  });
  assert.equal(
    hasAgentHookRegistrations(bothInstalled, claudeHooks.registrations),
    true,
  );
  assert.equal(
    hasAgentHookRegistrations(bothInstalled, claudeMonitor.registrations),
    true,
  );
  assert.equal(bothInstalled.hooks.PostToolUse.length, 3);
  ok("命名與監控分兩次裝可重跑，彼此不覆蓋，也不動使用者原本的 hook");

  const allow = mergeAllowRules(
    { permissions: { allow: ["Bash(ls)"], deny: ["Bash(rm)"] } },
    { allowRules: ["Bash(ls)", "Bash(git status)"] },
  );
  assert.deepEqual(allow.settings.permissions.allow, [
    "Bash(ls)",
    "Bash(git status)",
  ]);
  assert.deepEqual(allow.settings.permissions.deny, ["Bash(rm)"]);
  assert.equal(allow.addedRules, 1);
  ok("白名單只補沒有的，不動 deny 清單");

  // 白名單只免掉「這條指令能不能跑」，改檔案在 default 模式下仍然每次都問——
  // 課堂上學生大半的按鍵花在那裡。兩件事湊齊才是學生預期的「不會一直被打斷」。
  assert.equal(allow.settings.permissions.defaultMode, "acceptEdits");
  assert.equal(allow.modeAdded, true);
  ok("裝白名單時一併把預設模式設成 acceptEdits");

  // 學生自己調過就尊重他的選擇，重跑安裝不該把它蓋回去。
  const kept = mergeAllowRules(
    { permissions: { defaultMode: "plan" } },
    { allowRules: ["Bash(ls)"] },
  );
  assert.equal(kept.settings.permissions.defaultMode, "plan");
  assert.equal(kept.modeAdded, false);
  ok("使用者自己設過的預設模式不會被覆蓋");

  // 驗證那半：沒設回 null，設了就回實際的值。checkAllowlist 靠這個分辨「安裝沒
  // 生效」與「學生自己調過」——兩者要做的事不一樣，不能都講成「沒裝」。
  assert.equal(readDefaultMode(allow.settings), "acceptEdits");
  assert.equal(readDefaultMode(kept.settings), "plan");
  assert.equal(readDefaultMode({}), null);
  assert.equal(readDefaultMode({ permissions: {} }), null);
  assert.equal(readDefaultMode(null), null);
  ok("readDefaultMode 分得出沒設與設成別的值");

  // Codex 的 config.toml 是 protectExisting，學生已經有檔案時「安裝」不覆蓋——
  // 但預設模式那幾個 key 不能交給 AI 合併（結果不保證也不可重現），要程式補上。
  const codexFresh = mergeCodexModes("");
  assert.deepEqual(codexFresh.added, [
    "default_permissions",
    "approval_policy",
    "approvals_reviewer",
  ]);
  // 舊的 sandbox_mode 不再用：兩者不能並存，而且只設舊 key 的話 Codex 的權限選單
  // 仍然停在 Read Only（Windows VM 實測）。
  assert.match(codexFresh.content, /default_permissions = ":workspace"/);
  assert.match(codexFresh.content, /approval_policy = "on-request"/);
  // 迴歸（VM 實測）：三個 key 都在、值也對，Codex 仍然一直問——因為 approval_policy
  // 只決定「什麼時候需要批准」，approvals_reviewer 才決定「誰來批准」。少了這一個
  // 就是預設的 "user"，也就是跳出來問學生。
  assert.match(codexFresh.content, /approvals_reviewer = "auto_review"/);
  ok("空的 config.toml 會補上三個預設模式 key");

  // 只補這兩行，其餘一個字都不動——學生原本的設定與註解要原樣留著。
  const existing = '# 我自己的設定\npersonality = "friendly"\n\n[mcp_servers.foo]\ncommand = "x"\n';
  const merged = mergeCodexModes(existing);
  assert.match(merged.content, /# 我自己的設定/);
  assert.match(merged.content, /personality = "friendly"/);
  assert.match(merged.content, /\[mcp_servers\.foo\]/);
  // 新的 key 必須插在第一個 [section] 之前，否則它會變成那個 section 底下的設定。
  assert.ok(
    merged.content.indexOf("sandbox_mode") <
      merged.content.indexOf("[mcp_servers.foo]"),
  );
  ok("既有內容原樣保留，新 key 插在第一個 [section] 之前");

  // 已經設過就不動，重跑安裝不該把學生調過的值蓋回去。
  const kept2 = mergeCodexModes('default_permissions = ":read-only"\n');
  assert.deepEqual(kept2.added, ["approval_policy", "approvals_reviewer"]);
  assert.match(kept2.content, /default_permissions = ":read-only"/);
  ok("學生自己設過的 default_permissions 不會被覆蓋");

  // 已經裝過的機器上舊 key 還在，而它跟 default_permissions 不能並存——留著的話
  // 新的那個不會生效（VM 實測：選單停在 Read Only）。所以要主動退掉。
  // 註解掉而不是刪掉：那是學生檔案裡的一行，留著看得出發生過什麼、也還原得回去。
  const upgraded = mergeCodexModes(
    'personality = "pragmatic"\nsandbox_mode = "workspace-write"\napproval_policy = "on-request"\n',
  );
  assert.deepEqual(upgraded.retired, ["sandbox_mode"]);
  assert.match(upgraded.content, /^# sandbox_mode = "workspace-write"$/m);
  assert.match(upgraded.content, /由嚮導停用/);
  assert.match(upgraded.content, /default_permissions = ":workspace"/);
  // 只退舊 key，其餘一個字都不動。
  assert.match(upgraded.content, /personality = "pragmatic"/);
  assert.deepEqual(upgraded.added, [
    "default_permissions",
    "approvals_reviewer",
  ]);
  assert.deepEqual(readRetiredCodexKeys(upgraded.content), []);
  ok("舊的 sandbox_mode 會被註解停用，並補上 default_permissions");

  // section 底下的同名 key 不算最上層——那是別的設定，不能拿來當「已經設過」，
  // 也不該被當成要退掉的舊 key。
  const nested = mergeCodexModes(
    '[profiles.foo]\ndefault_permissions = ":read-only"\nsandbox_mode = "read-only"\n',
  );
  assert.deepEqual(nested.added, [
    "default_permissions",
    "approval_policy",
    "approvals_reviewer",
  ]);
  assert.deepEqual(nested.retired, []);
  assert.match(nested.content, /^sandbox_mode = "read-only"$/m);
  ok("section 底下的同名 key 不會被誤認為最上層已設定，也不會被誤停用");

  // 驗證那半讀的是「現在的值」，不是「有沒有這一行」：學生自己設成別的值時，
  // 卡片要說得出他設的是什麼，而不是只講「沒裝」。
  const read = readCodexModes(
    'default_permissions = ":read-only"\napproval_policy = "on-request"\n[profiles.foo]\napprovals_reviewer = "auto_review"\n',
  );
  assert.equal(read.default_permissions, ":read-only");
  assert.equal(read.approval_policy, "on-request");
  // section 底下那個不算——跟 merge 那半同一條規則，兩邊要一致。
  assert.equal(read.approvals_reviewer, null);
  ok("readCodexModes 讀得出最上層的實際值，section 底下的不算");

  // 驗證的關鍵：檔案複製成功但沒註冊進 settings.json，hook 一樣不會擋，
  // 而且不會有任何錯誤訊息——所以驗證必須看註冊，不能只看檔案在不在。
  assert.equal(findHookRegistration({}), null);
  assert.equal(
    findHookRegistration({
      hooks: { PreToolUse: [{ hooks: [{ command: "node /別的.js" }] }] },
    }),
    null,
  );
  assert.deepEqual(findHookRegistration(registered), {
    matcher: "Bash",
    command: `node "${hookPath}"`,
  });
  ok("找得出 settings.json 裡的 hook 註冊，別人的 hook 不會誤判成有裝");

  assert.equal(
    countInstalledRules({ permissions: { allow: ["a", "b"] } }, ["a", "b", "c"]),
    2,
  );
  assert.equal(countInstalledRules({}, ["a"]), 0);
  ok("算得出白名單裝進去幾條");
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
