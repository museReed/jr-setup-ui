# claude-hud 卡片實作規格

> 來源：2026-08-06 一次完整的人工安裝對話（macOS / Claude Code）。
> 目的：讓 jr-setup-ui 能用一張卡片把同一套 HUD 一鍵裝好，並產出**位元組等價**的設定。
>
> **實作落點**（2026-08-07 照這份做完）：
> - 步驟定義 `src/config-install.js` 的 `CLAUDE_HUD` 與 `describeStep` 的 `claude-hud`
> - 安裝 `scripts/install-configs.mjs` 的 `claudeHudStep`
> - 檢查 `src/config-check.js` 的 `checkClaudeHud`
> - statusLine 指令原文 `materials/claude-code/claude-hud/statusline.sh.template`
> - 學生看的步驟 `content/walkthroughs/eye-claude-hud.json`

---

## 1. 這張卡片要達成什麼

學生按一下，終端下方就出現這一行狀態列：

```
[Opus] ████░░░░░ 45% | my-project git:(main*) | Usage ██░░░░░░░░ 25% (resets in 1h 30m)
```

拆開來是四段：

| 段 | 內容 | 來源設定 |
|---|---|---|
| `[Opus]` | 目前模型 | `display.showModel` |
| `████░░░░░ 45%` | context 用掉多少 | `display.showContextBar` |
| `my-project git:(main*)` | 專案名 + 分支，`*` = 有未 commit 的改動 | `display.showProject`、`gitStatus` |
| `Usage ██░░░░░░░░ 25% (resets in 1h 30m)` | 5 小時／7 天用量額度與重置倒數 | `display.showUsage` 等 |

且每 5 秒自動重跑一次，倒數不會卡住不動。

---

## 2. 人工安裝時實際做了什麼

以下是原始對話的逐步紀錄。**每一步都標了「一鍵版要不要保留」**。

### 2.1 使用者輸入的四個指令

| # | 使用者輸入 | 發生什麼事 | 一鍵版 |
|---|---|---|---|
| 1 | `/plugin marketplace add jarrodwatts/claude-hud` | 在 `settings.json` 寫入 `extraKnownMarketplaces.claude-hud` | 改用 CLI |
| 2 | `/plugin install claude-hud@claude-hud` | 下載 plugin 到 cache、寫入 `enabledPlugins` | 改用 CLI |
| 3 | `/claude-hud:setup` | 偵測環境 → 產生 statusLine 指令 → 寫入 `settings.json` | 改成直接寫檔 |
| 4 | `/claude-hud:configure` | 問版面／預設／語言 → 寫 `config.json` | 改成直接寫檔 |

指令 3、4 是**互動式問答**（每一步都跳選項給使用者點）。一鍵版把答案寫死，不需要問。

### 2.2 setup 問了什麼、選了什麼

| 問題 | 選項 | 這次的選擇 |
|---|---|---|
| 額外顯示項目（可複選） | 工具活動／子代理與 Todo／Session 資訊／Session 名稱 | **全部略過**（維持預設） |
| 自動刷新間隔 | 5 秒 / 1 秒 / 不要 | **每 5 秒** |
| HUD 有出現嗎 | 有／沒有 | 有 |

### 2.3 configure 問了什麼、選了什麼

| 問題 | 這次的選擇 | 寫進哪個 key |
|---|---|---|
| 版面 | **Compact**（全部擠一行） | `lineLayout: "compact"`, `showSeparators: false` |
| 起始組合 | **Minimal，但額外加上 5h／7d 用量** | 見下方 config.json |
| 語言 | **English** | `language: "en"` |
| 用量寫法 | **進度條樣式** | `usageBarEnabled: true`, `usageCompact: false`, `showResetLabel: true` |

額外的人為判斷（**一鍵版要照抄**）：

- 7 天用量預設只在 **超過 80%** 時才顯示。使用者要它一直看得到，所以手動加了 `display.sevenDayThreshold: 0`。這個 key 屬於 configure 流程「不會問、但會保留」的進階設定，只能直接寫檔。
- config.json **只寫偏離預設的 key**，沒有把 Minimal 那一堆 `false` 全部展開。plugin 之後改預設值時衝突比較少。

---

## 3. 這台機器偵測到的環境

setup 會依環境產生不同指令，一鍵版必須**在安裝當下重新偵測**，不能沿用下面的值。

| 項目 | 這次的值 | 偵測方式 |
|---|---|---|
| 平台 | `darwin` | `uname` |
| Runtime | `/usr/local/bin/node`（**沒有 bun**） | `command -v bun`，找不到再 `command -v node` |
| 進入點 | `dist/index.js` | 用 bun 時是 `src/index.ts`，用 node 時是 `dist/index.js` |
| plugin 版本 | `0.6.0` | `~/.claude/plugins/cache/*/claude-hud/<version>/` |
| cache 路徑 | `~/.claude/plugins/cache/claude-hud/claude-hud/0.6.0/` | 第一層是 marketplace 名，第二層才是 plugin 名 |

**runtime 選擇的取捨**：macOS 上 bun 啟動較快，但會多一個「學生沒裝 bun」的失敗點，而且 bun 走的是 TypeScript 原始碼。建議一鍵版**固定用 node**（Claude Code 本來就依賴 node，一定存在），行為與這份文件一致。

> 實作註記：嚮導直接用 `process.execPath`——那就是「正在跑嚮導的那支 node」的絕對路徑，
> 比再 spawn 一次 `command -v node` 少一個失敗點，結果等價。

---

## 4. 最終產物：三個檔案

### 4.1 `~/.claude/settings.json`（合併，不是覆寫）

`/plugin` 兩個指令寫入的部分：

```json
{
  "extraKnownMarketplaces": {
    "claude-hud": {
      "source": { "source": "github", "repo": "jarrodwatts/claude-hud" }
    }
  },
  "enabledPlugins": {
    "claude-hud@claude-hud": true
  }
}
```

`/claude-hud:setup` 寫入的部分：

```json
{
  "statusLine": {
    "type": "command",
    "command": "<見 4.2>",
    "refreshInterval": 5
  }
}
```

### 4.2 statusLine 指令原文

原文放在 `materials/claude-code/claude-hud/statusline.sh.template`，裡面的 `{RUNTIME}`
在安裝當下換成偵測到的 runtime 絕對路徑。**不要把這串寫進 JS 字串**——它有大量 `"`、`'`
與 `\`，每一層逃脫都是一個壞掉的機會。

這串在做三件事：

1. **決定寬度** — 依序試 `COLUMNS` 環境變數 → `stty size` → 退回 `120`，然後減 4（Claude Code 輸入框左右各留 2 欄）。Claude Code 會把子程序的 stdout 導向管線，所以 `process.stdout.columns` 讀不到，必須靠環境變數傳。
2. **找最新版 plugin** — 掃 cache、用 `sort` 依版號排序取最後一個。**所以 plugin 更新後不用重跑 setup。**
3. **執行** — `exec` 取代 shell，少一層程序。

三個容易踩壞的細節：

- `grep -E '^[0-9]+\.[0-9]+\.[0-9]+[[:space:]]'` 的 `[[:space:]]` **不可以寫成 `\t`**。GNU grep 不把 `\t` 當 tab，會警告 `stray \ before t` 然後整條比對失敗 → `plugin_dir` 變空字串 → 找不到模組 → HUD 靜默消失。
- cache glob 中間那層 `*` 是 **marketplace 名稱**，不能省略。
- 寫檔一定要用 JSON serializer，不要自己拼字串。

### 4.3 `~/.claude/plugins/claude-hud/config.json`（全新檔案）

```json
{
  "lineLayout": "compact",
  "showSeparators": false,
  "language": "en",
  "display": {
    "showModel": true,
    "showContextBar": true,
    "showUsage": true,
    "usageBarEnabled": true,
    "usageCompact": false,
    "showResetLabel": true,
    "sevenDayThreshold": 0
  },
  "gitStatus": {
    "enabled": true,
    "showDirty": true,
    "showAheadBehind": false,
    "showFileStats": false
  },
  "jjStatus": { "enabled": false }
}
```

---

## 5. 一鍵實作方案

### 5.1 為什麼不用「開終端進 Claude 打指令」

原本的做法要開一個互動式 Claude session，讓 skill 跑問答流程。這條路對一鍵按鈕來說有三個問題：學生會被中途的選項卡住、答錯就裝出不一樣的 HUD、失敗了也很難判定卡在哪一步。

`claude plugin` 有完整的非互動 CLI（已驗證存在）：

```
claude plugin marketplace add <source>
claude plugin install <plugin>@<marketplace> [-s user|project|local]
```

**所以整張卡片可以做成：兩條 CLI + 兩次檔案寫入，完全不需要互動。**

### 5.2 安裝步驟

| # | 動作 | 指令／內容 | 失敗處理 |
|---|---|---|---|
| 1 | 加 marketplace | `claude plugin marketplace add jarrodwatts/claude-hud` | 需要網路與 git；已存在時是 no-op |
| 2 | 裝 plugin | `claude plugin install claude-hud@claude-hud -s user` | 見 §7 EXDEV |
| 3 | 偵測 runtime | `process.execPath` | 找不到 → 中止並提示裝 Node LTS |
| 4 | 解析 cache 路徑 | 掃 `~/.claude/plugins/cache/*/claude-hud/*/`，確認 `dist/index.js` 存在 | 不存在 → 步驟 2 其實沒成功 |
| 5 | 備份 settings | `cp settings.json settings.json.bak.<timestamp>` | 寫檔前必做 |
| 6 | 合併 statusLine | §4.1 + §4.2，用 JSON serializer | 見 §7 既有 statusline |
| 7 | 寫 config.json | §4.3，先 `mkdir -p ~/.claude/plugins/claude-hud` | 已存在則合併 |

步驟 5、6 之間要檢查 `statusLine.command` 是否已存在且**不含 `claude-hud`** —— 那表示學生已經在用別的狀態列（`claude-pace`、`cc-statusline`、自製腳本）。舊指令要存到 `~/.claude/plugins/claude-hud/previous-statusline.txt`。

> 實作註記：嚮導 spawn 出來的安裝程序沒有 tty，問不了問題。所以改成
> 「先備份、再覆蓋、並在終端印出備份位置」，學生看得到也換得回去。

### 5.3 生效時機

`settings.json` 會自動重載，**不需要重啟 Claude Code**。但 HUD 只在「下一次互動之後」才畫出來 —— 學生送出任何一句話就會看到。

這對驗證卡片的影響：安裝完立刻去截圖會看到空白，那不是失敗。

> 實作註記：`verify-in-terminal` 的 `statusline` 這個 case，agent 是 claude 時會
> 自動送一句「請用一句話跟我打招呼」進去，就是為了逼出那一次互動。

---

## 6. 驗證方式

### 6.1 離線驗證（推薦，不需要學生互動）

直接餵一個空 JSON 給 statusLine 指令：

```bash
printf '{}' | bash -c '<§4.2 的指令>'
```

**通過條件**：exit code 0，且 stdout 非空。

實測輸出（無 session 資料時）：

```
[Unknown] ░░░░░░░░░░ 0%
```

`[Unknown]` 和 `0%` 是正常的 —— 測試時沒有真實 session 資料。另外 stderr 會出現 `bash: /dev/tty: Device not configured`，那是寬度偵測退回預設值的正常路徑，**不算失敗，判定時要忽略 stderr**。

### 6.2 設定檔驗證（適合做 fingerprint）

三個檢查點：

1. `settings.json` 的 `statusLine.command` 含字串 `claude-hud`，且 `refreshInterval === 5`
2. `settings.json` 的 `enabledPlugins["claude-hud@claude-hud"] === true`
3. `config.json` 與 §4.3 逐鍵相等

`state.json` 的 fingerprint 建議取 **config.json 正規化後的 SHA-256**（排序 key、去空白）。statusLine 指令含機器專屬的 runtime 路徑，不適合直接雜湊。

> 實作註記：嚮導的 `checkClaudeHud` 就是這三點。不比對指令全文，只認 `claude-hud`
> 這個字串加 `refreshInterval`。

### 6.3 目視驗證

`eye-claude-hud.json` 讓學生自己確認：輸入框下方多出一行，裡面有模型名、一條進度條、專案名。用量那段**只在有實際用量時才出現**，沒有寫進必看清單。

---

## 7. 已知的坑

| 情況 | 症狀 | 處理 |
|---|---|---|
| `grep` 的 `\t` | HUD 完全不出現，也沒有錯誤訊息 | 必須用 `[[:space:]]`，見 §4.2 |
| 幽靈安裝 | cache 有但 registry 沒有（或反過來） | 安裝前先對照 `plugins/cache/*/claude-hud` 與 `installed_plugins.json`，不一致就先清乾淨 |
| Linux 跨檔案系統 | `EXDEV: cross-device link not permitted` | 舊版 Claude Code 的 bug，優先升級；否則 `TMPDIR=~/.cache/tmp` |
| 學生已有其他狀態列 | 一鍵會蓋掉別人的設定 | §5.2 步驟 6 的檢查 |
| Windows | 這份文件只驗證過 macOS | Windows 要走完全不同的路徑（Node launcher `.mjs` + `cmd.exe`），且 PowerShell 5.1 寫 JSON 會夾帶 BOM。詳見 plugin 的 setup skill |
| 串接指令 hook | 無 | 本機的 `block-chained-bash` hook 只擋 Claude 發出的 Bash 呼叫，**不影響 statusLine** —— 那是 Claude Code 自己 spawn 的子程序。實測正常 |

---

## 附錄：原始對話的完整指令序列

```
/plugin marketplace add jarrodwatts/claude-hud
/plugin install claude-hud@claude-hud
/claude-hud:setup
    → 額外顯示項目：（略過，不選）
    → 自動刷新：每 5 秒
    → HUD 有出現嗎：有
/claude-hud:configure
    → 版面：Compact
    → 起始組合：Minimal ＋ 額外加 5h／7d 用量
    → 語言：English
    → 用量寫法：進度條樣式
（人工追加）display.sevenDayThreshold = 0
```
