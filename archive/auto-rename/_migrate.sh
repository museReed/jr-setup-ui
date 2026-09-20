#!/usr/bin/env bash
# 把 auto-rename 相關檔案搬進 archive/auto-rename/，保留原本的相對路徑。
# 復原時反向複製回去即可（見 RESTORE.md）。
#
# 只跑一次，跑完留在 archive 裡當作「當初搬了哪些檔」的紀錄。
set -euo pipefail

cd "$(dirname "$0")/../.."
DEST="archive/auto-rename"

FILES=(
  # --- skill ---
  materials/skills/skill-files/claude/auto-rename/SKILL.md
  materials/skills/skill-files/codex/auto-rename/SKILL.md
  materials/skills/skill-files/codex/_shared/codex-session-rename.md

  # --- Claude 命名 hook ---
  materials/skills/hooks/set-session-name.sh
  materials/skills/hooks/set-session-name.ps1
  materials/skills/hooks/set-session-name-shim.sh
  materials/skills/hooks/session-auto-namer.sh
  materials/skills/hooks/session-auto-namer.ps1

  # --- Codex 命名 hook 與它專用的 app-server 基礎建設 ---
  materials/skills/hooks/codex-session-namer.sh
  materials/skills/hooks/codex-session-namer.ps1
  materials/skills/hooks/codex-session-name-set.ps1
  materials/skills/hooks/codex-session-name-set.py
  materials/skills/hooks/codex-shared-app-server.ps1
  materials/skills/hooks/codex-app-server-common.ps1
  materials/skills/hooks/codex-server-restart.ps1
  materials/skills/hooks/codex-server-restart.sh
  materials/skills/hooks/codex-version-guard.sh

  # --- 終端標題 watcher ---
  materials/skills/bin/ai-tab-sync.sh
  materials/skills/bin/ai-tab-sync.ps1

  # --- 教材動畫 ---
  content/walkthroughs/eye-skill-claude-auto-rename.json
  content/walkthroughs/eye-skill-codex-auto-rename.json
  content/walkthroughs/eye-claude-namer.json
  content/walkthroughs/eye-codex-namer.json
  content/walkthroughs/eye-tab-sync.json

  # --- 命名專用的診斷／探針工具 ---
  scripts/diagnose-naming-block.mjs
  scripts/diagnose-title-path.ps1
  scripts/probe-title-readback.ps1
  scripts/probe-watcher-attach.ps1
  scripts/probe-wt-title.ps1
  scripts/test-windows-codex-app-server-rename.mjs
  scripts/verify-hooks-live.mjs

  # --- 專題文件 ---
  docs/windows-codex-auto-rename.md
  docs/windows-tab-title-why-watcher.md
  docs/windows-codex-app-server-rename-probe.md

  # --- 只驗命名的測試 ---
  test/codex-session-namer.mjs
  test/codex-session-name-set.mjs
  test/codex-server-restart.mjs
  test/codex-version-guard.mjs
  test/session-name-bg-split.mjs
  test/tab-sync-watcher.mjs
  test/windows-codex-native-rename.mjs
)

for file in "${FILES[@]}"; do
  if [ ! -e "$file" ]; then
    echo "跳過（不存在）：$file"
    continue
  fi
  mkdir -p "$DEST/$(dirname "$file")"
  git mv "$file" "$DEST/$file"
  echo "已搬：$file"
done
