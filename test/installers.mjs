import assert from "node:assert/strict";

import { actions, installerNames } from "../src/actions.js";
import {
  INSTALLERS,
  installActionId,
  isBenignExit,
  resolveInstaller,
} from "../src/installers.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

// Windows 也改走兩家官方的 PowerShell 安裝器，跟 macOS 同一套來源。
// -NoProfile：學生的 PowerShell profile 可能印東西或改 PATH，安裝不該受它影響。
const claudeWindows = resolveInstaller("claude", "win32");
assert.equal(claudeWindows.cmd, "powershell.exe");
assert(claudeWindows.args.includes("-NoProfile"));
assert(claudeWindows.args.at(-1).includes("https://claude.ai/install.ps1"));
assert(!claudeWindows.args.at(-1).includes("npm install -g"));

const codexWindows = resolveInstaller("codex", "win32");
assert.equal(codexWindows.cmd, "powershell.exe");
assert(codexWindows.args.includes("-NoProfile"));
assert(codexWindows.args.at(-1).includes("https://chatgpt.com/codex/install.ps1"));
assert(!codexWindows.args.at(-1).includes("npm install -g"));
// codex 官方的 Windows 指令帶這個旗標，照抄不自己判斷要不要。
assert(codexWindows.args.includes("-ExecutionPolicy"));
assert(codexWindows.args.includes("Bypass"));
ok("Windows 兩項都改走官方原生安裝器，不經過 npm");

// 跟 macOS 同一個環境變數（.ps1 第 14 行讀它）。Windows 還有第二道保險——
// Prompt-YesNo 在 stdio 被導向時直接回 false——但意圖要寫出來，不靠副作用。
assert.equal(codexWindows.env.CODEX_NON_INTERACTIVE, "1");
assert.equal(claudeWindows.env, undefined);
ok("Windows 的 codex 安裝同樣帶 CODEX_NON_INTERACTIVE");

// 迴歸（乾淨 macOS VM 實測）：官方 .pkg 裝的 Node 把 /usr/local/lib/node_modules
// 留給 root，學生帳號跑 npm install -g 直接 EACCES。macOS 這兩項都不能再碰全域目錄。
const claudeDarwin = resolveInstaller("claude", "darwin");
assert.equal(claudeDarwin.cmd, "bash");
assert(claudeDarwin.args[1].includes("https://claude.ai/install.sh"));
assert(!claudeDarwin.args[1].includes("npm install -g"));

const codexDarwin = resolveInstaller("codex", "darwin");
assert.equal(codexDarwin.cmd, "bash");
assert(codexDarwin.args[1].includes("https://chatgpt.com/codex/install.sh"));
assert(!codexDarwin.args[1].includes("npm install -g"));
ok("macOS 兩項都改走官方原生安裝器，不經過 npm 全域目錄");

// curl 失敗時右邊的直譯器讀到空輸入會正常結束，整條管線變 exit 0——
// 沒裝成功卻回報成功。pipefail 是唯一擋得住的東西。
for (const installer of [claudeDarwin, codexDarwin]) {
  assert(installer.args[1].startsWith("set -eo pipefail"));
}
ok("macOS 的安裝腳本都開 pipefail，curl 失敗不會假裝成功");

// 兩支安裝器對 PATH 的處理不一樣，實測過的差異要鎖住：
// claude 完全不碰 shell rc（只印提醒），codex 自己寫 ~/.zprofile。
assert(claudeDarwin.args[1].includes(".zshrc"));
assert(claudeDarwin.args[1].includes("grep -qF"));
assert(!codexDarwin.args[1].includes(".zshrc"));
ok("claude 由嚮導冪等補 .zshrc，codex 的 PATH 交給它自己處理");

// 沒有這個變數，安裝器會問「Start Codex now?」——問句寫到 /dev/tty，也就是學生
// 沒在看的那個終端機，然後停在那裡等永遠不會來的輸入。網頁輸入框寫的是 stdin，
// 救不了。
assert.equal(codexDarwin.env.CODEX_NON_INTERACTIVE, "1");
assert.equal(claudeDarwin.env, undefined);
ok("codex 的安裝帶 CODEX_NON_INTERACTIVE，不會停在看不見的提問");

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

// 迴歸：嚮導 spawn 出來的 winget 沒有人在看著，跳出任何一個要人選的提示就是永久卡住。
// 一條漏掉就是一顆會卡死的安裝鍵，所以整批一起釘。
//
// 這個旗標管的是「不准問問題」，不是「輸出變乾淨」——進度動畫加了照樣有（VM 實測）。
for (const id of ["python", "git", "gh", "windows-terminal"]) {
  const installer = resolveInstaller(id, "win32");
  assert.equal(installer.cmd, "winget");
  assert(installer.args.includes("--disable-interactivity"), id);
}
ok("每一條 win32 的 winget 都關掉互動式進度輸出");

const gitWindows = resolveInstaller("git", "win32");
assert.equal(gitWindows.cmd, "winget");
assert(gitWindows.args.includes("Git.Git"));
assert(gitWindows.args.includes("-e"));
ok("Git 在 win32 使用 winget 的精確套件 id");

const ghWindows = resolveInstaller("gh", "win32");
assert(ghWindows.args.includes("GitHub.cli"));
ok("GitHub CLI 在 win32 使用 winget 的精確套件 id");

// 迴歸：嚮導 spawn 出來的 brew 沒有人在看著，跳出任何一句要人回答的話就是永久卡住
// ——畫面停在安裝中，學生只能按取消。同一個檔案裡 codex 的 darwin 安裝已經為了一模
// 一樣的理由帶著 CODEX_NON_INTERACTIVE，brew 這幾條是補上同一道防線。
for (const id of ["python", "git", "gh", "ghostty"]) {
  const installer = resolveInstaller(id, "darwin");
  assert.equal(installer.cmd, "brew");
  assert.equal(installer.env.NONINTERACTIVE, "1", id);
}
ok("每一條 darwin 的 brew 都帶 NONINTERACTIVE，不會停在看不見的提問");

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
  env: { NONINTERACTIVE: "1" },
});
assert.equal(resolveInstaller("ghostty", "win32"), null);
ok("Ghostty 只在 darwin 提供 brew cask 安裝器");

const terminalWin = resolveInstaller("windows-terminal", "win32");
assert.equal(terminalWin.cmd, "winget");
assert(terminalWin.args.includes("Microsoft.WindowsTerminal"));
// 迴歸：不指定 --source winget 會去撞 msstore 憑證驗證。
assert(terminalWin.args.includes("--source"));
assert.equal(resolveInstaller("windows-terminal", "darwin"), null);
ok("Windows Terminal 只在 win32 提供 winget 安裝器");

assert.equal(resolveInstaller("node", "win32"), null);
ok("Node.js 不提供安裝器");

assert.equal(resolveInstaller("claude", "sunos"), null);
ok("未支援平台不提供安裝器");

assert.doesNotThrow(() => resolveInstaller("不存在", "win32"));
assert.equal(resolveInstaller("不存在", "win32"), null);
ok("不存在的項目安全回傳 null");

assert.equal(installActionId("git"), "install-git");
ok("installActionId 產生前後端共用的 action id");

// macOS 那兩項的參數本身就是一段 shell script，管線與 || 是寫給直譯器看的，
// 不是被夾帶進來的——所以「不准出現 shell 字元」這條守不住它們。
// 換成守真正要守的東西：形狀必須是 `bash -c <字串>`，而且腳本只能連到這兩個
// 官方網域。沒有任何一段字串來自使用者輸入。
const ALLOWED_HOSTS = ["https://claude.ai/", "https://chatgpt.com/"];
const unsafeFragments = ["--dangerously", "&&", "|", ";"];

// bash -c / powershell -Command 的最後一個參數就是一段腳本，管線是寫給直譯器看的。
const SCRIPT_RUNNERS = { bash: "-c", "powershell.exe": "-Command" };

for (const installersByPlatform of Object.values(INSTALLERS)) {
  for (const installer of Object.values(installersByPlatform)) {
    const scriptFlag = SCRIPT_RUNNERS[installer.cmd];

    if (scriptFlag !== undefined) {
      // 腳本必須是最後一個參數，而且緊跟在它自己的旗標後面——形狀固定，才不會有
      // 「某個中間參數其實也被當成腳本執行」的空間。
      assert.equal(installer.args.at(-2), scriptFlag);
      const script = installer.args.at(-1);

      const urls = script.match(/https?:\/\/\S+/g) ?? [];
      assert(urls.length > 0, "安裝腳本應該有下載來源");
      for (const url of urls) {
        assert(
          ALLOWED_HOSTS.some((host) => url.startsWith(host)),
          `安裝腳本連到未預期的網域：${url}`,
        );
      }

      // 腳本以外的參數照舊禁止 shell 字元。
      for (const arg of installer.args.slice(0, -1)) {
        assert(
          unsafeFragments.every((fragment) => !arg.includes(fragment)),
          `不安全的安裝參數：${arg}`,
        );
      }
      continue;
    }

    for (const arg of installer.args) {
      assert(
        unsafeFragments.every((fragment) => !arg.includes(fragment)),
        `不安全的安裝參數：${arg}`,
      );
    }
  }
}
ok("安裝參數不含危險字串；bash 腳本只連得到官方網域");

// 用 actions.js 那一份，不再自己抄一份。
//
// 這裡原本有一份重複的表，只有四個項目——於是 ghostty 與 windows-terminal 的按鈕
// 一直是「安裝 undefined」，測試卻照樣綠：它拿自己那份缺漏的表去比對，兩邊一起錯
// 就對得起來。加 python 時才被 actions.js 裡新加的守衛抓出來。

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
    // 安裝器要求的環境變數必須真的傳到 action 上，否則 server 那層拿不到——
    // codex 少了它就會停在看不見的提問，而且畫面上只會顯示成逾時。
    assert.deepEqual(actions[actionId].env, installer.env);
  }
}
ok("目前平台只有受支援的安裝器會進入 fixed action 白名單，且環境變數有傳到");

const expectedLoginActions = {
  "login-claude": { cmd: "claude", args: ["auth", "login"] },
  // ⚠️ 不要加 --device-auth：那個模式需要每個帳號先去 ChatGPT Security Settings
  // 打開裝置碼授權，沒開的人在授權頁只會看到紅字要他改設定（VM 實測），對學生是死路。
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

// claude 與 gh 會自己彈瀏覽器，學生就來不及用卡片上的授權按鈕。兩者都認 BROWSER，
// 指到一個什麼都不做的指令即可擋掉。codex 走 --device-auth 本來就不會開。
for (const actionId of ["login-claude", "login-gh"]) {
  assert.equal(
    typeof actions[actionId].env?.BROWSER,
    "string",
    `${actionId} 要覆寫 BROWSER 才不會自己開瀏覽器`,
  );
  assert.notEqual(actions[actionId].env.BROWSER, "");
}
assert.equal(actions["login-codex"].env, undefined);
// gh 的 GH_BROWSER 優先於 BROWSER，只設 BROWSER 會被學生環境既有的 GH_BROWSER 蓋掉。
assert.equal(
  actions["login-gh"].env.GH_BROWSER,
  actions["login-gh"].env.BROWSER,
);
ok("claude 與 gh 覆寫 BROWSER 擋掉自動開瀏覽器，codex 靠 --device-auth");
