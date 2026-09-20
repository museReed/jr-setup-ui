# 全新 VM 驗收清單

這份清單只有一個目的：**從學生真正會打的那一行指令開始，走到每一列都綠為止。**

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

macOS——⚠️ **變數要放在 `bash` 前面，不是 `curl` 前面**：

```bash
curl -fsSL https://musereed.github.io/jr-setup-ui/setup.sh | JR_BRANCH=feature/ui-cards bash
```

`JR_BRANCH=... curl ... | bash` 這種寫法**沒有用**，而且不會報錯：`VAR=值 指令` 這個
前綴只作用在緊接著的那一個指令（`curl`），管線右邊的 `bash` 是另一個程序、拿不到那個
變數，`setup.sh` 於是走 `BRANCH="${JR_BRANCH:-main}"` 的預設值，安安靜靜地裝了 `main`。

2026-08-20 實測踩到：整輪驗收跑完才發現裝的是 `main`，本來要驗的 PR 一行都沒驗到。

不想記前後順序的話，這個寫法也對：

```bash
JR_BRANCH=feature/ui-cards bash -c "$(curl -fsSL https://musereed.github.io/jr-setup-ui/setup.sh)"
```

Windows：

```powershell
$JrBranch="feature/ui-cards"; irm https://raw.githubusercontent.com/museReed/jr-setup-ui/main/docs/setup.ps1 | iex
```

**要看到**：「下載嚮導」那行後面括號印的是你指定的分支，不是 `main`。

印的是 `main` 就**立刻停下來**——後面每一格都會是在驗 `main`，而不是你的 PR。裝完之後
也可以再確認一次：

```bash
cat ~/.jr-setup/app/.jr-source
```

⚠️ bootstrap 腳本**自己**還是從 `main` 抓的。PR 若動到 `setup.ps1` / `setup.sh`
本身，這條路徑驗不到那個改動——那種 PR 要合併進 `main` 之後再照本文件重跑一次。

## 二、環境檢查

**要看到**：每一列都有明確狀態，缺的給安裝按鈕。逐項按到全綠。

**特別確認**：終端機那一列。Windows 是硬性門檻（Windows Terminal），沒裝的話後面
幾段要開真終端的驗證都做不了。

## 三、三個登入

Claude Code / Codex / GitHub 逐一登入。

**要看到**：登入後那一列自己變綠，不需要手動重新整理。

## 四、規則檔安裝

由上而下逐列按「安裝」。

**要看到**：每列裝完變成 **待驗證 ◐**，不是綠燈。綠燈要等驗證過才會出現。

### 「移除已下架的對話自己取名字」那一列

自動命名（skill + hook + 分頁標題同步）已經下架，封存在 `archive/auto-rename/`。
它留下一列**清理用**的步驟，而那一列的行為分兩種機器：

| 機器 | 應該看到 |
|---|---|
| **全新 VM**（沒裝過舊版） | **整列不出現**。出現就是 `checkRetired` 的三態判斷壞了 |
| **裝過舊版的機器** | 黃燈 + 一顆「移除」。按完變綠，而且**留在畫面上**（整列消失代表 `markStepRetired` 沒寫進去） |

要驗回鍋那一種，同一台 VM 先跑一次 `main` 走完安裝，再跑一次這個分支。

按完之後手動查一遍，四種殘留都要消失、而且別人的東西要還在：

```bash
ls ~/.claude/hooks/                              # 沒有 set-session-name / session-auto-namer
grep -c "jr-setup-ui tab sync" ~/.zshrc          # 0
grep -c "set-session-name" ~/.claude/settings.json   # 0
grep -c "context-monitor" ~/.claude/settings.json    # ≥ 1（監控 hook 不能被掃掉）
```

## 五、三道人工關卡

嚮導只能提示，不能代勞。漏掉任何一道，後面的驗證都會失敗：

| # | 做什麼 | 為什麼 |
|---|---|---|
| 1 | **關掉終端分頁，開一個新的** | 規則檔與 shell 設定都由新 shell 載入，舊分頁看不到 |
| 2 | 第一次跑 `codex` 時**接受 hook 信任提示** | 沒接受的話 `~/.codex/config.toml` 的 `[hooks.state]` 是空的，整組 hook 不跑 |

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

- 回話照 output-style 的規矩（結論先行、比較用表格）
- **分頁標題跟著目前的指令／目錄變**。這是 Ghostty shell integration 的 `title`，
  下架自動命名時一起放回來的——以前它被關成 `no-title`，讓位給命名 hook 寫的名字。
  標題整個不動代表 `ghostty-config.js` 那段沒寫進去

再開一個分頁：

```bash
codex
```

第一次會問信任提示，接受後問一句話。

**要看到**：Codex 自己把分頁標題與 status line 換成這次對話的名字——那是 Codex 原生的
`[tui] terminal_title = ["thread"]`，不經過任何 hook。沒變的話查 `~/.codex/config.toml`
的 `[tui]` 區段。

**全部列變綠才算驗收通過。**

## 六之二、Skills 安裝（十一列）

規則檔那段全綠之後才做這段——skill 要照那些規矩做事。

| 群組 | 列 | 要網路？ |
|---|---|---|
| 核心 | Claude / Codex × `交接文件`、`結構化提問`（四列） | 否，素材內建 |
| 第三方 | `frontend-design`（兩列）、`skill-creator`、`playwright`、`Playwright MCP` | **是**，還會下載瀏覽器 |

**要看到**：核心四列裝完是 **待驗證 ◐**；第三方裝完直接綠（那是別人的 skill，
我們只認落點在不在，不比對內容）。

### 行為驗證（開真終端）

| 列 | 按下去會怎樣 | 判定 |
|---|---|---|
| 交接文件 | 叫 agent 用 skill 產出交接文件 | 自動判定——文件裡要出現 SKILL.md 規定的章節名「必讀檔案」 |
| 結構化提問 | 叫 agent 用 skill 問你一題 | **人眼**：畫面要跳出可以上下選的選項，不是把選項寫成文字 |

⚠️ **skill 要開新 session 才會載入**。剛裝完的那個分頁裡驗，三列都會失敗。

**常見失敗**：交接那列的模型說它「照 skill 最後一步改名了」→ 那一步已經隨自動命名
下架，SKILL.md 裡沒有了。模型憑印象自己加戲代表它沒真的讀 SKILL.md，多半是沒開新
session。

## 七、對照：哪些狀態代表哪裡壞了

| 現象 | 斷在哪 |
|---|---|
| 列上寫「裝的是舊版」 | 檔案內容跟這一版不同，重跑安裝 |
| skill 裝了但 agent 說「找不到這個 skill」 | 沒開新 session——skill 只在 session 啟動時掃目錄 |
| 全新 VM 上出現「移除已下架的對話自己取名字」 | `checkRetired` 的三態判斷壞了——沒裝過的機器不該看到那一列 |
| 按完移除之後整列消失 | `markStepRetired` 沒寫進 state.json，學生會以為自己弄壞了什麼 |
| 移除之後監控 hook 也不見了 | 退役的 marker 比對抓太寬，掃掉了同一個 settings.json 裡別人的註冊 |
| Ghostty 的分頁標題完全不動 | `shell-integration-features` 還停在舊的 `no-title` |
| Codex 分頁標題不變 | `~/.codex/config.toml` 的 `[tui] terminal_title` 沒寫進去 |

⚠️ 命名相關的診斷腳本（`diagnose-naming-block.mjs`、`diagnose-title-path.ps1`、
`probe-wt-title.ps1` 等）已經隨自動命名一起封存到 `archive/auto-rename/scripts/`。

## 八、驗收紀錄

每次驗收在 PR 或 issue 裡記三件事：**VM 的作業系統版本、走到第幾步、失敗的話卡在
哪一格**。「跑過了」不算紀錄——這輪五個斷點全都是在「跑過了」的狀態下發現的。
