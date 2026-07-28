import { spawn } from "node:child_process";

// Windows 的 PATH 存在登錄檔，winget 裝東西時會新增目錄進去。但正在跑的程序
// 拿的是啟動當下那份快照，看不到新項目——同學按完安裝再按重新檢查會以為沒裝成功。
// 所以每次檢查前重新讀一次，而不是叫使用者關掉重開。
const REFRESH_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 2000;

let cache = null;

export function mergePath(machinePath, userPath, currentPath) {
  const seen = new Set();
  const merged = [];

  for (const source of [machinePath, userPath, currentPath]) {
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

// 回傳給子程序用的環境變數。非 Windows 直接沿用目前的環境。
export async function spawnEnv(now = Date.now()) {
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

  const env = {
    ...process.env,
    PATH: mergePath(registry.machinePath, registry.userPath, process.env.PATH),
  };
  cache = { at: now, env };
  return env;
}
