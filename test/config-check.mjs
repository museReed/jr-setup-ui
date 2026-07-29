import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { probeHook } from "../src/config-check.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

const dir = mkdtempSync(path.join(tmpdir(), "jr-hook-"));

function hookAt(name, source) {
  const target = path.join(dir, name);
  writeFileSync(target, source);
  return target;
}

try {
  // 會擋的 hook：讀 stdin、看到串接符號就 exit 2。
  const real = hookAt(
    "real.js",
    `let raw = "";
process.stdin.on("data", (c) => { raw += c; });
process.stdin.on("end", () => {
  const cmd = JSON.parse(raw).tool_input.command;
  if (/&&|\\|\\||;/.test(cmd)) { process.stderr.write("擋下"); process.exit(2); }
  process.exit(0);
});`,
  );

  const blocked = await probeHook(real, "echo a && echo b");
  assert.equal(blocked.exitCode, 2);
  assert.equal(blocked.stderr, "擋下");
  ok("串接指令餵進去會拿到 exit 2 與訊息");

  const allowed = await probeHook(real, "echo hi");
  assert.equal(allowed.exitCode, 0);
  ok("單一指令餵進去會放行");

  // 這是關鍵情境：檔案在、也註冊了，但實際上什麼都不做。
  // 只看「檔案存不存在」的檢查會誤判成裝好了。
  const neutered = hookAt("neutered.js", "process.exit(0)\n");
  assert.equal((await probeHook(neutered, "echo a && echo b")).exitCode, 0);
  ok("失效的 hook 會回 exit 0——檢查據此判定「沒擋下來」");

  // 檔案根本不在時不能整個爆掉，要回一個能判讀的結果。
  const missing = await probeHook(path.join(dir, "不存在.js"), "echo a && echo b");
  assert.notEqual(missing.exitCode, 2);
  ok("hook 檔案不存在時不會爆掉，也不會誤判成有擋");
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
