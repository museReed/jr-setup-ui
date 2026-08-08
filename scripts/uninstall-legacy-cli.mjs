// 移除舊一輪工作坊用 `npm install -g` 裝的 claude / codex。
//
//   node scripts/uninstall-legacy-cli.mjs --tools=claude,codex
//
// 為什麼要移除：那一份跟現在的原生安裝器落點不同（~/.local/bin），兩份可以並存，
// 而 `claude --version` 回的是 PATH 裡先出現的那一支——嚮導只看 exit code 會判成
// ok、不去裝新的，學生用的卻是舊的。
//
// ⚠️ 只碰這兩個寫死的套件名（見 src/legacy.js），不掃、不推測、不碰別人的 npm 環境。
// 而且先問 npm「你有沒有這個套件」，它說有才動手——用路徑猜的話，原生安裝器裝的那份
// 也可能被誤判成 npm 的。
import { spawn } from "node:child_process";

import { spawnEnv } from "../src/env-path.js";
import { LEGACY_NPM_PACKAGES } from "../src/legacy.js";
import { resolveLaunch } from "../src/spawn-command.js";

function arg(name, fallback) {
  const found = process.argv.find((value) => value.startsWith(`--${name}=`));
  return found === undefined ? fallback : found.slice(name.length + 3);
}

const tools = arg("tools", "claude").split(",");
const env = await spawnEnv();

// npm 在 Windows 是 npm.cmd，spawn 不開 shell 找不到裸指令——resolveLaunch 會查 PATH
// 並補上 cmd.exe 那層包裝（見 spawn-command.js）。
function runNpm(args) {
  const { cmd, args: resolved, spawnOptions } = resolveLaunch("npm", args, { env });

  return new Promise((resolve) => {
    let stdout = "";
    let child;

    try {
      child = spawn(cmd, resolved, {
        shell: false,
        stdio: ["ignore", "pipe", "inherit"],
        env,
        ...(spawnOptions ?? {}),
      });
    } catch {
      resolve({ ok: false, stdout: "" });
      return;
    }

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });
    child.once("error", () => resolve({ ok: false, stdout: "" }));
    child.once("close", (exitCode) => resolve({ ok: exitCode === 0, stdout }));
  });
}

// `npm ls -g --depth=0 --json` 是唯一可靠的答案。套件不在時 npm 會回非零，
// 但 JSON 照樣印得出來，所以看的是內容不是 exit code。
const listed = await runNpm(["ls", "-g", "--depth=0", "--json"]);
let installed = {};

try {
  installed = JSON.parse(listed.stdout || "{}").dependencies ?? {};
} catch {
  installed = {};
}

const wanted = tools
  .map((tool) => LEGACY_NPM_PACKAGES[tool])
  .filter((name) => name !== undefined && Object.hasOwn(installed, name));

if (wanted.length === 0) {
  console.log("npm 全域裡沒有舊版的 claude / codex，不需要移除。");
  console.log("（那兩份如果還在，它們是別的方式裝的——這支不會去碰。）");
  process.exit(0);
}

console.log(`要移除的：${wanted.join("、")}`);

let failed = false;

for (const name of wanted) {
  console.log("");
  console.log(`執行：npm uninstall -g ${name}`);
  const result = await runNpm(["uninstall", "-g", name]);

  if (!result.ok) {
    failed = true;
    console.error(`${name} 移除失敗——上面那段是 npm 自己講的原因。`);
  }
}

if (failed) {
  process.exit(1);
}

console.log("");
console.log("移除完成。這一步是可逆的：真的需要舊版，npm install -g 裝回來就好。");
console.log("回到卡片按一次「再 check 一次」，那一列會重新探測現在用的是哪一份。");
