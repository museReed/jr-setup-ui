import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  checkAgentHooks,
  checkTabSync,
  probeHook,
  resolveBash,
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
  assert.deepEqual(await checkTabSync(tabStep, MATERIALS), {
    id: "tab-sync",
    label: "終端機標題同步",
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
    label: "自動命名 hook",
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
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
