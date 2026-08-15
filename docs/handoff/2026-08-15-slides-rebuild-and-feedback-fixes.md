# 交接：學員回報的三個修正，以及新 slides deck 起手

- **類型**：continuation
- **分支**：`main`（jr-setup-ui，690 項測試綠、43 支）
- **前一份**：`docs/handoff/2026-08-14-sandbox-criterion-closed.md`
- **⚠️ 明天（8/16）上課要用新 deck**，那是這份交接最急的一件事

## 狀態摘要

1. **jr-setup-ui 今天一整輪修完並全部推上 main**（`a88e7cd` 為止）：驗證鍵回到那一格、
   合併列不再長出按了沒事的安裝鍵、取消不再印內部日誌、npm 殘留偵測改成解 symlink、
   brew 與 npm 各補一列收尾、學員回報的假黃燈。
2. **測試改成一支一支跑完再報**（`scripts/run-tests.mjs`）——原本 `&&` 串接會在
   載入失敗時整串靜靜停住，後面三十幾支根本沒跑。
3. **jr-setup-feedback#4 已診斷並關閉**：學生自己設 `defaultMode: auto` → 那一列黃燈
   → 驗證那格永遠打不了勾 → 整張卡完成不了。已改成綠燈。
4. **新 repo `~/Projects/jr-workshop-slides` 只做到 `src/model.js`**（四段新內容的
   投影片資料）。view / viewmodel / app / index.html / css / 測試**都還沒寫**。

## 明天要用的新 deck：已定案的決定

| 決定 | 內容 |
|---|---|
| 明天上哪一版 | **新 UI**（Reed 拍板，不留舊版退路） |
| 安裝那幾段 | **只留一頁**指向嚮導，其餘刪掉（`slides-spec.md` 本來就標 DELETE） |
| 新 repo | 獨立 repo：`~/Projects/jr-workshop-slides` |
| design system | `~/Projects/claude2code-design-system`（css 已複製進 assets/css） |
| 架構 | MVVM，照 jr-setup-ui 的分法：model 純資料 / viewmodel 純函式 / view 只碰 DOM |
| 三個新主題 | **正課**，所以每段都要有練習頁（model.js 已經寫進去了） |

## 必讀檔案

| 檔案 | 為什麼要讀 |
|---|---|
| `~/Projects/jr-workshop-slides/src/model.js` | 四段新內容已經寫完（環境一頁、常用指令、Remote Control、Obsidian），檔頭有 kind → design system 元件的對照表 |
| `~/Projects/claude2code-design-system/build/gallery.single.html` | 可用的 `ds-*` 元件長什麼樣，寫 view 之前先看 |
| `~/Projects/claude2code-design-system/docs/UI-COMPONENT-CONTRACT.md` | 自製元件的界線；只能用 token，不能覆寫 ds-* |
| `~/Projects/claude-code-workshop/docs/slides-spec.md` | 舊 deck 每一頁的 KEEP/MODIFY/DELETE 標記——舊內容照這個搬 |
| `~/Projects/claude-code-workshop/slides.html` | 舊 deck 本體（5155 行、237 個 slide 區塊） |

## 下一步（照順序）

1. 寫 `src/viewmodel.js`：`flattenSlides` / `progressModel` / `navigate`，全部純函式
2. 寫 `src/view.js`：一個 kind 一個 renderer，只用 `ds-*` 元件
3. 寫 `src/app.js` + `index.html` + `assets/css/deck.css`（layout only，不覆寫 ds-*）
4. 抄 `jr-setup-ui/scripts/run-tests.mjs` 當測試 runner，補 `test/viewmodel.mjs`
5. 舊內容照 `slides-spec.md` 的 KEEP/MODIFY 搬進 `model.js`
6. `git init` + 推上 GitHub（**還沒做，要先問 Reed**）

## 已知問題 / 待確認

- **Remote Control 的事實已查證**（2026-08）：Claude 是 `claude remote-control`，接**正在跑的**
  session；Codex 是 `codex remote-control`（CLI 0.130+），**另開一個專屬 session**、從
  ChatGPT App 接。這個差異已經寫成 `remote-diff` 那頁。
- `defaultMode` 的期望值 `acceptEdits` 是寫死的。若新版 Claude Code 改用 `auto` 當預設，
  全班都會走到「自己設過」那條分支——目前放行沒問題，但值不值得列為合格值還沒查。
- `jr-workshop-slides` 尚未 `git init`。
