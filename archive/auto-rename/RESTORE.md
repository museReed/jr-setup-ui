# auto-rename 封存與復原指引

> 2026-09-19 下架。原因：維護成本過高（跨兩個 CLI、三個平台、四種顯示表面），
> 現階段沒有人力跟著上游改版走。**功能本身是好的、當時是綠的**，不是因為壞掉才移除。
>
> 未來有人力時，照這份文件接回去。

---

## 一、下架前的完整狀態在哪

```bash
git show auto-rename-last-known-good          # tag message
git checkout auto-rename-last-known-good       # 完整可運作的那個版本
git diff auto-rename-last-known-good..HEAD     # 下架動了哪些地方
```

下架當時：**55 支測試 840 項全綠**。環境是 Claude Code 2.1.x、Codex CLI 0.149。

---

## 二、這個功能原本做什麼

一句話：**讓對話自己取名字，並把那個名字送到學生看得到的地方**。

| 顯示表面 | 誰負責 |
|---|---|
| Claude 的 statusline / session 名牌 | `set-session-name.sh` 寫 `~/.claude/session-names/<key>.txt` |
| 終端分頁標題 | `ai-tab-sync.{sh,ps1}` watcher 輪詢 `$AI_TAB_SYNC_FILE`，寫 OSC 到 tty |
| Codex 的 sidebar / status line / 分頁 | `codex-session-namer` 經共用 app-server 呼叫 `thread/name/set` |

觸發方式是 hook（`PostToolUse` / `UserPromptSubmit`）注入一段指示，由模型決定名字後呼叫腳本。

---

## 三、接點清單（復原時要接回去的位置）

行號是下架當時的，之後會漂移，用關鍵字搜。

### 3.1 安裝流程

| 檔案 | 位置 | 原本做什麼 |
|---|---|---|
| `src/config-install.js` | `SKILL_NAMES`（L12）、skill 路徑表（L20） | `auto-rename` 在清單裡才會被安裝 |
| `src/config-install.js` | `AGENT_HOOK_STEPS` 的 `claude-namer`（L475）、`codex-namer`（L496） | 兩個 hook step 的定義：bases、events |
| `src/config-install.js` | `agentHooks()` 裡 `id === "codex-namer"` 的分支（L515-620） | Windows 額外裝 app-server helper、POSIX 裝 version-guard wrapper |
| `src/config-install.js` | `tab-sync` step（L942-968）、`TAB_SYNC_MARKER`、`tabSyncBlock()` | shell profile 的 wrapper 區塊（Windows 另外複製 watcher） |
| `src/config-install.js` | Claude skill 的 `$HOME` 代換（L700-710） | SKILL.md 裡的 `$HOME` 換成絕對路徑，否則白名單字面比對對不上 |
| `src/config-check.js` | `skill-claude-auto-rename`、`skill-codex-auto-rename`（L534-540） | 檢查項 |
| `materials/claude-code/starter-allowlist.json` | `Bash(~/.claude/hooks/set-session-name.sh:*)` | 白名單放行命名腳本 |

### 3.2 畫面

| 檔案 | 位置 | 原本做什麼 |
|---|---|---|
| `public/model.js` | `CARD_BENEFITS`（L956-962） | 三張卡的說明文字 |
| `public/model.js` | `MERGE_ORDER`（L558-573）、`MERGED_CARDS`（L1098-1165） | `tab-sync` + `claude-namer` 合併成一張卡；`codex-namer` 另一張 |
| `public/model.js` | `setupOrder`（L1042） | 卡片順序 |
| `content/walkthroughs/` | `eye-claude-namer` / `eye-codex-namer` / `eye-tab-sync` / `eye-skill-*-auto-rename` | 五支教學動畫 |

⚠️ **`MERGED_CARDS` 的 key 跟著 `MERGE_ORDER` 的最後一個走**（`model.js:1179` 的註解警告過兩次）。
復原時把 `claude-namer` 加回 `MERGE_ORDER` 尾巴，就要同步把 `MERGED_CARDS` 的 key 換回 `claude-namer`。

### 3.3 終端設定

| 檔案 | 原本做什麼 | 下架時怎麼處理 |
|---|---|---|
| `src/ghostty-config.js`（L54-56） | 把 shell-integration 的 `title` 換成 `no-title`，讓位給 watcher | **還原成預設**（保留 `title`），否則學生連 shell 原生標題都沒有 |
| `src/shell-wrapper.js` | 掃 shell profile 裡舊的 `claude`/`codex` wrapper 與 tab-sync 區塊 | 保留（它同時負責清舊版殘留，本身不只服務命名） |

### 3.4 會寫進學生電腦的東西（復原時一併恢復；下架時由 retire step 清掉）

```
~/.claude/hooks/set-session-name.{sh,ps1}
~/.claude/hooks/session-auto-namer.{sh,ps1}
~/.claude/skills/auto-rename/SKILL.md
~/.claude/settings.json          → hooks 註冊（PostToolUse / UserPromptSubmit）
~/.claude/settings.json          → allowlist 的 set-session-name.sh 那條
~/.claude/session-names/         → 名字落地的檔案
~/.codex/hooks/codex-session-namer.{sh,ps1}
~/.codex/hooks/codex-{app-server-common,shared-app-server,server-restart,version-guard}.*
~/.codex/hooks.json              → hooks 註冊
~/.agents/skills/auto-rename/SKILL.md、~/.agents/skills/_shared/codex-session-rename.md
~/.jr-setup/bin/ai-tab-sync.ps1  （Windows watcher）
~/.zshrc 或 PowerShell profile   → tab-sync 區塊（marker 見 TAB_SYNC_MARKER）
~/.local/bin/codex-server-restart
```

### 3.5 別的 skill 對它的依賴（下架時已拆）

`handoff` 的 Step 5 原本會呼叫命名腳本，把名字改成 `📦 {topic}` 標記已交接：

- Claude：`$HOME/.claude/hooks/set-session-name.sh '📦 {topic}' $PPID`
- Codex：寫 relay 檔 `/tmp/codex-session-namer/${CODEX_THREAD_ID}.pending`

下架時把這兩段從 `handoff/SKILL.md` 拿掉了。**復原時要一併加回去**，否則 📦 標記不會回來。

---

## 四、已知限制（復原前先看，省得重踩）

| 限制 | 說明 |
|---|---|
| 背景 session 寫不到分頁 | 它掛在 pty host 上，`ps -o tty=` 回 `??`，不知道自己被哪個分頁看著 |
| 背景與父 session 共用分頁 | 後命名者贏 |
| 背景化當下套不了舊名字 | `SessionStart` 查不出 fork 來源，四條線索全斷（試過三輪，已撤回） |
| Codex 0.146+ | TUI 把 hook 交給共用 app-server，hook 拿不到終端的 `$AI_TAB_SYNC_FILE`；Windows 靠 localhost WebSocket 繞 |
| watcher 只在名字變動時寫一次 | 舊版有 `last_title` 判斷，任何外部 OSC 蓋掉標題就永久勝出；已改成每 5 次輪詢重新宣告 |
| Claude Code 原生分頁標題 | 固定是 `✳ Claude Code`，且 `CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1` 會整個關掉 |

---

## 五、下架後改用什麼（復原時要決定是否並存）

| | 現在的做法 |
|---|---|
| Codex | 原生：`config.toml` 的 `[tui] terminal_title = ["thread"]` + `status_line` 含 `thread-title`。**分頁標題全自動，不需要任何 hook** |
| Claude Code | 教學生手動 `/rename`；分頁標題用終端自己的改名功能（Windows Terminal 右鍵 Rename Tab、Ghostty `Cmd+Shift+P` → `prompt_tab_title`） |

⚠️ 復原時注意：**Codex 那一側已經被原生方案取代**，不要無腦把 hook 接回去把原生的蓋掉。
真要復原，先確認當時的 Codex 版本有沒有比原生做得更好的理由。

---

## 六、復原步驟

1. `git checkout auto-rename-last-known-good -- <需要的路徑>`，或直接從 `archive/auto-rename/` 複製回原路徑（目錄結構已對齊）
2. 照第三節把安裝流程、畫面、終端設定的接點逐條接回
3. 把 `handoff/SKILL.md` 的 Step 5 命名段加回去
4. 移除下架時加的 retire step（否則裝完馬上被清掉）
5. 測試：`npm test`
6. VM 實機驗收：`docs/fresh-vm-acceptance.md`

`_migrate.sh` 是當初搬檔用的腳本，裡面的清單就是完整檔案列表。
