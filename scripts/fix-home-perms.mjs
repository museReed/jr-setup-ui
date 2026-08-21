// 把家目錄裡那幾樣被 root 拿走的設定檔改回學生自己的。
//
//   先看不動：  node scripts/fix-home-perms.mjs
//   真的開視窗：node scripts/fix-home-perms.mjs --apply
//
// ⚠️ 為什麼開一個新的終端視窗，不在嚮導的管線裡跑：
//
//   chown 要 sudo，而 sudo 要一個 tty 才問得到密碼。嚮導 spawn 出來的子行程是
//   stdio: pipe、沒有 tty，sudo 在那裡不會問，只會直接失敗
//   （docs/vm-setup-macos.md 記過同一件事，install-configs.mjs 的註解也是）。
//
// ⚠️ 也不要在嚮導裡開一格輸入框收密碼再餵給 sudo。那等於教學生「把 Mac 密碼打進
// 一個網頁」——這門課後面整段都在講不要這樣做。
//
// ⚠️ 判準跟畫面上那一列共用同一支函式（blockedWriteTargets）。兩邊各寫一份的話會
// 出現「畫面說有問題、按下去卻說沒事」，那是最傷信任的那種不一致（leftovers 那兩顆
// 也是為了這個共用 npm ls -g）。
import { spawn } from "node:child_process";
import { accessSync, chmodSync, constants, existsSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import { blockedWriteTargets } from "../src/home-perms.js";
import { markStepFixed } from "../src/progress-state.js";
import { terminalCommand } from "../src/terminal-window.js";

const APPLY = process.argv.includes("--apply");
const HOME = homedir();

function writable(target) {
  try {
    accessSync(target, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function blocked() {
  return blockedWriteTargets(HOME, { exists: existsSync, writable });
}

// 「家目錄本身」那一項的路徑就是家目錄，其他的接在後面。
//
// ⚠️ 家目錄本身只 chown 它自己、**不加 -R**：整個家目錄遞迴下去會掃到學生的
// Library、iCloud、上百萬個檔案，跑很久不說，也遠遠超出我們該碰的範圍
//（跟 leftovers.js 那條「只動我們自己搬走的」界線同一個道理）。
function targetsOf(items) {
  return items.map((item) =>
    item.name === "家目錄本身"
      ? { path: HOME, recursive: false }
      : { path: path.join(HOME, item.name), recursive: true },
  );
}

if (process.platform === "win32") {
  console.log("這一項只有 mac / Linux 會遇到，這台機器上不用做。");
  process.exit(0);
}

const items = blocked();

if (items.length === 0) {
  console.log("家目錄裡該寫的那幾樣都是你的，沒有東西要修。");
  process.exit(0);
}

console.log("這幾樣現在不是你的，嚮導寫不進去：");
console.log("");

for (const item of items) {
  console.log(`  ● ${item.name}——${item.why}`);
}

console.log("");
console.log("會開一個新的終端視窗，在那裡把它們改回你自己的。");
console.log("");
console.log("在那個視窗裡：");
console.log("  1. 它會問你的 Mac 密碼——打字的時候畫面上不會有任何反應，那是正常的");
console.log("  2. 打完按 Enter");
console.log("  3. 看到「改好了」就成功了");
console.log("");
console.log("只動上面列出的那幾樣，你自己的檔案不碰。");
console.log("");

if (!APPLY) {
  console.log("以上只是先看不動。加 --apply 才會真的開視窗。");
  process.exit(0);
}

// 單引號包起來：家目錄裡有空白的機器（"Chung Han"）不包會被拆成兩個參數。
function quote(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

const targets = targetsOf(items);
const recursive = targets.filter((target) => target.recursive);
const plain = targets.filter((target) => !target.recursive);
const quoted = targets.map((target) => quote(target.path)).join(" ");
const chowns = [
  ...(plain.length > 0
    ? [`sudo chown "$(id -un):$(id -gn)" ${plain.map((t) => quote(t.path)).join(" ")}`]
    : []),
  ...(recursive.length > 0
    ? [
        `sudo chown -R "$(id -un):$(id -gn)" ${recursive
          .map((t) => quote(t.path))
          .join(" ")}`,
      ]
    : []),
];

// ⚠️ 第一行先講會發生什麼。學生按下按鈕之後跳出來的是一個問密碼的黑視窗，沒有這
// 幾行的話第一個反應是關掉它。
const BODY = [
  `echo "把這幾樣改回你自己的："`,
  ...items.map((item) => `echo "  ● ${item.name}"`),
  `echo ""`,
  `echo "接下來要輸入你的 Mac 密碼（畫面上不會顯示，打完按 Enter）："`,
  // ⚠️ 一條一條跑、任何一條失敗就停：密碼打錯三次之後 sudo 會直接放棄，那時後面
  // 那條再跑一次只會再問一次，學生看到的是同一個問題問了兩遍。
  "set -e",
  ...chowns,
  // ⚠️ 換完主人再補一次「自己寫得進去」。改主人是這件事的九成——root 建出來的東西
  // 多半是 644／755，換完就寫得進去了——但也有唯讀模式那一種（444），那時只 chown
  // 的話畫面上那一列會一直說還沒好，而學生已經照著做完了。
  //
  // ⚠️ 不加 -R：只補這幾樣自己的寫入位。遞迴下去會把學生刻意設成唯讀的東西一起改掉。
  `chmod u+w ${quoted}`,
  `echo ""`,
  `echo "✓ 改好了。這個視窗可以關掉，回嚮導按一次「重新檢查」。"`,
].join("\n");

const file = path.join(tmpdir(), "jr-setup-fix-home-perms.command");
// 檔名不帶時間戳：同一台機器上重跑很正常，蓋掉上一份就好。
writeFileSync(file, `#!/bin/zsh\n${BODY}\n`);
chmodSync(file, 0o755);

const { cmd, args } = terminalCommand(file, {
  platform: process.platform,
  home: HOME,
  exists: existsSync,
  // 這支只跑 chown，profile 對它沒有用處。
  loadProfile: false,
});
spawn(cmd, args, { stdio: "ignore", detached: true }).unref();

console.log("已經開了一個新的終端視窗，請看那個視窗。");
console.log("");

// ⚠️ 不要等視窗關掉，等的是**狀態本身**——判準跟畫面上那一列同一支函式。學生
// 打完密碼那一刻就算完成，不用他多做一個關窗的動作（沙箱那支也是這樣等的）。
const POLL_MS = 1000;
const TIMEOUT_MS = 3 * 60 * 1000;
const startedAt = Date.now();
let announced = 0;

while (blocked().length > 0) {
  if (Date.now() - startedAt > TIMEOUT_MS) {
    console.log("");
    console.log("等了三分鐘還沒改好。三種可能：");
    console.log("");
    console.log("  ● 那個視窗還停在問密碼——輸入的是你**開機用的** Mac 密碼，不是 GitHub 的");
    console.log("  ● 密碼打錯三次，那個視窗已經放棄了——再按一次這顆按鈕");
    console.log("  ● 你的帳號不是這台 Mac 的管理者，那就要請這台機器的管理者來按");
    process.exit(0);
  }

  const waited = Math.floor((Date.now() - startedAt) / 15000);

  if (waited > announced) {
    announced = waited;
    console.log(`等那個視窗完成⋯⋯（${waited * 15} 秒）`);
  }

  await new Promise((resolve) => setTimeout(resolve, POLL_MS));
}

// 記一筆「這台修過了」。不記的話這一列會在修好的當下整個消失——判準本來就是
// 「現在還有沒有被鎖住的東西」，鎖沒了它就沒有理由出現。學生按下按鈕、卡片不見，
// 他不會覺得做完了，他會覺得自己剛剛弄壞了什麼（見 progress-state 的 markStepFixed）。
await markStepFixed("home-perms");

console.log("");
console.log("✓ 家目錄裡那幾樣已經是你的了。那個終端視窗可以關掉。");
console.log("  這一列會留著打勾，不會消失。");
