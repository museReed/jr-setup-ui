# 交接：回報鈴鐺、合併改開真終端、以及一個影響所有 CLI 解析的 bug

- **類型**：continuation
- **分支**：`rework/returning-students`（642 項測試綠）
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
8. **C2 / A6 / A7 三項完成**（8/12，**都沒在 VM 驗過**，見下面那一節）。

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
3. 寫一句描述、送出 → **那則 issue 會自動在瀏覽器打開**
4. 在那個頁面把一張截圖拖進留言框（`gh issue create` 沒有附件功能，Contents API 又要
   寫入權限，所以圖只能在 GitHub 自己的畫面上拖——這是刻意的設計不是偷懶）

⚠️ **先確認那個 repo 存在且公開**：`gh repo view museReed/jr-setup-feedback`。
不存在的話 gh 回 404，我們的訊息會說「這是嚮導的問題」。

### 2. 剩下的修復清單

~~`C2`、`A6`、`A7`~~ ✅ **三項都完成了**（見下面「8/12 這一輪」）。**都沒在 VM 驗過。**
B6（診斷終端標題只查 5.1 profile）還在。

### 3. 兩件懸著的決策

- **要不要統一要求 PS7**：`&&` 在 5.1 剖析不了，hook 的行為驗證因此驗不到（畫面會誠實
  說「被 5.1 的剖析器擋下」，不是假綠燈）。連帶成本見 8/10 那份
- **winget 裝 PowerShell 給的不一定是 MSI**：`installers.js` 裡那支已備好但**沒接到畫面**，
  註解寫明了為什麼

## 8/12 這一輪：C2 / A6 / A7

三項都做完，642 項測試綠。**一項都沒在 VM 驗過**，驗收步驟寫在各節最後。

### C2 清掉隔離區（`src/quarantine.js` + `scripts/clear-quarantine.mjs`）

那兩顆清理鍵刻意是「搬」不是「刪」，所以搬完之後 `~/.jr-setup/quarantine/` 就一直
躺著，而且沒有任何地方講得出它存在。這一列負責講出來，並給一顆真的刪掉的按鈕。

三個判準值得記住，各自都是踩得到的坑：

| 判準 | 為什麼 |
|---|---|
| **兩列清理都 ok 才出現** | 隔離區裡的東西正是那兩顆按鈕搬進去的。它們還沒綠就代表可能還要搬回來——在那之前給刪除鍵，等於在退路還用得到的時候把退路收掉 |
| **綠燈，不是黃燈** | 判成黃燈的話環境段永遠不會全綠，學生會被一個他明明沒有毛病的狀態擋在段落閘門外。這是唯一一列「綠燈才有按鈕」的 |
| **按之前先列出要刪什麼** | 唯一一顆刪掉回不來的按鈕。清單畫在卡片上（走 `guidance`），不是按下去才在終端裡追認 |

⚠️ 為了畫那張清單，`envCardRowModel` 改成 **`check.guidance` 優先於靜態的 `GUIDANCE`
表**——每台機器要刪的東西不一樣，寫不進那張表；而且 `guidanceModel` 只對黃燈紅燈開口。

⚠️ 那一列**只回名字不回路徑**。路徑裡有學生的使用者名稱（常常是本名），而這一列會
整包送到瀏覽器，「這一頁卡住了」會把畫面上的東西貼到公開的 issue 上。

⚠️ **`.bak` 不一起刪**（Reed 拍板）：範圍寫死在 `quarantine/<分區>/` 的第一層。
同一層的 `~/.jr-setup/merge-backups` 與 profile 旁邊的 `.bak.<時間戳>` 一個都不碰
——那是唯一能把學生自己寫的規則救回來的東西。

**驗收**：先按那兩顆清理鍵讓它們轉綠，隔離區才會有東西、那一列才會出現。
要看它出現又消失的話，`node scripts/clear-quarantine.mjs`（不加 `--apply`）先看清單。

### A6 codex 清乾淨腳本（`scripts/reset-codex-install.ps1`）

從 main 搬過來，但**只搬這條分支還沒有的那五節**（Reed 拍板）：winget、Store/MSIX、
使用者目錄底下的安裝、使用者 PATH 殘留、沙箱快取。

**npm 殘留與 profile 函式那兩節沒搬**，改成一句「回嚮導按那顆」。理由跟當初 B3 併進
A2 一樣：嚮導那兩顆按鈕的判準這支腳本做不到——`legacy-cli.js` 分得出「只有 npm 版、
沒有官方版就不動」，`shell-wrapper.js` 會跳過我們自己的 tab-sync 區塊。同一段清理
邏輯寫兩份，遲早只會改到其中一邊。

⚠️ **刻意沒有接成按鈕**。它會改使用者 PATH，而 PATH 是開視窗時才讀的——跑完一定要
關掉嚮導與所有 PowerShell 重來，做成按鈕等於在一個狀態已經作廢的畫面上繼續按。

⚠️ 第 3 節會把「接回沙箱檔案」那顆接的 junction 一起帶走（它就在 `Programs\OpenAI\
Codex\` 底下）。那是對的：整個安裝目錄都要重來。重裝完回嚮導再按一次那顆就好。

⚠️ **這支沒有被 PowerShell 剖析過**——開發機沒有 pwsh，只過了 BOM 檢查。
VM 上第一次跑一定要先用不加 `-Apply` 的「只看不動」模式。

### A7 段落最後一張自動重查 + 指名擋著的卡

兩半各修一個「畫面說不出話」的毛病：

1. **自動重查**（`sectionEndRecheck` + `app.js` 的 `maybeRecheckAtSectionEnd`）：
   段落閘門看的是上一次檢查的快照，而學生按完安裝、驗證、清理往下翻，翻到最後一張
   時快照多半已經過期——畫面說這段沒完、下一段鎖著，而他手上沒有任何線索。現在翻到
   最後一張就自己重查一次。
   - **只重查算得出這一段完成度的那一半**：環境段查環境、其餘查規則檔。環境段十三項
     併行 spawn，Windows 上實測 8.3 秒，為了規則段的一張卡順手重跑它很貴
   - ⚠️ **`alreadyDone` 是唯一的煞車**。沒有它會無限迴圈：重查完會 `renderWizard`，
     而 `renderWizard` 又走到這裡。往回翻就把記憶清掉，翻回來算新的一次
   - 有東西在跑（安裝／驗證／已經在查）時不查：跑到一半的狀態本來就不是結論

2. **指名擋著的卡**（`sectionStatus`）：原本進度條上面那一行只講「還有 3 張要做」。
   那句話對站在最後一張的學生沒有用——他眼前這張是綠的，卻被告知還有三張，只能一張
   一張往回翻。現在寫成「還沒做完：「Codex CLI」（第 3 張）、⋯」。點名規則跟
   `sectionGateState` 對齊：只講前兩張，其餘「等 N 張」。

⚠️ 這一改讓 `card.label` 從「順便有」變成「一定要有」。真的資料一律由 `checkCard`
帶上，但 `test/viewmodel.mjs` 的 fixture 原本沒給，第一次跑就畫出
`「undefined」（第 2 張）` ——已補進 fixture 並留了註解。

**驗收**：走到任何一段的最後一張，看終端有沒有出現「走到這一段的最後一張，順手重新
確認一次狀態。」，以及進度條上面那一行有沒有指名。⚠️ 特別確認**它不會一直重查**
（那就是煞車失效）。

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
