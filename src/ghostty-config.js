// Ghostty 裝好之後要幫學生打開的那幾個開關。
//
// 為什麼要嚮導代勞：這幾項都不是「偏好」，是**後面每一步的前提**——標題列會不會消失、
// 分頁名字會不會被蓋掉、指令跑完會不會通知。學生自己去翻 Ghostty 的設定檔找不到，
// 也不知道該找什麼。
//
// ⚠️ 這裡只負責「產生內容」與「看現在對不對」，真正動檔案的是
// scripts/fix-ghostty-config.mjs。拆開是為了測得到：判準全是純函式，不必真的去改
// 一台機器的設定才驗得了。
import { hasMarkedBlock, upsertBlock } from "./config-install.js";

// 兩個檔案、兩個標記，因為它們的擁有者不同：一個是 Ghostty 的設定，一個是 shell 的。
// 用標記包起來的理由跟 tab-sync 那段一樣——學生的設定檔裡本來就可能有他自己的東西，
// 我們只換自己那一段，重跑安裝也不會把別人的設定洗掉。
export const GHOSTTY_MARKER = "jr-setup ghostty";
export const ZSH_MARKER = "jr-setup zsh";

export function ghosttyConfigPath(home) {
  return `${home}/.config/ghostty/config`;
}

export function zshrcPath(home) {
  return `${home}/.zshrc`;
}

// ⚠️ 每一行都附上為什麼。這個檔案會被學生看到（他們會好奇嚮導改了什麼），而且半年後
// 回來改的人需要知道哪一行不能動。
export function ghosttyBlock() {
  return [
    "# 一開就最大化，而不是全螢幕。",
    "# macOS 原生全螢幕會自動隱藏標題列（含那排分頁），而且沒有任何設定能把它釘住；",
    "# macos-non-native-fullscreen 更糟，官方文件明寫分頁在那個模式不能用。",
    "# 最大化一樣佔滿螢幕，標題列與分頁列永遠都在。",
    "maximize = true",
    "",
    "# 把全螢幕那兩顆鍵拿掉，否則按到就前功盡棄（標題列與分頁列一起消失，而學生",
    "# 不會知道自己按了什麼、更不知道怎麼按回來）。",
    "keybind = cmd+enter=unbind",
    "keybind = cmd+ctrl+f=unbind",
    "",
    "# 指令跑完、而且你的注意力不在這個視窗時，跳一個桌面通知。",
    "#",
    "# ⚠️ 三行缺一不可，最容易漏的是第三行：notify-on-command-finish-action 的預設是",
    "# `bell,no-notify`——只設前兩行的話只會響一聲鈴，桌面通知永遠不會出現。",
    "notify-on-command-finish = unfocused",
    "notify-on-command-finish-after = 5s",
    "notify-on-command-finish-action = bell,notify",
    "",
    "# ⚠️ 關掉 Ghostty 自己的標題功能（預設清單裡有 title）。",
    "#",
    "# 它會在每一次 prompt 把標題改成目前的指令或目錄，而那正好會蓋掉「分頁自己報上",
    "# 名字」那張卡裝的東西——命名 hook 寫進去的名字撐不過下一個 prompt。",
    "#",
    "# 這裡把整份清單寫出來、只把 title 換成 no-title，不是只寫一個 no-title：那樣",
    "# 其他幾項算不算保留沒有明確定義，寫全比較不會出意外。",
    "shell-integration-features = cursor,no-sudo,no-title,no-ssh-env,no-ssh-terminfo,path",
  ].join("\n");
}

// 拖一個資料夾進終端機、按 Enter 就跳過去，不用自己打 cd。
//
// 這是 zsh 原生的選項，不需要 oh-my-zsh（oh-my-zsh 只是剛好也開了它）。
// Ghostty 那半是預設行為：拖進來就是把路徑貼進命令列，剩下的是 shell 的事。
//
// ⚠️ 只對資料夾成立。拖檔案進去按 Enter，zsh 會試著把它當指令執行。
export function zshBlock() {
  return ["setopt auto_cd"].join("\n");
}

export function applyGhosttyBlock(content) {
  return upsertBlock(content ?? "", GHOSTTY_MARKER, ghosttyBlock());
}

export function applyZshBlock(content) {
  return upsertBlock(content ?? "", ZSH_MARKER, zshBlock());
}

// 現在的狀態。分三種，跟退役那一列同一個形狀：
//
//   missing  兩份都還沒有 → 給安裝鍵
//   warn     有標記但內容不是這一版 → 一樣給按鈕，但話要說成「要更新」
//   ok       兩份都是這一版
//
// 為什麼「有標記但內容不同」要單獨算一種：學生上一輪裝過舊版的話，只看標記在不在
// 會給綠燈，而他手上是舊設定——那正是 tab-sync 踩過的假綠燈。
export function ghosttyConfigStatus({ configText, zshrcText }) {
  const config = configText ?? "";
  const zshrc = zshrcText ?? "";
  const configFresh = config.includes(ghosttyBlock());
  const zshFresh = zshrc.includes(zshBlock());

  if (configFresh && zshFresh) {
    return { status: "ok", detail: "終端機的設定都打開了" };
  }

  const configMarked = hasMarkedBlock(config, GHOSTTY_MARKER);
  const zshMarked = hasMarkedBlock(zshrc, ZSH_MARKER);

  if (
    (configMarked && !configFresh) ||
    (zshMarked && !zshFresh)
  ) {
    return { status: "warn", detail: "裝的是舊版設定，按一下更新" };
  }

  return { status: "missing", detail: "尚未設定" };
}

export function ghosttyConfigRow({ configText, zshrcText }) {
  return {
    id: "ghostty-config",
    label: "終端機的設定",
    ...ghosttyConfigStatus({ configText, zshrcText }),
  };
}
