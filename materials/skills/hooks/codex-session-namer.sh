#!/bin/bash
# Session auto-namer for Codex. Registered on two hook events:
#   UserPromptSubmit ("prompt" arg) → prompt#1: ask the model to name the
#     session from the user's first message
#   PostToolUse (no arg) → count=5: re-evaluate the name against the
#     conversation so far; every 10 calls after that: retry if no AI name landed
# Reads session_id from stdin JSON (Codex passes it to all hooks).
#
# Key relay files and counters by session_id. Codex 0.146+ runs hooks through
# one shared app-server, so $PPID is shared by concurrent sessions.
#
# Sandbox note: the Codex MODEL cannot write ~/.codex/state_*.sqlite or
# ~/.ai-session-names/ outside a trusted cwd ("attempt to write a readonly
# database"). Hooks run unsandboxed, so the model only writes the chosen name
# to a /tmp relay file (always writable); this hook applies it through the
# shared app-server, with SQLite and tab-sync compatibility fallbacks.

EVENT="${1:-tool}"
STDIN_JSON=$(cat)

SESSION_ID=$(echo "$STDIN_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('session_id',''))" 2>/dev/null || true)

HOOK_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
COUNTER_DIR="${CODEX_SESSION_NAMER_DIR:-/tmp/codex-session-namer}"
mkdir -p "$COUNTER_DIR"
KEY="${SESSION_ID:-$PPID}"
COUNTER_FILE="$COUNTER_DIR/$KEY"
DEFAULT_MARKER="$COUNTER_DIR/${KEY}.default"
RELAY_FILE="$COUNTER_DIR/${KEY}.pending"

apply_name() {
  local name="$1"
  local db esc updated
  local applied=false
  local app_server_applied=false
  if [ -n "$SESSION_ID" ] && python3 "$HOOK_DIR/codex-session-name-set.py" "$SESSION_ID" "$name" >/dev/null 2>&1; then
    app_server_applied=true
    applied=true
  fi
  if [ "$app_server_applied" = false ]; then
    db=$(ls -t "${CODEX_HOME:-$HOME/.codex}"/state_*.sqlite 2>/dev/null | head -1)
    if [ -n "$SESSION_ID" ] && [ -n "$db" ] && [ -f "$db" ]; then
      esc=${name//\'/\'\'}
      updated=$(sqlite3 "$db" "UPDATE threads SET name='${esc}', title='${esc}', preview='${esc}' WHERE id='${SESSION_ID}'; SELECT changes();" 2>/dev/null || true)
      case "$updated" in
        ''|*[!0-9]*) ;;
        *) [ "$updated" -gt 0 ] && applied=true ;;
      esac
    fi
  fi
  if [ -n "${AI_TAB_SYNC_FILE:-}" ]; then
    echo "$name" > "$AI_TAB_SYNC_FILE" 2>/dev/null || true
  fi
  [ "$applied" = true ]
}

# Apply a model-chosen name left in the relay file (sandbox-safe handoff).
# Runs on every hook event so chat-only sessions still get their name applied
# on the next prompt.
if [ -f "$RELAY_FILE" ]; then
  NAME=$(head -1 "$RELAY_FILE" | cut -c1-120)
  if [ -n "$NAME" ]; then
    if apply_name "$NAME"; then
      rm -f "$RELAY_FILE" "$DEFAULT_MARKER"
    fi
  else
    rm -f "$RELAY_FILE"
  fi
fi

emit_naming_request() { # $1=hookEventName  $2=lead-in instruction
  HOOK_EVENT="$1" LEAD_IN="$2" RELAY_FILE="$RELAY_FILE" python3 <<'PYEOF'
import json, os, sys

relay = os.environ["RELAY_FILE"]
ctx = (
    f"[session-namer] {os.environ['LEAD_IN']}\n\n"
    "命名規則：\n"
    "- 格式：{emoji} {中文敘述}，總長度 ≤ 40 字元，技術名詞保留英文\n"
    "- emoji 只能從這 8 個選：🏗️ build/implement/refactor、🔧 fix、🐛 debug、"
    "📐 plan/design、📋 review/audit、💬 discuss、⛴️ pilot/spike、🔍 research\n"
    "- 例外：skill 明確指定前綴時以 skill 為準（handoff 用 📦 標記「已交接」）\n"
    "- 根據對話「主要目的」命名，不是最新一句話\n\n"
    f"執行指令（只需這一步，hook 會自動同步 sidebar 與 terminal tab）：\n"
    f"mkdir -p /tmp/codex-session-namer && echo '{{名稱}}' > {relay}"
)
obj = {"hookSpecificOutput": {"hookEventName": os.environ["HOOK_EVENT"], "additionalContext": ctx}}
json.dump(obj, sys.stdout, ensure_ascii=False)
PYEOF
}

# UserPromptSubmit: name the session right after the user's first message
if [ "$EVENT" = "prompt" ]; then
  PROMPT_FILE="$COUNTER_DIR/${KEY}.prompts"
  PCOUNT=$(cat "$PROMPT_FILE" 2>/dev/null || echo 0)
  PCOUNT=$((PCOUNT + 1))
  echo "$PCOUNT" > "$PROMPT_FILE"
  if [ "$PCOUNT" -eq 1 ]; then
    touch "$DEFAULT_MARKER"
    emit_naming_request "UserPromptSubmit" "請依據用戶這句話的任務意圖為此 session 命名。"
  fi
  exit 0
fi

# PostToolUse: count tool calls
COUNT=$(cat "$COUNTER_FILE" 2>/dev/null || echo 0)
COUNT=$((COUNT + 1))
echo "$COUNT" > "$COUNTER_FILE"

if [ "$COUNT" -eq 5 ]; then
  # One-time re-evaluation now that there is real conversation to judge from
  emit_naming_request "PostToolUse" "請根據到目前為止的討論重新評估 session 名稱：若現有名稱仍準確，寫入原名稱即可；否則換更貼切的名字。"
elif [ "$COUNT" -gt 5 ] && [ $(( COUNT % 10 )) -eq 0 ] && [ -f "$DEFAULT_MARKER" ]; then
  emit_naming_request "PostToolUse" "此 session 尚未命名，請為它命名。"
fi
