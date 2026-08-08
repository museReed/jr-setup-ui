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

  // 迴歸：合併那顆原本寫死 engine: "claude"。選「只要 Codex」的學生機器上沒有
  // claude——那組檢查整組被拿掉、CLI 也不會安裝——但 config.toml 是 protectExisting，
  // 仍然會要求合併，按下去拿到的是「找不到 claude 指令」。
  const merge = actions["merge-config-step"];
  assert.equal(resolveEngine(merge, { tools: "codex" }), "codex");
  assert.equal(resolveEngine(merge, { tools: "claude" }), "claude");
  // 兩個都選時優先 claude：課堂主線，而且它那邊裝好的 acceptEdits 讓合併不會停下
  // 來問（Reed 指定）。
  assert.equal(resolveEngine(merge, { tools: "claude,codex" }), "claude");
  // 誰家的設定就用誰去合併（Reed 實測：Codex 的 config.toml 那張卡，終端上印的是
  // 「Claude：思考中…」——動手的是沒在用那份設定的那一個）。
  assert.equal(
    resolveEngine(merge, { tools: "claude,codex", step: "codex-config" }),
    "codex",
  );
  assert.equal(
    resolveEngine(merge, { tools: "claude,codex", step: "codex-agents" }),
    "codex",
  );
  assert.equal(
    resolveEngine(merge, { tools: "claude,codex", step: "claude-md" }),
    "claude",
  );
  // 那一家沒被選到就退回工具選擇——機器上根本沒有那支 CLI。
  assert.equal(resolveEngine(merge, { tools: "claude", step: "codex-config" }), "claude");
  assert.equal(resolveEngine(merge, { tools: "codex", step: "claude-md" }), "codex");
  // tools 是這顆 action 宣告的選項之一，沒宣告的話伺服器會把前端送的值丟掉，
  // engine 永遠拿到 undefined 而退回 claude——形同沒改。
  assert(merge.options.tools.includes("codex"));
  // 固定字串的 engine 照舊，不要為了新形狀把舊的那幾顆一起改掉。
  assert.equal(resolveEngine(actions["codex-hello"]), "codex");
  assert.equal(resolveEngine(actions["claude-hello"], { tools: "codex" }), "claude");
  ok("合併用那份設定自己家的 agent，沒選到才退回工具選擇");

  // ⚠️ 畫面上那顆合併按鈕走的是「開一個真的終端視窗」那條，不是背景那條。
  //
  // 真機（Windows）撞出來的：Codex 的沙箱第一次用會跳系統授權框，那個框跳在嚮導
  // 視窗後面，學生順手關掉——嚮導只拿到 ShellExecuteExW failed: 1223（使用者取消），
  // 畫面上是一張沒頭沒尾的紅卡。agent 中途要批准寫入時也一樣，背景那條沒有人可以
  // 回答，一次失敗的合併跑了 7 分鐘、53 萬 tokens。
  const terminalMerge = actions["merge-in-terminal"];
  assert.equal(terminalMerge.kind, "fixed", "開視窗那條不是 agent 動作");
  assert.deepEqual(
    terminalMerge.buildArgs({
      step: "codex-agents",
      lang: "zh-TW",
      tools: "claude,codex",
    }).slice(1),
    ["--step=codex-agents", "--lang=zh-TW", "--tools=claude,codex"],
  );
  // 三個都要宣告成選項：沒宣告的伺服器會丟掉，腳本就挑錯 agent、挑錯語言。
  for (const key of ["step", "lang", "tools"]) {
    assert(terminalMerge.options[key] !== undefined, `${key} 要宣告成選項`);
  }
  ok("合併走開終端那條，三個參數都傳得進去");

  // 背景那條刻意留著（無人值守的批次安裝要它），但不能再是畫面上用的那一顆。
  assert(actions["merge-config-step"] !== undefined, "背景那條不要刪");
  ok("背景合併留著當批次安裝的路，但畫面上不用它");

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
