import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

export function ensureWorkDir() {
  const workDir = resolve(homedir(), ".jr-setup", "workdir");
  mkdirSync(workDir, { recursive: true });
  return workDir;
}

// 規則檔素材內建在 repo 裡（scripts/sync-materials.sh 從 jr_ai_agent_configs 同步）。
// 不在安裝時上網抓：工作坊現場網路不一定穩，少一個會壞的環節。
export function materialsDir() {
  return new URL("../materials", import.meta.url).pathname;
}
