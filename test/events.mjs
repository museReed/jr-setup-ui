import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import { startServer } from "../src/server.js";
import { parseJrEventLine } from "../src/sse.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

assert.deepEqual(
  parseJrEventLine('@@JR {"kind":"stage","stage":"asking"}'),
  { kind: "stage", stage: "asking" },
);
assert.equal(parseJrEventLine("@@JR not-json"), null);
assert.equal(parseJrEventLine("一般輸出"), null);
ok("@@JR JSON 行會解析成事件，其他行不會");

const token = randomBytes(24).toString("hex");
const started = await startServer({
  port: 0,
  token,
  actionTable: {
    "event-test": {
      kind: "fixed",
      cmd: process.execPath,
      args: [
        "-e",
        [
          "console.log('@@JR {\"kind\":\"stage\",\"stage\":\"asking\"}')",
          "console.log('@@JR not-json')",
          "console.log('一般輸出')",
        ].join(";"),
      ],
    },
    "install-event-test": {
      kind: "fixed",
      cmd: process.execPath,
      args: ["-e", "console.error('npm ERR! code EACCES'); process.exit(1)"],
    },
  },
});

try {
  const baseUrl = `http://127.0.0.1:${started.port}`;
  const runResponse = await fetch(
    `${baseUrl}/run?t=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "event-test" }),
    },
  );
  assert.equal(runResponse.status, 200);
  const { runId } = await runResponse.json();
  const streamResponse = await fetch(
    `${baseUrl}/stream?runId=${encodeURIComponent(runId)}` +
      `&t=${encodeURIComponent(token)}`,
  );
  assert.equal(streamResponse.status, 200);
  const stream = await streamResponse.text();

  assert.match(
    stream,
    /event: jr\ndata: \{"kind":"stage","stage":"asking"\}/,
  );
  assert.match(
    stream,
    /event: line\ndata: \{"stream":"stdout","text":"@@JR not-json"\}/,
  );
  assert.match(
    stream,
    /event: line\ndata: \{"stream":"stdout","text":"一般輸出"\}/,
  );
  ok("server 把合法事件送 jr，認不得的行維持 line 原樣");

  const originalPath = process.env.PATH;

  try {
    process.env.PATH = "";
    const failedRunResponse = await fetch(
      `${baseUrl}/run?t=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "install-event-test" }),
      },
    );
    assert.equal(failedRunResponse.status, 200);
    const failedRun = await failedRunResponse.json();
    const failedStreamResponse = await fetch(
      `${baseUrl}/stream?runId=${encodeURIComponent(failedRun.runId)}` +
        `&t=${encodeURIComponent(token)}`,
    );
    assert.equal(failedStreamResponse.status, 200);
    const failedStream = await failedStreamResponse.text();
    const doneIndex = failedStream.indexOf("event: done");
    const explainStartIndex = failedStream.indexOf(
      'event: explain\ndata: {"kind":"start"}',
    );
    const explainResultIndex = failedStream.indexOf(
      'event: explain\ndata: {"kind":"result"',
    );

    assert(doneIndex >= 0, "失敗執行應該送出 done");
    assert(explainStartIndex >= 0, "第三方失敗應該送出翻譯開始");
    assert(explainResultIndex >= 0, "第三方失敗應該送出翻譯結果");
    assert(doneIndex < explainStartIndex, "done 必須早於翻譯開始");
    assert(explainStartIndex < explainResultIndex, "翻譯開始必須早於結果");
    ok("第三方失敗先送 done，再送 explain result");
  } finally {
    process.env.PATH = originalPath;
  }
} finally {
  await started.close();
}
