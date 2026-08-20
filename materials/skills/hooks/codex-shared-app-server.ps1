#!/usr/bin/env powershell.exe
# PowerShell profile entry point for one shared Codex app-server on Windows.

[CmdletBinding()]
param([Parameter(ValueFromRemainingArguments = $true)][object[]]$InvocationArgs)

$ErrorActionPreference = 'Stop'
$endpoint = if ($env:CODEX_APP_SERVER_URL) { $env:CODEX_APP_SERVER_URL } else { 'ws://127.0.0.1:4500' }
$nonInteractive = @(
  'exec', 'review', 'login', 'logout', 'mcp', 'plugin', 'mcp-server',
  'app-server', 'remote-control', 'app', 'completion', 'update', 'doctor',
  'sandbox', 'debug', 'apply', 'archive', 'delete', 'migrate-rollouts',
  'unarchive', 'cloud', 'exec-server', 'features', 'help'
)

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

function Test-AppServerReady([string]$Url) {
  try {
    $uri = [Uri]$Url
    if ($uri.Scheme -notin @('ws', 'wss')) { return $false }
    $scheme = if ($uri.Scheme -eq 'wss') { 'https' } else { 'http' }
    $health = "${scheme}://$($uri.Host):$($uri.Port)/readyz"
    $response = Invoke-WebRequest -Uri $health -UseBasicParsing -TimeoutSec 1
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Ensure-AppServer([string]$CodexPath, [string]$Url) {
  if (Test-AppServerReady $Url) { return }

  $uri = [Uri]$Url
  $loopbackHost = $uri.Host -in @('127.0.0.1', 'localhost', '::1')
  if ($uri.Scheme -ne 'ws' -or -not $loopbackHost) {
    throw "CODEX_APP_SERVER_URL must be a loopback ws:// address for automatic startup: $Url"
  }

  $mutexName = "Local\jr-setup-ui-codex-app-server-$($uri.Port)"
  $mutex = New-Object System.Threading.Mutex($false, $mutexName)
  $locked = $false
  try {
    try { $locked = $mutex.WaitOne(10000) } catch [System.Threading.AbandonedMutexException] { $locked = $true }
    if (-not $locked) { throw 'Timed out waiting for the Codex app-server startup lock.' }
    if (Test-AppServerReady $Url) { return }

    $logDir = Join-Path $HOME '.codex\app-server-control'
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    $stdout = Join-Path $logDir 'windows-app-server.out.log'
    $stderr = Join-Path $logDir 'windows-app-server.err.log'
    $process = Start-Process -FilePath $CodexPath `
      -ArgumentList @('app-server', '--listen', $Url) `
      -WindowStyle Hidden `
      -RedirectStandardOutput $stdout `
      -RedirectStandardError $stderr `
      -PassThru
    [System.IO.File]::WriteAllText((Join-Path $logDir 'windows-app-server.pid'), "$($process.Id)")

    foreach ($attempt in 1..50) {
      if (Test-AppServerReady $Url) { return }
      if ($process.HasExited) { break }
      Start-Sleep -Milliseconds 100
    }
    throw "Codex app-server did not become ready. See $stderr"
  } finally {
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
  }
}

$realCodex = Get-RealCodexPath
if ($null -eq $realCodex) {
  Write-Error 'Could not find the real Codex executable on PATH.'
  exit 1
}

$argsAsStrings = @($InvocationArgs | ForEach-Object { [string]$_ })
$bypass = $argsAsStrings | Where-Object {
  $_ -in $nonInteractive -or $_ -in @('-V', '--version', '-h', '--help', '--remote')
}
if ($bypass) {
  & $realCodex @InvocationArgs
  exit $LASTEXITCODE
}

try {
  Ensure-AppServer $realCodex $endpoint
} catch {
  Write-Error $_.Exception.Message
  exit 1
}

& $realCodex --remote $endpoint @InvocationArgs
exit $LASTEXITCODE
