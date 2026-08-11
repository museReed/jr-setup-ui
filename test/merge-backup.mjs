import assert from "node:assert/strict";

import {
  latestStamp,
  mergeGroupFor,
  restorePlan,
  snapshotDir,
  snapshotFile,
} from "../src/merge-backup.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

const HOME = "/Users/reed";

try {
  // Codex 那兩檔是同一顆按鈕、同一次快照——只還原其中一份會產生一個從來沒存在過
  // 的組合（Reed 拍板：一顆做兩檔）。
  assert.deepEqual(mergeGroupFor("codex-config"), {
    agent: "codex",
    steps: ["codex-config", "codex-agents"],
  });
  ok("codex-config 那顆一次處理 config.toml 與 AGENTS.md");

  // Claude 這邊只有一檔要合併——不對稱是內容造成的，不是設計偷懶。
  assert.deepEqual(mergeGroupFor("claude-md"), {
    agent: "claude",
    steps: ["claude-md"],
  });
  ok("claude-md 只有自己一檔");

  // AGENTS.md 沒有自己的群組：它被 codex-config 那顆帶著走，不該長出第二顆合併鍵。
  assert.equal(mergeGroupFor("codex-agents"), null);
  assert.equal(mergeGroupFor("output-style"), null);
  ok("被別人帶著走的、以及不需要合併的步驟都沒有群組");

  assert.equal(
    snapshotDir(HOME, "codex-config", "20260811150000"),
    "/Users/reed/.jr-setup/merge-backups/codex-config/20260811150000",
  );
  assert.equal(
    snapshotFile("/tmp/snap", "/Users/reed/.codex/config.toml"),
    "/tmp/snap/config.toml",
  );
  assert.equal(
    snapshotFile("/tmp/snap", "C:\\Users\\Reed\\.codex\\AGENTS.md"),
    "/tmp/snap/AGENTS.md",
  );
  ok("快照路徑：一次合併一個資料夾，檔名只留最後一段（兩個平台都對）");

  // 時間戳是 YYYYMMDDHHMMSS，字串排序就是時間排序。
  assert.equal(
    latestStamp(["20260811150000", "20260810090000", "20260811160000"]),
    "20260811160000",
  );
  assert.equal(latestStamp([]), null);
  // 手動放進去的雜物不能被當成快照。
  assert.equal(latestStamp(["README", "備份"]), null);
  ok("挑最新那份快照，格式不對的目錄一律忽略");

  const plan = restorePlan({
    home: HOME,
    step: "codex-config",
    stamps: ["20260810090000", "20260811160000"],
    files: ["/Users/reed/.codex/config.toml", "/Users/reed/.codex/AGENTS.md"],
  });
  assert.equal(plan.stamp, "20260811160000");
  assert.deepEqual(plan.moves, [
    {
      from: "/Users/reed/.jr-setup/merge-backups/codex-config/20260811160000/config.toml",
      to: "/Users/reed/.codex/config.toml",
    },
    {
      from: "/Users/reed/.jr-setup/merge-backups/codex-config/20260811160000/AGENTS.md",
      to: "/Users/reed/.codex/AGENTS.md",
    },
  ]);
  ok("還原計畫用最新那份快照，兩檔一起列");

  assert.equal(
    restorePlan({ home: HOME, step: "codex-config", stamps: [], files: ["x"] }),
    null,
  );
  assert.equal(
    restorePlan({
      home: HOME,
      step: "codex-config",
      stamps: ["20260811160000"],
      files: [],
    }),
    null,
  );
  ok("沒有快照、或沒有檔案時回 null，讓呼叫端講人話而不是丟例外");
} catch (error) {
  console.error(error);
  process.exit(1);
}
