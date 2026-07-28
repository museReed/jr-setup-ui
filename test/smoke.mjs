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

async function postInput(baseUrl, token, body) {
  return fetch(`${baseUrl}/input?t=${encodeURIComponent(token)}`, {
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
    "launch-window-test": {
      kind: "fixed",
      label: "開視窗測試",
      cmd: process.execPath,
      args: ["--version"],
      launchesWindow: true,
    },
    "input-echo-test": {
      kind: "fixed",
      label: "stdin 測試",
      cmd: process.execPath,
      args: [
        "-e",
        "process.stdout.write('ready\\n'); process.stdin.setEncoding('utf8'); process.stdin.once('data', (data) => process.stdout.write(data, () => process.exit(0)));",
      ],
      acceptsInput: true,
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
  ok("首頁包含安裝按鈕");

  assert(page.includes("狀態已更新"));
  ok("首頁包含動作完成後自動更新狀態的提示");

  assert(page.includes("完成後這裡會自動更新"));
  assert(page.includes("停止等待"));
  ok("首頁包含登入自動更新與停止等待提示");

  assert.match(page, /id="login-hints"/);
  assert.match(page, /target="_blank"/);
  assert.match(page, /rel="noopener noreferrer"/);
  assert.match(page, /id="run-input"/);
  // 那格原本只有 aria-label，同學看到的是一個空白框，不知道要貼什麼。
  assert(page.includes("把授權代碼貼在這裡"));
  assert(!page.includes("終端機視窗"));
  ok("首頁包含登入提示與輸入列且移除終端機視窗文案");

  assert(!page.includes("關掉嚮導"));
  assert(!page.includes("按「重新檢查」更新狀態"));
  ok("首頁不再包含手動更新與重開嚮導的舊提示");

  // 迴歸：開視窗的 action 不能接管線——新視窗會一直握著，close 事件永遠不來，
  // 前端會永遠卡在「登入中…」而且所有按鈕鎖死（實測登入按鈕就是這樣）。
  const windowRunId = await createRun(baseUrl, token, "launch-window-test");
  const windowEvents = await readSse(baseUrl, token, windowRunId);
  assert.equal(
    windowEvents.find(({ event }) => event === "done")?.data.exitCode,
    0,
  );
  ok("開視窗的 action 立刻回 done，不等視窗關閉");

  const unauthorized = await fetch(`${baseUrl}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "hello" }),
  });
  assert.equal(unauthorized.status, 401);
  ok("缺少 token 的 POST /run 回傳 401");

  const unauthorizedInput = await fetch(`${baseUrl}/input`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId: "missing", text: "hello" }),
  });
  assert.equal(unauthorizedInput.status, 401);
  ok("缺少 token 的 POST /input 回傳 401");

  const missingInputRun = await postInput(baseUrl, token, {
    runId: "missing",
    text: "hello",
  });
  assert.equal(missingInputRun.status, 400);
  ok("POST /input 的 runId 不存在時回傳 400");

  const helloRunResponse = await postRun(baseUrl, token, { action: "hello" });
  assert.equal(helloRunResponse.status, 200);
  const helloRun = await helloRunResponse.json();
  assert.equal(helloRun.acceptsInput, false);
  ok("POST /run 回應包含 acceptsInput");

  const rejectedHelloInput = await postInput(baseUrl, token, {
    runId: helloRun.runId,
    text: "hello",
  });
  assert.equal(rejectedHelloInput.status, 400);
  ok("不接受輸入的 action 收到 POST /input 時回傳 400");

  const helloRunId = helloRun.runId;
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

  const inputRunResponse = await postRun(baseUrl, token, {
    action: "input-echo-test",
  });
  assert.equal(inputRunResponse.status, 200);
  const inputRun = await inputRunResponse.json();
  assert.equal(inputRun.acceptsInput, true);

  const invalidInputText = await postInput(baseUrl, token, {
    runId: inputRun.runId,
    text: 123,
  });
  assert.equal(invalidInputText.status, 400);
  ok("POST /input 拒絕非字串 text");

  const longInput = await postInput(baseUrl, token, {
    runId: inputRun.runId,
    text: "x".repeat(501),
  });
  assert.equal(longInput.status, 400);
  ok("POST /input 拒絕超過 500 字元的文字");

  const inputBeforeSpawn = await postInput(baseUrl, token, {
    runId: inputRun.runId,
    text: "too early",
  });
  assert.equal(inputBeforeSpawn.status, 400);
  ok("POST /input 在子程序尚未啟動時回傳 400");

  const inputText = "raw; $HOME && echo untouched";
  let inputResponseStatus = null;
  const inputEvents = await readSse(
    baseUrl,
    token,
    inputRun.runId,
    async ({ event, data }) => {
      if (event === "line" && data.text === "ready") {
        const inputResponse = await postInput(baseUrl, token, {
          runId: inputRun.runId,
          text: inputText,
        });
        inputResponseStatus = inputResponse.status;
      }
    },
  );
  assert.equal(inputResponseStatus, 200);
  assert(
    inputEvents.some(
      ({ event, data }) => event === "line" && data.text === inputText,
    ),
  );
  ok("POST /input 將文字原樣寫入子程序 stdin");

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
