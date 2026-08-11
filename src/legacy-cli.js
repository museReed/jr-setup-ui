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

export function classifyInstall(candidate) {
  if (typeof candidate !== "string" || candidate === "") {
    return "unknown";
  }

  if (NPM_MARKERS.some((marker) => marker.test(candidate))) {
    return "npm";
  }

  return OFFICIAL_MARKERS.some((marker) => marker.test(candidate))
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

export function inspectCommand(command, candidates, { exists }) {
  const packageName = NPM_PACKAGES[command];
  const npm = [];
  const seen = new Set();
  let official = 0;

  for (const candidate of candidates) {
    const kind = classifyInstall(candidate);

    if (kind === "official") {
      official += 1;
      continue;
    }

    if (kind !== "npm") {
      continue;
    }

    // 本體不在 = 孤兒。這一項決定它是「可以搬走」還是「非清不可」。
    const orphan = !exists(findPackageRoot(candidate, packageName));

    for (const variant of shimVariants(candidate, command)) {
      const key = variant.toLowerCase();

      // Windows 的檔名不分大小寫，PATH 上拿到的可能是 codex.CMD、掃出來的是
      // codex.cmd——不正規化的話同一支會被算兩次、搬第二次時失敗。
      if (seen.has(key) || !exists(variant)) {
        continue;
      }

      seen.add(key);
      npm.push({ command, path: variant, orphan });
    }
  }

  return { command, npm, official };
}

// 三種情況合成一列要說的話。⚠️ detail 一行——右邊緊接著就是按鈕。
//
// reinstallable ＝ 這個平台有官方安裝器、待會兒裝得回來的那幾支。第 3 種的處置
// 完全看它。
export function legacyCliStatus(reports, { reinstallable = [] } = {}) {
  const canReinstall = new Set(reinstallable);
  const withNpm = reports.filter((report) => report.npm.length > 0);

  if (withNpm.length === 0) {
    return { status: "ok", detail: "沒有上一輪用 npm 裝的殘留" };
  }

  const orphans = withNpm.filter((report) =>
    report.npm.some((entry) => entry.orphan),
  );
  // 只有 npm 版、而且沒有官方版的那幾支。清掉的話學生就完全沒得用了。
  const onlyNpm = withNpm.filter(
    (report) => report.official === 0 && !report.npm.some((entry) => entry.orphan),
  );
  const coexisting = withNpm.filter(
    (report) => report.official > 0 && !report.npm.some((entry) => entry.orphan),
  );
  const stranded = onlyNpm.filter((report) => !canReinstall.has(report.command));
  const names = (list) => list.map((report) => report.command).join("、");

  // 一支都動不了的情況：全部都是「只有 npm 版」而且我們裝不回來。
  if (stranded.length === withNpm.length) {
    return {
      status: "warn",
      installable: false,
      // 這一種**不給清理按鈕**：那是他唯一叫得動的東西，而這台我們補不上。
      detail: `${names(stranded)} 是上一輪用 npm 裝的，建議改用官方版重裝`,
      reports,
    };
  }

  // 只有「裝得回來的 only-npm」時，說法要講清楚它會先消失再回來——不然學生按完
  // 發現 claude 不見了會嚇到。
  if (coexisting.length === 0 && orphans.length === 0) {
    return {
      status: "warn",
      installable: false,
      fixLabel: "搬走 npm 裝的舊版",
      detail: `${names(onlyNpm.filter((r) => canReinstall.has(r.command)))} 是 npm 裝的，搬走後改裝官方版`,
      reports,
    };
  }

  // ⚠️ 說明只講**按下去會動到的那幾支**。三種情況可以同時存在（Reed 的 VM 就是
  // codex 並存 + claude 只有 npm），把全部串成一句會講出「claude 同時有 npm 版與
  // 官方版」這種假話——清理行為是對的，錯的是說明。剩下那幾支由腳本的輸出交代。
  return {
    status: "warn",
    installable: false,
    fixLabel: "搬走 npm 裝的舊版",
    detail:
      orphans.length > 0
        ? `${names(orphans)} 有一支指向空氣的舊捷徑，打了一定失敗`
        : `${names(coexisting)} 同時有 npm 版與官方版，會搶著被叫到`,
    reports,
  };
}

// 真的可以動的那幾支：
//   - 孤兒一定清（它只會失敗，留著沒有任何好處）
//   - 已經有官方版當靠山的，搬走沒有空窗
//   - 只有 npm 版、但這個平台裝得回來的，也搬（Reed 拍板）
// 剩下的是「只有 npm 版而且我們補不上」——那種一支都不動。
export function removableEntries(reports, { reinstallable = [] } = {}) {
  const canReinstall = new Set(reinstallable);

  return reports.flatMap((report) =>
    report.npm.filter(
      (entry) =>
        entry.orphan ||
        report.official > 0 ||
        canReinstall.has(report.command),
    ),
  );
}
