import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

export function ensureWorkDir() {
  const workDir = resolve(homedir(), ".jr-setup", "workdir");
  mkdirSync(workDir, { recursive: true });
  return workDir;
}

// 從 jr_ai_agent_configs 抓下來的規則檔素材放這裡。
export function materialsDir() {
  return resolve(homedir(), ".jr-setup", "configs");
}
