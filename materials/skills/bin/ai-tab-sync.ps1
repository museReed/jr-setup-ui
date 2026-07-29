#!/usr/bin/env pwsh
# ai-tab-sync.ps1 — Windows counterpart of ai-tab-sync.sh.
# Polls a sync file and writes OSC title escapes to the shared console.
#
# Windows has no /dev/tty, so this cannot write to a tty device. The spike
# (docs/spikes/windows-tab-title) confirmed that a separate process attached to
# the same Windows Terminal console CAN retitle the foreground tab, so the
# macOS watcher architecture carries over — only the write mechanism changes.
#
# SetConsoleTitle, not OSC. Escape sequences travel in the output stream, and a
# full-screen TUI owning that stream swallows them: OSC worked in a plain shell
# but never reached the terminal while Codex was running. SetConsoleTitle is an
# API call on the shared console, so no renderer sits between us and the tab —
# and we stop injecting escape bytes into someone else's screen.
#
# Usage: ai-tab-sync.ps1 <sync-file> [<parent-pid>]

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$SyncFile,
  [int]$ParentPid = 0
)

# Best-effort throughout, like the bash version's `2>/dev/null || true`:
# a watcher that dies takes the tab title with it.
$ErrorActionPreference = 'Continue'

# No console-encoding setup needed: SetConsoleTitle takes a wide string, so CJK
# and emoji survive without touching the output stream's codepage.
$lastTitle = ''

while ($true) {
  # Start-Process children outlive their parent on Windows (no EXIT trap like
  # bash), so stop polling once the launcher we serve is gone.
  if ($ParentPid -gt 0 -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { break }

  if (Test-Path -LiteralPath $SyncFile) {
    $title = ''
    try { $title = [System.IO.File]::ReadAllText($SyncFile, [System.Text.Encoding]::UTF8).Trim() } catch {}
    # Compare against the live console title, not just $lastTitle. Codex (and
    # some terminal hosts) rewrite the title after we set it; tracking only our
    # own last write means we set it once, get overwritten, and see "unchanged"
    # forever after. Re-asserting each poll is what actually keeps the tab named
    # — and it is the one thing an event-driven IPC could not do.
    $consoleTitle = ''
    try { $consoleTitle = [Console]::Title } catch {}
    if ($title -and ($title -ne $lastTitle -or $title -ne $consoleTitle)) {
      try { [Console]::Title = $title } catch {}
      $lastTitle = $title
    }
  }
  Start-Sleep -Seconds 1
}
