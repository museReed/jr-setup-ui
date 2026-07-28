import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import { actions, buildAgentCommand } from "../src/actions.js";
import { startServer } from "../src/server.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

async function postRun(baseUrl, token, body) {
  return fetch(`${baseUrl}/run?t=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createRun(baseUrl, token, action, prompt) {
  const body = { action };

  if (prompt !== undefined) {
    body.prompt = prompt;
  }

  const response = await postRun(baseUrl, token, body);

  assert.equal(response.status, 200);
  return (await response.json()).runId;
}

async function readSse(baseUrl, token, runId, onEvent) {
  const response = await fetch(
    `${baseUrl}/stream?runId=${encodeURIComponent(runId)}` +
      `&t=${encodeURIComponent(token)}`,
  );
  assert.equal(response.status, 200);

  const events = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";

  while (true) {
    const { done, value } = await reader.read();
    buffered += decoder.decode(value, { stream: !done });
    const blocks = buffered.split("\n\n");
    buffered = blocks.pop();

    for (const block of blocks) {
      const lines = block.split("\n");
      const event = lines.find((line) => line.startsWith("event: "));
      const data = lines.find((line) => line.startsWith("data: "));

      if (event && data) {
        const parsed = {
          event: event.slice("event: ".length),
          data: JSON.parse(data.slice("data: ".length)),
        };
        events.push(parsed);

        if (onEvent) {
          await onEvent(parsed);
        }
      }
    }

    if (done) {
      break;
    }
  }

  return events;
}

const token = randomBytes(24).toString("hex");
let started;
let streamedPermission = null;

try {
  const actionTable = {
    ...actions,
    "missing-agent": {
      kind: "agent",
      engine: "claude",
      prompt: "missing-command-test",
      permission: "read-only",
    },
  };
  started = await startServer({
    port: 0,
    token,
    actionTable,
    commandBuilder(engine, prompt, permission) {
      if (prompt === "permission-probe") {
        streamedPermission = permission;
        return {
          cmd: process.execPath,
          args: ["--version"],
        };
      }

      if (prompt === "missing-command-test") {
        return {
          cmd: "jr-setup-ui-command-that-does-not-exist",
          args: [prompt],
        };
      }

      return buildAgentCommand(engine, prompt, permission);
    },
  });
  const baseUrl = `http://127.0.0.1:${started.port}`;

  assert.equal(started.server.address().address, "127.0.0.1");
  ok("server 只監聽 127.0.0.1");

  const unauthorizedEnv = await fetch(`${baseUrl}/env`);
  assert.equal(unauthorizedEnv.status, 401);
  ok("缺少 token 的 GET /env 回傳 401");

  const envResponse = await fetch(
    `${baseUrl}/env?t=${encodeURIComponent(token)}`,
  );
  assert.equal(envResponse.status, 200);
  assert.equal(envResponse.headers.get("cache-control"), "no-store");
  assert.match(
    envResponse.headers.get("content-type"),
    /^application\/json; charset=utf-8$/,
  );
  const env = await envResponse.json();
  assert.equal(typeof env.os, "object");
  assert.equal(env.checks.length, 8);
  ok("正確 token 的 GET /env 回傳 os 與 8 筆 checks");

  assert(
    env.checks.every((check) => Object.hasOwn(check, "installAction")),
  );
  ok("GET /env 的每筆 check 都包含 installAction");

  assert(env.checks.every((check) => Object.hasOwn(check, "fixAction")));
  ok("GET /env 的每筆 check 都包含 fixAction");

  const pageResponse = await fetch(
    `${baseUrl}/?t=${encodeURIComponent(token)}`,
  );
  assert.equal(pageResponse.status, 200);
  const page = await pageResponse.text();
  assert.match(page, /id="env-results"/);
  assert.match(page, /重新檢查/);
  ok("首頁包含環境檢查結果區與重新檢查按鈕");

  assert.match(page, /安裝/);
  assert.match(page, /按「重新檢查」更新狀態/);
  ok("首頁包含安裝按鈕與重開嚮導提示");

  const unauthorized = await fetch(`${baseUrl}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "hello" }),
  });
  assert.equal(unauthorized.status, 401);
  ok("缺少 token 的 POST /run 回傳 401");

  const helloRunId = await createRun(baseUrl, token, "hello");
  const helloEvents = await readSse(baseUrl, token, helloRunId);
  assert(
    helloEvents.some(
      ({ event, data }) =>
        event === "line" && data.text.includes("hello from jr-setup-ui"),
    ),
  );
  assert.equal(
    helloEvents.find(({ event }) => event === "done")?.data.exitCode,
    0,
  );
  ok("hello 串流 stdout 並以 exit code 0 結束");

  const failRunId = await createRun(baseUrl, token, "fail-demo");
  const failEvents = await readSse(baseUrl, token, failRunId);
  assert(
    failEvents.some(
      ({ event, data }) => event === "line" && data.stream === "stderr",
    ),
  );
  assert.equal(
    failEvents.find(({ event }) => event === "done")?.data.exitCode,
    3,
  );
  ok("fail-demo 串流 stderr 並以 exit code 3 結束");

  const unknown = await fetch(
    `${baseUrl}/run?t=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rm-rf" }),
    },
  );
  assert.equal(unknown.status, 400);
  ok("不在白名單的 action 回傳 400");

  const missingPrompt = await postRun(baseUrl, token, {
    action: "claude-free",
  });
  assert.equal(missingPrompt.status, 400);
  ok("claude-free 缺少 prompt 回傳 400");

  const rejectedPrompt = await postRun(baseUrl, token, {
    action: "hello",
    prompt: "不該接受",
  });
  assert.equal(rejectedPrompt.status, 400);
  ok("fixed action 帶 prompt 回傳 400");

  const longPrompt = await postRun(baseUrl, token, {
    action: "claude-free",
    prompt: "x".repeat(4001),
  });
  assert.equal(longPrompt.status, 400);
  ok("超過 4000 字元的 prompt 回傳 400");

  const writeRun = await postRun(baseUrl, token, {
    action: "claude-free",
    prompt: "permission-probe",
    allowWrite: true,
  });
  assert.equal(writeRun.status, 200);
  const writeEvents = await readSse(
    baseUrl,
    token,
    (await writeRun.json()).runId,
  );
  assert.equal(
    writeEvents.find(({ event }) => event === "done")?.data.exitCode,
    0,
  );
  assert.equal(streamedPermission, "write");
  ok("claude-free 可提升並傳遞 write 權限");

  const helloWrite = await postRun(baseUrl, token, {
    action: "claude-hello",
    allowWrite: true,
  });
  assert.equal(helloWrite.status, 400);
  ok("claude-hello 帶 allowWrite 回傳 400");

  const fixedWrite = await postRun(baseUrl, token, {
    action: "hello",
    allowWrite: true,
  });
  assert.equal(fixedWrite.status, 400);
  ok("fixed action 帶 allowWrite 回傳 400");

  const invalidAllowWrite = await postRun(baseUrl, token, {
    action: "claude-free",
    prompt: "錯誤型別",
    allowWrite: "true",
  });
  assert.equal(invalidAllowWrite.status, 400);
  ok("allowWrite 不是 boolean 時回傳 400");

  const missingAgentRunId = await createRun(
    baseUrl,
    token,
    "missing-agent",
  );
  const missingAgentEvents = await readSse(
    baseUrl,
    token,
    missingAgentRunId,
  );
  assert(
    missingAgentEvents.some(
      ({ event, data }) =>
        event === "agent" &&
        data.kind === "error" &&
        data.text.includes("找不到"),
    ),
  );
  ok("agent 指令不存在時回傳人話 error 事件");

  const slowRunId = await createRun(baseUrl, token, "slow-count");
  let cancelSent = false;
  const slowEvents = await readSse(
    baseUrl,
    token,
    slowRunId,
    async ({ event }) => {
      if (event !== "line" || cancelSent) {
        return;
      }

      cancelSent = true;
      const canceled = await fetch(
        `${baseUrl}/cancel?t=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId: slowRunId }),
        },
      );
      assert.equal(canceled.status, 200);
    },
  );
  assert(cancelSent);
  assert(
    slowEvents.find(({ event }) => event === "done")?.data.signal,
  );
  ok("slow-count 可取消且 done 帶回 signal");
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exitCode = 1;
} finally {
  if (started) {
    await started.close();
  }
}
