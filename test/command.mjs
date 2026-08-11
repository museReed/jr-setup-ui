import assert from "node:assert/strict";

import { actions, buildAgentCommand, resolveEngine } from "../src/actions.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

const prompt = "含有空白的測試 prompt";

try {
  const claudeReadOnly = buildAgentCommand(
    "claude",
    prompt,
    "read-only",
  );
  assert(claudeReadOnly.args.includes("--allowedTools"));
  assert(!claudeReadOnly.args.join(" ").includes("Write"));
  ok("claude read-only 只帶唯讀工具");

  // A3 之後合併改成開真終端（merge-in-terminal），舊的 merge-config-step 整顆移除。
  //
  // ⚠️ 移除不只是清理：它是嚮導裡唯一「不先拍快照就改寫學生檔案」的路徑。留著等於
  // 留一條沒有退路的合併。「誰家的設定用誰合併」那條規矩沒有消失，改由
  // src/merge-backup.js 的 MERGE_GROUPS 寫死（測試在 test/merge-backup.mjs），
  // 那份表同時決定了哪幾檔一起合、用哪個 agent。
  assert.equal(actions["merge-config-step"], undefined);
  ok("舊的 in-wizard 合併已經整顆移除，沒有不拍快照的合併路徑");

  // 固定字串的 engine 照舊，不要為了新形狀把舊的那幾顆一起改掉。
  assert.equal(resolveEngine(actions["codex-hello"]), "codex");
  assert.equal(resolveEngine(actions["claude-hello"], { tools: "codex" }), "claude");
  ok("固定 engine 的動作不受影響");

  const claudeWrite = buildAgentCommand("claude", prompt, "write");
  assert(claudeWrite.args.join(" ").includes("Write"));
  assert(claudeWrite.args.join(" ").includes("Edit"));
  ok("claude write 帶 Write 與 Edit");

  const codexReadOnly = buildAgentCommand("codex", prompt, "read-only");
  assert.deepEqual(
    codexReadOnly.args.slice(-4, -2),
    ["--sandbox", "read-only"],
  );
  ok("codex read-only 使用 read-only sandbox");

  const codexWrite = buildAgentCommand("codex", prompt, "write");
  assert.deepEqual(
    codexWrite.args.slice(-4, -2),
    ["--sandbox", "workspace-write"],
  );
  ok("codex write 使用 workspace-write sandbox");

  const commands = [
    claudeReadOnly,
    claudeWrite,
    codexReadOnly,
    codexWrite,
  ];
  assert(
    commands.every((command) => command.args.at(-1) === prompt),
  );
  ok("四種組合都把 prompt 放在 args 最後");

  // 迴歸：--allowedTools 是變長參數，逐個列會把 prompt 一起吃掉，
  // 實測會得到 "Input must be provided ... when using --print"。
  assert.equal(
    claudeReadOnly.args[claudeReadOnly.args.indexOf("--allowedTools") + 1],
    "Read,Glob,Grep",
  );
  assert.equal(
    claudeWrite.args[claudeWrite.args.indexOf("--allowedTools") + 1],
    "Read,Glob,Grep,Write,Edit",
  );
  ok("claude 的 allowedTools 串成單一逗號值，不會吃掉 prompt");

  assert(commands.every((command) => command.args.at(-2) === "--"));
  ok("四種組合都用 -- 收尾參數解析");

  const dashPrompt = "--help 這不是參數";
  for (const engine of ["claude", "codex"]) {
    const command = buildAgentCommand(engine, dashPrompt, "read-only");
    assert.equal(command.args.at(-1), dashPrompt);
    assert.equal(command.args.at(-2), "--");
  }
  ok("以 - 開頭的 prompt 仍被當成 prompt");

  assert.throws(
    () => buildAgentCommand("claude", prompt, "full"),
    /不支援的代理權限/,
  );
  ok("非法 permission 會丟 Error");

  const dangerousFlags = [
    "--dangerously-skip-permissions",
    "--dangerously-bypass-approvals-and-sandbox",
  ];
  assert(
    commands.every((command) =>
      dangerousFlags.every((flag) => !command.args.includes(flag)),
    ),
  );
  ok("四種組合都不含危險權限參數");
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
