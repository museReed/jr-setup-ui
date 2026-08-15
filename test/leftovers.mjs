// 兩種殘留的收尾（brew 與 npm）：判準在 src/leftovers.js，這裡測它問的那幾個問題。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  brewLeftoverRow,
  brewNameFromTarget,
  commandFromEntry,
  leftoverCommands,
  npmLeftoverRow,
} from "../src/leftovers.js";
import { flattenCheckCards } from "../public/model.js";
import { FIX_ACTIONS } from "../src/env-check.js";
import { actions } from "../src/actions.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

try {
  // 搬進隔離區時檔名是「<指令>-<時間戳>」（見 scripts/fix-legacy-cli.mjs）。
  assert.equal(commandFromEntry("codex-20260815121317"), "codex");
  assert.equal(commandFromEntry("claude-20260815121317"), "claude");
  // 名字裡本來就有減號的也還原得回去——切的是最後那段純數字。
  assert.equal(commandFromEntry("some-tool-20260815"), "some-tool");
  // 沒有時間戳（手動放的、或格式變了）就原樣當指令名，不要吐 null 讓那一列消失。
  assert.equal(commandFromEntry("codex"), "codex");
  assert.equal(commandFromEntry(""), null);
  ok("從隔離區的檔名還原得出指令名字");

  assert.deepEqual(
    leftoverCommands(["codex-20260815121317", "codex-20260814090000"]),
    ["codex"],
  );
  assert.deepEqual(leftoverCommands([]), []);
  ok("同一支搬過兩次只算一支，排序固定");

  // ⚠️ brew 上的名字不一定等於指令名字：codex 的 cask 就叫 codex，但 claude 的 cask
  // 叫 claude-code。拿指令名字去問 brew，那支永遠得到「沒裝」，於是我們說收乾淨了而
  // Caskroom 裡的東西原封不動。連結指向哪就還原得出正確的名字。
  assert.equal(
    brewNameFromTarget("/opt/homebrew/Caskroom/codex/0.147.0/bin/codex"),
    "codex",
  );
  assert.equal(
    brewNameFromTarget("/opt/homebrew/Caskroom/claude-code/2.1.226/bin/claude"),
    "claude-code",
  );
  assert.equal(
    brewNameFromTarget("/opt/homebrew/Cellar/some-tool/1.2.3/bin/x"),
    "some-tool",
  );
  // npm 裝的解出來不含這兩個資料夾——回 null，呼叫端退回指令名字。
  assert.equal(
    brewNameFromTarget("/opt/homebrew/lib/node_modules/@openai/codex/bin/codex"),
    null,
  );
  assert.equal(brewNameFromTarget(null), null);
  ok("從連結指向哪還原得出 brew 上的名字（cask 名字常常不等於指令名字）");

  // 隔離區裡沒有 brew 那批＝這一列根本不該出現。它不是「沒事」，是「沒有這回事」
  // ——長一列「Homebrew：沒有東西」出來，對從來沒用 brew 裝過的人是純噪音。
  assert.equal(brewLeftoverRow({ commands: [], stillInstalled: [] }), null);
  ok("沒有 brew 殘留時這一列不出現");

  // ⚠️ 還沒收完是**黃燈**，不是綠燈配一顆可按可不按的鍵——這一點跟隔離區那一列
  // 相反。不做的話 brew upgrade 有機會把連結重新建回來，前面那顆清理鍵等於白按。
  const pending = brewLeftoverRow({
    commands: ["codex"],
    stillInstalled: ["codex"],
  });
  assert.equal(pending.status, "warn");
  assert.equal(pending.fixLabel, "跑 brew uninstall 收尾");
  assert.deepEqual(pending.pending, ["codex"]);
  assert.ok(pending.detail.includes("codex"));
  assert.ok(
    pending.detail.length <= 40,
    `detail 太長會把按鈕擠出畫面：${pending.detail}`,
  );
  // 沒有東西可以「安裝」，補一顆安裝鍵只會讓學生問安裝什麼。
  assert.equal(pending.installable, false);
  ok("brew 清單上還有的時候是黃燈，按鈕講得出它會跑什麼");

  // 卸乾淨之後那一列**留著打勾**，不是消失——跟隔離區那一列同一個理由：按完整張卡
  // 不見了，學生會以為自己做錯了什麼。
  const done = brewLeftoverRow({ commands: ["codex"], stillInstalled: [] });
  assert.equal(done.status, "ok");
  assert.equal(done.fixLabel, undefined);
  assert.equal(FIX_ACTIONS["brew-leftover"]("ok", done), null);
  assert.equal(
    FIX_ACTIONS["brew-leftover"]("warn", pending),
    "finish-brew-uninstall",
  );
  ok("收乾淨之後那一列留著打勾，而且不再長按鈕");

  // ⚠️ 問 brew「這支還在不在」時 cask 與 formula 要各問一次：`brew list --versions`
  // **只查 formula**，而 claude-code 與 codex 在 Homebrew 上都是 cask——只問前者的話
  // 一律得到「沒裝」，那一列一進來就是綠的，而 Caskroom 裡的東西原封不動（Reed 在
  // mac VM 上一眼看出不對：他的 codex 明明還在 brew 的清單上）。
  const envSource = readFileSync(
    new URL("../src/env-check.js", import.meta.url),
    "utf8",
  );
  assert.match(
    envSource,
    /runProbe\("brew", \["list", "--cask", "--versions", name\]\)/,
    "cask 也要問一次，不然 brew 裝的一律被當成沒裝",
  );
  const scriptSource = readFileSync(
    new URL("../scripts/finish-brew-uninstall.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    scriptSource,
    /brew\(\["list", "--cask", "--versions", name\]\)/,
    "卸載腳本挑要卸誰的時候也要問 cask",
  );
  ok("查 brew 清單時 cask 與 formula 各問一次");

  // 那顆 action 真的註冊過，不然按下去會回 400。
  assert.notEqual(actions["finish-brew-uninstall"], undefined);
  assert.equal(actions["finish-brew-uninstall"].kind, "fixed");
  assert.notEqual(actions["finish-npm-uninstall"], undefined);
  assert.equal(actions["finish-npm-uninstall"].kind, "fixed");
  ok("兩顆收尾 action 都註冊過了");

  // ── npm 那半 ──────────────────────────────────────────────────────────
  //
  // ⚠️ 這一列是後來補的（Reed 2026-08-15）。原本的界線是「我們只管 PATH 上這一支，
  // 不管 npm 的帳本」，但 brew 補了收尾之後那個不對稱就站不住了：兩者都是「本體還在、
  // 帳本還記得」，真正踩到時症狀一模一樣——捷徑被重新建回來、PATH 上又兩份。
  assert.equal(npmLeftoverRow({ commands: [], stillInstalled: [] }), null);

  const npmPending = npmLeftoverRow({
    commands: ["codex"],
    stillInstalled: ["codex"],
  });
  assert.equal(npmPending.status, "warn");
  assert.equal(npmPending.fixLabel, "跑 npm uninstall 收尾");
  assert.deepEqual(npmPending.pending, ["codex"]);
  assert.equal(npmPending.installable, false);
  assert.ok(
    npmPending.detail.length <= 40,
    `detail 太長會把按鈕擠出畫面：${npmPending.detail}`,
  );
  assert.equal(
    FIX_ACTIONS["npm-leftover"]("warn", npmPending),
    "finish-npm-uninstall",
  );

  const npmDone = npmLeftoverRow({ commands: ["codex"], stillInstalled: [] });
  assert.equal(npmDone.status, "ok");
  assert.equal(FIX_ACTIONS["npm-leftover"]("ok", npmDone), null);
  ok("npm 那半跟 brew 同一個形狀：沒收完是黃燈，收完留著打勾");

  // ⚠️ 判準看的是「本體在不在」不是 `npm ls -g` 的輸出——孤兒的情況 npm 自己也認不得
  // （它以為沒裝），而我們要判的是「重裝時會不會把捷徑建回來」。
  assert.match(
    envSource,
    /existsSync\(join\(base, \.\.\.packageName\.split\("\/"\)\)\)/,
    "npm 那半要看套件本體在不在，不是問 npm ls -g",
  );
  ok("npm 那半判的是套件本體，不是 npm 的帳本");

  // ⚠️ 兩列同一張卡，而且順序不能反：刪備份那顆會把隔離區清空，brew 這一步萬一
  // 失敗，那份備份就是唯一還原得回去的東西（Reed 拍板同一張卡兩列）。
  const row = (id, label) => ({ id, label, status: "warn", detail: "x" });
  // 第一張永遠是「選工具 + 選語言」那張 setup 卡，它不是環境檢查來的。
  const envCards = (checks) =>
    flattenCheckCards([], checks)[0].cards.filter(
      (card) => (card.checks ?? []).length > 0,
    );

  // mac 上三列都可能同時出現：npm 收尾、brew 收尾、刪備份。
  const macCards = envCards([
    row("npm-leftover", "npm 那邊也收乾淨了"),
    row("brew-leftover", "Homebrew 那邊也收乾淨了"),
    row("quarantine", "先前搬走的東西還留著"),
  ]);
  assert.equal(macCards.length, 1, "三列要合成一張卡，不是各自一張");
  assert.deepEqual(
    macCards[0].checks.map((check) => check.id),
    ["npm-leftover", "brew-leftover", "quarantine"],
    "兩個收尾都排在刪備份前面",
  );
  assert.equal(macCards[0].label, "收尾：清掉留下來的東西");

  // ⚠️ Windows 沒有 brew 那一列，但 npm 那一列照樣會有（Reed 指定 Windows 也要有
  // 這張收尾卡）。少了 npm-leftover 那一筆 meta 的話，這台的第一列就查不到卡片設定，
  // 整張卡會退回機器寫的預設標題。
  const winCardsWithNpm = envCards([
    row("npm-leftover", "npm 那邊也收乾淨了"),
    row("quarantine", "先前搬走的東西還留著"),
  ]);
  assert.equal(winCardsWithNpm.length, 1);
  assert.deepEqual(
    winCardsWithNpm[0].checks.map((check) => check.id),
    ["npm-leftover", "quarantine"],
  );
  assert.equal(winCardsWithNpm[0].label, "收尾：清掉留下來的東西");

  // brew 單獨在（npm 那批已經收完、或從來沒有）也要成立。
  const brewOnly = envCards([
    row("brew-leftover", "Homebrew 那邊也收乾淨了"),
    row("quarantine", "先前搬走的東西還留著"),
  ]);
  assert.equal(brewOnly.length, 1);
  assert.deepEqual(
    brewOnly[0].checks.map((check) => check.id),
    ["brew-leftover", "quarantine"],
    "brew 收尾排在刪備份前面",
  );
  // 標題不能退回機器寫的預設模板（「準備 <整句 label>，讓後面的課堂步驟…」）。
  assert.equal(macCards[0].label, "收尾：清掉留下來的東西");

  // Windows 上 brew-leftover 這一列根本不存在，那時 quarantine 要自己成一張卡。
  const winCards = envCards([row("quarantine", "先前搬走的東西還留著")]);
  assert.equal(winCards.length, 1);
  assert.equal(winCards[0].label, "清掉搬走的備份");
  ok("brew 收尾與清備份同一張卡，brew 排前面，Windows 仍有自己的那一張");
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
