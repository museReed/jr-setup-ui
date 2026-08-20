#!/usr/bin/env powershell.exe
# Rename a Codex thread through the shared localhost app-server.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ThreadId,
  [Parameter(Mandatory = $true)][string]$Name
)

$ErrorActionPreference = 'Stop'
$endpoint = if ($env:CODEX_APP_SERVER_URL) { $env:CODEX_APP_SERVER_URL } else { 'ws://127.0.0.1:4500' }
$timeoutMs = 3000
$utf8 = New-Object System.Text.UTF8Encoding $false

function Send-Json([System.Net.WebSockets.ClientWebSocket]$Socket, [object]$Value, [Threading.CancellationToken]$Token) {
  $json = $Value | ConvertTo-Json -Depth 8 -Compress
  $bytes = $utf8.GetBytes($json)
  $segment = New-Object System.ArraySegment[byte] -ArgumentList @(,$bytes)
  $Socket.SendAsync($segment, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $Token).GetAwaiter().GetResult()
}

function Receive-Response([System.Net.WebSockets.ClientWebSocket]$Socket, [int]$RequestId, [Threading.CancellationToken]$Token) {
  while ($true) {
    $buffer = New-Object byte[] 8192
    $stream = New-Object System.IO.MemoryStream
    do {
      $segment = New-Object System.ArraySegment[byte] -ArgumentList @(,$buffer)
      $result = $Socket.ReceiveAsync($segment, $Token).GetAwaiter().GetResult()
      if ($result.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) {
        throw 'app-server closed the WebSocket'
      }
      $stream.Write($buffer, 0, $result.Count)
    } while (-not $result.EndOfMessage)

    $message = $utf8.GetString($stream.ToArray()) | ConvertFrom-Json
    if ($message.id -ne $RequestId) { continue }
    if ($null -ne $message.error) { throw ($message.error | ConvertTo-Json -Compress) }
    return $message.result
  }
}

$socket = New-Object System.Net.WebSockets.ClientWebSocket
$timeout = New-Object System.Threading.CancellationTokenSource
$timeout.CancelAfter($timeoutMs)
try {
  $socket.ConnectAsync([Uri]$endpoint, $timeout.Token).GetAwaiter().GetResult()
  Send-Json $socket ([ordered]@{
    method = 'initialize'
    id = 1
    params = @{ clientInfo = @{ name = 'codex-session-namer'; title = 'Codex Session Namer'; version = '1.0.0' } }
  }) $timeout.Token
  $null = Receive-Response $socket 1 $timeout.Token
  Send-Json $socket ([ordered]@{ method = 'initialized'; params = @{} }) $timeout.Token
  Send-Json $socket ([ordered]@{
    method = 'thread/name/set'
    id = 2
    params = @{ threadId = $ThreadId; name = $Name }
  }) $timeout.Token
  $null = Receive-Response $socket 2 $timeout.Token
} catch {
  throw
} finally {
  if ($socket.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
    try { $socket.Dispose() } catch {}
  }
  $timeout.Dispose()
}
