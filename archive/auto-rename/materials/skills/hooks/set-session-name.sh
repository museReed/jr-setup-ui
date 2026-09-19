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
#
# 名字寫到哪裡，取決於這個 session 是不是背景 session：
#
#   背景 session（有 jobId）
#     只寫 ~/.claude/jobs/{jobId}/state.json。Claude Code 內部會 fs.watch 這個檔，
#     看到 nameSource:"user" 就把它收成自己的 session 名字，於是 statusline、TUI
#     名稱膠囊、tab 標題三處都由 native 用同一個名字畫出來。
#
#     ⚠️ 不要讓背景 session 自己去寫 tab：它跟「生它的那個互動 session」共用同一個
#     tab，兩邊搶著寫的結果是標題在兩個名字之間來回閃（macOS 實測，2026-08-19）。
#
#   互動 session（沒有 jobId）
#     維持原做法：寫名稱檔 + tab 標題。Claude Code 對互動 session 沒有任何外部改名
#     入口（只有啟動時的 --name / CLAUDE_CODE_SESSION_NAME 和人工 /rename），所以
#     statusline 和名稱膠囊會停在 Claude Code 自己取的名字，只有 tab 是我們的。
#     這是已知且接受的落差，不是同步沒做好。

NAME="$1"
[ -z "$NAME" ] && { echo "set-session-name: missing name arg" >&2; exit 1; }

# 校驗 emoji：模型有時會挑清單外的（實測看到 🎯）。改指示措辭只是拜託模型，
# 這裡才是最後一道關卡——不在清單裡就換成 🔍，名字其餘部分原樣保留。
#
# 📦 是第 9 個：handoff skill 用它標「已交接」。它原本不在清單裡，於是每次交接
# 完標題都被悄悄換成 🔍，而且腳本不出聲，看起來像改名整個沒生效（VM 實測，查了
# 三輪才找到）。命名 hook 那邊的指示仍然只給模型 8 個選，📦 是 skill 專用的。
#
# `[` 開頭代表名字已經帶了專案前綴，是既有名字被重新套用一次，emoji 早驗過了。
case "$NAME" in
  🏗️*|🔧*|🐛*|📐*|📋*|💬*|⛴️*|🔍*|📦*|\[*) ;;
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

# 專案前綴：AI 在跑的時候 TUI 蓋住 shell 提示字元，名字是唯一還看得出「這是哪個
# 專案」的地方。從工作目錄推導，git repo 根目錄優先。家目錄和 / 不算專案，不加。
project_tag() {
  dir="${CLAUDE_PROJECT_DIR:-$PWD}"
  root=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null)
  [ -n "$root" ] && dir="$root"
  case "$dir" in
    "$HOME" | / | "") return ;;
  esac
  basename "$dir"
}

case "$NAME" in
  \[*) ;;
  *)
    TAG=$(project_tag)
    [ -n "$TAG" ] && NAME="[$TAG] $NAME"
    ;;
esac

CLAUDE_PID="${2:-$PPID}"
TERMINAL_PID=$(ps -o ppid= -p "$CLAUDE_PID" 2>/dev/null | tr -d ' ')

# 這個 session 掛在哪個 job 底下？Claude Code 每個 process 都有一份記錄。
#
# ⚠️ 不要改用 $CLAUDE_JOB_DIR：那個環境變數只有「一開始就是背景」的 session 有，
# 先互動、之後才背景化的 session 有 jobId 卻沒有這個變數。
#
# 用 python3 而不是 jq：安裝流程沒有任何一步保證 jq 存在（codex 那幾支 hook 也是
# 這樣用 python3 的）。記錄不存在、JSON 壞掉、沒有 python3，三種情況都得到空字串
# → 走互動路徑，而不是整個壞掉。
JOB_ID=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('jobId') or '')" \
  ~/.claude/sessions/"${CLAUDE_PID}".json 2>/dev/null)

NAME_DIR=~/.claude/session-names
mkdir -p "$NAME_DIR"
echo "$NAME" > "$NAME_DIR/${TERMINAL_PID}".txt

# process 已經不在的名稱檔就刪掉，否則每關一個終端就留一個，永遠只增不減。
# ⚠️ 只用「process 還在不在」判斷，不要用 pid 長相判斷——背景 session 的名稱檔
# 掛在別的 pid 底下，那些也是活的。
for f in "$NAME_DIR"/*.txt; do
  [ -e "$f" ] || continue
  pid=$(basename "$f" .txt)
  case "$pid" in
    '' | *[!0-9]*) continue ;;
  esac
  kill -0 "$pid" 2>/dev/null || rm -f "$f"
done

if [ -n "$JOB_ID" ]; then
  # 背景：只寫 job state，顯示交給 native
  #
  # Claude Code 只在 nameSource 是 user / collision 時才採用 state.json 裡的 name；
  # auto / derived 是它自己推導的 slug，會被重新產生，所以兩個欄位都得寫。
  #
  # 第一次命名發生在第一句話，那一刻 daemon 可能還在建 state.json——所以等一下，
  # 不要第一次沒看到就放棄。上限約 2 秒：超過就是不會來了，命名不該卡住 session。
  JOB_STATE=~/.claude/jobs/"$JOB_ID"/state.json
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    [ -f "$JOB_STATE" ] && break
    sleep 0.2
  done

  # 先寫暫存檔再 os.replace，避免 daemon 剛好讀到寫到一半的 state.json。
  if [ -f "$JOB_STATE" ]; then
    python3 - "$JOB_STATE" "$NAME" <<'PY' 2>/dev/null
import json, os, sys

path, name = sys.argv[1], sys.argv[2]
with open(path) as f:
    state = json.load(f)
state["name"] = name
state["nameSource"] = "user"
tmp = f"{path}.namewrite.{os.getpid()}"
with open(tmp, "w") as f:
    json.dump(state, f, ensure_ascii=False, indent=2)
os.replace(tmp, path)
PY
  fi
elif [ -n "${AI_TAB_SYNC_FILE:-}" ]; then
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
