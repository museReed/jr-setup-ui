# 全新 VM 驗收清單

這份清單只有一個目的：**從學生真正會打的那一行指令開始，走到分頁標題變成命名為止。**

開發機上的 `git clone` + `node scripts/…` 不算驗收——那條路徑跳過了 bootstrap，而
bootstrap 抓的是 `main`。每次有東西進 `main`，就照這份跑一次。

用**全新的 VM**，不要用跑過的那台：裝過的機器上有殘留的 hook、profile 區塊和白名單
規則，會讓壞掉的安裝流程看起來是好的。

## 前置

VM 上只要有：作業系統本身、瀏覽器、網路。其餘（Node、Git、終端機）都是嚮導要負責
裝或擋的，**不要先手動裝**——那正是要驗的東西。

## 一、bootstrap

macOS：

```bash
curl -fsSL https://musereed.github.io/jr-setup-ui/setup.sh | bash
```

Windows：

```powershell
irm https://raw.githubusercontent.com/museReed/jr-setup-ui/main/docs/setup.ps1 | iex
```

**要看到**：瀏覽器自動打開嚮導頁面。

**常見失敗**：Windows 上這一步的編碼問題只在真的用 `irm | iex` 時現形，把檔案下載
下來手動跑是驗不到的。

### 驗 PR 分支

上面兩行抓的都是 `main`——那是學生會打的那一行，不動它。要驗還沒合併的分支，在同
一行前面指定分支就好，其餘完全一樣：

macOS：

```bash
curl -fsSL https://musereed.github.io/jr-setup-ui/setup.sh | JR_BRANCH=feature/ui-cards bash
```

⚠️ `JR_BRANCH=` 要放在 **`bash` 前面**。放在 `curl` 前面（本文件原本就是那樣寫的）只會
把變數設給 `curl`，`bash` 收不到，於是**靜靜地抓 `main`**——畫面上唯一的破綻是「下載
嚮導」括號裡印的分支名，不特別看就過去了。

Windows：

```powershell
$JrBranch="feature/ui-cards"; irm https://raw.githubusercontent.com/museReed/jr-setup-ui/main/docs/setup.ps1 | iex
```

**要看到**：「下載嚮導」那行後面括號印的是你指定的分支，不是 `main`。事後也查得到：

```bash
cat ~/.jr-setup/app/.jr-source
```

### 驗 PR 時跳過過不了的卡

VM 裡登入、開終端那幾張卡本來就過不了，卡在那裡後面就全部驗不到。啟動時帶 `JR_DEV=1`，
每張被鎖住的卡都會多一顆「先跳過這張（測試模式）」：

```bash
curl -fsSL https://musereed.github.io/jr-setup-ui/setup.sh | JR_BRANCH=feature/ui-cards JR_DEV=1 bash
```

⚠️ 它**不會**把卡片記成完成——徽章、圓點、進度條走的仍然是真正的判定。這是刻意的：
驗 PR 時看到的畫面要跟學生看到的一樣，標成完成反而會蓋掉真正壞掉的地方。

學生那條 one-liner 帶不到這個變數，所以他們永遠看不到這顆鍵。

⚠️ bootstrap 腳本**自己**還是從 `main` 抓的。PR 若動到 `setup.ps1` / `setup.sh`
本身，這條路徑驗不到那個改動——那種 PR 要合併進 `main` 之後再照本文件重跑一次。

## 二、環境檢查

**要看到**：每一列都有明確狀態，缺的給安裝按鈕。逐項按到全綠。

**特別確認**：終端機那一列。Windows 是硬性門檻（Windows Terminal），沒裝的話後面
標題同步整段沒有意義。

## 三、三個登入

Claude Code / Codex / GitHub 逐一登入。

**要看到**：登入後那一列自己變綠，不需要手動重新整理。

## 四、規則檔安裝（九列）

由上而下逐列按「安裝」。**順序有意義**：`終端機標題同步` 要在你第一次跑 `claude`
之前裝好。

**要看到**：每列裝完變成 **待驗證 ◐**，不是綠燈。綠燈要等驗證過才會出現。

Codex 命名要按平台驗，不要把其中一條路徑套到另一個平台：

| 平台 | Sidebar | 分頁標題 |
|---|---|---|
| **POSIX（macOS / Linux）** | hook 透過 app-server 更新 thread | Codex 原生 `terminal_title = ["thread"]` |
| **Windows** | hook 更新 SQLite | PowerShell 的 Codex tab-sync wrapper 讀同步檔更新標題 |

## 五、三道人工關卡

嚮導只能提示，不能代勞。漏掉任何一道，後面的驗證都會失敗：

| # | 做什麼 | 為什麼 |
|---|---|---|
| 1 | **關掉終端分頁，開一個新的** | Claude wrapper 與 Windows 的 Codex tab-sync wrapper 要由新 shell 載入；POSIX Codex 則用原生標題 |
| 2 | 第一次跑 `codex` 時**接受 hook 信任提示** | 沒接受的話 `~/.codex/config.toml` 的 `[hooks.state]` 是空的，整組 hook 不跑 |
| 3 | 最後**回終端看分頁標題** | 沒有程式驗得到這一格 |

## 六、驗證

### 自動的

在嚮導上逐列按「驗證」，或用頁面上方那幾顆。

**要看到**：跑過的列從 ◐ 變綠。摘要的「N 項中 M 項就緒」跟著變。

### 眼睛的

新開一個終端分頁：

```bash
claude
```

隨便問一句。

**要看到**：

- **不跳權限詢問**（跳了代表薄殼或白名單沒生效）
- 分頁標題變成 `{emoji} 中文敘述`，emoji 來自規定的 8 個
- 標題**持續維持**，不會被 Claude Code 自己的摘要標題蓋回去

再開一個分頁：

```bash
codex
```

第一次會問信任提示，接受後問一句話，同樣看標題。

回嚮導把 `終端機標題同步` 和 `Codex hooks` 兩列的勾選框勾起來。

**全部九列變綠才算驗收通過。**

## 六之二、Skills 安裝（十一列）

規則檔那段全綠之後才做這段——`auto-rename` 那支 skill 叫的是命名 hook 的腳本，
hook 沒裝好的話 skill 裝了也叫不動。

| 群組 | 列 | 要網路？ |
|---|---|---|
| 核心 | Claude / Codex × `自動命名`、`交接文件`、`結構化提問`（六列） | 否，素材內建 |
| 第三方 | `frontend-design`（兩列）、`skill-creator`、`playwright`、`Playwright MCP` | **是**，還會下載瀏覽器 |

**要看到**：核心六列裝完是 **待驗證 ◐**；第三方裝完直接綠（那是別人的 skill，
我們只認落點在不在，不比對內容）。

### 行為驗證（開真終端）

| 列 | 按下去會怎樣 | 判定 |
|---|---|---|
| 自動命名 | 開終端叫 agent 用 skill 命名 | Claude：等 `session-names/*.txt` 自動判定；Codex：看標題自己勾 |
| 交接文件 | 叫 agent 用 skill 產出交接文件 | 自動判定——文件裡要出現 SKILL.md 規定的章節名「必讀檔案」 |
| 結構化提問 | 叫 agent 用 skill 問你一題 | **人眼**：畫面要跳出可以上下選的選項，不是把選項寫成文字 |

⚠️ **skill 要開新 session 才會載入**。剛裝完的那個分頁裡驗，三列都會失敗。

**常見失敗**：`自動命名` 那列跳權限詢問 → SKILL.md 裡的 `$HOME` 沒被換成絕對路徑
（`Bash()` 白名單是字面比對、不展開變數）。列上會顯示「裝的是舊版」，重跑安裝。

## 七、對照：哪些狀態代表哪裡壞了

| 現象 | 斷在哪 |
|---|---|
| 列上寫「裝的是舊版」 | 檔案內容跟這一版不同，重跑安裝 |
| skill 裝了但 agent 說「找不到這個 skill」 | 沒開新 session——skill 只在 session 啟動時掃目錄 |
| Codex 的交接文件驗證失敗、改名那段沒動作 | `~/.agents/skills/_shared/` 沒跟著裝到 |
| 跳出權限詢問要你同意命名指令 | 白名單沒生效，或 Windows 薄殼沒裝到 |
| 名字寫進 `~/.claude/session-names/*.txt` 但標題不變 | watcher 沒起來、起錯方式、或被別人蓋掉 |
| `/bg` 背景化之後，分頁標題沒跟著換 | 背景 session 沒有自己的終端，靠 `~/.claude/session-terminals/{session-id}` 留下的線索找回分頁。**已知限制**：daemon 有時會認領預熱好的 `claude bg-spare` 進程，那種 session 查不到來源，分頁就維持原樣——右下角名牌仍然正確 |
| 背景 session 右下角仍是英文 slug | 那個名字來自 `~/.claude/jobs/{jobId}/state.json`，要下一次命名事件（下一句話、或 tool 用量到門檻）才會寫進去 |
| `codex` 完全沒有命名動作 | hooks.json 沒寫出來，或信任提示沒接受 |
| 串接指令 `echo a && echo b` 沒被擋 | hook 註冊的指令路徑壞了（不是腳本壞了） |

卡住時 `scripts/` 底下有對應的診斷腳本，會直接告訴你斷在哪一格：

- `diagnose-naming-block.mjs` — 命名指令被擋在白名單哪一格
- `diagnose-title-path.ps1` — 標題為什麼沒變（Windows）
- `probe-wt-title.ps1` / `probe-watcher-attach.ps1` — 終端與子行程的標題行為

## 八、驗收紀錄

每次驗收在 PR 或 issue 裡記三件事：**VM 的作業系統版本、走到第幾步、失敗的話卡在
哪一格**。「跑過了」不算紀錄——這輪五個斷點全都是在「跑過了」的狀態下發現的。
