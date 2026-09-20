#!/usr/bin/env pwsh
# session-auto-namer.ps1 — Windows counterpart of session-auto-namer.sh.
# Session auto-namer for Claude Code. Registered on two hook events:
#   UserPromptSubmit ("prompt" arg) → prompt#1: ask the model to name the
#     session from the user's first message
#   PostToolUse (no arg) → count=5: re-evaluate the name against the
#     conversation so far; every 10 calls after that: retry if no AI name landed
#
# Display paths (in priority order):
#   1. $env:AI_TAB_SYNC_FILE set (launched via the myclaude wrapper) → watcher
#      owns the tab
#   2. no wrapper → this hook refreshes the tab title by writing OSC to the
#      console device on every event. Requires
#      CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1 so the built-in title doesn't fight back.

[CmdletBinding()]
param([string]$EventName = 'tool')

$ErrorActionPreference = 'Continue'

function Get-ParentPid([int]$ProcessId) {
  if ($ProcessId -le 0) { return 0 }
  try {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop
    return [int]$p.ParentProcessId
  } catch { return 0 }
}

function Write-ConsoleTitle([string]$Text) {
  # SetConsoleTitle, not OSC — see set-session-name.ps1 for why: a hook's stdout
  # is a captured pipe, and OSC to \\.\CONOUT$ opens but retitles nothing (T5).
  # Writing the OSC fallback below into a captured stdout would also corrupt the
  # JSON this hook emits, so there is deliberately no stdout fallback here: a
  # missing title beats a corrupted hook payload.
  try { [Console]::Title = $Text } catch {}
}

function Read-Counter([string]$Path) {
  try { return [int]([System.IO.File]::ReadAllText($Path).Trim()) } catch { return 0 }
}

function Write-Counter([string]$Path, [int]$Value) {
  try { [System.IO.File]::WriteAllText($Path, "$Value") } catch {}
}

# The bash version reads $PPID, which Claude Code sets to itself. PowerShell has
# no $PPID, so walk one level up from this hook process. If Claude Code ever
# spawns hooks through an extra shell layer this lands one level short — that
# only misfiles the session-names record, it does not affect the tab title.
# Everything is keyed by Claude Code's own session_id, not a pid. VM testing
# showed Windows spawns each hook through a throwaway shell: the parent pid
# differs on every invocation and is already dead by the time a child script
# looks it up. That broke both the counters (a fresh file each event, so the
# count never reached 5) and the record file (unresolvable pid → every session
# writing to 0.txt). The bash version's $PPID has no working Windows analogue.
$stdinJson = ''
if ([Console]::IsInputRedirected) { $stdinJson = [Console]::In.ReadToEnd() }
$sessionId = ''
if ($stdinJson) {
  try { $sessionId = [string]($stdinJson | ConvertFrom-Json).session_id } catch {}
}
# Fall back to the pid chain if session_id is ever absent — degraded but no worse
# than before, and the key shape makes it obvious in the file listing which ran.
$sessionKey = if ($sessionId) { $sessionId -replace '[^A-Za-z0-9._-]', '_' } else { "pid-$(Get-ParentPid $PID)" }

$counterDir = Join-Path ([System.IO.Path]::GetTempPath()) 'claude-session-namer'
New-Item -ItemType Directory -Force -Path $counterDir | Out-Null

$sessionFile = Join-Path $HOME ".claude\session-names\$sessionKey.txt"
$defaultMarker = Join-Path $counterDir "$sessionKey.default"

# No-wrapper display path: refresh tab title from the saved name on every event.
# Claude Code strips ESC bytes from tool stdout, so OSC must go to the device.
if (-not $env:AI_TAB_SYNC_FILE) {
  if (Test-Path -LiteralPath $sessionFile) {
    $saved = ''
    try { $saved = [System.IO.File]::ReadAllText($sessionFile, [System.Text.Encoding]::UTF8).Trim() } catch {}
    if ($saved) { Write-ConsoleTitle $saved }
  }
}

# One wrapper script does all naming writes (tab-sync file / OSC + session-name
# file + default-marker cleanup), so one whitelist rule covers it. The session
# key is baked in literally — the model's shell cannot derive it.
# Call the bash shim, not the .ps1 directly. Claude Code refuses to honour an
# allowlist prefix for a command that starts another interpreter — verbatim:
# "Command spawns a nested PowerShell process which cannot be validated" — and the
# rule its "don't ask again" option writes bakes in the name and the session id,
# so it never matches the next session. Invoking a script directly is the shape
# macOS already proves an allowlist prefix accepts; the shim hides powershell
# inside itself. Forward slashes: bash eats \U \R in C:\Users\Reed as escapes.
$setNamePath = (Join-Path $HOME '.claude\hooks\set-session-name.sh') -replace '\\', '/'
# Quote only when the path contains a space (C:\Users\Reed Chen), otherwise bash
# splits it in two and the command never runs. No space means no quotes: that is
# the shape macOS has already proved an allowlist prefix accepts, so leave it be.
# namingAllowRule in config-install.js applies the same rule — the two must agree
# or the prefix never matches.
if ($setNamePath -match ' ') { $setNamePath = "`"$setNamePath`"" }
$writeCmd = "$setNamePath '{名稱}' '$sessionKey'"

$rules = @(
  '命名規則：'
  '- 格式：{emoji} {中文敘述}，emoji 取代英文動詞，技術名詞可保留英文'
  '- 總長度 ≤ 40 字元'
  '- emoji 只能從這 8 個選：🏗️ build/implement/refactor、🔧 fix、🐛 debug、📐 plan/design、📋 review/audit、💬 discuss、⛴️ pilot/spike、🔍 research'
  '- 例外：skill 明確指定前綴時以 skill 為準（handoff 用 📦 標記「已交接」）'
) -join "`n"

function Send-NamingRequest([string]$HookEventName, [string]$LeadIn) {
  $ctx = "[session-namer] $LeadIn`n`n$rules`n`n執行指令：`n$writeCmd"
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
    Send-NamingRequest 'UserPromptSubmit' '請依據用戶這句話的任務意圖為此 session 命名並寫入檔案。'
  }
  exit 0
}

# PostToolUse: count tool calls
$counterFile = Join-Path $counterDir "$sessionKey.tools"
$count = (Read-Counter $counterFile) + 1
Write-Counter $counterFile $count

if ($count -eq 5) {
  # One-time re-evaluation now that there is real conversation to judge from
  Send-NamingRequest 'PostToolUse' '請根據到目前為止的討論重新評估 session 名稱：若現有名稱仍準確，用原名稱再執行一次指令即可；否則換更貼切的名字。'
} elseif ($count -gt 5 -and ($count % 10) -eq 0 -and (Test-Path -LiteralPath $defaultMarker)) {
  Send-NamingRequest 'PostToolUse' '此 session 尚未命名，請為它命名並寫入檔案。'
}
