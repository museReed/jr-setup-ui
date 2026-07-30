---
name: auto-rename
description: >-
  Use when renaming the current session based on conversation context.
  Triggers on "rename", "auto-rename", "命名", "改名", "session name".
---

# Auto-Rename — Session Naming Utility (Codex)

## Quick Reference

根據對話內容為 session 命名。名稱寫入 /tmp relay 檔，由 session-namer hook
（不受 sandbox 限制）代寫 Codex SQLite（sidebar 名稱）+ tab sync file。

1. 讀對話脈絡 → 決定 `{emoji} {中文敘述}`（≤ 40 字元，emoji 見 §Emoji Mapping）
2. 一個 shell 指令寫 relay 檔（見 §Execution Flow Step 2）
3. 回報新名稱，一句話結束

Key rules:
- 根據對話「主要目的」選 emoji，不是最新一句話
- ⛔ emoji 只能從 §Emoji Mapping 的 8 個中選
- 技術名詞保留英文，敘述用中文
- ⛔ 不要直接 sqlite3 UPDATE `~/.codex/state_*.sqlite` — 非 trusted cwd 下
  sandbox 會擋（silent failure）。一律走 relay 檔，hook 會代寫。

## Emoji Mapping

| Emoji | 動作 | 範例 |
|---|---|---|
| 🏗️ | build / implement / refactor / migrate | 🏗️ 語音建模 pipeline |
| 🔧 | fix / hotfix | 🔧 爬蟲重試邏輯 |
| 🐛 | debug | 🐛 Gemini Vision blockReason |
| 📐 | plan / design | 📐 PRD2 classify-enrich |
| 📋 | review / audit | 📋 PRD 架構設計 |
| 💬 | discuss | 💬 auto-rename emoji 定義 |
| ⛴️ | pilot / spike | ⛴️ knowledge-distill 驗證 |
| 🔍 | research / investigate | 🔍 cron 失敗原因 |

## When to Use

- Hook 自動觸發後（hook 注入 `[session-namer]` additionalContext 時，內含精確 relay 路徑）
- 用戶手動打 `$auto-rename`
- 對話主題明顯偏移，舊名稱不再準確時

## When NOT to Use

- Hook 第一句話就會觸發命名——手動觸發前先確認 hook 沒有正在處理
- 用戶已手動指定名稱

## Execution Flow

### Step 1: 決定名稱

讀對話歷史，判斷主要目的，從 Emoji Mapping 選一個 + 寫中文敘述。

### Step 2: 寫 relay 檔

Hook 注入的訊息若已給精確路徑，用那個路徑。手動觸發時用 `$PPID`（= Codex process PID）：

```bash
mkdir -p /tmp/codex-session-namer && echo '{emoji} {名稱}' > /tmp/codex-session-namer/${PPID}.pending
```

這個寫入本身是一次 tool call → 觸發下一次 PostToolUse → hook 立即把名稱套用到
SQLite（sidebar）與 `$AI_TAB_SYNC_FILE`（terminal tab，需用 `mycodex` wrapper 啟動）。

### Step 3: 回報

告訴用戶新名稱，一句話結束。

## Common Mistakes

| Mistake | Why it fails | Fix |
|---------|-------------|-----|
| 直接 sqlite3 UPDATE | 非 trusted cwd 被 sandbox 擋，且是 silent failure | 走 relay 檔 |
| 用最新一句話命名 | 不代表整個 session 的目的 | 回顧整個對話脈絡再決定 |
| 名稱超過 40 字元 | sidebar 顯示被截斷 | 精簡敘述 |
| 名稱含單引號 | shell quoting 壞掉 | 避免單引號，或用雙引號包 |
