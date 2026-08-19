// claude-hud 的狀態列必須自己把 session 名字印出來。
//
// 這張卡會覆蓋 settings.json 的 statusLine，所以學生只要同時裝「命名 hook」和這張卡，
// 名字就從狀態列上消失——而且兩張卡各自都顯示安裝成功，沒有任何一處會說出這件事
//（2026-08-19 開發機實測）。名字沒有別的地方可以出現：Ghostty 沒有 per-split 標題，
// 一個分頁只有一個標題，shell 提示字元又被 TUI 蓋住。
//
// 順帶盯住一件很容易在重構時弄丟的事：stdin 那段 payload 被讀走之後要原封不動轉給
// claude-hud。忘了轉，狀態列不會報錯，只會安靜地少掉一半內容。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const template = path.join(
  repoRoot,
  "materials/claude-code/claude-hud/statusline.mjs.template",
);

// node 不認 .template 副檔名，落地之後才是 .mjs——照安裝後的樣子跑。
const dir = mkdtempSync(path.join(tmpdir(), "jr-statusline-"));
const script = path.join(dir, "statusline.mjs");
copyFileSync(template, script);

// 假的 claude-hud：把收到的 stdin 原樣吐出來，這樣才驗得到 payload 有沒有轉過去。
// 版本資料夾名要像版本號，腳本才會挑到它。
const cacheDir = path.join(dir, "plugins", "cache", "fake", "claude-hud", "9.9.9", "dist");
spawnSync("mkdir", ["-p", cacheDir]);
writeFileSync(
  path.join(cacheDir, "index.js"),
  "process.stdout.write('HUD:' + require('node:fs').readFileSync(0, 'utf8'));\n",
);

function run(payload) {
  const result = spawnSync(process.execPath, [script], {
    input: payload,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_CONFIG_DIR: dir },
  });
  assert.equal(result.status, 0, `狀態列腳本非零結束：${result.stderr}`);
  return result.stdout;
}

const NAME = "[muse-platform] 🐛 修分頁標題閃爍";
const named = run(JSON.stringify({ session_name: NAME, model: { display_name: "Opus" } }));

assert(
  named.split("\n")[0].includes(NAME),
  `狀態列第一行沒有 session 名字：${JSON.stringify(named)}`,
);
console.log("ok - 狀態列第一行是 session 名字");

assert(
  named.includes("HUD:"),
  "claude-hud 沒被跑到——名字印出來但狀態列本體不見了",
);
assert(
  named.includes(`"session_name"`),
  "payload 沒有轉給 claude-hud：stdin 被讀走之後沒有餵回去，狀態列會少掉一半內容",
);
console.log("ok - 讀走的 payload 原封不動轉給 claude-hud");

// Claude Code 自己推導的名字是純小寫英文加連字號。那種不是我們寫的名字，印出來只會
// 讓學生以為命名生效了。
// 只看第一行：假的 claude-hud 會把整段 payload 吐回來，那裡面本來就有這個字串。
const slug = run(JSON.stringify({ session_name: "test-auto-rename" }));
assert(
  slug.startsWith("HUD:"),
  `slug 被當成名字印在第一行了：${JSON.stringify(slug.split("\n")[0])}`,
);
console.log("ok - Claude Code 自己編的 slug 不印");

// 沒有名字、payload 不是 JSON，都不能讓狀態列噴錯——錯誤訊息會被畫進輸入框下面。
run(JSON.stringify({ model: { display_name: "Opus" } }));
run("not json at all");
console.log("ok - 沒有名字或 payload 壞掉時安靜略過，不噴錯");
