import { randomBytes, timingSafeEqual } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

import { actions, buildAgentCommand } from "./actions.js";
import {
  childIsRunning,
  runAction,
  terminateRun,
} from "./run-registry.js";
import { runConfigCheck, scanStraySkills } from "./config-check.js";
import { LANGUAGES, TOOLS } from "./config-install.js";
import { runEnvCheck } from "./env-check.js";
import { contentDir, VERIFY_SHOT_AGENTS, verifyShotPath } from "./paths.js";
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

const indexPath = new URL("../public/index.html", import.meta.url);

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
  ["/report.js", "text/javascript; charset=utf-8"],
  ["/tour.js", "text/javascript; charset=utf-8"],
  // 操作步驟的彈窗。mocks.js／mocks.css 跟 copy-studio 共用同一份——編輯器裡看到的
  // 畫面就是學生看到的畫面，複製一份的話兩邊遲早會分岔。
  ["/walkthrough.js", "text/javascript; charset=utf-8"],
  ["/mocks.js", "text/javascript; charset=utf-8"],
  ["/mocks.css", "text/css; charset=utf-8"],
  ["/platform.js", "text/javascript; charset=utf-8"],
  ["/tour-model.js", "text/javascript; charset=utf-8"],
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
    // 絕大多數選項是固定字串的白名單。少數不可能窮舉的（例如「要搬走哪一個 skill」，
    // 那個名字是學生機器上的資料夾名）改用一個函式驗證器——它仍然是白名單，只是規則
    // 寫成形狀而不是清單。
    //
    // ⚠️ 通過這裡不代表可以直接拿去組路徑。用得到這種選項的那支腳本一律要再比對一次
    // 「這個名字真的在我自己偵測出來的清單裡」，兩層都過才動手（見
    // scripts/quarantine-skills.mjs）。
    const passes =
      typeof allowed === "function" ? allowed(value) : allowed.includes(value);

    if (!passes) {
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

export async function startServer({
  port,
  token,
  actionTable = actions,
  commandBuilder = buildAgentCommand,
}) {
  const indexHtml = await readFile(indexPath, "utf8");
  const assets = await loadAssets();
  const runs = new Map();

  // 路由表。原本是十條 if 排在同一個 callback 裡——多一條 route 要先讀完
  // 三百多行才知道有沒有撞名，而路由是攻擊面，看得完很重要。
  //
  // 表在 startServer 裡面而不是模組層：每個 handler 都要用到 runs、token、
  // actionTable 這些每次啟動才決定的東西。搬到外面就得把它們一個個當參數傳。
  const routes = {
  "GET /": async (request, response, url) => {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
  });
  response.end(indexHtml);
  return;
  },
  "GET /env": async (request, response, url) => {
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
  },
  "GET /configs": async (request, response, url) => {
  const lang = url.searchParams.get("lang") ?? "zh-TW";
  const tools = (url.searchParams.get("tools") ?? "")
    .split(",")
    .filter((tool) => tool.length > 0);

  if (!LANGUAGES.includes(lang) || tools.some((t) => !TOOLS.includes(t))) {
    sendText(response, 400, "lang 或 tools 不合法");
    return;
  }

  if (tools.length === 0) {
    // 一個工具都沒選時沒有步驟可查，但殘留掃描照樣要跑：「我機器上還躺著上一輪的
    // 東西」跟他這次打算用哪一個工具無關，而這正是他還在第一張卡上的那一刻。
    sendJson(response, 200, {
      lang,
      tools,
      checks: [],
      strays: scanStraySkills(lang),
    });
    return;
  }

  response.setHeader("Cache-Control", "no-store");
  sendJson(response, 200, {
    ...(await runConfigCheck({ tools, lang })),
    platform: process.platform,
  });
  return;
  },
  "GET /verify-shot": async (request, response, url) => {
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
  },
  // 哪幾格有操作步驟，以及那一列該寫什麼。開頁時問一次。
  //
  // 回的不只是 id：卡片上那一列的標題與說明也住在 content/ 裡，這樣文案審閱者改完
  // 就生效，不用回頭動 src/。沒寫的話卡片照舊用 src/ 裡原本那份。
  "GET /walkthroughs": async (request, response, url) => {
  let items = [];

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
          return written
            ? { id: data.id, title: data.title ?? null, description: data.description ?? null }
            : null;
        }),
    );
    items = found.filter((item) => item !== null);
  } catch {
    items = [];
  }

  response.setHeader("Cache-Control", "no-store");
  sendJson(response, 200, { items });
  return;
  },
  "GET /state": async (request, response, url) => {
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
  },
  "POST /state": async (request, response, url) => {
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
  },
  "POST /run": async (request, response, url) => {
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
  },
  "POST /input": async (request, response, url) => {
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
  },
  "POST /cancel": async (request, response, url) => {
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
  },
  "GET /stream": async (request, response, url) => {
  const runId = url.searchParams.get("runId");
  const run = runs.get(runId);

  if (!run || run.used) {
    sendText(response, 404, "Run 不存在或已使用");
    return;
  }

  run.used = true;
  await runAction(run, runId, runs, response, commandBuilder);
  return;
  },
  };

  // 路徑帶參數的那兩條。路由表是完全比對的，而這兩條的最後一段是 id 與檔名——
  // 讓它們也進表的話就得把表變成正規式比對，那正是改成表之前那團 if 的樣子。
  //
  // 兩條都自己驗過格式才碰檔案系統：那一段會被接成檔案路徑，收任何斜線或點就等於
  // 開一個讀任意檔案的洞（跟 verify-shot 的 agent 白名單同一個理由）。
  const WALKTHROUGH_ID = /^[a-z0-9][a-z0-9-]*$/;
  const SHOT_PATH = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9.-]*\.(png|jpg|webp)$/;

  function prefixRoute(method, pathname) {
    if (method !== "GET") return undefined;

    if (pathname.startsWith("/walkthrough/")) {
      return async (request, response) => {
        const id = pathname.slice("/walkthrough/".length);

        if (!WALKTHROUGH_ID.test(id)) {
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
      };
    }

    if (pathname.startsWith("/walkthrough-shot/")) {
      return async (request, response) => {
        const rest = pathname.slice("/walkthrough-shot/".length);

        if (!SHOT_PATH.test(rest)) {
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
      };
    }

    return undefined;
  }

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


    const handler =
      routes[`${request.method} ${url.pathname}`] ??
      prefixRoute(request.method, url.pathname);

    if (handler === undefined) {
      sendText(response, 404, "找不到路由");
      return;
    }

    await handler(request, response, url);
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
