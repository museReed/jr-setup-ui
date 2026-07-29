#!/usr/bin/env bash
# ai-tab-sync.sh — universal terminal tab title syncer.
# Polls a sync file and writes OSC title escapes directly to the tty device,
# bypassing IDE stdout filtering (works in iTerm2 / Cursor / Antigravity).
# Usage: ai-tab-sync.sh <sync-file> <tty-path>

set -euo pipefail

SYNC_FILE="${1:?usage: ai-tab-sync.sh <sync-file> <tty-path>}"
TTY_PATH="${2:?usage: ai-tab-sync.sh <sync-file> <tty-path>}"

last_title=""

while true; do
  if [ -f "$SYNC_FILE" ]; then
    title=$(cat "$SYNC_FILE" 2>/dev/null || true)
    if [ -n "$title" ] && [ "$title" != "$last_title" ]; then
      printf '\033]0;%s\007' "$title" > "$TTY_PATH" 2>/dev/null || true
      printf '\033]1;%s\007' "$title" > "$TTY_PATH" 2>/dev/null || true
      printf '\033]2;%s\007' "$title" > "$TTY_PATH" 2>/dev/null || true
      last_title="$title"
    fi
  fi
  sleep 1
done
