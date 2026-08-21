# Windows Codex auto-rename

Windows 的正式流程要求 Codex CLI 0.148.0 以上，並使用一個背景 Codex app-server。使用者仍然只輸入 `codex`；PowerShell
profile 裡的 wrapper 會在第一次使用時啟動 server，之後所有 TUI 都以 `--remote` 連到
同一個 localhost WebSocket。預設從 `4500` 開始；若被占用，會依序嘗試到 `4599`。

## 執行流程

1. 新 PowerShell 載入 `~/.codex/hooks/codex-shared-app-server.ps1` 的 `codex` wrapper。
2. 第一次互動式 `codex` 讀取 `~/.codex/app-server-control/windows-app-server.json`，並核對 PID、listener 與 `/readyz`。
3. 沒有可用 server 時，wrapper 在 `4500–4599` 找空的 port 啟動；後續分頁讀同一份狀態並重用。
4. wrapper 設定 `CODEX_APP_SERVER_URL`，再執行 `codex --remote <實際 endpoint>`。
5. auto-rename hook 取得名稱後，`codex-session-name-set.ps1` 呼叫 `thread/name/set`。
6. app-server 發出原生命名事件，TUI 的 sidebar、status line 與 Windows Terminal 分頁一起更新。

`codex exec`、`login`、`update`、`app-server` 等非互動指令直接交給真正的 Codex，不會經過
remote TUI。server 採延遲啟動，不需要排程工作，也不需要常駐三個手動分頁。若背景 server 啟動失敗，wrapper 會直接啟動原生 Codex；只有 auto-rename 暫停，Codex 本身仍可使用。

## 舊路徑處理

| 舊元件 | Windows Codex 新流程 | 是否仍保留 |
|---|---|---|
| hook 直接更新 `state_*.sqlite` | 改用 `thread/name/set` | Codex 不再使用 |
| `AI_TAB_SYNC_FILE` | Codex 原生 terminal title | Codex 不再使用 |
| `ai-tab-sync.ps1` Watcher | 不啟動 | Claude Code 仍需要，所以共用安裝不能直接刪檔 |
| PowerShell profile 的舊 `codex` tab-sync function | 安裝 Codex namer 時移除並換成 app-server wrapper | 不保留 |
| `state_*.sqlite` 本身 | 仍由 Codex 自己管理 thread | 不能刪資料庫，只是不再由 jr-setup-ui 修改 |

## 與 macOS / Linux 的差別

| 項目 | macOS / Linux | Windows |
|---|---|---|
| 連線 | Unix control socket | localhost WebSocket |
| server 啟動 | Codex 的本機 control socket 流程 | PowerShell wrapper 在第一次 `codex` 時背景啟動 |
| helper | Python Unix WebSocket client | PowerShell `ClientWebSocket` |
| 命名 API | `thread/name/set` | `thread/name/set` |
| Watcher / SQLite / tab-sync | 原生成功後不使用；舊版 fallback 尚保留 | 正式路徑完全移除 |

## 更新背景 server

安裝「Codex 對話自己取名字」後，PowerShell profile 會提供全域
`codex-server-restart` 指令，不需要切換到 jr-setup-ui 或任何特定資料夾。

若 Codex 已更新但背景 server 還是舊版本，先顯示：

```text
Codex 已更新，但背景 server 還是舊版本。

請先關閉所有 Codex 視窗，再開一個新的 PowerShell 視窗，貼上：

codex-server-restart
```

wrapper 每次啟動時會比較狀態檔裡的 server 版本與目前 CLI。版本不同時不會停止舊 server，也不會中斷既有視窗；它會顯示上面的指令，並讓這次新視窗先走原生模式。

restart 會先檢查狀態檔記錄的 port 是否仍有 TUI 連線。有連線就拒絕停止並再次說明；沒有連線
才會確認 PID 是 jr-setup-ui 啟動的 Codex app-server、停止舊程序、用目前 CLI 啟動新版並
等待 `/readyz`。若原 port 已被其他程式占用，會改用下一個空 port 並更新狀態檔。它不會只看 port 就停止未知程序。
