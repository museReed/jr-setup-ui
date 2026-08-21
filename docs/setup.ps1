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

# 學生那條 one-liner 抓的永遠是 main。驗 PR 時在同一行前面設 $JrBranch 就會改抓
# 那個分支——這支腳本本身仍是從 main 抓的，所以 PR 若動到 bootstrap 自己，要另外驗。
#
#   $JrBranch="feature/ui-cards"; irm .../docs/setup.ps1 | iex
#
# 為什麼不做成 docs/setup-pr.ps1：那會變成第二份要跟著改的 bootstrap，而 bootstrap
# 的踩雷點（編碼、PATH 快照、多一層資料夾）都只在真的跑 irm | iex 時才現形——
# 兩份就是兩倍的沒被驗到。
$branch = Get-Variable -Name JrBranch -ValueOnly -ErrorAction SilentlyContinue
if (-not $branch) { $branch = "main" }

$appDir = Join-Path $HOME ".jr-setup\app"
$zipUrl = "https://codeload.github.com/museReed/jr-setup-ui/zip/refs/heads/$branch"
# GitHub 的 zip 解出來會多包一層 {repo}-{branch}，分支名裡的 / 會換成 -。
$extractedName = "jr-setup-ui-" + ($branch -replace "/", "-")

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

# 上一次的嚮導還開著的話，它握著 $appDir 底下的檔案，下面那句 Remove-Item 會
# 無限等下去——畫面停在「下載嚮導」，什麼訊息都沒有（VM 實測）。學生重跑一次
# 嚮導是很常見的動作，所以這裡要自己處理掉，不能靠他知道要先關視窗。
#
# ⚠️ 只殺「跑這份嚮導」的那幾個 node，不是全部的 node——學生可能有自己的專案在跑。
# node.exe 的 Path 是 Node 自己的安裝位置，看不出它在跑什麼，所以比對命令列。
$ours = @(
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -like "*$appDir*" }
)

if ($ours.Count -gt 0) {
  Write-Host "上一次的嚮導還開著（$($ours.Count) 個），先把它關掉。"
  $ours | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 500
}

Say "下載嚮導（$branch）"
$zipPath = Join-Path $env:TEMP "jr-setup-ui.zip"
$extractDir = Join-Path $env:TEMP "jr-setup-ui-extract"

# PowerShell 5.1 的 Invoke-WebRequest 會邊下載邊畫進度列，而那件事本身讓下載慢上
# 十幾倍——大檔案看起來就像整個卡死。關掉進度列是這個問題的標準解法，PS7 沒有這
# 個毛病，加了也無害。
$previousProgress = $ProgressPreference
$ProgressPreference = "SilentlyContinue"

try {
  Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath
} finally {
  $ProgressPreference = $previousProgress
}

if (Test-Path $extractDir) {
  Remove-Item -Recurse -Force $extractDir
}

Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

if (Test-Path $appDir) {
  Remove-Item -Recurse -Force $appDir
}

New-Item -ItemType Directory -Force -Path (Split-Path $appDir) | Out-Null
Move-Item (Join-Path $extractDir $extractedName) $appDir

# 留一張紙條說這份是從哪抓的。嚮導每次執行都會把它印進原始輸出——學生貼回來的
# log 裡才看得出他跑的是 main 還是我們請他驗的那條分支（畫面上完全看不出來，
# package.json 的 version 是 0.0.0 也幫不上忙）。
Set-Content -LiteralPath (Join-Path $appDir ".jr-source") -Value $branch -Encoding utf8
Remove-Item -Recurse -Force $extractDir
Remove-Item -Force $zipPath

Say "啟動嚮導（關掉這個視窗就會結束）"
node (Join-Path $appDir "bin\jr-setup-ui.js")
