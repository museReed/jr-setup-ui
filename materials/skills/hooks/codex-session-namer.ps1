#!/usr/bin/env pwsh
# codex-session-namer.ps1 — Windows counterpart of codex-session-namer.sh.
# Session auto-namer for Codex. Registered on two hook events:
#   UserPromptSubmit ("prompt" arg) → prompt#1: ask the model to name the
#     session from the user's first message
#   PostToolUse (no arg) → count=5: re-evaluate the name against the
#     conversation so far; every 10 calls after that: retry if no AI name landed
# Reads session_id from stdin JSON (Codex passes it to all hooks).
#
# Sandbox note: the Codex MODEL cannot write ~/.codex/state_*.sqlite or
# ~/.ai-session-names/ outside a trusted cwd. Hooks run unsandboxed, so the model
# only writes the chosen name to a temp relay file (always writable); this hook
# applies it to SQLite (sidebar name) + the tab-sync file on the next hook event.
#
# Windows note: sqlite3.exe is not guaranteed to exist, so the SQLite write goes
# through Python's stdlib (the project already requires Python).

[CmdletBinding()]
param([string]$EventName = 'tool')

$ErrorActionPreference = 'Continue'
$utf8 = New-Object System.Text.UTF8Encoding $false

$stdinJson = ''
if ([Console]::IsInputRedirected) { $stdinJson = [Console]::In.ReadToEnd() }

function Get-ParentPid([int]$ProcessId) {
  if ($ProcessId -le 0) { return 0 }
  try {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop
    return [int]$p.ParentProcessId
  } catch { return 0 }
}

function Read-Counter([string]$Path) {
  try { return [int]([System.IO.File]::ReadAllText($Path).Trim()) } catch { return 0 }
}

function Write-Counter([string]$Path, [int]$Value) {
  try { [System.IO.File]::WriteAllText($Path, "$Value") } catch {}
}

# Presence on PATH proves nothing: Windows ships stub python3.exe / python.exe
# under WindowsApps that only print "Python was not found; run without arguments
# to install from the Microsoft Store". A real Store install uses the same folder
# and the same names, so path filtering can't tell them apart — the only reliable
# test is running it. Cheap enough: this is reached only when a name is pending,
# not on every hook event.
function Get-PythonPath {
  foreach ($candidate in 'py', 'python3', 'python') {
    $cmd = Get-Command $candidate -ErrorAction SilentlyContinue
    if (-not $cmd) { continue }
    $ver = ''
    try { $ver = (& $cmd.Source '--version' 2>&1) -join ' ' } catch {}
    if ($ver -match 'Python 3') { return $cmd.Source }
  }
  return $null
}

$sessionId = ''
if ($stdinJson) {
  try { $sessionId = [string]($stdinJson | ConvertFrom-Json).session_id } catch {}
}

# Keyed by session_id, not pid — same reason as session-auto-namer.ps1: Windows
# spawns each hook under a throwaway shell whose pid differs every invocation.
# The relay file is the sharp edge here: the model writes the path one hook run
# handed it, and the next run looked for a different filename, so the name was
# never picked up.
$sessionKey = if ($sessionId) { $sessionId -replace '[^A-Za-z0-9._-]', '_' } else { "pid-$(Get-ParentPid $PID)" }
$counterDir = Join-Path ([System.IO.Path]::GetTempPath()) 'codex-session-namer'
New-Item -ItemType Directory -Force -Path $counterDir | Out-Null
$counterFile = Join-Path $counterDir "$sessionKey.tools"
$defaultMarker = Join-Path $counterDir "$sessionKey.default"
$relayFile = Join-Path $counterDir "$sessionKey.pending"

$sqlitePy = @'
import os, sqlite3
con = sqlite3.connect(os.environ["CODEX_DB"])
try:
    con.execute(
        "UPDATE threads SET title=?, preview=? WHERE id=?",
        (os.environ["CODEX_TITLE"], os.environ["CODEX_TITLE"], os.environ["CODEX_SID"]),
    )
    con.commit()
finally:
    con.close()
'@

function Set-SessionName([string]$Name) {
  $db = Get-ChildItem -LiteralPath (Join-Path $HOME '.codex') -Filter 'state_*.sqlite' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
  $py = Get-PythonPath
  if ($sessionId -and $db -and -not $py) {
    # Tab title still works (below); only the sidebar name is lost. Say so on
    # stderr rather than failing silently — hook stdout is the JSON channel and
    # must stay clean.
    [Console]::Error.WriteLine('[codex-session-namer] 找不到可用的 Python，跳過 sidebar 改名（tab 標題不受影響）。')
  }
  if ($sessionId -and $db -and $py) {
    # Name travels via env (Windows env is UTF-16, so emoji survive) and binds as
    # a SQL parameter — no quote escaping needed.
    $env:CODEX_DB = $db.FullName
    $env:CODEX_SID = $sessionId
    $env:CODEX_TITLE = $Name
    try { $sqlitePy | & $py - 2>$null } catch {}
  }
  if ($env:AI_TAB_SYNC_FILE) {
    # mycodex wrapper: the watcher owns the tab, just write the sync file
    try { [System.IO.File]::WriteAllText($env:AI_TAB_SYNC_FILE, $Name, $utf8) } catch {}
  } else {
    # No wrapper. The bash version stops here, so plain `codex` never retitled
    # the tab on Windows. SetConsoleTitle bypasses stdout (which is this hook's
    # JSON channel), same as session-auto-namer.ps1 — deliberately no OSC
    # fallback, since writing escapes to stdout would corrupt the payload.
    try { [Console]::Title = $Name } catch {}
  }

  # 「名字真的套用上去了」的副產物，跟 .sh 那支同一個落點。
  # 沒有它的話 Codex 這一路的命名沒有任何程式抓得到的證據，嚮導的驗證只能請學生
  # 自己看標題——壞掉時沒有一條測試會紅（jr-setup-feedback#8 就是這樣拖出來的）。
  try {
    $namesDir = Join-Path $HOME '.ai-session-names'
    New-Item -ItemType Directory -Force -Path $namesDir | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $namesDir "$sessionKey.txt"), $Name, $utf8)
  } catch {}
}

# Apply a model-chosen name left in the relay file (sandbox-safe handoff).
# Runs on every hook event so chat-only sessions still get their name applied
# on the next prompt.
if (Test-Path -LiteralPath $relayFile) {
  $name = ''
  try {
    $text = [System.IO.File]::ReadAllText($relayFile, [System.Text.Encoding]::UTF8)
    $name = ($text -split "`r?`n")[0].Trim()
    if ($name.Length -gt 120) { $name = $name.Substring(0, 120) }
  } catch {}
  Remove-Item -LiteralPath $relayFile -Force -ErrorAction SilentlyContinue
  if ($name) {
    Set-SessionName $name
    Remove-Item -LiteralPath $defaultMarker -Force -ErrorAction SilentlyContinue
  }
}

# ⚠️ 一條指令就好，不要再串一個 New-Item。嚮導自己發給 Codex 的規矩（AGENTS.md）是
# 「一個 shell 呼叫只做一件事，不要用 && || ; 串接」，注入違反自家規矩的指令等於在賭
# 模型怎麼處理；而且那個 mkdir 本來就是多的——這支腳本一開頭就把 $counterDir 建好了。
$relayCmd = "powershell -NoProfile -Command `"Set-Content -LiteralPath '$relayFile' -Value '{名稱}' -Encoding utf8`""

$rules = @(
  '命名規則：'
  '- 格式：{emoji} {中文敘述}，總長度 ≤ 40 字元，技術名詞保留英文'
  '- emoji 只能從這 8 個選：🏗️ build/implement/refactor、🔧 fix、🐛 debug、📐 plan/design、📋 review/audit、💬 discuss、⛴️ pilot/spike、🔍 research'
  '- 例外：skill 明確指定前綴時以 skill 為準（handoff 用 📦 標記「已交接」）'
  '- 根據對話「主要目的」命名，不是最新一句話'
) -join "`n"

function Send-NamingRequest([string]$HookEventName, [string]$LeadIn) {
  $ctx = "[session-namer] $LeadIn`n`n$rules`n`n執行指令（只需這一步，hook 會自動同步 sidebar 與 terminal tab）：`n$relayCmd"
  $json = @{ hookSpecificOutput = @{ hookEventName = $HookEventName; additionalContext = $ctx } } |
          ConvertTo-Json -Depth 5 -Compress
  # Write bytes directly: PowerShell 7 emits raw UTF-8 while 5.1 escapes
  # non-ASCII, and the default stdout encoding differs between them.
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $stdout = [Console]::OpenStandardOutput()
  $stdout.Write($bytes, 0, $bytes.Length)
  $stdout.Flush()
}

# UserPromptSubmit: name the session right after the user's first message
if ($EventName -eq 'prompt') {
  $promptFile = Join-Path $counterDir "$sessionKey.prompts"
  $pcount = (Read-Counter $promptFile) + 1
  Write-Counter $promptFile $pcount
  if ($pcount -eq 1) {
    New-Item -ItemType File -Force -Path $defaultMarker | Out-Null
    Send-NamingRequest 'UserPromptSubmit' '請依據用戶這句話的任務意圖為此 session 命名。'
  }
  exit 0
}

# PostToolUse: count tool calls
$count = (Read-Counter $counterFile) + 1
Write-Counter $counterFile $count

if ($count -eq 5) {
  # One-time re-evaluation now that there is real conversation to judge from
  Send-NamingRequest 'PostToolUse' '請根據到目前為止的討論重新評估 session 名稱：若現有名稱仍準確，寫入原名稱即可；否則換更貼切的名字。'
} elseif ($count -gt 5 -and ($count % 10) -eq 0 -and (Test-Path -LiteralPath $defaultMarker)) {
  Send-NamingRequest 'PostToolUse' '此 session 尚未命名，請為它命名。'
}
