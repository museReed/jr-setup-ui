#!/usr/bin/env pwsh
# codex-context-monitor.ps1 — Windows counterpart of codex-context-monitor.sh.
# PostToolUse hook for Codex CLI: trigger handoff when context reaches 70%.
#
# Prefer real Codex token_count events from the current rollout JSONL:
#   - pct = latest last_token_usage.input_tokens / model_context_window
# Fallback when token_count is unavailable:
#   - Count tool calls per session; never share counts across sessions
#   - ~100 tool calls ≈ full context, so 70 calls ≈ 70%
#   - Require 3 consecutive token_count read failures to ignore transient gaps
#   - Repeat every 10 calls after the fallback threshold if not yet handed off
#
# Temporary small-context test mode: launch as
#   $env:CODEX_TEST_MAX_CONTEXT_WINDOW = 5000; codex

$ErrorActionPreference = 'Continue'

$THRESHOLD_PCT = 70
$FALLBACK_FULL_TOOL_CALLS = 100
$FALLBACK_THRESHOLD = [int]($FALLBACK_FULL_TOOL_CALLS * $THRESHOLD_PCT / 100)
$FALLBACK_CONSECUTIVE_FAILURES = 3

$counterDir = Join-Path ([System.IO.Path]::GetTempPath()) 'codex-context-monitor'
New-Item -ItemType Directory -Force -Path $counterDir | Out-Null

function Read-Counter([string]$Path) {
  try { return [int]([System.IO.File]::ReadAllText($Path).Trim()) } catch { return 0 }
}
function Write-Counter([string]$Path, [int]$Value) {
  try { [System.IO.File]::WriteAllText($Path, "$Value") } catch {}
}

# Codex command hooks receive the current session metadata as JSON on stdin.
# Use that stable contract; CODEX_THREAD_ID is only a legacy fallback.
$stdinJson = ''
if ([Console]::IsInputRedirected) { $stdinJson = [Console]::In.ReadToEnd() }
$sessionId = ''
$transcriptPath = ''
if ($stdinJson) {
  try {
    $payload = $stdinJson | ConvertFrom-Json
    $sessionId = [string]$payload.session_id
    $transcriptPath = [string]$payload.transcript_path
  } catch {}
}
if (-not $sessionId) { $sessionId = [string]$env:CODEX_THREAD_ID }

$stateSource = ''
if ($sessionId) { $stateSource = "session:$sessionId" }
elseif ($transcriptPath) { $stateSource = "transcript:$transcriptPath" }
if (-not $stateSource) { exit 0 }

# Hash the source so a rollout path (which contains separators) is still a
# usable filename, and so both key shapes are the same length.
$sha = [System.Security.Cryptography.SHA256]::Create()
$hashBytes = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($stateSource))
$sha.Dispose()
$stateKey = (($hashBytes | ForEach-Object { '{0:x2}' -f $_ }) -join '').Substring(0, 24)

$handoffMarker = Join-Path $counterDir "$stateKey.handoff"
$counterFile = Join-Path $counterDir "$stateKey.calls"
$failureFile = Join-Path $counterDir "$stateKey.token-read-failures"

# Already handed off — stop nagging
if (Test-Path -LiteralPath $handoffMarker) { exit 0 }

# Without a session_id, token_count can still trigger but the call-count
# fallback stays disabled — a transcript-only key cannot prove session identity.
$count = 0
if ($sessionId) {
  $count = (Read-Counter $counterFile) + 1
  Write-Counter $counterFile $count
}

$rolloutPath = ''
if ($transcriptPath -and (Test-Path -LiteralPath $transcriptPath)) {
  $rolloutPath = $transcriptPath
}
# The bash version also looks the rollout path up in state_*.sqlite when the
# hook payload lacks it. That needs Python on Windows (no guaranteed sqlite3),
# and the payload has carried transcript_path in every observed Codex build, so
# this port stops at the payload and degrades to the call counter instead.

$pct = $null
$inputTokens = 0
$maxContext = 0
if ($rolloutPath) {
  try {
    foreach ($line in (Get-Content -LiteralPath $rolloutPath -Tail 200 -Encoding UTF8)) {
      if (-not $line.Trim()) { continue }
      $event = $null
      try { $event = $line | ConvertFrom-Json } catch { continue }
      if ($event.payload.type -ne 'token_count') { continue }
      $info = $event.payload.info
      if (-not $info) { continue }
      $t = [int]($info.last_token_usage.input_tokens)
      $w = [int]($info.model_context_window)
      if ($env:CODEX_TEST_MAX_CONTEXT_WINDOW) { $w = [int]$env:CODEX_TEST_MAX_CONTEXT_WINDOW }
      # Keep the LAST valid pair, not the largest: context usage can legitimately
      # drop after a compaction, and we want the current state.
      if ($t -gt 0 -and $w -gt 0) { $inputTokens = $t; $maxContext = $w }
    }
  } catch {}
  if ($inputTokens -gt 0 -and $maxContext -gt 0) {
    $pct = [int]($inputTokens * 100 / $maxContext)
  }
}

$tokenReadFailures = 0
if ($null -ne $pct) {
  Remove-Item -LiteralPath $failureFile -Force -ErrorAction SilentlyContinue
} elseif ($sessionId) {
  $tokenReadFailures = (Read-Counter $failureFile) + 1
  Write-Counter $failureFile $tokenReadFailures
}

$reason = ''
if ($null -ne $pct -and $pct -ge $THRESHOLD_PCT) {
  if ($env:CODEX_TEST_MAX_CONTEXT_WINDOW) {
    $reason = "測試模式：Context 以小視窗 $maxContext 計算，已用約 $pct%（$inputTokens/$maxContext input tokens），已達 $THRESHOLD_PCT% 門檻。"
  } else {
    $reason = "Context 已用約 $pct%（$inputTokens/$maxContext input tokens），已達 $THRESHOLD_PCT% 門檻。"
  }
} elseif ($null -eq $pct -and $sessionId -and
          $count -ge $FALLBACK_THRESHOLD -and
          $tokenReadFailures -ge $FALLBACK_CONSECUTIVE_FAILURES -and
          ($count -eq $FALLBACK_THRESHOLD -or
           $tokenReadFailures -eq $FALLBACK_CONSECUTIVE_FAILURES -or
           (($count - $FALLBACK_THRESHOLD) % 10) -eq 0)) {
  $reason = "連續 $tokenReadFailures 次無法讀取 Codex token_count，改用工具呼叫數估算：$count/$FALLBACK_FULL_TOOL_CALLS，約達 $THRESHOLD_PCT% 門檻。"
}

if (-not $reason) { exit 0 }

$markerCmd = "New-Item -ItemType File -Force -Path '$handoffMarker' | Out-Null"
$ctx = "[context-monitor] $reason 請立即觸發 `$handoff skill：Read and follow .agents/skills/handoff/SKILL.md（repo 有的話優先）或 ~/.agents/skills/handoff/SKILL.md 寫交接文件。`n`n重要：寫完 handoff 並 commit 後，必須把 session 改名為 📦 {topic}（按 SKILL.md Step 5a 執行）。`n`n全部完成後執行：$markerCmd"

$json = @{ hookSpecificOutput = @{ hookEventName = 'PostToolUse'; additionalContext = $ctx } } |
        ConvertTo-Json -Depth 5 -Compress
# Write bytes directly: PowerShell 7 emits raw UTF-8 while 5.1 escapes non-ASCII,
# and the default stdout encoding differs between them.
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
$stdout = [Console]::OpenStandardOutput()
$stdout.Write($bytes, 0, $bytes.Length)
$stdout.Flush()
