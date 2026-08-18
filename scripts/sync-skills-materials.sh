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

missing=false
for file in \
  bin/ai-tab-sync.sh bin/ai-tab-sync.ps1 \
  hooks/set-session-name.sh hooks/set-session-name.ps1 \
  hooks/session-auto-namer.sh hooks/session-auto-namer.ps1 \
  hooks/context-monitor.sh hooks/context-monitor.ps1 \
  hooks/codex-session-namer.sh hooks/codex-session-namer.ps1 \
  hooks/codex-session-name-set.py \
  hooks/codex-context-monitor.sh hooks/codex-context-monitor.ps1 \
  model-context-windows-cache.json \
  demo-prompt-claude.md demo-prompt-codex.md; do
  if [ ! -f "$SOURCE/installer/$file" ]; then
    echo "上游缺少必需檔案：installer/$file" >&2
    missing=true
  fi
done
for directory in skills/claude skills/codex demo/live-preview-self; do
  if [ ! -d "$SOURCE/installer/$directory" ]; then
    echo "上游缺少必需目錄：installer/$directory" >&2
    missing=true
  fi
done
if [ "$missing" = true ]; then
  echo "來源不完整；未修改 materials。" >&2
  exit 1
fi

if ! grep -Fq 'KEY="${SESSION_ID:-$PPID}"' "$SOURCE/installer/hooks/codex-session-namer.sh" 2>/dev/null || \
   grep -Rqi 'mycodex' "$SOURCE/installer/skills/codex" 2>/dev/null; then
  echo "上游 Codex 素材尚未支援 0.146 原生命名；未修改 materials。" >&2
  echo "需要 codex-session-name-set.py、session_id key，且文件不能再要求 mycodex。" >&2
  exit 1
fi

# ⚠️ 不要 rm -rf 整個 TARGET：materials/skills/hooks 裡有嚮導自己的檔案（薄殼
# set-session-name-shim.sh，上游沒有），整包砍掉它就消失了，而且沒有任何一步會把
# 它補回來。只清這支自己會重建的目錄。
rm -rf "$TARGET/skill-files" "$TARGET/demo"
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
cp "$SOURCE/installer/hooks/codex-session-name-set.py" \
  "$TARGET/hooks/codex-session-name-set.py"

cp "$SOURCE/installer/model-context-windows-cache.json" \
  "$TARGET/model-context-windows-cache.json"

# skill 本體：Claude 的在 ~/.claude/skills/，Codex 的在 ~/.agents/skills/（含 _shared，
# handoff 的 SKILL.md 會叫模型去讀它）。一樣內建不上網，理由同上。
cp -R "$SOURCE/installer/skills/claude" "$TARGET/skill-files/claude"
cp -R "$SOURCE/installer/skills/codex" "$TARGET/skill-files/codex"

# 一條龍 demo：prompt 兩份（Claude / Codex 各一）＋ live-preview。嚮導的
# 「跑一條龍 demo」那一列會叫 agent 去讀這裡的 prompt，所以要跟著內建。
#
# ⚠️ 只帶自走版（live-preview-self），不帶原版：原版要 python playwright + chromium，
# 學生現場得多裝兩個東西（Windows ARM64 那台還要自己挑 wheel）。自走版產出的頁面
# 打開就自己演，零依賴。要出影格的人自己去 skills repo 用原版。
mkdir -p "$TARGET/demo"
cp "$SOURCE/installer/demo-prompt-claude.md" "$TARGET/demo/demo-prompt-claude.md"
cp "$SOURCE/installer/demo-prompt-codex.md" "$TARGET/demo/demo-prompt-codex.md"
cp -R "$SOURCE/installer/demo/live-preview-self" "$TARGET/demo/live-preview-self"

echo "已同步："
find "$TARGET" -type f | sort | sed "s|$TARGET/|  |"
