// watcher 必須在「生它的那個 shell 沒了」之後自己退出。
//
// .zshrc 裝的 claude/codex 包裝函式在 `command claude` 回來之後才 `kill` watcher——
// 但終端被直接關掉時，zsh 收到 SIGHUP 就沒了，那行 kill 根本沒機會跑。watcher 於是
// 變成孤兒（ppid 1）繼續每秒往 tty 寫標題，直到重開機。
//
// 而 macOS 的 /dev/ttysNNN 號碼會回收：下一個新分頁拿到同一個號碼，就同時被舊 watcher
// 和自己的 watcher 搶著寫，畫面上是標題在兩個名字之間每秒閃爍。2026-08-19 在開發機
// 實測到一台累積了 8 個孤兒，其中 3 個同時在寫 /dev/ttys001。
//
// 這裡用一個「生了 watcher 就被殺掉」的中介 shell 重現那個情境，然後看 watcher 會不會
// 自己走。判準是它的 pid 有沒有消失，不是它有沒有停止寫檔——寫檔停了也可能只是卡住。
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform === "win32") {
  console.log("ok - watcher 孤兒自清（Windows 上由 .ps1 版負責，略過）");
  process.exit(0);
}

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const watcher = path.join(repoRoot, "materials/skills/bin/ai-tab-sync.sh");
const dir = mkdtempSync(path.join(tmpdir(), "jr-tab-sync-orphan-"));
const syncFile = path.join(dir, "sync.txt");
const fakeTty = path.join(dir, "fake-tty.txt");
const pidFile = path.join(dir, "watcher.pid");

writeFileSync(syncFile, "固定不變的名字\n");
writeFileSync(fakeTty, "");

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 中介 shell：起 watcher、把 pid 留下來，然後自己閒著等被殺。
const parent = spawn(
  "bash",
  ["-c", `bash "${watcher}" "${syncFile}" "${fakeTty}" & echo $! > "${pidFile}"; sleep 60`],
  { stdio: "ignore" },
);

let watcherPid = 0;
for (let round = 0; round < 25 && !watcherPid; round += 1) {
  await sleep(100);
  try {
    watcherPid = Number.parseInt(readFileSync(pidFile, "utf8").trim(), 10) || 0;
  } catch {
    // pid 檔還沒寫出來，下一輪再看。
  }
}
assert(watcherPid > 0, "watcher 沒起來，這支測試沒測到東西");
assert(alive(watcherPid), `watcher ${watcherPid} 起來就死了`);

// 殺掉中介 shell，watcher 就被 launchd 收養——正是關終端時發生的事。
parent.kill("SIGKILL");

let exited = false;
// watcher 一輪一秒，但孤兒檢查每 10 輪才做一次（那個檢查要 fork 一支 ps，是迴圈裡最貴
// 的一件事）。所以最久要等約 10 秒，這裡給到 15 秒。
for (let round = 0; round < 75 && !exited; round += 1) {
  await sleep(200);
  exited = !alive(watcherPid);
}

if (!exited) {
  try {
    process.kill(watcherPid, "SIGKILL");
  } catch {
    // 已經走了，那就沒事。
  }
}

assert(
  exited,
  `父行程死了 15 秒後 watcher ${watcherPid} 還活著：它會一直往回收後的 tty 寫標題，造成分頁標題閃爍`,
);

console.log("ok - 父行程消失後 watcher 自己退出");
