#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

import { startServer } from "../src/server.js";

function parseArgs(args) {
  let port = 0;
  let shouldOpen = true;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--no-open") {
      shouldOpen = false;
      continue;
    }

    if (arg === "--port") {
      const value = args[index + 1];
      const parsedPort = Number(value);

      if (
        value === undefined ||
        !Number.isInteger(parsedPort) ||
        parsedPort < 0 ||
        parsedPort > 65535
      ) {
        throw new Error("--port 必須是 0 到 65535 的整數");
      }

      port = parsedPort;
      index += 1;
      continue;
    }

    throw new Error(`不支援的參數：${arg}`);
  }

  return { port, shouldOpen };
}

async function main() {
  const { port, shouldOpen } = parseArgs(process.argv.slice(2));
  const token = randomBytes(24).toString("hex");
  const started = await startServer({ port, token });
  const url = `http://127.0.0.1:${started.port}/?t=${token}`;

  console.log(url);

  if (!shouldOpen) {
    return;
  }

  if (process.platform === "darwin") {
    const opener = spawn("open", [url], {
      detached: true,
      shell: false,
      stdio: "ignore",
    });
    opener.unref();
  } else {
    console.log("請手動打開上面的網址");
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
