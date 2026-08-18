// 學生的 shell 設定檔裡，有沒有舊 claude / codex wrapper 擋在新版前面。
//
// 這是回訪學生最難自己看出來的一種壞法：打 `codex` 說找不到、打 `codex.exe` 卻正常，
// `where.exe codex` 也看不到任何異常——因為壞的東西不在 PATH 上，是 shell 設定檔裡
// 一個同名函式，而它指向的檔案早就被 npm 移除了。函式排在執行檔前面，所以永遠是它接手。
// POSIX 還要清掉舊版寫入的 codex wrapper / mycodex alias，否則它們會把
// Codex 0.146+ 的原生 terminal title 蓋掉。
//
// ⚠️ 這裡只負責「看」與「算出要刪哪幾行」，真正動檔案的是 scripts/fix-shell-wrapper.mjs。
// 拆開是為了測得到：判準全部是純函式，不需要真的弄髒一台機器才驗得了。

import { TAB_SYNC_MARKER } from "./config-install.js";

const WRAPPED_COMMANDS = ["claude", "codex"];
const TAB_SYNC_START = `# >>> ${TAB_SYNC_MARKER} >>>`;
const TAB_SYNC_END = `# <<< ${TAB_SYNC_MARKER} <<<`;

// 兩個平台都要掃「不只一份」：
// Windows 的 PowerShell 5.1 與 7 各讀各的 profile，而學生用哪一個我們不知道
// （真機上撞過「$PROFILE 不存在但函式存在」）。POSIX 這邊 zsh / bash 同理。
export function shellProfilePaths(home, platform = process.platform) {
  if (platform === "win32") {
    return [
      `${home}/Documents/WindowsPowerShell/Microsoft.PowerShell_profile.ps1`,
      `${home}/Documents/PowerShell/Microsoft.PowerShell_profile.ps1`,
    ];
  }

  return [`${home}/.zshrc`, `${home}/.bashrc`, `${home}/.bash_profile`];
}

// 引號裡看起來像「絕對路徑」的那一段。相對路徑不算——判斷不了它相對於誰，
// 誤判的話會把學生自己寫的、正常運作的函式標成壞的。
const QUOTED = /['"]([^'"]+)['"]/g;

function absolutePaths(line) {
  const found = [];

  for (const match of line.matchAll(QUOTED)) {
    const value = match[1];

    if (/^([A-Za-z]:[\\/]|[\\/])/.test(value)) {
      found.push(value);
    }
  }

  return found;
}

function opensWrapper(line, platform) {
  const trimmed = line.trim();

  for (const command of WRAPPED_COMMANDS) {
    // PowerShell：function codex {　　POSIX：codex() {
    const pattern =
      platform === "win32"
        ? new RegExp(`^function\\s+${command}\\s*\\{`, "i")
        : new RegExp(`^(function\\s+)?${command}\\s*\\(\\s*\\)\\s*\\{`);

    if (pattern.test(trimmed)) {
      return command;
    }
  }

  return null;
}

function aliasesMycodex(line) {
  const match = line
    .trim()
    .match(/^alias\s+codex\s*=\s*(?:(['"])(.*?)\1|(\S+))\s*(?:#.*)?$/);

  if (match === null) {
    return false;
  }

  const value = match[2] ?? match[3];
  return /(?:^|[\\/])mycodex$/.test(value);
}

function markedBlock(lines) {
  const starts = [];
  const ends = [];

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();

    if (trimmed === TAB_SYNC_START) starts.push(index);
    if (trimmed === TAB_SYNC_END) ends.push(index);
  }

  if (starts.length > 1 || ends.length > 1) {
    throw new Error(`${TAB_SYNC_MARKER} 標記重複，未修改設定檔`);
  }

  if (starts.length !== ends.length || (starts[0] ?? 0) > (ends[0] ?? 0)) {
    throw new Error(`${TAB_SYNC_MARKER} 標記不成對，未修改設定檔`);
  }

  return starts.length === 0
    ? null
    : { firstLine: starts[0], lastLine: ends[0] };
}

function wrapperLastLine(lines, firstLine, limit) {
  const first = lines[firstLine];

  if (first.indexOf("}", first.indexOf("{") + 1) !== -1) {
    return firstLine;
  }

  for (let index = firstLine + 1; index < limit; index += 1) {
    if (lines[index].trim() === "}") {
      return index;
    }
  }

  throw new Error("舊 Codex wrapper 不完整，未修改設定檔");
}

// 找出「函式主體裡寫死一條路徑，而那條路徑不存在」的區塊。
//
// ⚠️ 新版 Claude-only 與 Windows 的 tab-sync 區塊要跳過；POSIX 舊區塊仍開
// codex() 時只移除那支函式，保留 Claude wrapper。watcher 腳本路徑暫時不存在
// 不等於區塊壞掉。
export function findDeadWrappers(content, { platform = process.platform, exists }) {
  const lines = content.split(/\r?\n/);
  const found = [];
  const ourBlock = markedBlock(lines);
  let open = null;

  for (const [index, line] of lines.entries()) {
    if (ourBlock !== null && index === ourBlock.firstLine) {
      if (platform !== "win32") {
        for (
          let blockLine = ourBlock.firstLine + 1;
          blockLine < ourBlock.lastLine;
          blockLine += 1
        ) {
          if (opensWrapper(lines[blockLine], platform) === "codex") {
            const lastLine = wrapperLastLine(
              lines,
              blockLine,
              ourBlock.lastLine,
            );
            found.push({
              command: "codex",
              reason: "native-title",
              firstLine: blockLine,
              lastLine,
              removeLeadingComments: false,
            });
            blockLine = lastLine;
          }
        }
      }

      continue;
    }

    if (
      ourBlock !== null &&
      index > ourBlock.firstLine &&
      index <= ourBlock.lastLine
    ) {
      continue;
    }

    if (open === null) {
      if (platform !== "win32" && aliasesMycodex(line)) {
        found.push({
          command: "codex",
          reason: "native-title",
          firstLine: index,
          lastLine: index,
          removeLeadingComments: false,
        });
        continue;
      }

      const command = opensWrapper(line, platform);

      if (command !== null) {
        open = { command, firstLine: index, deadPaths: [] };
      }

      continue;
    }

    if (line.trim() === "}") {
      if (open.deadPaths.length > 0) {
        found.push({
          command: open.command,
          deadPath: open.deadPaths[0],
          firstLine: open.firstLine,
          lastLine: index,
        });
      }

      open = null;
      continue;
    }

    for (const candidate of absolutePaths(line)) {
      if (!exists(candidate)) {
        open.deadPaths.push(candidate);
      }
    }
  }

  return found;
}

// 找到的東西 → 那一列要說什麼。抽成純函式跟 ghosttyStatus / windowsTerminalStatus
// 同一個形狀：文字要跟著「壞掉的是哪一支」變，寫在 async 的檢查裡就測不到了。
export function shellWrapperStatus(dead) {
  if (dead.length === 0) {
    return { status: "ok", detail: "沒有舊設定擋在前面" };
  }

  const names = [...new Set(dead.map((block) => block.command))].join("、");
  const overridesNativeTitle = dead.some(
    (block) => block.reason === "native-title",
  );

  if (overridesNativeTitle) {
    const deadNames = [
      ...new Set(
        dead
          .filter((block) => block.reason !== "native-title")
          .map((block) => block.command),
      ),
    ].join("、");

    if (deadNames.length > 0) {
      return {
        status: "warn",
        installable: false,
        fixLabel: `清除舊 Codex wrapper 與廢棄的 ${deadNames} 引用`,
        detail: `舊 Codex wrapper 覆蓋標題，${deadNames} 也指到失效檔案`,
        deadPath: dead.find((block) => block.deadPath)?.deadPath,
      };
    }

    return {
      status: "warn",
      installable: false,
      fixLabel: "清除舊 Codex wrapper",
      detail: "舊 Codex wrapper 會覆蓋原生分頁標題",
      deadPath: dead.find((block) => block.deadPath)?.deadPath,
    };
  }

  return {
    status: "warn",
    installable: false,
    // 按鈕文字跟著壞掉的那一支變。寫死 codex 的話，profile 裡壞的是 claude 時，
    // 卡片說 claude、按鈕說 codex，學生會以為按下去修的是別的東西。
    fixLabel: `清除廢棄的 ${names} 引用`,
    // ⚠️ 一行就好。這一格是清單裡的一列，右邊緊接著就是修復鍵——寫長了會把整列
    // 撐開，按鈕被擠出可視範圍，畫面上變成「有問題但沒東西可按」（VM 實測）。
    // 完整的來龍去脈寫在 public/model.js 的 GUIDANCE，那裡才有版面可以展開。
    detail: `${names} 指到一個已經不在的檔案，裝完也叫不動`,
    deadPath: dead[0].deadPath,
  };
}

// 把整個函式連同它上面緊鄰的註解一起刪掉。只刪函式的話，留下來的那行
// 「# === 假的舊 wrapper ... ===」會讓學生以為沒清乾淨。
export function removeWrapperBlocks(content, blocks) {
  if (blocks.length === 0) {
    return content;
  }

  const lines = content.split(/\r?\n/);
  const doomed = new Set();

  for (const block of blocks) {
    for (let line = block.firstLine; line <= block.lastLine; line += 1) {
      doomed.add(line);
    }

    if (block.removeLeadingComments !== false) {
      for (let line = block.firstLine - 1; line >= 0; line -= 1) {
        if (lines[line].trim().startsWith("#")) {
          doomed.add(line);
          continue;
        }

        break;
      }
    }
  }

  const kept = lines.filter((_, index) => !doomed.has(index));
  // 原本用什麼換行就還什麼回去：Windows 的 profile 是 CRLF，統一寫成 LF 的話
  // 學生用記事本打開會看到整份擠成一行。
  const newline = content.includes("\r\n") ? "\r\n" : "\n";

  return kept.join(newline);
}
