#!/usr/bin/env powershell.exe
# PowerShell profile entry point for one shared, versioned Codex app-server.

[CmdletBinding()]
param([Parameter(ValueFromRemainingArguments = $true)][object[]]$InvocationArgs)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'codex-app-server-common.ps1')

$preferredEndpoint = if ($env:CODEX_APP_SERVER_URL) {
  $env:CODEX_APP_SERVER_URL
} else {
  'ws://127.0.0.1:4500'
}
$nonInteractive = @(
  'exec', 'review', 'login', 'logout', 'mcp', 'plugin', 'mcp-server',
  'app-server', 'remote-control', 'app', 'completion', 'update', 'doctor',
  'sandbox', 'debug', 'apply', 'archive', 'delete', 'migrate-rollouts',
  'unarchive', 'cloud', 'exec-server', 'features', 'help'
)

function Invoke-NativeCodex(
  [string]$CodexPath,
  [object[]]$Arguments,
  [switch]$DisableAutoRename
) {
  $previousDisabled = $env:JR_CODEX_AUTO_RENAME_DISABLED
  if ($DisableAutoRename) { $env:JR_CODEX_AUTO_RENAME_DISABLED = '1' }
  try {
    & $CodexPath @Arguments
    $script:NativeExitCode = $LASTEXITCODE
  } finally {
    $env:JR_CODEX_AUTO_RENAME_DISABLED = $previousDisabled
  }
}

$realCodex = Get-JrRealCodexPath
if ($null -eq $realCodex) {
  Write-Error '找不到真正的 Codex 執行檔，請先重新安裝 Codex CLI。'
  exit 1
}

$argsAsStrings = @($InvocationArgs | ForEach-Object { [string]$_ })
$bypass = $argsAsStrings | Where-Object {
  $_ -in $nonInteractive -or $_ -in @('-V', '--version', '-h', '--help', '--remote')
}
if ($bypass) {
  Invoke-NativeCodex $realCodex $InvocationArgs
  exit $script:NativeExitCode
}

$currentVersion = Get-JrCodexVersion $realCodex
try {
  $state = Get-JrAppServer $realCodex $currentVersion $preferredEndpoint
} catch {
  Write-Warning "Codex 共用 app-server 無法啟動：$($_.Exception.Message)"
  Write-Warning '本次改用原生模式；Codex 可正常使用，auto-rename 暫停。'
  Invoke-NativeCodex $realCodex $InvocationArgs -DisableAutoRename
  exit $script:NativeExitCode
}

if ([string]$state.codexVersion -ne $currentVersion) {
  Write-Warning "Codex 已更新至 $($currentVersion)，但背景 server 仍是 $($state.codexVersion)。"
  Write-Warning '現有 Codex 視窗不會被中斷；本次改用原生模式，auto-rename 暫停。'
  Write-Host '請先關閉所有 Codex 視窗，再開新的 PowerShell 視窗執行：'
  Write-Host 'codex-server-restart'
  Invoke-NativeCodex $realCodex $InvocationArgs -DisableAutoRename
  exit $script:NativeExitCode
}

$previousEndpoint = $env:CODEX_APP_SERVER_URL
$env:CODEX_APP_SERVER_URL = [string]$state.endpoint
try {
  & $realCodex --remote $state.endpoint @InvocationArgs
  $exitCode = $LASTEXITCODE
} finally {
  $env:CODEX_APP_SERVER_URL = $previousEndpoint
}
exit $exitCode
