#!/usr/bin/env pwsh
# context-monitor.ps1 — Windows counterpart of context-monitor.sh.
# Reads the session JSONL to get real token usage; on PostToolUse it warns the
# model to write a handoff once context crosses the threshold.
#
# How it works:
#   1. Reads transcript_path from the hook input JSON on stdin (the exact
#      current-session JSONL; guessing by mtime breaks with concurrent sessions)
#   2. Reads the last assistant message's input_tokens + cache tokens
#   3. If the total crosses THRESHOLD, tells the model to follow the handoff skill
#
# No Python here, unlike the bash version: PowerShell parses JSON natively.

$ErrorActionPreference = 'Continue'

$stdinJson = ''
if ([Console]::IsInputRedirected) { $stdinJson = [Console]::In.ReadToEnd() }
if (-not $stdinJson) { exit 0 }

$jsonl = ''
try { $jsonl = [string]($stdinJson | ConvertFrom-Json).transcript_path } catch {}
if (-not $jsonl -or -not (Test-Path -LiteralPath $jsonl)) { exit 0 }

# Last 30 lines only — these transcripts reach multi-MB and this runs on every tool call.
$total = 0
$model = ''
try {
  foreach ($line in (Get-Content -LiteralPath $jsonl -Tail 30 -Encoding UTF8)) {
    if (-not $line.Trim()) { continue }
    $d = $null
    try { $d = $line | ConvertFrom-Json } catch { continue }
    if ($d.type -ne 'assistant') { continue }
    $u = $d.message.usage
    if (-not $u) { continue }
    $t = [int]($u.input_tokens) + [int]($u.cache_creation_input_tokens) + [int]($u.cache_read_input_tokens)
    if ($t -gt $total) {
      $total = $t
      $model = [string]$d.message.model
    }
  }
} catch {}

if ($total -le 0) { exit 0 }

# Context window by model, from the same cache the bash version uses.
# 實測（2026-07-05→06）：JSONL 的 message.model 永遠是裸 id，[1m] 只是 UI 標記從不落地；
# 靠字串猜測（*fable*/*sonnet-5* 等 pattern）踩過兩次坑。權威數字來自
# `claude -p "hi" --model <alias> --output-format json` 的 modelUsage.<id>.contextWindow。
$maxContext = 0
$cachePath = Join-Path $HOME '.claude\model-context-windows-cache.json'
if (Test-Path -LiteralPath $cachePath) {
  try {
    $cache = [System.IO.File]::ReadAllText($cachePath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
    $entry = $cache.PSObject.Properties[$model]
    if ($entry) { $maxContext = [int]$entry.Value }
  } catch {}
}

# 已知限制：cache 沒有的新 model → 預設假設 1M（賭未來 model context 只會越來越大）。
# 代價：若新 model 其實是小 context（如 haiku 類 200k）且未收錄，會過晚甚至不觸發。
# 補一筆的方法見 context-monitor.sh 的同段註解。
if ($maxContext -le 0) { $maxContext = 1000000 }

# Temporary small-context test mode: launch as
#   $env:CONTEXT_MONITOR_TEST_WINDOW = 30000; claude
$testTag = ''
if ($env:CONTEXT_MONITOR_TEST_WINDOW) {
  $maxContext = [int]$env:CONTEXT_MONITOR_TEST_WINDOW
  $testTag = "（測試模式：以小視窗 $maxContext 計算）"
}

$threshold = [int]($maxContext * 70 / 100)
if ($total -le $threshold) { exit 0 }

$pct = [int]($total * 100 / $maxContext)
$ctx = "⚠️ Context 已用 ~$total tokens ($pct%)$testTag。請立即 Read and follow .claude/skills/handoff/SKILL.md（repo 有的話優先）或 ~/.claude/skills/handoff/SKILL.md 寫交接文件。"

$json = @{ hookSpecificOutput = @{ hookEventName = 'PostToolUse'; additionalContext = $ctx } } |
        ConvertTo-Json -Depth 5 -Compress
# Write bytes directly: PowerShell 7 emits raw UTF-8 while 5.1 escapes non-ASCII,
# and the default stdout encoding differs between them.
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
$stdout = [Console]::OpenStandardOutput()
$stdout.Write($bytes, 0, $bytes.Length)
$stdout.Flush()
