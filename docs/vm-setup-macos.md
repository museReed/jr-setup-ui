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
| `claude` / `codex` 的安裝 | 走各自官方的原生安裝器，都裝到 `~/.local/bin`，跟 npm 和 brew 都無關。⛔ 不能改回 `npm install -g`——見下方「為什麼不用 npm」 |
| 裝完按「重新檢查」 | 這一版仍需**重開嚮導**才會變綠：`~/.local/bin` 是安裝當下才進 PATH 的，正在跑的嚮導拿的是啟動時那份快照 |
| 開一個**新的**終端機打 `claude` / `codex` | 都要叫得出來。舊視窗不算數 |
| 三顆登入按鈕 | GitHub → Codex → Claude；Claude 那顆要把授權代碼貼進輸出區下方那格 |

### 為什麼不用 npm（2026-08-04 乾淨 VM 實測）

官方 `.pkg` 裝的 Node 把全域套件目錄放在 `/usr/local/lib/node_modules`，那是 root 的，
學生帳號按下去就是 `EACCES`。Windows 一直沒撞到，是因為它的全域目錄在 `%APPDATA%`。

npm 的錯誤訊息會建議「try running the command again as root」，**對這兩個 CLI 是錯的**：
sudo 裝出來的東西屬於 root，之後自動更新用學生身分跑、寫不進去，而且是靜默失敗。

### 兩支安裝器的差異（不要照著其中一支類推）

| | PATH 誰負責 | 會不會停下來問問題 |
|---|---|---|
| claude | **嚮導補**——它自己不碰 shell rc，只印一行提醒 | 不會 |
| codex | **它自己寫 `~/.zprofile`**，嚮導不要插手 | **會**：「Start Codex now? [y/N]」，所以嚮導帶 `CODEX_NON_INTERACTIVE=1` |

codex 那個提問是寫到 `/dev/tty`、也從 `/dev/tty` 讀。嚮導 spawn 的子程序繼承了啟動嚮導
的那個終端機，所以問句會印在學生沒在看的終端機視窗，然後停在那裡等。畫面上只會看到
一張卡卡住直到逾時。網頁那格輸入框救不了——它寫的是 stdin，安裝器繞過 stdin。

## 4. 已知缺口：git / gh 的安裝按鈕需要 Homebrew

那兩顆按鈕跑的是 `brew install`，全新 Mac 沒有 Homebrew 會直接失敗。
這是還沒決定怎麼補的設計缺口，不是新 bug。

**嚮導不能代裝 brew**：Homebrew 的安裝腳本要 `sudo` 密碼，而嚮導 spawn 子程序是
`stdio: pipe`、沒有 tty，sudo 讀不到密碼；而且它會連帶裝 Xcode 命令列工具，要好幾分鐘。
所以 `claude` / `codex` 都刻意不依賴 brew——真要補這個缺口，只能是「學生自己在
終端機貼一行指令」的手動卡。

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
