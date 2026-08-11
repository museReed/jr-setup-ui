// 把 Codex 沙箱要用的檔案接回 codex 會去看的位置。
//
//   先看不動：  node scripts/fix-codex-sandbox.mjs
//   真的接上：  node scripts/fix-codex-sandbox.mjs --apply
//
// 沒有下載、沒有複製：檔案本來就在機器上，只是 PATH 上那條 bin junction 讓 codex
// 往上一層走時走到了別的地方。這裡在它會看的位置補一條 junction 指回真正的那份。
// 判準在 src/codex-sandbox.js，這裡只負責解 junction、建連結、把做了什麼印出來。
import { existsSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";

import { planSandboxLink } from "../src/codex-sandbox.js";
import { spawnEnv } from "../src/env-path.js";
import { findAllExecutables, pickRunnable } from "../src/spawn-command.js";

const APPLY = process.argv.includes("--apply");

if (process.platform !== "win32") {
  console.log("這一項只有 Windows 需要處理。");
  process.exit(0);
}

const env = await spawnEnv();
const codexPath = pickRunnable(
  findAllExecutables("codex", env, {
    platform: "win32",
    fileExists: existsSync,
  }),
  { platform: "win32" },
);

if (codexPath === null) {
  console.log("找不到 codex，請先把 Codex CLI 裝起來。");
  process.exit(1);
}

console.log(`codex：${codexPath}`);

// PATH 上那條 bin 多半是 junction。解開它才問得出真正的套件根在哪。
const binDir = path.dirname(codexPath);
let realBinPath = binDir;

try {
  realBinPath = realpathSync(binDir);
} catch {
  // 解不開就用原本的路徑試——不是 junction 的裝法本來就不需要解。
}

console.log(`實際的 bin：${realBinPath}`);

const plan = planSandboxLink({ codexPath, realBinPath, exists: existsSync });

if (plan === null) {
  console.log("");
  console.log("找不到可以接的 codex-resources——這台的 Codex 套件本身可能缺檔，");
  console.log("請用官方安裝檔重裝一次 Codex（不要用 npm）。");
  process.exit(1);
}

if (plan.alreadyLinked) {
  console.log("");
  console.log(`${plan.linkPath} 已經在了，不用再接。`);
  process.exit(0);
}

console.log("");

if (plan.stale) {
  console.log(`${plan.linkPath} 在，但從那條路走不到沙箱檔案——是斷掉的舊連結，`);
  console.log("先拆掉再重接。");
}

console.log(`要接：${plan.linkPath}`);
console.log(`指向：${plan.targetPath}`);

if (!APPLY) {
  console.log("");
  console.log("以上只是先看不動。加 --apply 才會真的接上。");
  process.exit(0);
}

try {
  // 只拆連結本身。rmSync 對 junction 是刪那條連結，不會跟著進去刪真正的檔案；
  // 但這裡仍然只在確認過 stale 的情況下做，不對任意路徑動手。
  if (plan.stale) {
    rmSync(plan.linkPath, { recursive: false, force: true });
  }

  // junction 而不是 symlink：Windows 上建目錄 junction 不需要管理員權限，
  // symlink 預設要（除非開了開發人員模式）。學生那台兩者都不能假設。
  symlinkSync(plan.targetPath, plan.linkPath, "junction");
} catch (error) {
  console.log("");
  console.log(`接不上：${error.message}`);
  process.exit(1);
}

console.log("");
console.log("✓ 接好了。Codex 現在找得到沙箱要用的檔案。");
