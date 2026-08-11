import { existsSync, readdirSync, realpathSync } from "node:fs";

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

function quoteIfSpaced(value) {
  return /\s/.test(value) ? `"${value}"` : value;
}

export function resolveSpawn(cmd, args, platform = process.platform) {
  if (!needsCmdWrapper(cmd, platform)) {
    return { cmd, args };
  }

  // 路徑帶空白時（C:\Program Files\nodejs\npx.cmd）不能把指令當成一般參數丟：
  // cmd.exe 會在空白處斷開，畫面上是 'C:\Program' is not recognized（VM 實測，
  // winget 那些指令沒有空白所以一直沒踩到）。
  //
  // 正確形狀是「整串再包一層引號」：cmd /d /s /c ""C:\...\npx.cmd" --yes ..."
  // /s 會把最外層那對引號剝掉，剩下的才是 cmd 看得懂的「有引號的指令 + 參數」。
  // 這需要 windowsVerbatimArguments，否則 Node 會再跳脫一次引號、全部走樣。
  const line = [quoteIfSpaced(cmd), ...args.map(quoteIfSpaced)].join(" ");

  // /d 不跑 AutoRun、/s 讓引號處理可預測、/c 執行完就結束。
  return {
    cmd: "cmd.exe",
    args: ["/d", "/s", "/c", `"${line}"`],
    spawnOptions: { windowsVerbatimArguments: true },
  };
}

// Windows 上 npm 裝出來的 CLI 是 claude.cmd / codex.cmd，沒有同名 .exe，
// spawn 不開 shell 時找不到裸指令。env-check 的 runProbe 撞到 ENOENT 會補 .cmd
// 重試，但按鈕跑的動作走另一條路、沒有那層退路——實測按登入就是回
// 「找不到 claude 指令」、exit code 為 null。
// 這裡改成事前查 PATH：查到什麼副檔名就用什麼；查不到就原樣回傳，
// 讓 ENOENT 照常浮現成「請先安裝」。
const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

export function findAllExecutables(
  cmd,
  env,
  {
    platform = process.platform,
    fileExists,
    realPath = (candidate) => candidate,
    listDir = (dir) => readdirSync(dir),
  } = {},
) {
  const windows = platform === "win32";
  // ⚠️ 光靠 existsSync 看不到「應用程式執行別名」。%LOCALAPPDATA%\Microsoft\
  // WindowsApps 底下那些是零位元組的 APPEXECLINK reparse point——Node 對它們
  // stat 會直接 EACCES，於是 existsSync 回 false，那支 CLI 在我們眼裡等於不存在。
  //
  // 真機實測（Reed 的 VM）：pwsh --version 回 PowerShell 7.6.4、PATH 上也有那個
  // 目錄，我們卻回報「沒有裝 PowerShell 7」。最諷刺的是 B5 那一列的**全部目的**
  // 就是偵測 Store 版，而它結構上做不到。
  //
  // 列目錄看得到（同一次實測 readdir 回 true），所以每個 PATH 目錄列一次、
  // 比檔名。existsSync 保留當主要判準：測試都靠它注入假檔案系統，而且真的檔案
  // 走它比較直接。
  const listedNames = new Map();
  const namesIn = (dir) => {
    if (!listedNames.has(dir)) {
      try {
        listedNames.set(
          dir,
          new Set(listDir(dir).map((name) => name.toLowerCase())),
        );
      } catch {
        // 目錄不存在、沒權限——當作沒有東西，不要讓整趟解析中斷。
        listedNames.set(dir, null);
      }
    }

    return listedNames.get(dir);
  };
  const directories = (env.PATH ?? env.Path ?? "").split(windows ? ";" : ":");
  const extensions = windows
    ? (env.PATHEXT ?? DEFAULT_PATHEXT).split(";")
    : [""];
  const separator = windows ? "\\" : "/";
  const seen = new Set();
  const candidates = [];

  for (const directory of directories) {
    const raw = directory.trim();

    if (raw.length === 0) {
      continue;
    }

    const trimmed = raw.replace(/[\\/]+$/, "");
    const base = trimmed.length === 0 ? separator : trimmed;

    for (const extension of extensions) {
      const name = `${cmd}${extension.trim()}`;
      const candidate =
        base === separator ? `${base}${name}` : `${base}${separator}${name}`;

      if (!fileExists(candidate) && namesIn(base)?.has(name.toLowerCase()) !== true) {
        continue;
      }

      let identity = candidate;

      try {
        identity = realPath(candidate);
      } catch {
        // 連結暫時解不開仍可能是可執行檔，不能因為去重失敗就漏掉它。
      }

      if (seen.has(identity)) {
        continue;
      }

      seen.add(identity);
      candidates.push(candidate);
    }
  }

  return candidates;
}

export function pickRunnable(candidates, { platform = process.platform } = {}) {
  if (candidates.length === 0) {
    return null;
  }

  if (platform !== "win32") {
    return candidates[0];
  }

  return (
    candidates.find((candidate) => /\.(exe|com)$/i.test(candidate)) ??
    candidates[0]
  );
}

export function findExecutable(cmd, env, fileExists) {
  return (
    findAllExecutables(cmd, env, { platform: "win32", fileExists })[0] ?? null
  );
}

// 動作實際要 spawn 的指令。副檔名已經寫死的（npm.cmd）維持原本的處理，
// 裸指令才去查 PATH。
export function resolveLaunch(
  cmd,
  args,
  { env, fileExists, realPath, platform } = {},
) {
  const runtime = platform ?? process.platform;

  if (runtime !== "win32" || cmd.includes(".")) {
    return resolveSpawn(cmd, args, runtime);
  }

  const candidates = findAllExecutables(cmd, env ?? process.env, {
    platform: runtime,
    fileExists: fileExists ?? existsSync,
    realPath: realPath ?? realpathSync,
  });
  const found = pickRunnable(candidates, { platform: runtime });

  if (found === null) {
    return { cmd, args };
  }

  return resolveSpawn(found, args, runtime);
}
