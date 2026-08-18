import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { TAB_SYNC_MARKER } from "../src/config-install.js";
import {
  findDeadWrappers,
  removeWrapperBlocks,
  shellProfilePaths,
  shellWrapperStatus,
} from "../src/shell-wrapper.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

const DEAD = "C:\\Users\\Reed\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.exe";
const nothingExists = () => false;
const everythingExists = () => true;
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

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

  const oldPosixTabSync = [
    "export KEEP_BEFORE=1",
    `# >>> ${TAB_SYNC_MARKER} >>>`,
    "claude() { command claude \"$@\"; }",
    "codex() { command codex \"$@\"; }",
    `# <<< ${TAB_SYNC_MARKER} <<<`,
    "export KEEP_AFTER=1",
  ].join("\n");
  const oldPosixBlocks = findDeadWrappers(oldPosixTabSync, {
    platform: "darwin",
    exists: everythingExists,
  });
  assert.equal(oldPosixBlocks.length, 1);
  assert.equal(oldPosixBlocks[0].reason, "native-title");
  assert.equal(
    removeWrapperBlocks(oldPosixTabSync, oldPosixBlocks),
    ["export KEEP_BEFORE=1", "export KEEP_AFTER=1"].join("\n"),
  );
  ok("POSIX 舊 tab-sync marker 含 codex() 時整段抓出並精準移除");

  const claudeOnlyTabSync = [
    `# >>> ${TAB_SYNC_MARKER} >>>`,
    "claude() { command claude \"$@\"; }",
    `# <<< ${TAB_SYNC_MARKER} <<<`,
  ].join("\n");
  assert.equal(
    findDeadWrappers(claudeOnlyTabSync, {
      platform: "darwin",
      exists: nothingExists,
    }).length,
    0,
  );
  ok("POSIX 新 Claude-only tab-sync marker 不誤報");

  const mycodexAliases = [
    "export KEEP_A=1",
    "alias codex=$HOME/.local/bin/mycodex",
    "export KEEP_B=1",
    "alias codex='/opt/tools/mycodex'",
    "export KEEP_C=1",
  ].join("\n");
  const aliasBlocks = findDeadWrappers(mycodexAliases, {
    platform: "linux",
    exists: everythingExists,
  });
  assert.equal(aliasBlocks.length, 2);
  assert(aliasBlocks.every(({ reason }) => reason === "native-title"));
  assert.equal(
    removeWrapperBlocks(mycodexAliases, aliasBlocks),
    ["export KEEP_A=1", "export KEEP_B=1", "export KEEP_C=1"].join("\n"),
  );
  ok("POSIX 有無引號的 mycodex alias 都只移除該行，鄰行保留");

  assert.equal(
    findDeadWrappers("alias codex='codex --model gpt-5'", {
      platform: "darwin",
      exists: everythingExists,
    }).length,
    0,
  );
  ok("不是 mycodex 的 codex alias 不誤傷");

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

  const clean = shellWrapperStatus([]);
  assert.equal(clean.status, "ok");
  assert.equal(clean.fixLabel, undefined);
  ok("沒問題時是綠的，也不長按鈕文字");

  // 按鈕文字寫死 codex 的話，壞的是 claude 時卡片說 claude、按鈕說 codex。
  const claudeOnly = shellWrapperStatus([
    { command: "claude", deadPath: "/gone/claude" },
  ]);
  assert.equal(claudeOnly.status, "warn");
  assert.equal(claudeOnly.fixLabel, "清除廢棄的 claude 引用");
  assert.ok(claudeOnly.detail.includes("claude"));
  assert.ok(!claudeOnly.detail.includes("codex"));
  ok("只有 claude 壞掉時，按鈕與說明都只講 claude");

  const both = shellWrapperStatus([
    { command: "codex", deadPath: "/gone/codex" },
    { command: "claude", deadPath: "/gone/claude" },
    { command: "codex", deadPath: "/gone/codex2" },
  ]);
  assert.equal(both.fixLabel, "清除廢棄的 codex、claude 引用");
  ok("兩支都壞掉時按鈕列出兩支，重複的不重複列");

  assert.equal(both.installable, false);
  ok("這一列不是「沒裝」，不該長出安裝按鈕");

  // 迴歸：detail 原本塞了整段來龍去脈（含那條長路徑），把清單那一列撐爆，
  // 掛在列尾的修復鍵被擠出可視範圍——畫面上變成「有問題但沒東西可按」（VM 實測）。
  // 長說明的家在 public/model.js 的 GUIDANCE。
  for (const status of [claudeOnly, both]) {
    assert.ok(
      status.detail.length <= 40,
      `detail 太長會把修復鍵擠出畫面：${status.detail}`,
    );
    assert.ok(!status.detail.includes("\\"), "detail 不該塞進完整路徑");
  }
  ok("那一列的說明短到不會把按鈕擠出去");

  // 路徑仍然要拿得到——只是不放在那一列上。
  assert.equal(claudeOnly.deadPath, "/gone/claude");
  ok("死路徑另外附在結果上，需要時才顯示");

  const nativeTitle = shellWrapperStatus(oldPosixBlocks);
  assert.equal(nativeTitle.status, "warn");
  assert.match(nativeTitle.fixLabel, /Codex wrapper/);
  assert.match(nativeTitle.detail, /覆蓋.*原生.*標題/);
  ok("舊 Codex wrapper 的狀態文案會說明它覆蓋原生標題");

  const fakeHome = mkdtempSync(path.join(tmpdir(), "jr-shell-wrapper-home-"));
  const zshrc = path.join(fakeHome, ".zshrc");
  writeFileSync(zshrc, `${oldPosixTabSync}\nalias codex=\"$HOME/bin/mycodex\"\n`);
  const runFix = () =>
    execFileSync(
      process.execPath,
      [path.join(REPO_ROOT, "scripts", "fix-shell-wrapper.mjs"), "--apply"],
      {
        env: { ...process.env, HOME: fakeHome },
        encoding: "utf8",
      },
    );
  runFix();
  const afterFirstFix = readFileSync(zshrc, "utf8");
  assert.equal(
    afterFirstFix,
    ["export KEEP_BEFORE=1", "export KEEP_AFTER=1", ""].join("\n"),
  );
  assert.equal(
    readdirSync(fakeHome).filter((name) => name.startsWith(".zshrc.bak.")).length,
    1,
  );
  runFix();
  assert.equal(readFileSync(zshrc, "utf8"), afterFirstFix);
  assert.equal(
    readdirSync(fakeHome).filter((name) => name.startsWith(".zshrc.bak.")).length,
    1,
  );
  ok("修復腳本會先備份 fake HOME profile，且重跑保持冪等");
} catch (error) {
  console.error(error);
  process.exit(1);
}
