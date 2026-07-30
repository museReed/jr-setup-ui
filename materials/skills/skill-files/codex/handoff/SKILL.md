---
name: handoff
description: >-
  Use when ending a session, context running low, or user requests a handoff document.
  Produces a structured handoff file for the next session to continue seamlessly.
  Triggers on "handoff", "交接", "寫 handoff", "session 結束".
user-invocable: true
---

# /handoff — Session 交接文件產生器（Codex-Compatible）

## Quick Reference

根據當前 session 的工作內容，產出結構化 handoff 文件到 `docs/handoff/{date}-{topic}.md`。

1. 蒐集 session 資訊（branch / issue / PR / 改動檔案）
2. 判斷 handoff 類型（continuation / investigation / reference）
3. 產出交接文件，包含：已完成、進行中、下一步、必讀檔案
4. Commit handoff 文件到當前 branch
5. 改 session name 為 📦 前綴（標記已交接）
6. 回報結尾輸出單行起始 prompt（絕對路徑），給新 session 直接複製

Key rules:
- 「已完成的工作」≤ 10 行，細節指向「必讀檔案」
- 無內容的 optional section 直接刪除
- 必須有「下一步」— 這是新 session 的啟動指令

## When to Use

- Session 要結束時（用戶主動 `$handoff` 或 context 告警）
- 跨天開發，今天做到一半要記錄進度
- 換人接手，需要結構化的交接資訊

## When NOT to Use

- 很短的一次性對話
- 所有工作在單次 session 完成
- 純閒聊

## Execution Flow

### Step 1: 蒐集 Session 資訊

自動執行，不需用戶提供：

```bash
git branch --show-current
git status -s
git log --oneline -20
gh pr list --state open --head "$(git branch --show-current)" --json number,title
```

### Step 2: 判斷 Handoff 類型

| 信號 | → Type |
|---|---|
| 有未完成的 checklist / 進行中的 step | continuation |
| Session 主要在調查、盤點、分析 | investigation |
| Session 主要在配置、設定、一次性建置 | reference |

不確定時問用戶。

### Step 3: 產出 Handoff 文件

檔名：`docs/handoff/{YYYY-MM-DD}-{topic}.md`（topic 英文 kebab-case，≤ 40 chars）

文件結構：
- **狀態摘要**：做了什麼（≤ 10 行）
- **必讀檔案**：每項附一句話說明為什麼要讀
- **下一步**：具體動作，新 session 可直接執行
- **已知問題**：如果有的話

✅ DO: 用具體的 PR 號碼、檔案路徑、指令
❌ DON'T: 寫模糊的「繼續之前的工作」

### Step 4: Commit

```bash
git add docs/handoff/{file}
git commit -m "docs: add session handoff — {topic}"
```

Commit 到當前 branch，不要切換 branch。

### Step 5: 改 Session Name + 回報

#### 5a: 改 session name（📦 前綴標記已交接）

改名方法 → Read `~/.agents/skills/_shared/codex-session-rename.md`。唯一步驟＝寫 relay 檔：

```bash
mkdir -p /tmp/codex-session-namer && echo '📦 {topic}' > /tmp/codex-session-namer/${PPID}.pending
```

hook 會在下一個事件把名稱同步到 sidebar（SQLite）與 terminal tab。
⚠️ 不要直接 `sqlite3 UPDATE threads`（只動 sidebar、不同步 tab）。

#### 5b: 回報

回報格式（最後一行必須是可直接複製的單行起始 prompt，路徑用絕對路徑）：

```
Handoff 已產出：{abs_path}
Branch: {current_branch}
下個 session 貼這行繼續：讀 {abs_path}
```

⚠️ 只輸出上面三行，不要重述交接文件的內容。

## Common Mistakes

| Mistake | Why it fails | Fix |
|---------|-------------|-----|
| 已完成的工作寫成長篇報告 | 新 session 花大量 context 讀 | ≤ 10 行，detail 指向必讀檔案 |
| 缺「下一步」 | 新 session 不知道做什麼 | 必填，寫具體動作 |
| 必讀檔案只列路徑 | 新 session 不知道為什麼要讀 | 每項附原因 |
| 直接 sqlite3 UPDATE 改名 | 只動 sidebar，terminal tab 不同步 | Step 5a 寫 relay 檔 |
| 用 ORDER BY updated_at_ms 找 session | 多 session 同時開會改錯 | relay 檔用 `${PPID}` key，hook 自己定位 |
| 起始 prompt 重述整份交接內容 | 浪費輸出，新 session 讀檔就有 | 只給 `讀 {絕對路徑}` 一行 |
| 起始 prompt 用相對路徑 | 新 session cwd 不同會 404 | 一律絕對路徑 |
