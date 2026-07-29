#!/bin/bash
# Single entry point for session naming, called by both:
#   - session-auto-namer.sh (hook-injected WRITE_CMD)
#   - auto-rename skill (manual /auto-rename)
#
# Whitelisting `Bash(.../set-session-name.sh:*)` covers every naming write in one
# rule — the echo/rm/printf/ps inside run as script internals, not re-checked by
# Claude's per-command permission layer.
#
# Usage: set-session-name.sh '{emoji} {name}' "$PPID"
#
# PID semantics: the caller MUST pass its own $PPID as arg 2. The original inline
# commands ran directly in Claude's Bash-tool shell where $PPID = Claude process.
# Wrapping the logic in this script adds a process layer, so the script's own
# $PPID would be the calling shell, not Claude — off by one level. So the caller
# expands "$PPID" in its shell and passes it in; we only fall back to our own
# $PPID if omitted.

NAME="$1"
[ -z "$NAME" ] && { echo "set-session-name: missing name arg" >&2; exit 1; }

# 校驗 emoji：模型有時會挑清單外的（實測看到 🎯）。改指示措辭只是拜託模型，
# 這裡才是最後一道關卡——不在清單裡就換成 🔍，名字其餘部分原樣保留。
case "$NAME" in
  🏗️*|🔧*|🐛*|📐*|📋*|💬*|⛴️*|🔍*) ;;
  *)
    # 只有「開頭那個 token 看起來是 emoji」時才把它換掉，否則會把真正的第一個
    # 詞吃掉（實測：「完全沒有 emoji」變成「🔍 emoji」）。判準用字元數：emoji
    # 最多兩個字元（本體 + variation selector），中文詞一般更長。
    first=${NAME%% *}
    if [ "$first" != "$NAME" ] && [ ${#first} -le 2 ]; then
      NAME="🔍 ${NAME#* }"
    else
      NAME="🔍 $NAME"
    fi
    ;;
esac

CLAUDE_PID="${2:-$PPID}"
TERMINAL_PID=$(ps -o ppid= -p "$CLAUDE_PID" 2>/dev/null | tr -d ' ')

mkdir -p ~/.claude/session-names
echo "$NAME" > ~/.claude/session-names/"${TERMINAL_PID}".txt

if [ -n "${AI_TAB_SYNC_FILE:-}" ]; then
  # myclaude wrapper: watcher owns the tab, just write the sync file
  echo "$NAME" > "$AI_TAB_SYNC_FILE"
else
  # no wrapper: write OSC title straight to the controlling tty
  # (Claude Code strips ESC from tool stdout, so it must go to the device)
  TTY_DEV=$(ps -o tty= -p "$CLAUDE_PID" 2>/dev/null | tr -d ' ')
  if [ -n "$TTY_DEV" ] && [ "$TTY_DEV" != "??" ] && [ -w "/dev/$TTY_DEV" ]; then
    printf '\033]0;%s\007' "$NAME" > "/dev/$TTY_DEV" 2>/dev/null
  fi
fi

rm -f "/tmp/claude-session-namer/${CLAUDE_PID}.default"
