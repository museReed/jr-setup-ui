#!/bin/bash
# jr-setup-ui bootstrap（macOS）
#
#   curl -fsSL https://musereed.github.io/jr-setup-ui/setup.sh | bash
#
# 這支腳本放在 docs/ 而不是 scripts/，因為 GitHub Pages 只能從 repo 根目錄或
# docs/ 發布。同學貼的那行網址就是指到這裡。
set -euo pipefail

# 版本寫死比動態解析可靠：開課前手動更新這一行就好。
NODE_VERSION="v24.18.0"
APP_DIR="$HOME/.jr-setup/app"
# 學生那條 one-liner 抓的永遠是 main。驗 PR 時用 JR_BRANCH 指定分支：
#
#   curl -fsSL .../setup.sh | JR_BRANCH=my-branch bash
#
# ⚠️ 變數要放在 bash 前面。寫成 `JR_BRANCH=x curl ... | bash` 是無效的——那個前綴只
# 作用在 curl，管線右邊的 bash 拿不到，於是這裡讀到空值、預設回 main，而且不會有任何
# 錯誤訊息（2026-08-20 驗收時整輪跑完才發現裝的是 main）。
# 分支（Windows 的 setup.ps1 用 $JrBranch，同一個意思）。
BRANCH="${JR_BRANCH:-main}"
TARBALL="https://codeload.github.com/museReed/jr-setup-ui/tar.gz/refs/heads/${BRANCH}"

# 卡在這裡的學生手上什麼都沒有：嚮導還沒下載，所以那顆「這一頁卡住了」根本不存在，
# gh 也還沒裝。唯一還走得通的管道是信。
#
# ⚠️ 主旨跟站內那顆按鈕刻意用不同的詞。「這一頁卡住了」開的是 GitHub issue，代表
# 嚮導跑得起來；信件是「裝不起來」，代表連嚮導都沒起來。收件匣一眼分得出哪一種急。
FEEDBACK_EMAIL="devlab20230424@gmail.com"

# 目前跑到哪一步。say 每次更新它，失敗時就有話可說——學生不必自己判斷「我是卡在
# 下載還是安裝」，那正是他現在最沒有餘裕做的事。
STEP="開始"

# 第二個參數是給主旨用的短名。省略就用標題本身——但標題常常帶括號說明
# （「安裝 Node.js v24.18.0（官方安裝檔，約 90 MB）」），整串放進主旨會又臭又長，
# 而學生是用手抄的。
say() {
  STEP="${2:-$1}"
  printf '\n\033[1m▸ %s\033[0m\n' "$1"
}

# 任何一步非零退出都走這裡。set -e 會讓腳本直接中斷，學生看到的原本只有一段紅字，
# 沒有人告訴他下一步該做什麼。
on_failure() {
  local code=$?

  # 正常結束（exec 出去啟動嚮導）不會走到這裡，但保險：0 就什麼都不印。
  [ "$code" -eq 0 ] && return 0

  # 學生自己按 Ctrl-C 不是失敗。跳出來還被叫去寄信，只會讓他覺得自己又弄壞了什麼。
  [ "$code" -eq 130 ] && return 0
  [ "$code" -eq 143 ] && return 0

  printf '\n\033[1m──────────────────────────────────────────\033[0m\n'
  printf '裝不起來了（結束代碼 %s）。這不是你的錯，我們來看一下。\n\n' "$code"
  printf '請把\033[1m這個視窗的文字全部反白複製\033[0m，寄到：\n'
  printf '  \033[1m%s\033[0m\n\n' "$FEEDBACK_EMAIL"
  printf '主旨請寫（照抄就好）：\n'
  printf '  \033[1mjr-setup 裝不起來｜mac｜%s\033[0m\n' "$STEP"
  printf '\033[1m──────────────────────────────────────────\033[0m\n'
}

trap on_failure EXIT

install_node() {
  local pkg="node-${NODE_VERSION}.pkg"
  local url="https://nodejs.org/dist/${NODE_VERSION}/${pkg}"
  local tmp
  tmp="$(mktemp -d)"

  say "安裝 Node.js ${NODE_VERSION}（官方安裝檔，約 90 MB）" "安裝 Node.js"
  curl -fL --progress-bar -o "${tmp}/${pkg}" "$url"

  echo "接下來要用系統管理員權限安裝，請輸入你的 Mac 密碼（畫面上不會顯示）："
  sudo installer -pkg "${tmp}/${pkg}" -target /
  rm -rf "$tmp"

  # 安裝檔寫進 /usr/local/bin，但目前這個 shell 的 PATH 是啟動時的快照。
  export PATH="/usr/local/bin:$PATH"
  hash -r
}

install_homebrew() {
  say "安裝 Homebrew（嚮導裡 git / gh 的安裝按鈕需要它）" "安裝 Homebrew"
  echo "這一步會下載 Xcode 命令列工具，可能要好幾分鐘，中途會要你的 Mac 密碼。"

  # NONINTERACTIVE 模式的 brew 安裝不會自己問密碼，它只做 sudo -v；沒有有效授權就
  # 直接死在 "Need sudo access on macOS"。
  #
  # 這個坑只在「Node 已經裝好」時才現形：Node 那一步的 sudo installer 會問密碼，
  # 系統把授權快取幾分鐘，brew 就沿用它。Node 被跳過時沒有人先問過，就當場失敗
  # （VM 實測）。所以這裡先明確要一次，不靠上一步的副作用。
  if ! sudo -v; then
    echo "沒有拿到管理員密碼，跳過 Homebrew。"
    echo "嚮導仍然可以用，只是 git / gh / ghostty 那幾顆安裝按鈕會失敗。"
    echo "之後想補裝，在終端機執行："
    echo '  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
    return
  fi

  NONINTERACTIVE=1 /bin/bash -c \
    "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

  # Apple Silicon 裝在 /opt/homebrew，不在預設 PATH 裡。
  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"

    if ! grep -qs 'opt/homebrew/bin/brew shellenv' "$HOME/.zprofile"; then
      echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> "$HOME/.zprofile"
    fi
  fi
}

say "jr-setup-ui 安裝嚮導" "剛開始"

if command -v node >/dev/null 2>&1; then
  echo "Node.js 已安裝：$(node --version)"
else
  install_node
fi

# 已經裝好的 brew 要先認出來，不然下面會誤判成沒裝而重跑一次安裝。
#
# curl | bash 開出來的是「非登入、非互動」的 bash：macOS 把 /etc/paths.d 交給
# path_helper 展開，而 path_helper 只在登入 shell 的 /etc/profile 裡跑；使用者的
# .zprofile / .zshrc 是 zsh 的檔案，bash 更不會讀。於是 /opt/homebrew/bin 不在 PATH，
# command -v brew 找不到它——即使 /etc/paths.d/homebrew 明明存在（VM 實測）。
#
# 順帶讓後面 exec 出去的嚮導也繼承得到 brew：它的安裝按鈕要叫得動 brew。
if ! command -v brew >/dev/null 2>&1 && [ -x /opt/homebrew/bin/brew ]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
fi

if command -v brew >/dev/null 2>&1; then
  echo "Homebrew 已安裝：$(brew --version | head -1)"
else
  install_homebrew
fi

say "下載嚮導（${BRANCH}）" "下載嚮導"
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR"
curl -fsSL "$TARBALL" | tar -xz -C "$APP_DIR" --strip-components=1

# 留一張紙條說這份是從哪抓的。嚮導每次執行都會把它印進原始輸出——學生貼回來的 log
# 裡才看得出他跑的是 main 還是我們請他驗的那條分支（畫面上完全看不出來）。
printf '%s\n' "$BRANCH" > "$APP_DIR/.jr-source"

say "啟動嚮導（關掉這個視窗就會結束）" "啟動嚮導"
# 用 exec 交棒：Ctrl-C 直接停掉嚮導，不會留下孤兒程序。
exec node "$APP_DIR/bin/jr-setup-ui.js"
