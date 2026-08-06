// 產 walkthrough 的骨架：哪幾格需要教學步驟，是從真的 VERIFICATION 與 CARD_GATES
// 算出來的，不是手抄的清單——手抄的第二天就跟 code 對不上了。
//
// 規則跟 copy-review-criteria.md 同一條：程式驗得到的不問學生，程式管不到的才要教
// 他怎麼做。所以只有「眼睛項」與「人工項」有 walkthrough，系統驗的那些沒有。
//
// 已經有內容的檔案不覆蓋——這支是補新的，不是重置。
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { VERIFICATION } from "../../src/config-check.js";
import { CARD_GATES, MANUAL_STEPS } from "../../public/model.js";

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(ROOT, "content/walkthroughs");

function slug(text) {
  // 步驟 id 只用在檔名與 JSON 的 key，中文標題產不出好 slug，所以留空給人填。
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function skeleton(id, card, row, hint) {
  return {
    id,
    card,
    row,
    // 主節點一律是「你要做」。第一步先放一個空的，讓編輯器有東西可以接著填。
    steps: [
      {
        id: "step-1",
        title: "",
        detail: "",
        visual: null,
        kids: hint === null ? [] : [{ id: "see-1", kind: "see", title: hint, detail: "", visual: null }],
      },
    ],
  };
}

const jobs = [];

// 眼睛項：那一列的 eye 文案就是學生要看到的東西，直接當第一個「會看到」的標題。
for (const [checkId, spec] of Object.entries(VERIFICATION)) {
  if (spec?.eye == null) continue;
  jobs.push({ id: `eye-${checkId}`, card: checkId, row: spec.eye, hint: spec.eye });
}

// 人工項：掛在某張卡上的勾選格，每一格自己一份。
for (const [cardId, items] of Object.entries(CARD_GATES)) {
  for (const item of items) {
    const step = MANUAL_STEPS[item.stepId];
    jobs.push({
      id: item.id,
      card: cardId,
      row: item.title,
      hint: null,
      note: step === undefined ? null : `${step.title}（按鈕：${step.buttonText}）`,
    });
  }
}

mkdirSync(OUT, { recursive: true });
const existing = new Set(
  existsSync(OUT) ? readdirSync(OUT).filter((name) => name.endsWith(".json")) : [],
);

let made = 0;
for (const job of jobs) {
  const file = `${job.id}.json`;

  if (existing.has(file)) continue;

  const data = skeleton(job.id, job.card, job.row, job.hint);

  if (job.note) {
    data.note = job.note;
  }

  writeFileSync(path.join(OUT, file), `${JSON.stringify(data, null, 2)}\n`);
  made += 1;
}

console.log(`walkthrough 共 ${jobs.length} 份，新增 ${made} 份，既有 ${jobs.length - made} 份沒動。`);
console.log(`落點：${path.relative(ROOT, OUT)}`);

if (process.argv.includes("--list")) {
  for (const job of jobs) console.log(`  ${job.id}  ← ${job.row}`);
}

export { slug };
