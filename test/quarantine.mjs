import assert from "node:assert/strict";

import { actions } from "../src/actions.js";
import { FIX_ACTIONS } from "../src/env-check.js";
import {
  CLEANUP_CHECK_IDS,
  QUARANTINE_AREAS,
  quarantineEntries,
  quarantineHome,
  quarantineRow,
} from "../src/quarantine.js";
import { quarantineRoot } from "../src/skill-roots.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

const HOME = "/Users/reed";

// 兩列清理都綠了的樣子。這一列的出現條件全靠它。
const CLEAN = CLEANUP_CHECK_IDS.map((id) => ({ id, status: "ok" }));

function listing(map) {
  return { list: (dir) => map[dir] ?? [] };
}

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

  const entries = quarantineEntries(
    HOME,
    listing({
      [`${quarantineHome(HOME)}/codex-skills`]: ["handoff-20260811"],
      [`${quarantineHome(HOME)}/npm-cli`]: ["codex.cmd-20260811", "codex.ps1-20260811"],
    }),
  );
  assert.equal(entries.length, 3);
  assert.deepEqual(entries[0], {
    name: "handoff-20260811",
    what: "舊版 skill",
    path: `${quarantineHome(HOME)}/codex-skills/handoff-20260811`,
  });
  ok("列得出隔離區裡有什麼，而且講得出每一樣是什麼東西");

  assert.deepEqual(quarantineEntries(HOME, listing({})), []);
  ok("資料夾不存在時回空的，不是拋例外");

  // 隔離區裡有東西、但清理還沒做完 → 這一列不出現。
  //
  // ⚠️ 這是整支測試最重要的一條：隔離區裡的東西正是那兩顆按鈕搬進去的，它們還沒綠
  // 就代表可能還要搬回來。在那之前給刪除鍵，等於在退路還用得到的時候把退路收掉。
  for (const id of CLEANUP_CHECK_IDS) {
    const pending = CLEAN.map((check) =>
      check.id === id ? { id, status: "warn" } : check,
    );
    assert.equal(
      quarantineRow(entries, pending),
      null,
      `${id} 還沒綠就不該出現刪除鍵`,
    );
  }
  assert.equal(quarantineRow(entries, []), null);
  ok("清理還沒做完（或那一列根本不在）時，這一列不出現");

  // 沒東西可刪就不長一列出來——「隔離區：沒有東西」對誰都沒有用。
  assert.equal(quarantineRow([], CLEAN), null);
  ok("隔離區是空的時候不長一列出來");

  const row = quarantineRow(entries, CLEAN);
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

  // 「按之前先列出要刪什麼」——這是唯一一顆刪掉就回不來的按鈕。
  assert.equal(row.guidance.checks.length, entries.length);
  for (const entry of entries) {
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
