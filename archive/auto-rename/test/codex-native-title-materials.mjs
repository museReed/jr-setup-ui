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
  assert(
    posix.hookFiles.some(
      ({ source, target }) =>
        source === "skills/hooks/codex-version-guard.sh" &&
        target === "/Users/student/.codex/hooks/codex-version-guard.sh",
    ),
  );
  assert.equal(posix.posixCodexProfile.target, "/Users/student/.zshrc");
  assert.match(posix.posixCodexProfile.block, /codex-version-guard\.sh/);
  ok("installer 依平台安裝 app-server helper，並接上各平台的啟動入口");

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

  // relay 目錄（/tmp/codex-session-namer）是 hook 跑起來時建的，而 /tmp 隨時可能被
  // 系統清掉——它不是既有狀態。每一個叫模型寫 .pending 的地方都得自己確保它在。
  //
  // 漏掉一處的症狀是 no such file or directory，而學生只看得到「標題沒變」
  // （2026-08-21 macOS VM 實測：handoff skill 比命名 hook 先裝，改名整段踩空）。
  // 那時四處寫同一件事，兩處帶了 mkdir、兩處沒有。
  for (const file of [
    ["materials", "skills", "skill-files", "codex", "handoff", "SKILL.md"],
    ["materials", "skills", "skill-files", "codex", "auto-rename", "SKILL.md"],
    ["materials", "skills", "skill-files", "codex", "_shared", "codex-session-rename.md"],
    ["materials", "skills", "hooks", "codex-session-namer.sh"],
  ]) {
    const content = read(...file);

    for (const line of content.split("\n")) {
      if (!line.includes(".pending")) {
        continue;
      }

      // 同一行要嘛自己建目錄，要嘛只是在講述那個路徑（不是可執行的指令）。
      const writes = />\s*[^\s]*codex-session-namer|Set-Content|WriteAllText/.test(line);

      if (!writes) {
        continue;
      }

      assert.match(
        line,
        /mkdir -p|CreateDirectory|MKDIR/,
        `${file.join("/")}：叫模型寫 relay 檔的指令要自己建目錄——${line.trim()}`,
      );
    }
  }
  ok("每一處寫 relay 檔的指令都自己建目錄，不假設 /tmp 那個資料夾還在");
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
