import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

import { parseClaudeLine, parseCodexLine } from "./agent-events.js";
import {
  actions,
  buildAgentCommand,
  resolveEngine,
  shouldExplainOutput,
} from "./actions.js";
import { spawnEnv } from "./env-path.js";
import { isBenignExit } from "./installers.js";
import { runConfigCheck } from "./config-check.js";
import { LANGUAGES, TOOLS } from "./config-install.js";
import { runEnvCheck } from "./env-check.js";
import { isProgressNoise } from "./output-noise.js";
import {
  contentDir,
  ensureWorkDir,
  moduleFile,
  VERIFY_SHOT_AGENTS,
  verifyShotPath,
} from "./paths.js";
import {
  clearBehaviorVerified,
  clearStepVerified,
  loadBehaviorVerifiedSteps,
  loadChangedSteps,
  loadManualChecked,
  loadSelection,
  loadVerifiedSteps,
  markBehaviorVerified,
  markStepVerified,
  saveManualChecked,
  saveSelection,
} from "./progress-state.js";
import { resolveLaunch } from "./spawn-command.js";

const indexPath = new URL("../public/index.html", import.meta.url);
const explainOutputScript = moduleFile(
  "../scripts/explain-output.mjs",
  import.meta.url,
);
const JR_EVENT_PREFIX = "@@JR ";
const EXPLAIN_FALLBACK = "（無法翻譯，請看下方原始輸出）";

// 前端拆成 View / ViewModel / Model 之後要當成靜態檔送出去。
// 白名單寫死，不從路徑組檔名，免得變成任意讀檔。
const ASSETS = [
  ["/styles.css", "text/css; charset=utf-8"],
  ["/vendor/design-system.css", "text/css; charset=utf-8"],
  ["/vendor/logos.svg", "image/svg+xml; charset=utf-8"],
  ["/app.js", "text/javascript; charset=utf-8"],
  ["/view.js", "text/javascript; charset=utf-8"],
  ["/viewmodel.js", "text/javascript; charset=utf-8"],
  ["/model.js", "text/javascript; charset=utf-8"],
  ["/api.js", "text/javascript; charset=utf-8"],
  ["/tour.js", "text/javascript; charset=utf-8"],
  ["/tour-model.js", "text/javascript; charset=utf-8"],
  // 操作步驟的彈窗。mocks.js 跟 copy-studio 共用同一份——編輯器裡看到的畫面就是
  // 學生看到的畫面，複製一份的話兩邊遲早會分岔。
  ["/walkthrough.js", "text/javascript; charset=utf-8"],
  ["/mocks.js", "text/javascript; charset=utf-8"],
  ["/mocks.css", "text/css; charset=utf-8"],
  ["/platform.js", "text/javascript; charset=utf-8"],
  ["/vendor/driver.mjs", "text/javascript; charset=utf-8"],
  ["/vendor/driver.css", "text/css; charset=utf-8"],
  // 動畫：播放器與三支 lottie。走 vendor 不走 CDN，理由跟 driver.js 一樣——
  // 學生的 VM 常常連不到外網，指 CDN 的話動畫會靜靜地不出現。
  ["/lottie-player.js", "text/javascript; charset=utf-8"],
  ["/vendor/lottie-light.min.js", "text/javascript; charset=utf-8"],
  ["/vendor/milestone-cat.json", "application/json; charset=utf-8"],
  ["/vendor/loader-claude.json", "application/json; charset=utf-8"],
  ["/vendor/lock.json", "application/json; charset=utf-8"],
  // 清單上那顆問號。它是進操作步驟的入口，動一下才看得出「這裡可以點」。
  ["/vendor/question-mark.json", "application/json; charset=utf-8"],
  // 解鎖下一張時放的那一段：巫師施法，接著炸開。
  ["/vendor/wizard.json", "application/json; charset=utf-8"],
  ["/vendor/explosion.json", "application/json; charset=utf-8"],
];

async function loadAssets() {
  const entries = await Promise.all(
    ASSETS.map(async ([pathname, contentType]) => [
      pathname,
      {
        contentType,
        body: await readFile(
          new URL(`../public${pathname}`, import.meta.url),
          "utf8",
        ),
      },
    ]),
  );

  return new Map(entries);
}

// action.options 宣告「這個 action 收哪些選項、每個選項的合法值有哪些」。
// 值必須落在白名單裡——網路端傳過來的字串永遠不會直接變成指令參數。
function resolveOptions(action, provided) {
  const schema = action.options ?? null;

  if (schema === null) {
    if (provided !== undefined) {
      throw new Error("這個 Action 不接受 options");
    }

    return null;
  }

  if (provided === null || typeof provided !== "object") {
    throw new Error("options 必須是物件");
  }

  const resolved = {};

  for (const [name, allowed] of Object.entries(schema)) {
    const value = provided[name];

    if (!allowed.includes(value)) {
      throw new Error(`options.${name} 不在允許的值裡`);
    }

    resolved[name] = value;
  }

  return resolved;
}

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

export function parseJrEventLine(line) {
  if (!line.startsWith(JR_EVENT_PREFIX)) {
    return null;
  }

  try {
    const event = JSON.parse(line.slice(JR_EVENT_PREFIX.length));

    return event !== null &&
      typeof event === "object" &&
      !Array.isArray(event) &&
      typeof event.kind === "string"
      ? event
      : null;
  } catch {
    return null;
  }
}

function writeOutputLine(response, stream, line) {
  const event = parseJrEventLine(line);

  if (event !== null) {
    writeEvent(response, "jr", event);
    return;
  }

  writeEvent(response, "line", { stream, text: line });
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

// reason 是診斷用的：Windows VM 上 winget 裝 Python 收到 exit code 0x80004004
// （E_ABORT，「操作已中止」），而全域只有這一支會主動中止子行程。它到底有沒有開槍，
// 從輸出上看不出來——殺掉之後 winget 印的是自己的取消訊息，跟它自己放棄長得一樣。
//
// 印到伺服器自己的 stderr，不進 SSE：這是給我們看的，不是給學生看的。看的地方是
// 跑嚮導的那個終端機視窗（bootstrap 就是在那裡 node bin/jr-setup-ui.js），
// 不是頁面上的「看原始輸出」——那一份收的是子行程的輸出。
function terminateRun(run, reason = "unknown") {
  if (run.finished || !childIsRunning(run.child)) {
    return;
  }

  console.error(`[terminateRun] 中止子行程，來源：${reason}`);
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

function launchWindow(command, env, runId, runs, response) {
  const spawnable = resolveLaunch(command.cmd, command.args, { env });

  try {
    const child = spawn(spawnable.cmd, spawnable.args, {
      shell: false,
      stdio: "ignore",
      detached: true,
      env,
      ...(spawnable.spawnOptions ?? {}),
    });
    child.unref();
    writeEvent(response, "line", {
      stream: "stdout",
      text: "已開啟終端機視窗。",
    });
    writeEvent(response, "done", { exitCode: 0, signal: null, benign: false });
  } catch (error) {
    writeEvent(response, "agent", {
      kind: "error",
      text: `無法開啟終端機視窗：${error.message}`,
    });
    writeEvent(response, "done", {
      exitCode: null,
      signal: null,
      benign: false,
    });
  }

  runs.delete(runId);
  response.end();
}

function explainOutput(output, env) {
  return new Promise((resolve) => {
    const launch = resolveLaunch(process.execPath, [explainOutputScript], {
      env,
    });
    let stdout = "";
    let settled = false;
    let child;
    const finish = (text) => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(text);
    };

    try {
      child = spawn(launch.cmd, launch.args, {
        shell: false,
        stdio: ["pipe", "pipe", "ignore"],
        env,
        ...(launch.spawnOptions ?? {}),
      });
    } catch {
      finish(EXPLAIN_FALLBACK);
      return;
    }

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.once("error", () => finish(EXPLAIN_FALLBACK));
    child.once("close", (code) => {
      const text = stdout.replace(/\s+/g, " ").trim();
      finish(code === 0 && text.length > 0 ? text : EXPLAIN_FALLBACK);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(output);
  });
}

async function runAction(
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
  // 這一次實際要跑的 agent。merge-config-step 的 engine 是個函式（跟著學生選的
  // 工具走），底下組指令與挑 parser 都要用同一個答案。
  const engine = action.kind === "agent" ? resolveEngine(action, run.options) : null;
  const command =
    action.kind === "agent"
      ? commandBuilder(engine, run.prompt, run.permission)
      : {
          cmd: action.cmd,
          // 帶選項的 action 由自己組參數；選項的值已經比對過白名單。
          args:
            typeof action.buildArgs === "function"
              ? action.buildArgs(run.options)
              : action.args,
        };
  // Windows 上 winget 裝完會新增 PATH 目錄，但本程序拿的是啟動當下的快照。
  // 重讀一次，剛裝好的東西才叫得動。
  const env = await spawnEnv();

  // 只負責開視窗的 action 走另一條路：不接管線、不等它結束。
  // 那個新視窗會繼承管線並一直握著，close 事件永遠不會來（實測登入按鈕就是
  // 卡在這裡，整個畫面的按鈕全部鎖死）。
  if (action.launchesWindow) {
    launchWindow(command, env, runId, runs, response);
    return;
  }

  // action 可以自己覆寫幾個環境變數（目前只有登入用的 BROWSER，見 actions.js）。
  const childEnv = { ...env, ...(action.env ?? {}) };
  const baseOptions = {
    shell: false,
    stdio: [action.acceptsInput ? "pipe" : "ignore", "pipe", "pipe"],
    env: childEnv,
  };
  const spawnOptions =
    action.kind === "agent"
      ? { ...baseOptions, cwd: ensureWorkDir() }
      : baseOptions;
  const parser = engine === "claude" ? parseClaudeLine : parseCodexLine;
  // Windows 的 .cmd 包裝檔不能直接 spawn（Node 會丟 EINVAL），要繞 cmd.exe；
  // 裸指令（claude / codex / gh）在 Windows 也要先查出實際檔名才叫得動。
  const spawnable = resolveLaunch(command.cmd, command.args, { env });
  let child;

  try {
    // spawnOptions 之外還要帶 resolveLaunch 自己要求的旗標（cmd.exe 包裝要
    // windowsVerbatimArguments，否則帶空白的路徑會被 Node 再跳脫一次）。
    child = spawn(spawnable.cmd, spawnable.args, {
      ...spawnOptions,
      ...(spawnable.spawnOptions ?? {}),
    });
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
  const rawOutput = [];

  const flushStdout = streamLines(child.stdout, (line) => {
    // 進度動畫連 rawOutput 都不收：那一份餵三個地方（原始輸出面板、挑失敗原因、
    // 丟給 LLM 翻譯），三個都不需要幾百行轉圈符號。
    if (isProgressNoise(line)) {
      return;
    }

    rawOutput.push(line);

    if (action.kind === "fixed") {
      writeOutputLine(response, "stdout", line);
      return;
    }

    const event = parser(line);

    if (event !== null) {
      writeEvent(response, "agent", event);
    }
  });
  const flushStderr = streamLines(child.stderr, (line) => {
    // stderr 也要過一次：brew 的下載進度就是寫在這邊。
    if (isProgressNoise(line)) {
      return;
    }

    rawOutput.push(line);
    writeOutputLine(response, "stderr", line);
  });

  const finish = async (exitCode, signal) => {
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
    const result = {
      exitCode,
      signal,
      benign: isBenignExit(command.cmd, exitCode),
    };
    const explanationPending = shouldExplainOutput({
      action: run.actionName,
      options: run.options,
      result,
    });

    runs.delete(runId);
    writeEvent(response, "done", {
      ...result,
      explanationPending,
    });

    if (explanationPending) {
      writeEvent(response, "explain", { kind: "start" });
      const text = await explainOutput(rawOutput.join("\n"), env);
      writeEvent(response, "explain", { kind: "result", text });
    }

    response.end();
  };

  child.once("error", (error) => {
    const text =
      error.code === "ENOENT"
        ? `找不到 ${command.cmd} 指令，請先安裝並確認它在 PATH 裡`
        : error.message;
    rawOutput.push(text);
    writeEvent(response, "agent", { kind: "error", text });
    finish(null, null);
  });
  child.once("close", finish);
  // close 要等行程結束「而且」所有 stdio 都關掉。子行程再開一個孫行程、讓它繼承
  // stdout/stderr 的話（claude login 會開瀏覽器的 helper），殺掉子行程之後那根管子
  // 還握在孫行程手上——close 永遠不會來，前端就永遠等不到 done：畫面停在
  // 「正在取消…」，按鈕留在「開始登入中…」，連取消鈕都是灰的，整頁做不了下一步
  //（Reed 實測截圖）。
  //
  // exit 只看行程本身，一定會來。給 close 一秒走正常路徑（它會把剩下的輸出沖乾淨），
  // 沒來就自己收尾。finish 本身有 run.finished 擋重入，兩條路徑不會收兩次。
  child.once("exit", (exitCode, signal) => {
    const timer = setTimeout(() => finish(exitCode, signal), 1000);
    timer.unref();
  });
  response.on("close", () => terminateRun(run, "sse-close"));
}

export async function startServer({
  port,
  token,
  actionTable = actions,
  commandBuilder = buildAgentCommand,
}) {
  const indexHtml = await readFile(indexPath, "utf8");
  const assets = await loadAssets();
  const runs = new Map();

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");

    // 樣式與前端模組不帶 token：<link> 與 import 都由瀏覽器自己發請求，
    // 沒辦法補上查詢字串。這些檔案本來就是公開的原始碼，沒有機密。
    // 真正要保護的 /env、/run、/input、/cancel、/stream 仍然一律驗 token。
    const asset = request.method === "GET" ? assets.get(url.pathname) : null;

    if (asset !== null && asset !== undefined) {
      response.writeHead(200, { "Content-Type": asset.contentType });
      response.end(asset.body);
      return;
    }

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
      const tools = (url.searchParams.get("tools") ?? "")
        .split(",")
        .filter((tool) => tool.length > 0);

      if (tools.some((tool) => !TOOLS.includes(tool))) {
        sendText(response, 400, "tools 不合法");
        return;
      }

      response.setHeader("Cache-Control", "no-store");
      // 沒帶 tools 就照舊全查——/env 在選擇載入之前也會被呼叫到。
      sendJson(response, 200, await runEnvCheck(tools));
      return;
    }

    if (request.method === "GET" && url.pathname === "/configs") {
      const lang = url.searchParams.get("lang") ?? "zh-TW";
      const tools = (url.searchParams.get("tools") ?? "")
        .split(",")
        .filter((tool) => tool.length > 0);

      if (!LANGUAGES.includes(lang) || tools.some((t) => !TOOLS.includes(t))) {
        sendText(response, 400, "lang 或 tools 不合法");
        return;
      }

      if (tools.length === 0) {
        sendJson(response, 200, { lang, tools, checks: [] });
        return;
      }

      response.setHeader("Cache-Control", "no-store");
      sendJson(response, 200, {
        ...(await runConfigCheck({ tools, lang })),
        platform: process.platform,
      });
      return;
    }

    // 驗證留下的截圖。學生看得到那張圖，才知道「真的有一顆瀏覽器被開起來」不是
    // 一句空話——這一格的證據本來就是那個檔案，那就把它端出來。
    //
    // agent 只認白名單裡那兩個值，其餘一律 400：接受檔名或路徑片段等於開一個讀
    // 任意檔案的洞。檔名由 verifyShotPath 組，外面傳不進任何字元。
    if (request.method === "GET" && url.pathname === "/verify-shot") {
      const agent = url.searchParams.get("agent") ?? "claude";

      if (!VERIFY_SHOT_AGENTS.includes(agent)) {
        sendText(response, 400, "agent 不在允許的值裡");
        return;
      }

      try {
        const png = await readFile(verifyShotPath(agent));
        response.writeHead(200, {
          "Content-Type": "image/png",
          "Cache-Control": "no-store",
        });
        response.end(png);
      } catch {
        sendText(response, 404, "還沒有截圖");
      }
      return;
    }

    // 哪幾格有操作步驟。開頁時問一次，決定哪幾列要畫「怎麼做」那顆按鈕——按鈕存在
    // 卻按出一個空彈窗，比沒有按鈕更讓人困惑。
    if (request.method === "GET" && url.pathname === "/walkthroughs") {
      let ids = [];

      try {
        const dir = path.join(contentDir(), "walkthroughs");
        const files = await readdir(dir);
        const found = await Promise.all(
          files
            .filter((name) => name.endsWith(".json"))
            .map(async (name) => {
              const data = JSON.parse(await readFile(path.join(dir, name), "utf8"));
              // 還沒編過的（只有骨架、標題空著）不算——那顆按鈕會按出一片空白。
              const written = (data.steps ?? []).some((step) => {
                const title = step.title;
                const text = typeof title === "object" && title !== null ? title.mac : title;
                return String(text ?? "").trim() !== "";
              });
              return written ? data.id : null;
            }),
        );
        ids = found.filter((id) => id !== null);
      } catch {
        ids = [];
      }

      response.setHeader("Cache-Control", "no-store");
      sendJson(response, 200, { ids });
      return;
    }

    // 操作步驟：學生按「怎麼做」時才抓，不是開頁就全部載進來——十四份裡他一次只
    // 看得到一份。
    //
    // id 只放行 kebab-case：它會被接成檔案路徑，收任何斜線或點就等於開一個讀任意
    // 檔案的洞。跟上面 verify-shot 的 agent 白名單同一個理由。
    if (request.method === "GET" && url.pathname.startsWith("/walkthrough/")) {
      const id = url.pathname.slice("/walkthrough/".length);

      if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
        sendText(response, 400, "id 不合法");
        return;
      }

      try {
        const text = await readFile(
          path.join(contentDir(), "walkthroughs", `${id}.json`),
          "utf8",
        );
        response.setHeader("Cache-Control", "no-store");
        sendJson(response, 200, JSON.parse(text));
      } catch {
        sendText(response, 404, "這一格還沒有操作步驟");
      }
      return;
    }

    // 步驟裡真的要拍的那幾張圖。能畫的都畫掉了，所以這條路徑多半用不到——但用得到
    // 的時候，沒有它學生就只看得到一個破圖。
    if (request.method === "GET" && url.pathname.startsWith("/walkthrough-shot/")) {
      const rest = url.pathname.slice("/walkthrough-shot/".length);

      if (!/^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9.-]*\.(png|jpg|webp)$/.test(rest)) {
        sendText(response, 400, "路徑不合法");
        return;
      }

      try {
        const bytes = await readFile(path.join(contentDir(), "shots", rest));
        response.writeHead(200, {
          "Content-Type": rest.endsWith(".png")
            ? "image/png"
            : rest.endsWith(".webp")
              ? "image/webp"
              : "image/jpeg",
          "Cache-Control": "no-store",
        });
        response.end(bytes);
      } catch {
        sendText(response, 404, "還沒有這張圖");
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/state") {
      response.setHeader("Cache-Control", "no-store");
      sendJson(response, 200, {
        verified: await loadVerifiedSteps(),
        behavior: await loadBehaviorVerifiedSteps(),
        // 驗過之後被動過的那幾步。不影響勾，只在卡片上多一句提醒。
        changed: await loadChangedSteps(),
        manual: await loadManualChecked(),
        selection: await loadSelection(),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/state") {
      let body;

      try {
        body = await readJson(request);
      } catch {
        sendText(response, 400, "JSON 格式不正確");
        return;
      }

      const payload = body !== null && typeof body === "object" ? body : {};

      // 工具／語言的選擇也走這支，存在 state.json 才撐得過重開伺服器（port 會變，
      // localStorage 綁 origin 等於存不住）。
      if (payload.selection !== undefined) {
        const { tools, lang } = payload.selection ?? {};
        const validTools =
          Array.isArray(tools) &&
          tools.length > 0 &&
          tools.every((tool) => tool === "claude" || tool === "codex");

        if (!validTools || typeof lang !== "string") {
          sendText(response, 400, "selection 需要 tools 陣列與 lang 字串");
          return;
        }

        await saveSelection({ tools, lang });
        sendJson(response, 200, { ok: true });
        return;
      }

      // 整份覆蓋：取消勾選也要存得回去。
      if (payload.manual !== undefined) {
        if (
          !Array.isArray(payload.manual) ||
          payload.manual.some((id) => typeof id !== "string")
        ) {
          sendText(response, 400, "manual 需要字串陣列");
          return;
        }

        await saveManualChecked(payload.manual);
        sendJson(response, 200, { ok: true });
        return;
      }

      const step = payload.step;

      if (typeof step !== "string") {
        sendText(response, 400, "step 必須是字串");
        return;
      }

      // kind=behavior 記的是「程式那半驗過了」，不代表整列綠。有眼睛勾選框的列
      // 會先送這一筆，等學生勾完才再送一筆預設的 verified。
      const kind = payload.kind ?? "verified";

      if (kind !== "verified" && kind !== "behavior") {
        sendText(response, 400, "kind 只能是 verified 或 behavior");
        return;
      }

      // clear=true 是重驗之前的「先忘掉上一輪」。只清瀏覽器記憶體不夠：驗證失敗
      // 時那一格會留在畫面上沒勾，重新整理之後上一輪的勾又回來了。
      const clear = payload.clear === true;

      try {
        if (clear) {
          await (kind === "behavior"
            ? clearBehaviorVerified(step)
            : clearStepVerified(step));
        } else {
          await (kind === "behavior"
            ? markBehaviorVerified(step)
            : markStepVerified(step));
        }
      } catch (error) {
        sendText(response, 400, error.message);
        return;
      }

      sendJson(response, 200, { step, kind, verified: !clear });
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

      // 有些 action 要帶選項（裝哪一步、哪個語言）。值一律比對白名單，
      // 不讓自由字串進到指令參數裡。
      let options;

      try {
        options = resolveOptions(action, body.options);
      } catch (error) {
        sendText(response, 400, error.message);
        return;
      }

      const runId = randomBytes(16).toString("hex");
      runs.set(runId, {
        action,
        actionName,
        options,
        child: null,
        finished: false,
        killTimer: null,
        permission: body.allowWrite === true ? "write" : action.permission,
        prompt: action.acceptsPrompt
          ? body.prompt
          : typeof action.buildPrompt === "function"
            ? action.buildPrompt(options)
            : action.prompt,
        used: false,
      });
      sendJson(response, 200, {
        runId,
        acceptsInput: action.acceptsInput === true,
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/input") {
      let body;

      try {
        body = await readJson(request);
      } catch {
        sendText(response, 400, "JSON 格式不正確");
        return;
      }

      const runId =
        body !== null && typeof body === "object" ? body.runId : undefined;
      const text =
        body !== null && typeof body === "object" ? body.text : undefined;
      const run = runs.get(runId);

      if (!run || run.action.acceptsInput !== true) {
        sendText(response, 400, "Run 不存在或不接受輸入");
        return;
      }

      if (typeof text !== "string") {
        sendText(response, 400, "text 必須是字串");
        return;
      }

      if (text.length > 500) {
        sendText(response, 400, "text 不可超過 500 字元");
        return;
      }

      if (
        !childIsRunning(run.child) ||
        !run.child.stdin.writable ||
        run.child.stdin.destroyed ||
        run.child.stdin.writableEnded
      ) {
        sendText(response, 400, "子程序已結束或無法接收輸入");
        return;
      }

      try {
        await new Promise((resolve, reject) => {
          run.child.stdin.write(`${text}\n`, "utf8", (error) => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          });
        });
      } catch (error) {
        sendText(response, 400, `無法送出輸入：${error.message}`);
        return;
      }

      sendJson(response, 200, { sent: true });
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

      terminateRun(run, "cancel-endpoint");
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
      await runAction(run, runId, runs, response, commandBuilder);
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
        terminateRun(run, "server-close");
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
