// 合併前的快照，以及怎麼退回去。
//
// ⚠️ 不能靠 AI 自己備份。現在的合併提示詞裡有一句「備份現有檔案（加 .bak.時間戳）」
// ——那是**請求**，不是保證。模型可能忘、可能備份到別的地方、可能備份完又覆蓋回去。
// 而合併是唯一會改寫學生自己內容的動作，退路必須是我們自己拿的。
//
// 快照放在 ~/.jr-setup/merge-backups/<step>/<時間戳>/ 底下，一次合併一個資料夾。
// 這樣「一顆做兩檔」時兩份檔案是同一次快照，還原也是一起還原——只還原其中一份會
// 產生一個從來沒存在過的組合。

// 哪一步要合併哪幾個檔案。
//
// ⚠️ 不對稱是內容本身造成的，不是設計偷懶：Claude 這邊**只有一個檔案**需要 AI 合併
// （`output-style`、hook、白名單走的是標記區塊或直接寫，不需要 AI 介入）。Codex 那
// 兩檔剛好同一家、同一個目錄、同一個 agent，才有「一次叫起來把兩份都合完」的省法。
export const MERGE_GROUPS = {
  "claude-md": { agent: "claude", steps: ["claude-md"] },
  "codex-config": { agent: "codex", steps: ["codex-config", "codex-agents"] },
};

// codex-agents 沒有自己的群組——它跟 config.toml 綁在一起，由 codex-config 那顆
// 按鈕一起處理。
export function mergeGroupFor(step) {
  return MERGE_GROUPS[step] ?? null;
}

// 這一步的合併要交給哪一顆按鈕。
//
// ⚠️ 不能只讓群組主人那一列長按鈕。畫面上卡片的按鈕來自「第一個還沒好的那一列」
// （app.js 的 rowCheck），而 Codex 那張卡第一個是 codex-agents——它不是主人，於是
// 整張卡一顆合併鍵都沒有（VM 實測）。所以每一列都給按鈕，但按下去送的 step 一律
// 折回群組主人，兩份還是一次合完。
export function mergeLeaderFor(step) {
  if (MERGE_GROUPS[step] !== undefined) {
    return step;
  }

  const found = Object.entries(MERGE_GROUPS).find(([, group]) =>
    group.steps.includes(step),
  );

  return found === undefined ? null : found[0];
}

export function mergeBackupRoot(home) {
  return `${home}/.jr-setup/merge-backups`;
}

export function snapshotDir(home, step, stamp) {
  return `${mergeBackupRoot(home)}/${step}/${stamp}`;
}

// 檔名只留最後一段。同一次合併的兩檔分別是 config.toml 與 AGENTS.md，不會撞名；
// 真的撞名的話後面那份會蓋掉前面那份，所以這裡假設呼叫端給的是不同檔名的一組。
export function snapshotFile(dir, target) {
  return `${dir}/${target.replace(/^.*[\\/]/, "")}`;
}

// 最新的那一份快照。時間戳是 YYYYMMDDHHMMSS，字串排序就是時間排序。
export function latestStamp(stamps) {
  const sorted = [...stamps].filter((name) => /^\d{14}$/.test(name)).sort();

  return sorted.length === 0 ? null : sorted[sorted.length - 1];
}

// 還原要做什麼。回傳 null 代表沒有快照可以還原——那時按鈕本來就不該出現，
// 但腳本仍然要講人話而不是丟例外。
export function restorePlan({ home, step, stamps, files }) {
  const stamp = latestStamp(stamps);

  if (stamp === null || files.length === 0) {
    return null;
  }

  const dir = snapshotDir(home, step, stamp);

  return {
    stamp,
    dir,
    // from 是快照裡那一份，to 是學生現在的檔案。
    moves: files.map((target) => ({
      from: snapshotFile(dir, target),
      to: target,
    })),
  };
}
