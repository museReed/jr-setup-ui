// 家目錄裡有幾樣東西**不是學生自己的**——他讀得到、但寫不進去。
//
// 兩份真實回報（2026-08-16，同一場課）：
//
//   login-gh          ✓ Authentication complete → mkdir ~/.config/gh: permission denied
//   install-config-step  已備份 → .zshrc.bak.20260816144356
//                        EACCES: permission denied, open '~/.zshrc'
//
// ⚠️ 這兩件事看起來是兩張卡的兩個毛病，其實是同一件事：**家目錄本身寫得進去，
// 裡面那幾樣卻是 root 的**。證據就在第二段裡——`.zshrc.bak.…` 建得出來（那要家
// 目錄可寫），緊接著開 `.zshrc` 卻 EACCES（那個檔案本身不可寫）。
//
// 怎麼變成這樣的：某個帶 sudo 的指令第一次建出／改寫了那幾樣。macOS 的 sudo 預設
// 保留 $HOME，所以 root 跑出來的東西照樣落在學生家目錄裡，而且屬於 root。這門課
// 自己就有一條這種指令——docs/returning-students.md 請學生跑 `sudo npm uninstall -g`。
//
// ⚠️ 為什麼要獨立一列，而不是在 gh 那一列講：學生按下去的每一顆按鈕都會撞到它，
// 而每一張卡各自報一次「permission denied」的話，看起來像五個毛病。實際回報裡那位
// 同學就重按了三次分頁標題那一步——每一次都先寫出一份 .bak 才失敗，家目錄裡多了
// 六個沒有用的備份。
//
// ⚠️ Windows 不會遇到：那邊的設定落在 %AppData%，而且沒有 sudo 這條路徑。這一列在
// win32 上永遠不出現（見 env-check 的 checkHomePerms）。

// 嚮導自己會寫的那幾樣。**只列我們真的會動的**——把整個家目錄掃一遍會點名學生自己
// 的東西，那是他的機器、他的選擇（跟 leftovers.js 那條界線同一個道理）。
//
// ⚠️ 每一項都要說得出「這一步會壞在哪」。學生看到的是一列檔名，沒有這句話的話，
// 他不知道為什麼嚮導要碰他的 .zshrc。
export const WRITE_TARGETS = [
  { name: ".config", why: "GitHub CLI 的登入要存進這裡" },
  { name: ".zshrc", why: "分頁標題那一步要在這裡加一行" },
  { name: ".zprofile", why: "Homebrew 的 PATH 要在這裡加一行" },
  { name: ".claude", why: "Claude Code 的規則檔與 hook 放在這裡" },
  { name: ".codex", why: "Codex 的設定與 skill 放在這裡" },
  { name: ".local", why: "Codex CLI 的本體與捷徑裝在 .local/bin" },
];

// 家目錄本身也要能寫——不能寫的話上面每一樣連建都建不出來。它排第一，而且名字就
// 寫「家目錄本身」：學生看到一列「.」不會知道那是什麼。
const HOME_ITSELF = { name: "家目錄本身", why: "上面那幾樣都要在這裡建出來" };

// 「存在、但寫不進去」才算數。不存在不是問題——嚮導會自己建，而建得出來只需要家
// 目錄可寫（那一項自己會被查到）。
//
// exists / writable 都是外面傳進來的探針：這支要能在測試裡不碰真的檔案系統跑完，
// 而 fs 的 accessSync 是用拋錯回報結果的，包一層也讓呼叫端只處理布林值。
export function blockedWriteTargets(home, { exists, writable }) {
  const blocked = [];

  if (!writable(home)) {
    blocked.push(HOME_ITSELF);
  }

  for (const target of WRITE_TARGETS) {
    const path = `${home}/${target.name}`;

    if (exists(path) && !writable(path)) {
      blocked.push(target);
    }
  }

  return blocked;
}

// ⚠️ 一行，右邊緊接著就是按鈕（守門測試盯著 40 字上限）。名字最多列兩個，再多就
// 收成「等 N 樣」——三個檔名就已經 40 字了，而那一列被擠掉的是按鈕。
export function blockedSummary(blocked) {
  const names = blocked.map((item) => item.name);

  if (names.length <= 2) {
    return `${names.join("、")} 不是你的，寫不進去`;
  }

  return `${names.slice(0, 2).join("、")} 等 ${names.length} 樣不是你的`;
}

// 三態：
//
//   從來沒事      回 null，這一列不出現。多數學生的家目錄是好的，長一列「權限正常」
//                 出來只是多一列要讀（跟 quarantineRow 同一個判準）
//   還鎖著        黃燈 ＋ 一顆修復鍵
//   修好了        綠燈，留在畫面上
//
// ⚠️ 第三態是 Reed 實測指出的：判準本來只有「現在還有沒有被鎖住的東西」，於是學生
// 按下修復鍵、chown 跑完之後這一列就沒有理由出現——卡片當場消失。他不會覺得做完
// 了，他會覺得自己剛剛弄壞了什麼。退役那幾列早就踩過同一條（見 config-check 的
// checkRetired），這裡照同一個形狀做。
//
// 分得開第一態與第三態靠的是 state.json 記的那一筆（progress-state 的 markStepFixed）：
// 沒有那一筆就是從來沒事，有那一筆就是他自己按掉的。
export function homePermsRow(blocked, { fixed = false } = {}) {
  if (blocked.length === 0) {
    return fixed
      ? {
          status: "ok",
          installable: false,
          detail: "已經改回你的了，這一列不用再做什麼",
          blocked: [],
        }
      : null;
  }

  return {
    status: "warn",
    // 這一列沒有東西可以「安裝」，補一顆安裝鍵只會讓人問安裝什麼。
    installable: false,
    detail: blockedSummary(blocked),
    guidance: {
      symptom: "家目錄裡有幾樣東西是系統管理員的，你的帳號改不動",
      expected: "下面這幾樣改回你自己的，嚮導才寫得進去",
      checks: [
        ...blocked.map((item) => `${item.name}——${item.why}`),
        "多半是先前某個帶 sudo 的指令建出來的：sudo 跑的東西屬於 root，卻落在你家目錄裡",
        "按那顆按鈕會開一個真的終端視窗，在那裡跑 chown 把它們改回你的（要輸入 Mac 密碼）",
        "只動上面列出的那幾樣，你自己的檔案不碰",
      ],
      diagnose: null,
    },
    // ⚠️ 只回名字，不回完整路徑。這一列會整包送到瀏覽器，而「這一頁卡住了」那顆會
    // 把畫面上的東西貼到公開的 issue 上——完整路徑裡有學生的使用者名稱（常常是
    // 本名）。真正要 chown 的路徑由 scripts/fix-home-perms.mjs 在本機自己算一次。
    blocked: blocked.map((item) => item.name),
  };
}

// gh 那一列要不要改口。`gh auth status` 失敗有兩種：真的沒登入、以及登入存不進去
// ——兩種在畫面上都寫「未登入」的話，學生會一直按「開始登入」，而那條路每一次都會
// 走完整個裝置授權流程再死在同一行（實際回報裡就是這樣重試的）。
export function ghConfigBlocked(blocked) {
  return blocked.some(
    (item) => item.name === ".config" || item.name === HOME_ITSELF.name,
  );
}
