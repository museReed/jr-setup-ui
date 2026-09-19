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
  retireTargets,
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
    "naming-retire",
    "claude-monitor",
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
    "naming-retire",
    "codex-monitor",
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
    "naming-retire",
    "claude-monitor",
    "codex-monitor",
    "skill-claude-handoff",
    "skill-claude-structured-questions",
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
  // 清理那一列不分工具也不分平台：它要清的東西橫跨 Claude 與 Codex 兩邊，而且
  // 只有「以前裝過的人」看得到（checkRetired 回 null 就整列消失）。
  for (const tools of [["claude"], ["codex"], ["claude", "codex"]]) {
    for (const platform of ["darwin", "linux", "win32"]) {
      assert.equal(
        stepsForTools(tools, platform).filter((id) => id === "naming-retire")
          .length,
        1,
      );
    }
  }
  assert.deepEqual(
    stepsForTools(["claude"]),
    stepsForTools(["claude"], process.platform),
  );
  ok("自動命名的清理列每種組合都剛好出現一次");

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

  // 自動命名下架之後，這一列做的事跟安裝相反：把以前裝過的殘留清掉。
  // 兩個工具的 hook 註冊、兩個平台的 shell 區塊、白名單那一條，都要在清單裡——
  // 漏掉哪一項，學生機器上就留著一個指向不存在檔案的 hook，每次靜靜失敗。
  const retire = describeStep("naming-retire", { ...AT, platform: "linux" });
  assert.equal(retire.kind, "retire");
  assert(retire.files.includes(`${HOME}/.claude/hooks/set-session-name.sh`));
  assert(retire.files.includes(`${HOME}/.codex/hooks/codex-session-namer.sh`));
  assert(retire.files.includes(`${HOME}/.jr-setup/bin/ai-tab-sync.ps1`));
  assert(retire.files.includes(`${HOME}/.local/bin/ai-tab-sync.sh`));
  assert.deepEqual(
    retire.targets.map((target) => target.settingsTarget),
    [`${HOME}/.claude/settings.json`, `${HOME}/.codex/hooks.json`],
  );
  assert.deepEqual(
    retire.rcBlocks.map((rc) => rc.target),
    [
      `${HOME}/.zshrc`,
      `${HOME}/Documents/WindowsPowerShell/Microsoft.PowerShell_profile.ps1`,
    ],
  );
  assert.equal(retire.allowRuleMarker, "set-session-name");
  // 平台不影響清單：學生可能兩種都裝過（換機、重灌），少列一個平台就清不乾淨。
  assert.deepEqual(
    describeStep("naming-retire", { ...AT, platform: "win32" }).files,
    retire.files,
  );
  ok("自動命名的清理列涵蓋兩個工具、兩個平台與白名單");

  for (const lang of ["zh-TW", "zh-CN", "en"]) {
    const template = readFileSync(
      path.join(REPO_ROOT, "materials", "codex", lang, "config.toml.example"),
      "utf8",
    );
    assert.match(template, /status_line = \[\s*"thread-title",/);
    assert.match(template, /terminal_title = \["thread"\]/);
  }
  ok("三種語言的 Codex template 都顯示 thread 名稱與原生 terminal title");

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

  const claudeMonitor = describeStep("claude-monitor", {
    ...AT,
    platform: "linux",
  });
  const codexMonitor = describeStep("codex-monitor", {
    ...AT,
    platform: "win32",
  });

  // 監控 hook：一支檔案、一筆註冊，不需要白名單——它不叫模型執行任何東西。
  assert.equal(claudeMonitor.hookFiles.length, 1);
  assert.equal(claudeMonitor.registrations.length, 1);
  assert.equal(claudeMonitor.supportFiles.length, 1);

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
  // 單一 settingsTarget（舊形狀）與 targets 陣列（新形狀）都要讀得到，否則
  // 退役步驟只清得掉其中一種。
  assert.deepEqual(retireTargets(codexMonitor), [
    {
      settingsTarget: `${HOME}/.codex/hooks.json`,
      markers: ["codex-context-monitor"],
    },
  ]);
  assert.equal(retireTargets(retire).length, 2);
  ok("監控已退役，兩個平台各刪各的副檔名；退役目標兩種形狀都讀得到");

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
      registrations: claudeMonitor.registrations,
      hookMarkers: claudeMonitor.hookFiles.map((file) => file.base),
    },
  );
  assert.equal(
    hasAgentHookRegistrations(agentRegistered, claudeMonitor.registrations),
    true,
  );
  // 別人的那筆 + 監控 hook 的一筆
  assert.equal(agentRegistered.hooks.PostToolUse.length, 2);
  assert.equal(agentRegistered.hooks.Stop.length, 1);
  assert.equal(agentRegistered.model, "opus");

  // 重跑一次不能變成兩筆：學生重按安裝是常態。
  const agentRerun = mergeAgentHookRegistrations(agentRegistered, {
    registrations: claudeMonitor.registrations,
    hookMarkers: claudeMonitor.hookFiles.map((file) => file.base),
  });
  assert.equal(agentRerun.hooks.PostToolUse.length, 2);
  assert.equal(
    hasAgentHookRegistrations(agentRerun, claudeMonitor.registrations),
    true,
  );
  ok("hook 安裝可重跑，不會變成兩筆，也不動使用者原本的 hook");

  // ⚠️ hook 的檔名是**回訪學生的升級路徑**，改名等於在他機器上留一條孤兒註冊。
  //
  // 重裝時清舊註冊的判準是「命令列裡有沒有提到這幾個檔名」（見上面
  // mergeAgentHookRegistrations 的 hookMarkers）。檔名一改，舊那條就對不上——
  // 它會靜靜留在 settings.json 裡，指向一個已經不存在的檔案，每次事件失敗一次，
  // 而畫面上完全看不出來：新的裝好了、是綠的，舊的在背景一直報錯。
  //
  // 2026-08-21 查過整個 materials/skills/hooks 的 git 歷史：只有 A 與 M，一筆 D
  // 或 R 都沒有——所以這條保證到目前為止是成立的，只是沒有人守著它。
  //
  // 這條測試就是那個守門人。改名時它會紅，逼你順便想清楚舊的那份怎麼收
  //（現成的做法在 describeStep 的 kind: "retire"）。
  const HOOK_BASES = {
    darwin: {
      "claude-monitor": ["context-monitor"],
    },
    linux: {
      "claude-monitor": ["context-monitor"],
    },
    win32: {
      "claude-monitor": ["context-monitor"],
    },
  };

  for (const [platform, byStep] of Object.entries(HOOK_BASES)) {
    for (const [id, bases] of Object.entries(byStep)) {
      assert.deepEqual(
        describeStep(id, { ...AT, platform }).hookFiles.map(
          (file) => file.base,
        ),
        bases,
        `${platform} 的 ${id} 動到 hook 檔名了——舊學生的註冊會變成孤兒，` +
          `請一起做退役（kind: "retire"）再更新這張表`,
      );
    }
  }

  // 退役那一列認的字串也一起釘住，理由同上：它是「認得出舊機器裝過什麼」的判準，
  // 改了就等於認不出來，那一列從此不會出現，而東西還在學生機器上。
  assert.deepEqual(
    describeStep("codex-monitor", { ...AT, platform: "darwin" }).markers,
    ["codex-context-monitor"],
  );
  assert.deepEqual(
    retireTargets(describeStep("naming-retire", { ...AT, platform: "darwin" })).map(
      (target) => target.markers,
    ),
    [["set-session-name", "session-auto-namer"], ["codex-session-namer"]],
  );
  ok("hook 檔名與退役 marker 都釘住了，改名時測試會紅");

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
