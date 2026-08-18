import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

function ok(description) {
  console.log(`ok - ${description}`);
}

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = path.join(REPO_ROOT, "scripts", "sync-skills-materials.sh");
const REQUIRED_FILES = [
  "bin/ai-tab-sync.sh",
  "bin/ai-tab-sync.ps1",
  "hooks/set-session-name.sh",
  "hooks/set-session-name.ps1",
  "hooks/session-auto-namer.sh",
  "hooks/session-auto-namer.ps1",
  "hooks/context-monitor.sh",
  "hooks/context-monitor.ps1",
  "hooks/codex-session-namer.sh",
  "hooks/codex-session-namer.ps1",
  "hooks/codex-session-name-set.py",
  "hooks/codex-context-monitor.sh",
  "hooks/codex-context-monitor.ps1",
  "model-context-windows-cache.json",
  "demo-prompt-claude.md",
  "demo-prompt-codex.md",
];

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "jr-sync-skills-"));
  const copiedScript = path.join(root, "scripts", "sync-skills-materials.sh");
  const source = path.join(root, "source");
  const target = path.join(root, "materials", "skills");
  const sentinel = path.join(target, "skill-files", "keep.txt");
  const shim = path.join(target, "hooks", "set-session-name-shim.sh");
  const extra = path.join(target, "wizard-extra", "keep.txt");
  mkdirSync(path.dirname(copiedScript), { recursive: true });
  mkdirSync(path.dirname(sentinel), { recursive: true });
  cpSync(SCRIPT, copiedScript);

  for (const relative of REQUIRED_FILES) {
    const file = path.join(source, "installer", relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `fixture:${relative}\n`);
  }
  for (const relative of [
    "skills/claude",
    "skills/codex",
    "demo/live-preview-self",
  ]) {
    const directory = path.join(source, "installer", relative);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "fixture.txt"), `fixture:${relative}\n`);
  }
  writeFileSync(
    path.join(source, "installer", "hooks", "codex-session-namer.sh"),
    'KEY="${SESSION_ID:-$PPID}"\n',
  );
  writeFileSync(
    path.join(source, "installer", "hooks", "codex-session-name-set.py"),
    "# compatible helper\n",
  );
  writeFileSync(
    path.join(source, "installer", "skills", "codex", "fixture.txt"),
    "Codex native thread naming\n",
  );
  writeFileSync(sentinel, "must survive\n");
  mkdirSync(path.dirname(shim), { recursive: true });
  mkdirSync(path.dirname(extra), { recursive: true });
  writeFileSync(shim, "wizard-owned shim\n");
  writeFileSync(extra, "wizard-owned extra\n");
  return { copiedScript, source, target, sentinel, shim, extra };
}

function runSync({ copiedScript, source }, env = {}) {
  return spawnSync("bash", [copiedScript, source], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function snapshot(root) {
  const result = {};

  function visit(directory, prefix = "") {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relative = path.join(prefix, entry.name);
      const absolute = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        result[`${relative}/`] = "directory";
        visit(absolute, relative);
      } else {
        result[relative] = readFileSync(absolute).toString("base64");
      }
    }
  }

  visit(root);
  return result;
}

function fakeCommand(current, name, body) {
  const bin = path.join(path.dirname(path.dirname(current.copiedScript)), "fake-bin");
  const command = path.join(bin, name);
  mkdirSync(bin, { recursive: true });
  writeFileSync(command, `#!/bin/sh\n${body}\n`);
  chmodSync(command, 0o755);
  return bin;
}

function expectPreDeleteFailure(current, pattern) {
  const before = snapshot(current.target);
  const result = runSync(current);
  assert.notEqual(result.status, 0);
  assert.deepEqual(snapshot(current.target), before);
  assert.match(`${result.stdout}${result.stderr}`, pattern);
}

try {
  const syncScript = readFileSync(SCRIPT, "utf8");
  assert.doesNotMatch(syncScript, /0\.146 原生命名/);
  assert.match(syncScript, /跨平台命名/);
  ok("sync compatibility gate 文案描述跨平台命名，不把 Windows 說成原生命名");

  const missingNonCodex = fixture();
  rmSync(path.join(missingNonCodex.source, "installer", "bin", "ai-tab-sync.sh"));
  expectPreDeleteFailure(missingNonCodex, /bin\/ai-tab-sync\.sh/);
  ok("缺少非 Codex 必需來源時在修改 materials 前停止");

  const missingHelper = fixture();
  rmSync(
    path.join(
      missingHelper.source,
      "installer",
      "hooks",
      "codex-session-name-set.py",
    ),
  );
  expectPreDeleteFailure(missingHelper, /codex-session-name-set\.py/);
  ok("缺少 app-server helper 時在修改 materials 前停止");

  const oldKey = fixture();
  writeFileSync(
    path.join(oldKey.source, "installer", "hooks", "codex-session-namer.sh"),
    'KEY="$PPID"\n',
  );
  expectPreDeleteFailure(oldKey, /session_id key/);
  ok("上游仍用 PPID key 時 compatibility gate 先停止");

  const commentedKey = fixture();
  writeFileSync(
    path.join(
      commentedKey.source,
      "installer",
      "hooks",
      "codex-session-namer.sh",
    ),
    '# KEY="${SESSION_ID:-$PPID}"\nKEY="$PPID"\n',
  );
  expectPreDeleteFailure(commentedKey, /session_id key/);
  ok("只有 comment 提到新 assignment 時 compatibility gate 不會被騙過");

  const oldDocs = fixture();
  writeFileSync(
    path.join(oldDocs.source, "installer", "skills", "codex", "fixture.txt"),
    "Start Codex through mycodex.\n",
  );
  expectPreDeleteFailure(oldDocs, /mycodex/);
  ok("上游文件仍要求 mycodex 時 compatibility gate 先停止");

  const stagingFailure = fixture();
  const beforeStagingFailure = snapshot(stagingFailure.target);
  const fakeCp = fakeCommand(
    stagingFailure,
    "cp",
    'case "$*" in *codex-session-name-set.py*) exit 73 ;; esac\nexec /bin/cp "$@"',
  );
  const failedStage = runSync(stagingFailure, {
    PATH: `${fakeCp}:${process.env.PATH}`,
  });
  assert.notEqual(failedStage.status, 0);
  assert.deepEqual(snapshot(stagingFailure.target), beforeStagingFailure);
  ok("staging 複製中途失敗時完整 target 快照不變");

  const replacementFailure = fixture();
  const beforeReplacementFailure = snapshot(replacementFailure.target);
  const fakeMv = fakeCommand(
    replacementFailure,
    "mv",
    'case "$1" in *.skills-stage.*) exit 74 ;; esac\nexec /bin/mv "$@"',
  );
  const failedReplacement = runSync(replacementFailure, {
    PATH: `${fakeMv}:${process.env.PATH}`,
  });
  assert.notEqual(failedReplacement.status, 0);
  assert.deepEqual(snapshot(replacementFailure.target), beforeReplacementFailure);
  ok("replacement 失敗時會恢復完整舊 target");

  const compatible = fixture();
  const success = runSync(compatible);
  assert.equal(success.status, 0, success.stderr);
  assert.equal(
    readFileSync(
      path.join(compatible.target, "hooks", "codex-session-name-set.py"),
      "utf8",
    ),
    "# compatible helper\n",
  );
  assert.equal(readFileSync(compatible.shim, "utf8"), "wizard-owned shim\n");
  assert.equal(readFileSync(compatible.extra, "utf8"), "wizard-owned extra\n");
  assert.equal(existsSync(compatible.sentinel), false);
  ok("完整相容來源可同步，保留 wizard-owned 檔案並替換受管目錄");
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
