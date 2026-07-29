import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function ensureWorkDir() {
  const workDir = resolve(homedir(), ".jr-setup", "workdir");
  mkdirSync(workDir, { recursive: true });
  return workDir;
}

// ⚠️ 一律用 fileURLToPath，不要用 new URL(...).pathname。
// Windows 上 pathname 會回傳 "/C:/Users/..."（前面多一條斜線），拿去當指令參數
// 會被接成 "C:\C:\Users\..." 而找不到檔案。macOS 上 pathname 剛好是對的，
// 所以這個錯只有在 Windows 才會現形（實測踩過）。
export function moduleFile(relativePath, baseUrl) {
  return fileURLToPath(new URL(relativePath, baseUrl));
}

// 規則檔素材內建在 repo 裡（scripts/sync-materials.sh 從 jr_ai_agent_configs 同步）。
// 不在安裝時上網抓：工作坊現場網路不一定穩，少一個會壞的環節。
export function materialsDir() {
  return moduleFile("../materials", import.meta.url);
}
