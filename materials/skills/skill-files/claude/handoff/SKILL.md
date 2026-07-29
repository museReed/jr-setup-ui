---
name: handoff
description: >-
  Use when ending a session, context running low, or user requests a handoff document.
  Produces a structured handoff file for the next session to continue seamlessly.
  Triggers on "handoff", "交接", "寫 handoff", "session 結束".
user-invocable: true
---

# /handoff — Session 交接文件產生器

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

- Session 要結束時（用戶主動 `/handoff` 或 context 告警）
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

路徑規則：
- 文件「內部」引用的路徑一律用 repo-relative（`docs/handoff/...`），禁止帶 `.worktrees/` 前綴（Step 5 回報的起始 prompt 例外，用絕對路徑）
- 若檔案只存在於特定 branch，標注 `(branch: {name})`

✅ DO: 用具體的 PR 號碼、檔案路徑、指令
❌ DON'T: 寫模糊的「繼續之前的工作」

### Step 4: Commit

```bash
git add docs/handoff/{file}
git commit -m "docs: add session handoff — {topic}"
```

Commit 到當前 branch，不要切換 branch。

### Step 5: 改 Session Name + 回報

改名為 `📦 {topic}`（topic 轉中文敘述，≤ 30 字元）。一個 Bash call 完成：

```bash
TERMINAL_PID=$(ps -o ppid= -p $PPID 2>/dev/null | tr -d ' ') && \
mkdir -p ~/.claude/session-names && \
echo '📦 {topic}' > ~/.claude/session-names/${TERMINAL_PID}.txt && \
if [ -n "$AI_TAB_SYNC_FILE" ]; then echo '📦 {topic}' > "$AI_TAB_SYNC_FILE"; \
else TTY_DEV=$(ps -o tty= -p $PPID 2>/dev/null | tr -d ' '); \
  [ -n "$TTY_DEV" ] && [ -w "/dev/$TTY_DEV" ] && printf '\033]0;📦 {topic}\007' > "/dev/$TTY_DEV"; fi ; \
rm -f /tmp/claude-session-namer/$PPID.default
```

⚠️ 不要把 OSC 印到 stdout — Claude Code 2.1+ 會過濾工具輸出裡的 ESC bytes。
tab 由 `$AI_TAB_SYNC_FILE`（myclaude wrapper + watcher）同步；沒有 wrapper 時才直寫 tty device。

回報格式（最後一行必須是可直接複製的單行起始 prompt，路徑用絕對路徑）：

```
Handoff 已產出：{abs_path}
Branch: {current_branch}
下個 session 貼這行繼續：讀 {abs_path}
```

⚠️ 只輸出上面三行，不要重述交接文件的內容——狀態摘要、必讀檔案、下一步都已寫在文件裡，新 session 讀檔即可。

## Common Mistakes

| Mistake | Why it fails | Fix |
|---------|-------------|-----|
| 已完成的工作寫成長篇報告 | 新 session 花大量 context 讀 | ≤ 10 行，detail 指向必讀檔案 |
| 缺「下一步」 | 新 session 不知道做什麼 | 必填，寫具體動作 |
| 必讀檔案只列路徑 | 新 session 不知道為什麼要讀 | 每項附原因 |
| 忘記改 terminal name | 無法辨識哪個 session 已交接 | Step 5 必做，📦 前綴 |
| OSC 印到 stdout | Claude Code 2.1+ 過濾 ESC，永遠到不了 terminal | 寫 `$AI_TAB_SYNC_FILE` 或 tty device |
| 路徑帶 .worktrees/ 前綴 | 新 session 不在同一個 worktree 就 404 | 一律 repo-relative |
| 起始 prompt 重述整份交接內容 | 浪費輸出，新 session 讀檔就有 | 只給 `讀 {絕對路徑}` 一行 |
| 起始 prompt 用相對路徑 | 新 session cwd 不同會 404 | 一律絕對路徑 |
