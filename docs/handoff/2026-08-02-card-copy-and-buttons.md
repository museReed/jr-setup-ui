# 交接：卡片文案、按鈕改版與驗證回饋

日期：2026-08-02（接續同日的 `2026-08-02-card-logic-and-motion.md`）
分支：`feat/card-copy`（10 個 commit，已 push，**還沒開 PR**）

## 狀態摘要

上一支 PR #18 已經合進 main。這一支從 main 開出來，做的是「學生看得懂」這件事：

- **卡片文案全面改寫**：標題講學生會看到的事（「終端機標題同步」→「分頁自己報上名字」），
  描述回答「做完你會多出什麼」。skill 的標題例外——就是 skill 名字（`handoff`、
  `playwright`），因為學生要打那個名字才叫得動。
- **規矩與回話風格合成一張卡**，兩份都裝完才驗證（分開驗的話先驗的那次只裝了一半）。
- **執行原則擋掉整段驗證**：VM 上 `.ps1` 全被 Restricted 擋下。自己 spawn 的腳本一律
  帶 `-ExecutionPolicy Bypass`，那張卡提到環境段最前面。
- **按鈕全改成 `.ds-btn-fill`**（灌色）+ 每顆一個 icon；翻頁也是。彈窗維持舊按鈕。
- **終端**：逐字打字（20 字/秒）、閃爍游標、行為驗證逐條印出五條規則的判定。
- **分頁鎖頭 + 解鎖動畫**、里程碑預覽三秒自收。

## 必讀檔案

| 檔案 | 為什麼要讀 |
|---|---|
| `public/model.js` 的 `CARD_DESCRIPTIONS` / `MERGED_CARDS` / `MERGE_ORDER` | 所有卡片文案與「哪兩張合併」都在這；下一步要抽 `cards.yaml` 就是抽這裡 |
| `src/config-install.js` 的 `describeStep` 與 `SKILL_LABELS` | 卡片標題的來源。標題不准帶實作名詞，由 `test/sections.mjs` 釘住 |
| `public/view.js` 的 `fillButton` / `ICONS` / `typeInto` | 按鈕與打字動畫的全部實作，14 個 icon 是手畫的 path |
| `test/frontend-layers.mjs` | 這輪加了 12 條靜態守則（按鈕形狀、打字煞車、游標、鎖頭動畫）。改 view 前先看它擋什麼 |
| `docs/audit-card-logic.md` | 上一輪 codex 的稽核，仍是判斷「完成」語意的依據 |

## 下一步

1. **VM 驗證這一支**（沒驗過的部分最多）：
   ```powershell
   $JrBranch="feat/card-copy"; irm https://raw.githubusercontent.com/museReed/jr-setup-ui/main/docs/setup.ps1 | iex
   ```
   重點看：執行原則那張排第一且能修好、skill 卡標題是英文名字、行為驗證會印出
   「5 條規則中通過 N 條」、按鈕灌色與 icon 的實際版面。
2. 驗完 **開 PR 並合進 main**（`gh pr create --base main`）。
3. 然後才輪到 `cards.yaml`：把 `CARD_DESCRIPTIONS`、`SKILL_LABELS`、`describeStep`
   的 label、`VERIFICATION` 的 eye 文案抽成一份資料檔（見上一份交接的 A 項）。

## 已知問題

- **打字速度與煞車互相牽制**：排隊超過三行就整批印完。20 字/秒下大多看得完整，
  但驗證連噴訊息時仍會跳過動畫。要調就改 `view.js` 的 `TYPING_CHARS_PER_SECOND`。
- **PR #17（`feature/gsap-motion`）還開著**，跟這支在 `view.js`／`app.js` 大量重疊，
  合併時會有可觀的衝突。建議先合這支，再讓 #17 rebase。
- **`.ds-btn-fill` 的停用樣式是我們自己加的**（設計系統沒有）。契約測試已放行這一個
  例外，理由寫在 `test/frontend-layers.mjs` 的註解裡。
- 環境卡的描述已改寫，但**「你要看的」那幾格的文案還是舊的實作視角**（「那個視窗的
  分頁標題變成…」），還沒動。
