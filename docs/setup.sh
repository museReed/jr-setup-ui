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
TARBALL="https://codeload.github.com/museReed/jr-setup-ui/tar.gz/refs/heads/main"

say() {
  printf '\n\033[1m▸ %s\033[0m\n' "$1"
}

install_node() {
  local pkg="node-${NODE_VERSION}.pkg"
  local url="https://nodejs.org/dist/${NODE_VERSION}/${pkg}"
  local tmp
  tmp="$(mktemp -d)"

  say "安裝 Node.js ${NODE_VERSION}（官方安裝檔，約 90 MB）"
  curl -fL --progress-bar -o "${tmp}/${pkg}" "$url"

  echo "接下來要用系統管理員權限安裝，請輸入你的 Mac 密碼（畫面上不會顯示）："
  sudo installer -pkg "${tmp}/${pkg}" -target /
  rm -rf "$tmp"

  # 安裝檔寫進 /usr/local/bin，但目前這個 shell 的 PATH 是啟動時的快照。
  export PATH="/usr/local/bin:$PATH"
  hash -r
}

install_homebrew() {
  say "安裝 Homebrew（嚮導裡 git / gh 的安裝按鈕需要它）"
  echo "這一步會下載 Xcode 命令列工具，可能要好幾分鐘，中途會要你的 Mac 密碼。"
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

say "jr-setup-ui 安裝嚮導"

if command -v node >/dev/null 2>&1; then
  echo "Node.js 已安裝：$(node --version)"
else
  install_node
fi

if command -v brew >/dev/null 2>&1; then
  echo "Homebrew 已安裝：$(brew --version | head -1)"
else
  install_homebrew
fi

say "下載嚮導"
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR"
curl -fsSL "$TARBALL" | tar -xz -C "$APP_DIR" --strip-components=1

say "啟動嚮導（關掉這個視窗就會結束）"
# 用 exec 交棒：Ctrl-C 直接停掉嚮導，不會留下孤兒程序。
exec node "$APP_DIR/bin/jr-setup-ui.js"
