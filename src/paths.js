import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

export function ensureWorkDir() {
  const workDir = resolve(homedir(), ".jr-setup", "workdir");
  mkdirSync(workDir, { recursive: true });
  return workDir;
}
