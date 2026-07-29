#!/usr/bin/env pwsh
# diagnose-title-path.ps1 — 名字寫進檔案了，為什麼沒上到標題？
#
# 在終端視窗裡直接跑（不要接管線）：
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\diagnose-title-path.ps1
#
# ⚠ 要用「你平常開 claude 的那種視窗」跑，別加 -NoProfile 以外的東西——
#    ① 那格檢查的是 PowerShell profile 有沒有載入 wrapper，這支自己帶 -NoProfile
#    沒關係，它是去讀 profile 檔案內容，不是靠當前 session。
#
# 四格，前兩格看安裝、後兩格是關鍵對照：同一支腳本在「終端裡直接跑」和「輸出
# 被接走的子行程」兩種情況下，標題改不改得動。hook 永遠是後者。

$ErrorActionPreference = 'Continue'

if ([Console]::IsOutputRedirected) {
  Write-Host 'FAIL  輸出被導走了，這樣測不到標題。請直接在終端視窗裡跑。'
  exit 1
}

$setNamePath = Join-Path $HOME '.claude\hooks\set-session-name.ps1'
if (-not (Test-Path -LiteralPath $setNamePath)) {
  Write-Host "FAIL  找不到 $setNamePath，命名腳本沒裝。"
  exit 1
}

Write-Host '── ① wrapper 有沒有裝進 PowerShell profile ──'
$profilePath = Join-Path $HOME 'Documents\WindowsPowerShell\Microsoft.PowerShell_profile.ps1'
if (Test-Path -LiteralPath $profilePath) {
  $profileText = [System.IO.File]::ReadAllText($profilePath, [System.Text.Encoding]::UTF8)
  if ($profileText -match 'AI_TAB_SYNC_FILE') {
    Write-Host "  ✅ 有：$profilePath 裡有設 AI_TAB_SYNC_FILE 的 claude function"
  } else {
    Write-Host "  ❌ profile 在，但裡面沒有 wrapper（找不到 AI_TAB_SYNC_FILE）"
  }
} else {
  Write-Host "  ❌ 找不到 profile：$profilePath"
}

Write-Host ''
Write-Host '── ② watcher 腳本在不在 ──'
$watcherPath = Join-Path $HOME '.jr-setup\bin\ai-tab-sync.ps1'
if (Test-Path -LiteralPath $watcherPath) {
  Write-Host "  ✅ 有：$watcherPath"
} else {
  Write-Host "  ❌ 找不到：$watcherPath（wrapper 那條路等於斷了）"
}

$original = ''
try { $original = [Console]::Title } catch {}

Write-Host ''
Write-Host '── ③ 對照組：在這個終端裡「直接」跑命名腳本 ──'
& $setNamePath '🔧 直接跑的標題' 'diagnose-direct' | Out-Null
$answerDirect = Read-Host '  標題有變成「🔧 直接跑的標題」嗎？(y/n)'

Write-Host ''
Write-Host '── ④ 實驗組：用「輸出被接走的子行程」跑同一支（hook 就是這樣被叫的）──'
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = 'powershell.exe'
$psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$setNamePath`" '🐛 子行程的標題' 'diagnose-child'"
$psi.UseShellExecute = $false
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$child = [System.Diagnostics.Process]::Start($psi)
$child.StandardOutput.ReadToEnd() | Out-Null
$child.WaitForExit()
$answerChild = Read-Host '  標題有變成「🐛 子行程的標題」嗎？(y/n)'

if ($original) { try { [Console]::Title = $original } catch {} }

Write-Host ''
Write-Host '── ⑤ 結論 ──'
$okDirect = $answerDirect -match '^[yY]'
$okChild = $answerChild -match '^[yY]'

if ($okDirect -and $okChild) {
  Write-Host '  兩種情況都改得動 → 腳本沒問題，問題在它有沒有被叫到、或有沒有被蓋掉。'
} elseif ($okDirect -and -not $okChild) {
  Write-Host '  直接跑可以、子行程不行 → 這就是斷點。'
  Write-Host '  hook 永遠是子行程，所以「沒有 wrapper 就自己改標題」那條路走不通，'
  Write-Host '  標題只能靠 wrapper + watcher（watcher 活在終端裡，改得動）。'
} elseif (-not $okDirect) {
  Write-Host '  連直接跑都改不動 → 問題在命名腳本本身的寫標題那段，先修它。'
}
