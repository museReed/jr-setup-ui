import { spawn } from "node:child_process";
import { homedir } from "node:os";

// Windows 的 PATH 存在登錄檔，winget 裝東西時會新增目錄進去。但正在跑的程序
// 拿的是啟動當下那份快照，看不到新項目——同學按完安裝再按重新檢查會以為沒裝成功。
// 所以每次檢查前重新讀一次，而不是叫使用者關掉重開。
const REFRESH_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 2000;

let cache = null;

export function mergePath(machinePath, userPath, currentPath, ...extra) {
  const seen = new Set();
  const merged = [];

  for (const source of [machinePath, userPath, currentPath, ...extra]) {
    if (typeof source !== "string") {
      continue;
    }

    for (const entry of source.split(";")) {
      const trimmed = entry.trim();

      if (trimmed.length === 0) {
        continue;
      }

      const key = trimmed.toLowerCase();

      if (!seen.has(key)) {
        seen.add(key);
        merged.push(trimmed);
      }
    }
  }

  return merged.join(";");
}

function readRegistryPath() {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";

    const finish = (value) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(value);
      }
    };

    let child;

    try {
      child = spawn(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          "[Environment]::GetEnvironmentVariable('Path','Machine');" +
            "'---';" +
            "[Environment]::GetEnvironmentVariable('Path','User')",
        ],
        { shell: false, stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch {
      resolve(null);
      return;
    }

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(null);
    }, REFRESH_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.resume();
    child.once("error", () => finish(null));
    child.once("close", (exitCode) => {
      if (exitCode !== 0) {
        finish(null);
        return;
      }

      const [machinePath = "", userPath = ""] = stdout.split("---");
      finish({ machinePath: machinePath.trim(), userPath: userPath.trim() });
    });
  });
}

// macOS 這邊是同一個病、不同的藥。claude 與 codex 的原生安裝器都裝進 ~/.local/bin，
// 而那個目錄是安裝當下才被寫進 .zshrc 的——正在跑的嚮導拿的是啟動時那份 PATH，
// 看不到它。
//
// 實測（乾淨 VM）：按完安裝，輸出是 exit code 0 加「Installation complete!」，
// 卡片卻仍然顯示「未安裝」，而畫面上還寫著「狀態已更新」。學生看到的是
// 「明明裝好了卻說沒裝」——最容易讓人重按第二次的畫面。
//
// 只補這一個目錄就夠：兩支 CLI 都在裡面。
// ~/.local/bin  claude / codex 的原生安裝器落點
// /opt/homebrew/bin  Apple Silicon 的 Homebrew（git / gh / python / ghostty 靠它）
//
// 兩者都是「安裝當下才被寫進 shell 設定檔」的目錄，而 PATH 是每個 shell 各自一份：
// 已經開著的終端機不會重讀 .zprofile／.zshrc，從它啟動的嚮導自然也拿不到。
// 實測就撞了兩次——裝完 claude 卡片仍顯示未安裝、brew 裝好了按 gh 仍說「找不到
// brew 指令」。安裝鍵不開新視窗（沒有任何 action 設 launchesWindow），子程序繼承的
// 就是嚮導這份 PATH，所以只能在這裡補。
const DARWIN_EXTRA_BINS = ["~/.local/bin", "/opt/homebrew/bin"];

export function withUserBin(currentPath, home) {
  const entries = (typeof currentPath === "string" ? currentPath : "")
    .split(":")
    .filter((entry) => entry.trim().length > 0);
  const additions = DARWIN_EXTRA_BINS.map((dir) =>
    dir.startsWith("~/") ? `${home}/${dir.slice(2)}` : dir,
  ).filter((dir) => !entries.includes(dir));

  return [...entries, ...additions].join(":");
}

// 把重算過的 PATH 放進環境變數，同時把原本那把不同大小寫的鑰匙拿掉。
//
// ⚠️ 這是整個 Windows 支援最陰的一個坑。Windows 的環境變數不分大小寫，而
// process.env 上那把鑰匙實際叫 `Path`（不是 `PATH`）。所以
//
//   { ...process.env, PATH: 重算過的 }
//
// 得到的物件同時有 `Path`（舊的快照）跟 `PATH`（新的）。Node 在 win32 上 spawn 前
// 會把大小寫重複的鍵過濾掉，而它保留的是**先出現的那一把**——展開 process.env 時
// `Path` 就已經在前面了，於是新的 `PATH` 整個被丟掉。
//
// 表現出來就是：登錄檔讀對了、mergePath 也算對了，子程序拿到的還是啟動當下那份舊
// PATH。畫面上是「winget 印 Successfully installed、exit code 0，那一列還是未安裝」
// ——git 與 Claude Code CLI 在 Windows VM 上都是這樣（Reed 實測，PATH 裡明明有
// C:\Program Files\Git\cmd）。整套重讀登錄檔的機制等於從來沒有生效過。
//
// macOS 不受影響：那邊大小寫有分，Node 也不做這個過濾。
export function withPath(base, value) {
  const env = {};

  for (const [key, existing] of Object.entries(base)) {
    if (key.toLowerCase() === "path") {
      continue;
    }

    env[key] = existing;
  }

  env.PATH = value;
  return env;
}

// 回傳給子程序用的環境變數。
export async function spawnEnv(now = Date.now()) {
  if (process.platform === "darwin") {
    return { ...process.env, PATH: withUserBin(process.env.PATH, homedir()) };
  }

  if (process.platform !== "win32") {
    return process.env;
  }

  if (cache !== null && now - cache.at < CACHE_TTL_MS) {
    return cache.env;
  }

  const registry = await readRegistryPath();

  if (registry === null) {
    return process.env;
  }

  const env = withPath(
    process.env,
    mergePath(
      registry.machinePath,
      registry.userPath,
      process.env.PATH,
      // claude 的 Windows 安裝器把執行檔放在 %USERPROFILE%\.local\bin，然後跑
      // `claude.exe install` 做 shell 整合——它有沒有把那個目錄寫進登錄檔，
      // 從安裝腳本裡看不出來。codex 那支明確會寫（SetEnvironmentVariable 到 User），
      // claude 沒有對應的段落。
      //
      // 補一份保險：重讀登錄檔本來就是為了「剛裝好的東西要叫得動」，這個目錄是
      // 已知落點，加進去不會有壞處；真沒寫登錄檔時它就是唯一救得回來的東西。
      // macOS 那邊同一個理由補 ~/.local/bin（實測不補就是裝完仍顯示未安裝）。
      `${homedir()}\\.local\\bin`,
    ),
  );
  cache = { at: now, env };
  return env;
}
