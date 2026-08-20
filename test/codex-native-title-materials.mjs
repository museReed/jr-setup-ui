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
  assert(
    windows.hookFiles.some(
      ({ source }) => source === "skills/hooks/codex-session-name-set.ps1",
    ),
  );
  assert(
    windows.hookFiles.some(
      ({ source }) => source === "skills/hooks/codex-shared-app-server.ps1",
    ),
  );
  assert.match(windows.windowsCodexProfile.block, /function codex/);
  assert.match(windows.windowsCodexProfile.block, /function codex-server-restart/);
  assert(
    windows.hookFiles.some(
      ({ source }) => source === "skills/hooks/codex-server-restart.ps1",
    ),
  );
  assert(
    posix.hookFiles.some(
      ({ source, target }) =>
        source === "skills/hooks/codex-server-restart.sh" &&
        target === "/Users/student/.local/bin/codex-server-restart",
    ),
  );
  ok("installer 依平台安裝 app-server helper，Windows 另裝自動啟動 wrapper");

  for (const file of [
    ["materials", "skills", "skill-files", "codex", "auto-rename", "SKILL.md"],
    ["materials", "skills", "skill-files", "codex", "handoff", "SKILL.md"],
    ["materials", "skills", "skill-files", "codex", "_shared", "codex-session-rename.md"],
  ]) {
    const content = read(...file);
    assert.doesNotMatch(content, /mycodex/i, file.join("/"));
    assert.doesNotMatch(content, /直接.*OSC|OSC.*直接/i, file.join("/"));
    assert.match(content, /macOS|Linux/, file.join("/"));
    assert.match(content, /app-server/, file.join("/"));
    assert.match(content, /Windows/, file.join("/"));
    assert.match(content, /thread\/name\/set/, file.join("/"));
  }
  ok("Codex skills 在三個平台都走 app-server 的 thread/name/set");

  const ui = read("public", "model.js");
  assert.doesNotMatch(ui, /claude \/ codex wrapper/);
  assert.match(ui, /terminal_title/);
  const codexGuidance = GUIDANCE["codex-namer"].checks.join("\n");
  assert.match(codexGuidance, /macOS.*Linux.*app-server/);
  assert.match(codexGuidance, /Windows.*app-server/);
  assert.doesNotMatch(codexGuidance, /Windows.*tab-sync|Windows.*SQLite/);
  ok("UI troubleshooting 說明兩種 transport，但不再要求 Windows tab-sync");

  const wrapperGuidance = Object.values(GUIDANCE["shell-wrapper"])
    .flat()
    .join("\n");
  assert.match(wrapperGuidance, /Claude/);
  assert.match(wrapperGuidance, /Codex/);
  ok("shell-wrapper UI copy 同時涵蓋 Claude 與 Codex");

  const acceptance = read("docs", "fresh-vm-acceptance.md");
  assert.match(acceptance, /macOS.*Linux.*app-server.*原生/s);
  assert.match(acceptance, /Windows.*app-server.*thread\/name\/set/s);
  const verification = read("docs", "wizard-verification-design.md");
  assert.match(verification, /macOS.*Linux.*app-server.*原生/s);
  assert.match(verification, /Windows.*app-server.*thread\/name\/set/s);
  ok("驗收與驗證文件記錄 Windows 與 POSIX 共用原生命名機制");
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
