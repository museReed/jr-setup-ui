---
name: auto-rename
description: >-
  Use when renaming the current session based on conversation context.
  Triggers on "rename", "auto-rename", "命名", "改名", "session name".
allowed-tools: [Bash]
---

# Auto-Rename — Session Naming Utility

## Quick Reference

根據對話內容為 session 命名，寫入 session-names 檔 + 改 terminal tab title。

1. 讀對話脈絡 → 決定 `{emoji} {中文敘述}`（≤ 40 字元，emoji 見 §Emoji Mapping）
2. 一個 Bash call 完成：PID 定位 + 寫檔 + 改 tab + 清 marker
3. 回報新名稱，一句話結束

Key rules:
- 根據對話「主要目的」選 emoji，不是最新一句話
- ⛔ emoji 只能從 §Emoji Mapping 的 8 個中選，禁止用其他 emoji（✓✅❌🎉 等都不行）
- 技術名詞保留英文，敘述用中文
- 步驟 2 合併成一個 Bash 指令執行，不分多次

## Emoji Mapping

| Emoji | 動作 | 範例 |
|---|---|---|
| 🏗️ | build / implement / refactor / migrate | 🏗️ 語音建模 pipeline |
| 🔧 | fix / hotfix | 🔧 爬蟲重試邏輯 |
| 🐛 | debug | 🐛 Gemini Vision blockReason |
| 📐 | plan / design | 📐 PRD2 classify-enrich |
| 📋 | review / audit | 📋 PRD 架構設計 |
| 💬 | discuss | 💬 auto-rename emoji 定義 |
| ⛴️ | pilot / spike | ⛴️ knowledge-distill 驗證 |
| 🔍 | research / investigate | 🔍 cron 失敗原因 |

## When to Use

- Hook 自動觸發後（hook 注入 `[session-namer]` additionalContext 時）
- 用戶手動打 `/auto-rename`
- 對話主題明顯偏移，舊名稱不再準確時

## When NOT to Use

- Hook 第一句話就會觸發命名——手動觸發前先確認 hook 沒有正在處理
- 用戶已手動指定名稱

## Execution Flow

### Step 1: 決定名稱

讀對話歷史，判斷主要目的，從 Emoji Mapping 選一個 + 寫中文敘述。

✅ DO: 用對話的核心任務命名（「🏗️ voice profile rebuild」）
❌ DON'T: 用最新一句話命名（「💬 確認 terminal 相容性」←太窄）

### Step 2: 執行命名

一個 Bash call 呼叫包裝腳本即可。它內部完成 PID 定位 + 寫 session-name 檔 + 寫
tab-sync file（或 OSC 到 tty）+ 清 default marker——全在腳本內，不含 `&&` 串接
（不觸發 block-chained-bash），且只需一條白名單放行整支腳本：

```bash
$HOME/.claude/hooks/set-session-name.sh '{名稱}' $PPID
```

`$PPID` 當第二個參數傳給腳本（腳本自己 `ps -o ppid=` 解析出 terminal PID，與 hook
自動命名走同一支腳本、行為一致）。

### Step 3: 回報

告訴用戶新名稱，一句話結束。

## Common Mistakes

| Mistake | Why it fails | Fix |
|---------|-------------|-----|
| 用最新一句話命名 | 不代表整個 session 的目的 | 回顧整個對話脈絡再決定 |
| 名稱超過 40 字元 | sidebar 顯示被截斷 | 精簡敘述，技術名詞可縮寫 |
| 忘記清除 default marker | hook 會持續每 10 次 tool call 重新提醒 | 步驟 2 的 rm 不可省略 |
| 分多個 Bash call 執行 | 浪費 tool call 額度 | 合併成一條指令 |
