#!/bin/bash
# 把 jr_ai_agent_configs 的規則檔同步進 materials/。
#
#   scripts/sync-materials.sh [configs repo 路徑]
#
# 嚮導內建這些檔案而不是安裝時上網抓：工作坊現場網路不一定穩，而且抓 tarball
# 多一個會壞的環節。代價是內容有兩份——configs repo 改了之後要回來跑這支。
set -euo pipefail

SOURCE="${1:-$HOME/Projects/jr_ai_agent_configs}"
TARGET="$(cd "$(dirname "$0")/.." && pwd)/materials"

if [ ! -d "$SOURCE/claude-code" ]; then
  echo "找不到 configs repo：$SOURCE" >&2
  exit 1
fi

rm -rf "$TARGET"
mkdir -p "$TARGET"

for lang in zh-TW zh-CN en; do
  mkdir -p "$TARGET/claude-code/$lang/output-styles" "$TARGET/codex/$lang"
  cp "$SOURCE/claude-code/$lang/CLAUDE.md" "$TARGET/claude-code/$lang/CLAUDE.md"
  cp "$SOURCE/claude-code/$lang/output-styles/concise-structured.md" \
    "$TARGET/claude-code/$lang/output-styles/concise-structured.md"
  cp "$SOURCE/codex/$lang/AGENTS.md" "$TARGET/codex/$lang/AGENTS.md"
  cp "$SOURCE/codex/$lang/config.toml.example" "$TARGET/codex/$lang/config.toml.example"
done

mkdir -p "$TARGET/claude-code/hooks"
cp "$SOURCE/claude-code/hooks/block-chained-bash.js" \
  "$TARGET/claude-code/hooks/block-chained-bash.js"
cp "$SOURCE/claude-code/starter-allowlist.json" \
  "$TARGET/claude-code/starter-allowlist.json"

echo "已同步："
find "$TARGET" -type f | sort | sed "s|$TARGET/|  |"
