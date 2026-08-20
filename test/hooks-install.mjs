import assert from "node:assert/strict";
import { AGENT_HOOK_TIMEOUT_SECONDS } from "../src/config-install.js";
import { namingAllowRule } from "../src/config-install.js";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { moduleFile } from "../src/paths.js";

import {
  describeStep,
  hasAgentHookRegistrations,
  isInteractiveInvocation,
  upsertBlock,
} from "../src/config-install.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

try {
  const marker = "jr-test";
  const first = upsertBlock("alias ll='ls -l'\n", marker, "new block");
  assert.equal(
    first,
    "alias ll='ls -l'\n\n# >>> jr-test >>>\nnew block\n# <<< jr-test <<<\n",
  );
  ok("rc 原本沒有標記時會在尾端追加完整區塊");

  assert.equal(upsertBlock(first, marker, "new block"), first);
  ok("rc 已有相同區塊時重跑不會重複追加");

  const replaced = upsertBlock(first, marker, "changed block");
  assert.match(replaced, /changed block/);
  assert.doesNotMatch(replaced, /new block/);
  assert.equal(replaced.match(/# >>> jr-test >>>/g).length, 1);
  ok("rc 已有不同內容時只取代標記內部");

  assert.throws(
    () => upsertBlock("# >>> jr-test >>>\n殘缺", marker, "new block"),
    /標記不成對/,
  );
  ok("rc 標記不成對時拒絕猜測與覆寫");

  assert.equal(isInteractiveInvocation([]), true);
  assert.equal(isInteractiveInvocation(["--model", "sonnet"]), true);
  assert.equal(isInteractiveInvocation(["-p"]), false);
  assert.equal(isInteractiveInvocation(["exec", "echo", "hi"]), false);
  assert.equal(isInteractiveInvocation(["--version"]), false);
  assert.equal(isInteractiveInvocation(["--help"]), false);
  ok("只有互動呼叫會啟動 watcher，四種非互動參數都直接放行");

  const home = mkdtempSync(path.join(tmpdir(), "jr-hooks-install-"));
  const env = { ...process.env, HOME: home };
  // ⚠️ 錨點是「這支測試檔在哪」，不是「shell 現在在哪」。
  //
  // 原本寫的是相對路徑加上 cwd: path.resolve(".")，於是這支測試會不會過取決於你在
  // 哪個資料夾按下執行：從 repo 根目錄跑得過，從別的地方跑就 MODULE_NOT_FOUND。
  // run-tests.mjs 一直都是從根目錄跑，所以它一路被藏著——直到有人單獨跑這一支，
  // 然後看到一個「測試壞了」的假紅，跑去查一個不存在的 bug（實測踩過）。
  //
  // paths.mjs 與 emoji-guard.mjs 早就是這個寫法，這裡跟上。
  const repoRoot = moduleFile("..", import.meta.url);
  const install = (step) =>
    execFileSync(
      process.execPath,
      [
        path.join(repoRoot, "scripts", "install-configs.mjs"),
        `--step=${step}`,
        "--lang=zh-TW",
      ],
      { cwd: repoRoot, env, encoding: "utf8" },
    );

  // 回鍋學生的狀態：上一輪裝過的 watcher 還在。裝新版時要把它收走，否則只要有分頁
  // 還開著，那些分頁裡的舊 wrapper 仍然會啟動它，標題照樣每秒被重寫。
  const legacyWatcher = path.join(home, ".local", "bin", "ai-tab-sync.sh");
  mkdirSync(path.dirname(legacyWatcher), { recursive: true });
  writeFileSync(legacyWatcher, "#!/bin/bash\n# 上一輪裝的\n");

  install("tab-sync");
  install("tab-sync");
  const tabStep = describeStep("tab-sync", {
    lang: "zh-TW",
    home,
    platform: process.platform,
  });
  const rc = readFileSync(tabStep.rcTarget, "utf8");
  assert.equal(rc.match(/# >>> jr-setup-ui tab sync >>>/g).length, 1);

  // POSIX 沒有 watcher 檔要裝（step.target 是 undefined），只寫 rc 區塊；Windows
  // 仍然要落地那支 .ps1。兩邊都要能重跑而不重複追加。
  if (tabStep.target === undefined) {
    assert.equal(process.platform === "win32", false);
    assert.match(rc, /CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1 command claude/);
    ok("POSIX 的 tab sync 可重跑，只寫 shell function、不裝 watcher");

    assert.equal(existsSync(legacyWatcher), false);
    ok("舊版留下的 watcher 會被收走");

    // 先備份再刪：這確實是我們裝的檔案，但學生機器上任何「消失了而且救不回來」
    // 的東西都會變成一次求助。
    const kept = readdirSync(path.dirname(legacyWatcher)).filter((name) =>
      name.startsWith("ai-tab-sync.sh.bak."),
    );
    assert.equal(kept.length > 0, true);
    ok("收走之前先留下 .bak，救得回來");
  } else {
    assert.equal(readFileSync(tabStep.target, "utf8").length > 0, true);
    ok("tab sync 實際安裝可重跑，watcher 與 shell function 都會落地");
  }

  install("claude-namer");
  install("claude-namer");
  const agentStep = describeStep("claude-namer", {
    lang: "zh-TW",
    home,
    platform: process.platform,
  });
  const settings = JSON.parse(readFileSync(agentStep.settingsTarget, "utf8"));
  assert(
    agentStep.hookFiles.every(
      (file) => readFileSync(file.target, "utf8").length > 0,
    ),
  );
  assert.equal(
    hasAgentHookRegistrations(settings, agentStep.registrations),
    true,
  );
  assert.equal(settings.hooks.PostToolUse.length, 1);
  assert.equal(settings.hooks.UserPromptSubmit.length, 1);
  ok("命名 hook 實際安裝可重跑，檔案與兩筆註冊都保持單份");

  // Windows VM 實測：UserPromptSubmit hook timed out after 10s — output discarded。
  // 那支是 PowerShell 腳本，冷啟動加第一次 Get-CimInstance 在 VM 裡就能吃掉十秒，
  // 超時的話 hook 輸出被整個丟棄，那一輪的命名等於沒發生。
  assert(
    AGENT_HOOK_TIMEOUT_SECONDS >= 30,
    "命名 hook 的 timeout 太短，Windows 上冷啟動會來不及",
  );
  for (const event of ["PostToolUse", "UserPromptSubmit"]) {
    assert.equal(
      settings.hooks[event][0].hooks[0].timeout,
      AGENT_HOOK_TIMEOUT_SECONDS,
    );
  }
  ok("命名 hook 註冊的 timeout 有留冷啟動的餘裕");

  // 監控那列另外裝：兩列共用同一個 settings.json，不能互相掃掉。
  install("claude-monitor");
  const monitorStep = describeStep("claude-monitor", {
    lang: "zh-TW",
    home,
    platform: process.platform,
  });
  const bothSettings = JSON.parse(
    readFileSync(agentStep.settingsTarget, "utf8"),
  );
  assert.equal(
    hasAgentHookRegistrations(bothSettings, agentStep.registrations),
    true,
  );
  assert.equal(
    hasAgentHookRegistrations(bothSettings, monitorStep.registrations),
    true,
  );
  ok("監控 hook 裝上去之後，命名 hook 的註冊還在");

  install("codex-namer");
  install("codex-namer");
  const codexStep = describeStep("codex-namer", {
    lang: "zh-TW",
    home,
    platform: process.platform,
  });
  const codexSettings = JSON.parse(
    readFileSync(codexStep.settingsTarget, "utf8"),
  );
  assert.equal(
    hasAgentHookRegistrations(codexSettings, codexStep.registrations),
    true,
  );
  assert.equal(codexSettings.hooks.PostToolUse.length, 1);
  assert.equal(codexSettings.hooks.UserPromptSubmit.length, 1);
  const codexHelper = codexStep.hookFiles.find(
    (file) => file.base === "codex-session-name-set",
  );
  assert(codexHelper, "POSIX Codex namer 必須連 helper 一起安裝");
  assert.equal(readFileSync(codexHelper.target, "utf8").length > 0, true);
  const codexRestart = codexStep.hookFiles.find(
    (file) => file.base === "codex-server-restart",
  );
  assert(codexRestart, "Codex namer 必須連全域 restart 指令一起安裝");
  assert.equal(readFileSync(codexRestart.target, "utf8").length > 0, true);
  assert.equal(statSync(codexRestart.target).mode & 0o111, 0o111);
  if (codexStep.posixCodexProfile !== undefined) {
    const profile = readFileSync(codexStep.posixCodexProfile.target, "utf8");
    assert.equal(
      profile.split(codexStep.posixCodexProfile.marker).length - 1,
      2,
    );
    const versionGuard = codexStep.hookFiles.find(
      (file) => file.base === "codex-version-guard",
    );
    assert(versionGuard, "macOS Codex namer 必須連版本提醒一起安裝");
    assert.equal(statSync(versionGuard.target).mode & 0o111, 0o111);
  }
  ok("Codex 命名 hook 實際安裝可重跑，hooks.json 與啟動入口都保持單份");

  // 迴歸：規則不能是「powershell -File …」那種形狀。Claude Code 拒絕用白名單
  // 放行會生出巢狀直譯器的指令（原文 Command spawns a nested PowerShell process
  // which cannot be validated），改多少字串都沒用——要改的是指令本身。
  const winStep = describeStep("claude-namer", {
    lang: "zh-TW",
    home: "C:/Users/Reed",
    platform: "win32",
  });
  assert(
    !winStep.namingAllowRule.includes("powershell"),
    `規則不該放行 powershell 指令：${winStep.namingAllowRule}`,
  );
  assert.equal(
    winStep.namingAllowRule,
    "Bash(C:/Users/Reed/.claude/hooks/set-session-name.sh:*)",
  );
  ok("Windows 的命名白名單放行的是薄殼腳本，不是巢狀 powershell 指令");

  // 薄殼要真的被裝出來，否則規則指向一個不存在的檔案。
  const shim = winStep.hookFiles.find(
    (file) => file.base === "set-session-name-shim",
  );
  assert.equal(shim.source, "skills/hooks/set-session-name-shim.sh");
  assert.equal(shim.target, "C:/Users/Reed/.claude/hooks/set-session-name.sh");
  assert(
    winStep.hookFiles.some((file) => file.base === "set-session-name"),
    "薄殼是外皮，真正的 .ps1 也要一起裝",
  );
  ok("Windows 會同時裝薄殼與 .ps1 本體");

  assert.equal(
    namingAllowRule("/Users/reed/.claude/hooks/set-session-name.sh"),
    "Bash(/Users/reed/.claude/hooks/set-session-name.sh:*)",
  );
  ok("macOS 的規則就是既有 starter allowlist 那條，不會重複新增");

  // 家目錄含空白時不加引號，bash 會在空白處把路徑斷成兩段（實測：
  // "…/Reed: No such file or directory"），命名指令根本跑不起來。
  assert.equal(
    namingAllowRule("C:/Users/Reed Chen/.claude/hooks/set-session-name.sh"),
    'Bash("C:/Users/Reed Chen/.claude/hooks/set-session-name.sh":*)',
  );
  ok("家目錄含空白時規則帶引號，路徑才不會被斷開");
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
