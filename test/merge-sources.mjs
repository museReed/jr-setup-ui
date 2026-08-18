import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describeStep } from "../src/config-install.js";
import * as mergeSourceHelpers from "../src/merge-sources.js";

const { stageMergeSources } = mergeSourceHelpers;

function ok(description) {
  console.log(`ok - ${description}`);
}

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const MATERIALS = path.join(REPO_ROOT, "materials");
const temporaryRoot = mkdtempSync(path.join(tmpdir(), "jr-merge-sources-test-"));

try {
  const posix = describeStep("codex-config", {
    lang: "zh-TW",
    home: "/Users/student",
    platform: "darwin",
  });
  const posixSources = stageMergeSources(MATERIALS, [posix], {
    temporaryRoot,
  });
  assert.equal(
    posixSources.sourceFor(posix),
    path.join(MATERIALS, posix.source),
  );
  assert.equal(posixSources.stagingDir, null);
  posixSources.cleanup();
  ok("POSIX merge prompt 維持指向原始 materials source");

  const windows = describeStep("codex-config", {
    lang: "zh-TW",
    home: "C:/Users/student",
    platform: "win32",
  });
  const windowsSources = stageMergeSources(MATERIALS, [windows], {
    temporaryRoot,
  });
  const staged = windowsSources.sourceFor(windows);
  assert.equal(staged.startsWith(windowsSources.stagingDir), true);
  assert.doesNotMatch(readFileSync(staged, "utf8"), /"thread-title"/);
  assert.doesNotMatch(readFileSync(staged, "utf8"), /^terminal_title\s*=/m);
  assert.match(
    readFileSync(path.join(MATERIALS, windows.source), "utf8"),
    /"thread-title"/,
  );
  windowsSources.cleanup();
  assert.equal(existsSync(windowsSources.stagingDir), false);
  ok("Windows merge prompt 使用 transformed staging source，清理不動 raw template");

  const mergeScript = readFileSync(
    path.join(REPO_ROOT, "scripts", "merge-in-terminal.mjs"),
    "utf8",
  );
  const timeoutBranchAt = mergeScript.indexOf("if (outstanding.length > 0)");
  const successCleanupAt = mergeScript.lastIndexOf("mergeSources.cleanup()");
  assert(timeoutBranchAt !== -1 && successCleanupAt > timeoutBranchAt);
  ok("逾時保留 transformed staging source，只有完成分流才清掉");

  assert.equal(
    typeof mergeSourceHelpers.withMergeSourceFailureCleanup,
    "function",
  );

  const retainedSources = stageMergeSources(MATERIALS, [windows], {
    temporaryRoot,
  });
  await mergeSourceHelpers.withMergeSourceFailureCleanup(
    retainedSources,
    async () => "timeout",
  );
  assert.equal(existsSync(retainedSources.stagingDir), true);
  retainedSources.cleanup();
  ok("正常返回 timeout 時保留 staging，讓外部 terminal 繼續讀取");

  const failedSources = stageMergeSources(MATERIALS, [windows], {
    temporaryRoot,
  });
  await assert.rejects(
    mergeSourceHelpers.withMergeSourceFailureCleanup(
      failedSources,
      async () => {
        throw new Error("terminal launch failed");
      },
    ),
    /terminal launch failed/,
  );
  assert.equal(existsSync(failedSources.stagingDir), false);
  ok("terminal 啟動或輪詢拋錯時清掉 staging");
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
