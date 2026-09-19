#!/usr/bin/env pwsh
# set-session-name.ps1 — Windows counterpart of set-session-name.sh.
# Single entry point for session naming, called by both:
#   - session-auto-namer.ps1 (hook-injected WRITE_CMD)
#   - auto-rename skill (manual /auto-rename)
#
# Usage: set-session-name.ps1 '{emoji} {name}' '<session-key>'
#
# The session key is Claude Code's session_id, baked into the command the hook
# injects. It keys the record file and the default marker. Windows pids cannot
# do this job: each hook runs under a throwaway shell whose pid differs every
# time and is dead by the time this script looks it up (VM testing), which
# collapsed every session onto a single 0.txt.
#
# Manual /auto-rename has no session_id to pass, so it falls back to the pid
# chain. The tab title never depends on either — that goes through
# SetConsoleTitle — so the fallback only affects which record file is written.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Name,
  [string]$SessionKey = ''
)

$ErrorActionPreference = 'Continue'

# Validate the emoji: the model sometimes picks one outside the list (VM sighting:
# 🎯). Rewording the instruction only asks it nicely — this is the last gate.
# Anything else becomes 🔍; the rest of the name is left alone.
#
# 📦 (0x1F4E6) is the 9th: the handoff skill marks "已交接" with it. It used to be
# missing here, so every handoff silently retitled to 🔍 — the script says nothing,
# so it looked like the rename never ran at all (VM testing, three rounds to find).
# The naming hook still offers the model only the 8; 📦 is skill-only.
$allowedEmoji = @([char]::ConvertFromUtf32(0x1F3D7), [char]::ConvertFromUtf32(0x1F527),
  [char]::ConvertFromUtf32(0x1F41B), [char]::ConvertFromUtf32(0x1F4D0),
  [char]::ConvertFromUtf32(0x1F4CB), [char]::ConvertFromUtf32(0x1F4AC),
  [char]::ConvertFromUtf32(0x26F4), [char]::ConvertFromUtf32(0x1F50D),
  [char]::ConvertFromUtf32(0x1F4E6))
# A name already starting with '[' carries the project tag — it is an existing
# name being re-applied, so its emoji was validated on the way in. Without this
# it would look like "no emoji" and get a 🔍 bolted onto the front of the tag.
if (-not $Name.StartsWith('[') -and
    -not ($allowedEmoji | Where-Object { $Name.StartsWith($_) })) {
  $rest = if ($Name -match '^\S+\s+(.*)$') { $Matches[1] } else { $Name }
  $Name = "$([char]::ConvertFromUtf32(0x1F50D)) $rest"
}
$utf8 = New-Object System.Text.UTF8Encoding $false

# 專案前綴：AI 在跑的時候 TUI 蓋住 shell 提示字元，名字是唯一還看得出「這是哪個
# 專案」的地方。從工作目錄推導，git repo 根目錄優先。家目錄和磁碟根目錄不算專案。
function Get-ProjectTag {
  $dir = if ($env:CLAUDE_PROJECT_DIR) { $env:CLAUDE_PROJECT_DIR } else { (Get-Location).Path }
  if (-not $dir) { return '' }
  try {
    $root = & git -C $dir rev-parse --show-toplevel 2>$null
    if ($LASTEXITCODE -eq 0 -and $root) { $dir = $root.Trim() }
  } catch {}
  try { $full = [System.IO.Path]::GetFullPath($dir) } catch { return '' }
  $home_ = [System.IO.Path]::GetFullPath($HOME)
  if ($full.TrimEnd('\', '/') -eq $home_.TrimEnd('\', '/')) { return '' }
  if ($full -eq [System.IO.Path]::GetPathRoot($full)) { return '' }
  return (Split-Path -Leaf $full)
}

if (-not $Name.StartsWith('[')) {
  $tag = Get-ProjectTag
  if ($tag) { $Name = "[$tag] $Name" }
}

function Get-ParentPid([int]$ProcessId) {
  if ($ProcessId -le 0) { return 0 }
  try {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop
    return [int]$p.ParentProcessId
  } catch { return 0 }
}

function Write-ConsoleTitle([string]$Text) {
  # SetConsoleTitle, not OSC. A hook's stdout is a pipe Claude Code captures, so
  # OSC written there never reaches the terminal — and VM verification (T5)
  # showed OSC written to the \\.\CONOUT$ device opens fine but retitles nothing.
  # [Console]::Title goes through SetConsoleTitle instead, which bypasses stdout
  # entirely and works cross-process (spike TEST 1/4).
  try { [Console]::Title = $Text; return } catch {}
  # Fallback for hosts without a console title (stdout must be the console).
  try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}
  try { [Console]::Write(([char]27) + "]0;$Text" + ([char]7)) } catch {}
}

if ($SessionKey) {
  $key = $SessionKey -replace '[^A-Za-z0-9._-]', '_'
} else {
  # Manual /auto-rename: no session_id available, walk the pid chain instead.
  # Never key on a bare 0 — an unresolvable pid would make every session share
  # one record file and clobber each other.
  $agentPid = Get-ParentPid $PID
  $terminalPid = Get-ParentPid $agentPid
  $key = if ($terminalPid -gt 0) { "pid-$terminalPid" } else { "unresolved-$PID" }
}

$namesDir = Join-Path $HOME '.claude\session-names'
New-Item -ItemType Directory -Force -Path $namesDir | Out-Null
[System.IO.File]::WriteAllText((Join-Path $namesDir "$key.txt"), $Name, $utf8)

# 這個 session 是不是背景 session？
#
# POSIX 版是拿 Claude 的 pid 去查 sessions/{pid}.json，Windows 上沒有這條路——每個
# hook 都跑在一個用完就死的 shell 底下，pid 每次不同而且查的時候已經不在了（VM 實測，
# 當初就是因為這樣所有 session 都塌成同一個 0.txt）。所以改用 session_id 反查：job
# 記錄裡本來就有 sessionId 欄位。
#
# 手動 /auto-rename 沒有 session_id 可用，這時查不到 job 就走互動路徑。在背景 session
# 裡手動改名會因此只寫名稱檔、不寫 job state；後果僅止於那一次改名不會反映到膠囊，
# 不會壞掉。
function Get-JobStatePath([string]$SessionId) {
  if (-not $SessionId) { return '' }
  $jobsDir = Join-Path $HOME '.claude\jobs'
  if (-not (Test-Path -LiteralPath $jobsDir)) { return '' }
  foreach ($dir in Get-ChildItem -LiteralPath $jobsDir -Directory -ErrorAction SilentlyContinue) {
    $statePath = Join-Path $dir.FullName 'state.json'
    if (-not (Test-Path -LiteralPath $statePath)) { continue }
    try {
      $state = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch { continue }
    if ($state.sessionId -eq $SessionId -or $state.resumeSessionId -eq $SessionId) {
      return $statePath
    }
  }
  return ''
}

$jobStatePath = Get-JobStatePath $SessionKey

if ($jobStatePath) {
  # 背景：只寫 job state，顯示交給 Claude Code
  #
  # 它跟「生它的那個互動 session」共用同一個終端分頁，兩邊搶著寫標題的話畫面上是名字
  # 來回閃。改成只寫 name + nameSource:"user"，Claude Code 會 fs.watch 這個檔並收下，
  # statusline、名稱膠囊、tab 三處就都是同一個名字。
  #
  # 只有 nameSource 是 user / collision 才會被採用；auto / derived 是它自己推導的
  # slug，會被重新產生，所以兩個欄位都得寫。
  #
  # ⚠️ ConvertTo-Json 預設只展開兩層，state.json 有巢狀物件（inFlight、output），
  # 不給 -Depth 會被截成字串。先寫暫存檔再 Move，避免 daemon 讀到寫到一半的檔案。
  try {
    $state = Get-Content -LiteralPath $jobStatePath -Raw -Encoding UTF8 | ConvertFrom-Json
    $state | Add-Member -NotePropertyName name -NotePropertyValue $Name -Force
    $state | Add-Member -NotePropertyName nameSource -NotePropertyValue 'user' -Force
    $tmp = "$jobStatePath.namewrite.$PID"
    [System.IO.File]::WriteAllText($tmp, ($state | ConvertTo-Json -Depth 100), $utf8)
    Move-Item -LiteralPath $tmp -Destination $jobStatePath -Force
  } catch {}
} elseif ($env:AI_TAB_SYNC_FILE) {
  # myclaude wrapper: watcher owns the tab, just write the sync file
  try { [System.IO.File]::WriteAllText($env:AI_TAB_SYNC_FILE, $Name, $utf8) } catch {}
} else {
  # no wrapper: write OSC title straight to the console device
  Write-ConsoleTitle $Name
}

$marker = Join-Path ([System.IO.Path]::GetTempPath()) "claude-session-namer\$key.default"
Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue
