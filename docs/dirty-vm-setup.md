# 建立「上過課的學生」髒環境 VM 快照

> 給接手的 session 讀。目標是各做一台 macOS 與 Windows 11 的 VM（UTM，macOS 主機），
> 弄成「上一輪工作坊之後留下一堆殘留」的狀態，各存一份快照，之後拿來反覆驗收嚮導。

## 為什麼要這份快照

回訪學生（上過課、機器上有上一輪殘留）會撞到一批問題，而那些問題**只在真機上重現得
出來**——乾淨的 VM 一個都碰不到。每次驗收都從同一個髒起點開始，結果才比較得起來。

- repo：<https://github.com/museReed/jr-setup-ui>
- 分支：**`rework/returning-students`**（弄髒用的腳本只在這條分支上）

## 每一台都照這個順序

1. 建 VM，裝好作業系統
2. 裝 **Node.js**（弄髒的腳本要用）；Windows 另外裝 **Windows Terminal**
3. **先存一份「乾淨」快照**（例如 `clean`）
4. 跑弄髒腳本
5. **再存一份「髒」快照**（例如 `dirty-returning-student`）

⚠️ **第 3 步不能跳。** 弄髒是不可逆的，要重來只能靠它。

## 弄髒的指令

腳本預設是「只看不動」，會先列出它打算做什麼。**看過那份清單再加 `--apply`。**

### macOS VM

```bash
curl -fsSL https://raw.githubusercontent.com/museReed/jr-setup-ui/rework/returning-students/scripts/seed-dirty-env.mjs -o /tmp/seed.mjs
```

```bash
node /tmp/seed.mjs
```

```bash
node /tmp/seed.mjs --apply
```

### Windows VM（PowerShell）

```powershell
irm https://raw.githubusercontent.com/museReed/jr-setup-ui/rework/returning-students/scripts/seed-dirty-env.mjs -OutFile $env:TEMP\seed.mjs
```

```powershell
node $env:TEMP\seed.mjs
```

```powershell
node $env:TEMP\seed.mjs --apply
```

## Windows 專屬的手動步驟

腳本會提醒，但它**自動化不了**：從 **Microsoft Store** 安裝 PowerShell 7（不要用 MSI）。
Store 的安裝要走 UI，而 winget 的 msstore 來源在多數 VM 上憑證驗證會失敗。

裝完確認它真的是 Store 版：

```powershell
(Get-Command pwsh).Source
```

要指到 `…\WindowsApps\…`。沒裝的話只有 codex 沙箱那個 `1312` 重現不了，其餘不受影響。

## 弄髒之後的驗證

**開一個新的終端視窗再跑**——PATH 與 shell 設定檔都被改過了，舊視窗看不到。

### macOS

```bash
which -a codex
```

```bash
type -a codex
```

```bash
ls ~/.codex/skills
```

### Windows

```powershell
where.exe codex
```

```powershell
Get-Command codex -All
```

```powershell
codex sandbox powershell -NoProfile -Command "Get-Location"
```

### 預期看到什麼

| 檢查 | 預期 |
|---|---|
| `which -a` / `where.exe` | **不只一行**（npm 的 shim 與原生版並存） |
| `type -a` / `Get-Command -All` | 有一個 **function 排在最前面**（那是假的舊 wrapper） |
| `~/.codex/skills` | 有 `handoff`（codex 搬家前的舊落點） |
| `codex sandbox …`（Windows） | **失敗**，錯誤碼 `1223` 或 `1312` |

⚠️ **這些「失敗」都是預期的**——它們就是要重現的東西，不要去修。

## 弄髒腳本做了哪七件事

| 項目 | 重現什麼 |
|---|---|
| `npm-legacy` | npm 全域裝舊版 → 並存偵測 |
| `orphan-shim` | 刪套件本體留 shim → `npm ls` 抓不到的孤兒（最難查的一種） |
| `shadow-function` | shell 設定檔放一個指向死路徑的 `codex` 函式 → 打 `codex` 不行、打 `codex.exe` 才行 |
| `dirty-configs` | 設定檔加自己的內容 → 合併流程；含 `service_tier = "default"`，新版 codex 會拒絕啟動 |
| `legacy-skill-root` | `~/.codex/skills` 放一支 → codex skill 舊落點 |
| `native-codex` | 裝原生版 → 並存、junction 漏連（[openai/codex#30829](https://github.com/openai/codex/issues/30829)） |
| `store-pwsh` | **只印步驟**（見上） → 沙箱的 `1312` |

Windows 上 `shadow-function` 會同時寫兩個 profile（5.1 與 7 各讀各的）——真機上撞過
「`$PROFILE` 不存在但函式存在」。

## 存完快照之後要回報

1. 兩台的快照名稱
2. 上面每個驗證指令的**實際輸出**
3. Windows 那台 Store 版 PowerShell 有沒有裝成功

## 不要做的事

- ⚠️ **不要在主機的 macOS 上跑弄髒腳本**，只在 VM 裡跑
- 不要跳過乾淨快照
- 不要在弄髒之後就跑安裝嚮導——那是下一階段的事，先把快照存好

## 相關文件

- `docs/vm-setup-macos.md`：macOS VM 怎麼建（Windows 那份還沒寫）
- `docs/returning-students.md`：這些殘留各自是什麼、嚮導打算怎麼處理
- `scripts/seed-dirty-env.mjs`：弄髒腳本本身，每一步的理由都寫在註解裡
