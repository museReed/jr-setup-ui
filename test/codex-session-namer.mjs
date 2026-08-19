import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

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

function runHook({
  event = "prompt",
  sessionId,
  home,
  counterDir,
  hook = HOOK,
  env = {},
}) {
  const input = sessionId === undefined ? {} : { session_id: sessionId };
  return spawnSync("bash", [hook, event], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      CODEX_HOME: path.join(home, ".codex"),
      CODEX_SESSION_NAMER_DIR: counterDir,
      CODEX_APP_SERVER_SOCKET: path.join(home, "missing.sock"),
      // 明確清掉，不能只靠「開發機剛好沒設」。apply_name 的成功條件是「SQLite 寫成
      // 功 **且** tab 寫成功」，所以在有裝 tab-sync wrapper 的終端裡跑測試時，這個
      // 變數會被繼承進來、讓本該失敗的那幾個案例變成成功，relay 被消掉——症狀是
      // 「SQLite fallback 保留 relay」那一項無故變紅，而且看起來像 hook 壞了。
      // 需要它的案例自己用 env 設回去（見「AI_TAB_SYNC_FILE 成功但 changes=0」那組）。
      AI_TAB_SYNC_FILE: undefined,
      ...env,
    },
  });
}

function makeHookFixture(home, helperSource) {
  const hookDir = path.join(home, `hooks-${Math.random().toString(16).slice(2)}`);
  mkdirSync(hookDir, { recursive: true });
  const hook = path.join(hookDir, "codex-session-namer.sh");
  const helper = path.join(hookDir, "codex-session-name-set.py");
  copyFileSync(HOOK, hook);
  writeFileSync(helper, helperSource);
  chmodSync(hook, 0o755);
  chmodSync(helper, 0o755);
  return hook;
}

async function waitFor(predicate, message) {
  const deadline = Date.now() + 3_000;

  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(message);
    }
    await delay(10);
  }
}

async function interruptClaim({ newerPending }) {
  const home = mkdtempSync(path.join(tmpdir(), "jr-codex-namer-term-"));
  const counterDir = path.join(home, "counters");
  const sessionId = newerPending ? "session-term-newer" : "session-term-restore";
  const relay = path.join(counterDir, `${sessionId}.pending`);
  const lock = `${relay}.lock`;
  mkdirSync(counterDir, { recursive: true });
  writeFileSync(relay, "被中斷的舊名稱\n");
  const hook = makeHookFixture(
    home,
    "#!/usr/bin/env python3\nimport time\ntime.sleep(30)\nraise SystemExit(1)\n",
  );
  const child = spawn("bash", [hook, "tool"], {
    detached: true,
    env: {
      ...process.env,
      HOME: home,
      CODEX_HOME: path.join(home, ".codex"),
      CODEX_SESSION_NAMER_DIR: counterDir,
      CODEX_APP_SERVER_SOCKET: path.join(home, "missing.sock"),
    },
    stdio: ["pipe", "ignore", "ignore"],
  });
  child.stdin.end(JSON.stringify({ session_id: sessionId }));

  await waitFor(
    () =>
      existsSync(lock) &&
      readdirSync(counterDir).some((entry) =>
        entry.startsWith(`${sessionId}.pending.claim.`),
      ),
    "hook 沒有在時限內 claim relay",
  );

  if (newerPending) {
    writeFileSync(relay, "處理期間產生的較新名稱\n");
  }

  const closed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  process.kill(-child.pid, "SIGTERM");
  await Promise.race([
    closed,
    delay(3_000).then(() => {
      throw new Error("送出 SIGTERM 後 hook 沒有結束");
    }),
  ]);

  return { counterDir, relay, lock, sessionId };
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

  const ppidCounterDir = path.join(home, "ppid-counters");
  const ppid = runHook({ home, counterDir: ppidCounterDir });
  assert.equal(ppid.status, 0, ppid.stderr);
  assert.equal(
    readFileSync(path.join(ppidCounterDir, `${process.pid}.prompts`), "utf8"),
    "1\n",
  );
  ok("stdin 沒有 session_id 時使用 hook 的 PPID 作為 key");

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
  assert.equal(readFileSync(missingRelay, "utf8"), "稍後重試\n");
  assert.equal(existsSync(missingDefault), true);
  assert.equal(
    readdirSync(counterDir).some((entry) =>
      entry.startsWith("session-missing.pending.claim."),
    ),
    false,
  );
  ok("app-server 與 SQLite 都失敗時安全還原 relay/default 供下次 hook 重試");

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
  assert.equal(existsSync(path.join(counterDir, "session-a.pending")), true);
  assert.equal(
    readFileSync(path.join(counterDir, "session-a.pending"), "utf8"),
    "新的名稱\n",
  );
  assert.equal(existsSync(path.join(counterDir, "session-a.default")), true);
  assert.equal(
    execFileSync("sqlite3", [db, "SELECT name || '|' || title || '|' || preview FROM threads WHERE id='session-a';"], {
      encoding: "utf8",
    }).trim(),
    "新的名稱|新的名稱|新的名稱",
  );
  ok("SQLite fallback 只同步 sidebar，保留 relay/default 等待 tab 同步");

  writeFileSync(path.join(counterDir, "session-no-row.pending"), "找不到資料列\n");
  const noChanges = runHook({
    event: "tool",
    sessionId: "session-no-row",
    home,
    counterDir,
  });
  assert.equal(noChanges.status, 0, noChanges.stderr);
  assert.equal(existsSync(path.join(counterDir, "session-no-row.pending")), true);
  ok("SQLite changes=0 時保留 relay");

  const successfulHelper = makeHookFixture(
    home,
    "#!/usr/bin/env python3\nraise SystemExit(0)\n",
  );
  writeFileSync(path.join(counterDir, "session-a.pending"), "helper 成功\n");
  const helperApplied = runHook({
    event: "tool",
    sessionId: "session-a",
    home,
    counterDir,
    hook: successfulHelper,
  });
  assert.equal(helperApplied.status, 0, helperApplied.stderr);
  assert.equal(existsSync(path.join(counterDir, "session-a.pending")), false);
  assert.equal(
    execFileSync("sqlite3", [db, "SELECT name FROM threads WHERE id='session-a';"], {
      encoding: "utf8",
    }).trim(),
    "新的名稱",
  );
  ok("app-server helper 成功時清 relay 並跳過 SQLite");

  const tabSyncFile = path.join(home, "tab-title.txt");
  writeFileSync(path.join(counterDir, "session-a.pending"), "legacy tab 名稱\n");
  writeFileSync(path.join(counterDir, "session-a.default"), "");
  const tabSynced = runHook({
    event: "tool",
    sessionId: "session-a",
    home,
    counterDir,
    env: { AI_TAB_SYNC_FILE: tabSyncFile },
  });
  assert.equal(tabSynced.status, 0, tabSynced.stderr);
  assert.equal(readFileSync(tabSyncFile, "utf8"), "legacy tab 名稱\n");
  assert.equal(existsSync(path.join(counterDir, "session-a.pending")), false);
  assert.equal(existsSync(path.join(counterDir, "session-a.default")), false);
  ok("SQLite matching row 與 AI_TAB_SYNC_FILE 都成功時清 relay");

  const noDbHome = mkdtempSync(path.join(tmpdir(), "jr-codex-namer-no-db-"));
  const noDbCounterDir = path.join(noDbHome, "counters");
  mkdirSync(noDbCounterDir, { recursive: true });
  const noDbRelay = path.join(noDbCounterDir, "session-ai-no-db.pending");
  const noDbDefault = path.join(noDbCounterDir, "session-ai-no-db.default");
  const noDbTabSyncFile = path.join(noDbHome, "tab-title.txt");
  writeFileSync(noDbRelay, "只有 tab 成功\n");
  writeFileSync(noDbDefault, "");
  const tabOnly = runHook({
    event: "tool",
    sessionId: "session-ai-no-db",
    home: noDbHome,
    counterDir: noDbCounterDir,
    env: { AI_TAB_SYNC_FILE: noDbTabSyncFile },
  });
  assert.equal(tabOnly.status, 0, tabOnly.stderr);
  assert.equal(readFileSync(noDbTabSyncFile, "utf8"), "只有 tab 成功\n");
  assert.equal(existsSync(noDbRelay), true);
  assert.equal(existsSync(noDbDefault), true);
  ok("AI_TAB_SYNC_FILE 成功但 SQLite DB 不存在時保留 relay/default");

  const noRowRelay = path.join(counterDir, "session-ai-no-row.pending");
  const noRowDefault = path.join(counterDir, "session-ai-no-row.default");
  const noRowTabSyncFile = path.join(home, "tab-title-no-row.txt");
  writeFileSync(noRowRelay, "tab 成功但 row 不存在\n");
  writeFileSync(noRowDefault, "");
  const tabWithoutRow = runHook({
    event: "tool",
    sessionId: "session-ai-no-row",
    home,
    counterDir,
    env: { AI_TAB_SYNC_FILE: noRowTabSyncFile },
  });
  assert.equal(tabWithoutRow.status, 0, tabWithoutRow.stderr);
  assert.equal(
    readFileSync(noRowTabSyncFile, "utf8"),
    "tab 成功但 row 不存在\n",
  );
  assert.equal(existsSync(noRowRelay), true);
  assert.equal(existsSync(noRowDefault), true);
  ok("AI_TAB_SYNC_FILE 成功但 SQLite changes=0 時保留 relay/default");

  const lockedSessionId = "session-locked";
  const lockedRelay = path.join(counterDir, `${lockedSessionId}.pending`);
  writeFileSync(lockedRelay, "較新名稱不應被 claim\n");
  mkdirSync(`${lockedRelay}.lock`);
  const lockContender = runHook({
    event: "tool",
    sessionId: lockedSessionId,
    home,
    counterDir,
  });
  assert.equal(lockContender.status, 0, lockContender.stderr);
  assert.equal(readFileSync(lockedRelay, "utf8"), "較新名稱不應被 claim\n");
  assert.equal(
    readdirSync(counterDir).some((entry) =>
      entry.startsWith(`${lockedSessionId}.pending.claim.`),
    ),
    false,
  );
  ok("relay lock 已被持有時第二個 hook 不 claim pending");

  const racingHelper = makeHookFixture(
    home,
    [
      "#!/usr/bin/env python3",
      "import os",
      "from pathlib import Path",
      "pending = Path(os.environ['CODEX_SESSION_NAMER_DIR']) / f\"{os.environ['TEST_SESSION_ID']}.pending\"",
      "pending.write_text(os.environ['TEST_NEW_NAME'] + '\\n')",
      "raise SystemExit(int(os.environ['TEST_HELPER_STATUS']))",
      "",
    ].join("\n"),
  );

  for (const [status, label] of [
    ["0", "成功"],
    ["1", "失敗"],
  ]) {
    const sessionId = `session-race-${status}`;
    const relay = path.join(counterDir, `${sessionId}.pending`);
    writeFileSync(relay, "較舊名稱\n");
    const raced = runHook({
      event: "tool",
      sessionId,
      home,
      counterDir,
      hook: racingHelper,
      env: {
        TEST_SESSION_ID: sessionId,
        TEST_NEW_NAME: `較新名稱-${status}`,
        TEST_HELPER_STATUS: status,
      },
    });
    assert.equal(raced.status, 0, raced.stderr);
    assert.equal(readFileSync(relay, "utf8"), `較新名稱-${status}\n`);
    assert.equal(
      readdirSync(counterDir).some((entry) =>
        entry.startsWith(`${sessionId}.pending.claim.`),
      ),
      false,
    );
    ok(`app-server ${label}時都不覆寫處理期間產生的較新 pending`);
  }

  const interrupted = await interruptClaim({ newerPending: false });
  assert.equal(readFileSync(interrupted.relay, "utf8"), "被中斷的舊名稱\n");
  assert.equal(existsSync(interrupted.lock), false);
  assert.equal(
    readdirSync(interrupted.counterDir).some((entry) =>
      entry.startsWith(`${interrupted.sessionId}.pending.claim.`),
    ),
    false,
  );
  ok("claim 後收到 TERM 會還原 pending 並釋放 lock");

  const interruptedWithNewer = await interruptClaim({ newerPending: true });
  assert.equal(
    readFileSync(interruptedWithNewer.relay, "utf8"),
    "處理期間產生的較新名稱\n",
  );
  assert.equal(existsSync(interruptedWithNewer.lock), false);
  assert.equal(
    readdirSync(interruptedWithNewer.counterDir).some((entry) =>
      entry.startsWith(`${interruptedWithNewer.sessionId}.pending.claim.`),
    ),
    false,
  );
  ok("claim 後收到 TERM 不會用舊 claim 覆寫較新 pending");
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
