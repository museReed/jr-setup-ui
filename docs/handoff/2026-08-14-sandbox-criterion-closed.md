# 交接：沙箱判準第四版收線（兩個分支都實機驗過），導覽泡泡拿掉

- **類型**：continuation
- **分支**：`main`（649 項測試綠）
- **前一份**：`docs/handoff/2026-08-12-sandbox-and-cleanups-verified.md`
- **這一份記什麼**：8/13 深夜到 8/14 這一輪——沙箱「設定好了沒」那一列的判準
  在一天之內換了四次，第四版才對；8/14 補驗了回鍋學生那條路（不跳 UAC）。
  另外拿掉了單張卡的提示泡泡。

## 狀態摘要

1. **沙箱那條線收了。** 判準 ④＝`~/.codex/config.toml` 的 `[windows] sandbox`。
2. **兩種學生都在真機上走過了**：第一次上課（跳 UAC）8/13 驗，回鍋學生
   （不跳 UAC）8/14 驗。這是第一次兩條路都有實測背書。
3. ⚠️ **綠燈不保證提權沙箱真的建好**——這是已知並且接受的代價，見「誠實記下的代價」。
4. **那顆按鈕印的三步文案改了**：第 2 步的權限視窗改成「可能會跳」，因為回鍋
   學生根本不會看到它，而回鍋是多數。
5. **單張卡的「先看這個」泡泡整套拿掉**（Reed 在 VM 上指定），連黏合層一起收。
6. 驗收還剩三張：**權限卡兩格串接、skill 卡、回報鈴鐺**。

## 必讀檔案

| 檔案 | 為什麼要讀 |
|---|---|
| `src/codex-sandbox.js` 的 `sandboxAnswered` | 判準四版的完整過程，比這份細 |
| `scripts/setup-codex-sandbox.mjs` 檔頭 | 那顆按鈕五個版本各自為什麼被推翻 |
| `test/codex-sandbox.mjs:157` 起 | 迴歸守門：判準不准回頭查 cap_sid 或本機帳號 |
| `public/tour-model.js` 檔頭 | 泡泡為什麼被拿掉（含守門測試在哪） |

## 判準換了四次

| # | 判準 | 為什麼被推翻 |
|---|---|---|
| ① | helper 找不找得到 | 只在第一次設定那一刻用得到 |
| ② | `cap_sid` | 帳號被刪掉時它照樣齊全，學生還是被問 |
| ③ | `cap_sid` ＋ 兩個本機帳號 | **太嚴**：學生選完 1、codex 印了 `Sandbox ready` 之後，那兩樣都還沒生出來，那一列永遠等不到，按鈕變成按不完的迴圈 |
| ④ | ✅ `config.toml` 的 `[windows] sandbox` | 它就是 codex 自己「要不要再問」的開關 |

④ 才對的理由：挪開目錄、挪開 `cap_sid`、刪掉帳號都不會讓選單回來，**只有拿掉
那一段才會**（一整輪實測）。而這一列存在的目的正是「別讓學生在合併那一步被那個
選單打斷」。

## 那顆按鈕也換了五版

| 版本 | 為什麼不行 |
|---|---|
| `codex sandbox pwsh -c …` | 沙箱裡的 pwsh 讀 profile 噴紅字（Smart App Control） |
| `codex sandbox cmd /c …` | 紅字沒了，但修不好真正壞的那種：帳號被刪時直接 `helper_sid_resolve_failed` / `1332`，連選單都不跳 |
| 固定名字的暫存目錄 | 只有第一次有效——codex 把用過的目錄寫進 `[projects]` 標成 trusted |
| 每次換新目錄名 | 還是不問 |
| ✅ 開視窗前把 `[windows]` 整段挪開 | 這才是唯一每次都會跳選單的條件 |

⚠️ 是**挪開不是刪掉**：學生中途取消時要還得回去，否則我們把一台本來好好的機器
弄壞了（逾時路徑會 restore）。

## 兩個分支的實測結果

兩趟都從 `dirty-returning-student` 快照開始。

| | 第一趟（8/13） | 第二趟（8/14） |
|---|---|---|
| 起始狀態 | 帳號刪掉、`cap_sid` 刪掉、`[windows]` 不在 | **帳號在**、`[windows]` 不在 |
| 對應的學生 | 第一次上課 | **回鍋（最常見）** |
| 選單 | 跳 | 跳 |
| UAC | **跳，按「是」** | **完全不跳** |
| `Sandbox ready` | 有 | 有 |
| 嚮導那一列 | 1 秒內自己轉綠 | 1 秒內自己轉綠 |
| `*.jr-setup-bak` | 清乾淨 | 清乾淨 |

第二趟建出來的帳號叫 `CodexSandboxOnline` / `CodexSandboxOffline`（第一趟建的，
第二趟沿用）。

### 怎麼再湊出「回鍋學生」那個狀態

dirty 快照裡**沒有**那兩個帳號（它們只有 codex 提權那一刻才會建），所以要兩趟：

1. 先照正常流程跑一次（會跳 UAC），帳號就建出來了
2. **不要還原快照**，把 `[windows]` 拿掉、帳號留著：

```powershell
Copy-Item "$env:USERPROFILE\.codex\config.toml" "$env:USERPROFILE\.codex\config.toml.manual-bak"
```

```powershell
(Get-Content "$env:USERPROFILE\.codex\config.toml" -Raw) -replace '(?m)^\[windows\][\s\S]*?(?=^\[|\z)','' | Set-Content "$env:USERPROFILE\.codex\config.toml" -NoNewline
```

3. 只按設定那一列的按鈕，選 1 —— 這時候就是回鍋學生

## 誠實記下的代價

**綠燈只代表「codex 不會再問」，不保證提權沙箱真的建好了。** 帳號與 `cap_sid`
看起來是等真的要跑指令時才建。真的沒建成的話，學生會在 codex 那邊看到
`helper_sid_resolve_failed` / `1332`——那是 codex 自己會報的錯，不是我們能提前判的。

接受這個代價的理由：**沙箱設定不是課程能否進行的必要條件**。codex 在信任目錄
照樣能跑，而工作坊的每一步都在信任目錄內。這一列的價值只是提前把選單處理掉。

## 兩個驗證陷阱（都咬過）

| 陷阱 | 症狀 |
|---|---|
| `Select-String … -SimpleMatch '\[windows\]'` | **永遠找不到**——`-SimpleMatch` 把反斜線也當字面字元。8/14 因此誤判成「④ 不成立」，虛驚一場 |
| PowerShell 5.1 讀沒有 BOM 的 UTF-8 | 中文全變亂碼。腳本寫檔時刻意加 BOM |

## 這一輪還做了什麼：導覽泡泡拿掉

單張卡切過來時會跳一顆「先看這個」泡泡（執行原則、中文編碼、分頁標題三張）。
Reed 在 VM 上看到它蓋在卡片上、箭頭指向奇怪的位置，指定整套拿掉。

連黏合層一起收：`CARD_HINTS`、`hintForCard()`、`HINT_SEEN_PREFIX`、`singleHint()`
那顆 driver、`seenHints` 記憶、`app.js` 傳的 `cardDone`。只清文案的話會留一顆永遠
不會被叫到的 driver 實例。

守門測試在 `test/tour.mjs` 與 `test/frontend-layers.mjs`——有人加回來會紅燈。
**版面導覽與元件導覽沒動。**

## 下一輪

1. **驗收剩三張**：權限卡兩格串接、skill 卡、回報鈴鐺
2. 導覽泡泡拿掉之後，那三張卡（執行原則、中文編碼、分頁標題）的話現在只剩卡片
   描述與清單文案在講——下次在 VM 上走到時順便確認夠不夠。
