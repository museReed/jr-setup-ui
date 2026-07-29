// 在「真的終端視窗」裡驗證，學生什麼都不用打。
//
//   node scripts/verify-in-terminal.mjs --case=naming --agent=claude
//
// 為什麼一定要真終端：hook 的效果（分頁標題、被擋的訊息、context 警告）只有在
// 終端裡看得到。headless 的 `claude -p` 更是連 wrapper 都不會經過——wrapper 刻意
// 跳過 -p，所以用 -p 驗標題永遠是綠的假象。
//
// 開了視窗之後這支不會馬上結束，它會等副產物出現：
//
//   證據力的判準是「那段內容是不是只有 hook 才產得出來」。
//   ✅ hook 的原文訊息（「一次只跑一個指令」「Context 已用」）——模型生不出來
//   ✅ session-names/*.txt ——hook 真的跑完才會出現的檔案
//   ❌ 模型自己寫「我看到了」——那是自我回報，沒看到也可以這樣寫
//
// 所以副產物一律要求「一字不改貼上 hook 的原文」，再用字串比對判定。不用第二個
// LLM 去判：那是拿不確定性去換一件字串比對就能確定的事。
import { spawn } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

const POLL_INTERVAL_MS = 1_000;
const TIMEOUT_MS = 240_000;
const RESULT_DIR = path.join(homedir(), ".jr-setup", "verify");

// 每個情境的提問都要「只逼出這一件事」。實測踩過三種寫壞的方式：
//   - 命名那題寫了「不要執行任何指令」→ 模型連命名 hook 要它跑的那條也跳過了
//   - context 那題叫它讀五個檔案 → 家目錄根本沒有，模型花整段在澄清
//   - context 那題說「不要修改任何東西」→ 跟 hook 要求寫交接文件互相打架
// 所以提問一律：明講要做什麼、明講遇到 hook 提示時怎麼辦。
const CASES = {
  naming: {
    label: "自動命名",
    env: () => ({}),
    prompt: ({ agent, resultFile }) =>
      agent === "codex"
        ? // codex 的命名是兩段式：模型先把名字寫到中繼檔，hook 要在「下一次 hook
          // 事件」才套用上去。只問一句話就結束的話，名字永遠卡在中繼檔（VM 實測：
          // 命名沒改到標題，反而是工具呼叫多的 context 測試改到了）。
          "請照 hook 的指示把這個 session 命名，執行它給你的那條指令。" +
          "命名完之後，再列出目前資料夾裡的檔案——這一步是必要的，讓 hook 有機會把名字套用上去。" +
          `最後把你取的名字寫進 ${resultFile}。`
        : "請照 hook 的指示把這個 session 命名，執行它給你的那條指令，然後用一句話告訴我你命名成什麼。",
    // claude 的命名會留下檔案，不必靠模型回報；codex 寫的是 sqlite 與中繼檔，
    // 沒有能穩定輪詢的落點，那一列維持人眼判定。
    expect: ({ agent }) => (agent === "codex" ? null : { kind: "session-name" }),
    watchFor: "分頁標題變成「{emoji} 中文敘述」，emoji 是規定的那 8 個之一",
  },
  // 標題那格不該叫 AI——要驗的是「watcher 有沒有把名字放上分頁標題」，跟模型
  // 一點關係都沒有。這裡直接起裝好的 watcher、餵它一個名字，學生看標題就好：
  // 不花 API 額度、不受模型心情影響，而且失敗時只剩兩個可能（watcher 壞了 /
  // 終端不吃標題），比夾著一個 AI 好查太多。
  title: {
    label: "終端機標題同步",
    env: () => ({}),
    prompt: () => "",
    expect: () => null,
    watchFor: "分頁標題變成「🔍 標題同步測試」，五秒後自己還原",
  },
  chained: {
    label: "Shell 不串接",
    env: () => ({}),
    prompt: ({ resultFile }) =>
      "請執行這條指令：echo a && echo b。" +
      `不管成功或被擋，都把你收到的完整訊息一字不改寫進 ${resultFile}。`,
    expect: () => ({ kind: "artifact", keyword: "一次只跑一個指令" }),
    watchFor: "畫面出現「一次只跑一個指令」的中文訊息，指令被擋下來",
  },
  context: {
    label: "Context 監控",
    // 把 context 上限假裝成小視窗，門檻降到七成，幾次工具呼叫就會跨過去。
    // 兩支監控腳本的測試開關名字不一樣——先前兩邊都設 claude 那個，codex 的門檻
    // 沒被降下來，模型當然回報「未出現 context hook 提醒」（VM 實測）。
    env: ({ agent }) =>
      agent === "codex"
        ? { CODEX_TEST_MAX_CONTEXT_WINDOW: "5000" }
        : { CONTEXT_MONITOR_TEST_WINDOW: "30000" },
    prompt: ({ resultFile }) =>
      "請依序執行這三件事，每件之間簡短說一句話：列出目前資料夾、印出今天日期、印出目前路徑。" +
      "如果過程中有 hook 提醒你 context 快用完、或要你寫交接文件，不要照做——" +
      `把那段提醒的原文一字不改寫進 ${resultFile} 就好。`,
    // 兩支腳本的措辭不一樣，而且 codex 在測試模式下的句子裡根本沒有「Context 已用」
    // ——它寫的是「測試模式：Context 以小視窗 5000 計算」。實測就是卡在這：hook 有
    // 觸發、模型也把原文寫進檔案了，只有比對用的關鍵字對不上。
    expect: ({ agent }) => ({
      kind: "artifact",
      keyword: agent === "codex" ? "[context-monitor]" : "Context 已用",
    }),
    watchFor: "畫面上出現 context 用量警告（標著「（測試模式）」）",
  },
};

function parseArgs(argv) {
  const args = {};

  for (const entry of argv) {
    const match = entry.match(/^--([^=]+)=(.*)$/);

    if (match !== null) {
      args[match[1]] = match[2];
    }
  }

  return args;
}

const args = parseArgs(process.argv.slice(2));
const caseName = args.case ?? "naming";
const testCase = CASES[caseName];
const agent = args.agent === "codex" ? "codex" : "claude";

if (testCase === undefined) {
  console.log(`FAIL  不認得的驗證情境：${caseName}`);
  process.exit(1);
}

mkdirSync(RESULT_DIR, { recursive: true });
const resultFile = path.join(RESULT_DIR, `${caseName}-${agent}.txt`);
// 上一輪的副產物留著的話，這一輪不管跑不跑都會「通過」。
rmSync(resultFile, { force: true });

const expect = testCase.expect({ agent });
const namesDir = path.join(homedir(), ".claude", "session-names");
const startedAt = Date.now();

// 腳本寫成檔案再交給終端跑：把整段指令塞進終端的參數裡，引號與換行會被各平台的
// 命令列各自重新解讀一次，中文和 && 都會被吃掉（前面踩過）。
// 標題測試不叫 agent，改成起 watcher 再餵它一個名字。
function titleScript() {
  const name = "🔍 標題同步測試";

  if (process.platform === "win32") {
    // 參數用陣列傳，不要拼成一個字串。拼字串的話 PowerShell 會再解讀一次引號，
    // 而 JS 的 \" 在 .ps1 檔裡是「反斜線加引號」不是跳脫（PowerShell 用反引號）——
    // 字串提早結束，路徑全變成位置參數（VM 實測：Start-Process 直接報錯）。
    return [
      "$watcher = Join-Path $HOME '.jr-setup\\bin\\ai-tab-sync.ps1'",
      "$sync = Join-Path $env:TEMP \"jr-title-$PID.txt\"",
      `Set-Content -Path $sync -Value '${name}' -Encoding UTF8`,
      "$w = Start-Process powershell.exe -ArgumentList @('-NoProfile','-File',$watcher,$sync,\"$PID\") -NoNewWindow -PassThru",
      "Start-Sleep -Seconds 5",
      "if ($w) { Stop-Process -Id $w.Id -Force -ErrorAction SilentlyContinue }",
      "Remove-Item $sync -Force -ErrorAction SilentlyContinue",
      "Write-Host '標題測試結束——剛才那五秒分頁標題有變嗎？'",
    ].join("\n");
  }

  return [
    'sync="$(mktemp)"',
    `printf '%s\\n' '${name}' > "$sync"`,
    '"$HOME/.local/bin/ai-tab-sync.sh" "$sync" "$(tty)" &',
    "watcher=$!",
    "sleep 5",
    'kill "$watcher" 2>/dev/null',
    'rm -f "$sync"',
    'echo "標題測試結束——剛才那五秒分頁標題有變嗎？"',
  ].join("\n");
}

function writeLauncher(prompt) {
  const stamp = `${process.pid}-${Date.now()}`;
  const envLines = Object.entries(testCase.env({ agent }));
  const body = caseName === "title" ? titleScript() : `${agent} '${prompt}'`;

  if (process.platform === "win32") {
    const file = path.join(tmpdir(), `jr-verify-${stamp}.ps1`);
    const setEnv = envLines
      .map(([name, value]) => `$env:${name} = '${value}'`)
      .join("\n");
    // 不加 -NoProfile：wrapper 就住在 profile 裡，跳過它等於沒在驗。
    writeFileSync(file, `\ufeff${setEnv}\n${body}\n`, "utf8");
    return file;
  }

  const file = path.join(tmpdir(), `jr-verify-${stamp}.command`);
  const setEnv = envLines
    .map(([name, value]) => `export ${name}='${value}'`)
    .join("\n");
  // -i 讓 zsh 讀 ~/.zshrc，wrapper 才會存在。
  writeFileSync(file, `#!/bin/zsh -i\n${setEnv}\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

function openTerminal(launcher) {
  if (process.platform === "win32") {
    return {
      cmd: "cmd.exe",
      args: [
        "/c",
        "start",
        "",
        "wt.exe",
        "powershell.exe",
        "-NoExit",
        "-File",
        launcher,
      ],
    };
  }

  return { cmd: "open", args: [launcher] };
}

// 副產物出現了嗎？出現就回傳判定過的證據，還沒有就回 null。
function collectEvidence() {
  if (expect.kind === "artifact") {
    let text = "";

    try {
      text = readFileSync(resultFile, "utf8");
    } catch {
      return null;
    }

    return text.includes(expect.keyword)
      ? { detail: `副產物裡有 hook 的原文：「${expect.keyword}」` }
      : null;
  }

  // session-name：hook 真的跑完才會出現的檔案，跟模型說什麼無關。
  let entries = [];

  try {
    entries = readdirSync(namesDir);
  } catch {
    return null;
  }

  for (const name of entries) {
    const file = path.join(namesDir, name);

    try {
      if (statSync(file).mtimeMs < startedAt) continue;
      const value = readFileSync(file, "utf8").trim();
      if (value) return { detail: `hook 寫下了名字：${value}` };
    } catch {
      // 剛好被改寫到一半，下一輪再看。
    }
  }

  return null;
}

const launcher = writeLauncher(testCase.prompt({ agent, resultFile }));
const { cmd, args: openArgs } = openTerminal(launcher);
const child = spawn(cmd, openArgs, { stdio: "ignore", detached: true });
child.unref();

console.log(`已開啟一個新的終端視窗，正在跑「${testCase.label}」驗證。`);
console.log("");
console.log("請看那個視窗，你不需要輸入任何東西：");
console.log(`  ▸ ${testCase.watchFor}`);
console.log("");

if (expect === null) {
  console.log("這個情境沒有程式抓得到的副產物，看到了就回來把勾選框勾起來。");
  console.log(`（視窗跑完可以直接關掉。啟動腳本：${launcher}）`);
  process.exit(0);
}

console.log("同時我在等副產物出現，出現就自動判定，你不用手動勾。");

while (Date.now() - startedAt < TIMEOUT_MS) {
  const evidence = collectEvidence();

  if (evidence !== null) {
    console.log("");
    console.log(`PASS  ${evidence.detail}`);
    process.exit(0);
  }

  await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
}

console.log("");
console.log("無法確認  等了四分鐘，沒等到證據。");
console.log(
  expect.kind === "artifact"
    ? `      應該要出現在：${resultFile}（而且內容含「${expect.keyword}」）`
    : `      應該要有新檔案出現在：${namesDir}`,
);
console.log("      看那個視窗裡模型說了什麼，判斷是 hook 沒觸發還是模型沒照做。");
process.exit(1);
