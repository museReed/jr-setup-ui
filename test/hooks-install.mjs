import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

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
  const install = (step) =>
    execFileSync(
      process.execPath,
      ["scripts/install-configs.mjs", `--step=${step}`, "--lang=zh-TW"],
      { cwd: path.resolve("."), env, encoding: "utf8" },
    );

  install("tab-sync");
  install("tab-sync");
  const tabStep = describeStep("tab-sync", {
    lang: "zh-TW",
    home,
    platform: process.platform,
  });
  const rc = readFileSync(tabStep.rcTarget, "utf8");
  assert.equal(rc.match(/# >>> jr-setup-ui tab sync >>>/g).length, 1);
  assert.equal(readFileSync(tabStep.target, "utf8").length > 0, true);
  ok("tab sync 實際安裝可重跑，watcher 與 shell function 都會落地");

  install("claude-hooks");
  install("claude-hooks");
  const agentStep = describeStep("claude-hooks", {
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
  assert.equal(settings.hooks.PostToolUse.length, 2);
  assert.equal(settings.hooks.UserPromptSubmit.length, 1);
  ok("Claude hooks 實際安裝可重跑，檔案與三筆註冊都保持單份");

  install("codex-hooks");
  install("codex-hooks");
  const codexStep = describeStep("codex-hooks", {
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
  assert.equal(codexSettings.hooks.PostToolUse.length, 2);
  assert.equal(codexSettings.hooks.UserPromptSubmit.length, 1);
  ok("Codex hooks 實際安裝可重跑，hooks.json 保留三筆單份註冊");
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
