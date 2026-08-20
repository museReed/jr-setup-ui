#!/usr/bin/env bash
# Start Codex's native daemon and attach interactive macOS TUI sessions to it.

set -u

real_codex="$(command -v codex 2>/dev/null || true)"

if [ -z "$real_codex" ]; then
  printf '%s\n' '找不到真正的 Codex 執行檔，請先重新安裝 Codex CLI。' >&2
  exit 1
fi

# Commands that do not open a TUI must not be sent back through the daemon.
for argument in "$@"; do
  case "$argument" in
    --remote|app-server|remote-control|exec|review|login|logout|mcp|mcp-server|completion|sandbox|debug|apply|cloud|features|update|app|--help|-h|--version|-V)
      "$real_codex" "$@"
      exit $?
      ;;
  esac
done

daemon_output=$("$real_codex" app-server daemon start 2>&1)
daemon_exit=$?

if [ "$daemon_exit" -ne 0 ]; then
  printf '%s\n' 'Codex core daemon 無法啟動；本次仍會開啟 Codex，但不會自動改名。' >&2
  [ -z "$daemon_output" ] || printf '%s\n' "$daemon_output" >&2
  JR_CODEX_AUTO_RENAME_DISABLED=1 "$real_codex" "$@"
  exit $?
fi

daemon_fields=$(printf '%s' "$daemon_output" | python3 -c '
import json, sys
try:
    value = json.load(sys.stdin)
    print(value.get("socketPath", ""))
    print(value.get("cliVersion", ""))
    print(value.get("appServerVersion", ""))
except (json.JSONDecodeError, AttributeError):
    raise SystemExit(1)
' 2>/dev/null || true)
socket_path=$(printf '%s\n' "$daemon_fields" | sed -n '1p')
cli_version=$(printf '%s\n' "$daemon_fields" | sed -n '2p')
server_version=$(printf '%s\n' "$daemon_fields" | sed -n '3p')

if [ -z "$socket_path" ] || [ ! -S "$socket_path" ]; then
  printf '%s\n' 'Codex core daemon 沒有提供可用 socket；本次仍會開啟 Codex，但不會自動改名。' >&2
  JR_CODEX_AUTO_RENAME_DISABLED=1 "$real_codex" "$@"
  exit $?
fi

if [ -n "$cli_version" ] && [ -n "$server_version" ] && [ "$cli_version" != "$server_version" ]; then
  printf '%s\n' "Codex CLI 已更新至 ${cli_version}，但 core daemon 仍是 ${server_version}。" >&2
  printf '%s\n' '現有 Codex 視窗不會被中斷；請先關閉所有 Codex 視窗，再開新的終端機視窗執行：' >&2
  printf '%s\n' 'codex-server-restart' >&2
  JR_CODEX_AUTO_RENAME_DISABLED=1 "$real_codex" "$@"
  exit $?
fi

CODEX_APP_SERVER_SOCKET="$socket_path" \
JR_CODEX_NATIVE_DAEMON=1 \
  "$real_codex" --remote "unix://$socket_path" "$@"
exit $?
