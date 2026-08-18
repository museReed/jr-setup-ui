// 名字會出現在三個地方，而每一個都曾經靜默壞掉過：名稱檔（statusline 讀）、tab 標題、
// 右下角名牌（背景 session 用）。靜默是重點——名字寫進沒人讀的檔案時，畫面上不會有任何
// 錯誤，看起來就像改名整個沒生效，每次都得查上好幾輪。所以這裡把每個表面各釘一顆釘子。
//
// 跟 emoji-guard.mjs 一樣直接跑真的腳本、用假的 HOME 看寫出來的檔案。
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform === "win32") {
  console.log("ok - 命名表面（Windows 上由 .ps1 版負責，略過）");
  process.exit(0);
}

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(repoRoot, "materials/skills/hooks/set-session-name.sh");

// 冒充「被命名的那個 AI process」。用一支 sleep，它的父是本測試，所以不可能有任何真的
// ai-tab-sync.sh watcher 以它為父——找 tab 那段一定會走到最後的 OSC 分支，而那支 sleep
// 沒有 tty，於是什麼都不寫。真實環境的分頁不會被測試碰到。
function withFakeAgent(run) {
  const proc = spawn("sleep", ["30"], { stdio: "ignore" });
  try {
    return run(proc.pid);
  } finally {
    proc.kill();
  }
}

function setName(home, name, { cwd = "/", sessionId = "", jobId = "" } = {}) {
  return withFakeAgent((pid) => {
    mkdirSync(path.join(home, ".claude", "sessions"), { recursive: true });
    if (jobId) {
      mkdirSync(path.join(home, ".claude", "jobs", jobId), { recursive: true });
      writeFileSync(
        path.join(home, ".claude", "jobs", jobId, "state.json"),
        JSON.stringify({ name: null, nameSource: null }),
      );
      writeFileSync(
        path.join(home, ".claude", "sessions", `${pid}.json`),
        JSON.stringify({ pid, kind: "bg", jobId }),
      );
    }
    const env = { ...process.env, HOME: home };
    delete env.CLAUDE_PROJECT_DIR;
    delete env.AI_TAB_SYNC_FILE;
    execFileSync("bash", [script, name, String(pid), sessionId], { cwd, env, encoding: "utf8" });
    const dir = path.join(home, ".claude", "session-names");
    const [file] = readdirSync(dir);
    return readFileSync(path.join(dir, file), "utf8").trim();
  });
}

function newHome() {
  return mkdtempSync(path.join(tmpdir(), "jr-naming-"));
}

function jobState(home, jobId) {
  return JSON.parse(
    readFileSync(path.join(home, ".claude", "jobs", jobId, "state.json"), "utf8"),
  );
}

// --- 專案前綴 -------------------------------------------------------------------------
// AI 在跑的時候 TUI 蓋住 shell 提示字元，tab 標題是唯一還看得出「這是哪個專案」的地方。
assert.equal(
  setName(newHome(), "🔧 修一個 bug", { cwd: repoRoot }),
  `[${path.basename(repoRoot)}] 🔧 修一個 bug`,
  "在專案目錄裡命名要帶上專案前綴",
);
console.log("ok - 專案目錄裡的名字帶 [專案] 前綴");

assert.equal(
  setName(newHome(), "🔧 修一個 bug", { cwd: "/" }),
  "🔧 修一個 bug",
  "根目錄不是專案，不該加前綴",
);
console.log("ok - 不在專案裡就不加前綴");

// 既有名字被重新套用時（handoff 改名、auto-rename 重評）不能再疊一層。
assert.equal(
  setName(newHome(), "[已經有了] 📦 交接完成", { cwd: repoRoot }),
  "[已經有了] 📦 交接完成",
  "已經帶前綴的名字要原樣保留",
);
console.log("ok - 已經帶前綴的名字不會被疊第二層");

// --- 背景 session 的右下角名牌 ---------------------------------------------------------
// nameSource 不是 user / collision 的話，Claude Code 會把自己推導的 slug 重新產生回去，
// 所以 name 和 nameSource 兩個欄位都得寫。
{
  const home = newHome();
  setName(home, "🐛 背景除錯", { cwd: repoRoot, jobId: "testjob", sessionId: "sess-1" });
  const state = jobState(home, "testjob");
  assert.equal(state.nameSource, "user", "背景 session 的 nameSource 要變成 user");
  assert.ok(state.name.endsWith("🐛 背景除錯"), `名牌沒寫進去：${state.name}`);
  console.log("ok - 背景 session 會寫右下角名牌（name + nameSource）");
}

// 純互動 session 沒有 jobId、也沒有 state.json，那段必須整個跳過而不是報錯。
{
  const home = newHome();
  mkdirSync(path.join(home, ".claude", "jobs", "testjob"), { recursive: true });
  writeFileSync(
    path.join(home, ".claude", "jobs", "testjob", "state.json"),
    JSON.stringify({ name: null, nameSource: null }),
  );
  setName(home, "🐛 互動除錯", { cwd: repoRoot });
  assert.equal(jobState(home, "testjob").nameSource, null, "互動 session 不該碰任何 job 名牌");
  console.log("ok - 互動 session 不寫名牌，也不報錯");
}

// --- 名稱檔清理 -----------------------------------------------------------------------
// process 早就不在的名稱檔要清掉，否則每關一個終端就留一個，只增不減。
{
  const home = newHome();
  const dir = path.join(home, ".claude", "session-names");
  mkdirSync(dir, { recursive: true });
  // 活的那個用「本測試自己的 pid」：清理是用 `kill -0` 判斷，而 `kill -0` 對**別的使用者**
  // 的 process 會因為權限失敗，看起來就跟「已經不在」一樣（pid 1 就是這樣，一開始拿它當
  // 對照組直接誤判）。實務上名稱檔的 key 一定是自己的終端 pid，所以不必為此加碼。
  writeFileSync(path.join(dir, `${process.pid}.txt`), "還活著\n");
  writeFileSync(path.join(dir, "999999.txt"), "早就沒了\n");
  setName(home, "🔧 觸發清理", { cwd: "/" });
  const left = readdirSync(dir);
  assert.ok(left.includes(`${process.pid}.txt`), "活著的 process 的名稱檔不該被刪");
  assert.ok(!left.includes("999999.txt"), "死掉的 process 的名稱檔要被刪");
  console.log("ok - 名稱檔按 process 存活清理");
}
