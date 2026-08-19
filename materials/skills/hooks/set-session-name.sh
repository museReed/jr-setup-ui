#!/bin/bash
# Single entry point for session naming, called by both:
#   - session-auto-namer.sh (hook-injected WRITE_CMD)
#   - auto-rename / handoff skills
#
# Whitelisting `Bash(.../set-session-name.sh:*)` covers every naming write in one
# rule — the echo/rm/printf/ps inside run as script internals, not re-checked by
# Claude's per-command permission layer.
#
# Usage: set-session-name.sh '{emoji} {name}' "$PPID" [session-id]
#
# 名字會出現在三個地方，底下依序各有一段負責：
#   tab 標題    -> 活著的 ai-tab-sync.sh watcher 的 sync 檔，或直寫 tty 的 OSC
#   名稱檔      -> ~/.claude/session-names/{terminal-pid}.txt
#   右下角名牌  -> ~/.claude/jobs/{jobId}/state.json（只有背景 session 有）
#
# PID semantics: the caller MUST pass its own $PPID as arg 2. The original inline
# commands ran directly in Claude's Bash-tool shell where $PPID = Claude process.
# Wrapping the logic in this script adds a process layer, so the script's own
# $PPID would be the calling shell, not Claude — off by one level. So the caller
# expands "$PPID" in its shell and passes it in; we only fall back to our own
# $PPID if omitted.
#
# 第 3 個參數（session id，來自 hook payload）是選用的，只餵給 breadcrumb——那是
# 背景 session 找回自己 tab 的唯一線索。skill 手動呼叫時可以省略，會退回舊行為。

NAME="$1"
[ -z "$NAME" ] && { echo "set-session-name: missing name arg" >&2; exit 1; }

CLAUDE_PID="${2:-$PPID}"
SESSION_ID="${3:-}"
TERMINAL_PID=$(ps -o ppid= -p "$CLAUDE_PID" 2>/dev/null | tr -d ' ')
NAME_DIR=~/.claude/session-names
BREADCRUMB_DIR=~/.claude/session-terminals

# 這個 session 是不是在背景跑、掛在哪個 job 底下？Claude Code 每個 process 都有一份
# 記錄，兩件事都能回答。
#
# ⚠️ 不要改用 $CLAUDE_JOB_DIR：那個環境變數**只有「一開始就是背景」的 session 有**。
# 先互動、之後才 /bg 的 session 有 jobId 卻沒有這個變數，用它當守衛會讓底下寫名牌那段
# 整個被跳過 → nameSource 停在 auto → Claude Code 把自己的 slug 重生回去。這正是
# 「背景化之後名字被打回去」的真正原因，而且不是回前景時被打回，是背景化當下根本沒
# 寫進去。空字串代表純互動 session。
#
# 用 python3 而不是 jq：其他 hook 已經依賴 python3，安裝流程沒有任何一步保證 jq 存在。
# 記錄不存在、JSON 壞掉、沒有 python3，三種情況都得到空字串，退回互動路徑而不是壞掉。
JOB_ID=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('jobId') or '')" \
  ~/.claude/sessions/"${CLAUDE_PID}".json 2>/dev/null)

# 真的有 ai-tab-sync.sh 在輪詢這個檔嗎？兩條找 tab 的路都要問這件事——名字寫進沒人讀的
# 檔案是**完全靜默**的失敗，看起來就像改名整個沒生效。
watcher_alive() { [ -n "$1" ] && pgrep -f "ai-tab-sync.sh $1" >/dev/null 2>&1; }

# 校驗 emoji：模型有時會挑清單外的（實測看到 🎯）。改指示措辭只是拜託模型，
# 這裡才是最後一道關卡——不在清單裡就換成 🔍，名字其餘部分原樣保留。
#
# 📦 是第 9 個：handoff skill 用它標「已交接」。它原本不在清單裡，於是每次交接
# 完標題都被悄悄換成 🔍，而且腳本不出聲，看起來像改名整個沒生效（VM 實測，查了
# 三輪才找到）。命名 hook 那邊的指示仍然只給模型 8 個選，📦 是 skill 專用的。
#
# `[` 開頭代表名字已經帶了專案前綴，是既有名字被重新套用——emoji 早驗過了，再驗一次
# 會把 `[` 當成非 emoji 而多塞一個 🔍。
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

# 專案前綴：AI 在跑的時候 TUI 蓋住 shell 提示字元，tab 標題就是唯一還看得出「這是哪個
# 專案」的地方。從工作目錄推導，所以任何終端都適用；git repo 根目錄優先於巢狀路徑。
# 家目錄和 / 不算專案，不加前綴——「[你的使用者名稱]」只是雜訊。
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

# ---------------------------------------------------------------------------- 名稱檔

mkdir -p "$NAME_DIR"
echo "$NAME" > "$NAME_DIR/${TERMINAL_PID}.txt"

# process 已經不在的名稱檔就刪掉，否則每關一個終端就留一個，永遠只增不減。
# ⚠️ 背景 session 的名稱檔掛在 `claude bg-pty-host` 的 pid 底下，那也是活的——只用
# 「process 還在不在」判斷，不要用 pid 長相判斷。
for f in "$NAME_DIR"/*.txt; do
  [ -e "$f" ] || continue
  pid=$(basename "$f" .txt)
  case "$pid" in
    '' | *[!0-9]*) continue ;;
  esac
  kill -0 "$pid" 2>/dev/null || rm -f "$f"
done

# ------------------------------------------------------------------------- tab 標題
#
# 三條找 tab 的路，依可信度排序：
#
# 1. $AI_TAB_SYNC_FILE —— myclaude wrapper 設的，但它會被**繼承**。session 背景化再回
#    前景時，拿到的可能是早已結束的 wrapper 留下的路徑，名字就落進沒人輪詢的檔案，而且
#    一聲不吭。所以只有真的有 watcher 在看才採用。背景 session 完全跳過這條：它繼承自
#    daemon，可能指向一個活著但無關的 watcher，會寫到別人的 tab。
# 2. 以本 session 終端 pid 反查 watcher —— 信 process table，不信環境變數。
# 3. 背景 session 根本沒有自己的終端：tty 是 `??`，也沒有任何 watcher 以它為父。而且
#    「正在顯示我的那個終端」查不出來——viewing client 走 unix socket，macOS 的 lsof
#    不報 client 端。所以改成寫入時留線索：有終端的 session 每次命名都記下
#    session-id → sync 檔，fork 再從自己 argv 的 --resume 找到 parent 查回來。
#
# 已知代價：背景 session 跟生它的互動 session 共用同一個 tab，後命名的贏。
# 已知限制：parent 只在 argv 的 `--resume .../{uuid}.jsonl` 看得到，而 daemon 有時會
# 認領預熱的 `claude bg-spare` 進程，那種 argv 誰都沒指名——那些 fork 找不到 breadcrumb，
# tab 就維持原樣不動。
breadcrumb_sync_file() {
  parent=$(ps -o args= -p "$CLAUDE_PID" 2>/dev/null |
    sed -n 's|.*--resume [^ ]*/\([0-9a-f-]*\)\.jsonl.*|\1|p')
  [ -n "$parent" ] && [ -f "$BREADCRUMB_DIR/$parent" ] || return
  file=$(head -1 "$BREADCRUMB_DIR/$parent")
  watcher_alive "$file" && echo "$file"
}

live_sync_file() {
  if [ -z "$JOB_ID" ] && watcher_alive "${AI_TAB_SYNC_FILE:-}"; then
    echo "$AI_TAB_SYNC_FILE"
    return
  fi
  for w in $(pgrep -f 'ai-tab-sync.sh' 2>/dev/null); do
    if [ "$(ps -o ppid= -p "$w" 2>/dev/null | tr -d ' ')" = "$TERMINAL_PID" ]; then
      # watcher 的 argv 結尾固定是 `<sync 檔> <tty>`，但前面不固定：.zshrc 裝的
      # wrapper 直接執行腳本（`ai-tab-sync.sh 檔 tty`），開發機的 myclaude 則是
      # `bash ai-tab-sync.sh 檔 tty`。取倒數第二個欄位兩種都對；寫死第 3 個的話，
      # 前者會取到 tty 路徑，然後把名字直接寫進終端裝置。
      ps -o args= -p "$w" 2>/dev/null | awk '{print $(NF - 1)}'
      return
    fi
  done
  breadcrumb_sync_file
}

SYNC_FILE=$(live_sync_file)

if [ -n "$SYNC_FILE" ]; then
  echo "$NAME" > "$SYNC_FILE"

  # 記下這個 session 屬於哪個 tab，之後從它 fork 出去的背景 session 才找得回來。
  # 背景 session 自己也寫，這樣連續背景化兩次時 tab 能一路傳下去。watcher 已經不在的
  # breadcrumb 順手刪掉，否則跟名稱檔一樣只增不減。
  if [ -n "$SESSION_ID" ]; then
    mkdir -p "$BREADCRUMB_DIR"
    echo "$SYNC_FILE" > "$BREADCRUMB_DIR/$SESSION_ID"
    for c in "$BREADCRUMB_DIR"/*; do
      [ -e "$c" ] || continue
      watcher_alive "$(head -1 "$c")" || rm -f "$c"
    done
  fi
else
  # no wrapper: write OSC title straight to the controlling tty
  # (Claude Code strips ESC from tool stdout, so it must go to the device)
  TTY_DEV=$(ps -o tty= -p "$CLAUDE_PID" 2>/dev/null | tr -d ' ')
  if [ -n "$TTY_DEV" ] && [ "$TTY_DEV" != "??" ] && [ -w "/dev/$TTY_DEV" ]; then
    printf '\033]0;%s\007' "$NAME" > "/dev/$TTY_DEV" 2>/dev/null
  fi
fi

# ------------------------------------------------------- 右下角名牌（只有背景 session）
#
# Claude Code 只在 nameSource 是 user / collision 時才採用 state.json 裡的 name；
# auto 是它自己推導的 slug，會被重新產生，所以兩個欄位都得寫。純互動 session 沒有
# jobId 也沒有這個檔，名牌就維持 Claude Code 自己取的名字。
#
# 第一次命名發生在第一句話，那一刻 daemon 可能還在建 state.json——所以等一下，不要第一次
# 沒看到就放棄。上限約 2 秒：超過就是不會來了，命名不該卡住 session。
#
# ⚠️ 剛建立的 job 記錄 name 和 nameSource 都是 **null 而不是 "auto"**，守衛要寫成
# 「只有 user / collision 才跳過」，不要寫成「只處理 auto」。
if [ -n "$JOB_ID" ]; then
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
fi

rm -f "/tmp/claude-session-namer/${CLAUDE_PID}.default"
