#!/usr/bin/env powershell.exe
# Safely restart the shared Windows Codex app-server after every TUI is closed.

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$endpoint = if ($env:CODEX_APP_SERVER_URL) { $env:CODEX_APP_SERVER_URL } else { 'ws://127.0.0.1:4500' }
$uri = [Uri]$endpoint

if ($uri.Scheme -ne 'ws' -or $uri.Host -notin @('127.0.0.1', 'localhost', '::1')) {
  Write-Error "只會重啟本機 Codex app-server：$endpoint"
  exit 1
}

function Get-RealCodexPath {
  $candidates = @(Get-Command codex -CommandType Application -All -ErrorAction SilentlyContinue |
    Where-Object { Test-Path -LiteralPath $_.Source -PathType Leaf })
  $native = @($candidates | Where-Object {
    [System.IO.Path]::GetExtension($_.Source) -in @('.exe', '.com')
  } | ForEach-Object { $_.Source })
  if ($native.Count -gt 0) { return $native[0] }
  $all = @($candidates | ForEach-Object { $_.Source })
  if ($all.Count -gt 0) { return $all[0] }
  return $null
}

function Test-AppServerReady {
  try {
    $response = Invoke-WebRequest `
      -Uri "http://$($uri.Host):$($uri.Port)/readyz" `
      -UseBasicParsing `
      -TimeoutSec 1
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

$realCodex = Get-RealCodexPath
if ($null -eq $realCodex) {
  Write-Error '找不到真正的 Codex 執行檔，請先重新安裝 Codex CLI。'
  exit 1
}

$controlDir = Join-Path $HOME '.codex\app-server-control'
$pidFile = Join-Path $controlDir 'windows-app-server.pid'
$listener = @(Get-NetTCPConnection `
  -LocalPort $uri.Port `
  -State Listen `
  -ErrorAction SilentlyContinue | Select-Object -First 1)

if ($listener.Count -gt 0) {
  $serverPid = [int]$listener[0].OwningProcess
  $knownPid = if (Test-Path -LiteralPath $pidFile) {
    (Get-Content -LiteralPath $pidFile -Raw -ErrorAction SilentlyContinue).Trim()
  } else { '' }
  $server = Get-CimInstance Win32_Process -Filter "ProcessId = $serverPid" -ErrorAction SilentlyContinue
  $looksLikeCodex = $server.Name -in @('codex.exe', 'codex') -and (
    $knownPid -eq [string]$serverPid -or $server.CommandLine -match 'app-server'
  )

  if (-not $looksLikeCodex) {
    Write-Error "連接埠 $($uri.Port) 不是由 jr-setup-ui 啟動的 Codex app-server 使用；不會停止 PID $serverPid。"
    exit 1
  }

  $clients = @(Get-NetTCPConnection `
    -LocalPort $uri.Port `
    -State Established `
    -ErrorAction SilentlyContinue)
  if ($clients.Count -gt 0) {
    Write-Host "無法重啟：仍有 $($clients.Count) 個 Codex 視窗連著背景 server。"
    Write-Host '請先關閉所有 Codex 視窗，再開新的 PowerShell 視窗執行：'
    Write-Host 'codex-server-restart'
    exit 2
  }

  Stop-Process -Id $serverPid -ErrorAction Stop
  foreach ($attempt in 1..30) {
    if ($null -eq (Get-Process -Id $serverPid -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 100
  }
  if ($null -ne (Get-Process -Id $serverPid -ErrorAction SilentlyContinue)) {
    Write-Error "舊 Codex app-server（PID $serverPid）沒有停止；未啟動新 server。"
    exit 1
  }
}

New-Item -ItemType Directory -Force -Path $controlDir | Out-Null
$stdout = Join-Path $controlDir 'windows-app-server.out.log'
$stderr = Join-Path $controlDir 'windows-app-server.err.log'
$process = Start-Process -FilePath $realCodex `
  -ArgumentList @('app-server', '--listen', $endpoint) `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdout `
  -RedirectStandardError $stderr `
  -PassThru
[System.IO.File]::WriteAllText($pidFile, "$($process.Id)")

foreach ($attempt in 1..50) {
  if (Test-AppServerReady) {
    $version = (& $realCodex --version 2>$null | Select-Object -First 1)
    Write-Host "Codex 背景 server 已更新至 $version。"
    Write-Host '現在可以重新執行 codex。'
    exit 0
  }
  if ($process.HasExited) { break }
  Start-Sleep -Milliseconds 100
}

Write-Error "新版 Codex app-server 沒有成功啟動，請查看：$stderr"
exit 1
