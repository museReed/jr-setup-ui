#!/bin/bash
# Safely restart Codex's native daemon after every connected TUI is closed.

set -u

CODEX_HOME_DIR="${CODEX_HOME:-$HOME/.codex}"
DEFAULT_SOCKET="$CODEX_HOME_DIR/app-server-control/app-server-control.sock"
CODEX_BIN=$(command -v codex 2>/dev/null || true)

if [ -z "$CODEX_BIN" ]; then
  echo '找不到真正的 Codex 執行檔，請先重新安裝 Codex CLI。' >&2
  exit 1
fi

CURRENT_INFO=$("$CODEX_BIN" app-server daemon version 2>/dev/null || true)
SOCKET=$(printf '%s' "$CURRENT_INFO" | python3 -c '
import json, sys
try:
    print(json.load(sys.stdin).get("socketPath", ""))
except (json.JSONDecodeError, AttributeError):
    pass
' 2>/dev/null)
[ -n "$SOCKET" ] || SOCKET="$DEFAULT_SOCKET"

if [ -S "$SOCKET" ]; then
  SOCKET_ROWS=$(lsof -n -P "$SOCKET" 2>/dev/null || true)
  SERVER_PID=$(printf '%s\n' "$SOCKET_ROWS" | awk 'NR > 1 && $5 == "unix" { print $2; exit }')
  SERVER_ADDRESSES=$(printf '%s\n' "$SOCKET_ROWS" | awk -v server="$SERVER_PID" \
    'NR > 1 && $5 == "unix" && $2 == server { print $6 }')

  if [ -z "$SERVER_PID" ] || [ -z "$SERVER_ADDRESSES" ]; then
    echo "找到 daemon socket，但找不到它的 Codex 程序；不會重啟：$SOCKET" >&2
    exit 1
  fi

  ALL_UNIX=$(lsof -n -P -U 2>/dev/null || true)
  CLIENT_PIDS=''
  for address in $SERVER_ADDRESSES; do
    found=$(printf '%s\n' "$ALL_UNIX" | awk -v target="->$address" -v server="$SERVER_PID" \
      'index($0, target) > 0 && $2 != server { print $2 }')
    CLIENT_PIDS=$(printf '%s\n%s\n' "$CLIENT_PIDS" "$found")
  done
  CLIENT_PIDS=$(printf '%s\n' "$CLIENT_PIDS" | awk 'NF { seen[$1] = 1 } END { for (pid in seen) print pid }')
  CLIENT_COUNT=$(printf '%s\n' "$CLIENT_PIDS" | awk 'NF { count++ } END { print count + 0 }')

  if [ "$CLIENT_COUNT" -gt 0 ]; then
    echo "無法重啟：仍有 Codex 視窗連著 core daemon（偵測到 $CLIENT_COUNT 個連線）。"
    echo '請先關閉所有 Codex 視窗，再開新的 Terminal 視窗執行：'
    echo 'codex-server-restart'
    exit 2
  fi
fi

RESTART_OUTPUT=$("$CODEX_BIN" app-server daemon restart 2>&1)
RESTART_EXIT=$?
if [ "$RESTART_EXIT" -ne 0 ]; then
  echo 'Codex core daemon 重啟失敗。' >&2
  [ -z "$RESTART_OUTPUT" ] || printf '%s\n' "$RESTART_OUTPUT" >&2
  exit "$RESTART_EXIT"
fi

VERSION_OUTPUT=$("$CODEX_BIN" app-server daemon version 2>&1)
VERSION_EXIT=$?
if [ "$VERSION_EXIT" -ne 0 ]; then
  echo 'Codex core daemon 已執行 restart，但無法確認狀態。' >&2
  [ -z "$VERSION_OUTPUT" ] || printf '%s\n' "$VERSION_OUTPUT" >&2
  exit "$VERSION_EXIT"
fi

VERSION_FIELDS=$(printf '%s' "$VERSION_OUTPUT" | python3 -c '
import json, sys
try:
    value = json.load(sys.stdin)
    print(value.get("status", ""))
    print(value.get("cliVersion", ""))
    print(value.get("appServerVersion", ""))
    print(value.get("socketPath", ""))
except (json.JSONDecodeError, AttributeError):
    raise SystemExit(1)
' 2>/dev/null || true)
STATUS=$(printf '%s\n' "$VERSION_FIELDS" | sed -n '1p')
CLI_VERSION=$(printf '%s\n' "$VERSION_FIELDS" | sed -n '2p')
SERVER_VERSION=$(printf '%s\n' "$VERSION_FIELDS" | sed -n '3p')
NEW_SOCKET=$(printf '%s\n' "$VERSION_FIELDS" | sed -n '4p')

if [ "$STATUS" != 'running' ] || [ -z "$NEW_SOCKET" ] || [ ! -S "$NEW_SOCKET" ]; then
  echo 'Codex core daemon 沒有回報可用狀態。' >&2
  exit 1
fi

if [ -n "$CLI_VERSION" ] && [ -n "$SERVER_VERSION" ] && [ "$CLI_VERSION" != "$SERVER_VERSION" ]; then
  echo "Codex CLI 是 $CLI_VERSION，但 core daemon 仍是 $SERVER_VERSION。" >&2
  exit 1
fi

echo "Codex core daemon 已更新至 ${SERVER_VERSION:-目前版本}。"
echo '現在可以重新執行 codex。'
