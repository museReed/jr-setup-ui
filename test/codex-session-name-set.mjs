import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

function ok(description) {
  console.log(`ok - ${description}`);
}

function runPython(helper, args, env = {}, timeoutMs = 3_000) {
  return new Promise((resolve) => {
    const child = spawn("python3", [helper, ...args], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stderr, timedOut });
    });
  });
}

function websocketFrame(value) {
  const payload = Buffer.from(JSON.stringify(value));
  assert(payload.length < 126);
  return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
}

function readClientFrame(buffer) {
  if (buffer.length < 2) return null;
  let offset = 2;
  let length = buffer[1] & 0x7f;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  }
  assert.notEqual(length, 127, "測試訊息不該大到需要 64-bit frame length");
  const masked = (buffer[1] & 0x80) !== 0;
  assert.equal(masked, true, "WebSocket client frame 必須 mask");
  if (buffer.length < offset + 4 + length) return null;
  const mask = buffer.subarray(offset, offset + 4);
  offset += 4;
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  for (let index = 0; index < payload.length; index += 1) {
    payload[index] ^= mask[index % 4];
  }
  return {
    value: JSON.parse(payload.toString("utf8")),
    rest: buffer.subarray(offset + length),
  };
}

let appServerCase = 0;

async function runAppServerCase({ dir, responses, threadId = "thread-55" }) {
  appServerCase += 1;
  const socketPath = path.join(dir, `case-${appServerCase}.sock`);
  const messages = [];
  const server = createServer((socket) => {
    let buffer = Buffer.alloc(0);
    let upgraded = false;
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!upgraded) {
        const end = buffer.indexOf("\r\n\r\n");
        if (end === -1) return;
        const headers = buffer.subarray(0, end).toString("utf8");
        const key = headers.match(/^Sec-WebSocket-Key: (.+)$/im)?.[1].trim();
        assert(key);
        const accept = createHash("sha1")
          .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
          .digest("base64");
        socket.write(
          "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
        );
        buffer = buffer.subarray(end + 4);
        upgraded = true;
      }

      while (true) {
        const frame = readClientFrame(buffer);
        if (frame === null) return;
        buffer = frame.rest;
        messages.push(frame.value);
        if (frame.value.id === 1) {
          socket.write(websocketFrame(responses.initialize));
        } else if (frame.value.id === 2) {
          socket.write(websocketFrame(responses.rename));
        }
      }
    });
  });
  await new Promise((resolve) => server.listen(socketPath, resolve));
  const result = await runPython(HELPER, [threadId, "修正原生命名"], {
    CODEX_APP_SERVER_SOCKET: socketPath,
  });
  await new Promise((resolve) => server.close(resolve));
  return { messages, result };
}

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const HELPER = path.join(
  REPO_ROOT,
  "materials",
  "skills",
  "hooks",
  "codex-session-name-set.py",
);

try {
  assert.equal(existsSync(HELPER), true, "POSIX app-server helper 必須存在");

  const invalid = await runPython(HELPER, []);
  assert.equal(invalid.status, 2);
  ok("helper 參數錯誤時 exit 2");

  const unavailable = await runPython(HELPER, ["thread-a", "測試名稱"], {
    CODEX_APP_SERVER_SOCKET: path.join(tmpdir(), "missing-codex-app-server.sock"),
  });
  assert.equal(unavailable.status, 1);
  ok("helper 連不到 app-server 時 exit 1");

  const dir = mkdtempSync(path.join(tmpdir(), "jr-codex-app-server-"));
  const eofSocketPath = path.join(dir, "premature-eof.sock");
  const eofServer = createServer((socket) => socket.destroy());
  await new Promise((resolve) => eofServer.listen(eofSocketPath, resolve));
  const prematureEof = await runPython(
    HELPER,
    ["thread-eof", "不該卡住"],
    { CODEX_APP_SERVER_SOCKET: eofSocketPath },
    750,
  );
  eofServer.close();
  assert.equal(prematureEof.timedOut, false);
  assert.equal(prematureEof.status, 1);
  ok("WebSocket handshake 提前 EOF 時立即 exit 1，不等 socket timeout");

  const { messages, result } = await runAppServerCase({
    dir,
    responses: {
      initialize: { id: 1, result: {} },
      rename: { id: 2, result: {} },
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    messages.map(({ method }) => method),
    ["initialize", "initialized", "thread/name/set"],
  );
  assert.deepEqual(messages[2].params, {
    threadId: "thread-55",
    name: "修正原生命名",
  });
  ok("helper 依序 initialize、initialized、thread/name/set 並成功 exit 0");

  const missingResult = await runAppServerCase({
    dir,
    responses: {
      initialize: { id: 1, result: {} },
      rename: { id: 2 },
    },
  });
  assert.equal(missingResult.result.status, 1);
  ok("matching id 缺少 result 時 exit 1");

  const appServerError = await runAppServerCase({
    dir,
    responses: {
      initialize: { id: 1, result: {} },
      rename: { id: 2, error: { code: -1, message: "rename failed" } },
    },
  });
  assert.equal(appServerError.result.status, 1);
  ok("matching id 回傳 error 時 exit 1");

  const malformed = await runAppServerCase({
    dir,
    responses: {
      initialize: [],
      rename: { id: 2, result: {} },
    },
  });
  assert.equal(malformed.result.status, 1);
  ok("matching response 不是 object 時 exit 1");
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
