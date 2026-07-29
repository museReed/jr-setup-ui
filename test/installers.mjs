import assert from "node:assert/strict";

import { actions } from "../src/actions.js";
import {
  INSTALLERS,
  installActionId,
  isBenignExit,
  resolveInstaller,
} from "../src/installers.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

// 迴歸：Windows 上沒有 npm.exe，spawn 不開 shell 時找不到裸的 "npm"。
// 實測 PowerShell 會去找 npm.ps1 並被執行原則擋掉，spawn 則直接 ENOENT。
const EXPECTED_NPM = { win32: "npm.cmd", darwin: "npm" };

for (const platform of ["win32", "darwin"]) {
  const installer = resolveInstaller("claude", platform);
  assert.equal(installer.cmd, EXPECTED_NPM[platform]);
  assert(installer.args.includes("@anthropic-ai/claude-code"));
}
ok("Claude Code 在 win32 用 npm.cmd、darwin 用 npm");

for (const platform of ["win32", "darwin"]) {
  const installer = resolveInstaller("codex", platform);
  assert.equal(installer.cmd, EXPECTED_NPM[platform]);
  assert(installer.args.includes("@openai/codex"));
}
ok("Codex 在 win32 用 npm.cmd、darwin 用 npm");

// 迴歸：winget 裝一個已存在的套件會回 2316632107（0x8A15002B），那不是失敗。
assert.equal(isBenignExit("winget", 2316632107), true);
assert.equal(isBenignExit("winget", 0x8a150061), true);
assert.equal(isBenignExit("winget", 1), false);
assert.equal(isBenignExit("npm.cmd", 2316632107), false);
assert.equal(isBenignExit("winget", null), false);
ok("winget 的「已安裝／無可用更新」不算失敗");

// 迴歸：不指定 --source 時，msstore 來源憑證驗證失敗的機器會整個裝不了
// （實測 0x8a15005e，winget 要求你先選一個來源）。
for (const id of ["git", "gh"]) {
  const installer = resolveInstaller(id, "win32");
  const sourceIndex = installer.args.indexOf("--source");
  assert(sourceIndex !== -1);
  assert.equal(installer.args[sourceIndex + 1], "winget");
  assert(installer.args.includes("--accept-source-agreements"));
}
ok("winget 安裝指定 --source winget 並自動接受來源條款");

const gitWindows = resolveInstaller("git", "win32");
assert.equal(gitWindows.cmd, "winget");
assert(gitWindows.args.includes("Git.Git"));
assert(gitWindows.args.includes("-e"));
ok("Git 在 win32 使用 winget 的精確套件 id");

const ghWindows = resolveInstaller("gh", "win32");
assert(ghWindows.args.includes("GitHub.cli"));
ok("GitHub CLI 在 win32 使用 winget 的精確套件 id");

const gitDarwin = resolveInstaller("git", "darwin");
assert.equal(gitDarwin.cmd, "brew");
ok("Git 在 darwin 使用 brew");

const ghDarwin = resolveInstaller("gh", "darwin");
assert.equal(ghDarwin.cmd, "brew");
assert(ghDarwin.args.includes("gh"));
ok("GitHub CLI 在 darwin 使用 brew");

const ghosttyDarwin = resolveInstaller("ghostty", "darwin");
assert.deepEqual(ghosttyDarwin, {
  cmd: "brew",
  args: ["install", "--cask", "ghostty"],
});
assert.equal(resolveInstaller("ghostty", "win32"), null);
ok("Ghostty 只在 darwin 提供 brew cask 安裝器");

assert.equal(resolveInstaller("node", "win32"), null);
ok("Node.js 不提供安裝器");

assert.equal(resolveInstaller("claude", "sunos"), null);
ok("未支援平台不提供安裝器");

assert.doesNotThrow(() => resolveInstaller("不存在", "win32"));
assert.equal(resolveInstaller("不存在", "win32"), null);
ok("不存在的項目安全回傳 null");

assert.equal(installActionId("git"), "install-git");
ok("installActionId 產生前後端共用的 action id");

const unsafeFragments = ["--dangerously", "&&", "|", ";"];
for (const installersByPlatform of Object.values(INSTALLERS)) {
  for (const installer of Object.values(installersByPlatform)) {
    for (const arg of installer.args) {
      assert(
        unsafeFragments.every((fragment) => !arg.includes(fragment)),
        `不安全的安裝參數：${arg}`,
      );
    }
  }
}
ok("所有安裝參數都不含危險字串");

const installerNames = {
  claude: "Claude Code",
  codex: "Codex",
  git: "Git",
  gh: "GitHub CLI",
};

for (const id of Object.keys(INSTALLERS)) {
  const installer = resolveInstaller(id, process.platform);
  const actionId = installActionId(id);

  if (installer === null) {
    assert(!Object.hasOwn(actions, actionId));
  } else {
    assert.equal(actions[actionId].kind, "fixed");
    assert.equal(actions[actionId].label, `安裝 ${installerNames[id]}`);
    assert.equal(actions[actionId].cmd, installer.cmd);
    assert.deepEqual(actions[actionId].args, installer.args);
    assert.equal(typeof actions[actionId].description, "string");
  }
}
ok("目前平台只有受支援的安裝器會進入 fixed action 白名單");

const expectedLoginActions = {
  "login-claude": { cmd: "claude", args: ["auth", "login"] },
  "login-codex": { cmd: "codex", args: ["login"] },
  "login-gh": {
    cmd: "gh",
    args: [
      "auth",
      "login",
      "--web",
      "--hostname",
      "github.com",
      "--git-protocol",
      "https",
      "--skip-ssh-key",
    ],
  },
};

for (const [actionId, expected] of Object.entries(expectedLoginActions)) {
  assert.equal(actions[actionId].kind, "fixed");
  assert.equal(actions[actionId].cmd, expected.cmd);
  assert.deepEqual(actions[actionId].args, expected.args);
  assert.equal(actions[actionId].acceptsInput, true);
  assert.equal(actions[actionId].launchesWindow, undefined);
}
ok("三個登入 action 直接執行並接受 stdin");
