# 把這台機器上所有的 codex「程式」移除，好讓網頁嚮導重裝一份乾淨的。
#
#   先看不動：  powershell -ExecutionPolicy Bypass -File .\reset-codex-install.ps1
#   真的移除：  powershell -ExecutionPolicy Bypass -File .\reset-codex-install.ps1 -Apply
#
# ⚠️ 不碰 ~\.codex —— 那裡面是登入憑證、AGENTS.md、config.toml，都是他自己的東西。
#    刪掉的話要重跑一次 device flow 登入，還會弄丟他寫的規則。移除的是程式，不是設定。
#
# 為什麼要整批移除：同一台機器上有兩份以上不同版本的 codex，卻共用同一個 ~\.codex
# 狀態目錄。新版寫進去的值舊版讀不懂（service_tier = "default"、reasoning effort =
# "max"），而舊版的安裝目錄裡沒有新版要用的 sandbox helper。一個一個修設定值是打
# 地鼠——把程式清成一份才是解。
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
$found = & where.exe codex 2>$null
if ($found) { $found | ForEach-Object { Write-Host "  $_" } }
else        { Write-Host "  （PATH 上沒有 codex）" }

# 1) npm 全域裝的 ------------------------------------------------------------
# 判準是問 npm 本人，不是看路徑猜——原生安裝器裝的那份也可能落在看起來很像 npm 的
# 目錄底下。
Say "npm 全域"
$npmHasCodex = $false
try {
  $listed = & npm ls -g --depth=0 --json 2>$null | Out-String
  # 套件不在時 npm 會回非零，但 JSON 照樣印得出來，所以看內容不看 exit code。
  $deps = ($listed | ConvertFrom-Json).dependencies
  $npmHasCodex = $null -ne $deps.'@openai/codex'
} catch { $npmHasCodex = $false }

if ($npmHasCodex) {
  Plan "npm uninstall -g @openai/codex"
  if ($Apply) { & npm uninstall -g '@openai/codex' }
} else {
  Write-Host "  沒有（npm 說它沒裝 @openai/codex）"
}

# 2) winget 裝的 -------------------------------------------------------------
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

# 3) Store / MSIX 包 ---------------------------------------------------------
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

# 4) 直接解壓在使用者目錄底下的 ---------------------------------------------
# 原生安裝器會落在這兩個地方的其中一個（實測 DAREN 那台兩個都有，這正是問題來源）。
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

# 5) 使用者 PATH 裡指向那幾個目錄的項目 --------------------------------------
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

# 6) 沙箱快取 ----------------------------------------------------------------
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

Say "保留不動"
Write-Host "  $env:USERPROFILE\.codex\  ← 登入憑證、config.toml、AGENTS.md、skills 全部留著"

if ($Apply) {
  Say "做完了，接下來"
  Write-Host "1. 關掉這個 PowerShell 視窗，開一個新的（PATH 改過了）"
  Write-Host "2. 確認真的清乾淨：where.exe codex  ← 應該什麼都不印"
  Write-Host "3. 完全關掉網頁嚮導，重新跑一次"
  Write-Host "4. 在 Codex CLI 那一列按「安裝」"
  Write-Host "5. 裝完按「重新檢查」，那一列轉綠再往下走"
} else {
  Say "確認清單沒問題的話"
  Write-Host "再跑一次，後面加 -Apply"
}
