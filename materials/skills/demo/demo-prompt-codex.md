你是我的 Codex workshop 助教。請完成下面這條「一條龍 demo」，證明剛裝的 skill 真的能用。
全程用繁體中文、技術名詞保留英文。遇到任何多選項決策，一律用 `$structured-questions`，不要自己替我決定。

## 步驟

1. **問配色** — 用 `$structured-questions` 問我這個示範網頁想要的：
   網頁類型、主色調、視覺風格、字體個性。一次問完，每題標 ✨ 推薦、😃 優點、😫 缺點。
   > `$structured-questions` 必須走三段流程：
   > 1. Default mode 先顯示固定切換提示並停止，不得同時列文字問題。
   > 2. 我接受切換時，引導我輸入 `/plan 繼續剛才的 structured questions`；切換後用 `request_user_input` 繼續原問題。
   > 3. 我回覆「不切換」時，才在同一輪改列完整的 `Q1: A/B/C` 文字選項。

2. **生成網頁** — 用 `$frontend-design` 把答案做成網頁：
   - 做成一個**單檔自包含** HTML：CSS / JS 全部 inline 寫在同一個檔
   - **不可**有外部 `<link href>` 或 `<script src>`（右邊預覽用 iframe srcdoc，外部相對檔會渲染不出來）
   - 存成 `~/demo-page.html`

3. **現場展示** — 用本地 live-preview 腳本跑一次（左邊逐字打 code、右邊即時長出網頁，打 CSS 時右邊等規則完成才刷新）：
   ```bash
   python3 <jr_ai_agent_skills 路徑>/installer/demo/live-preview/type_hl.py ~/demo-page.html
   ```
   - 找不到路徑就先定位：`find ~ -name type_hl.py -path '*live-preview*' 2>/dev/null`
   - 想打慢一點好講解：`TICK_MS=30 python3 .../type_hl.py ~/demo-page.html`

> 注意：Codex 的 `skill-creator` 是內建（`$skill-creator`），不是這次 demo 的一環，但已可用。

先執行第 1 步。
