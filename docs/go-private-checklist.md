# 轉 private 的可執行清單

這份是給「把 repo 從 public 轉成 private」用的。**第 6 步不可逆，前五步都要在還能用現況驗證的時候做完。**

## 為什麼需要一份清單

轉 private 會當場弄斷三件事，而且是學生端先斷、你後知後覺：

| 現在靠什麼 | private 之後 |
|---|---|
| `irm https://raw.githubusercontent.com/museReed/jr-setup-ui/main/docs/setup.ps1 \| iex` | **404**。raw 網址不帶驗證 |
| bootstrap 下載 zipball（`docs/setup.ps1:25`、`docs/setup.sh:16` 寫死了 `codeload.github.com`） | **401**。要 token |
| `$JrBranch="refactor/backend-layers"` 指定分支跑 VM 驗收 | **失效**。目前唯一的驗收管道 |

第三條影響最大：轉完之後你連「改了東西能不能跑」都驗不了。

## 保護得到什麼、保護不到什麼

先講清楚，免得做完發現保護的不是想保護的那個。

| 東西 | 轉 private 之後 |
|---|---|
| git 紀錄、handoff、issue／PR 討論、測試、還沒發佈的設計 | ✅ 藏得住 |
| 學生要執行的程式碼 | ❌ 藏不住——要能跑就得給 |
| `materials/` 的教材（CLAUDE.md、output-style、skill） | ❌ 藏不住——它們的用途就是被複製到學生的 `~/.claude` |

打包成執行檔也改變不了後兩項：Node SEA 是把 JS 原封不動存在執行檔的一個區段裡，`strings` 就看得到，`pkg` 有現成解包工具。代價卻是四個平台各編一份、50–100MB、以及沒簽章就會被 SmartScreen 與 Gatekeeper 擋（Apple 憑證 $99/年，Windows 更貴）。學生第一次接觸這門課就看到「此應用程式不受信任」，那個信任成本比程式碼被誰看到高太多。

**結論：走 private repo + public npm 套件。** repo 是工作室，套件是成品；工作室鎖起來，成品照常出貨。

私有 npm（`--access restricted`）不建議：要付費 org，而且每個學生都得有 npm 帳號、加進 org、跑 `npm login`。一場工作坊光這步就要二十分鐘，而它換來的保護正好是保護不了的那部分。

---

## 1. 決定套件裡放什麼

在 `package.json` 加 `files` 白名單。**用白名單不用 `.npmignore`**——漏掉一個目錄的後果是「少了跑不起來」，比「多送出去」容易發現。

| 進套件 | 大小 | 為什麼 |
|---|---|---|
| `bin/` `src/` `public/` `materials/` `scripts/` | ≈ 2.3MB | 執行期都要 |
| **不進**：`test/` `tools/` `docs/` | 省 700KB | 測試、開發工具、handoff |

⚠️ `scripts/` 看起來像開發工具，實際是執行期的一部分——`src/actions.js` 引用了裡面九支（`verify-in-terminal.mjs`、`install-configs.mjs`…）。不要因為名字而排除它。

`tools/` 只有 `loader-frame-inspector.html` 與 `strip-wizard-background.py`，都是開發用的。

## 2. 抽一個 public 的 bootstrap repo

新開 `museReed/jr-setup-bootstrap`，只放 `setup.ps1` 與 `setup.sh`。

內容從「下載 ZIP + 解壓 + 跑」瘦成「確認 Node → `npx jr-setup-ui@latest`」。

**這個 repo 要永遠公開**：那一行 `irm ... | iex` 不能帶驗證，否則學生貼上去就 401。

⚠️ 搬 `setup.ps1` 時把第 8 行那句註解一起帶走——「網址故意用 raw.githubusercontent.com 而不是 Pages，因為 Pages 把 .ps1 當成……」。不帶走的話下一個人會把網址改成 Pages，然後踩同一個坑。

## 3. 決定註解要不要一起發

`npm publish` 會把原始碼連同註解送出去。這個 repo 的註解記的是在 VM 上一次次踩出來的結論——「按了允許的話指令一樣會跑」「模型會先去建目錄然後撞權限」「hook 在 Windows 上對 Bash 有效但 PowerShell 繞過去」。那些比程式碼本身值錢。

**現在就決定**，因為第一次 publish 之後撤不回來（npm 的 unpublish 有 72 小時限制，而且那時已經有人下載過）。

三個選擇：照原樣發／發佈時剝掉註解（多一個 build step）／不管（反正現在就是公開的，轉 private 只止血未來的部分）。

## 4. 在還公開的時候 publish 一次，走通全流程

`jr-setup-ui` 這個名字在 npm 上是空的（`npm view` 回 404），可以直接用。

```
npm publish --dry-run     # 先看清單，確認 files 沒漏也沒多
npm publish
```

然後**在乾淨 VM 上跑一次** `npx jr-setup-ui@latest`，確認：

- `materials/` 找得到（`src/paths.js` 的 `materialsDir`）
- `scripts/` 叫得動（按任一個驗證）
- `public/` 的靜態檔載得到（畫面不是空白）

**這步一定要在轉 private 之前做**：出問題時你還能用現有的 ZIP 流程對照，分得出是打包漏了什麼，還是本來就壞。

## 5. 換掉分支驗收的管道

`$JrBranch` 在 private 之後失效，改成預發布版：

```
npm publish --tag beta          # 從分支發
npx jr-setup-ui@beta            # VM 上這樣跑
```

**這步也要在轉 private 之前實際跑通一次**。否則轉完之後連驗收都做不了，等於閉著眼睛改東西。

順帶：`.jr-source` 那個標記檔現在寫的是分支名，改成 npm 之後要改成寫版本號（`jr-setup-ui@1.2.3-beta.1`），不然診斷資料裡看不出學生跑的是哪一版。

## 6. 轉 private ← 不可逆

前五步全部驗過才動。轉完之後立刻回頭確認三條路都還通：

- [ ] 學生那行 `irm .../jr-setup-bootstrap/main/setup.ps1 | iex`
- [ ] `npx jr-setup-ui@latest`
- [ ] `npx jr-setup-ui@beta`

---

## 時機

**不要跟功能分支混在一起做。** 發佈流程的問題和嚮導本身的問題長得很像（都是「在乾淨機器上跑不起來」），兩件事一起改就分不出是誰壞的。

建議順序：手上的功能 PR 合併 → 補完欠的乾淨 VM 驗收 → 才開這條分支。
