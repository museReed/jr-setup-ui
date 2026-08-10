import assert from "node:assert/strict";

import { TAB_SYNC_MARKER } from "../src/config-install.js";
import {
  findDeadWrappers,
  removeWrapperBlocks,
  shellProfilePaths,
} from "../src/shell-wrapper.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

const DEAD = "C:\\Users\\Reed\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.exe";
const nothingExists = () => false;
const everythingExists = () => true;

try {
  // seed-dirty-env 塞進去的就是這個形狀。
  const dirtyWindows = [
    "# === 假的舊 wrapper（seed-dirty-env 產生，測完請移除）===",
    "function codex {",
    `  & '${DEAD}' @args`,
    "}",
  ].join("\r\n");

  const found = findDeadWrappers(dirtyWindows, {
    platform: "win32",
    exists: nothingExists,
  });
  assert.equal(found.length, 1);
  assert.equal(found[0].command, "codex");
  assert.equal(found[0].deadPath, DEAD);
  ok("PowerShell profile 裡指向已刪路徑的 codex 函式抓得到");

  assert.equal(
    findDeadWrappers(dirtyWindows, {
      platform: "win32",
      exists: everythingExists,
    }).length,
    0,
  );
  ok("路徑還在的同名函式不算問題");

  const posix = [
    "codex() {",
    "  '/Users/reed/.npm-global/lib/node_modules/@openai/codex/bin/codex' \"$@\"",
    "}",
  ].join("\n");
  assert.equal(
    findDeadWrappers(posix, { platform: "darwin", exists: nothingExists })
      .length,
    1,
  );
  ok("POSIX 的 codex() 形式一樣抓得到");

  // 這條是最容易寫壞的：我們自己裝的 tab-sync 函式裡也有一條寫死的路徑，
  // watcher 還沒裝好時它同樣不存在——不跳過的話會叫學生刪掉我們剛裝的東西。
  const ours = [
    `# >>> ${TAB_SYNC_MARKER} >>>`,
    "function codex {",
    "  & 'C:\\Users\\Reed\\.jr-setup\\bin\\ai-tab-sync.ps1' @args",
    "}",
    `# <<< ${TAB_SYNC_MARKER} <<<`,
  ].join("\r\n");
  assert.equal(
    findDeadWrappers(ours, { platform: "win32", exists: nothingExists }).length,
    0,
  );
  ok("tab-sync 自己的區塊不會被當成壞掉的 wrapper");

  // 相對路徑判斷不了它相對於誰，標成壞的只會誤傷學生自己寫的函式。
  const relative = ["function claude {", "  & 'bin/claude' @args", "}"].join(
    "\r\n",
  );
  assert.equal(
    findDeadWrappers(relative, { platform: "win32", exists: nothingExists })
      .length,
    0,
  );
  ok("只寫相對路徑的函式不會被誤判");

  const withNeighbours = [
    "$env:FOO = 'bar'",
    "# === 假的舊 wrapper ===",
    "function codex {",
    `  & '${DEAD}' @args`,
    "}",
    "Write-Host 'done'",
  ].join("\r\n");
  const blocks = findDeadWrappers(withNeighbours, {
    platform: "win32",
    exists: nothingExists,
  });
  const cleaned = removeWrapperBlocks(withNeighbours, blocks);
  assert.equal(cleaned, ["$env:FOO = 'bar'", "Write-Host 'done'"].join("\r\n"));
  ok("刪掉函式時連上面那行註解一起帶走，其他行原封不動");

  assert.ok(cleaned.includes("\r\n"));
  ok("Windows profile 清完之後還是 CRLF");

  assert.equal(removeWrapperBlocks(withNeighbours, []), withNeighbours);
  ok("沒有要刪的東西時內容完全不動");

  const windowsProfiles = shellProfilePaths("C:/Users/Reed", "win32");
  assert.equal(windowsProfiles.length, 2);
  assert.ok(windowsProfiles.some((p) => p.includes("WindowsPowerShell")));
  assert.ok(windowsProfiles.some((p) => p.includes("Documents/PowerShell")));
  ok("Windows 兩份 profile（5.1 與 7）都會掃");

  assert.ok(shellProfilePaths("/Users/reed", "darwin").includes("/Users/reed/.zshrc"));
  ok("POSIX 掃得到 .zshrc");
} catch (error) {
  console.error(error);
  process.exit(1);
}
