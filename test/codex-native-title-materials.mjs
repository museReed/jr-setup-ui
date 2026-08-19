import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describeStep } from "../src/config-install.js";
import { GUIDANCE } from "../public/model.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (...parts) => readFileSync(path.join(REPO_ROOT, ...parts), "utf8");

try {
  const posix = describeStep("codex-namer", {
    lang: "zh-TW",
    home: "/Users/student",
    platform: "darwin",
  });
  assert(
    posix.hookFiles.some(
      ({ source, target }) =>
        source === "skills/hooks/codex-session-name-set.py" &&
        target === "/Users/student/.codex/hooks/codex-session-name-set.py",
    ),
  );
  const windows = describeStep("codex-namer", {
    lang: "zh-TW",
    home: "C:/Users/student",
    platform: "win32",
  });
  assert.equal(
    windows.hookFiles.some(({ target }) => target.endsWith("codex-session-name-set.py")),
    false,
  );
  ok("installer 僅在 POSIX 把 app-server helper 跟 namer 一起安裝");

  for (const file of [
    ["materials", "skills", "skill-files", "codex", "auto-rename", "SKILL.md"],
    ["materials", "skills", "skill-files", "codex", "handoff", "SKILL.md"],
    ["materials", "skills", "skill-files", "codex", "_shared", "codex-session-rename.md"],
  ]) {
    const content = read(...file);
    assert.doesNotMatch(content, /mycodex/i, file.join("/"));
    assert.doesNotMatch(content, /直接.*OSC|OSC.*直接/i, file.join("/"));
    assert.match(content, /POSIX|macOS|Linux/, file.join("/"));
    assert.match(content, /app-server/, file.join("/"));
    assert.match(content, /Windows/, file.join("/"));
    assert.match(content, /SQLite/, file.join("/"));
    assert.match(content, /tab-sync|同步檔/i, file.join("/"));
  }
  ok("Codex skills 清楚拆開 POSIX app-server 與 Windows SQLite + tab-sync");

  const ui = read("public", "model.js");
  assert.doesNotMatch(ui, /claude \/ codex wrapper/);
  assert.match(ui, /terminal_title/);
  const codexGuidance = GUIDANCE["codex-namer"].checks.join("\n");
  assert.match(codexGuidance, /macOS.*Linux.*terminal_title/);
  assert.match(codexGuidance, /Windows.*tab-sync|Windows.*同步/);
  ok("UI troubleshooting 分別說明 POSIX 原生標題與 Windows tab-sync");

  const wrapperGuidance = Object.values(GUIDANCE["shell-wrapper"])
    .flat()
    .join("\n");
  assert.match(wrapperGuidance, /Claude/);
  assert.match(wrapperGuidance, /Codex/);
  ok("shell-wrapper UI copy 同時涵蓋 Claude 與 Codex");

  const acceptance = read("docs", "fresh-vm-acceptance.md");
  assert.match(acceptance, /POSIX.*app-server.*原生/s);
  assert.match(acceptance, /Windows.*SQLite.*tab-sync/s);
  const verification = read("docs", "wizard-verification-design.md");
  assert.match(verification, /POSIX.*app-server.*原生/s);
  assert.match(verification, /Windows.*SQLite.*tab-sync/s);
  ok("驗收與驗證文件沒有把任一平台的 Codex 命名路徑寫成全平台");
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
