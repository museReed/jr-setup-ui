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

  // ⚠️ 迴歸（Reed 的 mac VM，2026-08-15）：Node 是 Homebrew 裝的時候，npm 的全域
  // bin 是 /opt/homebrew/bin——路徑裡看不到 node_modules、npm、.npm-global 任何一個
  // 字，於是 npm 裝的 claude 被判成 unknown，那一列大聲說「沒有上一輪用 npm 裝的
  // 殘留」，而 npm ls -g 明明列著 @anthropic-ai/claude-code。
  //
  // 解法不是再列一個前綴（學生的 prefix 可以是任何地方），是**解開 symlink**：
  // npm 在 POSIX 上放的是一條指向套件本體的連結，解開來一定看得到 node_modules。
  const BREW_SHIM = "/opt/homebrew/bin/claude";
  const BREW_REAL =
    "/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/cli.js";
  assert.equal(classifyInstall(BREW_SHIM), "unknown");
  assert.equal(classifyInstall(BREW_SHIM, BREW_REAL), "npm");
  ok("Homebrew 的全域 bin 靠解開 symlink 才認得出是 npm 裝的");

  // 那條連結解得開、目標也在＝本體健在，不是孤兒。往 shim 旁邊找 node_modules 會
  // 找不到（本體在 /opt/homebrew/lib，不同層），所以這一種一定要走解開的那條路。
  const brew = inspectCommand("claude", [BREW_SHIM], {
    // 那條連結自己在，它指到的本體也在。
    exists: (candidate) => candidate === BREW_REAL || candidate === BREW_SHIM,
    realpath: (candidate) => (candidate === BREW_SHIM ? BREW_REAL : null),
  });
  assert.equal(brew.npm.length > 0, true, "Homebrew 那支要被算成 npm 殘留");
  assert.equal(brew.npm[0].orphan, false, "本體還在，不該被判成孤兒");
  assert.equal(brew.npm[0].path, BREW_SHIM, "要搬的是那條連結，不是套件本體");

  // 斷掉的連結：解不開 → 退回往旁邊找 → 找不到本體 → 孤兒。那正是對的。
  const dangling = inspectCommand("claude", [BREW_SHIM], {
    exists: () => false,
    realpath: () => null,
  });
  assert.equal(dangling.npm.length, 0, "解不開又不像 npm 落點時不亂認");
  ok("Homebrew 那種安裝算 npm 殘留、本體健在不判成孤兒");

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

  // ⚠️ 這是這支模組最重要的一條：只有 npm 版、而且**這台裝不回官方版**時，
  // 不能給清理按鈕——那是學生唯一叫得動的東西，搬走了沒有東西補上。
  const stranded = legacyCliStatus([onlyNpm], { reinstallable: [] });
  assert.equal(stranded.status, "warn");
  assert.equal(stranded.fixLabel, undefined);
  assert.ok(stranded.detail.includes("重裝"));
  assert.deepEqual(removableEntries([onlyNpm], { reinstallable: [] }), []);
  ok("只有 npm 版又裝不回來時：不長按鈕，也一支都不動");

  // 裝得回來的話就一起搬（Reed 拍板：反正後面那張卡會裝官方版）。
  const reinstallable = legacyCliStatus([onlyNpm], { reinstallable: ["codex"] });
  assert.equal(reinstallable.fixLabel, "搬走 npm 裝的舊版");
  assert.ok(
    reinstallable.detail.includes("官方版"),
    `要講清楚它會先消失再回來：${reinstallable.detail}`,
  );
  assert.ok(reinstallable.detail.length <= 40, reinstallable.detail);
  assert.equal(
    removableEntries([onlyNpm], { reinstallable: ["codex"] }).length,
    onlyNpm.npm.length,
  );
  ok("只有 npm 版但裝得回來時：搬走，說明講清楚會先消失再回來");

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

  // ⚠️ 但同一種混合、而這台**裝得回 claude** 的時候，claude 也會被搬走——那時說明
  // 就不能只講 codex（Reed 的 mac VM，2026-08-15：畫面寫「codex 同時有舊版與官方
  // 版」，按下去 claude 也不見了）。
  //
  // 而且 claude 那支沒有官方版當靠山，搬走之後會**暫時消失**，直到後面那張卡把官方版
  // 裝回來——那是最需要先講的一件事，不能被吃掉。
  const mixedReinstallable = legacyCliStatus([claudeOnlyNpm, coexist], {
    reinstallable: ["claude", "codex"],
  });
  assert.ok(mixedReinstallable.detail.includes("claude"));
  assert.ok(mixedReinstallable.detail.includes("codex"));
  assert.ok(
    mixedReinstallable.detail.includes("官方版"),
    `要講清楚 claude 會先消失再回來：${mixedReinstallable.detail}`,
  );
  assert.ok(
    mixedReinstallable.detail.length <= 40,
    mixedReinstallable.detail,
  );
  ok("兩支都會被搬走時兩支都要講，而且點名那支會先消失的");

  // 同一組資料，兩種 reinstallable 的結果不同——這是 Reed 拍板那條的分水嶺。
  assert.deepEqual(
    removableEntries([claudeOnlyNpm, coexist], { reinstallable: [] }).map(
      (entry) => entry.command,
    ),
    ["codex"],
  );
  ok("裝不回 claude 的機器上只搬 codex，claude 一支都不動");

  assert.deepEqual(
    [
      ...new Set(
        removableEntries([claudeOnlyNpm, coexist], {
          reinstallable: ["claude", "codex"],
        }).map((entry) => entry.command),
      ),
    ],
    ["claude", "codex"],
  );
  ok("裝得回來的機器上兩支一起搬（反正後面那張卡會裝官方版）");

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

  // ── Homebrew 裝的（Reed 指定：也要搬進隔離區，之後另一張卡跑 brew uninstall）──
  //
  // ⚠️ 判準是 Cellar 不是 /opt/homebrew 前綴。上面那條 BREW_SHIM 的測試就是反例：
  // 同一個 bin 目錄底下站著 npm 裝的東西，用前綴會把它搶去判成 brew。
  // ⚠️ 這裡用 Caskroom 不是 Cellar，因為 claude-code 與 codex 在 Homebrew 上**都是
  // cask**（實查 2026-08-15：兩者都來自 homebrew-cask/Casks/c/）。只認 Cellar 的話
  // 這個功能等於沒做——真正裝得到的那一種一支都抓不到。
  const BREW_LINK = "/opt/homebrew/bin/claude";
  const BREW_BODY = "/opt/homebrew/Caskroom/claude-code/2.1.224/claude";
  const BREW_CELLAR = "/opt/homebrew/Cellar/claude-code/2.1.224/bin/claude";

  assert.equal(classifyInstall(BREW_BODY), "brew");
  assert.equal(classifyInstall(BREW_LINK, BREW_BODY), "brew");
  // formula 那條路留著：哪天它們從 cask 變成 formula 也要接得住。
  assert.equal(classifyInstall(BREW_CELLAR), "brew");
  assert.equal(classifyInstall(BREW_LINK, BREW_CELLAR), "brew");
  // 迴歸護欄：同一個前綴、解出來是 node_modules 的那支仍然要判 npm，不能被 brew 搶走。
  assert.equal(
    classifyInstall(BREW_LINK, "/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/cli.js"),
    "npm",
  );
  ok("brew 靠 Cellar 認，npm 仍然優先——同一個 bin 目錄底下兩種都可能");

  const brewInstall = inspectCommand("claude", [BREW_LINK], {
    exists: (candidate) => candidate === BREW_LINK || candidate === BREW_BODY,
    realpath: (candidate) => (candidate === BREW_LINK ? BREW_BODY : null),
  });
  assert.equal(brewInstall.npm.length, 0, "brew 那支不該混進 npm 清單");
  assert.equal(brewInstall.brew.length, 1);
  assert.equal(brewInstall.brew[0].path, BREW_LINK, "要搬的是那條連結不是本體");
  assert.equal(brewInstall.brew[0].kind, "brew", "腳本要靠 kind 決定搬進哪個分區");
  assert.equal(brewInstall.brew[0].orphan, false, "Cellar 裡的本體還在");
  ok("Homebrew 裝的獨立成一批，帶著 kind 走");

  // ⚠️ brew 吃**同一條**安全規則：這台裝不回官方版就一支都不動。「brew 裝的一律要
  // 換掉」是目標，不是可以把學生唯一能用的工具拆了不管的理由。
  assert.deepEqual(
    removableEntries([brewInstall], { reinstallable: ["claude"] }).map(
      (entry) => entry.path,
    ),
    [BREW_LINK],
  );
  assert.deepEqual(removableEntries([brewInstall], { reinstallable: [] }), []);
  ok("brew 裝的裝得回來才搬，裝不回來一支都不動");

  const brewStatus = legacyCliStatus([brewInstall], { reinstallable: ["claude"] });
  assert.equal(brewStatus.fixLabel, "搬走 Homebrew 裝的舊版");
  assert.ok(brewStatus.detail.length <= 40, brewStatus.detail);
  ok("只有 brew 時按鈕與說明都講 Homebrew");

  // 兩種都有時不列舉——套進句型會變成「搬走 套件管理器 裝的舊版」。
  const bothKinds = legacyCliStatus([brewInstall, coexist], {
    reinstallable: ["claude", "codex"],
  });
  assert.equal(bothKinds.fixLabel, "搬走舊版 CLI");
  assert.ok(bothKinds.detail.length <= 40, bothKinds.detail);
  ok("npm 與 brew 同時存在時，按鈕的字不列舉是哪一種");

  // ── 認不得的落點：報出來、不動手（Reed 拍板）──
  const stray = inspectCommand("codex", ["/Users/reed/tools/codex"], {
    exists: () => true,
  });
  assert.equal(stray.unknown.length, 1);
  assert.equal(stray.npm.length, 0);
  assert.equal(stray.brew.length, 0);
  assert.deepEqual(removableEntries([stray], { reinstallable: ["codex"] }), []);
  ok("認不得的落點只記下來，一支都不進可搬清單");

  const strayStatus = legacyCliStatus([stray], { reinstallable: ["codex"] });
  assert.equal(strayStatus.status, "ok", "認不得不算毛病，不該把這一列弄黃");
  assert.equal(strayStatus.fixLabel, undefined, "不給清理按鈕");
  assert.ok(strayStatus.guidance, "但要在卡片上講出來");
  assert.ok(strayStatus.guidance.symptom.includes("codex"));
  // ⚠️ 這一列會整包送到瀏覽器，而「這一頁卡住了」那顆會把它貼到公開的 issue 上。
  // 路徑裡有學生的使用者名稱（常常是本名）——只講指令名字，不放完整路徑。
  assert.ok(
    !JSON.stringify(strayStatus.guidance).includes("/Users/reed"),
    "說明裡不可以出現完整路徑",
  );
  ok("認不得的落點在卡片上講得出來，而且不洩漏路徑");
} catch (error) {
  console.error(error);
  process.exit(1);
}
