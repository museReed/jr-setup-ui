import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  currentPackageRoot,
  findSandboxHelper,
  isStorePowerShell,
  planSandboxLink,
  sandboxAnswered,
  sandboxFilesStatus,
  sandboxSetupStatus,
  storePowerShellStatus,
} from "../src/codex-sandbox.js";
import {
  FIX_ACTIONS,
  checksForPlatform,
  checksForTools,
} from "../src/env-check.js";
import { installActionId, resolveInstaller } from "../src/installers.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

const HELPER = "codex-windows-sandbox-setup.exe";
const JUNCTION_CODEX =
  "C:\\Users\\Reed\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe";
const STORE_PWSH =
  "C:\\Users\\Reed\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe";
const MSI_PWSH = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
// Reed 的 VM 上實際那份 config.toml 的形狀（[windows] 排在最後，前面是一堆
// [projects]，這個順序有意義——判準的 regex 不能被 [projects] 那些干擾）。
const CONFIG_UNANSWERED = [
  'service_tier = "default"',
  "",
  "[projects.'c:\\users\\reed']",
  'trust_level = "trusted"',
  "",
].join("\n");
const CONFIG_ANSWERED = `${CONFIG_UNANSWERED}\n[windows]\nsandbox = "elevated"\n`;

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
  assert.equal(store.fixLabel, "換成一般安裝版");
  // ⚠️ installable: false 不是「不能裝」，是「不要走安裝鍵那條路」——這一列是黃燈，
  // 而 withActions 只在 missing 時給 installAction。少了這一行，envCardRowModel
  // 會補一顆灰掉的「安裝」佔位鍵，畫面上變成兩顆按鈕、一顆還按不下去。
  assert.equal(store.installable, false);
  assert.equal(store.storePath, STORE_PWSH);
  assert.ok(store.detail.length <= 40, "detail 太長會把按鈕擠出畫面");
  ok("Store 版是黃燈，按鈕走 fixAction 而不是安裝鍵");

  // ⚠️ 這一顆按鈕的關鍵在 --installer-type wix，不加的話 winget 給的是 MSIX
  // ——落點還是 WindowsApps，等於什麼都沒修（2026-08-12 在 arm64 VM 上兩種都實測過）。
  const pwshInstaller = resolveInstaller("pwsh-store", "win32");
  assert.notEqual(pwshInstaller, null, "pwsh-store 那一列查不到安裝器，按鈕會不見");
  const typeIndex = pwshInstaller.args.indexOf("--installer-type");
  assert.ok(typeIndex !== -1, "少了 --installer-type，winget 會給 MSIX");
  assert.equal(pwshInstaller.args[typeIndex + 1], "wix");
  // 已經有一份市集版時，不加 --force 會直接跳過、跑完 exit 0 但什麼都沒變。
  assert.ok(pwshInstaller.args.includes("--force"));
  assert.equal(
    FIX_ACTIONS["pwsh-store"]("warn", store),
    installActionId("pwsh-store"),
  );
  assert.equal(FIX_ACTIONS["pwsh-store"]("ok", {}), null);
  ok("換一般安裝版那顆帶著 --installer-type wix 與 --force，綠燈時不出現");

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

  // codex 還沒裝的話這兩列都沒有話好說——「Codex CLI」那一列自己會紅，
  // 三列一起紅只是把同一件事講三次。
  assert.equal(
    sandboxFilesStatus({
      codexPath: null,
      helperPath: null,
      storePowerShell: false,
    }).status,
    "ok",
  );
  assert.equal(
    sandboxSetupStatus({ codexPath: null, answered: false }).status,
    "ok",
  );
  ok("codex 還沒裝時這兩列都不搶話");

  // ⚠️ 判準是 config.toml 的 [windows] sandbox，那是 codex 自己「要不要再問」的
  // 開關。2026-08-13 一天之內換過三次判準，前三個都被真機推翻（見
  // src/codex-sandbox.js 的 sandboxAnswered 上面那段）。
  assert.equal(sandboxAnswered(CONFIG_ANSWERED), true);
  assert.equal(sandboxAnswered(CONFIG_UNANSWERED), false);
  // 檔案不在、空的都當作沒回答過。
  assert.equal(sandboxAnswered(null), false);
  assert.equal(sandboxAnswered(""), false);
  // 有 [windows] 這一段但沒有 sandbox 這個鍵，也不算。
  assert.equal(sandboxAnswered("[windows]\nsomething = 1\n"), false);
  ok("沙箱設定好了沒，看的是 config.toml 的 [windows] sandbox");

  assert.equal(
    sandboxSetupStatus({ codexPath: JUNCTION_CODEX, answered: true }).status,
    "ok",
  );
  ok("回答過了就是綠的，跟檔案那一列各自判各自的");

  // ⚠️ 迴歸（2026-08-13 VM 實測）：判準不可以回頭去查 cap_sid 或那兩個本機帳號。
  // 學生選完 1、codex 印了 Sandbox ready 之後，那兩樣**都還沒生出來**，於是那一列
  // 永遠等不到、按鈕變成一顆按不完的迴圈。
  const neverSetUp = sandboxSetupStatus({
    codexPath: JUNCTION_CODEX,
    answered: false,
  });
  assert.equal(neverSetUp.status, "warn");
  assert.equal(neverSetUp.fixLabel, "開終端設定沙箱");
  // ⚠️ 這一行不可以寫死「選 1」。真機實測：受限帳號還在的機器按下去什麼都不問，
  // 直接印 sandbox-ok；只有要重建帳號時才跳選單。寫死一個未必出現的步驟，那種人
  // 會停在那裡等一個不會來的選單（Reed 在畫面前指出）。
  assert.ok(
    !neverSetUp.detail.includes("選 1"),
    "那一列不該寫死「選 1」——有一半的機器不會跳選單",
  );
  assert.ok(neverSetUp.detail.length <= 40, "detail 太長會把按鈕擠出畫面");
  ok("沒設定過是黃的，而且給得出一顆真的能做事的按鈕");

  const broken = sandboxFilesStatus({
    codexPath: JUNCTION_CODEX,
    helperPath: null,
    storePowerShell: false,
  });
  assert.equal(broken.status, "warn");
  assert.equal(broken.installable, false);
  assert.equal(broken.fixLabel, "接回沙箱要用的檔案");
  assert.ok(broken.detail.length <= 40, "detail 太長會把按鈕擠出畫面");
  ok("helper 找不到是黃的、接得回來，而且不長安裝鍵");

  // helper 對得到就是綠的，這一列只管檔案。
  assert.equal(
    sandboxFilesStatus({
      codexPath: JUNCTION_CODEX,
      helperPath: `x\\${HELPER}`,
      storePowerShell: false,
    }).status,
    "ok",
  );
  ok("檔案那一列只管 helper 對不對得到");

  // 兩層都中時先講 Store 版：它比較上游，而且是學生自己修得掉的那一個。
  const bothLayers = sandboxFilesStatus({
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

  // ⚠️ 那顆按鈕印給學生的三步，第 2 步（權限確認視窗）**不一定會出現**：
  //
  //   第一次上課  帳號還沒建 → 跳 UAC
  //   回鍋學生    帳號上一輪就在了 → 完全不跳，直接 Sandbox ready
  //
  // 兩種都在 2026-08-14 的 VM 上實測走過。寫死「會跳」的話，回鍋的那半（多數）
  // 會停在那裡等一個不會出現的視窗——跟先前寫死「選 1」是同一種踩雷。
  const setupScript = readFileSync(
    new URL("../scripts/setup-codex-sandbox.mjs", import.meta.url),
    "utf8",
  );
  assert.ok(
    setupScript.includes("沒跳出來也是正常的"),
    "第 2 步要講「沒跳出來也正常」，不然回鍋學生會停在那裡等",
  );
  assert.ok(
    !setupScript.includes('"  2. 跳出來的權限確認視窗要按「是」"'),
    "第 2 步不可以寫死「會跳出來」",
  );
  ok("設定沙箱的三步文案兩種結果都講得通（跳 UAC 與不跳）");
} catch (error) {
  console.error(error);
  process.exit(1);
}
