#!/bin/bash
# Safely restart the shared macOS Codex control server after every TUI is closed.

set -u

CODEX_HOME_DIR="${CODEX_HOME:-$HOME/.codex}"
CONTROL_DIR="$CODEX_HOME_DIR/app-server-control"
SOCKET="${CODEX_APP_SERVER_SOCKET:-$CONTROL_DIR/app-server-control.sock}"
LOG="$CONTROL_DIR/app-server.log"

CODEX_BIN=$(command -v codex 2>/dev/null || true)
if [ -z "$CODEX_BIN" ]; then
  echo '找不到真正的 Codex 執行檔，請先重新安裝 Codex CLI。' >&2
  exit 1
fi

if [ -S "$SOCKET" ]; then
  SOCKET_ROWS=$(lsof -n -P -U "$SOCKET" 2>/dev/null || true)
  SERVER_PID=$(printf '%s\n' "$SOCKET_ROWS" | awk 'NR > 1 { print $2; exit }')

  if [ -z "$SERVER_PID" ]; then
    echo "找到舊 socket，但找不到它的 Codex app-server；不會刪除：$SOCKET" >&2
    exit 1
  fi

  SERVER_COMMAND=$(ps -p "$SERVER_PID" -o command= 2>/dev/null || true)
  case "$SERVER_COMMAND" in
    *codex*app-server*--listen*) ;;
    *)
      echo "socket 不是由 Codex app-server 使用；不會停止 PID $SERVER_PID。" >&2
      exit 1
      ;;
  esac

  SOCKET_NODES=$(printf '%s\n' "$SOCKET_ROWS" | awk 'NR > 1 { print $8 }')
  ALL_UNIX=$(lsof -n -P -U 2>/dev/null || true)
  CLIENT_PIDS=''
  for node in $SOCKET_NODES; do
    found=$(printf '%s\n' "$ALL_UNIX" | awk -v target="->$node" -v server="$SERVER_PID" \
      'index($0, target) > 0 && $2 != server { print $2 }')
    CLIENT_PIDS=$(printf '%s\n%s\n' "$CLIENT_PIDS" "$found")
  done
  CLIENT_PIDS=$(printf '%s\n' "$CLIENT_PIDS" | awk 'NF { seen[$1] = 1 } END { for (pid in seen) print pid }')
  CLIENT_COUNT=$(printf '%s\n' "$CLIENT_PIDS" | awk 'NF { count++ } END { print count + 0 }')

  if [ "$CLIENT_COUNT" -gt 0 ]; then
    echo "無法重啟：仍有 $CLIENT_COUNT 個 Codex 視窗連著背景 server。"
    echo '請先關閉所有 Codex 視窗，再開新的 Terminal 視窗執行：'
    echo 'codex-server-restart'
    exit 2
  fi

  kill "$SERVER_PID" 2>/dev/null || {
    echo "無法停止舊 Codex app-server（PID $SERVER_PID）。" >&2
    exit 1
  }
  attempt=0
  while kill -0 "$SERVER_PID" 2>/dev/null && [ "$attempt" -lt 30 ]; do
    sleep 0.1
    attempt=$((attempt + 1))
  done
  if kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "舊 Codex app-server（PID $SERVER_PID）沒有停止；未啟動新 server。" >&2
    exit 1
  fi
  [ ! -S "$SOCKET" ] || rm -f -- "$SOCKET"
fi

umask 077
mkdir -p -- "$CONTROL_DIR"
nohup "$CODEX_BIN" -c features.code_mode_host=true app-server --listen unix:// \
  >"$LOG" 2>&1 &
NEW_PID=$!

attempt=0
while [ "$attempt" -lt 50 ]; do
  if [ -S "$SOCKET" ] && kill -0 "$NEW_PID" 2>/dev/null; then
    VERSION=$("$CODEX_BIN" --version 2>/dev/null | head -1)
    echo "Codex 背景 server 已更新至 $VERSION。"
    echo '現在可以重新執行 codex。'
    exit 0
  fi
  if ! kill -0 "$NEW_PID" 2>/dev/null; then
    break
  fi
  sleep 0.1
  attempt=$((attempt + 1))
done

echo "新版 Codex app-server 沒有成功啟動，請查看：$LOG" >&2
exit 1
