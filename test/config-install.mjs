import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  removeLegacyCodexTabSyncBlock,
  mergeAgentHookRegistrations,
  hasHookRegistrations,
  removeHookRegistrations,
  stepsForTools,
  transformStepSource,
} from "../src/config-install.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

const HOME = "/Users/student";
const AT = { lang: "zh-TW", home: HOME };
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

try {
  assert.deepEqual(stepsForTools(["claude"]), [
    "claude-md",
    "output-style",
    "allowlist",
    // 退役那一列排在權限卡後面：先講「現在是怎麼設定的」，再處理「以前那個要移掉」。
    "hook",
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
    "obsidian",
    "skill-claude-vault-sync",
    "obsidian-vault",
    "vault-agent-claude",
    "demo-claude",
  ]);
  assert.deepEqual(stepsForTools(["codex"], "darwin"), [
    "codex-config",
    "codex-agents",
    "codex-namer",
    "codex-monitor",
    "skill-codex-auto-rename",
    "skill-codex-handoff",
    "skill-codex-structured-questions",
    "ext-frontend-design-codex",
    "ext-playwright-codex",
    "obsidian",
    "skill-codex-vault-sync",
    "obsidian-vault",
    "vault-agent-codex",
    "demo-codex",
  ]);
  assert.deepEqual(stepsForTools(["claude", "codex"]), [
    "claude-md",
    "output-style",
    "allowlist",
    // 退役那一列排在權限卡後面：先講「現在是怎麼設定的」，再處理「以前那個要移掉」。
    "hook",
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
    "obsidian",
    "skill-claude-vault-sync",
    "skill-codex-vault-sync",
    "obsidian-vault",
    "vault-agent-claude",
    "vault-agent-codex",
    "demo-claude",
    "demo-codex",
  ]);
  assert.throws(() => stepsForTools([]));
  assert.throws(() => stepsForTools(["vim"]));
  assert.equal(stepsForTools(["codex"], "darwin").includes("tab-sync"), false);
  assert.equal(stepsForTools(["codex"], "linux").includes("tab-sync"), false);
  assert.equal(stepsForTools(["codex"], "win32").includes("tab-sync"), false);
  assert.equal(stepsForTools(["claude"], "darwin").includes("tab-sync"), true);
  assert.equal(
    stepsForTools(["claude", "codex"], "linux").includes("tab-sync"),
    true,
  );
  assert.deepEqual(
    stepsForTools(["claude"]),
    stepsForTools(["claude"], process.platform),
  );
  ok("Codex-only 在所有平台都不裝 tab sync；只有 Claude 需要 watcher");

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

  const posixCodexConfig = describeStep("codex-config", {
    ...AT,
    platform: "linux",
  });
  const windowsCodexConfig = describeStep("codex-config", {
    ...AT,
    platform: "win32",
  });
  const codexTemplate = readFileSync(
    path.join(REPO_ROOT, "materials", posixCodexConfig.source),
    "utf8",
  );
  assert.equal(posixCodexConfig.sourceTransform, undefined);
  assert.equal(windowsCodexConfig.sourceTransform, undefined);
  assert.equal(
    transformStepSource(codexTemplate, posixCodexConfig),
    codexTemplate,
  );
  const windowsCodexTemplate = transformStepSource(
    codexTemplate,
    windowsCodexConfig,
  );
  assert.match(windowsCodexTemplate, /"thread-title"/);
  assert.match(windowsCodexTemplate, /^terminal_title\s*=\s*\["thread"\]/m);
  assert.equal(windowsCodexTemplate, codexTemplate);
  ok("Windows 與 POSIX 都保留 Codex 原生 thread title 設定");

  // POSIX 這一步沒有要安裝的檔案了：分頁標題改由命名 hook 自己寫 OSC，watcher
  // 整支不再啟動，所以 watcherSource / target 都是 undefined，只剩 rc 區塊。
  const tabSync = describeStep("tab-sync", { ...AT, platform: "linux" });
  assert.equal(tabSync.kind, "tab-sync");
  assert.equal(tabSync.watcherSource, undefined);
  assert.equal(tabSync.target, undefined);
  assert.equal(tabSync.rcTarget, `${HOME}/.zshrc`);
  assert.match(tabSync.rcBlock, /command claude "\$@"/);
  assert.doesNotMatch(tabSync.rcBlock, /command codex "\$@"/);

  // 少了這一行，Claude Code 自己寫的標題會蓋掉 hook 寫的名字，而事件驅動的頻率
  // 搶不回來（macOS 實測）。它是這個做法的必要條件，不是可有可無的裝飾。
  assert.match(
    tabSync.rcBlock,
    /CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1 command claude/,
  );
  // watcher 的痕跡要全部消失：sync 檔、背景執行、kill。留著任何一個都代表
  // 「每秒無條件重寫」還在，看背景 agent 時標題又會被蓋回去。
  assert.doesNotMatch(tabSync.rcBlock, /AI_TAB_SYNC_FILE/);
  assert.doesNotMatch(tabSync.rcBlock, /ai-tab-sync/);
  assert.doesNotMatch(tabSync.rcBlock, /kill /);

  const windowsTabSync = describeStep("tab-sync", {
    ...AT,
    platform: "win32",
  });
  assert.equal(windowsTabSync.watcherSource, "skills/bin/ai-tab-sync.ps1");
  assert.equal(windowsTabSync.target, `${HOME}/.jr-setup/bin/ai-tab-sync.ps1`);
  assert.match(windowsTabSync.rcBlock, /Get-Command claude -CommandType Application/);
  assert.doesNotMatch(windowsTabSync.rcBlock, /Get-Command codex -CommandType Application/);
  // Windows 仍然走 watcher：那邊的 hook 是子行程，寫進去的標題一退出就被還原，只有
  // 長壽的 watcher 留得住（見 docs/windows-tab-title-why-watcher.md）。這裡守著
  // 「POSIX 拿掉不會順手把 Windows 也拿掉」。
  //
  // 這個區塊現在只包 claude——codex 改用 app-server 原生命名之後就搬出去了，所以直接
  // 對整塊比對就是在驗 claude 那一段。
  assert.match(windowsTabSync.rcBlock, /AI_TAB_SYNC_FILE/);
  ok("POSIX 只剩 rc 區塊；Windows 只包 Claude，且仍走 watcher");

  for (const lang of ["zh-TW", "zh-CN", "en"]) {
    const template = readFileSync(
      path.join(REPO_ROOT, "materials", "codex", lang, "config.toml.example"),
      "utf8",
    );
    assert.match(template, /status_line = \[\s*"thread-title",/);
    assert.match(template, /terminal_title = \["thread"\]/);
  }
  ok("三種語言的 Codex template 都顯示 thread 名稱與原生 terminal title");

  // watcher 用 [Console]::Title 改標題，那個 API 只作用在自己所在的 console。
  // -WindowStyle Hidden 會開一個新的 console，watcher 就改到自己的標題、碰不到
  // 學生的分頁——全綠但標題不動（VM 實測）。共用 console 的是 -NoNewWindow。
  assert(
    !windowsTabSync.rcBlock.includes("-WindowStyle Hidden"),
    "watcher 不能用 -WindowStyle Hidden 起，那會開新的 console",
  );
  assert.match(windowsTabSync.rcBlock, /-NoNewWindow/);
  ok("Windows watcher 用 -NoNewWindow 起，跟終端共用同一個 console");

  // Windows 的狀態列走了兩輪才到位（VM 實測，兩次都是安靜地不出現）：
  //
  //   一行 powershell -Command   引號被下一層 shell 咬掉，整條不啟動
  //   powershell -File 一支 .ps1  手動跑得出來，Claude Code 裡仍然空白
  //                              （ARM64 上 powershell 冷啟動 1～2 秒，狀態列每 5 秒
  //                                跑一次，來不及在 timeout 前吐出東西）
  //   node 一支 .mjs             ← 現在這個
  //
  // 對照組：同時把指令換成 `cmd /c echo PROBE-OK`，狀態列當場出現 PROBE-OK，
  // 所以機制是活的、問題在 PowerShell 那一層。不要再退回去。
  const hudWin = describeStep("claude-hud", { ...AT, platform: "win32" });
  assert.equal(
    hudWin.commandTemplate,
    "claude-code/claude-hud/statusline.mjs.template",
  );
  assert.equal(
    hudWin.scriptTarget,
    `${HOME}/.claude/plugins/claude-hud/statusline.mjs`,
  );
  const hudMac = describeStep("claude-hud", { ...AT, platform: "darwin" });
  assert.equal(hudMac.scriptTarget, null, "mac 那條照舊直接寫進 settings.json");
  ok("Windows 的狀態列由 node 當入口，mac 維持一行 bash");

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
  assert.equal(codexHooks.hookFiles.length, 5);
  assert(codexHooks.hookFiles.every((file) => file.target.endsWith(".ps1")));
  assert.equal(
    codexHooks.windowsCodexProfile.target,
    `${HOME}/Documents/WindowsPowerShell/Microsoft.PowerShell_profile.ps1`,
  );
  assert.match(codexHooks.windowsCodexProfile.block, /function codex/);
  assert.match(codexHooks.windowsCodexProfile.block, /codex-shared-app-server\.ps1/);
  assert.match(codexHooks.windowsCodexProfile.block, /function codex-server-restart/);
  assert.match(codexHooks.windowsCodexProfile.block, /codex-server-restart\.ps1/);
  assert.match(codexHooks.windowsCodexProfile.legacyCodexTabSyncBlock, /AI_TAB_SYNC_FILE/);
  const legacyProfile = `${windowsTabSync.rcBlock}\n\n${codexHooks.windowsCodexProfile.legacyCodexTabSyncBlock}`;
  const migratedProfile = removeLegacyCodexTabSyncBlock(
    legacyProfile,
    codexHooks.windowsCodexProfile.legacyCodexTabSyncBlock,
  );
  assert.match(migratedProfile, /Get-Command claude/);
  assert.doesNotMatch(migratedProfile, /Get-Command codex/);
  // codex 的監控 hook 退役了：這一步現在描述的是「怎麼把它移除」，不是怎麼裝。
  assert.equal(codexMonitor.kind, "retire");
  assert.deepEqual(codexMonitor.files, [
    `${HOME}/.codex/hooks/codex-context-monitor.ps1`,
  ]);
  assert.equal(codexMonitor.settingsTarget, `${HOME}/.codex/hooks.json`);
  assert.deepEqual(codexMonitor.markers, ["codex-context-monitor"]);
  // POSIX 上要刪的是 .sh，不是 .ps1——寫死副檔名的話 mac 學生按了移除，檔案還在。
  assert.deepEqual(
    describeStep("codex-monitor", { ...AT, platform: "darwin" }).files,
    [`${HOME}/.codex/hooks/codex-context-monitor.sh`],
  );
  ok("命名帶自己的檔案與註冊；監控已退役，兩個平台各刪各的副檔名");

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

  // ⚠️ 這裡以前有五條 mergeHookRegistration 的測試（空檔會長出註冊、Windows 路徑轉
  // 正斜線、重跑冪等、不動別人的 hook）。那支 hook 整個退役了，註冊器也跟著拿掉。
  //
  // 接手的是下面的 removeHookRegistrations：退役那一列要做的正好是反過來——把註冊
  // 拿掉，而且不能誤傷別人的。
  const hookPath = `${HOME}/.claude/hooks/block-chained-bash.js`;
  const legacySettings = {
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [
            { type: "command", command: `node "${hookPath}"`, timeout: 5 },
          ],
        },
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: "node /別人的.js" }],
        },
      ],
      Stop: [{ hooks: [{ type: "command", command: "echo bye" }] }],
    },
    model: "opus",
  };

  assert.equal(
    hasHookRegistrations(legacySettings, ["block-chained-bash"]),
    true,
  );
  assert.equal(hasHookRegistrations({}, ["block-chained-bash"]), false);
  assert.equal(
    hasHookRegistrations(legacySettings, ["codex-context-monitor"]),
    false,
  );
  ok("認得出這台機器裝過已退役的 hook，沒裝過的不誤報");

  const cleaned = removeHookRegistrations(legacySettings, [
    "block-chained-bash",
  ]);
  assert.deepEqual(cleaned.hooks.PreToolUse, [
    {
      matcher: "Bash",
      hooks: [{ type: "command", command: "node /別人的.js" }],
    },
  ]);
  assert.equal(cleaned.hooks.Stop.length, 1);
  assert.equal(cleaned.model, "opus");
  assert.equal(hasHookRegistrations(cleaned, ["block-chained-bash"]), false);
  ok("移除只拿掉自己那一條，別人的 hook 與其餘設定原樣留著");

  // 群組空掉要一起收乾淨。留一個 hooks: [] 的群組，Claude Code 讀得到卻什麼都不做
  // ——而畫面上看不出差別，下一次檢查還會說「已註冊」。
  const onlyOurs = removeHookRegistrations(
    {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: `node "${hookPath}"` }],
          },
        ],
      },
    },
    ["block-chained-bash"],
  );
  assert.deepEqual(onlyOurs.hooks.PreToolUse, []);
  ok("整個群組只剩我們那一條時，群組本身也收掉");

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
  //
  // 白名單本身不用為了 auto mode 搬家：官方文件明說 auto mode 底下窄的 Bash allow
  // 規則照常生效，只有 Bash(*) 那種寬規則會被暫停。starter-allowlist 全是窄規則。
  assert.equal(allow.settings.permissions.defaultMode, "auto");
  assert.equal(allow.modeAdded, true);
  ok("裝白名單時一併把預設模式設成 auto");

  // 上一輪嚮導寫進去的 acceptEdits 要換成 auto。那不是學生的選擇，是我們的——
  // 不換的話已經裝過的人永遠停在舊模式，而這一列會一直說「還沒設好」。
  const modeUpgraded = mergeAllowRules(
    { permissions: { defaultMode: "acceptEdits" } },
    { allowRules: ["Bash(ls)"] },
  );
  assert.equal(modeUpgraded.settings.permissions.defaultMode, "auto");
  assert.equal(modeUpgraded.modeAdded, true);
  ok("上一輪寫進去的 acceptEdits 會被換成 auto");

  // 學生自己調過就尊重他的選擇，重跑安裝不該把它蓋回去。
  //
  // ⚠️ 只有 acceptEdits 例外（上面那條）。plan / default / bypassPermissions 都不動
  // ——沒有這條界線的話，「升級」就變成「把每個人的設定改成我們要的」。
  const kept = mergeAllowRules(
    { permissions: { defaultMode: "plan" } },
    { allowRules: ["Bash(ls)"] },
  );
  assert.equal(kept.settings.permissions.defaultMode, "plan");
  assert.equal(kept.modeAdded, false);
  const bypass = mergeAllowRules(
    { permissions: { defaultMode: "bypassPermissions" } },
    { allowRules: ["Bash(ls)"] },
  );
  assert.equal(
    bypass.settings.permissions.defaultMode,
    "bypassPermissions",
  );
  ok("使用者自己設過的預設模式不會被覆蓋");

  // 驗證那半：沒設回 null，設了就回實際的值。checkAllowlist 靠這個分辨「安裝沒
  // 生效」與「學生自己調過」——兩者要做的事不一樣，不能都講成「沒裝」。
  assert.equal(readDefaultMode(allow.settings), "auto");
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

  // service_tier 跟 sandbox_mode 不一樣：那個 key 還活著，只有 "default" 這個值
  // 新版不收（真機：unknown variant `default`, expected `fast` or `flex`，連啟動
  // 都失敗）。所以判準要看值。
  const badValue = mergeCodexModes('service_tier = "default"\n');
  assert.deepEqual(badValue.retired, ['service_tier = "default"']);
  assert.match(badValue.content, /^# service_tier = "default"$/m);
  assert.match(badValue.content, /新版 Codex 不收/);
  ok("service_tier = \"default\" 會被註解停用，說明講的是「值」不是「key」");

  // ⚠️ 這是把兩張表分開的全部理由：學生刻意設的合法值不能動。混成一張的話，
  // 他知道自己在做什麼的那個設定會被我們安靜地關掉。
  const goodValue = mergeCodexModes('service_tier = "fast"\n');
  assert.deepEqual(goodValue.retired, []);
  assert.match(goodValue.content, /^service_tier = "fast"$/m);
  ok("service_tier = \"fast\" 是合法的，一個字都不動");

  // 寫法有很多種：單引號、多餘空白、行尾註解。都要認得出來。
  for (const line of [
    "service_tier='default'",
    '  service_tier   =   "default"  ',
    'service_tier = "default" # 上一輪設的',
  ]) {
    assert.deepEqual(
      mergeCodexModes(`${line}\n`).retired,
      ['service_tier = "default"'],
      `這種寫法沒認出來：${line}`,
    );
  }
  ok("引號、空白、行尾註解的各種寫法都認得出來");

  // 驗證那半也要跟著看值——不然裝完卡片會說「還有舊 key 沒退」而其實已經處理完。
  assert.deepEqual(readRetiredCodexKeys('service_tier = "default"\n'), [
    'service_tier = "default"',
  ]);
  assert.deepEqual(readRetiredCodexKeys('service_tier = "flex"\n'), []);
  assert.deepEqual(readRetiredCodexKeys(badValue.content), []);
  ok("驗證那半同樣看值，停用之後就不再回報");

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

  // findHookRegistration 留著給退役用：verify-configs 靠它認出「這台機器還留著
  // 已退役的擋串接 hook」。只刪檔案不夠——settings 裡那條註冊留著的話，Claude Code
  // 每次都會去跑一個不存在的檔案，而畫面上看不出來。
  assert.equal(findHookRegistration({}), null);
  assert.equal(
    findHookRegistration({
      hooks: { PreToolUse: [{ hooks: [{ command: "node /別的.js" }] }] },
    }),
    null,
  );
  assert.deepEqual(findHookRegistration(legacySettings), {
    matcher: "Bash",
    command: `node "${hookPath}"`,
  });
  ok("找得出還留著的舊 hook 註冊，別人的 hook 不會誤判成有裝");

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
