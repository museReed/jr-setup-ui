#!/usr/bin/env pwsh
# codex-session-namer.ps1 — Windows counterpart of codex-session-namer.sh.
# Session auto-namer for Codex. Registered on two hook events:
#   UserPromptSubmit ("prompt" arg) → prompt#1: ask the model to name the
#     session from the user's first message
#   PostToolUse (no arg) → count=5: re-evaluate the name against the
#     conversation so far; every 10 calls after that: retry if no AI name landed
# Reads session_id from stdin JSON (Codex passes it to all hooks).
#
# The model writes the chosen name to a temp relay file. On the next hook event,
# this script sends thread/name/set to the shared Codex app-server. Codex then
# updates its own sidebar, status line, and terminal title from one native event.

[CmdletBinding()]
param([string]$EventName = 'tool')

$ErrorActionPreference = 'Continue'
$stdinJson = ''
if ([Console]::IsInputRedirected) { $stdinJson = [Console]::In.ReadToEnd() }

function Get-ParentPid([int]$ProcessId) {
  if ($ProcessId -le 0) { return 0 }
  try {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop
    return [int]$p.ParentProcessId
  } catch { return 0 }
}

function Read-Counter([string]$Path) {
  try { return [int]([System.IO.File]::ReadAllText($Path).Trim()) } catch { return 0 }
}

function Write-Counter([string]$Path, [int]$Value) {
  try { [System.IO.File]::WriteAllText($Path, "$Value") } catch {}
}

$sessionId = ''
if ($stdinJson) {
  try { $sessionId = [string]($stdinJson | ConvertFrom-Json).session_id } catch {}
}

# Keyed by session_id, not pid — same reason as session-auto-namer.ps1: Windows
# spawns each hook under a throwaway shell whose pid differs every invocation.
# The relay file is the sharp edge here: the model writes the path one hook run
# handed it, and the next run looked for a different filename, so the name was
# never picked up.
$sessionKey = if ($sessionId) { $sessionId -replace '[^A-Za-z0-9._-]', '_' } else { "pid-$(Get-ParentPid $PID)" }
$counterDir = Join-Path ([System.IO.Path]::GetTempPath()) 'codex-session-namer'
New-Item -ItemType Directory -Force -Path $counterDir | Out-Null
$counterFile = Join-Path $counterDir "$sessionKey.tools"
$defaultMarker = Join-Path $counterDir "$sessionKey.default"
$relayFile = Join-Path $counterDir "$sessionKey.pending"

function Set-SessionName([string]$Name) {
  if (-not $sessionId) { return $false }
  $helper = Join-Path $PSScriptRoot 'codex-session-name-set.ps1'
  if (-not (Test-Path -LiteralPath $helper)) { return $false }
  try {
    & $helper -ThreadId $sessionId -Name $Name
    return $true
  } catch {
    return $false
  }
}

# Apply a model-chosen name left in the relay file (sandbox-safe handoff).
# Runs on every hook event so chat-only sessions still get their name applied
# on the next prompt.
if (Test-Path -LiteralPath $relayFile) {
  $name = ''
  try {
    $text = [System.IO.File]::ReadAllText($relayFile, [System.Text.Encoding]::UTF8)
    $name = ($text -split "`r?`n")[0].Trim()
    if ($name.Length -gt 120) { $name = $name.Substring(0, 120) }
  } catch {}
  if ($name -and (Set-SessionName $name)) {
    Remove-Item -LiteralPath $relayFile -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $defaultMarker -Force -ErrorAction SilentlyContinue
  }
}

$relayCmd = "Set-Content -LiteralPath '$relayFile' -Value '{名稱}' -Encoding utf8"

$rules = @(
  '命名規則：'
  '- 格式：{emoji} {中文敘述}，總長度 ≤ 40 字元，技術名詞保留英文'
  '- emoji 只能從這 8 個選：🏗️ build/implement/refactor、🔧 fix、🐛 debug、📐 plan/design、📋 review/audit、💬 discuss、⛴️ pilot/spike、🔍 research'
  '- 例外：skill 明確指定前綴時以 skill 為準（handoff 用 📦 標記「已交接」）'
  '- 根據對話「主要目的」命名，不是最新一句話'
) -join "`n"

function Send-NamingRequest([string]$HookEventName, [string]$LeadIn) {
  $ctx = "[session-namer] $LeadIn`n`n$rules`n`n執行指令（只需這一步，hook 會自動同步 sidebar 與 terminal tab）：`n$relayCmd"
  $json = @{ hookSpecificOutput = @{ hookEventName = $HookEventName; additionalContext = $ctx } } |
          ConvertTo-Json -Depth 5 -Compress
  # Write bytes directly: PowerShell 7 emits raw UTF-8 while 5.1 escapes
  # non-ASCII, and the default stdout encoding differs between them.
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $stdout = [Console]::OpenStandardOutput()
  $stdout.Write($bytes, 0, $bytes.Length)
  $stdout.Flush()
}

# UserPromptSubmit: name the session right after the user's first message
if ($EventName -eq 'prompt') {
  $promptFile = Join-Path $counterDir "$sessionKey.prompts"
  $pcount = (Read-Counter $promptFile) + 1
  Write-Counter $promptFile $pcount
  if ($pcount -eq 1) {
    New-Item -ItemType File -Force -Path $defaultMarker | Out-Null
    Send-NamingRequest 'UserPromptSubmit' '請依據用戶這句話的任務意圖為此 session 命名。'
  }
  exit 0
}

# PostToolUse: count tool calls
$count = (Read-Counter $counterFile) + 1
Write-Counter $counterFile $count

if ($count -eq 5) {
  # One-time re-evaluation now that there is real conversation to judge from
  Send-NamingRequest 'PostToolUse' '請根據到目前為止的討論重新評估 session 名稱：若現有名稱仍準確，寫入原名稱即可；否則換更貼切的名字。'
} elseif ($count -gt 5 -and ($count % 10) -eq 0 -and (Test-Path -LiteralPath $defaultMarker)) {
  Send-NamingRequest 'PostToolUse' '此 session 尚未命名，請為它命名。'
}
