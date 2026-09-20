#!/usr/bin/env bash
# ai-tab-sync.sh — universal terminal tab title syncer.
# Polls a sync file and writes OSC title escapes directly to the tty device,
# bypassing IDE stdout filtering (works in iTerm2 / Cursor / Antigravity).
# Usage: ai-tab-sync.sh <sync-file> <tty-path>

set -euo pipefail

SYNC_FILE="${1:?usage: ai-tab-sync.sh <sync-file> <tty-path>}"
TTY_PATH="${2:?usage: ai-tab-sync.sh <sync-file> <tty-path>}"

# Re-assert every poll, not just when the name changes. Claude Code writes its own
# summary title, and zsh's precmd resets the title to the cwd at every prompt — both
# overwrite us. Writing only on change means we set it once, get overwritten, and
# then see "unchanged" forever after, so the tab keeps someone else's title for the
# rest of the session (macOS VM, 2026-07-29). The .ps1 watcher already learned this
# and compares against the live console title; bash cannot read the title back, so
# unconditional re-assertion is the equivalent. One write per second is free.
while true; do
  if [ -f "$SYNC_FILE" ]; then
    title=$(cat "$SYNC_FILE" 2>/dev/null || true)
    if [ -n "$title" ]; then
      printf '\033]0;%s\007' "$title" > "$TTY_PATH" 2>/dev/null || true
      printf '\033]1;%s\007' "$title" > "$TTY_PATH" 2>/dev/null || true
      printf '\033]2;%s\007' "$title" > "$TTY_PATH" 2>/dev/null || true
    fi
  fi
  sleep 1
done
