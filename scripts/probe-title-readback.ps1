#!/usr/bin/env pwsh
# probe-title-readback.ps1 — 合併卡的 Windows 那一半到底成不成立？
#
# 要回答的問題只有一個：**claude 結束之後，在同一個 console 裡讀回 [Console]::Title，
# 拿到的是不是分頁上真的那一串。** 是的話，合併卡在 Windows 上可以用程式判定「標題
# 真的變了」，不必只靠學生的眼睛。
#
# 在「你要驗的那個終端視窗裡」直接跑（不要接管線，那樣就不是終端了）：
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\probe-title-readback.ps1
#
# ⚠️ 這支只讀不改：跑完會把原本的標題設回去，不碰 profile、不碰任何設定檔。
#
# 為什麼「讀回來的值」跟「分頁上的字」可能不一樣：
# [Console]::Title 的 getter 讀的是 console 自己的狀態。Windows Terminal 若設了
# suppressApplicationTitle 或 tabTitle，分頁上顯示的是 WT 決定的字，而 getter 仍然
# 回我們寫進去的那一串——那就是一個會騙人的綠燈。所以 ③ 一定要有人用眼睛回答。

$ErrorActionPreference = 'Continue'

if ([Console]::IsOutputRedirected) {
  Write-Host 'FAIL  輸出被導走了，這樣測不到標題。請直接在終端視窗裡跑，不要接管線或 > 檔案。'
  exit 1
}

# 要測的機制是 watcher→SetConsoleTitle→getter 這條鏈，跟「有沒有寫進 shell profile」
# 無關——所以嚮導沒裝過也能跑：退回 repo 裡的原始檔就好。乾淨的 VM 上這是常態，
# 為了跑一支探針先走完整段安裝（Node、Claude Code、登入）不划算。
$watcher = Join-Path $HOME '.jr-setup\bin\ai-tab-sync.ps1'
$source = 'installed'
if (-not (Test-Path -LiteralPath $watcher)) {
  $watcher = Join-Path $PSScriptRoot '..\materials\skills\bin\ai-tab-sync.ps1'
  $source = 'repo'
}
if (-not (Test-Path -LiteralPath $watcher)) {
  Write-Host "FAIL  找不到 watcher，這兩個位置都沒有："
  Write-Host "        $HOME\.jr-setup\bin\ai-tab-sync.ps1（嚮導裝的）"
  Write-Host "        $PSScriptRoot\..\materials\skills\bin\ai-tab-sync.ps1（repo 裡的）"
  Write-Host '      請在 repo 根目錄底下跑這支，或先在嚮導裡把那張卡裝好。'
  exit 1
}
Write-Host "用的 watcher：$watcher（$source）"

$original = ''
try { $original = [Console]::Title } catch {}

# 第一段刻意不叫 claude：要驗的機制是 watcher→SetConsoleTitle→getter 這條鏈，
# 夾一個 LLM 進來只會讓失敗多一個可能原因，而且要多等一分鐘。
$expected = '🐛 PROBE 讀回測試'
$syncFile = Join-Path ([System.IO.Path]::GetTempPath()) "jr-probe-readback-$PID.txt"

Write-Host '── ① 照 wrapper 的方式起一支 watcher ──'
# -NoNewWindow 是關鍵：watcher 用 [Console]::Title 改的是「它自己所在的 console」。
# 開新視窗的話它改到自己的標題，這裡永遠讀不到（config-install.js 那段註解記過）。
[System.IO.File]::WriteAllText($syncFile, $expected, [System.Text.Encoding]::UTF8)
$proc = Start-Process powershell.exe `
  -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $watcher, $syncFile, "$PID") `
  -NoNewWindow -PassThru
Write-Host "  watcher PID：$($proc.Id)，同步檔：$syncFile"
Write-Host "  餵給它的名字：$expected"

Write-Host ''
Write-Host '── ② 等 watcher 寫標題，然後讀回來 ──'
# watcher 每秒輪詢一次，給它三輪的餘裕。
Start-Sleep -Seconds 3
$readBack = ''
try { $readBack = [Console]::Title } catch { Write-Host "  getter 丟例外：$_" }
Write-Host "  [Console]::Title 讀回來 = 「$readBack」"
$matched = $readBack -eq $expected
if ($matched) {
  Write-Host '  ✓ 跟餵進去的字串一致'
} else {
  Write-Host '  ✗ 對不上——watcher 沒寫成功，或這個 console 的 getter 讀不到真值'
}

Write-Host ''
Write-Host '── ③ 用眼睛看：分頁上現在是什麼 ──'
Write-Host '  ⚠️ 這一問不能跳過。讀回來對了、分頁上卻是別的字，就是那種會騙人的綠燈。'
$eye = Read-Host "  你的視窗／分頁標題現在是「$expected」嗎？(y/n)"
$eyeOk = $eye -match '^[yY]'

Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $syncFile -Force -ErrorAction SilentlyContinue

Write-Host ''
Write-Host '── ④ 順帶看一眼：watcher 收掉之後標題還在嗎 ──'
# 合併卡的驗證是在 claude 結束、wrapper 的 finally 把 watcher 殺掉之後才讀回的，
# 所以「watcher 死了標題還留著」是那個設計的前提。
Start-Sleep -Seconds 1
$afterKill = ''
try { $afterKill = [Console]::Title } catch {}
Write-Host "  watcher 收掉之後讀回 = 「$afterKill」"
$survives = $afterKill -eq $expected
if ($survives) {
  Write-Host '  ✓ 標題留著——可以在 claude 結束之後才讀'
} else {
  Write-Host '  ✗ 標題被還原了——那就得改成「claude 還在跑的時候讀」，設計要跟著改'
}

if ($original) { try { [Console]::Title = $original } catch {} }

Write-Host ''
Write-Host '── ⑤ 結論 ──'
if ($matched -and $eyeOk -and $survives) {
  Write-Host '  PASS  三項都過：合併卡的 Windows 那一半可以用程式判定標題。'
  Write-Host '        下一步是把讀回那一行接到 verify-in-terminal.mjs 的 naming case 尾巴。'
  exit 0
}

Write-Host '  FAIL  以下這幾項沒過：'
if (-not $matched)  { Write-Host '        ② 讀回來的值對不上——先跑 scripts\probe-wt-title.ps1 確認這個視窗改不改得動標題' }
if (-not $eyeOk)    { Write-Host '        ③ 分頁上不是那一串——多半是 WT 的 suppressApplicationTitle / tabTitle 鎖住了，程式判定會說謊，Windows 要退回人眼' }
if (-not $survives) { Write-Host '        ④ watcher 一死標題就沒了——讀回的時機要移到 claude 還在跑的時候' }
exit 1
