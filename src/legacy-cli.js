// 上一輪用 npm 裝的 claude / codex 還在不在，以及它壞成哪一種。
//
// A1 說「三條規則要一開始就分清楚」，就是這三種。它們的處置完全不同，混在一起講的話
// 會做出「把學生唯一能用的那支刪掉」這種事：
//
//   1. 並存      官方版與 npm 版都在 → npm 那支要搬走，不然 PATH 上誰先誰後決定一切
//   2. 孤兒 shim PATH 上有一支 shim，它指向的套件本體卻不在 → 一定要清，它只會失敗
//   3. 只有 npm  沒有官方版 → **看嚮導待會兒裝不裝得回來**。裝得回來就一起搬
//                （Reed 拍板：反正後面那張卡會裝官方版，早點清掉比較乾淨）；
//                這個平台沒有官方安裝器的話**不動**，那是他唯一叫得動的東西
//
// 第 3 種的那個前提條件不能省。少了它，在一台我們裝不回來的機器上，這段清理會把
// 學生唯一能用的 CLI 搬走、而且沒有東西補上。搬進隔離區（不是刪）是第二道保險。

export const NPM_PACKAGES = {
  claude: "@anthropic-ai/claude-code",
  codex: "@openai/codex",
};

// npm 的全域落點長什麼樣：Windows 是 %APPDATA%\npm\，POSIX 常見的是
// /usr/local/lib/node_modules 與 ~/.npm-global。共同點是路徑裡看得到 npm 或
// node_modules——比列舉前綴穩，學生的 prefix 可能被改過。
const NPM_MARKERS = [/[\\/]node_modules[\\/]/i, /[\\/]npm[\\/]/i, /[\\/]\.npm-global[\\/]/i];

// 官方安裝器的落點：Windows 是 %LOCALAPPDATA%\Programs\，mac / Linux 是 ~/.local/bin。
const OFFICIAL_MARKERS = [/[\\/]Programs[\\/]/i, /[\\/]\.local[\\/]bin[\\/]/i];

// Homebrew 的落點。**兩個都要**，而且實際會遇到的是後者：
//
//   Cellar    formula 裝的（brew install <名字>）
//   Caskroom  cask 裝的（brew install --cask <名字>）
//
// ⚠️ claude-code 與 codex 在 Homebrew 上**都是 cask 不是 formula**（實查 2026-08-15：
// 兩者都來自 homebrew-cask/Casks/c/）。所以只認 Cellar 的話這個功能等於沒做——
// 真正裝得到的那一種一支都抓不到。Cellar 留著是為了哪天它們變成 formula。
//
// ⚠️ 判準是這兩個資料夾名，不是 `/opt/homebrew` 前綴——這一條不能改成前綴，改了會
// 把事情弄反。同一個 `/opt/homebrew/bin` 底下站著兩種完全不同的東西：
//
//   brew 裝的  bin/claude → ../Caskroom/claude-code/<版本>/claude
//   npm 裝的   bin/claude → ../lib/node_modules/@anthropic-ai/claude-code/cli.js
//                          （Node 是 brew 裝的時候，npm 的全域 bin 就是這裡，
//                            見上面 2026-08-15 那則 mac VM 實測）
//
// 用前綴的話，npm 那支會被搶去判成 brew，於是走到「叫學生 brew uninstall」——
// 而 brew 根本沒裝過它，那行指令只會回一句 No available formula。
//
// 解開 symlink 之後看資料夾名就分得開。npm 那條解出來一定看得到 node_modules，
// 而 node_modules 在下面先判，所以順序本身也是一道保險。
const BREW_MARKERS = [/[\\/]Cellar[\\/]/i, /[\\/]Caskroom[\\/]/i];

// ⚠️ 第二個參數是「順著 symlink 解出來的真正位置」，可以不給。
//
// 為什麼需要它（Reed 的 mac VM 實測，2026-08-15）：那台的 Node 是 Homebrew 裝的，
// 於是 npm 的全域 bin 是 /opt/homebrew/bin——路徑裡**看不到** node_modules、npm、
// .npm-global 任何一個字，所以 npm 裝的 claude 被判成 unknown，那一列大聲說
//「沒有上一輪用 npm 裝的殘留」，而 npm ls -g 明明列著 @anthropic-ai/claude-code。
//
// 那不是少一個前綴的問題：學生的 prefix 可以是任何地方（brew、/usr/local、自己改的），
// 列舉永遠追不完。但 npm 在 POSIX 上放的是一條**指向套件本體的 symlink**，解開來
// 一定看得到 node_modules——所以解一次比多列幾個前綴可靠。
//
// Windows 不受影響也不會被弄壞：那邊的 shim 是真的檔案（.cmd/.ps1），解出來就是
// 自己，仍然靠原本那幾個 marker 認。
export function classifyInstall(candidate, resolved = null) {
  const paths = [candidate, resolved].filter(
    (value) => typeof value === "string" && value !== "",
  );

  if (paths.length === 0) {
    return "unknown";
  }

  if (paths.some((value) => NPM_MARKERS.some((marker) => marker.test(value)))) {
    return "npm";
  }

  // npm 判完才輪到 brew——順序見上面 BREW_MARKERS 的說明。
  if (paths.some((value) => BREW_MARKERS.some((marker) => marker.test(value)))) {
    return "brew";
  }

  return paths.some((value) =>
    OFFICIAL_MARKERS.some((marker) => marker.test(value)),
  )
    ? "official"
    : "unknown";
}

// npm 裝出來的東西是一支 shim（Windows 的 claude.cmd、POSIX 的一條 symlink）
// 加上一份套件本體。本體被刪掉、shim 留著，就是最難查的那一種：
// npm ls 說沒裝、PATH 上卻還有一支指向空氣的執行檔，打 claude 永遠失敗。
//
// 本體在哪：shim 旁邊的 node_modules/<套件名>。找不到 node_modules 就當它不是孤兒
// ——寧可漏報也不要把學生好好的安裝標成壞的。
export function findPackageRoot(shimPath, packageName) {
  const dir = shimPath.replace(/[\\/][^\\/]+$/, "");
  const separator = shimPath.includes("\\") ? "\\" : "/";
  const parts = packageName.split("/");

  return [dir, "node_modules", ...parts].join(separator);
}

// npm 一次寫三支：`codex`（給 sh 的）、`codex.cmd`（給 cmd.exe 的）、
// `codex.ps1`（給 PowerShell 的）。
//
// ⚠️ 只靠 PATHEXT 找的話只會找到 `.cmd`——`.ps1` 不在 PATHEXT 裡，**但 PowerShell
// 自己會執行它**。真機實測：搬走 codex.CMD 之後，`Get-Command codex -All` 仍然列出
// codex.ps1 與無副檔名那支，孤兒照樣叫得到。所以找到任何一支就把同一個目錄裡
// 同名的三支一起處理。
const SHIM_SUFFIXES = ["", ".cmd", ".ps1"];

export function shimVariants(shimPath, command) {
  const dir = shimPath.replace(/[\\/][^\\/]+$/, "");
  const separator = shimPath.includes("\\") ? "\\" : "/";

  return SHIM_SUFFIXES.map((suffix) => `${dir}${separator}${command}${suffix}`);
}

// realpath：順著 symlink 解到真正的位置，解不開（斷掉的連結、或本來就不是連結）
// 回 null。給預設值是為了讓既有的呼叫端與測試不用全部改。
export function inspectCommand(
  command,
  candidates,
  { exists, realpath = () => null },
) {
  const packageName = NPM_PACKAGES[command];
  const npm = [];
  const brew = [];
  const unknown = [];
  const seen = new Set();
  let official = 0;

  for (const candidate of candidates) {
    const resolved = realpath(candidate);
    const kind = classifyInstall(candidate, resolved);

    if (kind === "official") {
      official += 1;
      continue;
    }

    // 認不得的落點只記下來給那一列講，一支都不搬（Reed 拍板：報出來、不動手）。
    // 學生自己下載丟進 PATH 的就落在這裡——那是他的東西，而且我們也說不出它壞在
    // 哪，補一顆清理鍵只會清掉一個可能好好的安裝。
    if (kind === "unknown") {
      unknown.push({ command, path: candidate });
      continue;
    }

    // 本體不在 = 孤兒。這一項決定它是「可以搬走」還是「非清不可」。
    //
    // ⚠️ 兩條路，因為兩個平台的 shim 根本不是同一種東西：
    //
    //   POSIX   shim 是一條指向套件本體的 symlink → 解得開而且目標在，本體就在
    //           （本體可能在 /opt/homebrew/lib/…，跟 shim 不同層，往旁邊找找不到）
    //   Windows shim 是真的檔案（.cmd/.ps1），解出來就是自己 → 照原本的往旁邊找
    //
    // 斷掉的 symlink 解不開，會落到第二條、找不到本體，判成孤兒——那正是對的。
    const linked = resolved !== null && resolved !== candidate;
    let orphan;

    if (linked) {
      orphan = !exists(resolved);
    } else if (kind === "brew") {
      // brew 認得出來的前提就是路徑裡有 Cellar。走到這裡代表候選路徑自己就在
      // Cellar 底下（不是那條連結，是本體），本體當然在。
      orphan = false;
    } else {
      orphan = !exists(findPackageRoot(candidate, packageName));
    }

    for (const variant of shimVariants(candidate, command)) {
      const key = variant.toLowerCase();

      // Windows 的檔名不分大小寫，PATH 上拿到的可能是 codex.CMD、掃出來的是
      // codex.cmd——不正規化的話同一支會被算兩次、搬第二次時失敗。
      if (seen.has(key) || !exists(variant)) {
        continue;
      }

      seen.add(key);
      // kind 要跟著走：兩種殘留搬進隔離區的**不同分區**，而且 brew 那批之後還要
      // 靠它認出來去跑 brew uninstall（見 scripts/fix-legacy-cli.mjs）。
      (kind === "brew" ? brew : npm).push({
        command,
        kind,
        path: variant,
        orphan,
      });
    }
  }

  return { command, npm, brew, unknown, official };
}

// npm 與 brew 裝的都是「要搬走的舊版」。判斷「這一列有沒有事」時兩者是同一件事，
// 差別只在搬進隔離區的哪個分區、以及 brew 那批之後還要再跑一次 brew uninstall。
function legacyEntries(report) {
  return [...report.npm, ...(report.brew ?? [])];
}

// 說明裡要講「用什麼裝的」。兩種都有時不列舉——那一行只有 40 字。
function installerWord(reports) {
  const hasBrew = reports.some((report) => (report.brew ?? []).length > 0);
  const hasNpm = reports.some((report) => report.npm.length > 0);

  if (hasBrew && hasNpm) {
    return "套件管理器";
  }

  return hasBrew ? "Homebrew" : "npm";
}

// 按鈕上的字。兩種都有時不套進句型——「搬走 套件管理器 裝的舊版」讀起來像機器寫的。
function fixLabelFor(word) {
  return word === "套件管理器" ? "搬走舊版 CLI" : `搬走 ${word} 裝的舊版`;
}

// 認不得的落點：報出來、不動手（Reed 拍板）。它不影響這一列的紅綠燈，只掛一段說明
// ——所以綠燈那一支也要帶上它。
//
// ⚠️ 只講指令名字，**不要放完整路徑**。這一列會整包送到瀏覽器，而路徑裡有學生的
// 使用者名稱（常常是本名），「這一頁卡住了」那顆會把畫面上的東西貼到公開的 issue
// 上——跟 quarantineRow 那則是同一個理由。
function unknownGuidance(reports) {
  const names = reports
    .filter((report) => (report.unknown ?? []).length > 0)
    .map((report) => report.command);

  if (names.length === 0) {
    return {};
  }

  return {
    guidance: {
      symptom: `${names.join("、")} 是從我們認不得的地方裝的`,
      expected:
        "嚮導不會動它。要換成官方版的話，請自己確認它當初是怎麼裝的、用同一個方式移除，再回來按官方版的安裝鍵",
      checks: names.map(
        (name) => `${name}：不在 npm、Homebrew、官方安裝器的落點`,
      ),
      diagnose: null,
    },
  };
}

// 三種情況合成一列要說的話。⚠️ detail 一行——右邊緊接著就是按鈕。
//
// reinstallable ＝ 這個平台有官方安裝器、待會兒裝得回來的那幾支。第 3 種的處置
// 完全看它。
export function legacyCliStatus(reports, { reinstallable = [] } = {}) {
  const canReinstall = new Set(reinstallable);
  const withLegacy = reports.filter(
    (report) => legacyEntries(report).length > 0,
  );
  const unknown = unknownGuidance(reports);

  if (withLegacy.length === 0) {
    return { status: "ok", detail: "沒有上一輪套件管理器裝的殘留", ...unknown };
  }

  const orphans = withLegacy.filter((report) =>
    legacyEntries(report).some((entry) => entry.orphan),
  );
  // 只有舊版、而且沒有官方版的那幾支。清掉的話學生就完全沒得用了。
  const onlyLegacy = withLegacy.filter(
    (report) =>
      report.official === 0 &&
      !legacyEntries(report).some((entry) => entry.orphan),
  );
  const coexisting = withLegacy.filter(
    (report) =>
      report.official > 0 &&
      !legacyEntries(report).some((entry) => entry.orphan),
  );
  const stranded = onlyLegacy.filter(
    (report) => !canReinstall.has(report.command),
  );
  const names = (list) => list.map((report) => report.command).join("、");
  const word = installerWord(withLegacy);

  // 一支都動不了的情況：全部都是「只有舊版」而且我們裝不回來。
  if (stranded.length === withLegacy.length) {
    return {
      status: "warn",
      installable: false,
      // 這一種**不給清理按鈕**：那是他唯一叫得動的東西，而這台我們補不上。
      detail: `${names(stranded)} 是上一輪用 ${word} 裝的，建議改用官方版重裝`,
      reports,
      ...unknown,
    };
  }

  // 只有「裝得回來的 only-legacy」時，說法要講清楚它會先消失再回來——不然學生按完
  // 發現 claude 不見了會嚇到。
  if (coexisting.length === 0 && orphans.length === 0) {
    return {
      status: "warn",
      installable: false,
      fixLabel: fixLabelFor(word),
      detail: `${names(onlyLegacy.filter((r) => canReinstall.has(r.command)))} 是 ${word} 裝的，搬走後改裝官方版`,
      reports,
      ...unknown,
    };
  }

  // ⚠️ 說明只講**按下去會動到的那幾支**。三種情況可以同時存在（Reed 的 VM 就是
  // codex 並存 + claude 只有 npm），把全部串成一句會講出「claude 同時有 npm 版與
  // 官方版」這種假話——清理行為是對的，錯的是說明。剩下那幾支由腳本的輸出交代。
  return {
    status: "warn",
    installable: false,
    fixLabel: fixLabelFor(word),
    detail:
      orphans.length > 0
        ? `${names(orphans)} 有一支指向空氣的舊捷徑，打了一定失敗`
        : `${names(coexisting)} 同時有舊版與官方版，會搶著被叫到`,
    reports,
    ...unknown,
  };
}

// 真的可以動的那幾支：
//   - 孤兒一定清（它只會失敗，留著沒有任何好處）
//   - 已經有官方版當靠山的，搬走沒有空窗
//   - 只有舊版、但這個平台裝得回來的，也搬（Reed 拍板）
// 剩下的是「只有舊版而且我們補不上」——那種一支都不動。
//
// ⚠️ brew 裝的走**同一條**安全規則，不是無條件搬。它一樣是學生現在唯一叫得動的
// 東西，這台裝不回官方版就搬不得——「brew 裝的一律要換掉」是目標，不是可以把人家
// 的工具拆了不管的理由。
export function removableEntries(reports, { reinstallable = [] } = {}) {
  const canReinstall = new Set(reinstallable);

  return reports.flatMap((report) =>
    legacyEntries(report).filter(
      (entry) =>
        entry.orphan ||
        report.official > 0 ||
        canReinstall.has(report.command),
    ),
  );
}
