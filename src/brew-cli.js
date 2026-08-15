// Homebrew 那批殘留的**收尾**：搬走連結不等於清乾淨。
//
// 「清掉上一輪套件管理器裝的舊版」那顆按鈕對 brew 裝的那幾支只做了一半——它把
// /opt/homebrew/bin 底下那條連結搬進隔離區的 brew-cli 分區，但：
//
//   Caskroom / Cellar 裡的本體還在
//   brew 自己的清單上也還有它
//
// 所以 `brew upgrade`（或任何一次 reinstall）都有機會把那條連結重新建回來，於是
// PATH 上又出現兩份、學生打指令又開始看運氣。真正的收尾是 brew uninstall。
//
// ⚠️ 這件事原本只是 scripts/fix-legacy-cli.mjs 印的一句承諾（「之後會有一張卡帶你
// 跑 brew uninstall 收尾」），而那張卡從來沒被做出來（Reed 2026-08-15 在 mac VM 上
// 走到這一步時發現）。這支就是那張卡的判準。
//
// 為什麼判準看的是「隔離區裡有什麼」而不是「brew 清單上有什麼」：只看 brew 的話，
// 學生自己用 brew 裝來平常用的東西也會被我們點名——那是他的機器、他的選擇。
// 隔離區裡那幾支不一樣，是**我們剛才搬走的**，所以我們有責任把它收完。

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

// 隔離區 brew-cli 分區裡有哪幾支（去重、排序，畫面上的字才穩定）。
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
