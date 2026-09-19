// 命名 hook 是最後一道關卡：模型挑了清單外的 emoji（實測看到 🎯），要在寫檔前
// 換掉，而不是指望改指示措辭能讓模型每次都聽話。
//
// 這裡直接跑真的腳本，用假的 HOME，看寫出來的檔案內容。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform === "win32") {
  console.log("ok - emoji 校驗（Windows 上由 .ps1 版負責，略過）");
  process.exit(0);
}

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(
  repoRoot,
  "materials/skills/hooks/set-session-name.sh",
);

function nameWritten(input) {
  const home = mkdtempSync(path.join(tmpdir(), "jr-emoji-"));
  // CLAUDE_PROJECT_DIR 指到假 HOME：腳本會在工作目錄等於家目錄時跳過專案前綴，
  // 所以這裡量到的就是純粹的 emoji 校驗結果。不設的話前綴會跟著跑測試時的所在
  // 目錄變動（在 repo 裡是 [jr-setup-ui]，在別處是那層資料夾的名字），斷言會飄。
  // 前綴本身另外由 session-name-project-tag.mjs 驗。
  execFileSync("bash", [script, input, String(process.pid)], {
    env: { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: home },
    encoding: "utf8",
  });
  const dir = path.join(home, ".claude", "session-names");
  const [file] = readdirSync(dir);
  return readFileSync(path.join(dir, file), "utf8").trim();
}

assert.equal(nameWritten("🔧 修一個 bug"), "🔧 修一個 bug");
console.log("ok - 清單內的 emoji 原樣保留");

// 🎯 不在那 8 個裡——實測模型真的挑過它。
assert.equal(nameWritten("🎯 測試 hook 能否運行"), "🔍 測試 hook 能否運行");
console.log("ok - 清單外的 emoji 換成 🔍，名字其餘部分不動");

// 📦 是 handoff skill 標「已交接」用的第 9 個。它不在清單裡的時候，每次交接完標題
// 都被悄悄換成 🔍，而且腳本不出聲——看起來像改名整個沒生效（VM 實測查了三輪）。
assert.equal(nameWritten("📦 交接完成"), "📦 交接完成");
console.log("ok - handoff 的 📦 保留，不被換成 🔍");

// hook 每次都注入「emoji 只能從這 8 個選」，而 handoff skill 要求用 📦 標記「已交接」
// ——兩份指示互相矛盾時模型會選 hook 的，於是它寫進 relay 檔的名字一開始就是錯的
// （Windows VM 實測，模型自己說「我錯誤優先套用了 session-namer 的八種 emoji 限制」）。
// 這種衝突查起來特別貴：relay 檔、watcher、環境變數全都是好的，只有內容錯。
for (const hook of [
  "session-auto-namer.sh",
  "session-auto-namer.ps1",
  "codex-session-namer.sh",
  "codex-session-namer.ps1",
]) {
  const text = readFileSync(
    path.join(repoRoot, "materials/skills/hooks", hook),
    "utf8",
  );
  assert(
    text.includes("skill 明確指定前綴時以 skill 為準"),
    `${hook} 的命名規則沒有替 skill 的前綴留例外——會跟 handoff 的 📦 打架`,
  );
}
console.log("ok - 四支命名 hook 的規則都放行 skill 指定的前綴");

// 沒帶 emoji 時不能把真正的第一個詞當成 emoji 吃掉。
assert.equal(nameWritten("完全沒有 emoji"), "🔍 完全沒有 emoji");
console.log("ok - 根本沒帶 emoji 時補一個，且不吃掉原本的字");
