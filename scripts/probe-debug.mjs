// 量測環境檢查每一步花多久，用來查「檢查逾時」到底卡在哪。
// 用法（在解壓出來的資料夾旁邊）：
//   node jr-setup-ui-feature-install-buttons\scripts\probe-debug.mjs
import { runEnvCheck, runProbe } from "../src/env-check.js";
import { spawnEnv } from "../src/env-path.js";

function ms(startedAt) {
  return `${Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6)} ms`;
}

async function timed(label, work) {
  const startedAt = process.hrtime.bigint();
  const value = await work();
  console.log(`${label.padEnd(28)} ${ms(startedAt).padStart(8)}`);
  return value;
}

function summarize(result) {
  if (result.type === "close") {
    const firstLine = (result.stdout ?? "").trim().split("\n")[0] ?? "";
    return `close exit=${result.exitCode} stdout=${JSON.stringify(firstLine)}`;
  }

  if (result.type === "error") {
    return `error code=${result.error?.code ?? "?"}`;
  }

  return result.type;
}

const PROBES = [
  ["claude --version", "claude", ["--version"], true],
  ["codex --version", "codex", ["--version"], true],
  ["git --version", "git", ["--version"], true],
  ["gh --version", "gh", ["--version"], true],
  ["node --version", "node", ["--version"], true],
  ["codex login status", "codex", ["login", "status"], false],
  ["claude auth status", "claude", ["auth", "status"], false],
];

console.log(`platform=${process.platform} node=${process.version}`);

const env = await timed("spawnEnv（讀登錄檔 PATH）", () => spawnEnv());
console.log(`PATH 共 ${(env.PATH ?? "").split(";").length} 個目錄`);
console.log(`PATHEXT=${env.PATHEXT ?? "(無)"}`);
console.log("");

console.log("── 逐個跑（不併行）──");
for (const [label, cmd, args, emptyFailureMeansMissing] of PROBES) {
  const result = await timed(label, () =>
    runProbe(cmd, args, { emptyFailureMeansMissing }),
  );
  console.log(`  → ${summarize(result)}`);
}

console.log("");
console.log("── 照嚮導的方式併行跑一次 ──");
const report = await timed("runEnvCheck 全部", () => runEnvCheck());
for (const check of report.checks) {
  console.log(`  ${check.id.padEnd(16)} ${check.status.padEnd(8)} ${check.detail}`);
}
