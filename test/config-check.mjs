import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  checkAgentHooks,
  checkTabSync,
  probeHook,
} from "../src/config-check.js";
import {
  describeStep,
  mergeAgentHookRegistrations,
  upsertBlock,
} from "../src/config-install.js";

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

  const tabStep = describeStep("tab-sync", {
    lang: "zh-TW",
    home: dir,
    platform: "linux",
  });
  mkdirSync(path.dirname(tabStep.target), { recursive: true });
  writeFileSync(tabStep.target, "watcher");
  assert.deepEqual(await checkTabSync(tabStep), {
    id: "tab-sync",
    label: "終端機標題同步",
    status: "warn",
    detail: "檔案在，但 shell function 沒寫進去",
  });
  writeFileSync(
    tabStep.rcTarget,
    upsertBlock("", tabStep.rcMarker, tabStep.rcBlock),
  );
  assert.equal((await checkTabSync(tabStep)).status, "ok");
  ok("tab sync 要 watcher 與 rc 標記同時存在才算生效");

  const agentStep = describeStep("claude-hooks", {
    lang: "zh-TW",
    home: dir,
    platform: "linux",
  });
  for (const file of agentStep.hookFiles) {
    mkdirSync(path.dirname(file.target), { recursive: true });
    writeFileSync(file.target, "hook");
  }
  assert.deepEqual(await checkAgentHooks(agentStep), {
    id: "claude-hooks",
    label: "Claude Code hooks",
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
  assert.equal((await checkAgentHooks(agentStep)).status, "ok");
  ok("agent hooks 要所有檔案與三筆註冊同時存在才算生效");
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
