---
name: structured-questions
description: >-
  Use when facing multiple options or design decisions that need user input.
  Defines how to structure AskUserQuestion calls: tab grouping, recommended tags,
  option detail level, and triggering conditions.
  Triggers on "ask user", "structured questions", "提問格式".
user-invocable: true
---

# Structured Questions — AskUserQuestion 使用規範

## Quick Reference

遇到多個可行方案時，**必須用 `AskUserQuestion` tool 提問**，不自行決定。

1. 多決策點 → tab 分組一次問完（`questions` array 放 2-4 題）
2. 每題必標 `✨ (Recommended)` — 放在推薦選項的 label 尾端
3. 每個選項帶 **標題 + 說明 + 😃/😫**（寫在 `description` 欄位）
4. `header` ≤ 12 字元，中文優先
5. 選項數 2-4 個，不含 Other（系統自動加）
6. 有具體 artifact 可比較時用 `markdown` preview

觸發條件：任何存在 ≥ 2 個可行方案的決策點。

## When to Use

| 場景 | 觸發 | 說明 |
|------|------|------|
| 架構 / 技術選型 | ✅ | DB schema、API 設計、module 結構、第三方選擇 |
| 命名 / 慣例 | ✅ | 變數名、branch name、file placement |
| 實作策略 | ✅ | TDD 順序、拆 PR 策略、並行 vs 序列 |
| 範圍取捨 | ✅ | MVP vs 完整版、edge case 處理範圍 |
| 任何多選項決策 | ✅ | 上述未列但存在 ≥ 2 可行方案的情境 |
| 只有一種合理做法 | ❌ | 不要為問而問，直接做 |
| 純執行步驟確認 | ❌ | 用文字說明即可，不需選項 UI |

## When NOT to Use

- 只有一種合理做法 → 直接執行
- 用戶已在指令中明確指定做法 → 遵從不問
- 純狀態回報 / 進度更新 → 用文字輸出

## Execution Flow

### Step 1: 識別決策點

掃描當前任務，列出所有需要用戶決定的點。

✅ DO: 把相關的決策點分組，一次問完
❌ DON'T: 每個小問題分開問，打斷用戶節奏

### Step 2: 構造 AskUserQuestion 參數

每個決策點對應 `questions` array 中的一個 item：

```json
{
  "question": "完整問句，結尾帶問號",
  "header": "≤12字標籤",
  "multiSelect": false,
  "options": [
    {
      "label": "✨ 選項名稱 (Recommended)",
      "description": "一句說明\n😃：...\n😫：..."
    },
    {
      "label": "選項名稱",
      "description": "一句說明\n😃：...\n😫：..."
    }
  ]
}
```

### Step 3: 選項描述格式

每個 `description` 遵循三行格式：

```
{一句話說明這是什麼}
😃：{pros}
😫：{cons}
```

- 第一行：說明，一句話
- 第二行：😃 獨立一行
- 第三行：😫 獨立一行
- 沒有明顯缺點可寫「😫：無明顯缺點」
- 推薦項的 label 前加 `✨`，尾端加 ` (Recommended)`

### Step 4: Preview（可選）

當選項是具體 artifact（UI mockup、code snippet、config 範例）時，用 `markdown` 欄位：

```json
{
  "label": "✨ 方案 A (Recommended)",
  "description": "說明\n😃：...\n😫：...",
  "markdown": "```python\ndef example():\n    ...\n```"
}
```

### Step 5: 處理回答

- 用戶選了推薦項 → 直接執行
- 用戶選了其他項 → 按選擇執行，不質疑
- 用戶選了 Other 並打字 → 理解意圖後執行或追問
- 用戶加了 notes → 把 notes 納入執行考量

## Common Mistakes

| Mistake | Why it fails | Fix |
|---------|-------------|-----|
| 遇到多方案時直接選一個做 | 用戶失去控制權，可能做錯方向 | 任何 ≥ 2 方案必問 |
| 每個決策點分開問 | 打斷節奏，用戶要回答 5 次 | Tab 分組一次問完 |
| 選項只有標題沒有說明 | 用戶缺乏判斷依據 | 必帶說明 + 😃/😫 |
| 沒標推薦選項 | 用戶要花時間自己分析優劣 | 每題必標 ✨ Recommended |
| 😃/😫 跟說明擠同一行 | 不好掃讀 | 😃 和 😫 各自獨立一行 |
| header 太長 | UI 顯示截斷 | ≤ 12 字元 |
| 只有一種做法也硬問 | 浪費用戶時間 | 直接做，不為問而問 |
