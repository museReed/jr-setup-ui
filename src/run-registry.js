// 子行程的一生：spawn、把輸出接出來、被中止時怎麼收尾。
//
// 從 server.js 抽出來的，因為它是整個後端唯一「難」的地方，而且出過最多事——winget
// 被莫名中止、SSE 一斷就殺子行程、孫行程握著管子讓 close 永遠不來。它原本跟路由擠在
// 同一個檔案裡，測它就得先起一個伺服器，所以一條單元測試都沒有。
//
// 這一層算轉接頭不算領域：它要收 http response（要把輸出即時推給瀏覽器），也要碰
// 作業系統（spawn）。它站在兩個外部世界中間，本來就不會是純的——但至少它只做這件事。
//
// 領域模組不准 import 它，跟不准 import server.js 是同一條規則（見
// test/backend-layers.mjs）。
import { spawn } from "node:child_process";

import { parseClaudeLine, parseCodexLine } from "./agent-events.js";
import { resolveEngine, shouldExplainOutput } from "./actions.js";
import { spawnEnv } from "./env-path.js";
import { isBenignExit } from "./installers.js";
import { isProgressNoise } from "./output-noise.js";
import { loadSelection } from "./progress-state.js";
import { ensureWorkDir, moduleFile, readSourceMarker } from "./paths.js";
import { resolveLaunch } from "./spawn-command.js";
import { streamLines, writeEvent, writeOutputLine } from "./sse.js";

const explainOutputScript = moduleFile(
  "../scripts/explain-output.mjs",
  import.meta.url,
);
const EXPLAIN_FALLBACK = "（無法翻譯，請看下方原始輸出）";

// 每次執行開頭的環境摘要。這幾行是給我們看的，不是給學生看的——該塞的就塞。
//
// selection 是存下來的那份「學生選了哪些工具、哪個語言」，不是這次 action 的 options
// ——後者只留得住 action 自己宣告的欄位。裝設定那幾顆宣告的是 {step, lang}，於是
// 摘要上的 tools 永遠是「-」（VM 實測貼回來的診斷資料就是這樣）。
//
// 摘要是診斷資料，不該依賴每顆 action 記得宣告 tools。
export function runHeader(run, engine = null, selection = null, platform = process) {
  const options = run.options ?? {};
  const tools = selection?.tools?.join(",") ?? options.tools ?? "-";
  const lang = options.lang ?? selection?.lang ?? "-";

  return [
    `--- ${run.actionName ?? "?"}${engine === null ? "" : `（${engine}）`} ---`,
    `平台：${platform.platform} ${platform.arch}　Node：${platform.version}`,
    `嚮導來源：${readSourceMarker()}`,
    `選擇：tools=${tools} lang=${lang} step=${options.step ?? "-"}`,
  ];
}

// server.js 的 POST /input 也要問這件事：子行程還活著才餵得進去。
export function childIsRunning(child) {
  return child && child.exitCode === null && child.signalCode === null;
}

// reason 是診斷用的：Windows VM 上 winget 裝 Python 收到 exit code 0x80004004
// （E_ABORT，「操作已中止」），而全域只有這一支會主動中止子行程。它到底有沒有開槍，
// 從輸出上看不出來——殺掉之後 winget 印的是自己的取消訊息，跟它自己放棄長得一樣。
//
// 印到伺服器自己的 stderr，不進 SSE：這是給我們看的，不是給學生看的。看的地方是
// 跑嚮導的那個終端機視窗（bootstrap 就是在那裡 node bin/jr-setup-ui.js），
// 不是頁面上的「看原始輸出」——那一份收的是子行程的輸出。
export function terminateRun(run, reason = "unknown") {
  if (run.finished || !childIsRunning(run.child)) {
    return;
  }

  const note = `[terminateRun] 中止子行程，來源：${reason}`;
  console.error(note);
  // 也寫進這一次的原始輸出。只印到伺服器的 stderr 是不夠的——那要看跑嚮導的那個
  // 終端機視窗，學生不會知道要看那裡，也貼不回來。今天查 winget 被中止時就是卡在
  // 這裡：要判斷「是我們開的槍還是它自己放棄」，得請人去盯另一個視窗。
  run.note?.(note);
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

export async function runAction(
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

  // 這一次執行的時間原點。原始輸出的每一行都標「距這裡幾秒」。
  //
  // 為什麼是相對不是絕對：學生 VM 的時鐘常常是歪的，而我們判斷問題時要的從來不是
  // 「幾點幾分」，是「這一步花了多久」。今天查 winget 被中止時，最硬的線索是
  // 「27 MB 下載跑了三分鐘」——而那件事完全不在 log 裡，是 Reed 口頭講的。
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;

  // 收尾用的旁白：進原始輸出、也送到畫面上那個面板，但不進白話終端。
  // 掛在 run 上是為了讓 terminateRun 用得到——它只拿得到 run。
  run.note = (text) => {
    writeOutputLine(response, "stderr", text, elapsed());
  };

  const { action } = run;
  // 這一次實際要跑的 agent。merge-config-step 的 engine 是個函式（跟著學生選的
  // 工具走），底下組指令與挑 parser 都要用同一個答案。
  const engine = action.kind === "agent" ? resolveEngine(action, run.options) : null;

  // 開頭先寫一段環境摘要。學生貼回來的往往只有這一段輸出，沒有這幾行的話，
  // 連「他是哪個平台、跑哪個版本」都得靠猜——今天是從輸出裡那句
  // python-3.13.14-arm64.exe 才意外看出那是一台 ARM 的 VM。
  // 讀存下來的選擇會碰磁碟，失敗不該讓整次執行收攤——摘要少一格，比按鈕按不動好。
  const selection = await loadSelection().catch(() => null);

  for (const line of runHeader(run, engine, selection)) {
    writeOutputLine(response, "stdout", line, 0);
  }
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
      writeOutputLine(response, "stdout", line, elapsed());
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
    writeOutputLine(response, "stderr", line, elapsed());
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
      // 收尾這一行也要標時間，而且它是最該標的一行——前面停在幾秒不代表整件事跑了
      // 幾秒。今天那個 winget 案子如果只有 exit code、沒有「跑了三分鐘」，我們一樣
      // 看不出它是被拖垮的。
      at: elapsed(),
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
