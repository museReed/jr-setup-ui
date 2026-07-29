---
name: structured-questions
description: >-
  Use when facing multiple options or design decisions that need user input.
  Presents structured choice prompts with grouped questions, recommended tags,
  and option trade-offs. In Plan mode it uses request_user_input; in Default
  mode it pauses for an explicit switch-or-fallback choice.
  Triggers on "ask user", "structured questions", "提問格式".
user-invocable: true
---

# Structured Questions — 結構化提問規範

## Quick Reference

遇到多個可行方案時，**必須結構化提問**，不自行決定。

1. 多決策點 → 分組一次問完（最多 3 題）
2. 每題必標推薦選項；Plan mode 用 `(Recommended)`，文字版加 `✨`
3. 每個選項帶 **標題 + 說明 + 優缺點**
4. 每題 2-3 個選項
5. 有具體 artifact 可比較時附 code preview

觸發條件：任何存在 ≥ 2 個可行方案的決策點。

## Mode Detection — 先確認 mode，給用戶更好的 UI 體驗

**Step 0: 檢查現在是不是 Plan mode（`request_user_input` tool 是否可用）。**

- **在 Plan mode（tool 可用）** → 直接走 Path A: Tool UI（互動選單）。
- **不在 Plan mode（tool 不可用）** → **先問用戶要不要切 Plan mode，停下來等回答**，不要直接掉進文字版。

### 不在 Plan mode 時的流程

1. **輸出以下固定提示，然後立即停止**。不得在同一輪先列文字問題：

   > 你目前不在 Plan mode。若要互動式選單，請輸入 `/plan 繼續剛才的 structured questions`；若不要切換，請回覆『不切換』，我會改用文字選項。

2. 依回答走：
   - 用戶直接輸入 `/plan …`，切換後 `request_user_input` 可用 → 用 Path A 繼續原問題。
   - 用戶回「要／切換」但尚未輸入指令 → 引導他輸入 `/plan 繼續剛才的 structured questions`，然後停止。
   - 用戶回「不要／不切換」→ 在同一輪立即用 Path B 列出先前暫存的完整文字問題。
   - 回覆不明確 → 再次要求明確回答「切換」或「不切換」，然後停止；不得自行 fallback。

3. 切換 mode 前要保留原決策點；進入 Plan mode 或拒絕切換後，繼續同一組問題，不要重新分析成另一組。

## When to Use

| 場景 | 觸發 | 說明 |
|------|------|------|
| 架構 / 技術選型 | ✅ | DB schema、API 設計、module 結構、第三方選擇 |
| 命名 / 慣例 | ✅ | 變數名、branch name、file placement |
| 實作策略 | ✅ | TDD 順序、拆 PR 策略、並行 vs 序列 |
| 範圍取捨 | ✅ | MVP vs 完整版、edge case 處理範圍 |
| 任何多選項決策 | ✅ | 上述未列但存在 ≥ 2 可行方案的情境 |
| 只有一種合理做法 | ❌ | 不要為問而問，直接做 |
| 純執行步驟確認 | ❌ | 用文字說明即可 |

## When NOT to Use

- 只有一種合理做法 → 直接執行
- 用戶已在指令中明確指定做法 → 遵從不問
- 純狀態回報 / 進度更新 → 用文字輸出

## Execution Flow

### Step 1: 識別決策點

掃描當前任務，列出所有需要用戶決定的點。

✅ DO: 把相關的決策點分組，一次問完
❌ DON'T: 每個小問題分開問，打斷用戶節奏

### Step 2: 輸出問題

---

#### Path A: Tool UI（Plan mode — `request_user_input` 可用時）

每個決策點對應 `questions` array 中的一個 item：

```json
{
  "questions": [
    {
      "id": "decision_name",
      "question": "完整問句，結尾帶問號",
      "header": "≤12字標籤",
      "options": [
        {
          "label": "選項名稱 (Recommended)",
          "description": "一句話壓縮說明取捨；優點：...；缺點：...。"
        },
        {
          "label": "選項名稱",
          "description": "一句話壓縮說明取捨；優點：...；缺點：...。"
        }
      ]
    }
  ]
}
```

規則：
- `header` ≤ 12 字元，中文優先
- `id` 使用穩定的 `snake_case`
- 每次最多 3 題，每題 2-3 個互斥選項
- 推薦項放第一個，label 尾端加 ` (Recommended)`
- `description` 只能一行，用一句話壓縮說明、優點與缺點
- 不要自行加入 Other（系統會提供 free-form Other）

---

#### Path B: Text Fallback（Default mode — 用戶明確拒絕切換後）

用以下純文字格式輸出，然後**停下來等用戶回覆**：

```
### Q1: {問題標題}
{完整問句}

  ✨ A) {推薦選項名稱} (Recommended)
     {一句說明}
     😃：{pros}
     😫：{cons}

  B) {選項名稱}
     {一句說明}
     😃：{pros}
     😫：{cons}

  C) {選項名稱}
     {一句說明}
     😃：{pros}
     😫：{cons}

  D) Other（請說明）

### Q2: {問題標題}
...
```

請回覆各題的選項編號（例如 Q1: A, Q2: B），或直接說明你的想法。

規則：
- 每次最多 3 題，每題列 2-3 個實質選項
- 推薦項前加 `✨` 並標 `(Recommended)`，放第一個
- 最後一個選項固定是 `Other（請說明）`
- 結尾必須加回覆引導句
- 有具體 artifact 時在選項下方附 fenced code block

### Step 3: 選項描述格式

Path A 的 `description` 必須是一行：

```
{一句話說明}；優點：{pros}；缺點：{cons}。
```

Path B 的文字選項維持三行格式：

每個選項的說明遵循三行格式：

```
{一句話說明這是什麼}
😃：{pros}
😫：{cons}
```

- 第一行：說明，一句話
- 第二行：😃 獨立一行
- 第三行：😫 獨立一行
- 沒有明顯缺點可寫「😫：無明顯缺點」

### Step 4: 處理回答

- 用戶選了推薦項 → 直接執行
- 用戶選了其他項 → 按選擇執行，不質疑
- 用戶選了 Other 並打字 → 理解意圖後執行或追問
- 用戶加了 notes → 把 notes 納入執行考量

## Common Mistakes

| Mistake | Why it fails | Fix |
|---------|-------------|-----|
| 遇到多方案時直接選一個做 | 用戶失去控制權，可能做錯方向 | 任何 ≥ 2 方案必問 |
| 每個決策點分開問 | 打斷節奏，用戶要回答 5 次 | 分組一次問完 |
| 選項只有標題沒有說明 | 用戶缺乏判斷依據 | 必帶說明 + 😃/😫 |
| 沒標推薦選項 | 用戶要花時間自己分析優劣 | 每題必標 ✨ Recommended |
| 😃/😫 跟說明擠同一行 | 不好掃讀 | 😃 和 😫 各自獨立一行 |
| 非 Plan mode 硬呼叫 request_user_input | 工具不可用，報錯中斷 | 輸出固定切換提示並停止 |
| 非 Plan mode 沒問就直接掉文字版 | 用戶錯過更好的互動選單 UI | 先等用戶明確拒絕切換，再輸出文字問題 |
| 用戶含糊回答時自行 fallback | 未取得是否切換的明確選擇 | 再問「切換」或「不切換」並停止 |
| 只有一種做法也硬問 | 浪費用戶時間 | 直接做，不為問而問 |
