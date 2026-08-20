# Windows 為什麼還留著 tab-sync watcher

POSIX（macOS / Linux）在 2026-08-20 拿掉了 watcher，分頁標題改由命名 hook 自己寫。
**Windows 不能照做。** 這份文件記下為什麼，免得下次有人再推導一次、再跑一次同樣的測試。

一句話版本：**在 Windows 上，hook 改不動分頁標題。**

## 兩邊的機制差在哪

| | macOS / Linux | Windows |
|---|---|---|
| 改標題的方式 | 把 OSC 逃逸序列寫進 `/dev/ttysNNN` | `SetConsoleTitle`（`[Console]::Title`）|
| 標題狀態存在哪 | **終端裝置**——寫完就跟寫入者的生死無關 | **console 的行程狀態**——host 退出時會還原 |

Claude Code 呼叫 hook 的方式是：

```
powershell.exe -NoProfile -File "<hook>.ps1"
```

那是一個**子行程**，而 `powershell.exe` 這個 host **結束時會還原 console 標題**。所以
hook 就算成功呼叫了 `[Console]::Title`，它一退出，標題就被復原——等於沒寫。

POSIX 沒有這個問題：OSC 寫進裝置檔案之後就留在那裡，寫入者結束與否無關。

watcher 之所以在 Windows 有效，正是因為它是一個**長壽的、待在同一個 console 裡的
行程**（`-NoNewWindow` 共用 console），標題才留得住。這不是實作偷懶，是機制上唯一
可行的做法。

## 量測（2026-08-20，Windows 11 / PowerShell 5.1 / Claude Code 2.1.237 原生安裝）

測試方式：繞過 profile 的 `claude` wrapper（直接 `& "…\.local\bin\claude.exe"`），
所以**沒有 watcher**，只剩 hook 那條路。每一輪都聊到 5 個以上工具呼叫。

| # | 情境 | 分頁標題 | 名稱檔 |
|---|---|---|---|
| A | 沒有 `CLAUDE_CODE_DISABLE_TERMINAL_TITLE` | `隨機做 10 個工具呼叫`（Claude Code 自己取的）| `⛴️ 隨機 10 個工具呼叫` |
| B | `CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1` | **`Administrator: Windows PowerShell`**（PowerShell 預設值）| 同上 |

讀法：

- **hook 一直都有跑**——兩輪的名稱檔都寫出了帶 emoji 的名字
- **環境變數確實有效**——B 裡面 Claude Code 不再寫標題了
- **但 hook 的標題沒有接上**——所以 B 掉回 PowerShell 預設值

A 的標題（`隨機做 10 個工具呼叫`）跟名稱檔（`⛴️ 隨機 10 個工具呼叫`）**字串不一樣**，
這順便證明了 Claude Code 有自己一套獨立的命名器，不是在轉發我們的名字。

## ⚠️ 兩個會騙人的假象

測這件事的時候踩過兩次，都浪費了時間。

### 一、用 `powershell -File` 測，標題永遠不會變

```powershell
powershell -NoProfile -File .\set-session-name.ps1 "🔧 測試" ""   # 標題不變
& .\set-session-name.ps1 "🔧 測試" ""                              # 標題正常變
```

第一行失敗**不代表腳本壞了**——是 host 還原標題。要驗腳本本身，用 `&` 在同一個
行程裡執行。

反過來說：第二行成功**也不代表 hook 會成功**，因為 hook 走的正是第一行那條路。

### 二、名稱檔看起來是亂碼

```powershell
Get-Content …\session-names\xxx.txt                    # ðŸ"§ å‰ç¶´æ¸¬è©¦
Get-Content …\session-names\xxx.txt -Encoding UTF8     # 🔧 前綴測試
```

名稱檔是 UTF-8 **不帶 BOM**，PowerShell 5.1 的 `Get-Content` 預設用系統 ANSI
codepage 讀。讀的時候一定要加 `-Encoding UTF8`。

## 那要拿掉 Windows 的 watcher，需要什麼

不是「再驗一次」就能解決的，需要其中之一：

1. Claude Code 改用不會還原標題的方式呼叫 hook（我們控制不了）
2. 找到一種**不受行程生命週期影響**的方式改 Windows Terminal 的分頁標題
   （目前已知：OSC 寫進 `\\.\CONOUT$` 開得起來但標題不動，見
   `materials/skills/hooks/set-session-name.ps1` 的註解）
3. 改由某個長壽行程代寫——那就是 watcher 本身

## 相關

- `feat/windows-native-codex-rename` 讓 **Codex** 不再需要 watcher（改用 app-server
  原生命名），但 **Claude Code 仍然需要**，所以共用的 `ai-tab-sync.ps1` 不能刪。
  該分支的 `docs/windows-codex-auto-rename.md` 也是這樣寫的。
- POSIX 那一半的做法與取捨，見 `src/config-install.js` 裡 `posixTabSyncFunction`
  的註解。
