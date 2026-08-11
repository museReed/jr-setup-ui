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
- ~~A3 合併改成開真終端（含缺行報告、一顆做兩檔）~~ ✅ **已完成並在 VM 驗過**
  - `merge-in-terminal` 是 `fixed` 不是 `agent`：真正叫 agent 的是新視窗，這支負責
    拍快照、開窗、等**完成標記檔**（不是等視窗關掉——學生常把視窗留著就去按下一步）、
    然後比對缺行
  - **缺行判準：換位置不算弄丟**（Reed 拍板）。合併本來就會重排；報成弄丟只會製造
    雜訊。但內文被改寫算——那正是「AI 順手潤飾」造成的那種。重複行用數量比
  - **快照我們自己拍**，不靠提示詞裡那句「請你備份」。那是請求不是保證，而合併是
    唯一會改寫學生自己內容的動作
  - **一顆做兩檔**＝Codex 的 `config.toml` + `AGENTS.md`（同一家、同一個目錄、同一個
    agent）。Claude 只有一檔要合併，不對稱是內容造成的不是設計偷懶
  - ⚠️ **舊的 `merge-config-step` 整顆移除**：它是唯一「不先拍快照就改寫學生檔案」
    的路徑，留著等於留一條沒有退路的合併

  這一輪連帶修掉四個只有真的點下去才看得見的：

  | 症狀 | 根因 |
  |---|---|
  | 還沒合併就跑了一分多鐘的行為驗證 | `nextInstallStep` 只等「還沒裝」的，等不到「等合併」的 |
  | 徽章寫「未安裝」但沒東西可裝 | `installed` 把「等合併」當成「還沒裝」 |
  | 合併前跑的驗證勾，合併後還留著 | 合併沒有作廢同卡的驗證結論 |
  | Codex 那張卡一顆合併鍵都沒有 | 卡片按鈕來自「第一個還沒好的那一列」，而那是跟班不是群組主人 |

  ⚠️ **`scripts/merge-in-terminal.mjs` 不可以在本機執行**——它會開視窗、叫 agent、
  改真實檔案。我在開發時犯了兩次，第一次動到了 Reed 自己的 `~/.codex/config.toml`
  （靠快照還原回去）。折回邏輯的正確性靠 `test/merge-backup.mjs` 的純函式測試涵蓋，
  不需要真的跑它。行為驗證一律留到 VM。
- ~~A4 Codex 沙箱檢查（junction / MSIX 兩層）~~ ✅ **已完成並驗過**（見 2b）
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
- ~~B5 第一頁直接查 `pwsh` 是不是 Store 版~~ ✅ **已完成**（見 2b）。
  ⚠️ 只驗了「不誤報」——那台不是 Store 版。要驗黃燈得造假：在一個路徑含
  `\WindowsApps\` 的資料夾放一支 `pwsh.exe`，並把它加進使用者 PATH 登錄檔，
  然後**重開嚮導**（PATH 是從登錄檔讀的）
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

### 2b. 這一輪做完的（2026-08-11）

| 項目 | 狀態 | 出處 |
|---|---|---|
| A4 Codex 沙箱偵測 + 修復按鈕 | ✅ 真機驗到 `codex exec` 沙箱真的起得來 | `src/codex-sandbox.js` |
| B5 Store 版 PowerShell 偵測 | ⚠️ 只驗了不誤報 | 同上 |
| skill 舊落點偵測 + 搬進隔離區 | ✅ 真機驗過 | `src/skill-roots.js` |

**A4 的修法**：檔案本來就在機器上，PATH 上那條 bin junction 讓 codex 往上一層找時
走錯地方。按鈕在它會看的位置補一條 junction 指回去——零下載、零複製、免提權。
真機證據：`codex exec --sandbox read-only` 跑得起來，1223 不再出現。

⚠️ **junction 要接在 `...\standalone\current\` 上，不能解析到具體版本目錄**。
第一版用 `realpathSync` 解 bin，Node 連 `current` 一起解開，連結釘死在
`releases\0.147.0-...` 上，codex 一升版就斷。而且「已經接好了」的判準要是
「**從連結那條路走得到 helper**」，不是「連結存不存在」——不然斷掉之後按第二次也修不好。

**skill 舊落點的判準**：「舊落點有沒有**我們待會兒要裝的**同名 skill」。真機驗收同時
證明了兩件：`handoff` 搬進隔離區、紅字消失、skill 清單不再重複；而學生自己放的
`zzztest` 與 codex 的 `.system` **原封不動**。

⚠️ **搬進隔離區，不能改名留在原地**。codex 掃 skills 底下每一個子目錄，
`handoff.bak.20260811` 照樣被讀進去、frontmatter 裡還是 `name: handoff`，衝突沒解。

### 2c. ⚠️ 「測試綠、畫面壞」這一族（這一輪踩了三次）

三個都是測試全過、真的開起來才發現，**而且靠既有的斷言結構抓不到**：

| 症狀 | 為什麼測試看不到 | 補的守門 |
|---|---|---|
| 清除鍵上寫著「開始登入」 | 按鈕文字是前端一張硬編對照表，沒對到就掉進登入用的預設值 | `test/viewmodel.mjs` 走訪 `FIX_ACTIONS` 每一顆，沒人決定過文字就紅 |
| 卡片在、沒有任何可按的東西 | `detail` 太長把那一列撐爆，按鈕被擠出可視範圍 | 各狀態模組守 `detail` 長度上限 40 |
| 整頁十七列全部「檢查失敗」 | `runEnvCheck` 的 catch **回的 id 跟成功路徑一模一樣**，id 清單與欄位形狀的斷言全部照過 | `test/env.mjs` 加「不是每一列都在講同一句失敗」；catch 也會 `console.error` 出原因 |

**下次加任何一列新的環境檢查，先問這三件事**：按鈕文字誰決定？`detail` 幾個字？
整段拋例外時看得出來嗎？

### 2d. 學生升級 codex 之後會遇到什麼（推論，尚未實測）

⚠️ **這一節除了第 1 點的主線之外都沒有實測過**——沒有新版可以試。要真的知道，
最直接的做法是：把 VM 現在這個狀態存一份快照，等 codex 出新版時升級一次，
把嚮導從頭跑一遍。那一次會同時回答下面四點。

**1. 我們補的 junction 可能被安裝程式清掉**

安裝程式若重建 `%LOCALAPPDATA%\Programs\OpenAI\Codex\`，塞在那裡的 `codex-resources`
會一起沒了，症狀是又噴 1223。**這個我們抓得到**——那一列變回黃燈，再按一次就好。
連結還在但指向的版本目錄被刪那個變體也處理了（判準是「走得到 helper」）。

⚠️ **沒處理的變體**：codex 上游把這個 bug 修好、自己在那裡放了真的 `codex-resources`。
那時我們的 junction 可能擋住它的安裝，或反過來安裝失敗。不知道他們會怎麼修，
所以現在也寫不出對的防呆。**升版後第一件事就是驗這個。**

**2. codex 又改 skill 落點**

它已經改過一次（`.codex/skills` → `.agents/skills`），而且改完舊的還在讀。再改一次
的話這次裝的就變成「上一輪的舊落點」，同一個劇本重演、角色對調。
我們的偵測寫死兩個路徑，第三個位置出現時**看不到**。

⚠️ **現在不要先寫防呆**：第三個落點長什麼樣還不知道，先寫的判準多半會猜錯。

**3. 設定檔的舊 key 被新版拒收（必然發生，不是風險）**

`RETIRED_CODEX_KEYS`（`src/config-install.js:1057`）目前只列 `sandbox_mode` 一個。
codex 每次大改設定格式這張表就要補；沒補的話學生的 `config.toml` 會帶著新版不收的
key，症狀從一句警告到起不來都有。這是**維護成本**，需要一份「codex 換版時該檢查
什麼」的清單，而不是每次現場查。

**4. 我們用的指令參數改名**

`codex exec --sandbox` 這種旗標會變。嚮導的驗證步驟若用到，升級後會安靜地驗不出
東西——不會報錯，只會永遠不通過。

**還沒有答案的產品問題**：學生升級之後不會自己想到要重跑嚮導，目前也沒有任何機制
提醒他。一個方向是讓嚮導自己讀 codex 版本、對照已知的問題版本，把上面四點從
「事後發現」變成「事前警告」。

**C. 這一輪討論新增的**
- ~~C1 清理動作跑完，對應 banner 要消失~~ → **這條分支不成立，劃掉**（2026-08-11 查證）
  - `public/` 與 `src/` 裡**沒有任何 banner**。那是 main 那邊的東西
  - 這條分支的等價資訊全住在環境檢查的**列**裡，而那些列每次 `/env` 都重算——
    不存在「快取沒失效」這回事。真機驗過：按完清理，那一列自己就變綠，
    不必按「再 check 一次」
  - 剩下的只有預防性的那一半：現在的做法是「跑完任何 action 就重掃環境」，
    夠用但是全掃。**等到有動作只影響 `/configs` 那半、而重掃變貴時再回來看**
  - ⚠️ **但 C1 的核心在 A3 那邊真的成立了**：這條分支沒有 banner，卻有「驗證結論」
    這種會過期的狀態。合併改的是 `CLAUDE.md`，而那個行為驗證問的正是「Claude 讀完
    `CLAUDE.md` 之後怎麼回話」——所以**合併要作廢同卡的驗證勾**（`mergeInvalidates`，
    見 `public/model.js`）。`install-config-step` 早就有這個處理，合併只是漏了。
    劃掉的是「banner」那半，不是「宣告失效」這個概念
- C2 全綠之後才出現「清掉隔離區」。條件＝所有 skill 檢查 ok；按之前先列出要刪什麼。
  ⚠️ `.bak` 不一起刪，那是另一件事

建議順序：~~B4 + B3~~ →　~~A4 + B5~~ →　~~A1 + A2 + B3~~ →　~~A3~~ →
**GUIDANCE 渲染 →　B8 →　A5 + B1 →　C2**

**B8 現在有現成的樣本**：VM 上那份 `config.toml` 裡就是 `service_tier = "default"`，
而 `RETIRED_CODEX_KEYS`（`src/config-install.js`）目前只列 `sandbox_mode`。
seed 的註解寫著這個值會讓新版 codex 連啟動都失敗
（`unknown variant 'default', expected 'fast' or 'flex'`）。加一個字串的事。

⚠️ **GUIDANCE 渲染**是這一輪查出來的新工作，不在原本的 A/B/C 清單上：
`public/model.js` 的 `symptom` / `expected` / `checks` 寫好了，但**沒有任何地方畫出來**
（`view.js` 的 `renderFailureGuidance` 只印一行白話說明，而且只在動作失敗時才呼叫）。
於是「PowerShell 版本」「PowerShell 中文編碼」「PowerShell 7 不是 Store 版」這三列
都是**黃燈、沒按鈕、沒說明**——學生看得到問題但完全不知道怎麼辦。
`model.js:160` 那段註解本來就寫著自救步驟一定要寫出來，設計是對的，缺的是渲染。

A1 的一半（codex 舊 skill 落點）已經在 2b 做掉了，剩下的是 npm 並存與 skill 落點
那兩條規則，以及 A2 的其他清理動作——隔離區的機制已經有了
（`~/.jr-setup/quarantine/`，見 `src/skill-roots.js` 的 `quarantineRoot`），
A2 接上去就好，不用重新設計。

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
