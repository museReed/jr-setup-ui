// 卡片上顯示的那句話，跟「開啟並自動送出這句話」那顆按鈕真的送進終端的那句話，
// 必須一字不差——否則 Claude 印出來的東西對不上學生要貼回去的欄位，那一格就永遠
// 過不了，而且畫面上看起來完全正常（兩邊各自都對，只是不一樣）。
//
// 不用 import 把常數共用：verify-in-terminal.mjs 是一支跑起來就會開終端視窗的
// 腳本，為了一個字串去 import 它並不划算。改成讀檔比對字面。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FULLSCREEN_PROMPT, FULLSCREEN_PROOF } from "../public/model.js";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = readFileSync(
  path.join(repoRoot, "scripts/verify-in-terminal.mjs"),
  "utf8",
);

assert.ok(
  script.includes(FULLSCREEN_PROMPT),
  `verify-in-terminal.mjs 裡的 fullscreen-proof 提示詞跟卡片上的不一樣。\n` +
    `卡片上是：${FULLSCREEN_PROMPT}`,
);
console.log("ok - 按鈕送出的那句話跟卡片上顯示的一字不差");

assert.ok(
  script.includes(FULLSCREEN_PROOF),
  "verify-in-terminal.mjs 裡沒有要比對的代碼",
);
console.log("ok - 送進終端的那句話含有要比對的代碼");

// 兩個 case 都要在，缺一顆按鈕就會按下去噴 400。
for (const name of ["fullscreen-open", "fullscreen-proof"]) {
  assert.ok(script.includes(`"${name}"`), `verify-in-terminal.mjs 少了 ${name}`);
}

const actions = readFileSync(path.join(repoRoot, "src/actions.js"), "utf8");
for (const name of ["fullscreen-open", "fullscreen-proof"]) {
  assert.ok(actions.includes(`"${name}"`), `actions.js 的白名單少了 ${name}`);
}
console.log("ok - 兩個 case 在腳本與 action 白名單裡都有");
