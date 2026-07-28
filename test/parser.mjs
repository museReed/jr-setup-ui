import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

import { parseClaudeLine, parseCodexLine } from "../src/agent-events.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

async function parseFixture(name, parser) {
  const lines = createInterface({
    input: createReadStream(new URL(`fixtures/${name}`, import.meta.url)),
    crlfDelay: Infinity,
  });
  const events = [];

  for await (const line of lines) {
    const event = parser(line);

    if (event !== null) {
      events.push(event);
    }
  }

  return events;
}

const claudeEvents = await parseFixture(
  "claude-stream.jsonl",
  parseClaudeLine,
);
assert.equal(
  claudeEvents
    .filter(({ kind }) => kind === "text")
    .map(({ text }) => text)
    .join(""),
  "OK",
);
ok("Claude fixture 的文字事件串接後等於 OK");

assert(claudeEvents.some(({ kind }) => kind === "status"));
ok("Claude fixture 至少產生一個 status 事件");

assert.equal(
  claudeEvents.at(-1).text,
  "本次消耗：$0.5026（輸入 2、快取寫入 49,487、快取讀取 15,288、輸出 4 tokens）",
);
ok("Claude fixture 收尾回報金額與 token 用量");

const codexEvents = await parseFixture("codex-stream.jsonl", parseCodexLine);
assert(
  codexEvents.some(
    ({ kind, text }) => kind === "text" && text.includes("OK"),
  ),
);
ok("Codex fixture 的文字事件包含 OK");

assert(
  codexEvents.some(
    ({ kind, text }) =>
      kind === "tool" && text.startsWith("執行指令："),
  ),
);
ok("Codex fixture 產生以執行指令開頭的 tool 事件");

assert.equal(
  codexEvents.at(-1).text,
  "完成（輸入 55,462、快取讀取 26,368、輸出 234 tokens）",
);
ok("Codex fixture 收尾回報 token 用量");

assert.deepEqual(parseCodexLine('{"type":"turn.completed"}'), {
  kind: "status",
  text: "完成",
});
ok("Codex 缺少 usage 時只顯示完成");

for (const [name, parser] of [
  ["Claude", parseClaudeLine],
  ["Codex", parseCodexLine],
]) {
  assert.deepEqual(parser("這不是 JSON"), {
    kind: "status",
    text: "這不是 JSON",
  });
  ok(`${name} parser 將非 JSON 行轉成 status`);

  assert.doesNotThrow(() => parser("{}"));
  assert.doesNotThrow(() => parser('{"type":"stream_event"}'));
  ok(`${name} parser 遇到缺少欄位時不拋錯`);
}
