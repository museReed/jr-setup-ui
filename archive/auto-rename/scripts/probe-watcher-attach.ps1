#!/usr/bin/env pwsh
# probe-watcher-attach.ps1 — 子行程要怎麼起，才改得動「你這個分頁」的標題？
#
# 在終端視窗裡直接跑（不要接管線）：
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\probe-watcher-attach.ps1
#
# watcher 用 [Console]::Title 改標題，而那個 API 作用在「自己所在的 console」。
# 所以能不能改到你的分頁，取決於子行程有沒有跟你共用同一個 console。三種起法
# 各試一次，看哪一種有效。

$ErrorActionPreference = 'Continue'

if ([Console]::IsOutputRedirected) {
  Write-Host 'FAIL  輸出被導走了，這樣測不到標題。請直接在終端視窗裡跑。'
  exit 1
}

$original = ''
try { $original = [Console]::Title } catch {}

# 子行程只做一件事：設標題後停一下，讓你來得及看。
function Start-TitleSetter([string]$Title, [switch]$NoNewWindow, [switch]$Hidden) {
  $inner = "[Console]::Title = '$Title'; Start-Sleep -Seconds 3"
  # 不能叫 $args——那是 PowerShell 的自動變數，指派給它會踩到函式自己的參數陣列。
  $psArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $inner)
  if ($NoNewWindow) {
    return Start-Process powershell.exe -ArgumentList $psArgs -NoNewWindow -PassThru
  }
  if ($Hidden) {
    return Start-Process powershell.exe -ArgumentList $psArgs -WindowStyle Hidden -PassThru
  }
  return Start-Process powershell.exe -ArgumentList $psArgs -PassThru
}

Write-Host '── A. 現行做法：Start-Process -WindowStyle Hidden ──'
(Start-TitleSetter '🅰 Hidden 起的子行程' -Hidden).WaitForExit()
$okA = (Read-Host '  標題有變成「🅰 Hidden 起的子行程」嗎？(y/n)') -match '^[yY]'

try { [Console]::Title = $original } catch {}

Write-Host ''
Write-Host '── B. 提案做法：Start-Process -NoNewWindow（共用同一個 console）──'
(Start-TitleSetter '🅱 NoNewWindow 起的子行程' -NoNewWindow).WaitForExit()
$okB = (Read-Host '  標題有變成「🅱 NoNewWindow 起的子行程」嗎？(y/n)') -match '^[yY]'

if ($original) { try { [Console]::Title = $original } catch {} }

Write-Host ''
Write-Host '── 結論 ──'
if ($okB -and -not $okA) {
  Write-Host '  照預期：Hidden 會開新 console 所以改不到，NoNewWindow 共用 console 才有效。'
  Write-Host '  → wrapper 起 watcher 的參數從 -WindowStyle Hidden 換成 -NoNewWindow。'
} elseif ($okA -and $okB) {
  Write-Host '  兩種都有效 → 起法不是斷點，要往 watcher 有沒有真的活著、有沒有讀到 sync 檔查。'
} elseif (-not $okA -and -not $okB) {
  Write-Host '  兩種都無效 → 子行程一律改不動這個終端的標題，watcher 架構本身要換'
  Write-Host '    （例如改由 wrapper 自己在每次回合後讀 sync 檔設標題）。'
} else {
  Write-Host '  只有 Hidden 有效，跟預期相反 → 別動，先把這個結果記下來再想。'
}
