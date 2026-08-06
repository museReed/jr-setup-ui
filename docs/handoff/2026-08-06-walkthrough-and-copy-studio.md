# 交接：操作步驟彈窗、copy-studio、文案準則

- **類型**：continuation——五條分支全部合進 main 了，剩下的是驗收與轉 private
- **main**：`2c4333f`，491 項測試綠
- **今天合併的**：PR #44 #45 #46 #47 #48

## 狀態摘要

1. **PR #44**（早上就驗過的那條）：後端分層、log 強化、白名單行為驗證、權限卡的按鈕與順序。
2. **文案審閱這條線**：定了八條準則（`docs/copy-review-criteria.md`），照它掃過 27 張卡，重寫了其中 14 張的標題與描述。
3. **copy-studio**（`tools/copy-studio/`）：跑在本機、直接寫進 `content/` 的編輯器。14 份 walkthrough 的文案全部寫完，**一張截圖都不用拍**——能畫的都用元件畫了。
4. **彈窗接進嚮導**：清單上「要學生自己動手」的那幾格，右邊多一顆問號（lottie），按下去跳出操作步驟。

## 必讀檔案

| 檔案 | 為什麼要讀 |
|---|---|
| `docs/copy-review-criteria.md` | 八條準則。之後每次改文案都照它掃，裡面兩條是全站規則不是單張卡的事 |
| `docs/walkthrough-architecture.md` | 步驟與截圖存哪、怎麼命名、為什麼是 JSON 不是 YAML、為什麼「能畫的就不要拍」 |
| `tools/copy-studio/README.md` | 怎麼跑編輯器、新增一格要教學時做什麼 |
| `docs/go-private-checklist.md` | 轉 private 的六步。第 6 步不可逆，前五步都要先做完 |
| `public/mocks.js` 的 `wizard` | 按鈕位置有三種（below / row / step），畫錯學生會找一顆不存在的按鈕 |

## 怎麼跑

```
node bin/jr-setup-ui.js              # 嚮導
node tools/copy-studio/server.mjs    # 文案與截圖編輯器（127.0.0.1:4200）
```

⚠️ **伺服器啟動時就把靜態檔讀進記憶體**，改 CSS / JS 要重開才看得到。這件事騙過我一輪。

## 下一步

### 1. VM 驗收（最優先）

今天所有東西都只在 mac 上看過。要驗的：

- 三張 `fullscreen-*` 卡的問號按鈕：hover 播完才開、直接點不等動畫、彈窗從問號長出來
- Windows 上看到的是「工作列在閃」不是「去 Dock 找」（`only: win` 那幾格）
- `fullscreen-copy` 的「不要按 Ctrl+C」在 Windows 上要出現，mac 上不該出現
- 卡片文案改動：`ghostty`（mac）／`execution-policy`（Windows）那張、`allowlist`、`playwright`

### 2. 乾淨 VM 的債

`docs/fresh-vm-acceptance.md` 第一段寫著：跑過很多輪的機器上驗的不算數。**這條債從 PR #40 欠到現在**，開一台全新的從 bootstrap 走一次。

### 3. 轉 private

照 `docs/go-private-checklist.md` 六步走。前五步都可逆，第 6 步不可逆。

### 4. Windows 的 PowerShell 落差（不緊急）

已確認 hook 在 Windows 上對 Bash 有效，卡片教的規矩沒破。補的話要先在 Windows 上拿到 PowerShell 工具的實際 `tool_name`——matcher 猜錯不會報錯、只會安靜地沒作用。詳見 `docs/handoff/2026-08-05-backend-layers-and-log.md`。

## 已知問題

- **6 張 skill 卡的標題還是英文**（`structured-questions（Claude）` 那種）。對非資工背景的學生等於空的，但那是既有決定（「skill 卡片的標題就是 skill 的名字」），要改得先拍板。
- **白名單那格的正面判定仍靠模型自我回報**，而且眼睛項拿掉之後沒有第二道人眼把關。要變成真副產物得改 headless 從事件流找證據。
- **`content/` 目前只有 14 格有 `title` / `description`**。其餘卡片的那一列仍然用 `src/` 裡的文案——`view.js` 會 fallback，所以可以一格一格搬。
- **mac 的進度輸出過濾還沒做**：`src/output-noise.js` 只認得 winget 的形狀。
- **`brew` 的 `NONINTERACTIVE=1` 沒有實測支撐**，`ghostty` 那條 cask 可能要密碼。
- **`package.json` 還沒有 `files` 白名單**。轉 private 第 1 步要加，記得排除 `tools/` 但留下 `content/`。
