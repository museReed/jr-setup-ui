# 家目錄裡的東西不是學生的

2026-08-16 那場課出現的一種狀況：學生的家目錄**自己寫得進去**，但裡面幾樣特定的
東西屬於 root，他的帳號改不動。畫面上看起來是好幾張卡各壞一次，其實是同一件事。

## 症狀長什麼樣

同一位學生、同一台機器、兩張不同的卡（[jr-setup-feedback#6](https://github.com/museReed/jr-setup-feedback/issues/6)）：

```
--- login-gh ---
! First copy your one-time code: 1558-B032
Open this URL to continue in your web browser: https://github.com/login/device
✓ Authentication complete.
- gh config set -h github.com git_protocol https
✓ Configured git protocol
mkdir ~/.config/gh: permission denied
exit code: 1
```

```
--- install-config-step --step=tab-sync ---
已備份 → ai-tab-sync.sh.bak.20260816144356
已備份 → .zshrc.bak.20260816144356
EACCES: permission denied, open '~/.zshrc'
exit code: 1
```

⚠️ **授權是成功的。** 網頁那一段走完了、`gh` 也真的拿到 token，死在最後一步：
把它寫回 `~/.config/gh`。學生看到的是「登入失敗」，於是再按一次——而每一次都會
重跑一遍整個裝置授權流程，再死在同一行。回報裡他按了兩次；截圖那位按到第三次。

## 判準：家目錄可寫，裡面幾樣不可寫

第二段是關鍵證據。`.zshrc.bak.…` **建得出來**——那需要家目錄本身可寫；緊接著開
`.zshrc` 卻 `EACCES`——那是那個檔案自己的問題。所以不是「整個家目錄壞了」，是
**裡面幾樣特定的東西被 root 拿走了**。

怎麼變成這樣的：某個帶 `sudo` 的指令第一次建出／改寫了它們。macOS 的 `sudo` 預設
保留 `$HOME`，所以 root 跑出來的東西照樣落在學生的家目錄裡，而且屬於 root。

⚠️ 這門課自己就有一條這種指令：[returning-students.md](returning-students.md) 請
學生自己跑 `sudo npm uninstall -g <套件名>`。不確定那位學生是不是踩到這條，但這
條確實在我們的教材裡。

## 嚮導現在怎麼處理

| 東西 | 在哪 |
|---|---|
| 判準（哪幾樣要能寫、哪幾樣現在不能寫） | `src/home-perms.js` |
| 那一列（只在真的有問題時才出現） | `env-check.js` 的 `checkHomePerms` |
| gh 那一列改口 | `env-check.js` 的 `checkGhAuth` |
| 修復（開真終端跑 chown） | `scripts/fix-home-perms.mjs` |
| 卡片標題與說明 | `public/model.js` 的 `ENV_CARD_META`／`ENV_FIRST` |

四個決定，每一個都有理由：

**1. 獨立一列，而且排在整段最前面。** 學生按下去的每一顆按鈕都會撞到同一件事。
每張卡各報一次 `permission denied` 的話，看起來像五個毛病——而它是一個。排在最前
面才來得及在他一路按下去之前擋住。

**2. `gh` 那一列不再寫「未登入」。** 「未登入」配一顆「開始登入」是一條死路：授權
每次都會走完，然後 token 存不下來。設定夾被鎖住時那一列改口，按鈕也換成修權限
那顆（判準見 `ghConfigBlocked`）。

⚠️ **只有 `gh auth status` 失敗時才看權限。** 設定夾不可寫、但 `gh` 仍讀得到既有
token 的機器是綠燈——那種也判成黃燈的話，一台正常在用的機器會被我們說成有毛病。

**3. 修復開一個真的終端視窗。** `chown` 要 `sudo`，而 `sudo` 要一個 tty 才問得到
密碼；嚮導 spawn 出來的子行程是 `stdio: pipe`、沒有 tty，`sudo` 在那裡不會問，只會
直接失敗（`docs/vm-setup-macos.md` 記過同一件事）。

⚠️ **不在嚮導裡開一格輸入框收密碼再餵給 `sudo`。** 那等於教學生「把 Mac 密碼打進
一個網頁」，而這門課後面整段都在講不要這樣做。

**4. 範圍只有我們自己會寫的那幾樣**（`WRITE_TARGETS`）。整個家目錄掃一遍會點名學生
自己的東西，那是他的機器、他的選擇——跟 `src/leftovers.js` 那條「只動我們自己搬走
的」是同一條界線。家目錄本身如果也不可寫，只 `chown` 它自己、**不加 `-R`**：遞迴
下去會掃到 Library 與 iCloud。

## 順手修掉的一個小毛病

`scripts/install-configs.mjs` 的 `backup()` 原本先備份、再寫入。目標改不動的時候，
每按一次就留下一份沒有用的 `.bak`——回報裡那位學生按了三次，家目錄多了六個。
現在改成**先確認改得動再備份**，而且那句錯誤直接告訴他去按哪一顆按鈕。

## 怎麼在 VM 上重現

```bash
node scripts/seed-dirty-env.mjs           # 先看不動
node scripts/seed-dirty-env.mjs --apply   # root-owned-home 那一步會問你的密碼
```

⚠️ 那一步**不動家目錄本身**，只動 `~/.config` 與 `~/.zshrc`——那才是回報裡的形狀。

修回去（不想重跑整個嚮導的話）：

```bash
sudo chown -R "$(id -un):$(id -gn)" ~/.config ~/.zshrc
```
