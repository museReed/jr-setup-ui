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
  // 共通九列（含 Python 3——demo 那段的 self_play.py 要它，Windows 上沒有內建）。
  // 其餘依平台而定：macOS 多一列 Ghostty，Windows 多執行原則與三列 PowerShell。
  const expectedChecks =
    9 + (process.platform === "darwin" ? 1 : 0) +
    (process.platform === "win32" ? 4 : 0);
  assert.equal(env.checks.length, expectedChecks);
  ok(`正確 token 的 GET /env 回傳 os 與 ${expectedChecks} 筆 checks`);

  assert(
    env.checks.every((check) => Object.hasOwn(check, "installAction")),
  );
  ok("GET /env 的每筆 check 都包含 installAction");

  assert(env.checks.every((check) => Object.hasOwn(check, "fixAction")));
  ok("GET /env 的每筆 check 都包含 fixAction");

  const configsResponse = await fetch(
    `${baseUrl}/configs?tools=claude&lang=zh-TW&t=${encodeURIComponent(token)}`,
  );
  assert.equal(configsResponse.status, 200);
  const configs = await configsResponse.json();
  assert.deepEqual(configs.tools, ["claude"]);
  assert(configs.checks.length > 0);
  ok("GET /configs 回傳所選工具的規則檔 checks");

  const invalidConfigsResponse = await fetch(
    `${baseUrl}/configs?tools=claude&lang=ja&t=${encodeURIComponent(token)}`,
  );
  assert.equal(invalidConfigsResponse.status, 400);
  ok("GET /configs 拒絕不合法的 lang");

  // 重驗之前的「先忘掉上一輪」。走的是同一個 /state，多帶一個 clear。
  const stateUrl = `${baseUrl}/state?t=${encodeURIComponent(token)}`;
  const post = (body) =>
    fetch(stateUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  // 這支測試跑的是真的伺服器，寫的是真的 state.json——所以用一個永遠不會存在的
  // step id，只驗路由與回應，別動到跑這支測試的人自己的進度。刪除本身由
  // test/progress-state.mjs 在暫存目錄裡驗。
  const probe = "smoke-clear-probe";
  const cleared = await post({ step: probe, clear: true });
  assert.equal(cleared.status, 200);
  assert.deepEqual(await cleared.json(), {
    step: probe,
    kind: "verified",
    verified: false,
  });
  const clearedBehavior = await post({
    step: probe,
    kind: "behavior",
    clear: true,
  });
  assert.equal(clearedBehavior.status, 200);
  assert.equal((await clearedBehavior.json()).verified, false);
  ok("POST /state 的 clear 走得通，回報 verified: false");

  const badKind = await post({ step: probe, kind: "nope", clear: true });
  assert.equal(badKind.status, 400);
  ok("POST /state 的 clear 仍然只認 verified 與 behavior");

  const pageResponse = await fetch(
    `${baseUrl}/?t=${encodeURIComponent(token)}`,
  );
  assert.equal(pageResponse.status, 200);
  const page = await pageResponse.text();
  assert.match(page, /id="env-results"/);
  assert.match(page, /id="config-results"/);
  assert.match(page, /重新檢查/);
  ok("首頁包含環境檢查、規則檔安裝結果區與重新檢查按鈕");

  // 驗證按鈕已經收進各列（見 docs/wizard-verification-design.md），上方只留重新
  // 檢查。留著舊按鈕的話會有兩條路徑做同一件事，而且列上那條才知道自己是哪一列。
  for (const id of [
    "verify-configs",
    "verify-behavior",
    "verify-hook-live",
    "verify-naming",
  ]) {
    assert.doesNotMatch(
      page,
      new RegExp(`id="${id}"`),
      `${id} 應該收進對應的列，不該留在上方`,
    );
  }
  ok("上方沒有全域驗證按鈕，驗證都在各列上");

  assert.match(page, /<div\s+id="behavior-fallback"[^>]*\shidden(?:\s|>)/);
  ok("首頁包含預設隱藏的行為驗證手動退路");

  assert.doesNotMatch(page, /id="login-hints"/);
  assert(!page.includes("終端機視窗"));
  ok("登入提示已從右欄終端移除");

  // 前端拆成 View / ViewModel / Model 之後，首頁只剩標記。
  assert(!page.includes("<style>"));
  assert(!page.includes("document.querySelector"));
  assert.match(page, /<link rel="stylesheet" href="\/styles\.css" \/>/);
  assert.match(page, /<script type="module" src="\/app\.js"><\/script>/);
  ok("首頁不再內嵌樣式與腳本，改成外部檔案");

  // <link> 與 import 都由瀏覽器自己發請求，帶不了 token，所以靜態檔不驗 token。
  for (const [pathname, expectedType] of [
    ["/styles.css", /^text\/css/],
    ["/app.js", /^text\/javascript/],
    ["/view.js", /^text\/javascript/],
    ["/viewmodel.js", /^text\/javascript/],
    ["/api.js", /^text\/javascript/],
    // 導覽自己的兩支，加上 vendor 的 driver。少送任何一支，app.js 的 import
    // 會整串失敗——不是導覽不見，是整頁都不動了。
    ["/tour.js", /^text\/javascript/],
    ["/tour-model.js", /^text\/javascript/],
    ["/vendor/driver.mjs", /^text\/javascript/],
    ["/vendor/driver.css", /^text\/css/],
  ]) {
    const assetResponse = await fetch(`${baseUrl}${pathname}`);
    assert.equal(assetResponse.status, 200, pathname);
    assert.match(assetResponse.headers.get("content-type"), expectedType);
    assert((await assetResponse.text()).length > 0, pathname);
  }
  ok("樣式與前端模組不帶 token 也取得到");

  const viewSource = await (await fetch(`${baseUrl}/view.js`)).text();
  assert(viewSource.includes('hints.id = "login-hints"'));
  assert(viewSource.includes('link.target = "_blank"'));
  assert(viewSource.includes('link.rel = "noopener noreferrer"'));
  assert(viewSource.includes('form.id = "run-input"'));
  assert(viewSource.includes("把授權代碼貼在這裡"));
  assert(viewSource.includes("完成後這裡會自動更新"));
  assert(viewSource.includes("停止等待"));
  ok("View 在卡片內建立登入提示、輸入列與等待狀態");

  const viewModelSource = await (await fetch(`${baseUrl}/viewmodel.js`)).text();
  assert(viewModelSource.includes("狀態已更新"));
  assert(viewModelSource.includes("configRowModel"));
  assert(viewModelSource.includes("behaviorFallbackState"));
  assert(!viewModelSource.includes("document."));
  ok("ViewModel 含規則檔與行為驗證模型且完全不碰 DOM");

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
