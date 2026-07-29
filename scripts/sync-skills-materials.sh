#!/bin/bash
# 把 jr_ai_agent_skills 的 hooks 與顯示層腳本同步進 materials/skills/。
#
#   scripts/sync-skills-materials.sh [skills repo 路徑]
#
# 跟 sync-materials.sh 同一個道理：嚮導內建這些檔案而不是安裝時上網抓，
# 工作坊現場網路不一定穩。代價是內容有兩份——上游改了要回來跑這支。
#
# ⚠️ .ps1 一律用 cp 保留原始位元組：那些檔案是 UTF-8 with BOM，
# PowerShell 5.1 沒有 BOM 就會用系統 ANSI codepage 讀，中文會變亂碼。
set -euo pipefail

SOURCE="${1:-$HOME/Projects/jr_ai_agent_skills}"
TARGET="$(cd "$(dirname "$0")/.." && pwd)/materials/skills"

if [ ! -d "$SOURCE/installer" ]; then
  echo "找不到 skills repo：$SOURCE" >&2
  exit 1
fi

# ⚠️ 不要 rm -rf 整個 TARGET：materials/skills/hooks 裡有嚮導自己的檔案（薄殼
# set-session-name-shim.sh，上游沒有），整包砍掉它就消失了，而且沒有任何一步會把
# 它補回來。只清這支自己會重建的目錄。
rm -rf "$TARGET/skill-files"
mkdir -p "$TARGET/bin" "$TARGET/hooks" "$TARGET/skill-files"

for file in ai-tab-sync.sh ai-tab-sync.ps1; do
  cp "$SOURCE/installer/bin/$file" "$TARGET/bin/$file"
done

for file in \
  set-session-name.sh set-session-name.ps1 \
  session-auto-namer.sh session-auto-namer.ps1 \
  context-monitor.sh context-monitor.ps1 \
  codex-session-namer.sh codex-session-namer.ps1 \
  codex-context-monitor.sh codex-context-monitor.ps1; do
  cp "$SOURCE/installer/hooks/$file" "$TARGET/hooks/$file"
done

cp "$SOURCE/installer/model-context-windows-cache.json" \
  "$TARGET/model-context-windows-cache.json"

# skill 本體：Claude 的在 ~/.claude/skills/，Codex 的在 ~/.agents/skills/（含 _shared，
# handoff 的 SKILL.md 會叫模型去讀它）。一樣內建不上網，理由同上。
cp -R "$SOURCE/installer/skills/claude" "$TARGET/skill-files/claude"
cp -R "$SOURCE/installer/skills/codex" "$TARGET/skill-files/codex"

echo "已同步："
find "$TARGET" -type f | sort | sed "s|$TARGET/|  |"
