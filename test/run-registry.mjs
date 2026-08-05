// terminateRun 的單元測試。
//
// 這段程式是整個後端出過最多事的地方（winget 被莫名中止、SSE 一斷就殺子行程、孫行程
// 握著管子讓 close 永遠不來），卻一條測試都沒有——因為它原本跟路由住在同一個檔案裡，
// 測它就得先起一個伺服器、真的 spawn 一個子行程、再想辦法讓連線斷掉。
//
// 抽成 run-registry.js 之後，它要的只是「一個看起來像 child process 的東西」。
import assert from "node:assert/strict";

import { runHeader, terminateRun } from "../src/run-registry.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

// 只長得像 child process 就夠：terminateRun 看的是 exitCode / signalCode / kill()。
function fakeChild({ exitCode = null, signalCode = null } = {}) {
  const signals = [];
  return {
    exitCode,
    signalCode,
    signals,
    kill(signal) {
      signals.push(signal);
    },
  };
}

function fakeRun(overrides = {}) {
  return { finished: false, killTimer: null, child: fakeChild(), ...overrides };
}

const logged = [];
const realError = console.error;
console.error = (...args) => logged.push(args.join(" "));

try {
  // 正常情況：先送 SIGTERM，並排一個補刀的計時器。
  const run = fakeRun();
  terminateRun(run, "sse-close");
  assert.deepEqual(run.child.signals, ["SIGTERM"]);
  assert(run.killTimer !== null, "要排一個 SIGKILL 的補刀計時器");
  ok("執行中的子行程會收到 SIGTERM，並排好補刀");

  // 來源要印出來。這行是診斷用的：winget 被中止時，從輸出上分不出是我們開的槍還是
  // 它自己放棄——殺掉之後 winget 印的取消訊息跟自己放棄長得一模一樣。
  assert(
    logged.some((line) => line.includes("sse-close")),
    "要印出中止來源",
  );
  ok("中止來源會印到 stderr");

  // 重入不能排第二個計時器，否則取消一次會排到兩顆 SIGKILL。
  terminateRun(run, "cancel-endpoint");
  const timer = run.killTimer;
  terminateRun(run, "server-close");
  assert.equal(run.killTimer, timer, "計時器只排一次");
  ok("重複呼叫不會排出第二顆補刀計時器");

  // 已經收尾的 run 不能再殺一次：finish 之後 child 可能已經被別人接手，
  // 而且 runs 裡已經沒有它了。
  const finished = fakeRun({ finished: true });
  terminateRun(finished, "cancel-endpoint");
  assert.deepEqual(finished.signals ?? finished.child.signals, []);
  ok("已經收尾的 run 不會再被殺一次");

  // 已經自己結束的子行程也不用殺。exitCode 與 signalCode 兩種結束方式都要認得
  // ——只看 exitCode 的話，被訊號殺死的行程會被當成還活著。
  for (const dead of [{ exitCode: 0 }, { signalCode: "SIGTERM" }]) {
    const run = fakeRun({ child: fakeChild(dead) });
    terminateRun(run, "cancel-endpoint");
    assert.deepEqual(run.child.signals, [], JSON.stringify(dead));
    assert.equal(run.killTimer, null);
  }
  ok("已經結束的子行程不會被再殺一次，兩種結束方式都認得");

  // 補刀計時器要 unref：它是背景的保險，不該讓整個行程為了等它而不結束
  // ——嚮導關掉時如果還有一顆 3 秒的計時器活著，視窗會多卡 3 秒才真的關掉。
  assert.equal(
    typeof run.killTimer.unref,
    "function",
    "計時器要是 Node 的 Timeout（才 unref 得了）",
  );
  ok("補刀計時器不會拖住行程結束");

  // 迴歸：中止那件事要進得了學生貼得回來的原始輸出。
  //
  // 只印到伺服器的 stderr 是不夠的——那要看跑嚮導的那個終端機視窗，學生不會知道要
  // 看那裡。今天查 winget 被中止時就是卡在這裡：要判斷「是我們開的槍還是它自己
  // 放棄」，得請人去盯另一個視窗。
  const noted = [];
  const withNote = fakeRun({ note: (text) => noted.push(text) });
  terminateRun(withNote, "sse-close");
  assert.equal(noted.length, 1);
  assert.match(noted[0], /terminateRun/);
  assert.match(noted[0], /sse-close/);
  ok("中止會寫進這次執行的原始輸出，不是只印到伺服器終端");

  // note 是後來才掛上的，而 terminateRun 也可能在它掛上之前被呼叫（子行程還沒
  // spawn 起來就被取消）。少了那個 ?. 會在收尾路徑上丟例外。
  assert.doesNotThrow(() => terminateRun(fakeRun(), "server-close"));
  ok("還沒掛上 note 的 run 也中止得了");

  // 環境摘要：學生貼回來的往往只有這一段輸出，平台與來源分支必須在裡面。今天是從
  // 輸出裡那句 python-3.13.14-arm64.exe 才意外看出那是一台 ARM 的 VM。
  const header = runHeader(
    { actionName: "install-python", options: { lang: "zh-TW" } },
    null,
    // 存下來的選擇，不是這次 action 的 options：裝設定那幾顆宣告的是 {step, lang}，
    // 伺服器會把前端送的 tools 丟掉，摘要上就永遠是「-」（VM 實測貼回來就是這樣）。
    { tools: ["claude", "codex"] },
    { platform: "win32", arch: "arm64", version: "v24.19.0" },
  ).join("\n");
  assert.match(header, /install-python/);
  assert.match(header, /win32 arm64/);
  assert.match(header, /v24\.19\.0/);
  assert.match(header, /tools=claude,codex/);
  // 來源分支：抓不到時要說 unknown，不能整個爆掉——.jr-source 是 bootstrap 寫的，
  // 用 git clone 跑的開發機上根本沒有那個檔案。
  assert.match(header, /嚮導來源：/);
  ok("每次執行的開頭有平台、Node、來源分支與這次的選擇");
} catch (error) {
  console.log(`not ok - ${error.message}`);
  process.exitCode = 1;
} finally {
  console.error = realError;
  // 測試排出來的 SIGKILL 計時器已經 unref，不會拖住行程；這裡不用另外清。
}
