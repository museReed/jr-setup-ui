import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import http from "node:http";

import { parseClaudeLine, parseCodexLine } from "./agent-events.js";
import { actions, buildAgentCommand } from "./actions.js";
import { isBenignExit } from "./installers.js";
import { runEnvCheck } from "./env-check.js";
import { ensureWorkDir } from "./paths.js";
import { resolveSpawn } from "./spawn-command.js";

const indexPath = new URL("../public/index.html", import.meta.url);

function tokenMatches(actual, expected) {
  if (actual === null) {
    return false;
  }

  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function sendText(response, statusCode, text) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
  });
  response.end(text);
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  let body = "";

  for await (const chunk of request) {
    body += chunk;
  }

  return JSON.parse(body);
}

function writeEvent(response, event, data) {
  if (response.destroyed || response.writableEnded) {
    return;
  }

  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function streamLines(readable, onLine) {
  let buffered = "";
  readable.setEncoding("utf8");

  readable.on("data", (chunk) => {
    buffered += chunk;
    const lines = buffered.split("\n");
    buffered = lines.pop();

    for (const line of lines) {
      onLine(line.endsWith("\r") ? line.slice(0, -1) : line);
    }
  });

  return () => {
    if (buffered.length > 0) {
      onLine(buffered);
      buffered = "";
    }
  };
}

function childIsRunning(child) {
  return child && child.exitCode === null && child.signalCode === null;
}

function terminateRun(run) {
  if (run.finished || !childIsRunning(run.child)) {
    return;
  }

  run.child.kill("SIGTERM");

  if (run.killTimer === null) {
    run.killTimer = setTimeout(() => {
      if (childIsRunning(run.child)) {
        run.child.kill("SIGKILL");
      }
    }, 3000);
    run.killTimer.unref();
  }
}

function runAction(
  run,
  runId,
  runs,
  response,
  commandBuilder,
) {
  response.writeHead(200, {
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream; charset=utf-8",
  });
  response.flushHeaders();

  const { action } = run;
  const command =
    action.kind === "agent"
      ? commandBuilder(action.engine, run.prompt, run.permission)
      : { cmd: action.cmd, args: action.args };
  // stdin 一律關掉：這裡沒有人會餵輸入，留著一根開著的管線會讓
  // 讀 stdin 的 CLI 空等（claude 等 3 秒才放行，codex 直接卡住不動）。
  const baseOptions = { shell: false, stdio: ["ignore", "pipe", "pipe"] };
  const spawnOptions =
    action.kind === "agent"
      ? { ...baseOptions, cwd: ensureWorkDir() }
      : baseOptions;
  const parser =
    action.engine === "claude" ? parseClaudeLine : parseCodexLine;
  // Windows 的 .cmd 包裝檔不能直接 spawn（Node 會丟 EINVAL），要繞 cmd.exe。
  const spawnable = resolveSpawn(command.cmd, command.args);
  let child;

  try {
    child = spawn(spawnable.cmd, spawnable.args, spawnOptions);
  } catch (error) {
    writeEvent(response, "agent", {
      kind: "error",
      text: `無法啟動 ${command.cmd}：${error.message}`,
    });
    writeEvent(response, "done", { exitCode: null, signal: null });
    runs.delete(runId);
    response.end();
    return;
  }

  run.child = child;

  const flushStdout = streamLines(child.stdout, (line) => {
    if (action.kind === "fixed") {
      writeEvent(response, "line", { stream: "stdout", text: line });
      return;
    }

    const event = parser(line);

    if (event !== null) {
      writeEvent(response, "agent", event);
    }
  });
  const flushStderr = streamLines(child.stderr, (line) => {
    writeEvent(response, "line", { stream: "stderr", text: line });
  });

  const finish = (exitCode, signal) => {
    if (run.finished) {
      return;
    }

    run.finished = true;
    if (run.killTimer !== null) {
      clearTimeout(run.killTimer);
      run.killTimer = null;
    }
    flushStdout();
    flushStderr();
    runs.delete(runId);
    writeEvent(response, "done", {
      exitCode,
      signal,
      benign: isBenignExit(command.cmd, exitCode),
    });
    response.end();
  };

  child.once("error", (error) => {
    const text =
      error.code === "ENOENT"
        ? `找不到 ${command.cmd} 指令，請先安裝並確認它在 PATH 裡`
        : error.message;
    writeEvent(response, "agent", { kind: "error", text });
    finish(null, null);
  });
  child.once("close", finish);
  response.on("close", () => terminateRun(run));
}

export async function startServer({
  port,
  token,
  actionTable = actions,
  commandBuilder = buildAgentCommand,
}) {
  const indexHtml = await readFile(indexPath, "utf8");
  const runs = new Map();

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");

    if (!tokenMatches(url.searchParams.get("t"), token)) {
      sendText(response, 401, "Token 不正確或缺少");
      return;
    }

    if (request.method === "GET" && url.pathname === "/") {
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
      });
      response.end(indexHtml);
      return;
    }

    if (request.method === "GET" && url.pathname === "/env") {
      response.setHeader("Cache-Control", "no-store");
      sendJson(response, 200, await runEnvCheck());
      return;
    }

    if (request.method === "POST" && url.pathname === "/run") {
      let body;

      try {
        body = await readJson(request);
      } catch {
        sendText(response, 400, "JSON 格式不正確");
        return;
      }

      const actionName =
        body !== null && typeof body === "object" ? body.action : undefined;

      if (!Object.hasOwn(actionTable, actionName)) {
        sendText(response, 400, "Action 不在白名單");
        return;
      }

      const action = actionTable[actionName];
      const hasPrompt = Object.hasOwn(body, "prompt");
      const hasAllowWrite = Object.hasOwn(body, "allowWrite");

      if (hasAllowWrite && typeof body.allowWrite !== "boolean") {
        sendText(response, 400, "allowWrite 必須是 boolean");
        return;
      }

      if (body.allowWrite === true && !action.allowsWriteToggle) {
        sendText(response, 400, "這個 Action 不允許寫檔");
        return;
      }

      if (!action.acceptsPrompt && hasPrompt) {
        sendText(response, 400, "這個 Action 不接受 prompt");
        return;
      }

      if (
        action.acceptsPrompt &&
        (!hasPrompt ||
          typeof body.prompt !== "string" ||
          body.prompt.trim().length === 0)
      ) {
        sendText(response, 400, "prompt 必須是非空白字串");
        return;
      }

      if (action.acceptsPrompt && body.prompt.length > 4000) {
        sendText(response, 400, "prompt 不可超過 4000 字元");
        return;
      }

      const runId = randomBytes(16).toString("hex");
      runs.set(runId, {
        action,
        child: null,
        finished: false,
        killTimer: null,
        permission: body.allowWrite === true ? "write" : action.permission,
        prompt: action.acceptsPrompt ? body.prompt : action.prompt,
        used: false,
      });
      sendJson(response, 200, { runId });
      return;
    }

    if (request.method === "POST" && url.pathname === "/cancel") {
      let body;

      try {
        body = await readJson(request);
      } catch {
        sendText(response, 400, "JSON 格式不正確");
        return;
      }

      const runId =
        body !== null && typeof body === "object" ? body.runId : undefined;
      const run = runs.get(runId);

      if (!run) {
        sendText(response, 404, "Run 不存在");
        return;
      }

      terminateRun(run);
      sendJson(response, 200, { canceled: true });
      return;
    }

    if (request.method === "GET" && url.pathname === "/stream") {
      const runId = url.searchParams.get("runId");
      const run = runs.get(runId);

      if (!run || run.used) {
        sendText(response, 404, "Run 不存在或已使用");
        return;
      }

      run.used = true;
      runAction(
        run,
        runId,
        runs,
        response,
        commandBuilder,
      );
      return;
    }

    sendText(response, 404, "找不到路由");
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });

  const actualPort = server.address().port;
  const close = () =>
    new Promise((resolve, reject) => {
      for (const run of runs.values()) {
        terminateRun(run);
      }

      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });

  return { server, port: actualPort, close };
}
