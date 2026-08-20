#!/usr/bin/env powershell.exe
# Safely restart the shared Windows Codex app-server after every TUI is closed.

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'codex-app-server-common.ps1')

$preferredEndpoint = if ($env:CODEX_APP_SERVER_URL) {
  $env:CODEX_APP_SERVER_URL
} else {
  'ws://127.0.0.1:4500'
}
$realCodex = Get-JrRealCodexPath
if ($null -eq $realCodex) {
  Write-Error '找不到真正的 Codex 執行檔，請先重新安裝 Codex CLI。'
  exit 1
}
$currentVersion = Get-JrCodexVersion $realCodex

$mutex = New-Object System.Threading.Mutex($false, 'Local\jr-setup-ui-codex-app-server')
$locked = $false
try {
  try { $locked = $mutex.WaitOne(10000) } catch [System.Threading.AbandonedMutexException] { $locked = $true }
  if (-not $locked) { throw '等待 Codex app-server 啟動鎖逾時。' }

  $state = Read-JrAppServerState
  if (-not (Test-JrManagedState $state)) {
    $state = Get-JrLegacyState $currentVersion
  }

  if ($null -ne $state -and (Test-JrManagedState $state)) {
    $uri = [Uri]$state.endpoint
    $clients = @(Get-NetTCPConnection `
      -LocalPort $uri.Port `
      -State Established `
      -ErrorAction SilentlyContinue)
    if ($clients.Count -gt 0) {
      Write-Host "無法重啟：仍有 Codex 視窗連著背景 server（偵測到 $($clients.Count) 個連線）。"
      Write-Host '請先關閉所有 Codex 視窗，再開新的 PowerShell 視窗執行：'
      Write-Host 'codex-server-restart'
      exit 2
    }

    Stop-Process -Id ([int]$state.pid) -ErrorAction Stop
    foreach ($attempt in 1..30) {
      if ($null -eq (Get-Process -Id ([int]$state.pid) -ErrorAction SilentlyContinue)) { break }
      Start-Sleep -Milliseconds 100
    }
    if ($null -ne (Get-Process -Id ([int]$state.pid) -ErrorAction SilentlyContinue)) {
      throw "舊 Codex app-server（PID $($state.pid)）沒有停止；未啟動新 server。"
    }
  }

  Remove-Item -LiteralPath $script:JrStateFile -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $script:JrPidFile -Force -ErrorAction SilentlyContinue
  $newState = Start-JrAppServer $realCodex $currentVersion $preferredEndpoint
  Write-Host "Codex 背景 server 已更新至 $($currentVersion)。"
  Write-Host "連線位置：$($newState.endpoint)"
  Write-Host '現在可以重新執行 codex。'
  exit 0
} catch {
  Write-Error $_.Exception.Message
  exit 1
} finally {
  if ($locked) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
