# 交接：8/16 工作坊回報盤點 + 當天的 slides 改動

- **類型**：continuation
- **分支**：`main`（jr-setup-ui，乾淨；但工作區有一筆未提交改動，見「已知問題」）
- **相關 repo**：`claude-code-workshop`（slides 已全部完成並上線）、`jr-setup-feedback`（issue 來源）

## 狀態摘要

1. **8/16 當天的 slides 全部改完並推上 main**，線上 64 頁：
   https://musereed.github.io/claude-code-workshop/slides.html
2. **盤點 `jr-setup-feedback` 昨天新增的四張 issue**：#5 #6 #7 #8，目前 **全部還開著**。
3. **#6（家目錄權限）和 #7/#8（Codex 分頁標題 `T`）Reed 8/16 當天就已經查完並修好**，
   分別在 `fix/home-write-permissions`（`e9541e0`）與 `fix/codex-tab-title`（`cb8de61`），
   **兩個分支都還沒合進 main**——也就是說學生現在拿到的一鍵指令仍是壞的版本。
4. **`T` 的真正成因**（寫在 `cb8de61` 的 commit message）：那是 `$TMPDIR` 的最後一段
   （`/var/folders/xx/xxxx/T`）。啟動腳本放在那裡，Ghostty 跑 `.command` 不注入 shell 整合，
   全程沒人設過標題，終端機就拿工作目錄末段當分頁名。
5. **#5 是回報工具自己的 bug**，不是安裝失敗：原始輸出整塊是 `{}`，學生沒送出任何可讀的 log。
6. **教材裡有一條會主動製造問題的指令**：`sudo npm install -g`（見下）。

## 必讀檔案

| 檔案 | 為什麼要讀 |
|---|---|
| `git log -1 cb8de61`（branch: `fix/codex-tab-title`） | 分頁標題那四個洞的完整診斷，比任何轉述準；末尾有兩條 ⚠️（鏡像同步、既有紅測試） |
| `git log -1 e9541e0`（branch: `fix/home-write-permissions`） | issue #6 的修法與判斷理由 |
| `docs/home-permissions.md`（branch: `fix/home-write-permissions`） | 家目錄被 root 佔住的技術細節 |
| `docs/returning-students.md:328-341` | `sudo npm uninstall -g` 那條建議的上下文——它是對的，是補救手段 |
| `public/report.js:105` + `public/app.js:2133` + `public/view.js:1915` | #5 的成因鏈：空 Map 序列化成字串 `"{}"`，而保底判斷是 falsy 檢查所以沒觸發 |

## 下一步

**先做這個（會影響後面每一步怎麼寫）**：決定 `fix/home-write-permissions` 與
`fix/codex-tab-title` 要不要合進 main。兩個都沒合，學生現在拿到的還是壞的。

合併前 Reed 要在 VM 上實測（需要 sudo 密碼與快照），並把 `materials/skills/` 同步回
`jr_ai_agent_skills` 上游——那是鏡像，不同步回去，下次 `scripts/sync-skills-materials.sh`
會把修好的退回去（`cb8de61` 自己標的 ⚠️）。

接著（可以直接動手，不需要 Reed 先決定）：

1. **撤掉 `scripts/seed-dirty-env.mjs` 未提交的 `root-owned-home` 那一步** —— 與
   `fix/home-write-permissions` 裡的同名步驟重複，留著會造成合併衝突。
2. **修 #5 的回報工具**：`report.js:105` 的保底判斷改成能識別空的 `{}`；同時把
   「這一張卡的原始輸出」改成複數（實際送出的是全部卡片，所以 #7/#8 才會 34–47KB）。
3. **回覆三張 issue**：#7 #8 指到 `fix/codex-tab-title` 並說明 `T` 的來源；
   #5 說明原始輸出是空的、請重跑一次再送。
4. **更正 issue #6 的既有留言**：那則把 `~/.config` 變成 root 歸給 `sudo npm`。機制對
   （sudo 保留 `$HOME`），但對象錯——npm 動的是 `~/.npm`，`~/.config` 是 gh / gcloud / git
   各自建的。
5. **改 `claude-code-workshop` 的兩行教材**：`setup.md:115` 與
   `setup-tutorial/assets/js/steps.js:151` 都寫「遇到 EACCES 就改跑
   `sudo npm install -g @anthropic-ai/claude-code`」。這條與 `src/installers.js:8` 自己的
   註解直接矛盾（用 sudo 裝的東西屬於 root，之後自動更新會靜默失敗）。
   ⚠️ 怎麼改是教學決策，先問 Reed。

## 已知問題

- **工作區有一筆未提交改動**：`scripts/seed-dirty-env.mjs` 被加了 `root-owned-home` 步驟
  （本次 session 加的），與 `fix/home-write-permissions` 重複。只跑過 dry-run，沒有 `--apply`。
- **`test/env.mjs` 與 `test/smoke.mjs` 在 origin/main 上本來就是紅的**
  （環境檢查項數 `16 !== 14`），與上述兩個修正無關，但會擋著判斷測試綠不綠。
- **`materials/skills/` 是 `jr_ai_agent_skills` 的鏡像**，直接改這裡會被下次同步覆蓋。
- **`codex-session-rename.md` 寫「需用 `mycodex` 啟動」**，但實際安裝出來的是一個直接叫
  `codex` 的 shell function（`src/config-install.js:427`）。`cb8de61` 已經動過這份檔案，
  合併前確認那句是否一併修掉了。
- **slides 第 58 頁的 ChatGPT 桌面版開 browser 方式未驗證**：Reed 提到印象中是
  `Cmd + Shift + B`，沒寫進投影片。只有他按得到。
- `~/Projects/claude-code-workshop` 的工作樹仍在 `slides-playwright-mcp` 分支且有大量未提交
  變更；本次 slides 全程是在另開的 worktree 上做的，沒有碰它。
