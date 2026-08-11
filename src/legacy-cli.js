// 上一輪用 npm 裝的 claude / codex 還在不在，以及它壞成哪一種。
//
// A1 說「三條規則要一開始就分清楚」，就是這三種。它們的處置完全不同，混在一起講的話
// 會做出「把學生唯一能用的那支刪掉」這種事：
//
//   1. 並存      官方版與 npm 版都在 → npm 那支要搬走，不然 PATH 上誰先誰後決定一切
//   2. 孤兒 shim PATH 上有一支 shim，它指向的套件本體卻不在 → 一定要清，它只會失敗
//   3. 只有 npm  沒有官方版 → **不能清**。那是他現在唯一叫得動的東西，
//                清掉等於把人家的工具拆了。要講的是「改用官方版重裝」
//
// 第 3 種是這支模組存在的主要理由。少了它，前兩種的清理邏輯會很自然地誤傷。

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

export function inspectCommand(command, candidates, { exists }) {
  const packageName = NPM_PACKAGES[command];
  const npm = [];
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

    npm.push({
      command,
      path: candidate,
      // 本體不在 = 孤兒。這一項決定它是「可以搬走」還是「非清不可」。
      orphan: !exists(findPackageRoot(candidate, packageName)),
    });
  }

  return { command, npm, official };
}

// 三種情況合成一列要說的話。⚠️ detail 一行——右邊緊接著就是按鈕。
export function legacyCliStatus(reports) {
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
  const names = withNpm.map((report) => report.command).join("、");

  if (onlyNpm.length === withNpm.length) {
    return {
      status: "warn",
      installable: false,
      // 這一種**不給清理按鈕**：那是他唯一叫得動的東西。要做的是用官方版重裝，
      // 而那顆按鈕本來就在上面那一列（「Codex CLI」那格的安裝鍵）。
      detail: `${names} 是上一輪用 npm 裝的，建議改用官方版重裝`,
      reports,
    };
  }

  return {
    status: "warn",
    installable: false,
    fixLabel: "搬走 npm 裝的舊版",
    detail:
      orphans.length > 0
        ? `${names} 有一支指向空氣的舊捷徑，打了一定失敗`
        : `${names} 同時有 npm 版與官方版，會搶著被叫到`,
    reports,
  };
}

// 真的可以動的那幾支：孤兒一定清；有官方版當靠山的 npm 版才搬得走。
export function removableEntries(reports) {
  return reports.flatMap((report) =>
    report.npm.filter((entry) => entry.orphan || report.official > 0),
  );
}
