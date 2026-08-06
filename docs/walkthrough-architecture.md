# 操作步驟（walkthrough）的存放架構

學生「要自己動手」的那幾格，操作細節不寫在卡片上，寫成一份 walkthrough：點卡片上那顆按鈕，跳出一個彈窗，一步一步教他做。

這份講**那些步驟與截圖存在哪、怎麼命名、誰來編**。彈窗長什麼樣、哪一格才配圖，見 `copy-review-criteria.md`。

## 為什麼不是 YAML

先前談文案抽離時傾向 YAML——它有註解、不用引號，審閱者在 GitHub 上直接改得動。walkthrough 不走這條，理由有二：

1. **這個 repo 零依賴，而學生端永遠不跑 `npm install`**（`setup.ps1` 是下載 ZIP、直接 `node bin/jr-setup-ui.js`）。YAML 要 parser，JSON 不用。
2. **walkthrough 有專屬編輯器**（`tools/copy-studio`），沒有人需要手寫這些檔案。「好讀好手改」是 YAML 唯一勝過 JSON 的地方，而這裡用不到。

卡片本身的標題與描述是另一回事——那些少、穩定、審閱者會想直接改，之後仍可以走 YAML。兩者不必同一種格式。

## 檔案落點

```
content/
  walkthroughs/
    fullscreen-copy.json          ← 一格一個檔
    eye-tab-sync.json
  shots/
    fullscreen-copy/
      02a-see-new-terminal.mac.png    ← 真的要拍的才有檔案
      02a-see-new-terminal.win.png
```

一格一個檔，不是一個大檔：改一格只動一個檔，PR 的 diff 看得出動到哪一格，兩個人同時編也不會撞在一起。

## 截圖的命名

```
<序號><子序>-<性質>-<步驟 id>[.<平台>].png
02a-see-new-terminal.mac.png
```

| 段 | 值 | 為什麼 |
|---|---|---|
| 序號 | 主節點 `01` `02`…，子節點加 `a` `b` | 檔案總管照檔名排序就是操作順序 |
| 性質 | `do` `see` `warn` `miss` | 一眼看得出這張圖在教什麼 |
| 步驟 id | kebab-case，例如 `new-terminal` | 語意，不是流水號；步驟搬動時檔名還讀得懂 |
| 平台 | `mac` / `win`，兩平台共用就省略 | 同一步在兩個系統上長不一樣時才分 |

**檔名是算出來的，不存在 JSON 裡。** 存了就會有兩份真相，改個步驟 id 就對不上。編輯器每次都重算，改名時連同檔案一起搬。

## 能畫的就不要拍

截圖有一個沒人擋得住的問題：**Claude Code 改版、按鈕搬家，圖就錯了，而畫面上一切正常，沒有任何測試抓得到**。跟這個 repo 一路在防的假綠燈同一類。

所以能用元件畫出來的一律用畫的，`visual.type` 是 `mock`：

| mock | 畫什麼 | 取代哪種截圖 |
|---|---|---|
| `term` | 終端視窗與裡面的幾行字，支援反白 | 「畫面會印出這一行」「整行反白的樣子」 |
| `dock` | mac 的 Dock，某個 app 底下有小圓點 | 「去 Dock 找那個圖示」 |
| `taskbar` | Windows 工作列，某個項目在閃 | 同上，Windows 版 |
| `wizard` | 嚮導自己的卡片，某顆按鈕被圈起來 | 「按卡片上的某某按鈕」 |
| `browser` | 瀏覽器視窗與網址列 | 登入時跳出來的那一頁 |

畫的好處是**改版不會過期、雙平台三語只要換字串**。真的非拍不可的（系統偏好設定、Finder、第三方網站）才用 `shot`——那些畫面本來就幾年不變。

## 資料長這樣

```json
{
  "id": "fullscreen-copy",
  "card": "claude",
  "row": "圈選代碼那一行，貼進下面的欄位",
  "steps": [
    {
      "id": "click-open-and-send",
      "title": "按卡片上的「開啟並送出測試句」",
      "detail": "它會開一個新視窗，並且自動幫你送出一句話。",
      "visual": null,
      "kids": [
        {
          "id": "new-terminal",
          "kind": "see",
          "title": "又一個新的終端視窗",
          "detail": "它常常不會自己跳到最前面……",
          "visual": { "type": "mock", "mock": "dock", "app": "terminal", "caption": "Dock 上的終端機圖示" }
        }
      ]
    }
  ]
}
```

- **主節點一律是「你要做」**——只看主節點就走得完整件事，所以主節點沒有 `kind`
- `kids` 是那個動作的附註：`see` 會看到 / `warn` 別做 / `miss` 沒發生的話
- `visual` 是選配。`{"type":"shot","want":"…","platforms":["mac"]}` 代表這一格要拍照，編輯器會顯示佔位框與算好的檔名

## 嚮導那端怎麼接

清單上每一格「要學生自己動手」的列，右邊多一顆**「怎麼做」**——按下去跳出彈窗，一步一步教。

| 檔案 | 做什麼 |
|---|---|
| `public/walkthrough.js` | 彈窗本身。主節點收合、附註點了才展開 |
| `public/mocks.js` / `public/mocks.css` | 畫出來的畫面。**copy-studio 載的是同一份**——編輯器裡看到的就是學生看到的 |
| `public/platform.js` | 分平台的取值與過濾 |

三條伺服器路徑：`/walkthroughs`（開頁問一次，哪幾格有得看）、`/walkthrough/<id>`（按下去才抓）、`/walkthrough-shot/<id>/<檔名>`。

幾個刻意的決定：

- **沒編過的那幾格不畫按鈕**。按出一個空彈窗比沒有按鈕更讓人困惑，所以 `/walkthroughs` 只回「第一步標題有字」的那些。
- **平台看 `navigator.userAgent`**。「去 Dock 找」與「看工作列在閃」是兩件不同的事，講錯等於沒講。
- **按鈕住在 `<label>` 裡面，所以一定要 `preventDefault`**。不擋的話按「怎麼做」會順手把那一格的勾打上——等於在學生還沒做之前就替他宣告做完了。
- **`mocks.css` 不吃任何一邊的 token**，自己帶色值。靠 design-system 的變數的話，在 copy-studio 那邊會變成沒有樣式的一團字（接進嚮導時實際踩到：Dock 畫成了純文字的 `>_`）。

## 誰來編

`tools/copy-studio`——跑在本機的編輯器，直接寫進 `content/`。

```
node tools/copy-studio/server.mjs
```

它做三件事：改文案、把截圖拖進佔位框（自動用正確的檔名存到 `content/shots/`）、列出**還缺哪些截圖**。

工具不該進 npm 套件——`go-private-checklist.md` 第 1 步在 `package.json` 加 `files` 白名單時，`tools/` 要排除掉（`content/` 要留著，那是執行期讀的）。
