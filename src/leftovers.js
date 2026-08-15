// 兩種殘留的**收尾**：搬走那支捷徑不等於清乾淨。
//
// 「清掉上一輪套件管理器裝的舊版」那顆按鈕只做一件事——把 PATH 上那支 shim 搬進
// 隔離區。套件管理器自己的帳本沒有被動過，所以兩邊都還記得它：
//
//   Homebrew  Caskroom 裡的本體還在，brew upgrade 有機會把連結重新建回來
//   npm       node_modules 裡的本體還在，npm i -g 同一支、或 nvm reinstall-packages
//             都可能把 shim 重新建回來
//
// 差別只在觸發機率：brew upgrade 是日常會跑的，npm 那條要特定操作才踩得到。但兩邊
// 都是「做到一半」，所以兩邊都給一列收尾（Reed 2026-08-15 在自己的機器上指出 npm
// 這半也沒收完）。
//
// ⚠️ 這件事原本只是 scripts/fix-legacy-cli.mjs 印的一句承諾（「之後會有一張卡帶你
// 跑 brew uninstall 收尾」），而那張卡從來沒被做出來。這支就是那張卡的判準。
//
// 為什麼判準看的是「隔離區裡有什麼」而不是「套件管理器的清單上有什麼」：只看後者
// 的話，學生自己裝來平常用的東西也會被我們點名——那是他的機器、他的選擇。隔離區裡
// 那幾支不一樣，是**我們剛才搬走的**，所以我們有責任把它收完。

// ── 兩邊共用 ──────────────────────────────────────────────────────────────
// 搬進隔離區時檔名是「<指令>-<時間戳>」（見 scripts/fix-legacy-cli.mjs）。
// 時間戳是純數字，所以從最後一段減號切開就還原得回指令名字——指令名字本身
// 不含減號（claude / codex），但這樣寫對 `some-tool-20260815` 也成立。
export function commandFromEntry(name) {
  if (typeof name !== "string" || name === "") {
    return null;
  }

  const match = name.match(/^(.+)-\d+$/);
  return match === null ? name : match[1];
}

// 從搬進隔離區的那條連結指向哪，還原出**brew 上的名字**。
//
// ⚠️ brew 上的名字不一定等於指令名字：codex 的 cask 就叫 codex，但 claude 的 cask
// 叫 claude-code。拿指令名字去問 brew，claude 那支永遠會得到「沒裝」——於是我們說
// 收乾淨了，而 Homebrew 的清單上它還在。
//
//   /opt/homebrew/Caskroom/codex/0.147.0/bin/codex   → codex
//   /opt/homebrew/Cellar/some-tool/1.2.3/bin/x       → some-tool
//
// 讀得到連結才有這個資訊，讀不到就退回指令名字（多數情況兩者相同）。
export function brewNameFromTarget(target) {
  if (typeof target !== "string") {
    return null;
  }

  const match = target.match(/[\\/](?:Caskroom|Cellar)[\\/]([^\\/]+)[\\/]/);
  return match === null ? null : match[1];
}

// 隔離區某個分區裡有哪幾支（去重、排序，畫面上的字才穩定）。
export function leftoverCommands(entries) {
  const names = (Array.isArray(entries) ? entries : [])
    .map((entry) => commandFromEntry(entry))
    .filter((name) => typeof name === "string" && name !== "");

  return [...new Set(names)].sort();
}

// 這一列要說什麼。null＝這一列根本不該出現。
//
// ⚠️ 跟隔離區那一列相反：這一列**不是可選的收尾**，不做的話 brew 會把連結裝回來，
// 前面那顆清理鍵等於白按。所以還沒收完是黃燈，不是綠燈配一顆可按可不按的鍵。
export function brewLeftoverRow({ commands = [], stillInstalled = [] }) {
  if (commands.length === 0) {
    return null;
  }

  const pending = commands.filter((command) => stillInstalled.includes(command));

  if (pending.length === 0) {
    // 搬過、而且 brew 那邊也收乾淨了。這一列要留著打勾——跟隔離區那一列同一個
    // 理由：按完整張卡消失的話，學生會以為自己做錯了什麼。
    return { status: "ok", detail: "Homebrew 那邊也收乾淨了" };
  }

  return {
    status: "warn",
    // 這一列沒有東西可以「安裝」，補一顆安裝鍵只會讓人問安裝什麼。
    installable: false,
    fixLabel: "跑 brew uninstall 收尾",
    // ⚠️ 一行，右邊緊接著就是按鈕（守門測試盯著 40 字上限）。
    detail: `Homebrew 清單上還有 ${pending.join("、")}，會裝回來`,
    guidance: {
      symptom: `連結搬走了，但 Homebrew 還記得 ${pending.join("、")}`,
      expected: "brew 的清單上不再有它們，連結也不會被重新建回來",
      checks: [
        "剛才那顆清理鍵只搬走了 PATH 上那條連結，Homebrew 安裝的本體還在原地",
        "留著的話，下一次 brew upgrade 有機會把連結重新建回來，又變成兩份搶著被叫到",
        "按那一列的按鈕會跑 brew uninstall，只動我們剛才搬走的那幾支",
        "你自己用 brew 裝的其他東西不在範圍內",
      ],
      diagnose: null,
    },
    // 腳本要知道去卸哪幾支。⚠️ 只回指令名字，不回路徑——這一列會整包送到瀏覽器，
    // 而路徑裡有學生的使用者名稱（跟 quarantineRow 那則同一個理由）。
    pending,
  };
}

// ── npm ───────────────────────────────────────────────────────────────────
// npm 那批的收尾，跟 brew 那半同一個形狀、同一個理由。
//
// ⚠️ 這一列是後來補的（Reed 2026-08-15）。原本的界線是「我們只管 PATH 上這一支，
// 不管 npm 的帳本」——寫在 scripts/fix-legacy-cli.mjs 開頭，而且那條界線本身有道理：
// 動全域 npm 的風險比較高，學生可能有別的東西依賴它。
//
// 但 brew 補了收尾之後，兩邊的不對稱就站不住了：兩者都是「本體還在、帳本還記得」，
// 差別只在觸發機率（brew upgrade 是日常會跑的，npm 那條要特定操作）。而且真正踩到的
// 時候症狀一模一樣：shim 被重新建回來，PATH 上又變成兩份。
//
// 保留下來的那半界線：**只卸我們搬走的那幾支**。學生自己 npm 裝的其他全域套件不碰。
export function npmLeftoverRow({ commands = [], stillInstalled = [] }) {
  if (commands.length === 0) {
    return null;
  }

  const pending = commands.filter((command) => stillInstalled.includes(command));

  if (pending.length === 0) {
    return { status: "ok", detail: "npm 那邊也收乾淨了" };
  }

  return {
    status: "warn",
    installable: false,
    fixLabel: "跑 npm uninstall 收尾",
    // ⚠️ 一行，右邊緊接著就是按鈕（守門測試盯著 40 字上限）。
    detail: `npm 的清單上還有 ${pending.join("、")}，會裝回來`,
    guidance: {
      symptom: `捷徑搬走了，但 npm 還記得 ${pending.join("、")}`,
      expected: "npm ls -g 不再列出它們，捷徑也不會被重新建回來",
      checks: [
        "剛才那顆清理鍵只搬走了 PATH 上那支捷徑，npm 裝的套件本體還在原地",
        "留著的話，下一次 npm i -g 同一支、或換 Node 版本時重裝套件，捷徑會被建回來",
        "按那一列的按鈕會跑 npm uninstall -g，只動我們剛才搬走的那幾支",
        "你自己 npm 裝的其他全域套件不在範圍內",
      ],
      diagnose: null,
    },
    pending,
  };
}
