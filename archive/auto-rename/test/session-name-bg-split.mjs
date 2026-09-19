// 命名腳本有兩條互斥的路，走錯就是使用者看得到的 bug：
//
//   背景 session（sessions/{pid}.json 裡有 jobId）
//     只寫 jobs/{jobId}/state.json。它跟「生它的那個互動 session」共用同一個終端
//     分頁，如果它也去寫 tab，兩邊會搶著寫，標題在兩個名字之間來回閃（macOS 實測）。
//
//   互動 session（沒有 jobId）
//     寫 sync 檔或 OSC，維持原本的行為。
//
// 這裡直接跑真的腳本，用假的 HOME 造出兩種狀態，看它寫了什麼、沒寫什麼。
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform === "win32") {
  console.log("ok - 背景／互動分流（Windows 上由 .ps1 版負責，尚未移植，略過）");
  process.exit(0);
}

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(
  repoRoot,
  "materials/skills/hooks/set-session-name.sh",
);

// 每個案例一個乾淨的假 HOME。projectDir 不給就指到 HOME——腳本在工作目錄等於家目錄
// 時會跳過專案前綴，斷言才不會跟著「測試在哪個資料夾跑」飄動。
function makeHome() {
  const home = mkdtempSync(path.join(tmpdir(), "jr-bgsplit-"));
  mkdirSync(path.join(home, ".claude", "sessions"), { recursive: true });
  return home;
}

function run(home, name, { pid = process.pid, env = {} } = {}) {
  execFileSync("bash", [script, name, String(pid)], {
    env: { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: home, ...env },
    encoding: "utf8",
  });
}

function nameFile(home) {
  const dir = path.join(home, ".claude", "session-names");
  const files = readdirSync(dir).filter((f) => f.endsWith(".txt"));
  return readFileSync(path.join(dir, files[0]), "utf8").trim();
}

// ── 專案前綴 ──────────────────────────────────────────────────────────
// AI 在跑的時候 TUI 蓋住 shell 提示字元，名字是唯一還看得出「這是哪個專案」的地方。

{
  const home = makeHome();
  const proj = path.join(home, "my-project");
  mkdirSync(proj, { recursive: true });
  run(home, "🔧 修一個 bug", { env: { CLAUDE_PROJECT_DIR: proj } });
  assert.equal(nameFile(home), "[my-project] 🔧 修一個 bug");
  console.log("ok - 工作目錄是專案時，名字前面加上 [專案名]");
}

{
  const home = makeHome();
  run(home, "🔧 修一個 bug");
  assert.equal(nameFile(home), "🔧 修一個 bug");
  console.log("ok - 工作目錄就是家目錄時不加前綴（家目錄不算專案）");
}

{
  // 既有名字被重新套用一次（例如 skill 把上一輪的名字原樣寫回來）不該再包一層，
  // 而且開頭的 `[` 不可以被 emoji 校驗當成「沒有 emoji」而補上 🔍。
  const home = makeHome();
  const proj = path.join(home, "my-project");
  mkdirSync(proj, { recursive: true });
  run(home, "[other] 🔧 修一個 bug", { env: { CLAUDE_PROJECT_DIR: proj } });
  assert.equal(nameFile(home), "[other] 🔧 修一個 bug");
  console.log("ok - 已經帶前綴的名字原樣保留，不重複加、不補 emoji");
}

// ── 背景 session：只寫 job state，不碰 tab ────────────────────────────

{
  const home = makeHome();
  const jobId = "abc12345";
  writeFileSync(
    path.join(home, ".claude", "sessions", `${process.pid}.json`),
    JSON.stringify({ pid: process.pid, kind: "bg", jobId }),
  );
  const jobDir = path.join(home, ".claude", "jobs", jobId);
  mkdirSync(jobDir, { recursive: true });
  const statePath = path.join(jobDir, "state.json");
  // 剛建立的 job 記錄 name 和 nameSource 都是 null，不是 "auto"——守衛寫成
  // 「只處理 auto」的話這種 job 會被整個跳過。
  writeFileSync(
    statePath,
    JSON.stringify({ state: "working", name: null, nameSource: null }),
  );

  const syncFile = path.join(home, "sync.txt");
  writeFileSync(syncFile, "(等待命名)\n");

  run(home, "⛴️ 背景跑測試", { env: { AI_TAB_SYNC_FILE: syncFile } });

  const state = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(state.name, "⛴️ 背景跑測試");
  assert.equal(state.nameSource, "user");
  console.log("ok - 背景 session 把名字寫進 job state，且 nameSource 標成 user");

  assert.equal(state.state, "working");
  console.log("ok - job state 其餘欄位原封不動");

  assert.equal(readFileSync(syncFile, "utf8"), "(等待命名)\n");
  console.log("ok - 背景 session 不碰 tab 的 sync 檔（不跟互動 session 搶標題）");
}

// ── 互動 session：照舊寫 sync 檔 ──────────────────────────────────────

{
  const home = makeHome();
  // 沒有 sessions/{pid}.json ⇒ 讀不到 jobId ⇒ 走互動路徑。JSON 壞掉、沒有 python3
  // 也是同樣的結果：退回互動，而不是整個壞掉。
  const syncFile = path.join(home, "sync.txt");
  writeFileSync(syncFile, "(等待命名)\n");

  run(home, "🔧 互動改名", { env: { AI_TAB_SYNC_FILE: syncFile } });

  assert.equal(readFileSync(syncFile, "utf8").trim(), "🔧 互動改名");
  console.log("ok - 互動 session 照舊寫 sync 檔");
}

{
  const home = makeHome();
  writeFileSync(
    path.join(home, ".claude", "sessions", `${process.pid}.json`),
    "{ 這不是合法的 JSON",
  );
  const syncFile = path.join(home, "sync.txt");
  writeFileSync(syncFile, "(等待命名)\n");

  run(home, "🔧 記錄檔壞掉", { env: { AI_TAB_SYNC_FILE: syncFile } });

  assert.equal(readFileSync(syncFile, "utf8").trim(), "🔧 記錄檔壞掉");
  console.log("ok - session 記錄檔壞掉時退回互動路徑，不是整支失敗");
}

// ── 名稱檔清理 ────────────────────────────────────────────────────────
// 每關一個終端就留一個檔，不清的話永遠只增不減。

{
  const home = makeHome();
  // 借一個已經結束的子行程的 pid 當「死掉的終端」。
  const dead = spawnSync("true");
  const namesDir = path.join(home, ".claude", "session-names");
  mkdirSync(namesDir, { recursive: true });
  writeFileSync(path.join(namesDir, `${dead.pid}.txt`), "🔧 早就關掉的分頁\n");

  run(home, "🔧 現在這個分頁");

  const left = readdirSync(namesDir);
  assert.equal(left.includes(`${dead.pid}.txt`), false);
  console.log("ok - process 已經不在的名稱檔會被刪掉");

  assert.equal(left.length >= 1, true);
  console.log("ok - 活著的 process 的名稱檔保留");
}
