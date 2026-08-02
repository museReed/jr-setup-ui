# 交接：卡片判斷邏輯收斂 + GSAP 動畫

日期：2026-08-02
接手前請先讀完「必讀檔案」那一節。

## 必讀檔案

| 檔案 | 為什麼要讀 |
|---|---|
| `docs/audit-card-logic.md` | codex 產出的稽核報告（167 行、241 處行號引用）。這一輪所有決策的依據 |
| `public/viewmodel.js` 的 `cardIsComplete` / `completedCardIds` / `configRowModel` | 「完成」與按鈕狀態的唯一真相 |
| `.codex-task/spec.md` | 上一輪交給 codex 的稽核 spec，要再跑一次稽核時照這個格式改 |

## 現在有兩條分支開著

| PR | 分支 | 狀態 |
|---|---|---|
| #17 | `feature/gsap-motion` | 小鴨飛行、卡片切換、終端一張卡一份、每張卡提示、頂端 loader。**數字未定案**（飛行 4.9 秒、換卡 450ms），等 VM 上看過 |
| #18 | `fix/install-button-state` | 安裝按鈕三態 + 稽核報告 + 完成判定收斂。**可以合** |

兩條互不衝突。#18 建議先合。

## 這一輪做完的

### 1. 安裝按鈕三態（`5ec1011`）

`installationDone` 原本只看 `installed || verified`，漏了最權威的 `check.status`。
於是已經裝好、只差驗證的列（例如 Playwright MCP 顯示「已註冊 MCP server」）
按鈕仍是橘色的「安裝」，按下去指令回 already exists。

改成三態：未裝「安裝」（主要）／裝好未驗「重裝」（ghost）／驗過「✅ 安裝」（灰）。
中間那態不能停用——重跑安裝是驗證失敗時唯一的自救手段。

### 2. 稽核報告（`d0c3cbb`）

codex 唯讀盤點，回答五個問題 × 六種卡。核心發現：**畫面上五個地方在講「完成」，
至少四種判法**，七項不一致。

### 3. 完成判定收斂（`da98ecd`）

刪掉進度條那三條額外完成路徑，`completedCardIds` 現在就是逐張 `cardIsComplete`。
抽成 viewmodel 純函式並補兩條測試釘住。

`npm test` 329 pass / 0 fail。

## 還沒做的（依序）

### A. 內容抽成 `cards.yaml`

**已定案**：維護者是「你自己 + 一兩位講師」，都會用 git。所以**不做編輯器**，
只要資料檔 + 驗證測試。

要抽的內容目前散在四處：

| 內容 | 現在在哪 |
|---|---|
| 卡片 label | `src/config-install.js` 的 `describeStep` |
| 卡片 description | `public/model.js` 的罐頭句（十一張共用一句） |
| code block 提示 | `public/model.js` 的 `CARD_HINTS` |
| 眼睛檢查項文案 | `src/config-check.js` 的 `VERIFICATION`（**文案混進驗證邏輯**） |
| 人工勾選項 | `public/model.js` 的 `CARD_GATES` |

順序也要一起改成宣告式：目前寫死在 `public/model.js` 的 `SETUP_FIRST` 陣列與
`CARD_DEFINITIONS` 的排列，改成每張卡宣告 `after: [...]`。

**按鈕、徽章、驗證方式不進這個檔**——那些由系統依狀態決定。

### B. 依賴圖

`after` 宣告好之後才做，從資料產生（session 有 `interactive-flowchart` skill）。
手畫的圖三週後就會跟實作對不上。

給學生的部分**不要畫圖**：嚮導刻意是線性的，順序本身就是依賴。學生缺的是
「為什麼現在不能做這張」，不是一張圖。里程碑圓點 hover 目前只顯示卡名，沒說為什麼鎖。

## 剩下的分層破口

分層測試（`test/frontend-layers.mjs`）守得住「view 不打 API」「app 不碰 DOM」，
但守不住「判斷邏輯不准寫在 app.js」——七項不一致有五項都出現在這個破口上。

| 破口 | 位置 | 狀態 |
|---|---|---|
| app.js 做展示決策 | `completedCardIds` 原本內嵌在 `renderWizard` | ✅ 已抽出 |
| 前後端各判一次安裝 | `config-check.js:744` 給 null，`viewmodel.js` 補回來 | 未處理 |
| env 有兩處補安裝按鈕且條件不同 | `viewmodel.js` 的 `envRowModel` 與 `envCardRowModel` | 未處理 |
| model.js 裝 UI 文案 | `CARD_HINTS`、`CARD_GATES` | A 做完會一起解掉 |
| view.js 存應用狀態 | `transcripts`、`terminalLineModels` | 未處理（終端 transcript 值得搬，`renderedStation` 那類渲染快取留著合理） |

## VM 驗證指令

```powershell
$JrBranch="fix/install-button-state"; irm https://raw.githubusercontent.com/museReed/jr-setup-ui/main/docs/setup.ps1 | iex
```

換 `$JrBranch` 的值就能測另一條分支。這個參數已經在 `main` 上，學生那條
（不帶 `$JrBranch`）不受影響。

## 給 codex 跑稽核的方式

```
/Users/reed/.claude/skills/codex-agent/run-codex-task.sh <worktree 絕對路徑> <spec 絕對路徑>
```

背景跑。review 只讀 `.codex-task/last-message.txt` 與 `git diff --stat`，
**測試自己跑一遍**，不信 codex 自報的結果。上一輪它守規矩：`git status` 只有報告
那一個檔，沒越界。
