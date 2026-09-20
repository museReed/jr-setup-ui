# Shared Windows helpers for one versioned Codex app-server on a loopback port.

$script:JrControlDir = Join-Path $HOME '.codex\app-server-control'
$script:JrStateFile = Join-Path $script:JrControlDir 'windows-app-server.json'
$script:JrPidFile = Join-Path $script:JrControlDir 'windows-app-server.pid'
$script:JrPortStart = 4500
$script:JrPortEnd = 4599

function Get-JrRealCodexPath {
  $candidates = @(Get-Command codex -CommandType Application -All -ErrorAction SilentlyContinue |
    Where-Object { Test-Path -LiteralPath $_.Source -PathType Leaf })
  $native = @($candidates | Where-Object {
    [System.IO.Path]::GetExtension($_.Source) -in @('.exe', '.com')
  } | ForEach-Object { $_.Source })
  if ($native.Count -gt 0) { return $native[0] }
  $all = @($candidates | ForEach-Object { $_.Source })
  if ($all.Count -gt 0) { return $all[0] }
  return $null
}

function Get-JrCodexVersion([string]$CodexPath) {
  $line = & $CodexPath --version 2>$null | Select-Object -First 1
  if ($null -eq $line) { return '' }
  return ([string]$line).Trim()
}

function Test-JrLoopbackEndpoint([string]$Url) {
  try {
    $uri = [Uri]$Url
    return $uri.Scheme -eq 'ws' -and $uri.Host -in @('127.0.0.1', 'localhost', '::1') -and $uri.Port -gt 0
  } catch {
    return $false
  }
}

function Test-JrAppServerReady([string]$Url) {
  if (-not (Test-JrLoopbackEndpoint $Url)) { return $false }
  try {
    $uri = [Uri]$Url
    $response = Invoke-WebRequest `
      -Uri "http://$($uri.Host):$($uri.Port)/readyz" `
      -UseBasicParsing `
      -TimeoutSec 1
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Get-JrListenerPid([string]$Url) {
  if (-not (Test-JrLoopbackEndpoint $Url)) { return $null }
  $uri = [Uri]$Url
  $listener = @(Get-NetTCPConnection `
    -LocalPort $uri.Port `
    -State Listen `
    -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ($listener.Count -eq 0) { return $null }
  return [int]$listener[0].OwningProcess
}

function Test-JrCodexServerProcess([int]$ProcessId) {
  $process = Get-CimInstance Win32_Process `
    -Filter "ProcessId = $ProcessId" `
    -ErrorAction SilentlyContinue
  if ($null -eq $process) { return $false }
  if ($process.Name -notin @('codex.exe', 'codex')) { return $false }
  if (-not $process.CommandLine -or $process.CommandLine -notmatch 'app-server') { return $false }
  return $true
}

function Read-JrAppServerState {
  if (-not (Test-Path -LiteralPath $script:JrStateFile -PathType Leaf)) { return $null }
  try {
    $state = Get-Content -LiteralPath $script:JrStateFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($state.schemaVersion -ne 1) { return $null }
    if (-not (Test-JrLoopbackEndpoint ([string]$state.endpoint))) { return $null }
    if ([int]$state.pid -le 0) { return $null }
    return $state
  } catch {
    return $null
  }
}

function Write-JrAppServerState([object]$State) {
  New-Item -ItemType Directory -Force -Path $script:JrControlDir | Out-Null
  $temporary = "$script:JrStateFile.$PID.tmp"
  $json = $State | ConvertTo-Json -Depth 4
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($temporary, "$json`n", $utf8)
  Move-Item -LiteralPath $temporary -Destination $script:JrStateFile -Force
  [System.IO.File]::WriteAllText($script:JrPidFile, "$($State.pid)")
}

function Test-JrManagedState([object]$State) {
  if ($null -eq $State) { return $false }
  $listenerPid = Get-JrListenerPid ([string]$State.endpoint)
  if ($null -eq $listenerPid -or $listenerPid -ne [int]$State.pid) { return $false }
  if (-not (Test-JrCodexServerProcess ([int]$State.pid))) { return $false }
  return Test-JrAppServerReady ([string]$State.endpoint)
}

function Get-JrLegacyState([string]$CodexVersion) {
  $legacyEndpoint = 'ws://127.0.0.1:4500'
  if (-not (Test-JrAppServerReady $legacyEndpoint)) { return $null }
  $listenerPid = Get-JrListenerPid $legacyEndpoint
  if ($null -eq $listenerPid -or -not (Test-JrCodexServerProcess $listenerPid)) { return $null }
  if (-not (Test-Path -LiteralPath $script:JrPidFile -PathType Leaf)) { return $null }
  $knownPid = ([string](Get-Content -LiteralPath $script:JrPidFile -Raw -ErrorAction SilentlyContinue)).Trim()
  if ($knownPid -ne [string]$listenerPid) { return $null }
  return [pscustomobject]@{
    schemaVersion = 1
    pid = $listenerPid
    endpoint = $legacyEndpoint
    codexVersion = $CodexVersion
    startedAtUtc = [DateTime]::UtcNow.ToString('o')
  }
}

function Get-JrCandidateEndpoints([string]$PreferredEndpoint) {
  $seen = @{}
  $result = New-Object System.Collections.Generic.List[string]
  if (Test-JrLoopbackEndpoint $PreferredEndpoint) {
    $result.Add($PreferredEndpoint)
    $seen[$PreferredEndpoint] = $true
  }
  foreach ($port in $script:JrPortStart..$script:JrPortEnd) {
    $candidate = "ws://127.0.0.1:$port"
    if (-not $seen.ContainsKey($candidate)) {
      $result.Add($candidate)
      $seen[$candidate] = $true
    }
  }
  return @($result)
}

function Start-JrAppServer([string]$CodexPath, [string]$CodexVersion, [string]$PreferredEndpoint) {
  New-Item -ItemType Directory -Force -Path $script:JrControlDir | Out-Null
  $stdout = Join-Path $script:JrControlDir 'windows-app-server.out.log'
  $stderr = Join-Path $script:JrControlDir 'windows-app-server.err.log'

  foreach ($endpoint in (Get-JrCandidateEndpoints $PreferredEndpoint)) {
    if ($null -ne (Get-JrListenerPid $endpoint)) { continue }
    try {
      $process = Start-Process -FilePath $CodexPath `
        -ArgumentList @('app-server', '--listen', $endpoint) `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr `
        -PassThru
    } catch {
      continue
    }

    foreach ($attempt in 1..50) {
      if ((Test-JrAppServerReady $endpoint) -and (Get-JrListenerPid $endpoint) -eq $process.Id) {
        $state = [pscustomobject]@{
          schemaVersion = 1
          pid = $process.Id
          endpoint = $endpoint
          codexVersion = $CodexVersion
          startedAtUtc = [DateTime]::UtcNow.ToString('o')
        }
        Write-JrAppServerState $state
        return $state
      }
      if ($process.HasExited) { break }
      Start-Sleep -Milliseconds 100
    }
    if (-not $process.HasExited) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
  }

  throw "Codex app-server 找不到可用的 localhost port（已嘗試 $script:JrPortStart-$script:JrPortEnd）。"
}

function Get-JrAppServer([string]$CodexPath, [string]$CodexVersion, [string]$PreferredEndpoint) {
  $mutex = New-Object System.Threading.Mutex($false, 'Local\jr-setup-ui-codex-app-server')
  $locked = $false
  try {
    try { $locked = $mutex.WaitOne(10000) } catch [System.Threading.AbandonedMutexException] { $locked = $true }
    if (-not $locked) { throw '等待 Codex app-server 啟動鎖逾時。' }

    $state = Read-JrAppServerState
    if (Test-JrManagedState $state) { return $state }

    $legacy = Get-JrLegacyState $CodexVersion
    if ($null -ne $legacy) {
      Write-JrAppServerState $legacy
      return $legacy
    }

    return Start-JrAppServer $CodexPath $CodexVersion $PreferredEndpoint
  } finally {
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
  }
}
