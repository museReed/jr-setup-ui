import assert from "node:assert/strict";
import { AGENT_HOOK_TIMEOUT_SECONDS } from "../src/config-install.js";
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

  const claudeSettingsTarget = path.join(home, ".claude", "settings.json");
  const codexHooksTarget = path.join(home, ".codex", "hooks.json");

  install("claude-monitor");
  install("claude-monitor");
  const monitorStep = describeStep("claude-monitor", {
    lang: "zh-TW",
    home,
    platform: process.platform,
  });
  const settings = JSON.parse(readFileSync(claudeSettingsTarget, "utf8"));
  assert(
    monitorStep.hookFiles.every(
      (file) => readFileSync(file.target, "utf8").length > 0,
    ),
  );
  assert.equal(
    hasAgentHookRegistrations(settings, monitorStep.registrations),
    true,
  );
  assert.equal(settings.hooks.PostToolUse.length, 1);
  ok("監控 hook 實際安裝可重跑，檔案與註冊都保持單份");

  // Windows VM 實測：UserPromptSubmit hook timed out after 10s — output discarded。
  // 那支是 PowerShell 腳本，冷啟動加第一次 Get-CimInstance 在 VM 裡就能吃掉十秒，
  // 超時的話 hook 輸出被整個丟棄，那一輪等於沒發生。
  assert(
    AGENT_HOOK_TIMEOUT_SECONDS >= 30,
    "hook 的 timeout 太短，Windows 上冷啟動會來不及",
  );
  assert.equal(
    settings.hooks.PostToolUse[0].hooks[0].timeout,
    AGENT_HOOK_TIMEOUT_SECONDS,
  );
  ok("hook 註冊的 timeout 有留冷啟動的餘裕");

  // --- 自動命名的退役 ---
  //
  // 這一段模擬「上一輪裝過整套自動命名」的回鍋學生：檔案、兩個工具的 hook 註冊、
  // shell 區塊、白名單那一條都在。按下移除之後，四種殘留都要消失，而且不能動到
  // 同一個檔案裡別人的東西（監控 hook 的註冊、學生自己的 rc 內容）。
  const retireStep = describeStep("naming-retire", {
    lang: "zh-TW",
    home,
    platform: process.platform,
  });
  const seededFiles = [
    path.join(home, ".claude", "hooks", "set-session-name.sh"),
    path.join(home, ".claude", "hooks", "session-auto-namer.sh"),
    path.join(home, ".codex", "hooks", "codex-session-namer.sh"),
    path.join(home, ".local", "bin", "ai-tab-sync.sh"),
  ];

  for (const file of seededFiles) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "#!/bin/bash\n# 上一輪裝的\n");
  }

  const seededSettings = JSON.parse(readFileSync(claudeSettingsTarget, "utf8"));
  seededSettings.hooks.PostToolUse.push({
    hooks: [
      {
        type: "command",
        command: `bash "${path.join(home, ".claude", "hooks", "session-auto-namer.sh")}"`,
      },
    ],
  });
  seededSettings.permissions = {
    allow: [
      "Bash(ls:*)",
      `Bash(${path.join(home, ".claude", "hooks", "set-session-name.sh")}:*)`,
    ],
  };
  writeFileSync(claudeSettingsTarget, JSON.stringify(seededSettings, null, 2));

  mkdirSync(path.dirname(codexHooksTarget), { recursive: true });
  writeFileSync(
    codexHooksTarget,
    JSON.stringify(
      {
        hooks: {
          PostToolUse: [
            {
              hooks: [
                {
                  type: "command",
                  command: `bash "${path.join(home, ".codex", "hooks", "codex-session-namer.sh")}"`,
                },
              ],
            },
          ],
        },
      },
      null,
      2,
    ),
  );

  const rcTarget = retireStep.rcBlocks[0].target;
  mkdirSync(path.dirname(rcTarget), { recursive: true });
  writeFileSync(
    rcTarget,
    upsertBlock(
      "alias ll='ls -l'\n",
      retireStep.rcBlocks[0].markers[0],
      'claude() { command claude "$@"; }',
    ),
  );

  install("naming-retire");
  install("naming-retire");

  for (const file of seededFiles) {
    assert.equal(existsSync(file), false, `${file} 沒有被移除`);
  }
  ok("退役會把兩個工具的命名腳本與 watcher 都刪掉");

  const afterSettings = JSON.parse(readFileSync(claudeSettingsTarget, "utf8"));
  assert.equal(
    hasAgentHookRegistrations(afterSettings, monitorStep.registrations),
    true,
    "退役不能掃掉監控 hook 的註冊",
  );
  assert.equal(
    JSON.stringify(afterSettings).includes("session-auto-namer"),
    false,
  );
  assert.deepEqual(afterSettings.permissions.allow, ["Bash(ls:*)"]);
  ok("退役只清掉命名那幾條註冊與白名單，別人的留著");

  const afterCodex = JSON.parse(readFileSync(codexHooksTarget, "utf8"));
  assert.equal(
    JSON.stringify(afterCodex).includes("codex-session-namer"),
    false,
  );
  ok("Codex 那邊的註冊也一起清掉");

  const afterRc = readFileSync(rcTarget, "utf8");
  assert.doesNotMatch(afterRc, /jr-setup-ui tab sync/);
  assert.match(afterRc, /alias ll='ls -l'/);
  ok("shell 區塊整段移除，學生自己寫的內容不動");

} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
