import assert from "node:assert/strict";

import {
  currentPackageRoot,
  findSandboxHelper,
  isStorePowerShell,
  planSandboxLink,
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

  // ⚠️ Store 版是黃燈。這個斷言改過兩次，兩次都是被實測改的，所以理由要寫清楚：
  //
  //   最初      黃燈，理由是「Store 版是 MSIX，沙箱起不來」——那是疑問不是事故
  //   2026-08-11 改綠：實測 `codex exec --sandbox read-only` 正常
  //   2026-08-12 改回黃燈，**理由完全不同**
  //
  // 8/11 那次測試是無效的：那台的沙箱從來沒設定起來（cap_sid 是快照帶的、helper
  // 也找不到），codex 根本沒走 CreateProcessAsUserW。把沙箱真的設定起來之後：
  //
  //   codex sandbox powershell …  →  正常（5.1 在 System32，不是 MSIX）
  //   codex sandbox pwsh …        →  CreateProcessAsUserW failed: 2 / 1920
  //
  // 壞法是「受限帳號存取不到 MSIX 封裝的 pwsh」——沙箱起得來、檔案也改得動，
  // 但一個指令都執行不了。
  const store = storePowerShellStatus(STORE_PWSH);
  assert.equal(store.status, "warn");
  // ⚠️ 不給任何按鈕：winget 拿到的還是 MSIX（見 installers.js），接了會變成
  // 「按了說成功、那一列還是黃的」。自救步驟走 GUIDANCE。
  assert.equal(store.fixLabel, undefined);
  assert.equal(store.installable, false);
  assert.equal(store.storePath, STORE_PWSH);
  assert.ok(store.detail.length <= 40, "detail 太長會把按鈕擠出畫面");
  ok("Store 版是黃燈，但不長按鈕——自救步驟寫在 GUIDANCE");

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

  // 修復那條路：真機（Reed 的 VM）量到的實際路徑，直接拿來當樣本。
  const REAL_BIN = "C:\\Users\\Reed\\.codex\\packages\\standalone\\current\\bin";
  const CURRENT_ROOT =
    "C:\\Users\\Reed\\.codex\\packages\\standalone\\current";
  const REAL_RESOURCES = `${CURRENT_ROOT}\\codex-resources`;
  const LINK =
    "C:\\Users\\Reed\\AppData\\Local\\Programs\\OpenAI\\Codex\\codex-resources";

  const plan = planSandboxLink({
    codexPath: JUNCTION_CODEX,
    realBinPath: REAL_BIN,
    exists: (candidate) => candidate === REAL_RESOURCES,
  });
  assert.equal(plan.linkPath, LINK);
  assert.equal(plan.targetPath, REAL_RESOURCES);
  assert.equal(plan.alreadyLinked, false);
  ok("接的位置是 codex 會去看的那一層，指向真正的 codex-resources");

  // 迴歸：第一版用 realpathSync 解 bin，Node 連 current 一起解開，junction 於是
  // 釘死在版本號上（真機截圖：...\releases\0.147.0-aarch64-pc-windows-msvc\）。
  // codex 一升版舊目錄被清掉，連結就斷了。
  const resolvedBin =
    "C:\\Users\\Reed\\.codex\\packages\\standalone\\releases\\0.147.0-aarch64-pc-windows-msvc\\bin";
  assert.equal(currentPackageRoot(resolvedBin), CURRENT_ROOT);
  const pinned = planSandboxLink({
    codexPath: JUNCTION_CODEX,
    realBinPath: resolvedBin,
    exists: (candidate) => candidate === REAL_RESOURCES,
  });
  assert.equal(pinned.targetPath, REAL_RESOURCES);
  assert.ok(!pinned.targetPath.includes("releases"));
  ok("解析到版本目錄時折回 current，不把連結釘死在版本號上");

  // 學生會按第二次。已經接好了要安靜地成功，不是報錯。
  const again = planSandboxLink({
    codexPath: JUNCTION_CODEX,
    realBinPath: REAL_BIN,
    exists: () => true,
  });
  assert.equal(again.alreadyLinked, true);
  ok("已經接過了就回報「不用再接」，不是失敗");

  // 迴歸：「連結在不在」跟「連結通不通」是兩件事。只看前者的話，升版之後那條
  // 斷掉的 junction 會被當成「已經接好了」，學生按第二次也修不好。
  const dangling = planSandboxLink({
    codexPath: JUNCTION_CODEX,
    realBinPath: REAL_BIN,
    // 連結在、來源在，但從連結那條路走不到 helper。
    exists: (candidate) => candidate === REAL_RESOURCES || candidate === LINK,
  });
  assert.equal(dangling.alreadyLinked, false);
  assert.equal(dangling.stale, true);
  ok("連結在但走不通時視為斷掉，要拆掉重接");

  // 真正的那份不在時不能接：接一條指向空氣的 junction 只會把問題藏起來，
  // 下一次檢查反而變綠燈（findSandboxHelper 只看路徑在不在）。
  assert.equal(
    planSandboxLink({
      codexPath: JUNCTION_CODEX,
      realBinPath: REAL_BIN,
      exists: () => false,
    }),
    null,
  );
  ok("來源不存在時不接，不製造假綠燈");

  assert.equal(
    planSandboxLink({ codexPath: null, realBinPath: REAL_BIN, exists: () => true }),
    null,
  );
  ok("路徑是空的時候不會炸");

  // 接完之後，findSandboxHelper 的第三個候選就會命中——修復與偵測要對得起來，
  // 不然按完按鈕那一列還是黃的。
  assert.ok(
    findSandboxHelper(JUNCTION_CODEX, {
      exists: (candidate) => candidate === `${LINK}\\${HELPER}`,
    }) !== null,
  );
  ok("接好之後偵測那一列會轉綠（修復與偵測對得起來）");

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
  //
  // ⚠️ pwsh-store 原本留著（理由是「它跟工具選擇無關」）。2026-08-12 改成也濾掉：
  // 那一列從「只描述」變成黃燈之後就會擋住整張卡、進而擋住整個環境段，而它講的是
  // codex 沙箱跑不動指令——只選 Claude 的學生會被一個他永遠不需要在意的問題卡住，
  // 而且那一列**沒有按鈕**，他連按都沒得按。
  const claudeOnlyIds = checksForTools(
    checksForPlatform("win32"),
    ["claude"],
  ).map((check) => check.id);
  assert.ok(!claudeOnlyIds.includes("codex-sandbox"));
  assert.ok(!claudeOnlyIds.includes("pwsh-store"));

  const codexIds = checksForTools(checksForPlatform("win32"), ["codex"]).map(
    (check) => check.id,
  );
  assert.ok(codexIds.includes("pwsh-store"));
  ok("只選 Claude 時兩列都濾掉，選了 Codex 才看得到 Store 版那列");
} catch (error) {
  console.error(error);
  process.exit(1);
}
