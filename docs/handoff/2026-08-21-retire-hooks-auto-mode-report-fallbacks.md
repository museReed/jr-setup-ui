# 交接：hook 退役、auto mode、回報退路、家目錄權限

- **類型**：continuation
- **分支**：`main`（乾淨，已推上 `d474acf`）
- **相關 repo**：`jr-setup-feedback`（issue 來源）、`claude-code-workshop`（有未提交改動，見「已知問題」）

## 狀態摘要

1. **兩支 hook 退役**：擋串接（Claude）與 context 監控（Codex）。新的 `kind: "retire"`
   三態——沒裝過不出現、有殘留給移除鍵、移除完留著打勾。
2. **Claude 預設模式改成 auto**，白名單原地不動（官方文件：auto mode 底下窄的 Bash
   allow 規則照常生效）。權限卡文案改成兩層敘述。
3. **回報管道不再綁 `gh`**：框裡四顆鍵（送出／複製並開 GitHub／寄信給助教／存成檔案），
   bootstrap 失敗也會印出信箱與自動填好的主旨。
4. **修好自走版 demo**：來源頁面含 HTML 註解時整頁跑版，兩個獨立的 bug。
5. **`jr-setup-feedback#6`（家目錄被 root 佔住）合進 main 並在 mac VM 上完整驗過。**
6. **分頁那一格改成只驗自己裝的 wrapper**，解掉「請先裝下一張卡」的順序相依。

## 必讀檔案

| 檔案 | 為什麼要讀 |
|---|---|
| `git log -1 d474acf` | 順序相依的完整成因（8/20 拿掉 watcher 時長出來的），以及為什麼這是止血不是終局 |
| `git log -1 2c2ce87` | 家目錄權限那一列的三態設計，以及為什麼 `fixed` 與 `retired` 分兩本 |
| `src/home-perms.js` | #6 的判準：只看嚮導自己會寫的那幾樣，「存在但寫不進去」才算 |
| `src/config-check.js` 的 `checkRetired` | 退役三態的樣板，`homePermsRow` 照同一個形狀做 |
| `public/report.js` 的 `newIssueUrl` / `mailtoUrl` | 兩條退路的網址為什麼只帶標題與一行提示，不帶 log |
| `docs/home-permissions.md` | 家目錄被 root 佔住的技術細節 |

## 下一步

**先做這個**：把「分頁自己報上名字」與「對話自己取名字」**合併成一張卡**。

`d474acf` 只是止血——那一格現在驗的是「wrapper 載入了」這種中間狀態，講不出學生
在意的成果。合併之後順序相依從根本消失，而且驗的是「標題真的變了」。

- 用現成的 `MERGE_ORDER` / `MERGED_CARDS` 機制（`public/model.js`），規則是兩份一起裝、
  最後那一份帶驗證——`claude-namer` 正好是帶驗證的那一份
- 只影響 **Claude Code**，mac 與 Windows 都會；Codex 兩個平台都不受影響
  （`tab-sync` 只在選了 Claude 時才裝，Codex 命名走原生 app-server）
- ⚠️ Windows 的 `tab-sync` 還多一支 watcher（`docs/windows-tab-title-why-watcher.md`），
  會是第一個跨 kind 的合併卡
- ⚠️ `test/verify-in-terminal.mjs` 拿掉的三條保險要**原樣搬回來**：合併卡的驗證會重新
  寫一次標題，`DISABLE_AUTO_TITLE` 與「改標題排最後」兩道缺一不可，理由留在該檔註解裡

接著（可以直接動手）：

1. **修 `jr-setup-feedback#5`**：學生送出的原始輸出整塊是 `{}`。成因是空 Map 序列化成
   字串 `"{}"`，而 `public/report.js` 的保底判斷是 falsy 檢查所以沒觸發。順便把
   「這一張卡的原始輸出」改成複數——實際送的是所有卡片。
2. **關掉 `#7` / `#8`**：Codex 分頁名字是 `T`。8/18–8/21 整個重做了 Codex 命名，
   很可能已涵蓋，但要比對 `cb8de61`（branch `fix/codex-tab-title`，未合併）修的那四個洞
   有沒有漏。
3. **失敗時的白話說明會蓋掉真正原因**：分頁那張失敗時右邊仍顯示「裝好了但標題不動」
   的通用指引，叫學生去查 shell profile——而那條路是死的。那一列自己帶了人話的失敗
   原因時，就不該再蓋一段通用指引上去。
4. **`scripts/seed-dirty-env.mjs` 沒有 `--step=`**，而且一個步驟失敗就整支停。
   `root-owned-home` 排第 9，`shadow-function`（第 3）在有主題的機器上會失敗，於是
   到不了。VM 上要重現單一症狀時很不方便。

## 已知問題

- **`claude-code-workshop` 有未提交改動**：`setup.md` 整份重寫成「跑嚮導那一行」、
  `README.md` 改了一行描述。Reed 說那個 repo 之後會廢棄，所以**沒有 commit**。
  要丟掉就 `git checkout -- setup.md README.md`。
- **`fix/home-write-permissions` 與 `fix/codex-tab-title` 兩支舊分支還在遠端**。前者的
  內容已經透過 `fix/home-perms-rebased` 合進 main，可以刪；後者還沒處理（見下一步 2）。
- **`test/codex-session-namer.mjs` 偶發性紅**（relay lock 與時序），單獨跑或再跑一次
  就過。這一輪撞到兩次，不是這些改動造成的。
- **#6 有一項沒用眼睛驗到**：弄髒期間 GitHub 那列有沒有從「未登入」改口。判準
  （`ghConfigBlocked`）跟第 2 張同一份資料，邏輯上通，但沒看過畫面。
- **`~/.config` 被 root 佔住時 Ghostty 也起不來**（它的設定放在那）。修復卡的說明只講
  「嚮導寫不進去」，沒提這件事——學生可能以為 Ghostty 裝壞了跑去重裝。
