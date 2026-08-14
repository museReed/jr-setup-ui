import assert from "node:assert/strict";

import { actions } from "../src/actions.js";
import { FIX_ACTIONS } from "../src/env-check.js";
import {
  CLEANUP_CHECK_IDS,
  QUARANTINE_AREAS,
  quarantineHome,
  quarantineRow,
  quarantineState,
} from "../src/quarantine.js";
import { quarantineRoot } from "../src/skill-roots.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

const HOME = "/Users/reed";

// 兩列清理都綠了的樣子。這一列的出現條件全靠它。
const CLEAN = CLEANUP_CHECK_IDS.map((id) => ({ id, status: "ok" }));

// ⚠️ 沒登記的目錄回 **null**（＝不存在），不是 []（＝存在但空的）。
function listing(map) {
  return { list: (dir) => map[dir] ?? null };
}

const SKILLS_DIR = `${quarantineHome(HOME)}/codex-skills`;
const NPM_DIR = `${quarantineHome(HOME)}/npm-cli`;

try {
  // 兩支按鈕各自寫死的路徑要跟這裡對得起來。對不起來的話畫面會說「沒東西可刪」，
  // 而磁碟上那份其實還在（而且沒有任何地方講得出它存在）。
  assert.equal(
    `${quarantineHome(HOME)}/codex-skills`,
    quarantineRoot(HOME),
    "skill 那顆搬去的地方跟這裡算出來的不一樣",
  );
  ok("skill 隔離區的路徑兩邊算得出同一個答案");

  assert.deepEqual(
    QUARANTINE_AREAS.map((area) => area.from),
    CLEANUP_CHECK_IDS,
  );
  ok("每個分區都講得出是哪一列搬進去的");

  const state = quarantineState(
    HOME,
    listing({
      [SKILLS_DIR]: ["handoff-20260811"],
      [NPM_DIR]: ["codex.cmd-20260811", "codex.ps1-20260811"],
    }),
  );
  assert.equal(state.used, true);
  assert.equal(state.entries.length, 3);
  assert.deepEqual(state.entries[0], {
    name: "handoff-20260811",
    what: "舊版 skill",
    path: `${SKILLS_DIR}/handoff-20260811`,
  });
  ok("列得出隔離區裡有什麼，而且講得出每一樣是什麼東西");

  // ⚠️ 這兩種要分得出來，否則學生按完「清掉隔離區」整張卡連同里程碑會一起消失。
  const never = quarantineState(HOME, listing({}));
  assert.deepEqual(never, { used: false, entries: [] });
  const cleared = quarantineState(HOME, listing({ [SKILLS_DIR]: [] }));
  assert.deepEqual(cleared, { used: true, entries: [] });
  ok("分得出「從來沒搬過」與「搬過但已經清乾淨」");

  // 隔離區裡有東西、但清理還沒做完 → 這一列不出現。
  //
  // ⚠️ 這是整支測試最重要的一條：隔離區裡的東西正是那兩顆按鈕搬進去的，它們還沒綠
  // 就代表可能還要搬回來。在那之前給刪除鍵，等於在退路還用得到的時候把退路收掉。
  for (const id of CLEANUP_CHECK_IDS) {
    const pending = CLEAN.map((check) =>
      check.id === id ? { id, status: "warn" } : check,
    );
    assert.equal(
      quarantineRow(state, pending),
      null,
      `${id} 還沒綠就不該出現刪除鍵`,
    );
  }
  assert.equal(quarantineRow(state, []), null);
  ok("清理還沒做完（或那一列根本不在）時，這一列不出現");

  // 從來沒搬過東西進來就不長一列出來——「隔離區：沒有東西」對誰都沒有用。
  assert.equal(quarantineRow(never, CLEAN), null);
  ok("從來沒搬過東西進隔離區時，這一列不出現");

  // ⚠️ 但「搬過、已經清乾淨」要留著並打勾。不留的話學生按完那顆按鈕，整張卡連同
  // 里程碑會一起消失（Reed 指定要改掉的正是這個）。
  const done = quarantineRow(cleared, CLEAN);
  assert.notEqual(done, null);
  assert.equal(done.status, "ok");
  assert.equal(done.clearable, undefined);
  assert.equal(FIX_ACTIONS.quarantine("ok", done), null);
  assert.equal(done.guidance, undefined);
  ok("清乾淨之後那一列留著、打勾、不再長按鈕");

  const row = quarantineRow(state, CLEAN);
  assert.notEqual(row, null);
  // ⚠️ 綠燈不是筆誤：判成黃燈的話環境段永遠不會全綠，學生會被一個他明明沒有毛病的
  // 狀態擋在段落閘門外。
  assert.equal(row.status, "ok");
  assert.ok(row.detail.includes("3"));
  assert.ok(
    row.detail.length <= 40,
    `detail 太長會把按鈕擠出畫面：${row.detail}`,
  );
  ok("有東西可刪時是綠燈、說明一行講完");

  // ⚠️ 這一列同時發出三個互相打架的訊號：綠勾、卡片右上角的「已完成」、以及一句
  // 說東西「還留著」的文案。Reed 在 VM 上看到的第一個反應就是「所以這樣是清掉了
  // 嗎」——寫這張卡的人都要問，學生更會。所以文案自己要講出「可選」。
  assert.ok(
    row.detail.includes("刪不刪都行"),
    `這一列的說明要自己講出可選，不能讀起來像待辦：${row.detail}`,
  );
  assert.ok(row.guidance.expected.includes("不影響這張卡的完成"));
  ok("文案自己講出「刪不刪都算完成」，不用學生去猜綠勾的意思");

  // 「按之前先列出要刪什麼」——這是唯一一顆刪掉就回不來的按鈕。
  assert.equal(row.guidance.checks.length, state.entries.length);
  for (const entry of state.entries) {
    assert.ok(
      row.guidance.checks.some((line) => line.includes(entry.name)),
      `${entry.name} 沒有出現在按之前的清單裡`,
    );
  }
  ok("要刪的東西一條一條列在卡片上，不是按下去才在終端裡追認");

  // 這一列跟其他每一列相反：綠燈才有按鈕。走到這裡就代表該清的都清完了。
  assert.equal(FIX_ACTIONS.quarantine("ok", row), "clear-quarantine");
  assert.ok(
    Object.hasOwn(actions, "clear-quarantine"),
    "按鈕指向一個沒註冊的 action，按下去只會什麼都不發生",
  );
  ok("綠燈掛得上刪除鍵，而且那顆 action 真的註冊過");

  // ⚠️ 合併的還原點與 .bak 不在範圍內（Reed 拍板）。範圍一旦擴到 .jr-setup 那一層，
  // 學生自己寫的規則就再也救不回來了。
  assert.equal(quarantineHome(HOME), `${HOME}/.jr-setup/quarantine`);
  assert.ok(!`${HOME}/.jr-setup/merge-backups`.startsWith(quarantineHome(HOME)));
  ok("刪除範圍只到 quarantine 這一層，合併的還原點在外面");
} catch (error) {
  console.error(error);
  process.exit(1);
}
