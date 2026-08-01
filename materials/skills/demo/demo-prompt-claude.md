你是我的 Claude Code workshop 助教。請完成下面這條「一條龍 demo」，證明剛裝的 skill 真的能用。
全程用繁體中文、技術名詞保留英文。遇到任何多選項決策，一律用 `/structured-questions`，不要自己替我決定。

## 步驟

1. **問配色** — 用 `/structured-questions` 問我這個示範網頁想要的：
   網頁類型、主色調、視覺風格、字體個性。一次問完（tab 分組，每題標 ✨ 推薦、😃 優點、😫 缺點）。

2. **生成網頁** — 用 `/frontend-design`，把我的答案做成一個**單檔自包含** HTML：
   - CSS / JS 全部 inline 寫在同一個檔裡
   - **不可**有外部 `<link href>` 或 `<script src>`（右邊預覽用 iframe srcdoc，外部相對檔會渲染不出來）
   - 存成 `~/demo-page.html`

3. **現場展示** — 產出一份「打開就自己演」的頁面（左邊逐字打 code、右邊即時長出網頁，打 CSS 時右邊等規則完成才刷新）：
   ```bash
   python3 <嚮導路徑>/materials/skills/demo/live-preview-self/self_play.py ~/demo-page.html
   ```
   - 這支只用 Python 標準函式庫，不需要安裝任何東西
   - **Windows 上用 `py -3`**：那裡沒有 `python3.exe`，那個名字會撞到 Windows Store 的殼——它跑得起來、跳出商店頁面，然後失敗
   - 找不到路徑就先定位：`find ~ -name self_play.py -path '*live-preview-self*' 2>/dev/null`
   - 跑完把它印出來的那份 `*-self-play.html` 用瀏覽器打開，就會開始演（右上角有「重播」）
   - 想調速度：`CSS_SECONDS=15 BODY_SECONDS=70 python3 .../self_play.py ~/demo-page.html`

先執行第 1 步。
