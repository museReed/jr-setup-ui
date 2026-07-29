#!/usr/bin/env pwsh
# set-session-name.ps1 — Windows counterpart of set-session-name.sh.
# Single entry point for session naming, called by both:
#   - session-auto-namer.ps1 (hook-injected WRITE_CMD)
#   - auto-rename skill (manual /auto-rename)
#
# Usage: set-session-name.ps1 '{emoji} {name}' '<session-key>'
#
# The session key is Claude Code's session_id, baked into the command the hook
# injects. It keys the record file and the default marker. Windows pids cannot
# do this job: each hook runs under a throwaway shell whose pid differs every
# time and is dead by the time this script looks it up (VM testing), which
# collapsed every session onto a single 0.txt.
#
# Manual /auto-rename has no session_id to pass, so it falls back to the pid
# chain. The tab title never depends on either — that goes through
# SetConsoleTitle — so the fallback only affects which record file is written.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Name,
  [string]$SessionKey = ''
)

$ErrorActionPreference = 'Continue'

# Validate the emoji: the model sometimes picks one outside the list (VM sighting:
# 🎯). Rewording the instruction only asks it nicely — this is the last gate.
# Anything else becomes 🔍; the rest of the name is left alone.
$allowedEmoji = @([char]::ConvertFromUtf32(0x1F3D7), [char]::ConvertFromUtf32(0x1F527),
  [char]::ConvertFromUtf32(0x1F41B), [char]::ConvertFromUtf32(0x1F4D0),
  [char]::ConvertFromUtf32(0x1F4CB), [char]::ConvertFromUtf32(0x1F4AC),
  [char]::ConvertFromUtf32(0x26F4), [char]::ConvertFromUtf32(0x1F50D))
if (-not ($allowedEmoji | Where-Object { $Name.StartsWith($_) })) {
  $rest = if ($Name -match '^\S+\s+(.*)$') { $Matches[1] } else { $Name }
  $Name = "$([char]::ConvertFromUtf32(0x1F50D)) $rest"
}
$utf8 = New-Object System.Text.UTF8Encoding $false

function Get-ParentPid([int]$ProcessId) {
  if ($ProcessId -le 0) { return 0 }
  try {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop
    return [int]$p.ParentProcessId
  } catch { return 0 }
}

function Write-ConsoleTitle([string]$Text) {
  # SetConsoleTitle, not OSC. A hook's stdout is a pipe Claude Code captures, so
  # OSC written there never reaches the terminal — and VM verification (T5)
  # showed OSC written to the \\.\CONOUT$ device opens fine but retitles nothing.
  # [Console]::Title goes through SetConsoleTitle instead, which bypasses stdout
  # entirely and works cross-process (spike TEST 1/4).
  try { [Console]::Title = $Text; return } catch {}
  # Fallback for hosts without a console title (stdout must be the console).
  try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}
  try { [Console]::Write(([char]27) + "]0;$Text" + ([char]7)) } catch {}
}

if ($SessionKey) {
  $key = $SessionKey -replace '[^A-Za-z0-9._-]', '_'
} else {
  # Manual /auto-rename: no session_id available, walk the pid chain instead.
  # Never key on a bare 0 — an unresolvable pid would make every session share
  # one record file and clobber each other.
  $agentPid = Get-ParentPid $PID
  $terminalPid = Get-ParentPid $agentPid
  $key = if ($terminalPid -gt 0) { "pid-$terminalPid" } else { "unresolved-$PID" }
}

$namesDir = Join-Path $HOME '.claude\session-names'
New-Item -ItemType Directory -Force -Path $namesDir | Out-Null
[System.IO.File]::WriteAllText((Join-Path $namesDir "$key.txt"), $Name, $utf8)

if ($env:AI_TAB_SYNC_FILE) {
  # myclaude wrapper: watcher owns the tab, just write the sync file
  try { [System.IO.File]::WriteAllText($env:AI_TAB_SYNC_FILE, $Name, $utf8) } catch {}
} else {
  # no wrapper: write OSC title straight to the console device
  Write-ConsoleTitle $Name
}

$marker = Join-Path ([System.IO.Path]::GetTempPath()) "claude-session-namer\$key.default"
Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue
