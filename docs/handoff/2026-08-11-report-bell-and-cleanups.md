# 交接：回報鈴鐺、合併改開真終端、以及一個影響所有 CLI 解析的 bug

- **類型**：continuation
- **分支**：`rework/returning-students`（`d64b440`，630 項測試綠）
- **前一份**：`docs/handoff/2026-08-10-rework-cli-resolution.md`——**修復清單（A/B/C）與
  各項的設計理由都在那裡，先讀它**。這一份只記 8/11 這一天的進展與新發現。

## 狀態摘要

1. **A3 合併改開真終端**完成並在 VM 驗過：拍快照 → 開視窗讓 agent 跑 → 比對缺行 →
   需要時「還原成合併前」。判準是「換位置不算弄丟」。
2. **A5 + B1 回報鈴鐺**完成（**未在 VM 驗過**）：「複製診斷資料」換成「這一頁卡住了」，
   先開框給學生看內容＋選填描述，送出走 `gh issue create --body-file`。
3. **GitHub 那張卡排到 CLI 之前**——鈴鐺要 gh 已登入才送得出去（Reed 拍板，不留網址退路）。
4. **B8** `service_tier = "default"` 停用（只停那個值，不動合法的 `fast`/`flex`）。
5. **GUIDANCE 渲染**補上：黃燈又沒按鈕的那幾列現在講得出自救步驟。
6. **抓到一個影響所有 CLI 解析的 bug**（見下）。
7. **B5 的警告拿掉**：實測 Store 版 PowerShell 底下 Codex 沙箱正常，原本那句斷言沒有根據。

## 必讀檔案

| 檔案 | 為什麼要讀 |
|---|---|
| `docs/handoff/2026-08-10-rework-cli-resolution.md` | 修復清單本體、A/B/C 各項的理由與已完成標記 |
| `src/spawn-command.js` | `findAllExecutables` 的「列目錄而不是 stat」——那個 bug 的修法與理由 |
| `src/merge-backup.js` / `src/merge-report.js` | A3 的兩塊判準：快照／群組主人、缺行怎麼算 |
| `public/report.js` + `src/report-issue.js` | 回報內容怎麼組、怎麼交給 gh。前者是瀏覽器端，後者才真的 spawn |
| `src/legacy-cli.js` | npm 殘留的三種情況，尤其第 3 種「只有 npm 版」的保護條件 |

## 下一步

### 1. VM 驗收回報鈴鐺（**還沒驗過，優先做**）

```powershell
$JrBranch = "rework/returning-students"
irm https://raw.githubusercontent.com/museReed/jr-setup-ui/main/docs/setup.ps1 | iex
```

要看的四件：

1. 卡片順序：**版本控制與 GitHub 排在 Claude Code 之前**
2. 右上角「這一頁卡住了」→ 開框，預覽裡**不能出現使用者本名**（路徑要是 `~`）
3. 寫一句描述、送出 → 拿到 issue 網址
4. 去 `museReed/jr-setup-feedback` 看那則 issue

⚠️ **先確認那個 repo 存在且公開**：`gh repo view museReed/jr-setup-feedback`。
不存在的話 gh 回 404，我們的訊息會說「這是嚮導的問題」。

### 2. 剩下的修復清單

`C2`（全綠之後才出現「清掉隔離區」）、`A6`（codex 清乾淨腳本）、`A7`（段落最後一張
自動重查）。B6（診斷終端標題只查 5.1 profile）也還在。

### 3. 兩件懸著的決策

- **要不要統一要求 PS7**：`&&` 在 5.1 剖析不了，hook 的行為驗證因此驗不到（畫面會誠實
  說「被 5.1 的剖析器擋下」，不是假綠燈）。連帶成本見 8/10 那份
- **winget 裝 PowerShell 給的不一定是 MSI**：`installers.js` 裡那支已備好但**沒接到畫面**，
  註解寫明了為什麼

## 已知問題

- **`scripts/merge-in-terminal.mjs` 不可以在本機執行**——它會開視窗、叫 agent、改真實
  檔案。開發時犯過兩次，第一次動到了 Reed 的 `~/.codex/config.toml`（靠快照還原）。
  折回邏輯的正確性由 `test/merge-backup.mjs` 的純函式測試涵蓋，不需要真的跑它。
- **拿掉網址退路的代價**：gh 自己裝失敗或登入失敗時，學生沒有回報管道。
- **「測試綠、畫面壞」這一族又多兩個**（8/10 那份的 2c 節記了前三個）：
  - 卡片按鈕來自「第一個還沒好的那一列」，而那一列不見得是群組主人 → Codex 卡沒有合併鍵
  - **新增前端模組忘了加進 `server.js` 的 `ASSETS`** → 那支 import 拿到 401，整頁停在
    載入中，只有 console 看得到。已加守衛（`test/frontend-layers.mjs`）
- **VM 狀態已經不乾淨**：裝過 git/gh/python、清過 wrapper 與 skill、接過 sandbox
  junction、合併過設定檔。要乾淨基準得重新還原快照。

## 這一天抓到最有價值的一個

**Windows 的「應用程式執行別名」我們整套系統看不見。**

`%LOCALAPPDATA%\Microsoft\WindowsApps` 底下那些是零位元組的 APPEXECLINK reparse point。
真機量到：`existsSync` → `false`、`statSync` → `EACCES`、`readdir` → **看得到**。

`findAllExecutables` 是所有 CLI 解析的共用底層（挑跑得動的那一支、沙箱查 codex 路徑、
npm 殘留偵測都靠它），所以**任何從 Store／應用程式別名來的東西一律看不見**。
最諷刺的是 B5 那一列的全部目的就是偵測 Store 版，而它結構上做不到。

已修（`c7dc131`）：每個 PATH 目錄列一次、比檔名。`existsSync` 保留當主要判準
（測試靠它注入假檔案系統）。
