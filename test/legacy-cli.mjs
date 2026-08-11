import assert from "node:assert/strict";

import {
  classifyInstall,
  findPackageRoot,
  inspectCommand,
  legacyCliStatus,
  removableEntries,
} from "../src/legacy-cli.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

const NPM_SHIM = "C:\\Users\\Reed\\AppData\\Roaming\\npm\\codex.cmd";
const NPM_PKG =
  "C:\\Users\\Reed\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex";
const OFFICIAL =
  "C:\\Users\\Reed\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe";
const POSIX_NPM = "/Users/reed/.npm-global/bin/codex";
const POSIX_OFFICIAL = "/Users/reed/.local/bin/codex";

try {
  assert.equal(classifyInstall(NPM_SHIM), "npm");
  assert.equal(classifyInstall(NPM_PKG), "npm");
  assert.equal(classifyInstall(POSIX_NPM), "npm");
  assert.equal(classifyInstall(OFFICIAL), "official");
  assert.equal(classifyInstall(POSIX_OFFICIAL), "official");
  assert.equal(classifyInstall("C:\\somewhere\\else\\codex.exe"), "unknown");
  assert.equal(classifyInstall(null), "unknown");
  ok("兩個平台的 npm 落點與官方落點都分得出來，不認得的就說不認得");

  assert.equal(findPackageRoot(NPM_SHIM, "@openai/codex"), NPM_PKG);
  assert.equal(
    findPackageRoot(POSIX_NPM, "@openai/codex"),
    "/Users/reed/.npm-global/bin/node_modules/@openai/codex",
  );
  ok("套件本體的位置從 shim 旁邊推出來，分隔符跟著平台走");

  // 迴歸：只搬 .cmd 不夠。npm 一次寫三支，而 .ps1 不在 PATHEXT 裡、PowerShell 卻
  // 自己會執行它——真機實測搬走 codex.CMD 之後，Get-Command codex -All 仍然列出
  // codex.ps1 與無副檔名那支，孤兒照樣叫得到。
  const npmDir = "C:\\Users\\Reed\\AppData\\Roaming\\npm";
  const allThree = inspectCommand("codex", [`${npmDir}\\codex.CMD`], {
    exists: (candidate) =>
      [
        `${npmDir}\\codex`,
        `${npmDir}\\codex.cmd`,
        `${npmDir}\\codex.ps1`,
      ].includes(candidate),
  });
  assert.deepEqual(
    allThree.npm.map((entry) => entry.path),
    [`${npmDir}\\codex`, `${npmDir}\\codex.cmd`, `${npmDir}\\codex.ps1`],
  );
  ok("找到一支就把同目錄同名的三支一起收（含 PATHEXT 看不到的 .ps1）");

  // Windows 的檔名不分大小寫：PATH 上拿到 codex.CMD、掃出來是 codex.cmd，
  // 不正規化的話同一支會被搬兩次，第二次必定失敗。
  const mixedCase = inspectCommand(
    "codex",
    [`${npmDir}\\codex.CMD`, `${npmDir}\\codex.cmd`],
    { exists: (candidate) => candidate.toLowerCase() === `${npmDir}\\codex.cmd`.toLowerCase() },
  );
  assert.equal(mixedCase.npm.length, 1);
  ok("大小寫不同的同一支只算一次");

  // 三種情況，一種一種來。
  const coexist = inspectCommand("codex", [OFFICIAL, NPM_SHIM], {
    exists: (candidate) => candidate === NPM_PKG || candidate === NPM_SHIM,
  });
  assert.equal(coexist.official, 1);
  assert.equal(coexist.npm.length, 1);
  assert.equal(coexist.npm[0].orphan, false);
  ok("並存：官方版與 npm 版各認一支，npm 那支本體還在所以不是孤兒");

  // shim 在、本體不在。exists 只認 shim 那一支。
  const orphan = inspectCommand("codex", [OFFICIAL, NPM_SHIM], {
    exists: (candidate) => candidate === NPM_SHIM,
  });
  assert.equal(orphan.npm[0].orphan, true);
  ok("孤兒 shim：本體不在時標得出來");

  const onlyNpm = inspectCommand("codex", [NPM_SHIM], {
    exists: (candidate) => candidate === NPM_PKG || candidate === NPM_SHIM,
  });
  assert.equal(onlyNpm.official, 0);
  ok("只有 npm 版：官方版數量是 0");

  assert.equal(legacyCliStatus([inspectCommand("codex", [], { exists: () => true })]).status, "ok");
  ok("沒有 npm 殘留時是綠的");

  // ⚠️ 這是這支模組最重要的一條。只有 npm 版的時候**不能給清理按鈕**——
  // 那是學生唯一叫得動的東西，清掉等於把人家的工具拆了。
  const onlyNpmStatus = legacyCliStatus([onlyNpm]);
  assert.equal(onlyNpmStatus.status, "warn");
  assert.equal(onlyNpmStatus.fixLabel, undefined);
  assert.ok(onlyNpmStatus.detail.includes("重裝"));
  ok("只有 npm 版時不長清理按鈕，改叫他用官方版重裝");

  const coexistStatus = legacyCliStatus([coexist]);
  assert.equal(coexistStatus.fixLabel, "搬走 npm 裝的舊版");
  assert.ok(coexistStatus.detail.length <= 40, coexistStatus.detail);
  ok("並存時給清理按鈕，說明一行講完");

  const orphanStatus = legacyCliStatus([orphan]);
  assert.ok(orphanStatus.detail.includes("空氣"));
  assert.ok(orphanStatus.detail.length <= 40, orphanStatus.detail);
  ok("有孤兒時說明改成講那個更嚴重的症狀");

  // 混合情況：Reed 的 VM 實測就是這樣——codex 並存、claude 只有 npm 版。
  // ⚠️ 說明只能講按下去會動到的那幾支。全部串成一句會講出「claude 同時有 npm 版
  // 與官方版」這種假話（清理行為是對的，錯的是說明）。
  const claudeOnlyNpm = inspectCommand(
    "claude",
    ["C:\\Users\\Reed\\AppData\\Roaming\\npm\\claude.cmd"],
    { exists: () => true },
  );
  const mixed = legacyCliStatus([claudeOnlyNpm, coexist]);
  assert.ok(mixed.detail.includes("codex"));
  assert.ok(
    !mixed.detail.includes("claude"),
    `claude 只有 npm 版，不該被說成「同時有官方版」：${mixed.detail}`,
  );
  assert.equal(mixed.fixLabel, "搬走 npm 裝的舊版");
  ok("混合情況時，說明只講按下去會動到的那幾支");

  // 而且真的不會動到 claude。
  assert.deepEqual(
    removableEntries([claudeOnlyNpm, coexist]).map((entry) => entry.command),
    ["codex"],
  );
  ok("混合情況時只搬 codex，claude 一支都不動");

  // 真的動得了的是哪幾支——這決定腳本會碰什麼檔案。
  assert.deepEqual(
    removableEntries([onlyNpm]).map((entry) => entry.path),
    [],
  );
  ok("只有 npm 版時一支都不動");

  assert.deepEqual(
    removableEntries([coexist]).map((entry) => entry.path),
    [NPM_SHIM],
  );
  ok("並存時搬走 npm 那一支");

  // 孤兒即使沒有官方版也要清：它不是「還能用的舊版」，它只會失敗。
  const lonelyOrphan = inspectCommand("codex", [NPM_SHIM], {
    exists: (candidate) => candidate === NPM_SHIM,
  });
  assert.deepEqual(
    removableEntries([lonelyOrphan]).map((entry) => entry.path),
    [NPM_SHIM],
  );
  ok("孤兒沒有官方版當靠山也要清——留著只會讓每次呼叫都失敗");
} catch (error) {
  console.error(error);
  process.exit(1);
}
