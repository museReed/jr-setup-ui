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

## Windows 也有「閃一下又跳回去」，成因跟 macOS 相同

在分頁裡進入一個背景 agent 時，標題會先出現**那個 agent 的正確名字**，一秒內又跳回
**上一個互動 session 的名字**。macOS 在拿掉 watcher 之前是同一個現象。

鏈條兩個平台一樣：

1. 進入 agent → **Claude Code 自己把 agent 的名字寫進標題**（那個名字就是 auto-rename
   寫進 `jobs/{id}/state.json` 的名字）
2. ≤1 秒後 → **watcher 把 sync 檔的內容寫上去**

sync 檔裡是那個互動 session 的名字：背景 session 的命名走 job state 分支，不寫 sync
檔，所以檔案內容從頭到尾沒變，watcher 就一直把舊名字貼回去。

差別只在寫入手段（macOS 是 OSC 進裝置、Windows 是 `SetConsoleTitle`）。現象、成因、
時間長度都一致。

## 為什麼 Windows 不能照 macOS 那樣修

macOS 的修法是**拿掉 watcher，改成事件驅動**——命名 hook 自己在需要的時候寫一次。
看 agent 期間本 session 沒有 hook 事件，沒人去蓋，agent 的名字就留得住。

Windows 卡在第一步：**hook 寫不進標題**（見上一節）。所以「拿掉 watcher」等於沒有
任何人寫標題。

那退一步呢——**留著 watcher，但只在 sync 檔變動時才寫**？看 agent 期間 watcher 不動，
名字一樣留得住。這個想法自相矛盾：

> watcher 那個「每秒無條件重寫」，正是它贏過 Claude Code 的唯一手段。改成事件驅動
> 之後，互動 session 的標題就會被 Claude Code 蓋掉。

那用 `CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1` 讓 Claude Code 閉嘴呢？**也不行**——閉嘴
之後，鏈條第 1 步那個「Claude Code 寫入 agent 正確名字」會一起消失，標題只會停在舊
名字，連閃都不閃。

**Claude Code 同時是敵人和唯一的來源**：互動 session 的標題要贏過它，看 agent 時又
只有它會寫出正確的名字。這是目前解不開的地方。

### 還沒探索的方向

`ai-tab-sync.ps1` 的註解提到 Windows **可以把標題讀回來**（`[Console]::Title` 的
getter），macOS 的 bash 做不到。理論上 watcher 可以「讀回來判斷是誰寫的，是 Claude
Code 寫的 agent 名字就別動」。

但要怎麼可靠地分辨「Claude Code 寫的 agent 名字」和「其他程式亂寫的」，目前沒有判準。
**這是個方向，不是方案。**

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
