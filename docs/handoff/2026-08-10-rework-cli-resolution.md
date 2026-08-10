# 交接：回訪學生那批問題的重做（新分支）

- **類型**：continuation
- **分支**：`rework/returning-students`（從 `51c3e96` 拉出來，**不是** main 的延續）
- **HEAD**：`17202fc`，512 項測試綠
- **為什麼另開分支**：Reed 決定把回訪學生那批問題重做一次、用比較好的架構，
  不從 main 複製 code。main 那邊的成果留著當對照，不動它。

## 狀態摘要

1. **第一部分做完了**：CLI 解析改成「挑跑得動的那一支」，不是 PATH 上第一個。
   新增 `findAllExecutables` / `pickRunnable`（純函式），三處跟著換判準。
   實作由 codex exec 完成，spec 與 review 在 orchestrator 這邊。
2. **髒環境腳本寫好了**：`scripts/seed-dirty-env.mjs`，一支跨 mac / Windows，
   七種污染。搭 `docs/dirty-vm-setup.md` 使用。
3. **Windows VM 已經照那份文件弄髒過**，假 wrapper 確認生效（profile 第 4 行指向
   已刪的 npm 路徑，`codex --version` 250ms 快速失敗）。
4. **正在查一個新問題**：第一次開頁時 `/env` 花了約 14 秒才回來（200 OK），
   那段時間畫面上沒有環境卡片、setup 卡的「下一張」也消失。

## 必讀檔案

| 檔案 | 為什麼要讀 |
|---|---|
| `docs/dirty-vm-setup.md` | 兩台 VM 怎麼弄髒、弄完要看到什麼。驗收前一定先讀 |
| `scripts/seed-dirty-env.mjs` | 七種污染各自重現哪個問題，理由都在註解裡 |
| `src/spawn-command.js` | 第一部分的成果：`findAllExecutables` / `pickRunnable` 的判準與理由 |
| `docs/returning-students.md` | ⚠️ 這條分支的版本是**舊的**（`51c3e96` 當時）。main 上那份才是最新，但**不要**直接抄回來 |

## 下一步

### 1. `/env` 那 14 秒 ✅ 已修（`8a5f64f`），但還有下半段

**根因**：`spawnEnv()` 的快取寫在 `await` 之後，而環境檢查是十幾支探測**同時**進來的
——每一支都撲空、每一支都自己 spawn 一支 powershell 讀同一份登錄檔。單獨量一支 603ms
（暖機後的數字），十幾支併發就是十幾秒。

**修法**：共用同一個 in-flight promise。**真機驗過：卡片一下就出現了。**

⚠️ **但 Reed 回報「解鎖下一張還要等一段時間」，那條還沒找到。**

已經量過、**排除掉**的（Windows VM，還原快照後）：

| 指令 | 耗時 |
|---|---|
| `codex --version` | 250ms（假 wrapper 快速失敗，不是卡住） |
| `claude auth status` | 591ms |
| `codex login status` | 42ms |
| `gh auth status` | 76ms |
| `powershell.exe … GetEnvironmentVariable` | 603ms ← 就是這支 × 13 |
| `bash -c "exit 0"` | 327ms，而且**根本不在 PATH**（這台還沒裝 Git） |

下一步建議：直接量 `/configs` 那一筆的 Time（DevTools 要**先開好**再貼網址進去，
嚮導自己開的分頁沒有 DevTools）。可疑的是 `src/config-check.js` 的
`probeRegisteredHook` / `probeHook`——**它們完全沒有逾時保護**，子行程不結束就永遠等。

### 1b. 順帶要修的三件（方向已跟 Reed 對過，還沒動手）

1. **setup 卡的「下一張」不該受環境卡片存不存在影響**。它的 `nextUnlocked` 本來就是
   `true`，是「這一段的最後一張」那條路徑把按鈕吃掉的（`public/app.js` 的 `next:`）
2. **每一項探測記耗時、寫進原始輸出**，逾時的那項明確標出來。
   現在只有手動按重新檢查才寫 log，而且沒有耗時
3. 環境那段載入中顯示骨架列，不要一片空白

### 2. 剩下的修復清單

這條分支要做的完整清單（Reed 已排序，第一組已完成）：

**A. 分支缺的功能（main 有）**
- A1 回訪學生偵測：npm 並存、skill 落點、codex 舊 skill 路徑（三條規則要一開始就分清楚）
- A2 清理動作：隔離區搬移、移除 npm 舊版
- A3 合併改成開真終端（含缺行報告、一顆做兩檔）
- A4 Codex 沙箱檢查（junction / MSIX 兩層）
- A5 回報鈴鐺（要**連網址長度一起設計**，見 B1）
- A6 codex 清乾淨腳本（Windows）
- A7 段落最後一張自動重查、進度條底下指名擋著的卡

**B. 全新的修復（main 也沒解）**
- B1 鈴鐺網址過長——現在按下去基本上送不出去
- ~~B2 tab-sync wrapper 拿 PATH 第一個~~ ✅ **已完成**（`3ce7cfd`）
- B3 移除舊版按鈕多清孤兒 shim
- B4 wrapper / function 指向死路徑時自動處理
- B5 第一頁直接查 `pwsh` 是不是 Store 版（不必等沙箱探針）
- B6 診斷終端標題只查 PowerShell 5.1 的 profile 路徑
- B7 合併失敗沒有中止條件
- B8 `service_tier` 這類「新版不收的舊 key」→ `RETIRED_CODEX_KEYS` 可涵蓋

**C. 這一輪討論新增的**
- C1 清理動作跑完，對應 banner 要消失。**寫成宣告式**（每個 action 宣告它讓哪份資料
  失效），不要重蹈 main 那種散落的 if
- C2 全綠之後才出現「清掉隔離區」。條件＝所有 skill 檢查 ok；按之前先列出要刪什麼。
  ⚠️ `.bak` 不一起刪，那是另一件事

建議順序：**B4 + B3 →　A4 + B5 →　A1–A3 + C1 →　A5 + B1 →　C2**

### 3. 驗收方式

Windows VM 從髒快照還原，然後：

```powershell
$JrBranch = "rework/returning-students"; irm https://raw.githubusercontent.com/museReed/jr-setup-ui/main/docs/setup.ps1 | iex
```

⚠️ 驗 wrapper 那條要**先在「分頁標題同步」那一列按安裝**，再**關掉所有 PowerShell 開新的**
（profile 是開視窗時才讀的）。

## 已知問題

- **codex subagent 的 worktree 在 `.worktrees/cli-resolution`**（分支 `codex/cli-resolution`）。
  已經合併回來了，可以清掉：`git worktree remove .worktrees/cli-resolution`
- **BOM 檢查會走訪整棵樹**，所以 `.worktrees` 已加進 `SKIP_DIRS`（`17202fc`）。
  之後再開 worktree 不會再撞到
- **這條分支沒有 main 上 8/8 中午之後的任何東西**。查東西時不要拿 main 的檔案路徑
  來對——很多檔案（`src/legacy.js`、`src/codex-sandbox.js`、清理腳本）在這裡不存在
- **mac VM 還沒弄髒過**。第一部分只改 Windows 那半（posix wrapper 刻意沒動），
  所以還不急，但 A2 之後就需要了
- **`/env` 那 14 秒的根因還沒找到**，上面第 1 點是進行中的線索
