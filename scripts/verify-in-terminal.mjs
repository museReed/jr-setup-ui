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

import { materialsDir, verifyShotPath } from "../src/paths.js";

const POLL_INTERVAL_MS = 1_000;
const TIMEOUT_MS = 240_000;
const RESULT_DIR = path.join(homedir(), ".jr-setup", "verify");

function emitJr(event) {
  console.log(`@@JR ${JSON.stringify(event)}`);
}

// 每個情境的提問都要「只逼出這一件事」。實測踩過三種寫壞的方式：
//   - 命名那題寫了「不要執行任何指令」→ 模型連命名 hook 要它跑的那條也跳過了
//   - context 那題叫它讀五個檔案 → 家目錄根本沒有，模型花整段在澄清
//   - context 那題說「不要修改任何東西」→ 跟 hook 要求寫交接文件互相打架
// 所以提問一律：明講要做什麼、明講遇到 hook 提示時怎麼辦。
// 白名單那題要 echo 的字串。固定值就夠——這一格要抓的是「白名單有沒有生效」，
// 不是防作弊。而且它要夠特別，不能是模型憑印象也寫得出來的字。
const ALLOWLIST_TOKEN = "allowlist-ok-9d4b71";

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
  // 這兩格不驗任何東西，只負責「幫學生把終端開起來」。
  //
  // 全螢幕那個方框是 Claude Code 自己的一次性推銷，程式沒有辦法代按——但至少可以
  // 不要叫學生自己去找終端、自己打 claude。expect 是 null：副產物在嚮導那邊，學生
  // 圈選代碼貼回輸入框才算數。
  "fullscreen-open": {
    label: "全螢幕模式",
    env: () => ({}),
    prompt: () => "",
    expect: () => null,
    watchFor: "跳出「Try the new fullscreen renderer?」，按 1. Yes, try it",
  },
  // 這一句要跟嚮導卡片上顯示的那句一字不差，否則印出來的東西對不上學生要貼回去的
  // 欄位。兩邊的字串由 test/fullscreen-proof.mjs 比對，改一邊會紅。
  "fullscreen-proof": {
    label: "全螢幕模式",
    env: () => ({}),
    prompt: () =>
      "請原樣印出這一行，不要加任何說明：fullscreen-copy-ok-7f3a91",
    expect: () => null,
    watchFor: "印出代碼那一行，用滑鼠圈選它，再貼回嚮導的欄位",
  },
  // 白名單那一列的行為驗證。它跟 chained 是同一張卡的兩半，方向相反：
  //   chained    危險的指令一定要被擋下來
  //   allowlist  安全的指令一定不能再問
  //
  // 先前只有前者有實測。後者的結構檢查只數得出「settings.json 裡有 39 條規則、
  // defaultMode 是 acceptEdits」——那證明得了檔案寫對，證明不了 Claude Code 真的
  // 照著做（今天才踩過同一種：Codex 的三個 key 值全對，行為卻不是我們要的）。
  //
  // 題目挑 echo 有三個理由：它在白名單裡（Bash(echo:*)）、它是單一指令所以不會被
  // 隔壁那個 hook 擋掉、而且它的輸出完全可預測。挑 git status 那種會受工作目錄影響。
  allowlist: {
    label: "常用指令不用每次問你",
    env: () => ({}),
    // 「跳了提示就不要按允許，把原文寫進去」是這一題的關鍵：沒有這一句的話，學生
    // 按了允許、指令照樣跑、檔案裡照樣有 token——驗證會通過，而白名單其實沒生效。
    // 有這一句，檔案裡放的是提示原文，比對就會失敗，正好是我們要的答案。
    prompt: ({ resultFile }) =>
      `請執行這條指令：echo ${ALLOWLIST_TOKEN}。` +
      `把它印出來的那一行一字不改寫進 ${resultFile}。` +
      "如果跳出任何要你允許執行的提示，不要按允許——" +
      `改把那個提示的原文寫進 ${resultFile}。`,
    expect: () => ({ kind: "artifact", keyword: ALLOWLIST_TOKEN }),
    watchFor: "指令直接跑掉，沒有跳出任何「要不要允許」的詢問",
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
  // 以下三個驗的是 skill，不是 hook。判準沒變：要嘛有只有 skill 跑過才會出現的
  // 副產物，要嘛就老實交給人眼。
  //
  // ⚠️ skill 是「開新 session 才會載入」的東西，所以這裡開的是真終端跑互動式
  //    session——headless 的 -p 連 wrapper 都不經過，skill 目錄也不一定掃得到。
  //
  // ⚠️ 兩邊叫 skill 的方式不一樣。Codex 的 SKILL.md 標了 user-invocable，要用
  //    `$名字` 才會真的載入；只寫「請使用 handoff skill」它會當成一般描述，自己
  //    憑印象寫一份交出來——文件長得像、SKILL.md 裡的步驟一個都沒跑（mac VM 實測：
  //    交接檔有、改名整段沒提，/tmp 也沒有任何 relay 檔）。
  "skill-rename": {
    label: "Skill：自動命名",
    env: () => ({}),
    prompt: ({ agent, resultFile }) =>
      agent === "codex"
        ? "$auto-rename 請照這個 skill 的 SKILL.md 步驟幫這個 session 命名。" +
          "命名完之後再列出目前資料夾裡的檔案——這一步是必要的，讓 hook 有機會把名字套用上去。" +
          `最後把你取的名字寫進 ${resultFile}。`
        : "請使用 auto-rename skill 幫這個 session 命名，照它 SKILL.md 裡寫的指令執行。",
    // Claude 那支 skill 會叫模型執行寫檔指令，檔案就是證據；Codex 寫的是 sqlite
    // 與中繼檔，沒有能穩定輪詢的落點，維持人眼判定（跟命名 hook 那列同一個理由）。
    expect: ({ agent }) => (agent === "codex" ? null : { kind: "session-name" }),
    watchFor: "模型說它用了 auto-rename skill，分頁標題跟著變成「{emoji} 中文敘述」",
  },
  "skill-handoff": {
    label: "Skill：交接文件",
    env: () => ({}),
    // 刻意不讓它走 skill 預設的 docs/handoff/ 落點：那要在 git repo 裡才成立，
    // 學生的家目錄不是。改指定檔案路徑，內容照 skill 的格式寫。
    // ⚠️ 只說「不要 commit、不要寫進 docs/」的話，模型會把整段收尾都當成「這次不用
    //    做」一起跳過——VM 實測它自己回報「依用戶指示偏離 skill 預設流程三處」，
    //    改名那步就這樣沒了，看起來像 skill 壞掉。要跳過的步驟逐條講，要做的也逐條講。
    prompt: ({ agent, resultFile }) =>
      (agent === "codex"
        ? "$handoff 請照這個 skill 產出這個 session 的交接文件。"
        : "請使用 handoff skill 產出這個 session 的交接文件。") +
      `這一輪有兩件事要做完：（1）不要 commit、不要寫進 docs/，把整份文件內容寫進 ${resultFile}，章節標題照 skill 規定的寫；` +
      "（2）照 skill 最後一步把這個 session 改名，執行它給你的那條改名指令，不要跳過。" +
      // Codex 的改名是兩段式：模型先把名字寫進中繼檔，要等「下一次 hook 事件」才
      // 套上去。一問一答就結束的話名字永遠卡在中繼檔——skill-rename 那格早就補了
      // 這一步，這裡漏掉，於是 Codex 的交接檔寫得出來、標題卻不動（VM 實測）。
      (agent === "codex"
        ? "改名完之後，再列出目前資料夾裡的檔案——這一步是必要的，讓 hook 有機會把名字套用上去。"
        : ""),
    // 「必讀檔案」是 SKILL.md 規定的章節名。模型沒讀到 skill 的話不會自己想到這四個字，
    // 所以它出現＝skill 真的被載入了。
    expect: () => ({ kind: "artifact", keyword: "必讀檔案" }),
    watchFor:
      "模型產出一份有「狀態摘要 / 必讀檔案 / 下一步」的文件，收尾把分頁標題改成「📦 ...」",
  },
  // 一條龍 demo：把三個 skill 串起來跑一次（問配色 → 生成網頁 → 逐字打 code）。
  // 它不是「驗證某一格」而是「現場展示」，但判定一樣要證據——產出的網頁檔只有三段
  // 都真的跑完才會出現，模型嘴上說「已完成」是生不出檔案的。
  //
  // 這一格要人回答問題，所以等的時間比其他格長很多（其他格是模型自己跑完就結束）。
  demo: {
    label: "一條龍 demo",
    env: () => ({}),
    // 30 分鐘。實測 15 分鐘不夠：這一格是整條 demo——問四題、生一份完整網頁、再產
    // 出自走版，中間還夾著學生自己回答問題的時間。逾時判失敗的代價很高：東西可能
    // 只差最後一步就好了，學生卻看到紅字。
    timeoutMs: 1_800_000,
    needsAnswer: true,
    // ⚠️ 第 3 步的路徑在 prompt 裡寫的是上游 repo 的位置（installer/demo/），學生
    //    機器上沒有那個 repo——不覆蓋掉的話每個人都會卡在那裡先 find 一輪（VM 實測，
    //    模型自己指出來的）。而且嚮導內建的是自走版：產出的頁面打開就自己演，
    //    不需要 python playwright + chromium，現場少兩個安裝步驟。
    prompt: ({ agent }) => {
      const demoDir = path.join(materialsDir(), "skills", "demo");

      return (
        (agent === "codex" ? "$structured-questions " : "") +
        `請讀 ${path.join(demoDir, `demo-prompt-${agent}.md`)}，照裡面的步驟執行這條一條龍 demo。` +
        "第 3 步不要用 prompt 裡寫的那支腳本（那是另一個 repo 的路徑，這台機器上沒有），" +
        // Windows 上叫 python3 會撞到 Store 的殼（python.org 的安裝檔不產生
        // python3.exe），要用 py -3 那個啟動器。
        `改用這支自走版：${process.platform === "win32" ? "py -3" : "python3"} ${path.join(demoDir, "live-preview-self", "self_play.py")} ~/demo-page.html，` +
        "它只用標準函式庫、不需要安裝任何東西，跑完把產出的檔案用瀏覽器打開就會自己演。" +
        "第 1、2 步不要開瀏覽器、也不要用 Playwright 預覽或截圖——只有第 3 步最後" +
        "那次才開，那一次是要給人看的。" +
        "先執行第 1 步。"
      );
    },
    expect: () => ({
      kind: "file",
      file: path.join(homedir(), "demo-page.html"),
    }),
    watchFor:
      "跳出選項讓你選（網頁類型 / 主色調 / 風格 / 字體），回答完會生成網頁，最後逐字打 code 現場長出來",
  },
  // Playwright MCP 這格的證據力比其他格都高：要求存一張截圖。
  //
  // 頁面標題那種東西模型自己就答得出來（"Google" 誰不知道），寫進檔案只證明它會
  // 打字。截圖檔不一樣——那個檔案要存在，就得真的有一顆瀏覽器被開起來、真的導到
  // 那個網址、真的截了圖。MCP 沒接上就生不出來。
  "mcp-playwright": {
    label: "第三方：Playwright",
    env: () => ({}),
    // 兩邊的機制不一樣：Claude 走 MCP server，Codex 走 openai/skills 的 playwright
    // skill。講錯名字模型會去找一個不存在的東西，然後回報「找不到」。
    // 網址挑 Pinterest：截出來是一整片圖牆，學生一眼就知道「這台機器真的去抓了
    // 網頁回來」。Google 首頁截出來只有一個搜尋框，跟一張空白圖分不出差別。
    prompt: ({ agent }) =>
      (agent === "codex"
        ? "請用 playwright skill 開啟 https://www.pinterest.com ，"
        : "請用 Playwright MCP 開啟 https://www.pinterest.com ，") +
      "等頁面圖片載入完成後（可以多等幾秒）" +
      `把整頁截圖存成 ${verifyShotPath(agent)}。` +
      "只做這件事，不要問我問題，存好就結束。",
    expect: ({ agent }) => ({ kind: "file", file: verifyShotPath(agent) }),
    // 15 分鐘，跟 demo 同一檔。實測 codex 那次跑了 4m29s、成功寫出檔案，卻被預設
    // 的 4 分鐘判成失敗——第一次跑要下載瀏覽器，四分鐘完全不夠。判失敗的代價很高：
    // 東西明明是好的，學生卻被推去查一個不存在的問題。
    timeoutMs: 900_000,
    watchFor: "跳出一個瀏覽器視窗、自己連到 Pinterest，畫面長出一整片圖",
  },
  "skill-questions": {
    label: "Skill：結構化提問",
    env: () => ({}),
    // 這支唯一的證據是「畫面上跳出選項讓人選」。要它同時寫個副產物也沒用——寫了
    // 只證明模型讀得到 skill，證明不了它真的用了提問 UI，那正是這一格要驗的事。
    prompt: ({ agent }) =>
      (agent === "codex" ? "$structured-questions " : "") +
      "我想幫這台電腦選一個終端機工具，但我不知道要選哪個。" +
      "請使用 structured-questions skill 問我，讓我用選的。",
    expect: () => null,
    watchFor: "畫面跳出一組可以上下選的選項（不是把選項寫成文字要你打字回答）",
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
  emitJr({
    kind: "result",
    ok: false,
    summary: `不認得的驗證情境：${caseName}`,
  });
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
      "$w = Start-Process powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$watcher,$sync,\"$PID\") -NoNewWindow -PassThru",
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
        // 我們自己寫出來的臨時腳本，不該看機器的執行原則臉色。Windows 預設是
        // Restricted，新開的視窗會直接紅字「running scripts is disabled」，而嚮導這
        // 邊看到的 exit code 還是 0——因為 cmd start 一開完就回來了（VM 實測）。
        //
        // Bypass 只影響這一個行程，不動機器設定。順帶把 profile 也救回來：Restricted
        // 連 profile 都不載入，wrapper 就住在裡面，不載入等於整個標題同步沒在驗。
        "-ExecutionPolicy",
        "Bypass",
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

  // file：指定的那個檔案有沒有在這一輪被寫出來。demo 用它——模型嘴上說「已完成」
  // 是生不出網頁檔的。
  if (expect.kind === "file") {
    try {
      return statSync(expect.file).mtimeMs >= startedAt
        ? { detail: `產出了 ${expect.file}` }
        : null;
    } catch {
      return null;
    }
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
emitJr({
  kind: "stage",
  stage: caseName === "demo" ? "shaping" : "waiting",
});
console.log("");
// demo 是唯一要人動手的情境（選項要你選），其他格一律「看就好」——寫錯這句學生
// 會乾等，以為卡住了。
console.log(
  testCase.needsAnswer === true
    ? "請到那個視窗回答它的問題："
    : "請看那個視窗，你不需要輸入任何東西：",
);
console.log(`  ▸ ${testCase.watchFor}`);
console.log("");

if (expect === null) {
  console.log("這個情境沒有程式抓得到的副產物，看到了就回來把勾選框勾起來。");
  console.log(`（視窗跑完可以直接關掉。啟動腳本：${launcher}）`);
  emitJr({
    kind: "result",
    ok: true,
    summary: "已開啟終端視窗，請人工確認。",
  });
  process.exit(0);
}

console.log("同時我在等副產物出現，出現就自動判定，你不用手動勾。");

// demo 那格要人回答問題，等的時間比其他格長很多——其他格是模型自己跑完就結束。
const timeoutMs = testCase.timeoutMs ?? TIMEOUT_MS;

while (Date.now() - startedAt < timeoutMs) {
  const evidence = collectEvidence();

  if (evidence !== null) {
    console.log("");
    console.log(`PASS  ${evidence.detail}`);
    emitJr({
      kind: "result",
      ok: true,
      summary: `驗證通過：${evidence.detail}`,
    });
    process.exit(0);
  }

  await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
}

console.log("");
console.log(`無法確認  等了 ${Math.round(timeoutMs / 60_000)} 分鐘，沒等到證據。`);
console.log(
  expect.kind === "artifact"
    ? `      應該要出現在：${resultFile}（而且內容含「${expect.keyword}」）`
    : expect.kind === "file"
      ? `      應該要產出：${expect.file}`
      : `      應該要有新檔案出現在：${namesDir}`,
);
console.log("      看那個視窗裡模型說了什麼，判斷是 hook 沒觸發還是模型沒照做。");
emitJr({
  kind: "result",
  ok: false,
  summary: "等待副產物逾時，無法確認。",
});
process.exit(1);
