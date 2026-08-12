# 交接：C2 / A6 / A7 驗完，以及沙箱那條線的翻案

- **類型**：continuation
- **分支**：`rework/returning-students`（645 項測試綠）
- **前一份**：`docs/handoff/2026-08-11-report-bell-and-cleanups.md`
- **這一份記什麼**：8/12 一整天在 Windows VM 上的驗收，以及驗收途中挖出來的
  一條比原本工作更重要的線（Codex 沙箱 × Store 版 PowerShell）。

## 狀態摘要

1. **C2 / A6 / A7 三項都做完也驗過了**（細節見「驗收結果」）。
2. **A4 的沙箱 junction 這次連寫入路徑一起驗過**——8/11 那次只驗了 read-only，
   而那正是上游 issue 說「本來就會過」的那一半。
3. **B5 的警告改回來了，但理由跟當初完全不同**。這是今天最有價值的發現。
4. **`pwsh-store` 從「沒按鈕的黃燈」升級成一鍵修好**，關鍵是 `--installer-type wix`。
5. 隔離區獨立成一張卡，清完之後留著打勾（Reed 指定）。

## 必讀檔案

| 檔案 | 為什麼要讀 |
|---|---|
| `src/codex-sandbox.js` | 檔頭記著那條線翻案兩次的完整過程，比這份還細 |
| `src/quarantine.js` | C2 的三個判準，以及「分區資料夾在不在」為什麼能取代狀態記錄 |
| `src/installers.js` 的 `pwsh-store` | `--installer-type wix` 那段——少了它整顆按鈕等於沒修 |
| `public/viewmodel.js` 的 `sectionEndRecheck` | A7a 的判準，含「已完成就不查」那道 |

## 沙箱那條線：翻案兩次，第三次才對

**症狀**：Windows 上 codex 改得了檔案，但**一個指令都執行不了**，噴一長串
`CreateProcessAsUserW failed: 1920`（或 2、或 5）。

**真正的原因**：提升式沙箱以受限帳號跑指令，而 **Windows 不准那種帳號啟動 MSIX
封裝的程式**。學生只要 PATH 上第一支 `pwsh` 是市集版，codex 就廢了一半。

上游 [openai/codex#35871](https://github.com/openai/codex/issues/35871) 量得比我們
徹底（同一台、同一個 session、每種 shell 各 20 次）：

| 沙箱啟動的 shell | 失敗 |
|---|---|
| Store/MSIX 的 `pwsh.exe` | **20 / 20** |
| `powershell.exe` 5.1 | 0 / 20 |
| `cmd.exe` | 0 / 20 |
| git bash | 0 / 20 |

那份 issue 也指出這是六七個看起來不相干的回報背後的**同一個原因**，而沒有人發現
條件是「shell 是不是被封裝過的」。

### 為什麼我們繞了兩圈

| 時間 | 結論 | 為什麼錯 |
|---|---|---|
| 最初 | 「Store 版讓沙箱起不來」→ 給黃燈 | 那是**疑問**，不是事故。斷言沒有根據 |
| 8/11 | 實測 read-only 正常 → 拿掉警告 | **那次測試無效**：那台的沙箱從來沒設定起來 |
| 8/12 | 把沙箱真的建起來 → 症狀立刻出現 | ✅ |

⚠️ **8/11 那次為什麼無效**，值得記住：`~/.codex/cap_sid` 裡存著兩個受限帳號的
SID，而那是快照就帶著的。有 `cap_sid` 就不用再跑 setup helper，所以 helper 找不找
得到根本不影響它跑。**我們量的是一台「早就設定好」的機器。**

### 一路上更正掉的三個說法

- **`1223` 不是「找不到檔案」**，它是 `ERROR_CANCELLED`。找不到檔案時
  `ShellExecuteExW` 會先跳錯誤對話框，**對話框一關就變成「取消」**。
- **失敗不是「間歇」的，是逐指令決定**：`echo hello` 20/20 失敗、`Get-Content`
  20/20 成功（讀檔那條路根本到不了 `SpawnChild`）。所以「apply_patch 成功、下一步
  炸」不矛盾——那次的 `Get-Content` 是**透過 shell** 跑的。
- **winget 拿得到 MSI**。`installers.js` 原本記「`--source winget` 不決定拿到哪種
  包」是對的，但結論下錯了：不是「沒辦法」，是**要指定**。

### 修法（都已經進去了）

`Microsoft.PowerShell` 的 manifest 每個架構都有兩種包，winget 預設挑 MSIX：

```
msix   PowerShell-7.6.4.msixbundle       ← 預設，落在 WindowsApps
wix    PowerShell-7.6.4-win-<arch>.msi   ← 我們要的，落在 C:\Program Files
```

arm64 VM 上兩種都實測過：不加 `--installer-type`（連 `--force` 都加了）拿到的還是
MSIX；加了 `--installer-type wix` 就抓到 `.msi`。端到端也驗過——新視窗
`where.exe pwsh` 第一行變成 `Program Files` 那支，`codex sandbox pwsh` 從
`CreateProcessAsUserW failed: 2` 變成正常印出路徑。

⚠️ 三個接線細節，各自都會讓按鈕消失或長歪，寫在 `codex-sandbox.js` 與
`env-check.js` 的註解裡：`INSTALLERS` 的 key 要叫 `pwsh-store`、走 `fixAction`
不走 `installAction`、保留 `installable: false`。

## 驗收結果

### 已完成

| 項目 | 證據 |
|---|---|
| **C2** 隔離區 | 13 條清單畫在卡片上；按完隔離區空、分區資料夾留著、`.bak` 與 `.jr-setup` 其餘一個沒少 |
| **C2** 獨立成卡 + 清完打勾 | 卡片留著、那一列打勾、按鈕消失、里程碑站數不變 |
| **A6** 清乾淨腳本 | 「只看不動」六節全印、無 parse error、中文正常 |
| **A7a** 自動重查 | 走到最後一張出現一次；往回翻再回來算新的一次；已完成的段落不再重查 |
| **A7b** 指名擋著的卡 | 文字對、在進度條**下面**、貓不壓字 |
| **A4** 沙箱 junction | 接到 `current` 不是 `releases\<版本>`；兩支 helper 都走得到；UAC → 「Sandbox ready」→ `apply_patch` 成功 |
| **舊 skill 搬走** | `handoff` 進隔離區；`zzztest` 與 `.system` 原封不動；原地沒有 `.bak`；codex 啟動不再印黃字 |
| **npm 殘留三種分支** | 孤兒、只有 npm 版、**並存**（官方版 290981024 bytes / 11:49 一個位元組沒動） |
| **C2 的「`merge-backups` 不被誤傷」** | 兩次合併的還原點（`claude-md/20260812162058`、`codex-config/20260812165609`）在清完隔離區之後時間戳一字未改 |
| **規則段整段** | Claude 與 Codex 兩張規矩卡都合併＋行為驗證 5/5 通過 |

### 規則段走完之後才看得到的三件

1. **合併的完成標記檔不可靠，而且是系統性的**。兩次合併、兩個不同的 agent，
   **都沒有寫那個標記檔**（Claude 那次甚至在回報裡寫「已寫入」）。新補的退路
   （檔案改了＋安靜五秒就往下走）兩次都正確接手，缺行比對照常跑完。
2. **沙箱沒有擋住合併**——今天推論的最後一個風險沒有成真。但那是因為這台已經
   換成一般安裝版的 pwsh；**市集版的學生走到這一步會失敗**，而失敗的樣子是
   「合併看起來跑了、檔案卻沒動」。`pwsh-store` 擋在環境段的順序是對的。
3. **A7a 規則段那一半仍然沒驗到**（要停在最後一張才看得到那句話）。

### 還沒驗到的

| 項目 | 為什麼 | 什麼時候能驗 |
|---|---|---|
| A7a 規則段那一半 | 要停在規則段最後一張 | 下次走那一段時順便 |
| A6 的 `-Apply` | 會刪掉 codex 安裝目錄與使用者 PATH，跑了就得重來 | 這台不再需要保留狀態時 |

## 待辦（今天長出來的）

按我認為的優先序：

1. **`codex-sandbox` 那一列的判準改看 `cap_sid`**。現在問的是「helper 找不找得到」，
   而那只在**第一次設定沙箱**那一刻重要。已經設定好的機器會被誤報黃燈（Reed 的 VM
   就是），而「helper 在但還沒設定」的機器反而被判綠燈——那才是真的會出事的人。
   新判準：`cap_sid` 有 workspace + readonly 兩個 SID 就是綠的。
2. **`.jr-source` 多寫一行 commit sha**。它現在只記分支名，所以「我跑的是不是最新
   的」**問不出來**——今天為此繞了三四輪，最後靠 grep 一個 ASCII 識別字才確定。
3. **`$JrBranch` 沒設就靜默抓 `main`**。新開的視窗一定踩到（今天踩了兩次），而畫面
   上唯一看得出來的只有原始輸出裡那行「嚮導來源」。
4. **`reset-codex-install.ps1` 沒有任何人找得到**。救火工具只寫在 handoff 裡，
   助教怎麼知道它存在？至少該進「這一頁卡住了」的 issue 模板或一份助教文件。
5. **UAC 的預設按鈕是「否」**。今天三個地方都撞到（沙箱設定、msiexec、換 pwsh）。
   按取消之後畫面什麼都不會說，而那正是 `1223`。按完那顆按鈕若沒轉綠，訊息要
   講得出「你剛才那個權限確認視窗按了否嗎」。
6. **tab-sync 只裝進 5.1 的 profile**。學生自己改用 `pwsh` 開終端的話，分頁標題
   同步**靜默失效**。`shell-wrapper` 兩份都掃，所以清舊捷徑那顆不受影響。
7. **`pwsh-store` 的「沒裝」那一列要不要收掉**。照 C2 那把尺（「對誰都沒有用的話
   就不要長一列」）該收，但它現在是唯一能從畫面看出 PowerShell 種類的地方。
   建議只在「沒裝」時收，裝了就一定顯示——那樣列數只有兩種可能。
8. **B6**：診斷終端標題只查 5.1 的 profile 路徑（8/10 就在清單上）。
9. **「換成一般安裝版」那顆改成開真終端**。main 的 `scripts/install-pwsh-msi.mjs`
   刻意這樣做，理由是「背景跑的話 UAC 框會跳在嚮導後面，學生順手關掉，我們只拿到
   一個沒頭沒尾的錯誤碼」——而我們現在那顆就是跑在背景管線裡。這跟待辦 5 是同一件事。
10. **查清楚 winget 那個矛盾**：main 說「提權之後仍然 0x80070005」，我們實測
    `--installer-type wix --force` 成功。差別可能在有沒有指定安裝包類型。

## 從 main 搬過來的（2026-08-12）

main 上有 56 個 commit 是這條分支沒有的（它是從 `51c3e96` 另開的，刻意不從 main
複製 code）。準備把 main reset 掉之前，先撿了三樣：

| 撿了什麼 | 為什麼 |
|---|---|
| `docs/handoff/2026-08-08-…md` | 交接文件是這個專案的記憶，丟了就沒了 |
| `docs/returning-students.md` | 8/10 那份交接寫著「main 上那份才是最新」。已在檔頭加註「路徑與函式名不要照著查」 |
| `install-pwsh-msi.mjs` 的**根因說明** | 見下。⚠️ 只搬註解不搬檔案——那支 import `src/terminal-window.js`，這條分支沒有那支 |

⚠️ **main 的根因說明比我們今天寫的準**，已併進 `codex-sandbox.js` 的檔頭：沙箱是
另外開一個本機帳號（`CodexSandboxOffline` / `Online`）去跑指令，而 Store 的程式
**綁帳號不綁機器**——那個帳號從來沒裝過 pwsh。**是帳號綁定，不是政策禁止。**
它還多測了一列我們沒測的：用**完整的 WindowsApps 路徑**也一樣失敗，證明不是捷徑
解析的問題。

⚠️ 其餘六個檔案（`src/legacy.js`、`src/terminal-window.js`、`scripts/quarantine-skills.mjs`、
`reset-workshop-skills.mjs`、`seed-dirty-vm.ps1`、`uninstall-legacy-cli.mjs`）分支都
重做過，沒有搬。

## 走規則段時順手修掉的五個

全都是「真的點下去才看得見」的，而且有三個的註解**早就寫出了問題、實作只修了一半**。

| 症狀 | 根因 | commit |
|---|---|---|
| 合併成功了，卡片永遠停在「安裝中」 | 完成訊號靠 agent 自己 `echo done`——那是請求不是保證。實測兩次都沒寫，其中一次還回報「已寫入」 | `f8f5b11` |
| 還沒裝的卡就在講「⋯但標題沒有動」 | `guidanceModel` 連 `missing` 也給 guidance，而每段文案都假設「已經裝了」 | `ef6ed37` |
| 等合併的列被打勾，卡片卻寫「等你合併」 | `protectExisting` 的列按安裝什麼都不做，`installedSteps` 照樣記成已安裝 | `9884ca2` |
| AI 才剛開始寫，「驗證」那格已經打勾 | 那一格的 `expect` 回 null（沒有可輪詢的落點），開完視窗 exit 0 就被 `AUTO_VERIFY_ACTIONS` 記成通過 | `83d9de1` |
| 權限卡的兩格順序 | Reed 在畫面前指定白名單排前面 | `cb8b49e` |

⚠️ **`MERGE_ORDER` 換順序一定要連 `MERGED_CARDS` 的 key 一起換**——它跟著最後那一個
走，忘了換整張卡的標題與說明會靜靜退回單列的預設值。這一組改過兩次都差點漏掉。

⚠️ **「註解認得出問題、實作只修一半」出現了三次**（`app.js` 的「exit 0 不等於驗過了」、
`checklistGroups` 的「勾補上了、文字沒有」、`MERGED_CARDS` 的 key）。下次看到一段
警告自己的註解時，先確認它防的那件事**每一條路徑**都擋住了。

## 懸著的決策：要不要統一要求 PS7

8/10 那份留下的，今天有新資訊可以補：

**動機從來不是沙箱**。5.1 和**非市集版**的 pwsh 在沙箱裡都完全正常，沒裝 pwsh 反而
最乾淨（codex 會退回 5.1）。真正的動機是：**5.1 剖析不了 `&&`**，而 hook 的行為
驗證題目正是 `echo a && echo b`——那一格在 5.1 底下驗不到（畫面會誠實說是被 5.1
擋的，不是假綠燈）。

**要改的東西比想像多**：

| 要改的 | 為什麼 |
|---|---|
| `checkPowerShellVersion` | 現在接受「5.1 或 ≥7」 |
| **`verify-in-terminal` 開的視窗** | 寫死 `wt.exe powershell.exe`。不改的話驗證還是在 5.1 裡跑，`&&` 一樣驗不到 ← **核心** |
| `merge-in-terminal` | 同上 |
| **tab-sync 的落點** | 只寫 5.1 那份（見待辦 6） |
| 新的前置 | PS7 變必要 → 多一列 + 安裝鍵，而那顆**必須**帶 `--installer-type wix` |
| 新的檢查 | 現在不查「這個分頁跑的是 5.1 還是 7」 |

⚠️ **最容易被忽略的一項**：Windows Terminal 的預設分頁是 5.1，裝了 7 也不會自動
換過去。要求 7 卻沒把預設分頁換掉的話，學生隔天照常開終端還是 5.1，而我們裝進 7
的 profile 的東西**在那裡不存在**——畫面一切正常，實際什麼都沒生效。那比現在糟。

**我的建議是「不要求，但支援」**：tab-sync 兩份都裝、`&&` 那一格改成「有非市集版
的 pwsh 就用它開，沒有就用 5.1 並誠實說明」。把「必須」變成「有就更好」，不用現在
決定要不要遷移。

## 已知問題

- **驗收時不要用中文字串檢查檔案內容**。PowerShell 5.1 讀沒有 BOM 的 UTF-8 一律
  當成 ANSI，中文全變亂碼——`Select-String "市集版"` 永遠搜不到，不管版本新舊。
  用 ASCII 的識別字（函式名、旗標、id）。今天為此誤判過一次「版本沒更新」。
- **瀏覽器快取會騙人**。setup.ps1 換掉檔案、重啟 server，但原本那個分頁的
  `model.js` / `viewmodel.js` 可能還是舊的，而卡片有幾列是前端決定的。
  今天為此以為 `pwsh-store` 那一列是 bug，實際只要 Ctrl+F5。
- **`~/.codex/cap_sid` 是沙箱狀態的真正記錄**，不是 `.sandbox`。刪 `.sandbox`
  不會讓 codex 重問，刪 `cap_sid` 才會。而且那個選單只在**未信任的目錄**才跳
  （家目錄在 `config.toml` 裡是 `trust_level = "trusted"`）。
- **`msiexec /qn` 跳不出提權視窗，所以會靜默失敗**。要用 `/passive`。
- 前一份的「已知問題」全部仍然成立。
