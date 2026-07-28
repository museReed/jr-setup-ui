import { existsSync } from "node:fs";

// Node 20 起，spawn 在 shell:false 下執行 .cmd / .bat 會直接丟 EINVAL
// （BatBadBut 漏洞的修補，CVE-2024-27980）。Windows 上 npm 裝出來的 CLI
// 都是這種包裝檔，所以必須改成交給 cmd.exe 執行。
//
// ⚠️ 只能用在「指令與參數都寫死在程式裡」的情況。cmd.exe 有自己的一套
// 引號與跳脫規則，把外部輸入（例如使用者打的 prompt）當參數傳過去
// 可能被注入。使用者輸入要走的路見 README / spike-log。
const WRAPPED_EXTENSIONS = [".cmd", ".bat"];

export function needsCmdWrapper(cmd, platform = process.platform) {
  if (platform !== "win32") {
    return false;
  }

  const lower = cmd.toLowerCase();
  return WRAPPED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function resolveSpawn(cmd, args, platform = process.platform) {
  if (!needsCmdWrapper(cmd, platform)) {
    return { cmd, args };
  }

  // /d 不跑 AutoRun、/s 讓引號處理可預測、/c 執行完就結束。
  return { cmd: "cmd.exe", args: ["/d", "/s", "/c", cmd, ...args] };
}

// Windows 上 npm 裝出來的 CLI 是 claude.cmd / codex.cmd，沒有同名 .exe，
// spawn 不開 shell 時找不到裸指令。env-check 的 runProbe 撞到 ENOENT 會補 .cmd
// 重試，但按鈕跑的動作走另一條路、沒有那層退路——實測按登入就是回
// 「找不到 claude 指令」、exit code 為 null。
// 這裡改成事前查 PATH：查到什麼副檔名就用什麼；查不到就原樣回傳，
// 讓 ENOENT 照常浮現成「請先安裝」。
const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

export function findExecutable(cmd, env, fileExists) {
  const directories = (env.PATH ?? env.Path ?? "").split(";");
  const extensions = (env.PATHEXT ?? DEFAULT_PATHEXT).split(";");

  for (const directory of directories) {
    const trimmed = directory.trim().replace(/[\\/]+$/, "");

    if (trimmed.length === 0) {
      continue;
    }

    for (const extension of extensions) {
      const candidate = `${trimmed}\\${cmd}${extension.trim()}`;

      if (fileExists(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

// 動作實際要 spawn 的指令。副檔名已經寫死的（npm.cmd）維持原本的處理，
// 裸指令才去查 PATH。
export function resolveLaunch(cmd, args, { env, fileExists, platform } = {}) {
  const runtime = platform ?? process.platform;

  if (runtime !== "win32" || cmd.includes(".")) {
    return resolveSpawn(cmd, args, runtime);
  }

  const found = findExecutable(cmd, env ?? process.env, fileExists ?? existsSync);

  if (found === null) {
    return { cmd, args };
  }

  return resolveSpawn(found, args, runtime);
}
