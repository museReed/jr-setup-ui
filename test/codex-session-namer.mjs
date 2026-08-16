// Codex 的自動命名，兩件會靜靜失效的事。
//
// 起因：jr-setup-feedback#8——學生的 Ghostty 分頁從頭到尾是一個大寫的 `T`，改名怎麼
// 做都不動。查下去發現 Codex 這一路有兩個各自獨立的洞：
//
//   一、hook 只會寫 $AI_TAB_SYNC_FILE。wrapper 沒起來時那條路整個不存在，於是
//       sidebar 改到了、分頁一動也不動，而且完全不出聲。Claude 那支
//       （set-session-name.sh）早就有「沒有 sync 檔就直接寫 tty」的備援。
//   二、整條命名沒有任何程式抓得到的落點（sqlite 要 thread id、relay 檔套用即刪），
//       所以嚮導只能請學生自己看標題——真的壞掉時沒有一條測試會紅。
//
// 這支把兩個洞都釘住：行為面真的跑一次 hook，字面面掃那幾個「寫了就不能再退回去」
// 的形狀。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const hook = path.join(
  repoRoot,
  "materials/skills/hooks/codex-session-namer.sh",
);
const hookText = readFileSync(hook, "utf8");

if (process.platform === "win32") {
  console.log("ok - Codex 命名 hook（Windows 上由 .ps1 版負責，略過行為驗證）");
  process.exit(0);
}

// ── 行為：relay 檔進去，sync 檔與副產物出來 ──────────────────────────────
//
// hook 用自己的 $PPID 當 key，而 spawnSync 起的 bash 的父行程就是這支測試，
// 所以 relay 檔的名字是 process.pid。
const NAME = "🐛 命名 hook 測試";
const relayDir = "/tmp/codex-session-namer";
const relay = path.join(relayDir, `${process.pid}.pending`);
const fakeHome = mkdtempSync(path.join(tmpdir(), "jr-codex-namer-"));
const syncFile = path.join(fakeHome, "tab-sync.txt");

mkdirSync(relayDir, { recursive: true });
writeFileSync(relay, `${NAME}\n`);

const result = spawnSync("bash", [hook], {
  input: '{"session_id":"jr-test-not-a-real-thread"}',
  encoding: "utf8",
  env: { ...process.env, HOME: fakeHome, AI_TAB_SYNC_FILE: syncFile },
});

assert.equal(result.status, 0, `hook 非零退出：${result.stderr}`);
assert.equal(
  readFileSync(syncFile, "utf8").trim(),
  NAME,
  "hook 沒有把名字寫進 $AI_TAB_SYNC_FILE，watcher 就沒有東西可以掛上分頁",
);
assert.equal(
  readFileSync(path.join(fakeHome, ".ai-session-names", `${process.pid}.txt`), "utf8").trim(),
  NAME,
  "hook 沒有留下副產物，嚮導的驗證就永遠只能靠學生的眼睛",
);
assert.equal(existsSync(relay), false, "套用完的 relay 檔要刪掉，否則下一輪會再套一次");

rmSync(fakeHome, { recursive: true, force: true });
rmSync(relay, { force: true });
console.log("ok - Codex 命名 hook 會寫 sync 檔、留下副產物，並吃掉 relay 檔");

// ── 字面：wrapper 沒起來時的備援 ────────────────────────────────────────
//
// 這一段沒辦法用行為測——要有一個真的 tty 才驗得到，而測試跑在管線裡。掃形狀就好：
// 拿掉這段等於把 issue#8 原封不動放回去。
assert.match(
  hookText,
  /ps -o tty= -p/,
  "沒有 sync 檔時要自己找控制終端——少了它，沒用 mycodex 起的 session 永遠改不到分頁",
);
assert.match(
  hookText,
  /\\033\]0;%s\\007/,
  "備援要真的寫 OSC 標題序列",
);
assert(
  !/printf '\\033\][^\n]*"\$\{?AI_TAB_SYNC_FILE/.test(hookText),
  "OSC 不能寫進 stdout——那是這支 hook 的 JSON 頻道",
);
console.log("ok - 沒有 wrapper 時，命名 hook 會自己把標題寫進控制終端");

// ── 字面：注入給模型的指令不可以串接 ────────────────────────────────────
//
// 嚮導自己發給 Codex 的規矩（materials/codex/*/AGENTS.md）就是「一個 shell 呼叫只做
// 一件事，不要用 && || ; 串接」。hook 注入一條違反自家規矩的指令，等於在賭模型會照做
// 還是自己拆——而拆錯的那一半就是「名字永遠卡在 relay 檔」。
//
// mkdir 本來也是多的：hook 開頭就 mkdir -p 過 $COUNTER_DIR 了。
const relayInstruction = hookText.slice(
  hookText.indexOf("執行指令（只需這一步"),
  hookText.indexOf("obj = {"),
);
for (const chain of ["&&", "||", ";"]) {
  assert(
    !relayInstruction.includes(chain),
    `注入的改名指令裡有 \`${chain}\`，跟 AGENTS.md 的「一個 shell 呼叫只做一件事」打架`,
  );
}
console.log("ok - 注入給模型的改名指令是單一一條，不串接");

// 三份 skill 文件抄的是同一條指令，一起釘住——只改 hook 不改文件的話，手動叫
// $auto-rename / $handoff 的那條路還是串接的。
for (const doc of [
  "materials/skills/skill-files/codex/_shared/codex-session-rename.md",
  "materials/skills/skill-files/codex/auto-rename/SKILL.md",
  "materials/skills/skill-files/codex/handoff/SKILL.md",
]) {
  const text = readFileSync(path.join(repoRoot, doc), "utf8");
  assert(
    !/mkdir -p \/tmp\/codex-session-namer &&/.test(text),
    `${doc} 還在教模型串接指令`,
  );
  assert(
    /codex-session-namer\/\$\{PPID\}\.pending/.test(text),
    `${doc} 少了寫 relay 檔那一步`,
  );
}
console.log("ok - 三份 skill 文件教的改名指令也是單一一條");

// AGENTS.md 真的有那條規矩，上面幾條斷言才站得住。改了措辭就要一起改這裡。
for (const lang of ["zh-TW", "zh-CN", "en"]) {
  const agents = readFileSync(
    path.join(repoRoot, `materials/codex/${lang}/AGENTS.md`),
    "utf8",
  );
  assert(
    /`&&`/.test(agents),
    `${lang} 的 AGENTS.md 沒有「不要串接」那條規矩，上面的判準就沒有依據`,
  );
}
console.log("ok - AGENTS.md 真的有「不要串接」那條規矩");
