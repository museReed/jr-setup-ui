# Codex Session Rename — 共用參考文件

> 任何需要手動改 Codex session 名稱的 skill，引用此文件取得方法。
> 不要各自重寫 — 改版時只改這一份。

---

## 原理

改名有兩個顯示面，由 session-namer hook（`~/.codex/hooks/codex-session-namer.sh`，
jr_ai_agent_skills installer 安裝）統一同步：

1. **Sidebar**：Codex 把 session 存在 SQLite（`~/.codex/state_*.sqlite` 的 `threads` 表）
2. **Terminal tab**：`mycodex` wrapper 建立 `$AI_TAB_SYNC_FILE`，背景 watcher 輪詢它並寫 OSC 到 tty

模型在 sandbox 裡**不能**直接寫 SQLite 或 `~/.ai-session-names/`（readonly database / 路徑限制），
所以唯一要做的是寫一個 **relay 檔**（`/tmp` 永遠可寫）；hook 在下一次 hook 事件
（tool call 或用戶訊息）時把名稱套用到 SQLite + tab sync file。

## 改名指令（唯一步驟）

```bash
# $PPID 在 Codex tool shell 裡 = Codex process PID（hook 用同一個 key 讀）
mkdir -p /tmp/codex-session-namer && echo '📦 新名稱' > /tmp/codex-session-namer/${PPID}.pending
```

寫完即可回報。這個寫入本身是一次 tool call → 觸發 PostToolUse → hook 立即套用。

### 驗證（需要時才做）

```bash
CODEX_DB=$(ls -t ~/.codex/state_*.sqlite 2>/dev/null | head -1)
sqlite3 -header -column "$CODEX_DB" \
  "SELECT id, title, preview FROM threads WHERE id='${CODEX_THREAD_ID}';"
```

## 備援：直接 UPDATE SQLite（僅 hook 未安裝時）

⚠️ 只改 sidebar、**不會**同步 terminal tab；正常情況一律走 relay 檔。

```bash
CODEX_DB=$(ls -t ~/.codex/state_*.sqlite 2>/dev/null | head -1)
sqlite3 "$CODEX_DB" "UPDATE threads SET title='📦 新名稱', preview='📦 新名稱' WHERE id='${CODEX_THREAD_ID}';"
```

## 注意事項

| 項目 | 說明 |
|---|---|
| **Relay 檔 key** | 檔名用 `${PPID}.pending`（Codex process PID）。hook 注入的訊息若已給精確路徑，直接用那個路徑 |
| **生效時機** | hook 在「下一次 hook 事件」套用 — relay 寫入本身就是一次 tool call，所以通常立即生效 |
| **Session 定位（驗證/備援用）** | 用 `$CODEX_THREAD_ID` 定位 thread。不要用 `ORDER BY updated_at_ms DESC LIMIT 1` — 多 session 同時開會改錯 |
| **版號變更** | DB 檔名是 `state_5.sqlite`，升級後可能變 `state_6`。用 `ls -t state_*.sqlite \| head -1` 自動適配 |
| **單引號轉義** | 名稱含 `'` 會壞 shell quoting；避免單引號 |
| **Terminal tab 前提** | 需用 `mycodex` 啟動（watcher + `$AI_TAB_SYNC_FILE`）。VS Code 系（Cursor / Antigravity）另需 `"terminal.integrated.tabs.title": "${sequence}"` 設定 |
| **Claude Code 環境** | 偵測 `$HOME/.claude/session-names` 存在 → 走 Claude Code 路徑（直接寫 `$AI_TAB_SYNC_FILE` + session-names 檔），不走 relay |

## Schema 參考（threads 表關鍵欄位）

```
id              TEXT    — UUID，session 唯一識別
title           TEXT    — session 顯示名稱
preview         TEXT    — sidebar 預覽文字（必須跟 title 一起改，否則 sidebar 顯示舊文字）
cwd             TEXT    — 啟動時的工作目錄
updated_at_ms   INTEGER — 最後更新時間（毫秒），用來辨識當前 session
```

## 使用方式

在 skill 的 SKILL.md 裡寫：

```
改名方法 → Read `~/.agents/skills/_shared/codex-session-rename.md`
```

不要把指令複製到每個 skill 裡 — 改版時只要更新這一份。
