// 導覽的判斷邏輯：要不要跑版面導覽、這張卡要不要跳提示。
// 畫泡泡那半在 tour.js（碰 DOM，測不了），這裡測的是它問的那些問題。
import assert from "node:assert/strict";
import {
  CARD_HINTS,
  LAYOUT_TOUR_STEPS,
  hintForCard,
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

  // 提示只留給「不講就會踩坑」的那幾張：順序關鍵的、一張裝兩份的。
  assert.deepEqual(Object.keys(CARD_HINTS).sort(), [
    "codex-config",
    "execution-policy",
    "output-style",
    "tab-sync",
  ]);
  ok("只有四張會踩坑的卡片有提示");
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
