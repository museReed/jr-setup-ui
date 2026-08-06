// walkthrough 的排序：照學生在嚮導裡實際遇到的順序，不是檔名字母序。
//
// 順序是算出來的，不是另外維護一份清單——卡片重排、合併、加一張，這裡自動跟著動。
// 用的是嚮導自己那支 flattenCheckCards，所以「先後」的定義只有一個來源。
import { CARD_GATES, flattenCheckCards, groupChecks } from "../../public/model.js";
import { VERIFICATION } from "../../src/config-check.js";
import { STEP_IDS } from "../../src/config-install.js";
import { checksForPlatform } from "../../src/env-check.js";

export const PLATFORMS = [
  { id: "darwin", key: "mac", label: "mac" },
  { id: "win32", key: "win", label: "Windows" },
];

const stub = (id) => ({ id, label: id, status: "ok", detail: "已安裝" });

/**
 * 那個平台上，學生會依序遇到哪幾份 walkthrough。
 * 回傳 [{ id, card, section, rank }]，rank 從 0 開始。
 */
// 兩套名字都收：內部用 node 的 process.platform 值，對外（網址、JSON）用 mac / win。
const NODE_PLATFORM = { mac: "darwin", win: "win32", darwin: "darwin", win32: "win32" };

export function walkthroughOrder(platform) {
  const sections = flattenCheckCards(
    groupChecks(STEP_IDS.map(stub)),
    checksForPlatform(NODE_PLATFORM[platform] ?? platform).map((check) => stub(check.id)),
  );
  const out = [];

  for (const section of sections) {
    for (const card of section.cards) {
      // 一張卡上先出現的是清單裡那幾列（眼睛項掛在列上），人工項排在清單最後。
      for (const check of card.checks ?? []) {
        if (VERIFICATION[check.id]?.eye == null) continue;
        out.push({ id: `eye-${check.id}`, card: card.checkId, section: section.sectionId });
      }

      for (const gate of CARD_GATES[card.checkId] ?? []) {
        out.push({ id: gate.id, card: card.checkId, section: section.sectionId });
      }
    }
  }

  return out.map((item, rank) => ({ ...item, rank }));
}

/**
 * 兩個平台合起來的排名。同時存在的以 mac 的位置為準，只有 Windows 有的接在
 * 它前一個的後面——這樣切平台時清單不會整個跳動。
 */
export function mergedOrder() {
  const ranks = new Map();
  let cursor = 0;

  for (const { id } of walkthroughOrder("darwin")) {
    ranks.set(id, cursor);
    cursor += 1;
  }

  let previous = -1;
  for (const { id } of walkthroughOrder("win32")) {
    if (ranks.has(id)) {
      previous = ranks.get(id);
      continue;
    }

    // 沒排過的（Windows 專屬）插在前一個後面，用小數避免動到既有名次。
    previous += 0.001;
    ranks.set(id, previous);
  }

  return ranks;
}
