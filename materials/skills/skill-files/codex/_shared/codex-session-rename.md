# Codex Session Rename — 共用參考文件

> 任何需要手動改 Codex session 名稱的 skill，都從這裡取得方法。

## 原理

模型只把名稱寫進暫存 relay 檔。下一次 hook 事件會對共用 Codex app-server 呼叫
`thread/name/set`；Codex 自己把同一個名稱送到 sidebar、status line 與 terminal tab。

| 平台 | 共用 app-server | 命名通道 |
|---|---|---|
| **macOS / Linux** | Codex 的本機 control socket | Unix socket + `thread/name/set` |
| **Windows** | 第一個 `codex` 指令在背景啟動，後續 TUI 共用 | localhost WebSocket + `thread/name/set` |

兩邊都不直接改 SQLite，也不使用 Codex Watcher 或 tab-sync。

## 改名指令

Hook 注入的訊息已經包含這個 session 的精確 relay 路徑；直接執行那一行即可。
手動觸發時依目前 shell 選一個：

| Shell | 指令 |
|---|---|
| Bash / zsh | `printf '%s\n' '📦 新名稱' > /tmp/codex-session-namer/${CODEX_THREAD_ID:-$PPID}.pending` |
| PowerShell | `Set-Content -LiteralPath (Join-Path $env:TEMP "codex-session-namer\$env:CODEX_THREAD_ID.pending") -Value '📦 新名稱' -Encoding utf8` |

這次寫入會觸發 PostToolUse，hook 通常會立刻套用名稱。若 app-server 暫時連不上，relay
檔會保留，下一次 hook 事件自動重試。

## 前提

| 項目 | 說明 |
|---|---|
| **Codex 版本** | Windows 使用支援 `app-server --listen`、`--remote` 與 `thread/name/set` 的版本 |
| **Codex 設定** | `status_line` 包含 `"thread-title"`，`terminal_title = ["thread"]` |
| **Windows 啟動方式** | 從已載入 PowerShell profile 的終端執行 `codex`；wrapper 會自動啟動或重用背景 app-server |
| **Session 定位** | 一律使用 hook 給的 `session_id`／`CODEX_THREAD_ID`，不猜「最近更新」的 thread |

## 使用方式

在 skill 的 SKILL.md 裡寫：

```text
改名方法 → Read `~/.agents/skills/_shared/codex-session-rename.md`
```

## 更新背景 server

安裝 auto-rename 時也會安裝全域 `codex-server-restart`，在哪個資料夾都能直接執行。
更新 Codex 後若背景 server 仍是舊版，先關閉所有 Codex 視窗，再開新的
PowerShell／Terminal 視窗執行：

```text
codex-server-restart
```

Windows 會檢查 localhost WebSocket 連線；macOS 會檢查 Unix socket client。只要仍有
Codex 視窗連線就拒絕停止，避免中斷進行中的工作。確認沒有人使用後，script 才會驗證
server 身分、停止舊程序並以目前的 Codex CLI 建立新版 server。
