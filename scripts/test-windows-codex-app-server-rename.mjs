#!/usr/bin/env node

const serverUrl =
  process.env.CODEX_APP_SERVER_URL ?? "ws://127.0.0.1:4500";
const requestedThreadId = process.env.CODEX_THREAD_ID ?? "";
const requestedName = process.env.CODEX_THREAD_NAME ?? "";
const timeoutMs = 5_000;

if (typeof WebSocket !== "function") {
  console.error(
    "這支測試需要內建 WebSocket 的 Node.js 22 或更新版本。請先執行 node --version。",
  );
  process.exit(2);
}

function decodeMessage(data) {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString(
      "utf8",
    );
  }
  return String(data);
}

function waitForOpen(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`連線 ${serverUrl} 逾時`));
    }, timeoutMs);

    socket.addEventListener(
      "open",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        reject(new Error(`無法連到 ${serverUrl}`));
      },
      { once: true },
    );
  });
}

function createRpcClient(socket) {
  let nextId = 1;
  const pending = new Map();

  const rejectPending = (reason) => {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(reason);
    }
    pending.clear();
  };

  socket.addEventListener("message", ({ data }) => {
    let message;
    try {
      message = JSON.parse(decodeMessage(data));
    } catch {
      return;
    }

    if (message.id === undefined || !pending.has(message.id)) return;

    const waiter = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(waiter.timer);

    if (message.error) {
      waiter.reject(new Error(JSON.stringify(message.error)));
    } else {
      waiter.resolve(message.result);
    }
  });

  socket.addEventListener("close", () => {
    rejectPending(new Error("app-server 在完成測試前關閉連線"));
  });

  return {
    call(method, params = {}) {
      const id = nextId;
      nextId += 1;

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method} 等待回應逾時`));
        }, timeoutMs);

        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ method, id, params }));
      });
    },
    notify(method, params = {}) {
      socket.send(JSON.stringify({ method, params }));
    },
  };
}

function chooseThread(threads) {
  if (requestedThreadId) {
    const requested = threads.find(({ id }) => id === requestedThreadId);
    if (!requested) {
      throw new Error(
        `thread/list 找不到 CODEX_THREAD_ID=${requestedThreadId}`,
      );
    }
    return requested;
  }

  const loaded = threads.find(
    ({ status }) => status?.type && status.type !== "notLoaded",
  );
  if (!loaded) {
    throw new Error(
      "找不到已載入的 Codex thread；請先在 remote TUI 送出一則訊息",
    );
  }
  return loaded;
}

const socket = new WebSocket(serverUrl);

try {
  await waitForOpen(socket);
  const rpc = createRpcClient(socket);

  await rpc.call("initialize", {
    clientInfo: {
      name: "jr_setup_windows_probe",
      title: "jr-setup Windows rename probe",
      version: "0.1.0",
    },
  });
  rpc.notify("initialized");

  const list = await rpc.call("thread/list", {
    limit: 10,
    sortKey: "updated_at",
    sortDirection: "desc",
    sourceKinds: ["cli"],
  });
  const current = chooseThread(list.data ?? []);
  const newName =
    requestedName ||
    `Windows watcher-free rename ${new Date()
      .toISOString()
      .slice(11, 19)
      .replaceAll(":", "")}`;

  await rpc.call("thread/name/set", {
    threadId: current.id,
    name: newName,
  });

  const verified = await rpc.call("thread/read", {
    threadId: current.id,
    includeTurns: false,
  });

  if (verified.thread?.name !== newName) {
    throw new Error(
      `名稱驗證失敗：預期 ${newName}，實際 ${verified.thread?.name ?? "<空白>"}`,
    );
  }

  console.log("PASS");
  console.log(`threadId: ${current.id}`);
  console.log(`preview: ${current.preview ?? ""}`);
  console.log(`oldName: ${current.name ?? ""}`);
  console.log(`newName: ${verified.thread.name}`);
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (socket.readyState === WebSocket.OPEN) socket.close();
}
