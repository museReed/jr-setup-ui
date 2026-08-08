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

// 工作坊發過、但這一輪已經不發的 skill 名字。
//
// ⚠️ 可以被標成殘留的東西，只有這份名單裡的名字。學生自己裝的 skill 永遠不進入判斷。
//
// 第一版不是這樣寫的：當時的規則是「不在這一輪發的名單裡就算殘留」。那條規則在真的
// 機器上跑出來的結果是——七個全是 Reed 自己的 skill（codex-agent、text-to-lottie、
// video-dub-selfdub-cards…），工作坊殘留零個。而且那個零不是巧合：
// `git log --diff-filter=D materials/skills/**` 掃過全部歷史，**沒有任何 skill 目錄
// 被刪過或改名過**——工作坊一路只發過 auto-rename、handoff、structured-questions、
// vault-sync。也就是說那條規則的真陽性在結構上就是不可能有的。
//
// 所以範圍鎖死在「我們自己發過的名字」。今天這份名單是空的，畫面上什麼都不會出現
// ——那是正確的，因為真的沒有殘留。
//
// 什麼時候要往裡面加：把某支 skill 改名或停發時。舊名字加進來，學生機器上那個資料夾
// 才會被指出來（它現在仍然會被 Claude 載入）。跟 RETIRED_CODEX_KEYS 同一個形狀、
// 同一個理由：只補不刪的東西，要有一份明確的退場名單主動去退。
//
// 名字寫「資料夾名」，不是步驟 id——落地之後只剩資料夾名，那才是掃得到的東西。
export const RETIRED_SKILLS = [];

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
