# 把這台機器上所有的 codex「程式」移除，好讓網頁嚮導重裝一份乾淨的。
#
#   先看不動：  powershell -ExecutionPolicy Bypass -File .\reset-codex-install.ps1
#   真的移除：  powershell -ExecutionPolicy Bypass -File .\reset-codex-install.ps1 -Apply
#
# ⚠️ 這支是最後手段，不是嚮導流程的一部分，所以**沒有接成按鈕**。它會改使用者 PATH，
#    而 PATH 是開視窗時才讀的——跑完一定要關掉嚮導與所有 PowerShell 視窗重來，
#    做成按鈕等於在一個狀態已經作廢的畫面上繼續按。
#
# ⚠️ 不碰 ~\.codex —— 那裡面是登入憑證、AGENTS.md、config.toml、skills，都是他自己的
#    東西。刪掉的話要重跑一次 device flow 登入，還會弄丟他寫的規則。移除的是程式，
#    不是設定。唯一的例外是第 5 節那兩個快取，理由寫在那裡。
#
# 為什麼要整批移除：同一台機器上有兩份以上不同版本的 codex，卻共用同一個 ~\.codex
# 狀態目錄。新版寫進去的值舊版讀不懂（service_tier = "default"、reasoning effort =
# "max"），而舊版的安裝目錄裡沒有新版要用的 sandbox helper。一個一個修設定值是打
# 地鼠——把程式清成一份才是解。
#
# ⚠️ 這支**刻意不處理** npm 殘留與 profile 裡的函式。嚮導自己那兩顆按鈕做得比這裡好：
#
#   npm 裝的舊版、孤兒 shim   →「清掉上一輪 npm 裝的舊版」那張卡
#                                （判準在 src/legacy-cli.js：只有 npm 版、沒有官方版
#                                  的**不動**，而這支腳本分不出那件事）
#   profile 裡指向死路徑的函式 →「清掉上一輪留下的舊捷徑」那張卡
#                                （src/shell-wrapper.js 會跳過我們自己的 tab-sync
#                                  區塊，這支腳本一樣分不出來）
#
# 同一段清理邏輯寫兩份，遲早會有一天只改到其中一邊。所以那兩節在下面只剩一句
# 「回嚮導按那顆」。
param([switch]$Apply)

$ErrorActionPreference = 'Continue'

function Say($text) { Write-Host "`n=== $text ===" -ForegroundColor Cyan }
function Plan($text) {
  if ($Apply) { Write-Host "  [執行] $text" -ForegroundColor Yellow }
  else        { Write-Host "  [會做] $text" -ForegroundColor DarkGray }
}

if (-not $Apply) {
  Write-Host "現在是「只看不動」模式。確認下面的清單沒問題之後，加 -Apply 再跑一次。" -ForegroundColor Green
}

Say "現在 PATH 上叫得到的 codex"
# ⚠️ where.exe 看不到兩種東西，而那兩種正是最難查的：
#   應用程式執行別名  WindowsApps 底下那些零位元組的 reparse point
#   profile 裡的函式  PowerShell 解析時 function 贏過 PATH，而 where 只看 PATH
# 下面第 6 節會把該問的指令列出來。
$found = & where.exe codex 2>$null
if ($found) { $found | ForEach-Object { Write-Host "  $_" } }
else        { Write-Host "  （PATH 上沒有 codex）" }

# 1) winget 裝的 ------------------------------------------------------------
Say "winget"
$wingetIds = @()
try {
  $wingetIds = (& winget list --source winget 2>$null |
    Select-String -Pattern 'OpenAI\.Codex\S*' -AllMatches |
    ForEach-Object { $_.Matches.Value } | Select-Object -Unique)
} catch { }

if ($wingetIds.Count -gt 0) {
  foreach ($id in $wingetIds) {
    Plan "winget uninstall --id $id"
    if ($Apply) { & winget uninstall --id $id --silent }
  }
} else {
  Write-Host "  沒有找到 winget 裝的 codex"
}

# 2) Store / MSIX 包 ---------------------------------------------------------
# ⚠️ 這種不能刪資料夾。AppData\Local\Packages\OpenAI.Codex_xxxx 是系統管的，
#    直接 Remove-Item 會失敗，或留下一個註冊了但檔案不見的殘骸。
Say "Store / MSIX 套件"
$appx = @()
try { $appx = Get-AppxPackage -Name '*Codex*' -ErrorAction SilentlyContinue } catch { }

if ($appx) {
  foreach ($pkg in $appx) {
    Plan "Remove-AppxPackage $($pkg.PackageFullName)"
    if ($Apply) { Remove-AppxPackage -Package $pkg.PackageFullName }
  }
} else {
  Write-Host "  沒有找到 Store 安裝的 codex"
}

# 3) 直接解壓在使用者目錄底下的 ---------------------------------------------
# 原生安裝器會落在這兩個地方的其中一個（實測 DAREN 那台兩個都有，這正是問題來源）。
#
# ⚠️ 這一節會把嚮導「接回沙箱檔案」那顆按鈕接的 junction 一起帶走
#    （它就接在 Programs\OpenAI\Codex\ 底下，見 src/codex-sandbox.js）。那是對的：
#    整個安裝目錄都要重來，指回舊版本的連結留著只會是斷的。重裝完回嚮導再按一次
#    那顆，它的判準是「從連結那條路走得到 helper」，斷了就會自己變黃燈。
Say "使用者目錄底下的安裝"
$dirs = @(
  (Join-Path $env:LOCALAPPDATA 'Programs\OpenAI\Codex'),
  (Join-Path $env:LOCALAPPDATA 'OpenAI\Codex')
)

foreach ($dir in $dirs) {
  if (Test-Path $dir) {
    Plan "刪掉 $dir"
    if ($Apply) { Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction Continue }
  } else {
    Write-Host "  沒有 $dir"
  }
}

# 4) 使用者 PATH 裡指向那幾個目錄的項目 --------------------------------------
# 不清的話，PATH 上會留著指向已刪目錄的項目。不會壞事，但下次查問題時很誤導
# ——看起來像「裝了但叫不動」。
Say "使用者 PATH"
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$entries  = @()
if ($userPath) { $entries = $userPath.Split(';') | Where-Object { $_.Trim().Length -gt 0 } }
$stale = $entries | Where-Object { $_ -match 'OpenAI\\Codex' }

if ($stale) {
  foreach ($entry in $stale) { Plan "從使用者 PATH 移除 $entry" }
  if ($Apply) {
    $kept = $entries | Where-Object { $_ -notmatch 'OpenAI\\Codex' }
    [Environment]::SetEnvironmentVariable('Path', ($kept -join ';'), 'User')
  }
} else {
  Write-Host "  使用者 PATH 裡沒有指向 codex 的項目"
}

# 5) 沙箱快取 ----------------------------------------------------------------
# 這兩個是 codex 自己產的快取，不是他的設定：.sandbox 是 log，.sandbox-bin 是從安裝
# 目錄複製過來的 helper。安裝目錄都刪了，這裡留著舊版的複本只會混淆下一次診斷。
#
# ⚠️ 同一個 .codex 底下的其他東西（auth、config.toml、AGENTS.md、skills）一個都不動。
Say "沙箱快取（.codex 底下唯一會動的東西）"
foreach ($name in @('.sandbox', '.sandbox-bin')) {
  $cache = Join-Path $env:USERPROFILE ".codex\$name"
  if (Test-Path $cache) {
    Plan "刪掉快取 $cache"
    if ($Apply) { Remove-Item -LiteralPath $cache -Recurse -Force -ErrorAction Continue }
  } else {
    Write-Host "  沒有 $cache"
  }
}

# 6) 這支不處理的那幾種 ------------------------------------------------------
# 只講、不做。嚮導那兩顆按鈕的判準比這裡細（見檔頭的說明），在這裡再寫一次
# 只會有一天兩邊對不起來。
Say "這支不處理的（回嚮導按那兩顆）"
Write-Host "  npm 裝的舊版與孤兒 shim  →「清掉上一輪 npm 裝的舊版」那張卡"
Write-Host "  profile 裡指向死路徑的函式 →「清掉上一輪留下的舊捷徑」那張卡"
Write-Host ""
Write-Host "  ⚠️ 還有一種兩邊都不會自己動：npm 目錄裡有人手寫的包裝檔" -ForegroundColor Yellow
Write-Host "     （實測 peace 那台是 mycodex-wrapper.ps1，硬寫死了 npm 的舊路徑）。"
Write-Host "     它不是 npm 也不是嚮導產生的，裡面可能有他自己的邏輯，只能自己看："
Write-Host "     Get-ChildItem `"$env:APPDATA\npm`" -Filter *.ps1"

Say "保留不動"
Write-Host "  $env:USERPROFILE\.codex\  ← 登入憑證、config.toml、AGENTS.md、skills 全部留著"

if ($Apply) {
  Say "做完了，接下來"
  Write-Host "1. 關掉這個 PowerShell 視窗，開一個新的（PATH 改過了）"
  Write-Host "2. 確認執行檔清乾淨：where.exe codex  ← 應該什麼都不印"
  Write-Host "3. ⚠️ 確認沒有東西遮蔽它：Get-Command codex -All"
  Write-Host "   ← 這一行才看得到 function 與應用程式別名，where.exe 兩種都看不到"
  Write-Host "4. 完全關掉網頁嚮導，重新跑一次"
  Write-Host "5. 在 Codex CLI 那一列按「安裝」"
  Write-Host "6. 裝完按「重新檢查」，那一列轉綠再往下走"
} else {
  Say "確認清單沒問題的話"
  Write-Host "再跑一次，後面加 -Apply"
}
