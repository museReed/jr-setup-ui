# 交接：回訪學生那批問題的重做（新分支）

- **類型**：continuation
- **分支**：`rework/returning-students`（從 `51c3e96` 拉出來，**不是** main 的延續）
- **HEAD**：`17202fc`，512 項測試綠
- **為什麼另開分支**：Reed 決定把回訪學生那批問題重做一次、用比較好的架構，
  不從 main 複製 code。main 那邊的成果留著當對照，不動它。

## 狀態摘要

1. **第一部分做完了、而且真機驗過了**：CLI 解析改成「挑跑得動的那一支」，不是 PATH
   上第一個。新增 `findAllExecutables` / `pickRunnable`（純函式），三處跟著換判準。
   實作由 codex exec 完成，spec 與 review 在 orchestrator 這邊。
   **髒 Windows VM 驗收通過**：裝完 tab-sync、重開 PowerShell 後 `codex --version`
   回 `codex-cli 0.147.0`（修之前是 250ms 快速失敗）。
2. **髒環境腳本寫好了**：`scripts/seed-dirty-env.mjs`，一支跨 mac / Windows，
   七種污染。搭 `docs/dirty-vm-setup.md` 使用。
3. **Windows VM 已經照那份文件弄髒過**，假 wrapper 確認生效（profile 第 4 行指向
   已刪的 npm 路徑，`codex --version` 250ms 快速失敗）。
4. **第一次開頁很慢那件已經解完了**：`/env` 十幾秒（`8a5f64f`）與 `/configs` 序列執行
   （`c555a79`）兩段都修了，Windows VM 驗收通過——第一眼就有卡片與「下一張」。

## 必讀檔案

| 檔案 | 為什麼要讀 |
|---|---|
| `docs/dirty-vm-setup.md` | 兩台 VM 怎麼弄髒、弄完要看到什麼。驗收前一定先讀 |
| `scripts/seed-dirty-env.mjs` | 七種污染各自重現哪個問題，理由都在註解裡 |
| `src/spawn-command.js` | 第一部分的成果：`findAllExecutables` / `pickRunnable` 的判準與理由 |
| `docs/returning-students.md` | ⚠️ 這條分支的版本是**舊的**（`51c3e96` 當時）。main 上那份才是最新，但**不要**直接抄回來 |

## 下一步

### 1. 第一次開頁的等待 ✅ 兩段都修完、都驗過了

**根因**：`spawnEnv()` 的快取寫在 `await` 之後，而環境檢查是十幾支探測**同時**進來的
——每一支都撲空、每一支都自己 spawn 一支 powershell 讀同一份登錄檔。單獨量一支 603ms
（暖機後的數字），十幾支併發就是十幾秒。

**修法**：共用同一個 in-flight promise。**真機驗過：卡片一下就出現了。**

當時還剩「解鎖下一張還要等一段時間」，那是 `/configs` 那條，見 1a——也修完了。

當初量過、**排除掉**的（Windows VM，還原快照後）。留著是因為下次再遇到慢，
這幾支不用重測：

| 指令 | 耗時 |
|---|---|
| `codex --version` | 250ms（假 wrapper 快速失敗，不是卡住） |
| `claude auth status` | 591ms |
| `codex login status` | 42ms |
| `gh auth status` | 76ms |
| `powershell.exe … GetEnvironmentVariable` | 603ms ← 就是這支 × 13 |
| `bash -c "exit 0"` | 327ms，而且**根本不在 PATH**（這台還沒裝 Git） |

### 1a. `/configs` 是序列跑的 ✅ 已修（`c555a79`），VM 驗過

`src/config-check.js` 的 `runConfigCheck` 原本是一個 `for` 迴圈，31 項**每一項都 await**：

```js
for (const id of ids) {
  checks.push(await checkOutputStyle(materials, step));   // 一項做完才做下一項
}
```

對照 `runEnvCheck` 用的是 `Promise.all(checksToRun)`——環境那半十幾項同時跑，規則檔
這半 31 項排隊。31 項裡多數是讀檔（快），但 hook 那幾項會 spawn 子行程
（`resolveBash()` 一支、`node` 一支、還有 `await spawnEnv()`）。排隊的話這些成本**相加**，
併行的話是取最大值。

**做了的兩件（`c555a79`）：**

1. **改成併行**——`Promise.all(ids.map(...))`，跟環境那半一致。用 `map` 而不是 push
   進陣列，是因為畫面上的卡片順序靠 `checks` 跟 `ids` 對齊
2. **hook 探測補逾時**——`probeRegisteredHook` / `probeHook` 原本**完全沒有逾時**，
   子行程不結束那個 Promise 就永遠不 resolve。抽一支 `settleProbe` 共用，
   照 `runProbe` 給 `PROBE_TIMEOUT_MS = 15000`
   - ⚠️ 逾時另外掛 `timedOut` 旗標。不然它跟「找不到 bash」同樣是 `exitCode: null`，
     會被 `checkHook` 誤報成「這台機器沒有 bash」，還會再退回去跑一輪 `probeHook` 白等

第 2 件比第 1 件重要：併行只是快，逾時才是「不會無限期卡住」。

驗收（已通過）：Windows VM 還原快照 → 跑嚮導 → 第一眼就有卡片**與**「下一張」。
要數字的話 DevTools 得**先開好**再把網址貼進去（嚮導自己開的分頁沒有 DevTools）。

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
  - ⚠️ **舊 skill 落點那條的嚴重性要往上提，設計也要改**——2026-08-11 在 VM 上實測，
    見下面「codex 兩個 skill 落點都會載入」
- A2 清理動作：隔離區搬移、移除 npm 舊版。⚠️ **B3 併進來一起做**——B3 是「那顆按鈕
  要多清孤兒 shim」，按鈕本身就是 A2，分開做等於把同一段清理邏輯寫兩次
- A3 合併改成開真終端（含缺行報告、一顆做兩檔）
- A4 Codex 沙箱檢查（junction / MSIX 兩層）
- A5 回報鈴鐺（要**連網址長度一起設計**，見 B1）
- A6 codex 清乾淨腳本（Windows）
- A7 段落最後一張自動重查、進度條底下指名擋著的卡

**B. 全新的修復（main 也沒解）**
- B1 鈴鐺網址過長——現在按下去基本上送不出去
- ~~B2 tab-sync wrapper 拿 PATH 第一個~~ ✅ **已完成**（`3ce7cfd`）
- ~~B3 移除舊版按鈕多清孤兒 shim~~ → **併進 A2**（那顆按鈕還不存在，見上面 A2）
- ~~B4 wrapper / function 指向死路徑時自動處理~~ ✅ **已完成**（`src/shell-wrapper.js`）
  - 環境段多一列「終端機裡的 claude / codex 是活的」，掃兩個平台各自的設定檔
    （Windows 連 PowerShell 7 那份一起掃，不像 tab-sync 只認 5.1）
  - 黃燈配一顆「清掉舊設定」，跑 `scripts/fix-shell-wrapper.mjs --apply`，先備份再刪
  - ⚠️ **偵測一定要跳過 tab-sync 自己的區塊**：我們的函式裡也有一條寫死路徑
    （watcher 腳本），學生還沒裝或裝壞時那條也不存在，不跳過就會叫他刪掉我們剛裝的東西
  - ⚠️ 只認**絕對路徑**。相對路徑判斷不了它相對於誰，標成壞的會誤傷學生自己寫的函式
  - ✅ **髒 Windows VM 驗收通過**：按鈕按得到、兩份 profile（5.1 與 7）都清乾淨、
    各自留下 `.bak.時間戳`、新視窗 `codex --version` 回 `codex-cli 0.147.0`
  - ✅ **「其他行原封不動」也驗過了**：手動在 profile 裡混進 `$env:`、`Set-Alias`
    與一個 `function prompt`（跟假 wrapper 同樣是 function 開頭的陷阱），清完只有
    codex 那段連註解消失，其餘一字未動。
    ⚠️ 這一輪**不必還原快照**——直接把污染寫回 profile 就重現得了，還原反而會把
    已經裝好的 Git / gh / Python 一起清掉

  這一輪還連帶修掉三個只有真的開起來才看得見的東西（測試全綠、畫面是壞的）：

  | 症狀 | 根因 | commit |
  |---|---|---|
  | 清除鍵上寫著「開始登入」 | `envRowModel` 的按鈕文字對照表只認 `execution-policy`，其餘一律登入 | `adacfa8` / `0b20fdf` |
  | 卡片出來了但沒有任何可按的東西 | `detail` 塞了整段說明，把那一列撐爆、按鈕被擠出可視範圍 | `679d7b1` |
  | 標題寫成「準備 <整句 label>，讓後面…」 | 沒登記 `ENV_CARD_META`，走了預設模板 | `679d7b1` |

  ⚠️ 這三個同屬一類：**測試綠、畫面壞**。所以前兩個都補了守門測試
  （`test/viewmodel.mjs` 走訪每一顆修復鍵、`test/shell-wrapper.mjs` 守 detail 長度）。
- B5 第一頁直接查 `pwsh` 是不是 Store 版（不必等沙箱探針）
- B6 診斷終端標題只查 PowerShell 5.1 的 profile 路徑
- B7 合併失敗沒有中止條件
- B8 `service_tier` 這類「新版不收的舊 key」→ `RETIRED_CODEX_KEYS` 可涵蓋

### 2a. codex 兩個 skill 落點都會載入（2026-08-11 VM 實測）

`scripts/seed-dirty-env.mjs:135` 那句註解「舊版讀 `~/.codex/skills`，現在讀
`~/.agents/skills`」**是錯的**。codex 0.147.0 **兩個都讀**，而且同名時**兩份都列出來**、
不去重：

```
- `zzztest`：新落點的版本（位於 `.agents/skills`）
- `zzztest`：舊落點測試用（位於 `.codex/skills`）
其中 `zzztest` 有兩個同名版本，來源與描述不同。
```

**壞法比預期的糟**：不是「舊版覆蓋新版」（錯但穩定、查得出來），是**兩份並存、由模型
當場挑**。挑哪一份看描述文字與當下語境——同一個學生、同一句話，兩次可能拿到不同行為。
工作坊現場最難處理的那種：學生說「剛剛不行現在又可以」。

**所以 A1 / A2 要改：**

- **A1** 偵測的判準是「新舊落點**有沒有同名 skill**」，不是「舊落點有沒有東西」
- **A2** 舊落點的同名 skill 要**預設就清**，不能只提醒
- 這條的優先級要往前提：它會讓所有 skill 相關的驗證變成假綠燈

**順帶兩個實測到的坑：**

1. **PowerShell 5.1 的 `Set-Content -Encoding UTF8` 會寫 BOM**，而 codex 的 YAML 解析
   看到 `﻿---` 就說「missing YAML frontmatter」。寫要給別的程式解析的檔案一律用
   `[IO.File]::WriteAllText(..., (New-Object System.Text.UTF8Encoding $false))`。
   產品端目前沒中——`materials/` 與 `scripts/` 沒有用 PowerShell 寫 `.md` 的地方；
   `docs/setup.ps1` 寫 `.jr-source` 有 BOM，但讀它的 `run-registry.js:37` 那個
   `.trim()` 剛好把 BOM 當空白清掉。那是**運氣不是設計**
2. 舊落點若放**格式壞掉**的檔案，codex 每次啟動印一行紅字但照跑；格式正確的話
   **完全安靜地生效**。所以「沒有紅字」不代表沒有這個問題

**C. 這一輪討論新增的**
- C1 清理動作跑完，對應 banner 要消失。**寫成宣告式**（每個 action 宣告它讓哪份資料
  失效），不要重蹈 main 那種散落的 if
- C2 全綠之後才出現「清掉隔離區」。條件＝所有 skill 檢查 ok；按之前先列出要刪什麼。
  ⚠️ `.bak` 不一起刪，那是另一件事

建議順序：~~B4 + B3~~ →　**A4 + B5 →　A1–A3 + B3 + C1 →　A5 + B1 →　C2**

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
- **第一次開頁的等待已經全部解掉**（`8a5f64f` + `c555a79`，兩段都在 Windows VM 驗過）。
  下一輪如果又遇到慢，先看第 1 點那張「已排除」的耗時表，不用重測
