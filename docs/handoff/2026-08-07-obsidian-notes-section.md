# 交接：筆記那一段（Obsidian + GitHub + AI 接手）

- **類型**：continuation——整段做完並合進 main，剩下的是 Windows 收尾驗收
- **main**：`0417ebd`，495 項測試綠
- **分支**：`docs/handoff-2026-08-06`（已合併，可以刪）

## 狀態摘要

1. **新增第五段「使用 Obsidian 管理你的知識庫」**，六張卡：Obsidian → vault-sync（Claude／Codex）→ 接到 GitHub 的筆記庫 → 叫 AI 寫一篇（Claude／Codex）。選配段，**不上鎖**。
2. **同步走「接力」**：打開 vault 自動拉、每 10 分鐘自動存、推之前先拉。外掛設定的 key 名取自 obsidian-git 2.38.6 的 `DEFAULT_SETTINGS`。
3. **`vault-sync` skill**：學生講人話，AI 下 git 指令。commit 訊息有六個 emoji 的格式，存之前用 structured-questions 給三個候選讓他挑。一次性的「接新筆記庫」拆進 `references/new-vault.md`。三語都有。
4. **claude-hud 補上 Windows 的 PowerShell 版狀態列指令**（沒在 Windows 上跑過）。
5. **今天大部分的 commit 是 VM 實測修正**，見下方「真機才看得到的坑」。

## 必讀檔案

| 檔案 | 為什麼要讀 |
|---|---|
| `docs/claude-hud-card.md` | claude-hud 的完整規格與實作落點，Windows 那一段標了「已實作但沒跑過」 |
| `materials/skills/skill-files/claude/vault-sync/SKILL.md` | AI 怎麼幫學生管筆記；commit 格式與「讓他自己挑那一句」都在這 |
| `src/config-install.js` 的 `VAULT_DIR` / `OBSIDIAN_GIT` / `CLAUDE_HUD` | 三組寫死的設定，改動前先看註解裡的理由 |
| `docs/copy-review-criteria.md` 第 9 條 | 「不指控學生的動機」，這輪所有文案都照它寫 |
| `content/walkthroughs/eye-obsidian-vault.json` | 失敗分支寫的都是真的撞到過的狀況 |

## 真機才看得到的坑（今天踩的，都已修）

| 坑 | 症狀 |
|---|---|
| Obsidian 開著時安裝 | 它結束會把筆記庫名單整份寫回去，蓋掉我們登記的那筆——**四個檢查點全綠、按驗證卻跳 Vault not found** |
| `gh repo create` 撞名 | 本機砍了重來時整步失敗，而錯誤訊息還猜成「還沒登入」 |
| 兩段無關歷史 | 接上已有的 repo 後直接 push 會被擋，要先 `fetch` + `reset --mixed origin/main` |
| `git push` 卡住 | 憑證排在 push 後面；所有工具現在都帶 `GIT_TERMINAL_PROMPT=0` |
| winget 的 `msstore` | 那個來源憑證失敗會讓整條安裝失敗，要 `--source winget` |
| Obsidian 的落點 | Squirrel 把 exe 放在 `app-<版本>\`，外層 stub 不一定有——改成掃資料夾 |
| `obsidian://` | 沒開過的機器上沒註冊，Windows 叫學生去逛 Microsoft Store——改成直接叫 exe |
| `open: true` 寫不進去 | `registerVault` 在「已登記」時提早 return，重試的人永遠停在筆記庫選單 |
| 路徑分隔符 | Obsidian 會把名單重寫成反斜線，跟我們寫的斜線版對不起來 |
| private repo 的 404 | 瀏覽器沒登入時 GitHub 回 404 不是 403——改走 `/login?return_to=` |

## 下一步

### 1. Windows VM 收尾（最優先）

```powershell
irm https://raw.githubusercontent.com/museReed/jr-setup-ui/main/docs/setup.ps1 | iex
```

還沒驗到的三件：

- **憑證**：Obsidian 裡不該再跳出要打 GitHub 帳號的框
- **叫 AI 寫一篇**那兩張：它會跳選單問 commit 訊息，選完才存
- **claude-hud**：輸入框下面那條在 Windows 上到底會不會出現

### 2. mac VM 重驗（快）

```bash
curl -fsSL https://musereed.github.io/jr-setup-ui/setup.sh | bash
```

Windows 那邊修的東西會影響 mac：路徑正規化、`open: true`、GitHub 登入轉址。特別看**已登入的瀏覽器不該被那個轉址多擋一頁**。

### 3. 乾淨 VM 的債

`docs/fresh-vm-acceptance.md`：跑過很多輪的機器上驗的不算數。**這條債從 PR #40 欠到現在**。

### 4. 轉 private

照 `docs/go-private-checklist.md` 六步走。第 6 步不可逆。⚠️ 第 1 步的 `files` 白名單要**記得放行 `materials/obsidian/` 與 `scripts/open-vault-repo.mjs`**。

## 已知問題

- **嚮導畫面永遠是繁體中文**：語言選擇只決定裝進去的素材，不決定 UI。選英文的學生看到的是繁中介面 + 英文 skill。要改是整個 `model.js` 的三語化。
- **`claude-hud` 的 Windows 路徑沒跑過**：`materials/claude-code/claude-hud/statusline.ps1.template`。失敗是安靜的（狀態列不出現，沒有錯誤）。
- **`vault-sync` 的觸發用 `claude -p` 驗過，但 skill-creator 那套自動化量不到**：它測的是一個只有一行內容的假 command，五個 description 全是 0% recall，數字不能用。
- **「接新的筆記庫」沒有驗證卡**：要驗就得真的多建一個 repo，代價比價值大。改成寫進 `歡迎.md`，在他真的需要時才出現。
- **`docs/handoff/2026-08-06-walkthrough-and-copy-studio.md` 的待辦仍然有效**：skill 卡英文標題、白名單自我回報、`content/` 只搬了一部分、mac 的進度輸出過濾、`brew NONINTERACTIVE` 沒實測。
