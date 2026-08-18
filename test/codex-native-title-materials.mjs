import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describeStep } from "../src/config-install.js";

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
  }
  ok("Codex auto-rename、handoff 與共用文件不再要求 mycodex 或直接 OSC");

  const ui = read("public", "model.js");
  assert.doesNotMatch(ui, /claude \/ codex wrapper/);
  assert.match(ui, /terminal_title/);
  ok("UI troubleshooting 將 Codex 導向原生 terminal_title");
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
