#!/bin/bash
# PostToolUse hook for Codex CLI: trigger handoff when context reaches 70%.
#
# Prefer real Codex token_count events from the current rollout JSONL:
#   - pct = latest last_token_usage.input_tokens / model_context_window
# Fallback when token_count is unavailable:
#   - Count tool calls per session_id; never share counts across sessions
#   - ~100 tool calls ≈ full context, so 70 calls ≈ 70%
#   - Require 3 consecutive token_count read failures to ignore transient gaps
#   - Repeat every 10 calls after the fallback threshold if not yet handed off
# Temporary small-context test mode: launch as
#   CODEX_TEST_MAX_CONTEXT_WINDOW=5000 codex
# to test handoff triggering. Unset = normal operation.

COUNTER_DIR="/tmp/codex-context-monitor"
mkdir -p "$COUNTER_DIR"
THRESHOLD_PCT=70
FALLBACK_FULL_TOOL_CALLS=100
FALLBACK_THRESHOLD=$((FALLBACK_FULL_TOOL_CALLS * THRESHOLD_PCT / 100))
FALLBACK_CONSECUTIVE_FAILURES=3
TEST_MAX_CONTEXT_WINDOW="${CODEX_TEST_MAX_CONTEXT_WINDOW:-}"

# Codex command hooks receive the current session metadata as JSON on stdin.
# Use that stable contract; CODEX_THREAD_ID is only a legacy fallback.
HOOK_META=$(python3 -c '
import json
import sys

try:
    payload = json.load(sys.stdin)
except (json.JSONDecodeError, TypeError):
    payload = {}

session_id = payload.get("session_id") or ""
transcript_path = payload.get("transcript_path") or ""
print(f"{session_id}\x1f{transcript_path}")
' 2>/dev/null || true)
HOOK_SESSION_ID=""
HOOK_TRANSCRIPT_PATH=""
IFS=$'\x1f' read -r HOOK_SESSION_ID HOOK_TRANSCRIPT_PATH <<EOF
$HOOK_META
EOF
SESSION_ID="${HOOK_SESSION_ID:-${CODEX_THREAD_ID:-}}"

STATE_SOURCE=""
if [ -n "$SESSION_ID" ]; then
  STATE_SOURCE="session:$SESSION_ID"
elif [ -n "$HOOK_TRANSCRIPT_PATH" ]; then
  STATE_SOURCE="transcript:$HOOK_TRANSCRIPT_PATH"
fi

STATE_KEY=""
if [ -n "$STATE_SOURCE" ]; then
  STATE_KEY=$(STATE_SOURCE="$STATE_SOURCE" python3 -c '
import hashlib
import os

print(hashlib.sha256(os.environ["STATE_SOURCE"].encode()).hexdigest()[:24])
')
fi

COUNTER_FILE=""
TOKEN_FAILURE_FILE=""
HANDOFF_MARKER=""
if [ -n "$STATE_KEY" ]; then
  HANDOFF_MARKER="$COUNTER_DIR/${STATE_KEY}.handoff"
fi
if [ -n "$SESSION_ID" ]; then
  COUNTER_FILE="$COUNTER_DIR/${STATE_KEY}.calls"
  TOKEN_FAILURE_FILE="$COUNTER_DIR/${STATE_KEY}.token-read-failures"
fi

# Already handed off — stop nagging
[ -n "$HANDOFF_MARKER" ] && [ -f "$HANDOFF_MARKER" ] && exit 0

# Read and increment the current session's counter. Without a session_id,
# token_count can still trigger but call-count fallback remains disabled.
COUNT=0
if [ -n "$COUNTER_FILE" ]; then
  COUNT=$(cat "$COUNTER_FILE" 2>/dev/null || echo 0)
  COUNT=$((COUNT + 1))
  echo "$COUNT" > "$COUNTER_FILE"
fi

ROLLOUT_PATH=""
if [ -n "$HOOK_TRANSCRIPT_PATH" ] && [ -f "$HOOK_TRANSCRIPT_PATH" ]; then
  ROLLOUT_PATH="$HOOK_TRANSCRIPT_PATH"
elif [ -n "$SESSION_ID" ] && command -v sqlite3 >/dev/null 2>&1; then
  CODEX_DB=$(ls -t "$HOME"/.codex/state_*.sqlite 2>/dev/null | head -1)
  if [ -n "$CODEX_DB" ]; then
    SAFE_SESSION_ID=${SESSION_ID//\'/\'\'}
    ROLLOUT_PATH=$(sqlite3 "$CODEX_DB" "SELECT rollout_path FROM threads WHERE id='${SAFE_SESSION_ID}' LIMIT 1;" 2>/dev/null || true)
  fi
fi

if [ -z "$ROLLOUT_PATH" ] || [ ! -f "$ROLLOUT_PATH" ]; then
  # Missing exact session metadata degrades to the per-session call counter.
  # Never guess the newest rollout: concurrent sessions make that unsafe.
  ROLLOUT_PATH=""
fi

PCT=""
INPUT_TOKENS=""
MAX_CONTEXT=""
if [ -n "$ROLLOUT_PATH" ] && [ -f "$ROLLOUT_PATH" ]; then
  TOKEN_INFO=$(ROLLOUT_PATH="$ROLLOUT_PATH" TEST_MAX_CONTEXT_WINDOW="$TEST_MAX_CONTEXT_WINDOW" python3 - <<'PYEOF'
from collections import deque
import json
import os
import sys

best = None
path = os.environ.get("ROLLOUT_PATH")
try:
    with open(path, encoding="utf-8") as fh:
        lines = deque(fh, maxlen=200)
except OSError:
    lines = []

for line in lines:
    try:
        event = json.loads(line)
    except json.JSONDecodeError:
        continue
    payload = event.get("payload") or {}
    if payload.get("type") != "token_count":
        continue
    info = payload.get("info") or {}
    last = info.get("last_token_usage") or {}
    input_tokens = int(last.get("input_tokens") or 0)
    max_context = int(info.get("model_context_window") or 0)
    test_max_context = os.environ.get("TEST_MAX_CONTEXT_WINDOW")
    if test_max_context:
        max_context = int(test_max_context)
    if input_tokens > 0 and max_context > 0:
        best = (input_tokens, max_context)

if best:
    input_tokens, max_context = best
    pct = input_tokens * 100 // max_context
    print(f"{pct} {input_tokens} {max_context}")
PYEOF
)
  if [ -n "$TOKEN_INFO" ]; then
    read -r PCT INPUT_TOKENS MAX_CONTEXT <<EOF
$TOKEN_INFO
EOF
  fi
fi

TOKEN_READ_FAILURES=0
if [ -n "$PCT" ]; then
  [ -n "$TOKEN_FAILURE_FILE" ] && rm -f "$TOKEN_FAILURE_FILE"
elif [ -n "$TOKEN_FAILURE_FILE" ]; then
  TOKEN_READ_FAILURES=$(cat "$TOKEN_FAILURE_FILE" 2>/dev/null || echo 0)
  TOKEN_READ_FAILURES=$((TOKEN_READ_FAILURES + 1))
  echo "$TOKEN_READ_FAILURES" > "$TOKEN_FAILURE_FILE"
fi

TRIGGER_REASON=""
if [ -n "$PCT" ] && [ "$PCT" -ge "$THRESHOLD_PCT" ] 2>/dev/null; then
  if [ -n "$TEST_MAX_CONTEXT_WINDOW" ]; then
    TRIGGER_REASON="測試模式：Context 以小視窗 ${MAX_CONTEXT} 計算，已用約 ${PCT}%（${INPUT_TOKENS}/${MAX_CONTEXT} input tokens），已達 ${THRESHOLD_PCT}% 門檻。"
  else
    TRIGGER_REASON="Context 已用約 ${PCT}%（${INPUT_TOKENS}/${MAX_CONTEXT} input tokens），已達 ${THRESHOLD_PCT}% 門檻。"
  fi
elif [ -z "$PCT" ] && [ -n "$SESSION_ID" ] && [ "$COUNT" -ge "$FALLBACK_THRESHOLD" ] && [ "$TOKEN_READ_FAILURES" -ge "$FALLBACK_CONSECUTIVE_FAILURES" ] && { [ "$COUNT" -eq "$FALLBACK_THRESHOLD" ] || [ "$TOKEN_READ_FAILURES" -eq "$FALLBACK_CONSECUTIVE_FAILURES" ] || [ $(( (COUNT - FALLBACK_THRESHOLD) % 10 )) -eq 0 ]; }; then
  TRIGGER_REASON="連續 ${TOKEN_READ_FAILURES} 次無法讀取 Codex token_count，改用工具呼叫數估算：${COUNT}/${FALLBACK_FULL_TOOL_CALLS}，約達 ${THRESHOLD_PCT}% 門檻。"
fi

if [ -n "$TRIGGER_REASON" ]; then
  python3 <<PYEOF
import json
ctx = "[context-monitor] ${TRIGGER_REASON} 請立即觸發 \$handoff skill：Read and follow .agents/skills/handoff/SKILL.md（repo 有的話優先）或 ~/.agents/skills/handoff/SKILL.md 寫交接文件。\n\n重要：寫完 handoff 並 commit 後，必須把 session 改名為 📦 {topic}（按 SKILL.md Step 5a 執行）。\n\n全部完成後執行：touch ${HANDOFF_MARKER}"
obj = {"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": ctx}}
json.dump(obj, __import__('sys').stdout, ensure_ascii=False)
PYEOF
fi
