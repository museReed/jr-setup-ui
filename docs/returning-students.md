# 上過課的同學要重跑嚮導

> 給講師與助教。學生只需要看「給學生的四句話」那一節。

## 結論：不要叫他們移除任何東西

嚮導是設計成可以重複跑的。叫學生先移除 Claude、Codex、git、Python 是**淨損失**：

- Claude、Codex、gh 的登入都要重跑一次 device flow（課堂上最花時間的一段）
- 他自己寫在 `CLAUDE.md` / `config.toml` 裡的規則會不見
- 移除本身也會失敗、也會卡住，多一批要處理的狀況

一鍵指令跟新生用同一條，不需要特別的版本。

## 重跑時每一類東西會發生什麼

| 類別 | 已經裝過的話 | 學生要做什麼 |
|---|---|---|
| CLI（claude / codex / git / gh / node / python） | 檢查回 `ok`，安裝鍵整顆收掉 | 什麼都不用做 |
| 他自己改過的規則檔（`CLAUDE.md`、`~/.codex/config.toml`、`AGENTS.md`） | 不覆蓋，顯示「已有你自己的版本，需要合併」 | 按**「用 AI 合併」**。合併完之前驗證鍵是鎖著的 |
| 我們發的素材（skill、hook、output-style） | 逐字比對，舊版顯示「檔案在，但內容跟這一版不同」 | 按**安裝**就更新 |
| claude-hud 狀態列 | 舊的一行寫法會被判成要重裝 | 按**安裝** |
| Obsidian 筆記庫 | 永遠留一顆按鈕（`reinstallable`） | **先完全關掉 Obsidian 再按** |

`~/.claude/settings.json` 在被改寫前會自動備份成 `settings.json.bak.<時間戳>`。

## 舊東西會不會殘留？三類行為不一樣

| 東西 | 重跑會不會清掉舊的 |
|---|---|
| hook 註冊（`settings.json`） | ✅ 會。`mergeAgentHookRegistrations` 先把「指令含我們 marker」的整批刪掉再重寫 |
| tab-sync 的 rc 區塊 | ✅ 會。用 marker 整塊替換 |
| Codex 的 `config.toml` 舊 key | ✅ 會。`RETIRED_CODEX_KEYS` 主動註解掉 |
| `CLAUDE.md` / output-style / hook 腳本檔 | 覆蓋同名檔 |
| 白名單規則 | ⚠️ 只加不減。舊規則會累積，大多無害 |
| **skill** | ❌ **不會清。** 裝到固定路徑再覆蓋，改名或停發的 skill 會留下，而且 Claude 照樣載入它 |

所以嚮導現在會**掃出來並在終端講一句**，但**不自動刪**——那個資料夾也可能是學生自己裝的
skill，程式分辨不出來。畫面上的話是「這台機器上有 N 個不是這一輪發的 skill：⋯」，完整
路徑寫在「看原始輸出」裡。

刪不刪由學生決定。真的是上一輪留下來的，直接刪掉那個資料夾就好。

## 唯一該先確認的一件事

**如果他當初的 claude / codex 是用 `npm install -g` 裝的**，落點跟嚮導現在用的原生安裝器
（`~/.local/bin`）不同，可能兩份並存。`claude --version` 抓到的是 PATH 裡先出現的那一份
——嚮導會判成 `ok`、不去裝新的，他用的卻是舊的那份。

⚠️ 這條**沒有實測過**，是從落點差異推出來的。先讓他跑一條確認：

```bash
which -a claude codex
```

```powershell
Get-Command claude, codex -All | Select-Object Source
```

印出不只一個路徑，才需要動手清掉舊的那份。

## 給學生的四句話

1. 跑一鍵指令，跟第一次上課時一樣
2. 從第一張卡照順序走，已經是綠色的就跳過
3. 看到「需要合併」一定要按「用 AI 合併」，不要跳過
4. 走到 Obsidian 那張之前，先把 Obsidian **完全關掉**
