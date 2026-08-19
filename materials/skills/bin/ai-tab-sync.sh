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
# 生我的那個 shell 還在嗎？.zshrc 的包裝函式會在 claude 結束後 kill 掉 watcher，但終端
# 被直接關掉時 zsh 收到 SIGHUP 就沒了，那行 kill 沒機會跑——watcher 於是變成孤兒繼續每秒
# 寫標題，直到重開機。而 macOS 的 /dev/ttysNNN 號碼會回收，新分頁拿到舊號碼就同時被舊
# watcher 和自己的 watcher 搶著寫，畫面上是標題在兩個名字之間每秒閃爍（2026-08-19 實測：
# 一台機器累積了 8 個孤兒，其中 3 個同時在寫 /dev/ttys001）。
#
# 判準用「自己的 ppid 變成 1」——孤兒會被 launchd 收養。不用開場記下父 pid 再比對：pid
# 會被回收，父行程早就沒了卻剛好有新行程頂到同一個號碼時，比對會誤判成「父行程還活著」。
orphaned() {
  [ "$(ps -o ppid= -p $$ 2>/dev/null | tr -d ' ')" = "1" ]
}

while true; do
  if orphaned; then
    exit 0
  fi
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
