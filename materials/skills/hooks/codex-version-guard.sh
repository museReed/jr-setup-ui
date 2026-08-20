#!/usr/bin/env bash
# Warn on macOS when the installed Codex CLI no longer matches the live app-server.

set -u

control_dir="${CODEX_HOME:-$HOME/.codex}/app-server-control"
socket_path="$control_dir/app-server-control.sock"
state_file="$control_dir/macos-app-server.state"
real_codex="$(command -v codex 2>/dev/null || true)"

if [ -z "$real_codex" ]; then
  printf '%s\n' '找不到真正的 Codex 執行檔，請先重新安裝 Codex CLI。' >&2
  exit 1
fi

codex_version() {
  "$real_codex" --version 2>/dev/null | head -n 1
}

server_pid() {
  [ -S "$socket_path" ] || return 0
  lsof -n -P -U "$socket_path" 2>/dev/null | awk 'NR > 1 { print $2; exit }'
}

write_state() {
  local pid="$1" version="$2" temporary
  [ -n "$pid" ] || return 0
  mkdir -p "$control_dir"
  chmod 700 "$control_dir" 2>/dev/null || true
  temporary="$state_file.$$.tmp"
  umask 077
  printf '%s\t%s\t%s\n' "$pid" "$version" "$socket_path" > "$temporary"
  mv -f "$temporary" "$state_file"
}

current_version="$(codex_version)"
current_pid="$(server_pid)"
stored_pid=""
stored_version=""
if [ -f "$state_file" ]; then
  IFS=$'\t' read -r stored_pid stored_version _ < "$state_file" || true
fi

if [ -n "$current_pid" ] && [ "$stored_pid" = "$current_pid" ] && [ -n "$stored_version" ] && [ "$stored_version" != "$current_version" ]; then
  printf '%s\n' "Codex 已更新至 ${current_version}，但背景 server 仍是 ${stored_version}。" >&2
  printf '%s\n' '現有 Codex 視窗不會被中斷；請先關閉所有 Codex 視窗，再開新的終端機視窗執行：' >&2
  printf '%s\n' 'codex-server-restart' >&2
elif [ -n "$current_pid" ] && [ "$stored_pid" != "$current_pid" ]; then
  write_state "$current_pid" "$current_version"
fi

"$real_codex" "$@"
exit_code=$?

after_pid="$(server_pid)"
if [ -n "$after_pid" ] && [ "$after_pid" != "$stored_pid" ]; then
  write_state "$after_pid" "$(codex_version)"
fi

exit "$exit_code"
