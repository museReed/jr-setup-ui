# 交接：後端分層重構、log 強化、白名單行為驗證

- **Branch**：`refactor/backend-layers`（16 顆，全部已推，481 項測試綠）
- **類型**：continuation——分支還沒 VM 驗收完，而且卡在一個沒答案的問題上
- **今天已合併進 main 的**：PR #40 #41 #42 #43

## 狀態摘要

分支上三批工作：

1. **後端重構**（零行為改動）：抽出 `src/sse.js`、`src/run-registry.js`，十條路由改成一張表，`server.js` 909 → 552 行；新增 `test/backend-layers.mjs` 把「領域不依賴轉接頭」「能 spawn 的是一份寫死清單」「路由就這十條」寫成測試。
2. **log 強化**：原始輸出每行標相對時間、開頭寫環境摘要（平台/Node/來源分支/選擇）、中止紀錄進得了學生貼得回來的地方、每張卡保留最近三次執行、「複製診斷資料」改帶原始輸出並拿掉全部動畫紀錄。
3. **白名單行為驗證**：`verify-in-terminal` 新增 `allowlist` 情境，四步覆蓋四種規則形狀；並修掉兩個 VM 上才看得到的坑——題目沒說結果檔的資料夾已存在（模型會先去建目錄然後撞權限，整條斷掉），以及合併卡的第二個驗證沒有按鈕可以按。

## 必讀檔案

| 檔案 | 為什麼要讀 |
|---|---|
| `scripts/verify-in-terminal.mjs` 的 `allowlist` 情境 | 那段註解寫了「為什麼不跑全部 39 條」「為什麼沒有陰性對照」，避免重新想一遍 |
| `src/config-install.js` 的 `matcher: "Bash"`（約 674 行） | 下面那個未解問題的根源 |
| `materials/claude-code/hooks/block-chained-bash.js` 第 21 行 | 同上：`tool_name !== "Bash"` 就直接 return |
| `test/backend-layers.mjs` | 後端分層的規則，改後端前先看 |
| `docs/fresh-vm-acceptance.md` 第八節 | 驗收紀錄要寫哪三件事 |

## 下一步

### 1. 決定要不要補 Windows 的 PowerShell 落差

**已確認（`chained-claude.txt` 裡是 hook 的原文）：hook 在 Windows 上有生效，`echo a && echo b` 走 Bash 被擋下來了。那張卡教的規矩沒破。**

但 Windows 上 Claude Code 有兩條路，模型自己選：

| 路徑 | hook | 白名單 |
|---|---|---|
| Bash（Git Bash） | 會擋 | 39 條命中 |
| PowerShell | **完全不經過**（`matcher: "Bash"`，腳本也 `tool_name !== "Bash"` 就 return） | **一條都對不上**（39 條全是 `Bash(...)`） |

實測看到的：模型用 `New-Item -ItemType Directory ... ; Test-Path ...` 建目錄，**帶著分號沒被擋**，還跳出 `This command requires approval`。

要補的話兩件事，但**都需要先知道那個工具的實際名字**（畫面標頭寫「PowerShell command」，不等於 `tool_name`）：

1. hook 的 `matcher` 加上那個名字，腳本的 early return 也跟著改
2. 白名單補一份 PowerShell 版（`New-Item` / `Test-Path` / `Get-Content` / `Get-ChildItem`…），可能要拆成 `starter-allowlist.win32.json`

取得工具名字的方法：在 Windows 上讓 Claude 跑一次 PowerShell 指令，看 `~/.claude` 底下的 session log，或請它自己回報 tool name。

**這件事不緊急**——規矩沒破，只是學生偶爾會遇到「這條為什麼要問我」。

### 2. VM 驗收

清單見下面「驗收要點」。驗完開 PR 合併。

### 3. 乾淨 VM 的債

今天合併的四個 PR 全部是在同一台跑過很多輪的機器上驗的。`docs/fresh-vm-acceptance.md` 第一段就寫著那樣不算數。這條分支合併後開一台全新的，從 bootstrap 走到分頁標題變成命名——順便驗 `.jr-source` 那一行變成真的分支名（現在顯示 `unknown` 是正確的，bootstrap 腳本永遠從 main 抓）。

## 驗收要點

```powershell
$JrBranch="refactor/backend-layers"; irm https://raw.githubusercontent.com/museReed/jr-setup-ui/main/docs/setup.ps1 | iex
```

| # | 動作 | 要看到 |
|---|---|---|
| 1 | 任一驗證跑起來 | 開頭四行摘要 + 每行 `[+N.Ns]`，**`exit code` 那行也要有** |
| 2 | 同一顆按三次 | 分隔線、只留最近三次 |
| 3 | 跑到一半按取消 | 面板出現 `[terminateRun] …來源：cancel-endpoint` |
| 4 | 複製診斷資料 | 有 `output` / `sections` / `tour`；**沒有**幀號、沒有逐筆紀錄 |
| 5 | 三張合併卡的安裝鍵 | GitHub CLI / Python / 終端機視窗都要在 |
| 6 | 登入那格輸入東西 | `POST /input`（搬 run-registry 時它漏過一個 export） |
| 7 | 終端 Ctrl+C | 立刻結束，不多等三秒 |
| 8 | 清空 `permissions.allow` 後重跑白名單那格 | **要紅**——一個永遠會過的驗證比沒有更糟 |

## 已知問題

- **白名單只有一份 `Bash(...)`，兩平台共用**。Windows 上大半條命不中（見「下一步 1」）。
- **白名單那格的正面判定仍靠模型自我回報**：token 是模型判斷「有沒有跳提示」後才寫的。要變成真副產物得改 headless（`claude -p --output-format stream-json`，且**不要傳** `--allowedTools`，讓 settings.json 獨自決定），從事件流找證據。反面（陰性對照）判不了，理由記在 `verify-in-terminal.mjs` 的註解裡。
- **mac 的進度輸出過濾還沒做**：`src/output-noise.js` 只認得 winget 的形狀，brew / curl 的進度不會被擋。要等 mac VM 上的真實輸出再補，憑印象寫正規式容易吃掉錯誤訊息。
- **`brew` 的 `NONINTERACTIVE=1` 沒有實測支撐**：預防性加的，`ghostty` 那條 cask 可能要密碼。
