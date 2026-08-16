#!/bin/bash
# Session auto-namer for Codex. Registered on two hook events:
#   UserPromptSubmit ("prompt" arg) → prompt#1: ask the model to name the
#     session from the user's first message
#   PostToolUse (no arg) → count=5: re-evaluate the name against the
#     conversation so far; every 10 calls after that: retry if no AI name landed
# Reads session_id from stdin JSON (Codex passes it to all hooks).
#
# Sandbox note: the Codex MODEL cannot write ~/.codex/state_*.sqlite or
# ~/.ai-session-names/ outside a trusted cwd ("attempt to write a readonly
# database"). Hooks run unsandboxed, so the model only writes the chosen name
# to a /tmp relay file (always writable); this hook applies it to SQLite
# (sidebar name) + the tab-sync file on the next hook event.

EVENT="${1:-tool}"
STDIN_JSON=$(cat)

CODEX_PID=$PPID
COUNTER_DIR="/tmp/codex-session-namer"
mkdir -p "$COUNTER_DIR"
COUNTER_FILE="$COUNTER_DIR/$CODEX_PID"
DEFAULT_MARKER="$COUNTER_DIR/${CODEX_PID}.default"
RELAY_FILE="$COUNTER_DIR/${CODEX_PID}.pending"

SESSION_ID=$(echo "$STDIN_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('session_id',''))" 2>/dev/null || true)

# 分頁標題有兩條路，走得通哪一條就走哪一條。
#
# ⚠️ 原本只有第一條（sync 檔）。wrapper 沒起來時那條整個不存在，於是 sidebar 改到了、
# 分頁一動也不動，而且不出聲——學生看到的是「標題一直是那個奇怪的字」，完全聯想不到
# 是命名沒送達（jr-setup-feedback#8：Ghostty 分頁一直是 T，那是嚮導把驗證腳本寫在
# $TMPDIR、Ghostty 沒收到任何標題就拿目錄末段當標題）。
#
#   1. $AI_TAB_SYNC_FILE  mycodex wrapper 起的 watcher 每秒重寫一次，蓋得過別人
#   2. 直接寫控制終端      wrapper 沒起來時唯一的路（Ghostty 直接跑 .command、學生
#                          自己打 codex、VS Code 系終端都屬於這種）
#
# 形狀刻意抄 set-session-name.sh（Claude 那支）：有 wrapper 就讓 watcher 當家，沒有
# 才自己寫裝置。那個 if/else 已經在真機上活很久了，這裡沒有理由發明第二種。
# .ps1 那支也早就有第 2 條（[Console]::Title），而且註解就寫著「bash 版停在這裡，
# 所以純 codex 從來沒改到過分頁」——那句話在 bash 這邊放了很久沒補。
write_tab_title() {
  local name="$1"
  local candidate tty_dev

  if [ -n "${AI_TAB_SYNC_FILE:-}" ]; then
    # wrapper 在：watcher 擁有這個分頁，寫檔就好
    echo "$name" > "$AI_TAB_SYNC_FILE" 2>/dev/null || true
    return
  fi

  # 先問自己再問 codex：控制終端是繼承下來的，hook 自己這支通常就問得到，
  # 而 codex 那支在「hook 被包一層 shell 起來」時才是對的那個。
  for candidate in "$$" "$CODEX_PID"; do
    tty_dev=$(ps -o tty= -p "$candidate" 2>/dev/null | tr -d ' ')
    if [ -n "$tty_dev" ] && [ "$tty_dev" != "??" ] && [ -w "/dev/$tty_dev" ]; then
      # ⚠️ 一定要寫進裝置，不能寫 stdout——這支 hook 的 stdout 是 JSON 頻道，
      # 混進跳脫字元整包就解析不了。
      # 三個 OSC 都寫：0 是圖示＋標題、1 是分頁、2 是視窗，各家終端認的不一樣。
      printf '\033]0;%s\007\033]1;%s\007\033]2;%s\007' "$name" "$name" "$name" \
        > "/dev/$tty_dev" 2>/dev/null
      return
    fi
  done
}

apply_name() {
  local name="$1"
  local db esc
  db=$(ls -t "$HOME"/.codex/state_*.sqlite 2>/dev/null | head -1)
  if [ -n "$SESSION_ID" ] && [ -n "$db" ] && [ -f "$db" ]; then
    esc=${name//\'/\'\'}
    sqlite3 "$db" "UPDATE threads SET title='${esc}', preview='${esc}' WHERE id='${SESSION_ID}';" 2>/dev/null || true
  fi

  write_tab_title "$name"

  # 「名字真的套用上去了」的副產物。
  #
  # 沒有它的話，Codex 這一路的命名完全沒有程式抓得到的落點：sqlite 要知道 thread id
  # 才查得到、sync 檔是臨時的、relay 檔在套用當下就被刪掉。於是嚮導的驗證只能寫
  # 「請學生自己看標題」，壞掉時沒有任何一條測試會紅——這次就是這樣拖到學生開 issue。
  mkdir -p "$HOME/.ai-session-names" 2>/dev/null
  echo "$name" > "$HOME/.ai-session-names/${CODEX_PID}.txt" 2>/dev/null || true
}

# Apply a model-chosen name left in the relay file (sandbox-safe handoff).
# Runs on every hook event so chat-only sessions still get their name applied
# on the next prompt.
if [ -f "$RELAY_FILE" ]; then
  NAME=$(head -1 "$RELAY_FILE" | cut -c1-120)
  rm -f "$RELAY_FILE"
  if [ -n "$NAME" ]; then
    apply_name "$NAME"
    rm -f "$DEFAULT_MARKER"
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
    # ⚠️ 只給一條指令，不要 `mkdir -p … && echo …`。兩個理由：
    #   一、嚮導自己發給 Codex 的規矩（AGENTS.md）就是「一個 shell 呼叫只做一件事，
    #       不要用 && 串接」。注入一條違反自家規矩的指令，模型要嘛照做、要嘛自己拆，
    #       兩種都在賭。
    #   二、mkdir 本來就是多的——這支 hook 開頭已經 mkdir -p "$COUNTER_DIR" 了，
    #       模型跑到這一步時那個目錄一定在。
    f"執行指令（只需這一步，hook 會自動同步 sidebar 與 terminal tab）：\n"
    f"echo '{{名稱}}' > {relay}"
)
obj = {"hookSpecificOutput": {"hookEventName": os.environ["HOOK_EVENT"], "additionalContext": ctx}}
json.dump(obj, sys.stdout, ensure_ascii=False)
PYEOF
}

# UserPromptSubmit: name the session right after the user's first message
if [ "$EVENT" = "prompt" ]; then
  PROMPT_FILE="$COUNTER_DIR/${CODEX_PID}.prompts"
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
