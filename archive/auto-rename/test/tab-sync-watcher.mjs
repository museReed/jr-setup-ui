// watcher 必須「每次輪詢都重寫標題」，不能只在名字改變時寫一次。
//
// 只寫一次的話：Claude Code 會蓋上自己的摘要標題、zsh 的 precmd 每次提示字元也把
// 標題重設成 cwd——watcher 卻認為名字沒變、不用寫，於是整個 session 都掛著別人的
// 標題（macOS VM 實測）。這種錯不會噴任何訊息，只是安靜地不生效。
//
// 這裡把「tty」換成一個普通檔案：watcher 只是往那個路徑寫 OSC，不在乎它是不是
// 真的終端。名字全程不變，看檔案的修改時間有沒有一直在跳——不能數內容裡的 OSC
// 次數，因為 `>` 每次都會把檔案截斷，永遠只剩最後一次。
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform === "win32") {
  console.log("ok - watcher 重寫行為（Windows 上由 .ps1 版負責，略過）");
  process.exit(0);
}

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const watcher = path.join(repoRoot, "materials/skills/bin/ai-tab-sync.sh");
const dir = mkdtempSync(path.join(tmpdir(), "jr-tab-sync-test-"));
const syncFile = path.join(dir, "sync.txt");
const fakeTty = path.join(dir, "fake-tty.txt");
const NAME = "固定不變的名字";

writeFileSync(syncFile, `${NAME}\n`);
writeFileSync(fakeTty, "");

const child = spawn("bash", [watcher, syncFile, fakeTty], { stdio: "ignore" });

// watcher 每秒一輪，2.6 秒足夠拿到兩輪以上，又不會讓測試明顯變慢。
const stamps = new Set();

for (let round = 0; round < 13; round += 1) {
  await new Promise((resolve) => setTimeout(resolve, 200));
  try {
    stamps.add(statSync(fakeTty).mtimeMs);
  } catch {
    // 檔案還沒被碰過，下一輪再看。
  }
}

child.kill("SIGKILL");

assert(
  stamps.size >= 2,
  `watcher 只寫了 ${stamps.size} 次：名字沒變它就不再重寫，標題被別人蓋掉後回不來`,
);
assert(
  readFileSync(fakeTty, "utf8").includes(NAME),
  "寫出去的內容不是 sync 檔裡的名字",
);

console.log(`ok - watcher 每輪都重寫標題（2.6 秒內寫了 ${stamps.size} 次）`);
