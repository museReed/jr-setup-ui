#!/bin/bash
# Session auto-namer for Claude Code. Registered on two hook events:
#   UserPromptSubmit ("prompt" arg) → prompt#1: ask the model to name the
#     session from the user's first message
#   PostToolUse (no arg) → count=5: re-evaluate the name against the
#     conversation so far; every 10 calls after that: retry if no AI name landed
#
# Display paths (in priority order):
#   1. $AI_TAB_SYNC_FILE set (launched via myclaude wrapper) → watcher owns the tab
#   2. no wrapper → this hook refreshes the tab title by writing OSC directly to
#      the controlling tty on every event. Requires
#      CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1 so the built-in title doesn't fight back.

EVENT="${1:-tool}"

# hook payload 帶著這個 session 的 id，一路傳給 set-session-name.sh 去留下 breadcrumb
# ——那是背景 session 之後找回「顯示我的那個 tab」的唯一線索（它掛在 daemon 底下，沒有
# tty，也沒有自己的 watcher）。stdin 要在所有其他讀取之前吃掉；解析失敗就留空，命名退回
# 舊的 pid-only 行為。
PAYLOAD=$(cat)
SESSION_ID=$(printf '%s' "$PAYLOAD" |
  python3 -c "import json,sys;print(json.load(sys.stdin).get('session_id') or '')" 2>/dev/null)

CLAUDE_PID=$PPID
COUNTER_DIR="/tmp/claude-session-namer"
mkdir -p "$COUNTER_DIR"

# Terminal shell PID (claude's parent) keys the session-name file
TERMINAL_PID=$(ps -o ppid= -p "$CLAUDE_PID" 2>/dev/null | tr -d ' ')
NAMES_DIR="$HOME/.claude/session-names"
SESSION_FILE="$NAMES_DIR/${TERMINAL_PID}.txt"
DEFAULT_MARKER="$COUNTER_DIR/${CLAUDE_PID}.default"

# No-wrapper display path: refresh tab title from saved name on every event.
# Newer Claude Code strips ESC bytes from tool stdout, so OSC must go straight
# to the tty device.
if [ -z "${AI_TAB_SYNC_FILE:-}" ]; then
  TTY_DEV=$(ps -o tty= -p "$CLAUDE_PID" 2>/dev/null | tr -d ' ')
  if [ -n "$TTY_DEV" ] && [ "$TTY_DEV" != "??" ] && [ -w "/dev/$TTY_DEV" ] && [ -r "$SESSION_FILE" ]; then
    printf '\033]0;%s\007' "$(cat "$SESSION_FILE")" > "/dev/$TTY_DEV" 2>/dev/null
  fi
fi

# One wrapper script does all naming writes (tab-sync file / OSC + session-name
# file + default-marker cleanup) — no && chain (block-chained-bash won't fire),
# and one whitelist rule covers it. Pass the hook's own CLAUDE_PID literally; it
# must NOT be re-expanded as $PPID in the AI's Bash-tool shell, which can sit one
# process layer deeper → off-by-one → the name lands in the wrong session-name file.
WRITE_CMD="$HOME/.claude/hooks/set-session-name.sh '{名稱}' ${CLAUDE_PID} ${SESSION_ID}"

RULES="命名規則：\n- 格式：{emoji} {中文敘述}，emoji 取代英文動詞，技術名詞可保留英文\n- 總長度 ≤ 40 字元\n- emoji 只能從這 8 個選：🏗️ build/implement/refactor、🔧 fix、🐛 debug、📐 plan/design、📋 review/audit、💬 discuss、⛴️ pilot/spike、🔍 research\n- 例外：skill 明確指定前綴時以 skill 為準（handoff 用 📦 標記「已交接」）"

emit_naming_request() { # $1=hookEventName  $2=lead-in instruction
  cat <<EOF
{"hookSpecificOutput":{"hookEventName":"$1","additionalContext":"[session-namer] $2\n\n${RULES}\n\n執行指令：\n${WRITE_CMD}"}}
EOF
}

# UserPromptSubmit: name the session right after the user's first message
if [ "$EVENT" = "prompt" ]; then
  PROMPT_FILE="$COUNTER_DIR/${CLAUDE_PID}.prompts"
  PCOUNT=$(cat "$PROMPT_FILE" 2>/dev/null || echo 0)
  PCOUNT=$((PCOUNT + 1))
  echo "$PCOUNT" > "$PROMPT_FILE"
  if [ "$PCOUNT" -eq 1 ]; then
    touch "$DEFAULT_MARKER"
    emit_naming_request "UserPromptSubmit" "請依據用戶這句話的任務意圖為此 session 命名並寫入檔案。"
  fi
  exit 0
fi

# PostToolUse: count tool calls
COUNTER_FILE="$COUNTER_DIR/$CLAUDE_PID"
COUNT=$(cat "$COUNTER_FILE" 2>/dev/null || echo 0)
COUNT=$((COUNT + 1))
echo "$COUNT" > "$COUNTER_FILE"

if [ "$COUNT" -eq 5 ]; then
  # One-time re-evaluation now that there is real conversation to judge from
  emit_naming_request "PostToolUse" "請根據到目前為止的討論重新評估 session 名稱：若現有名稱仍準確，用原名稱再執行一次指令即可；否則換更貼切的名字。"
elif [ "$COUNT" -gt 5 ] && [ $(( COUNT % 10 )) -eq 0 ] && [ -f "$DEFAULT_MARKER" ]; then
  emit_naming_request "PostToolUse" "此 session 尚未命名，請為它命名並寫入檔案。"
fi
