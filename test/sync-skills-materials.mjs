import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
  return { copiedScript, source, target, sentinel };
}

function runSync({ copiedScript, source }) {
  return spawnSync("bash", [copiedScript, source], { encoding: "utf8" });
}

function expectPreDeleteFailure(current, pattern) {
  const result = runSync(current);
  assert.notEqual(result.status, 0);
  assert.equal(existsSync(current.sentinel), true);
  assert.match(`${result.stdout}${result.stderr}`, pattern);
}

try {
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

  const oldDocs = fixture();
  writeFileSync(
    path.join(oldDocs.source, "installer", "skills", "codex", "fixture.txt"),
    "Start Codex through mycodex.\n",
  );
  expectPreDeleteFailure(oldDocs, /mycodex/);
  ok("上游文件仍要求 mycodex 時 compatibility gate 先停止");

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
  ok("完整相容來源可同步，且 app-server helper 會被複製");
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
