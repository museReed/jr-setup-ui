import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

function ok(description) {
  console.log(`ok - ${description}`);
}

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const HOOK = path.join(
  REPO_ROOT,
  "materials",
  "skills",
  "hooks",
  "codex-session-namer.sh",
);

function runHook({ event = "prompt", sessionId, home, counterDir }) {
  return spawnSync("bash", [HOOK, event], {
    input: JSON.stringify({ session_id: sessionId }),
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      CODEX_HOME: path.join(home, ".codex"),
      CODEX_SESSION_NAMER_DIR: counterDir,
      CODEX_APP_SERVER_SOCKET: path.join(home, "missing.sock"),
    },
  });
}

try {
  const home = mkdtempSync(path.join(tmpdir(), "jr-codex-namer-home-"));
  const counterDir = path.join(home, "counters");
  const first = runHook({ sessionId: "session-a", home, counterDir });
  const second = runHook({ sessionId: "session-b", home, counterDir });
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(readFileSync(path.join(counterDir, "session-a.prompts"), "utf8"), "1\n");
  assert.equal(readFileSync(path.join(counterDir, "session-b.prompts"), "utf8"), "1\n");
  assert.match(first.stdout, /session-a\.pending/);
  assert.match(second.stdout, /session-b\.pending/);
  ok("不同 session_id 使用不同的 counter、default 與 relay key");

  const missingRelay = path.join(counterDir, "session-missing.pending");
  const missingDefault = path.join(counterDir, "session-missing.default");
  writeFileSync(missingRelay, "稍後重試\n");
  writeFileSync(missingDefault, "");
  const unavailable = runHook({
    event: "tool",
    sessionId: "session-missing",
    home,
    counterDir,
  });
  assert.equal(unavailable.status, 0, unavailable.stderr);
  assert.equal(existsSync(missingRelay), true);
  assert.equal(existsSync(missingDefault), true);
  ok("app-server 與 SQLite 都失敗時保留 relay/default 供下次 hook 重試");

  const codexHome = path.join(home, ".codex");
  mkdirSync(codexHome, { recursive: true });
  const db = path.join(codexHome, "state_5.sqlite");
  execFileSync("sqlite3", [
    db,
    "CREATE TABLE threads (id TEXT PRIMARY KEY, name TEXT, title TEXT, preview TEXT);" +
      "INSERT INTO threads VALUES ('session-a', NULL, 'old title', 'old preview');",
  ]);
  writeFileSync(path.join(counterDir, "session-a.pending"), "新的名稱\n");
  writeFileSync(path.join(counterDir, "session-a.default"), "");
  const fallback = runHook({
    event: "tool",
    sessionId: "session-a",
    home,
    counterDir,
  });
  assert.equal(fallback.status, 0, fallback.stderr);
  assert.equal(existsSync(path.join(counterDir, "session-a.pending")), false);
  assert.equal(existsSync(path.join(counterDir, "session-a.default")), false);
  assert.equal(
    execFileSync("sqlite3", [db, "SELECT name || '|' || title || '|' || preview FROM threads WHERE id='session-a';"], {
      encoding: "utf8",
    }).trim(),
    "新的名稱|新的名稱|新的名稱",
  );
  ok("app-server 失敗時 SQLite fallback 同步 name、title、preview");
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
