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

parse_daemon_json() {
  python3 -c '
import json, sys
try:
    value = json.load(sys.stdin)
    print(value.get("status", ""))
    print(value.get("socketPath", ""))
    print(value.get("cliVersion", ""))
    print(value.get("appServerVersion", ""))
except (json.JSONDecodeError, AttributeError):
    raise SystemExit(1)
'
}

daemon_output=$("$real_codex" app-server daemon start 2>&1)
daemon_exit=$?

if [ "$daemon_exit" -ne 0 ]; then
  printf '%s\n' 'Codex core daemon 無法啟動；本次仍會開啟 Codex，但不會自動改名。' >&2
  [ -z "$daemon_output" ] || printf '%s\n' "$daemon_output" >&2
  JR_CODEX_AUTO_RENAME_DISABLED=1 "$real_codex" "$@"
  exit $?
fi

start_fields=$(printf '%s' "$daemon_output" | parse_daemon_json 2>/dev/null || true)
socket_path=$(printf '%s\n' "$start_fields" | sed -n '2p')
cli_version=$(printf '%s\n' "$start_fields" | sed -n '3p')
server_version=$(printf '%s\n' "$start_fields" | sed -n '4p')

# A cold start can report that the daemon process was launched before its Unix
# socket accepts control requests. Require both the socket and a successful
# `daemon version` response, polling for about ten seconds at most.
daemon_ready=false
if [ -n "$socket_path" ]; then
  readiness_attempt=0
  while [ "$readiness_attempt" -lt 50 ]; do
    if [ -S "$socket_path" ]; then
      version_output=$("$real_codex" app-server daemon version 2>/dev/null || true)
      version_fields=$(printf '%s' "$version_output" | parse_daemon_json 2>/dev/null || true)
      readiness_status=$(printf '%s\n' "$version_fields" | sed -n '1p')
      readiness_socket=$(printf '%s\n' "$version_fields" | sed -n '2p')
      if [ "$readiness_status" = 'running' ] && [ -n "$readiness_socket" ] && [ -S "$readiness_socket" ]; then
        socket_path="$readiness_socket"
        cli_version=$(printf '%s\n' "$version_fields" | sed -n '3p')
        server_version=$(printf '%s\n' "$version_fields" | sed -n '4p')
        daemon_ready=true
        break
      fi
    fi
    sleep 0.2
    readiness_attempt=$((readiness_attempt + 1))
  done
fi

if [ "$daemon_ready" != true ]; then
  printf '%s\n' 'Codex core daemon 在 10 秒內沒有提供可用連線；本次仍會開啟 Codex，但不會自動改名。' >&2
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
