# jr-setup-ui bootstrap（Windows）
#
#   irm https://raw.githubusercontent.com/museReed/jr-setup-ui/main/docs/setup.ps1 | iex
#
# 這支腳本放在 docs/ 而不是 scripts/，因為 GitHub Pages 只能從 repo 根目錄或
# docs/ 發布（同一份檔案，說明頁跟它放一起）。
#
# ⚠️ 網址故意用 raw.githubusercontent.com 而不是 Pages：Pages 把 .ps1 當成
# application/octet-stream 送，irm 對非文字型別可能回傳位元組陣列而不是字串，
# 那樣 iex 就吃不下。raw 送的是 text/plain（實測確認），不會有這個問題。
# macOS 的 setup.sh 不受影響——curl 不看 content-type。
$ErrorActionPreference = "Stop"

$appDir = Join-Path $HOME ".jr-setup\app"
$zipUrl = "https://codeload.github.com/museReed/jr-setup-ui/zip/refs/heads/main"

function Say($text) {
  Write-Host ""
  Write-Host "▸ $text" -ForegroundColor Cyan
}

# 剛裝好的東西寫進登錄檔的 PATH，但目前這個 PowerShell 拿的是啟動當下的快照。
# 重讀一次就不用叫同學關掉重開。
function Update-PathFromRegistry {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machine;$user"
}

function Install-Node {
  Say "安裝 Node.js LTS"

  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "這台電腦沒有 winget。請到 https://nodejs.org/en/download 下載 Windows Installer (.msi) 手動安裝後再跑一次。"
  }

  # --source winget 不能省：不指定會去撞 msstore 的憑證驗證而整包裝不起來。
  winget install --id OpenJS.NodeJS.LTS -e --source winget `
    --accept-source-agreements --accept-package-agreements

  Update-PathFromRegistry

  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node 裝完了但這個視窗還叫不到它。請關掉 PowerShell、重新開一個，再貼一次同樣的指令。"
  }
}

Say "jr-setup-ui 安裝嚮導"

Update-PathFromRegistry

if (Get-Command node -ErrorAction SilentlyContinue) {
  Write-Host "Node.js 已安裝：$(node --version)"
} else {
  Install-Node
}

Say "下載嚮導"
$zipPath = Join-Path $env:TEMP "jr-setup-ui.zip"
$extractDir = Join-Path $env:TEMP "jr-setup-ui-extract"
Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath

if (Test-Path $extractDir) {
  Remove-Item -Recurse -Force $extractDir
}

Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

if (Test-Path $appDir) {
  Remove-Item -Recurse -Force $appDir
}

New-Item -ItemType Directory -Force -Path (Split-Path $appDir) | Out-Null
# zip 解出來會多包一層 jr-setup-ui-main，直接把那層搬成 app。
Move-Item (Join-Path $extractDir "jr-setup-ui-main") $appDir
Remove-Item -Recurse -Force $extractDir
Remove-Item -Force $zipPath

Say "啟動嚮導（關掉這個視窗就會結束）"
node (Join-Path $appDir "bin\jr-setup-ui.js")
