import assert from "node:assert/strict";

import { isProgressNoise } from "../src/output-noise.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

const ESC = String.fromCharCode(27);

// 素材是 Windows VM 上裝 Python 那次的原始輸出，照貼回來的樣子。
const DROPPED = [
  "   - ",
  "   \\ ",
  "   | ",
  "   / ",
  "  - \\ | / - \\ | / - \\ ",
  "  █▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒  1024 KB / 27.2 MB",
  "  ██████████████████████████████  27.2 MB / 27.2 MB",
  // 安裝階段的進度條帶色碼。
  `  ${ESC}[32m- ${ESC}[0m\\ ${ESC}[36m| ${ESC}[0m/ `,
];

for (const line of DROPPED) {
  assert.equal(isProgressNoise(line), true, line);
}
ok("winget 的轉圈符號與進度條整行丟掉，帶色碼的也認得");

// 留下來的：這幾行是安裝到底發生什麼事的唯一線索，一行都不能被吃掉。
const KEPT = [
  "Found Python 3.13 [Python.Python.3.13] Version 3.13.14",
  "Downloading https://www.python.org/ftp/python/3.13.14/python-3.13.14-arm64.exe",
  "Successfully verified installer hash",
  "Starting package install...",
  "Successfully installed",
  "exit code: 2147500036",
  // 迴歸：winget 把訊息接在轉圈符號後面。整行都是進度才丟，帶內容的一律留。
  "   \\ Cancelling operation",
  // 迴歸：ESC 沒進正規式的話，這種一般文字的開頭會被當成色碼吃掉。
  "[warn] PowerShell 執行原則：檢查逾時，請再按一次重新檢查",
  // 空白行是安裝器的分段，不是雜訊。
  "",
  "   ",
];

for (const line of KEPT) {
  assert.equal(isProgressNoise(line), false, line);
}
ok("帶內容的行一律留著，含接在轉圈符號後面的訊息與空白分隔行");

assert.equal(isProgressNoise(undefined), false);
assert.equal(isProgressNoise(null), false);
assert.equal(isProgressNoise(123), false);
ok("非字串安全回傳 false");
