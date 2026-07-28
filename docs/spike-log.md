# Spike 開發紀錄

這份文件保留 spike 階段每一步的決策與踩到的坑。原本這些內容在 git commit 訊息裡，
公開前壓平歷史時整理到這裡。

---

## 步驟 1+2 — 本機 UI 骨架 + 按鈕執行並即時串流輸出

零相依 Node server，只監聽 `127.0.0.1`，啟動時產生一次性 token。
按鈕送 action 代號 → 對照寫死的白名單 → `spawn`（`shell: false`）→ SSE 逐行回推。

**為什麼堅持零相依**：同學不該為了跑安裝嚮導再裝一套東西。

---

## 步驟 3 — 網頁驅動 claude / codex CLI

固定步驟 + 自由輸入兩種入口，prompt 一律走 spawn args 陣列，不進 shell。
兩個 CLI 的 JSONL 事件統一翻成 `status` / `text` / `tool` / `error` 四種 UI 事件——
之後要接第三個 CLI 只需要多寫一支 parser。

agent 一律在 `~/.jr-setup/workdir` 跑，不吃同學專案的脈絡。
補上取消、SSE 斷線收屍、指令不存在時的可讀錯誤。

**成本發現**：在有 `CLAUDE.md` 與 hooks 的專案目錄下跑 `claude -p`，
光載入專案脈絡就產生數萬 token。隔離工作目錄後省下約三分之二。

**測試設計**：parser 吃事先錄好的真實輸出樣本，所以不需連網也不需登入即可驗收。

---

## 用量回報

`claude -p` 收尾那行的 `total_cost_usd` 原本被 parser 丟掉，跑完看不到花多少。
Codex 只給 token 數沒有金額，照實顯示不硬湊。缺 `usage` 欄位時退回原本的「完成」，
不顯示空括號。

---

## 坑 1：子程序 stdin 沒關，兩個 CLI 兩種症狀

`spawn` 預設給 stdin 一根管線，我們從不寫也不關，於是會讀標準輸入的 CLI 就空等：

- `claude` 印 `no stdin data received in 3s` 後放行 → 每次白等 3 秒
- `codex` **無限等** → 網頁上按了完全沒反應

改成 `stdio: ["ignore", "pipe", "pipe"]`，兩者都立刻開跑。

**教訓**：同一個錯誤在不同 CLI 上長出完全不同的症狀，容易被當成兩個獨立的 bug。

---

## 步驟 4 — 每個 action 宣告權限 + 自由輸入的寫檔開關

`claude` 用 `--allowedTools` 列工具，`codex` 用 `--sandbox` 分級，
兩邊對應同一組 `read-only` / `write`。自由輸入預設唯讀，勾了開關這一次才提升。
危險的全域放行參數（`--dangerously-*`）由測試 grep 把關。

**兩邊能寫的範圍不同**：Claude 可以寫任何地方；Codex 的 `workspace-write`
只讓它寫自己的工作目錄。這是 Codex 沙箱的硬限制。

### 坑 2：變長參數吞掉 prompt

`--allowedTools` 是變長參數，逐個列會把後面所有不以 `-` 開頭的字當成工具名——
包括 prompt。單元測試檢查「args 裡有 `--allowedTools`」「prompt 在最後」全數通過，
實跑卻得到：

```
Error: Input must be provided either through stdin or as a prompt argument
```

修法：逗號串成單一值 + 用 `--` 收尾。順便讓以 `-` 開頭的 prompt 也不會被誤判。

---

## 步驟 0 — 環境偵測 `GET /env`

八項檢查（兩個 CLI 的安裝與登入、Git、GitHub CLI 與登入、Node），純讀取，
不安裝也不修改任何東西。八項並行、各 5 秒逾時，任一項失敗都收斂成一筆結果，
而不是讓整張表出不來。

狀態分三種而非兩種：`ok` / `missing` / `warn`。
「裝了沒登入」跟「根本沒裝」是不同的問題，混在一起同學會修錯方向。

### 坑 3：狀態訊息寫在 stderr

`codex login status` 把訊息寫到 **stderr**，探測只讀 stdout 就看到空字串，
於是明明登入了卻顯示「未登入」。

順帶：`gh --version` 會多印一行 release 連結，`detail` 要只取第一行。

---

## 貫穿整個 spike 的教訓

**「形狀對」不等於「值是對的」。**

三個坑都是同一個模式：函式回傳的結構完全正確、測試全綠，但內容是錯的。
只驗形狀的測試遇到 wiring 錯誤會全部放行，而且錯得很安靜——
環境偵測那個尤其危險，紅綠燈會靜靜地騙人。

**對策**：每一輪都在真實環境實跑一次，不能只看測試結果。
