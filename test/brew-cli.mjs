// brew 那批殘留的收尾：判準在 src/brew-cli.js，這裡測它問的那幾個問題。
import assert from "node:assert/strict";

import { brewLeftoverRow, commandFromEntry, leftoverCommands } from "../src/brew-cli.js";
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

  // 那顆 action 真的註冊過，不然按下去會回 400。
  assert.notEqual(actions["finish-brew-uninstall"], undefined);
  assert.equal(actions["finish-brew-uninstall"].kind, "fixed");
  ok("收尾那顆 action 註冊過了");

  // ⚠️ 兩列同一張卡，而且順序不能反：刪備份那顆會把隔離區清空，brew 這一步萬一
  // 失敗，那份備份就是唯一還原得回去的東西（Reed 拍板同一張卡兩列）。
  const row = (id, label) => ({ id, label, status: "warn", detail: "x" });
  // 第一張永遠是「選工具 + 選語言」那張 setup 卡，它不是環境檢查來的。
  const envCards = (checks) =>
    flattenCheckCards([], checks)[0].cards.filter(
      (card) => (card.checks ?? []).length > 0,
    );

  const macCards = envCards([
    row("brew-leftover", "Homebrew 那邊也收乾淨了"),
    row("quarantine", "先前搬走的東西還留著"),
  ]);
  assert.equal(macCards.length, 1, "兩列要合成一張卡，不是各自一張");
  assert.deepEqual(
    macCards[0].checks.map((check) => check.id),
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
