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
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
