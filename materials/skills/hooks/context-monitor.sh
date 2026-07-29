#!/bin/bash
# Context Monitor Hook — reads session JSONL to get real token usage
# Triggered on PostToolUse to warn when context exceeds threshold
#
# How it works:
#   1. Reads transcript_path from the hook input JSON on stdin (exact current-session JSONL;
#      guessing by mtime breaks with concurrent sessions)
#   2. Reads the last assistant message's usage.input_tokens + cache tokens
#   3. If total > THRESHOLD, tells model to read and follow handoff skill

JSONL=$(python3 -c "import json,sys; print(json.load(sys.stdin).get('transcript_path',''))" 2>/dev/null)

[ -f "$JSONL" ] || exit 0

# Read last 30 lines for performance (avoid scanning multi-MB files)
# Outputs "TOTAL MODEL" — model taken from the same assistant message as the max usage
read -r TOTAL MODEL <<EOF
$(tail -30 "$JSONL" | python3 -c "
import json, sys
best, model = 0, ''
for line in sys.stdin:
    try:
        d = json.loads(line)
        if d.get('type') == 'assistant':
            u = d.get('message', {}).get('usage', {})
            t = u.get('input_tokens', 0) + u.get('cache_creation_input_tokens', 0) + u.get('cache_read_input_tokens', 0)
            if t > best:
                best = t
                model = d.get('message', {}).get('model', '') or ''
    except (json.JSONDecodeError, KeyError):
        pass
print(best, model)
" 2>/dev/null)
EOF

[ -z "$TOTAL" ] && exit 0
[ "$TOTAL" -eq 0 ] 2>/dev/null && exit 0

# Context window by model.
# 實測（2026-07-05→06）：JSONL message.model 永遠是裸 id、[1m] 只是 UI 顯示標記從不落地；
# 靠字串猜測（*fable*/*sonnet-5* 等 pattern）踩過兩次坑（opus 1M 誤判、sonnet 5 誤判）。
# 正解：`claude -p "hi" --model <alias> --output-format json` 的 modelUsage.<id>.contextWindow
# 是 Anthropic API 自己回報的權威數字（haiku-4-5 實測 200000、opus-4-8/sonnet-5/fable-5 均
# 1000000，跟 model 綁定、非固定回報上限——haiku 對照組證實這點）。
# 查表快取：CACHE，未知 model 用「已知限制」段的指令補一筆，不再用字串猜。
CACHE="$HOME/.claude/model-context-windows-cache.json"
MAX_CONTEXT=$(python3 -c "
import json
try:
    d = json.load(open('$CACHE'))
    print(int(d.get('$MODEL', 0)) or '')
except Exception:
    pass
" 2>/dev/null)

# 已知限制：cache 沒有的新 model → 預設假設 1M（賭未來 model context 只會越來越大）。
# 代價：若新 model 其實是小 context（如 haiku 類 200k）且未收錄，會過晚甚至不觸發——
# 發現「MAX_CONTEXT 預設」字樣時，跑一次驗證並補進 cache：
#   claude -p "hi" --model <alias> --output-format json | python3 -c \
#     "import json,sys; print(json.load(sys.stdin)['modelUsage'])"
[ -z "$MAX_CONTEXT" ] && MAX_CONTEXT=1000000  # 預設（cache 未收錄此 model；賭大 context）

# Temporary small-context test mode: launch as
#   CONTEXT_MONITOR_TEST_WINDOW=30000 claude
# to test handoff triggering. Unset = normal operation.
TEST_TAG=""
if [ -n "${CONTEXT_MONITOR_TEST_WINDOW:-}" ]; then
  MAX_CONTEXT=$CONTEXT_MONITOR_TEST_WINDOW
  TEST_TAG="（測試模式：以小視窗 ${MAX_CONTEXT} 計算）"
fi

THRESHOLD=$((MAX_CONTEXT * 70 / 100))

PCT=$((TOTAL * 100 / MAX_CONTEXT))

if [ "$TOTAL" -gt "$THRESHOLD" ]; then
  python3 -c "
import json, sys
ctx = '⚠️ Context 已用 ~${TOTAL} tokens (${PCT}%)${TEST_TAG}。請立即 Read and follow .claude/skills/handoff/SKILL.md（repo 有的話優先）或 ~/.claude/skills/handoff/SKILL.md 寫交接文件。'
obj = {'hookSpecificOutput': {'hookEventName': 'PostToolUse', 'additionalContext': ctx}}
json.dump(obj, sys.stdout, ensure_ascii=False)
"
fi
