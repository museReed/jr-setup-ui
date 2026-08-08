// 舊一輪工作坊在學生電腦上留下、而且真的會干擾這一輪的東西。
//
// 「會干擾」的判準很窄，只有兩類過關：
//
//   1. 殘留的 skill 資料夾 —— Claude 照樣載入它，可能跟這一輪的 skill 打架
//   2. npm 全域裝的 claude / codex —— PATH 先命中它，學生用的是舊版，而嚮導
//      只看 exit code 會判成 ok、不去裝新的
//
// 明確不碰的（碰了就傷到「還能重裝、還找得到路徑、還查得出問題」這三件事）：
//
//   登入狀態              刪了就是三個 device flow
//   CLAUDE.md / config.toml / AGENTS.md   裡面有他自己的規則
//   git / node / python / gh              跟嚮導無關
//   settings.json.bak / previous-statusline.txt
//                         那些正是出事時的還原路徑，刪掉等於拿掉 debug 能力
//
// 舊一輪的安裝方式是 `npm install -g`（見 git 歷史 8cc1191 / f8e049a，之後才換成
// 兩家官方的原生安裝器）。所以要退場的就是這兩個套件名，寫死不推測。
export const LEGACY_NPM_PACKAGES = {
  claude: "@anthropic-ai/claude-code",
  codex: "@openai/codex",
};

// 移除一律是「搬到這裡」，不是刪除。
//
// 理由有兩個，而且第二個比第一個重要：
//   1. 誤判的時候搬得回來——那個 skill 資料夾也可能是學生自己寫的
//   2. 出事的時候查得到當時搬走了什麼。直接刪掉的話，「嚮導把我的東西弄壞了」
//      這種回報就沒有任何可以對照的東西
export function quarantineDir(home, stamp) {
  return `${home}/.jr-setup/removed/${stamp}`;
}

// 資料夾名用時間戳，同一台機器清好幾次也不會互相覆蓋。
// 冒號在 Windows 的檔名裡不合法，所以只留數字。
export function quarantineStamp(now) {
  const pad = (value) => String(value).padStart(2, "0");

  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
}
