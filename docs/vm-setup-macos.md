# macOS VM 測試指令

在 VM 裡用瀏覽器開這一頁，指令就地複製，不用靠跨機器的剪貼簿同步。

## 1. 裝 Node

沒有 Homebrew 的全新 Mac 走官方 `.pkg`：開 <https://nodejs.org/en/download>，
抓 **macOS Installer (.pkg)**（Apple Silicon 選 ARM64），下載後雙擊一路下一步。

裝完在 Terminal 確認（叫不出來就關掉 Terminal 重開）：

```bash
node --version
```

## 2. 抓嚮導並啟動

```bash
cd ~
rm -rf jr-setup-ui-feature-install-buttons
curl -L -o jr.zip https://github.com/museReed/jr-setup-ui/archive/refs/heads/feature/install-buttons.zip
unzip -o jr.zip
node jr-setup-ui-feature-install-buttons/bin/jr-setup-ui.js
```

macOS 會自動開瀏覽器，不用自己複製網址。

## 3. 這一輪要看什麼

| 步驟 | 預期 / 要注意的 |
|---|---|
| 剛開頁面 | 少一項「PowerShell 執行原則」（Windows 限定），其餘八項 |
| `git` 那項 | macOS 內建一個 `git` 殼，第一次跑會跳「要不要裝 Xcode 命令列工具」對話框——**這格顯示什麼要回報** |
| 按 `git` / `gh` 的安裝 | **預期失敗**，見下一節 |
| `claude` / `codex` 的安裝 | 走 `npm install -g`，跟 brew 無關，應該成功 |
| 三顆登入按鈕 | GitHub → Codex → Claude；Claude 那顆要把授權代碼貼進輸出區下方那格 |

## 4. 已知缺口：git / gh 的安裝按鈕需要 Homebrew

那兩顆按鈕跑的是 `brew install`，全新 Mac 沒有 Homebrew 會直接失敗。
這是還沒決定怎麼補的設計缺口，不是新 bug。

**測試順序**：先在**沒有 brew** 的狀態下按一次，把失敗訊息記下來——那是同學會
看到的畫面。看完再裝 brew：

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

會要 Mac 密碼，並自動裝 Xcode 命令列工具（要跑幾分鐘）。Apple Silicon 裝完
還要把 brew 加進 PATH：

```bash
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
```

```bash
eval "$(/opt/homebrew/bin/brew shellenv)"
```

```bash
brew --version
```

裝完 brew 要**重開嚮導**——正在跑的 server 拿的是舊 PATH，叫不到 brew。

## 5. 出狀況時

黑色輸出區的內容整段貼回來（`exit code` 那行常常才是關鍵）。也可以直接跑
診斷腳本拿每一步的耗時：

```bash
node jr-setup-ui-feature-install-buttons/scripts/probe-debug.mjs
```
