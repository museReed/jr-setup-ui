# Windows Codex app-server 原生命名測試

這份測試確認 Windows VM 能否在不使用 tab-sync Watcher 的情況下，透過同一個 Codex app-server 的 `thread/name/set` 即時更新 TUI 名稱、status line 與 Windows Terminal 分頁。

## 前置條件

- Codex CLI 0.146.0 或更新版本。
- Node.js 22 或更新版本；測試腳本使用 Node 內建的 WebSocket client。
- 三個 Windows Terminal 分頁。

每個分頁都先執行 `pwsh -NoProfile`，避免既有 PowerShell profile 啟動 tab-sync Watcher。

## 1. 分頁 A：啟動 app-server

```powershell
pwsh -NoProfile
```

```powershell
Remove-Item Env:AI_TAB_SYNC_FILE -ErrorAction SilentlyContinue
```

```powershell
codex app-server --listen ws://127.0.0.1:4500
```

保持這個分頁開啟。

## 2. 分頁 B：連接 Codex TUI

```powershell
pwsh -NoProfile
```

```powershell
Remove-Item Env:AI_TAB_SYNC_FILE -ErrorAction SilentlyContinue
```

```powershell
codex -c 'tui.status_line=["thread-title"]' -c 'tui.terminal_title=["thread"]' --remote ws://127.0.0.1:4500
```

進入 TUI 後送出以下訊息，等 Codex 回答完，再保持 TUI 開啟：

```text
WINDOWS_APP_SERVER_RENAME_PROBE
```

## 3. 分頁 C：執行測試腳本

切到這個 repository 的根目錄後執行：

```powershell
node .\scripts\test-windows-codex-app-server-rename.mjs
```

腳本會挑最近更新且仍載入中的 CLI thread，呼叫 `thread/name/set`，再用 `thread/read` 確認名稱已保存。

若同時開著多個 Codex TUI，可指定 thread id：

```powershell
$env:CODEX_THREAD_ID = "你的 thread id"
```

也可指定測試名稱：

```powershell
$env:CODEX_THREAD_NAME = "Windows native rename probe"
```

## 判定結果

| 結果 | 代表什麼 |
|---|---|
| 印出 `PASS`，status line 與分頁都立即改名 | Windows 可不用 Watcher 完成 Codex auto-rename 的同步階段 |
| 印出 `PASS`，只有 status line 改名 | app-server 已跑通；檢查 Windows Terminal 的 `suppressApplicationTitle` |
| 印出 `PASS`，但 TUI 沒改名 | 名稱已保存，但 Windows TUI 沒有即時處理 `thread/name/updated` |
| 找不到已載入的 thread | 分頁 B 尚未送出訊息，或沒有連到同一個 app-server |
| 無法連到 `127.0.0.1:4500` | 分頁 A 沒啟動成功，或連接埠被占用 |

這支腳本只驗證 watcher-free 的名稱同步路徑，不會安裝 hook，也不會修改 SQLite 或 `AI_TAB_SYNC_FILE`。通過後，再把 auto-rename 產生的名稱接到同一個 `thread/name/set` 呼叫。
