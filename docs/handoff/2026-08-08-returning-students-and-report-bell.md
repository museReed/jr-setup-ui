# 交接：Windows 真機修正、回訪學生的清理、回報鈴鐺

- **類型**：continuation——全部做完並在 `main` 上，剩下的是 mac VM 驗收
- **main**：`685b0f0`，529 項測試綠
- **這一輪沒有開 PR**：每個功能一條分支、驗完直接合回 main

## 狀態摘要

1. **Windows PATH 機制從來沒生效過**（最重要的一條）。`{...process.env, PATH: 重算過的}`
   在 Windows 上會被同名不同大小寫的 `Path` 吃掉——Node spawn 前濾掉重複、保留先出現
   的那把。所以「重讀登錄檔讓剛裝好的東西叫得動」整套從頭到尾是空的。
2. **claude-hud 的 Windows 狀態列改用 node 當入口**（`statusline.mjs.template`）。
   PowerShell 那條走了兩輪都失敗，理由寫在 `docs/claude-hud-card.md` §4.2，不要退回去。
3. **五個「畫面沒跟上真實狀態」的假綠燈**：樂觀記憶不過期、合併沒做完就放行驗證、
   兩個驗證只過一個就解鎖、驗證失敗照樣亮箭頭、開終端驗證洗掉行為結論。
4. **回訪學生的三件事**：舊 skill 殘留偵測（名單目前是空的）、npm 舊版 CLI 偵測與移除、
   **工作坊 skill 整個換新**（舊的搬到隔離區再重裝）。
5. **每張卡右上角一顆鈴鐺**：開一個填好的 GitHub issue 頁面，**不替學生送出**。
   送到新建的 `museReed/jr-setup-feedback`。

## 必讀檔案

| 檔案 | 為什麼要讀 |
|---|---|
| `docs/returning-students.md` | 回訪學生的完整說明。結論是「不要叫他們移除任何東西」 |
| `src/legacy.js` | `RETIRED_SKILLS`（目前空的）與 `LEGACY_NPM_PACKAGES`。改動前先讀那段註解 |
| `docs/claude-hud-card.md` §4.2 | Windows 狀態列為什麼是 node 不是 PowerShell，走過哪兩輪 |
| `src/env-path.js` 的 `withPath` | Windows PATH 那個坑的完整說明 |
| `public/report.js` | 鈴鐺送出去的內容長什麼樣、三層遮蔽做了什麼 |
| `scripts/reset-workshop-skills.mjs` | 「換新」為什麼不能只用覆蓋 |

## 真機才看得到的坑（Windows VM，都已修）

| 坑 | 症狀 |
|---|---|
| **`Path` vs `PATH`** | 登錄檔讀對了、mergePath 也算對了，子程序拿到的還是啟動當下那份。git 與 Claude Code CLI 都是「裝好了卻說沒裝」 |
| claude 不寫永久 PATH | 只塞當下那個視窗；新分頁打不動 `claude`，tab-sync 的 profile 函式每開一個視窗就噴紅字 |
| 狀態列用 PowerShell 當入口 | 引號被下一層 shell 咬掉；改 `-File` 之後手動跑得出來、CC 裡仍空白（冷啟動 1～2 秒 vs 5 秒週期）。對照組 `cmd /c echo` 當場出現 |
| 舊寫法的狀態列被判成 ok | 檢查只認 `claude-hud` 字樣，已裝過的機器永遠綠、永遠壞 |
| 樂觀記憶不會過期 | 同一格「打勾 + 未安裝 + 安裝鍵」，計數還寫 3/3 |
| 清理動作跑完畫面不更新 | 移除 npm 只重查規則檔（資料在環境那半）；搬走 skill 的更新排在重畫之後 |
| 小人卡在 bar 外面 | lottie 把 `transform` 寫進 svg 的 inline style，蓋掉 CSS 的置中位移 |

## 下一步

### 1. mac VM 驗收（最優先，這一整批一次都沒在 mac 上跑過）

```bash
curl -fsSL https://musereed.github.io/jr-setup-ui/setup.sh | bash
```

先造測試素材（**跳過 npm 那條**——mac 上 `npm install -g` 會 EACCES，那正是當初改用
原生安裝器的理由）：

```bash
printf '\n# my own note\n' >> ~/.codex/config.toml
```

要盯的七項共用邏輯：

- 清單的勾不會跟「未安裝」同時出現
- 兩個驗證都過才解鎖「下一張」
- 驗證失敗時右邊是灰色膠囊「先跳過這張」，不是橘色圓箭頭
- **行為驗證過了之後再按「開終端驗證」，上面那格的勾要留著**（今晚影響最大的邏輯 bug）
- `config.toml` 已是自己的版本時，按安裝不會自動開終端；驗證鍵灰掉寫「先按『用 AI 合併』」
- 一段的最後一張、還有卡沒做完時，進度條**底下**列出擋著的那幾張且點得過去
- 終端頂欄的小人完整待在 bar 裡

### 2. 鈴鐺（任何一台都還沒按過）

每張卡右上角那顆。按下去要開新分頁到 GitHub，標題「[嚮導] ⟨卡片名⟩ 卡住了」。
**重點是內容裡看不到使用者名稱**——路徑應該都是 `~\.claude\...`。
看得到 `C:\Users\Reed` 的話代表遮蔽漏了一種寫法。

### 3. 「工作坊 skill 換新」（程式驗過，真機沒按過）

技能包那一段的按鈕。按完之後 `~/.jr-setup/removed/⟨戳⟩/claude/` 底下要有舊的那份，
而 `~/.claude/skills/` 底下是乾淨的新版。

### 4. Windows 還欠的兩件

- Obsidian 裡不該再跳出要打 GitHub 帳號的框
- 「叫 AI 寫一篇」那兩張：會跳選單問 commit 訊息，選完才存

### 5. 兩筆舊債

- `docs/fresh-vm-acceptance.md`：乾淨 VM 驗收，從 PR #40 欠到現在
- `docs/go-private-checklist.md`：轉 private 六步，第 6 步不可逆

## 已知問題

- **轉 private 會弄斷這一輪新加的兩個東西**：Pages 的一鍵指令頁要付費方案，而
  `jr-setup-feedback` 是獨立的公開 repo 所以不受影響——但頁面上那些連結要一起檢查。
- **`RETIRED_SKILLS` 是空的，殘留偵測今天抓不到任何東西**。那是正確的：
  `git log --diff-filter=D materials/skills/**` 證實從來沒有 skill 被停發或改名過。
  `test/config-check.mjs` 有一條斷言釘著它是空的——加東西進去時會紅，那是刻意的提醒。
- **npm 並存的實際危害沒有實測過**，是從落點差異推的。目前「講出來、不擋」正是為了這個
  不確定性。mac 上用 `sudo` 裝的那種，移除鍵會失敗（我們刻意不帶 sudo），會明確報錯。
- **嚮導畫面永遠是繁體中文**：語言選擇只決定裝進去的素材。要改是整個 `model.js` 的三語化。
- **`docs/handoff/2026-08-07-obsidian-notes-section.md` 的待辦仍然有效**。
