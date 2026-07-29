#!/usr/bin/env pwsh
# probe-wt-title.ps1 — 這台機器的終端，標題到底改不改得動？
#
# 在「你要驗的那個終端視窗裡」直接跑（不要用管線接走輸出，那樣就不是終端了）：
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\probe-wt-title.ps1
#
# 分兩個問題問清楚：
#   1. Windows Terminal 的設定有沒有把應用程式標題鎖住（suppressApplicationTitle / tabTitle）
#   2. 兩種改標題的手法（SetConsoleTitle / OSC escape）在這個視窗實際有沒有效
# 只讀設定，不改任何檔案。

$ErrorActionPreference = 'Continue'

if ([Console]::IsOutputRedirected) {
  Write-Host 'FAIL  輸出被導走了，這樣測不到標題。請直接在終端視窗裡跑，不要接管線或 > 檔案。'
  exit 1
}

function Read-Jsonc([string]$Path) {
  # WT 的 settings.json 是 JSONC，有註解，直接 ConvertFrom-Json 會炸。
  # 這裡只是要讀兩個值，去掉註解的盡力版就夠——讀不到就當「不知道」，不會弄壞東西。
  try {
    $text = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
    $text = [regex]::Replace($text, '/\*.*?\*/', '', 'Singleline')
    $text = [regex]::Replace($text, '(?m)^\s*//.*$', '')
    return $text | ConvertFrom-Json
  } catch { return $null }
}

Write-Host '── ① 這是什麼終端 ──'
if ($env:WT_SESSION) {
  Write-Host '  Windows Terminal（有 WT_SESSION）'
} else {
  Write-Host '  不是 Windows Terminal（可能是 conhost / PowerShell 直接開的視窗）'
}

Write-Host ''
Write-Host '── ② Windows Terminal 設定有沒有鎖住標題 ──'
$candidates = @(
  (Join-Path $env:LOCALAPPDATA 'Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json'),
  (Join-Path $env:LOCALAPPDATA 'Packages\Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe\LocalState\settings.json'),
  (Join-Path $env:LOCALAPPDATA 'Microsoft\Windows Terminal\settings.json')
)
$settingsPath = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

if (-not $settingsPath) {
  Write-Host '  找不到 settings.json，下面幾個位置都沒有：'
  foreach ($candidate in $candidates) { Write-Host "    $candidate" }
} else {
  Write-Host "  設定檔：$settingsPath"
  $settings = Read-Jsonc $settingsPath
  if (-not $settings) {
    Write-Host '  解不開（可能有這支腳本沒處理到的 JSONC 寫法）——無法判定，往下看實測結果就好。'
  } else {
    # defaults 是底、個別 profile 會蓋過去，兩層都要看。
    $layers = @(@{ name = 'profiles.defaults'; node = $settings.profiles.defaults })
    foreach ($profile in @($settings.profiles.list)) {
      $label = if ($profile.name) { $profile.name } else { $profile.guid }
      $layers += @{ name = "profile「$label」"; node = $profile }
    }

    $locked = $false
    foreach ($layer in $layers) {
      $node = $layer.node
      if (-not $node) { continue }
      if ($node.suppressApplicationTitle -eq $true) {
        Write-Host "  ⚠ $($layer.name)：suppressApplicationTitle = true（標題被鎖住）"
        $locked = $true
      }
      if ($node.tabTitle) {
        Write-Host "  ⚠ $($layer.name)：tabTitle = 「$($node.tabTitle)」（標題被釘死）"
        $locked = $true
      }
    }
    if (-not $locked) { Write-Host '  兩個 key 都乾淨，設定上沒有鎖住標題。' }
  }
}

$original = ''
try { $original = [Console]::Title } catch {}

Write-Host ''
Write-Host '── ③ 實測：手法 A — SetConsoleTitle（set-session-name.ps1 用的就是這個）──'
try { [Console]::Title = '🐛 PROBE-A 標題測試' } catch { Write-Host "  丟例外：$_" }
Write-Host '  現在看你的視窗／分頁標題。'
$answerA = Read-Host '  有變成「🐛 PROBE-A 標題測試」嗎？(y/n)'

Write-Host ''
Write-Host '── ④ 實測：手法 B — OSC escape（寫到 stdout）──'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}
[Console]::Write(([char]27) + ']0;🔧 PROBE-B 標題測試' + ([char]7))
Write-Host '  再看一次標題。'
$answerB = Read-Host '  有變成「🔧 PROBE-B 標題測試」嗎？(y/n)'

if ($original) { try { [Console]::Title = $original } catch {} }

Write-Host ''
Write-Host '── ⑤ 結論 ──'
$okA = $answerA -match '^[yY]'
$okB = $answerB -match '^[yY]'
if ($okA -or $okB) {
  $works = @()
  if ($okA) { $works += 'SetConsoleTitle' }
  if ($okB) { $works += 'OSC' }
  Write-Host "  這個視窗可以改標題，有效手法：$($works -join ' / ')"
  if (-not $okA) {
    Write-Host '  ⚠ 但 SetConsoleTitle 無效——現行 set-session-name.ps1 用的正是它，得改走 OSC。'
  }
} else {
  Write-Host '  兩種手法都無效。若②顯示設定鎖住標題，那就是原因；'
  Write-Host '  否則問題在這個終端本身，驗證要改開別的視窗。'
}
