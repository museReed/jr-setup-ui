import assert from "node:assert/strict";

import {
  findSandboxHelper,
  isStorePowerShell,
  sandboxStatus,
  storePowerShellStatus,
} from "../src/codex-sandbox.js";
import { checksForPlatform, checksForTools } from "../src/env-check.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

const HELPER = "codex-windows-sandbox-setup.exe";
const JUNCTION_CODEX =
  "C:\\Users\\Reed\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe";
const STORE_PWSH =
  "C:\\Users\\Reed\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe";
const MSI_PWSH = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";

try {
  assert.equal(isStorePowerShell(STORE_PWSH), true);
  assert.equal(isStorePowerShell(MSI_PWSH), false);
  assert.equal(isStorePowerShell(null), false);
  ok("Store 版靠 WindowsApps 這一段認出來，一般安裝版不會誤判");

  // 沒裝 pwsh 完全不是問題——課堂只需要 5.1。歸成 warn 的話，絕大多數乾淨的
  // Windows 一開場就會看到一列黃燈，而那一列他什麼都不用做。
  assert.equal(storePowerShellStatus(null).status, "ok");
  assert.equal(storePowerShellStatus("").status, "ok");
  assert.equal(storePowerShellStatus(MSI_PWSH).status, "ok");
  ok("沒裝 PowerShell 7、或裝的是一般版，都是綠的");

  const store = storePowerShellStatus(STORE_PWSH);
  assert.equal(store.status, "warn");
  assert.equal(store.installable, false);
  assert.equal(store.storePath, STORE_PWSH);
  assert.ok(store.detail.length <= 40, "detail 太長會把按鈕擠出畫面");
  ok("Store 版是黃的、不長安裝鍵，說明一行講完");

  // codex 找 helper 的三個地方，一個一個確認都認得。
  const sibling = findSandboxHelper(JUNCTION_CODEX, {
    exists: (candidate) =>
      candidate ===
      "C:\\Users\\Reed\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\" + HELPER,
  });
  assert.ok(sibling !== null);
  ok("helper 就在 codex.exe 旁邊時找得到");

  const resources = findSandboxHelper(JUNCTION_CODEX, {
    exists: (candidate) => candidate.includes("bin\\codex-resources\\"),
  });
  assert.ok(resources !== null);
  ok("helper 在 bin 旁邊的 codex-resources 裡時找得到");

  const parentResources = findSandboxHelper(JUNCTION_CODEX, {
    exists: (candidate) => candidate === `C:\\Users\\Reed\\AppData\\Local\\Programs\\OpenAI\\Codex\\codex-resources\\${HELPER}`,
  });
  assert.ok(parentResources !== null);
  ok("helper 在 bin 上一層的 codex-resources 裡時找得到");

  // 這就是 junction 那種裝法：三個地方都對不到。
  assert.equal(findSandboxHelper(JUNCTION_CODEX, { exists: () => false }), null);
  ok("三個地方都沒有時回 null，那就是會炸的那種裝法");

  assert.equal(findSandboxHelper(null, { exists: () => true }), null);
  ok("codex 路徑是空的時候不會炸");

  // codex 還沒裝的話這一列沒有話好說——「Codex CLI」那一列自己會紅，
  // 兩列一起紅只是把同一件事講兩次。
  assert.equal(
    sandboxStatus({ codexPath: null, helperPath: null, storePowerShell: false })
      .status,
    "ok",
  );
  ok("codex 還沒裝時這一列不搶話");

  assert.equal(
    sandboxStatus({
      codexPath: JUNCTION_CODEX,
      helperPath: `x\\${HELPER}`,
      storePowerShell: false,
    }).status,
    "ok",
  );
  ok("helper 找得到就是綠的");

  const broken = sandboxStatus({
    codexPath: JUNCTION_CODEX,
    helperPath: null,
    storePowerShell: false,
  });
  assert.equal(broken.status, "warn");
  assert.equal(broken.installable, false);
  assert.ok(broken.detail.length <= 40, "detail 太長會把按鈕擠出畫面");
  ok("helper 找不到是黃的，而且不長安裝鍵");

  // 兩層都中時先講 Store 版：它比較上游，而且是學生自己修得掉的那一個。
  const bothLayers = sandboxStatus({
    codexPath: JUNCTION_CODEX,
    helperPath: null,
    storePowerShell: true,
  });
  assert.ok(bothLayers.detail.includes("Store"));
  ok("兩層都中時，說明先點名 Store 版");

  // 這幾條在 mac 上也跑得到——不然這兩列的接線只有 Windows 那台驗得了，
  // 而這個 repo 已經被「只在另一個平台才紅」咬過好幾次。
  const windowsIds = checksForPlatform("win32").map((check) => check.id);
  assert.ok(windowsIds.includes("codex-sandbox"));
  assert.ok(windowsIds.includes("pwsh-store"));
  assert.equal(
    windowsIds.indexOf("codex-sandbox"),
    windowsIds.indexOf("codex-auth") + 1,
    "沙箱那一列要緊跟在 codex-auth 後面（卡片上三列同一組）",
  );
  ok("Windows 的清單含沙箱與 Store 版兩列，順序也對");

  const macIds = checksForPlatform("darwin").map((check) => check.id);
  assert.ok(!macIds.includes("codex-sandbox"));
  assert.ok(!macIds.includes("pwsh-store"));
  ok("mac 沒有這兩列——junction 與 MSIX 都是 Windows 專屬的裝法");

  // 只選 Claude 的學生不該看到 Codex 的沙箱列。漏掉的話那一列會孤零零地
  // 掛在畫面上，而他根本沒裝 Codex。
  const claudeOnlyIds = checksForTools(
    checksForPlatform("win32"),
    ["claude"],
  ).map((check) => check.id);
  assert.ok(!claudeOnlyIds.includes("codex-sandbox"));
  assert.ok(claudeOnlyIds.includes("pwsh-store"));
  ok("只選 Claude 時沙箱列會被濾掉，Store 版那列留著（它跟工具選擇無關）");
} catch (error) {
  console.error(error);
  process.exit(1);
}
