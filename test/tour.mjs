// 導覽的判斷邏輯：要不要跑版面導覽、這張卡要不要跳提示。
// 畫泡泡那半在 tour.js（碰 DOM，測不了），這裡測的是它問的那些問題。
import assert from "node:assert/strict";
import {
  CARD_HINTS,
  CARD_TOUR_STEPS,
  LAYOUT_TOUR_STEPS,
  hintForCard,
  shouldRunCardTour,
  shouldRunLayoutTour,
} from "../public/tour-model.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

try {
  // 版面導覽要等第一張卡真的畫出來。骨架在、卡片區還空的話，泡泡會指到一個
  // 沒有高度的方框。
  assert.equal(shouldRunLayoutTour({ seen: false, cardReady: true }), true);
  assert.equal(shouldRunLayoutTour({ seen: false, cardReady: false }), false);
  assert.equal(shouldRunLayoutTour({ seen: true, cardReady: true }), false);
  ok("版面導覽只在第一次、而且卡片畫出來之後才跑");

  // 骨架選擇器不能指到卡片內部——那些元素每翻一張就被丟掉重生。
  for (const step of LAYOUT_TOUR_STEPS) {
    assert.match(step.element, /^#[\w-]+$/, `${step.element} 要是骨架的 id`);
    assert(step.title.length > 0);
    assert(step.description.length > 0);
  }
  ok("版面導覽每一步都指骨架的 id，而且標題與說明都有寫");

  // 跑到一半跳提示會蓋住終端正在印的字。
  assert.equal(
    hintForCard({
      cardId: "execution-policy",
      seenIds: new Set(),
      runInProgress: true,
      tourRunning: false,
    }),
    null,
  );
  assert.equal(
    hintForCard({
      cardId: "execution-policy",
      seenIds: new Set(),
      runInProgress: false,
      tourRunning: true,
    }),
    null,
  );
  ok("執行中或版面導覽進行中都不跳單張提示");

  // 同一張卡只講一次。每次翻回來都跳一次泡泡，第三次就變成擋路的東西。
  const hint = hintForCard({
    cardId: "execution-policy",
    seenIds: new Set(),
    runInProgress: false,
    tourRunning: false,
  });
  assert.equal(hint.cardId, "execution-policy");
  assert.match(hint.description, /排在最前面/);
  assert.equal(
    hintForCard({
      cardId: "execution-policy",
      seenIds: new Set(["execution-policy"]),
      runInProgress: false,
      tourRunning: false,
    }),
    null,
  );
  ok("有提示的卡片會回傳文案，看過之後不再回傳");

  // 沒登記的卡片安安靜靜。不是每張都要跳泡泡。
  assert.equal(
    hintForCard({
      cardId: "node",
      seenIds: new Set(),
      runInProgress: false,
      tourRunning: false,
    }),
    null,
  );
  assert.equal(
    hintForCard({
      cardId: "",
      seenIds: new Set(),
      runInProgress: false,
      tourRunning: false,
    }),
    null,
  );
  assert.equal(
    hintForCard({
      cardId: undefined,
      seenIds: new Set(),
      runInProgress: false,
      tourRunning: false,
    }),
    null,
  );
  ok("沒登記提示的卡片不跳泡泡，缺 cardId 也不會炸");

  // 提示只留給「不講就會卡死或誤判」的那幾張。三十張卡有二十張跳泡泡的話，
  // 第五張之後學生就開始無腦點掉了——泡泡的價值來自它很少出現。
  //
  // 這條會擋下「順手再加一張」。真的要加，先問自己：不講的話學生會不會卡死或
  // 誤判？只是「知道會比較好」的，寫進卡片描述或清單的眼睛文案。
  assert.deepEqual(Object.keys(CARD_HINTS).sort(), [
    "codex-namer",
    "execution-policy",
    "ext-playwright-claude",
    "ext-playwright-codex",
    "powershell-encoding",
    "tab-sync",
  ]);
  ok("只有六張會卡死或誤判的卡片有提示");

  // ── 「這張卡怎麼用」──────────────────────────────────────────
  //
  // 要等第一張真的有自查清單的卡，而且不能跟版面導覽疊在一起跑。
  const base = {
    seen: false,
    hasChecklist: true,
    layoutSeen: true,
    runInProgress: false,
    tourRunning: false,
  };
  assert.equal(shouldRunCardTour(base), true);
  assert.equal(shouldRunCardTour({ ...base, hasChecklist: false }), false);
  assert.equal(shouldRunCardTour({ ...base, layoutSeen: false }), false);
  assert.equal(shouldRunCardTour({ ...base, seen: true }), false);
  assert.equal(shouldRunCardTour({ ...base, runInProgress: true }), false);
  assert.equal(shouldRunCardTour({ ...base, tourRunning: true }), false);
  ok("卡片導覽只在第一張有清單的卡、版面導覽看完之後跑一次");

  // 四件事一定要講到：系統驗的、你自己勾的、按鈕何時按、原始輸出是什麼。
  assert.equal(CARD_TOUR_STEPS.length, 4);
  assert.deepEqual(
    CARD_TOUR_STEPS.map((step) => step.element),
    [
      ".ds-checklist .ds-check.is-system",
      ".ds-checklist .ds-check.is-manual",
      ".env-actions",
      "#raw-output-details",
    ],
  );
  for (const step of CARD_TOUR_STEPS) {
    assert(step.title.length > 0);
    assert(step.description.length > 0);
  }
  ok("卡片導覽講滿四件事：系統驗的、你自己勾的、按鈕何時按、原始輸出");
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
