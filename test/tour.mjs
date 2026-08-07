// 導覽的判斷邏輯：要不要跑版面導覽、這張卡要不要跳提示。
// 畫泡泡那半在 tour.js（碰 DOM，測不了），這裡測的是它問的那些問題。
import assert from "node:assert/strict";
import {
  CARD_HINTS,
  COMPONENT_TOUR_STEPS,
  LAYOUT_TOUR_STEPS,
  hintForCard,
  newComponentSteps,
  replayableSteps,
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

  // 已經做完的卡不跳。這幾張的提示全是「不先知道就會卡死或誤判」——「改完要重開
  // 終端」「不先放行後面都會失敗」——那些話只在還沒做成的時候有用。卡片已經綠了
  // 還跳出來教人怎麼做，是在講一件已經發生過的事（Reed 在中文編碼那張看到的：
  // 清單寫著「讀得到中文」，泡泡還在說改完要重開）。
  assert.equal(
    hintForCard({
      cardId: "powershell-encoding",
      seenIds: new Set(),
      runInProgress: false,
      tourRunning: false,
      cardDone: true,
    }),
    null,
  );
  assert.equal(
    hintForCard({
      cardId: "powershell-encoding",
      seenIds: new Set(),
      runInProgress: false,
      tourRunning: false,
      cardDone: false,
    })?.cardId,
    "powershell-encoding",
  );
  ok("已經做完的卡不跳提示——那句話講的是還沒做成時才成立的事");

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
    "execution-policy",
    "powershell-encoding",
    "tab-sync",
  ]);
  ok("只有三張會卡死或誤判的卡片有提示");

  // ── 元件導覽 ────────────────────────────────────────────────
  //
  // 六個元件一定要講到，順序就是學生操作的順序。以元件為單位記，不是以卡為單位：
  // 手動清單要到第三張卡才第一次出現，貼證明的輸入框只有 Claude Code 那張有，
  // 「重跑驗證」跟環境段的「再 check 一次」是兩件事——以卡為單位的話，這些後面
  // 才第一次遇到的元件永遠沒人講（Reed 在 VM 上實際卡到）。
  //
  // 原始輸出不在這裡：它是右邊終端的一部分，不屬於任何一張卡，已經併進版面導覽
  //（留在這裡的話，第一張卡會為了它單獨跳一個 1/1 的泡泡）。
  assert.deepEqual(
    COMPONENT_TOUR_STEPS.map((step) => step.id),
    [
      "checklist-system",
      "checklist-manual",
      "step-action",
      "paste-proof",
      "retest-rescan",
      "cancel-run",
    ],
  );
  assert(
    !COMPONENT_TOUR_STEPS.some((step) => step.element === "#raw-output-details"),
  );
  assert(
    LAYOUT_TOUR_STEPS.some((step) => step.element === "#raw-output-details"),
  );
  for (const step of COMPONENT_TOUR_STEPS) {
    assert(step.element.length > 0);
    assert(step.title.length > 0);
    assert(step.description.length > 0);
  }
  ok("元件導覽涵蓋六個元件；原始輸出歸版面導覽，不讓第一張卡為它單獨跳一次");

  const all = new Set(COMPONENT_TOUR_STEPS.map((step) => step.id));
  const componentBase = {
    present: all,
    seenIds: new Set(),
    layoutSeen: true,
    runInProgress: false,
    tourRunning: false,
  };

  // 沒講過而且現在指得到的才講。
  assert.deepEqual(
    newComponentSteps(componentBase).map((step) => step.id),
    [
      "checklist-system",
      "checklist-manual",
      "step-action",
      "paste-proof",
      "retest-rescan",
    ],
  );
  assert.deepEqual(
    newComponentSteps({
      ...componentBase,
      seenIds: new Set(["checklist-system", "retest-rescan"]),
    }).map((step) => step.id),
    ["checklist-manual", "step-action", "paste-proof"],
  );
  assert.deepEqual(
    newComponentSteps({
      ...componentBase,
      present: new Set(["checklist-system"]),
    }).map((step) => step.id),
    ["checklist-system"],
  );
  assert.deepEqual(newComponentSteps({ ...componentBase, layoutSeen: false }), []);
  assert.deepEqual(newComponentSteps({ ...componentBase, tourRunning: true }), []);
  ok("元件導覽只講「沒講過而且現在指得到」的那幾個");

  // 取消鈕只有跑起來才出現，所以它反過來：正在跑的時候只講它，其餘一律等跑完
  // ——泡泡會蓋住終端正在印的字。
  assert.deepEqual(
    newComponentSteps({ ...componentBase, runInProgress: true }).map(
      (step) => step.id,
    ),
    ["cancel-run"],
  );
  assert.deepEqual(
    newComponentSteps({
      ...componentBase,
      runInProgress: true,
      seenIds: new Set(["cancel-run"]),
    }),
    [],
  );
  ok("取消鈕只在跑起來那一刻講一次，其餘元件不在執行中打斷");

  // 「這頁怎麼用」把這張卡上的元件重講一遍，包含已經講過的——但不包含只有執行中
  // 才指得到的取消鈕（按下去的當下沒在跑，那一步會貼到畫面左上角）。
  assert.deepEqual(
    replayableSteps({ present: all }).map((step) => step.id),
    [
      "checklist-system",
      "checklist-manual",
      "step-action",
      "paste-proof",
      "retest-rescan",
    ],
  );
  assert.deepEqual(
    replayableSteps({ present: new Set(["retest-rescan"]) }).map(
      (step) => step.id,
    ),
    ["retest-rescan"],
  );
  // 一個元件都指不到的卡（選工具那張）就沒有東西好重看，按鈕跟著收起來。
  assert.deepEqual(replayableSteps({ present: new Set() }), []);
  ok("這頁怎麼用重講這張卡上的元件，沒有元件的卡不留按鈕");
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
