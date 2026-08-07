// 規則檔的安裝狀態：跟環境檢查同一個模式——一列一項，紅的給按鈕。
// 判斷依據是「真的生效了嗎」，不是「指令有沒有跑完」。
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import {
  applySubstitutions,
  CLAUDE_DEFAULT_MODE,
  CLAUDE_HUD,
  OBSIDIAN_GIT,
  CODEX_MODE_EXPECTATIONS,
  countInstalledRules,
  describeStep,
  expandAllowRules,
  findHookRegistration,
  hasAgentHookRegistrations,
  hasMarkedBlock,
  readCodexModes,
  readDefaultMode,
  readRetiredCodexKeys,
  stepsForTools,
} from "./config-install.js";
import { spawnEnv } from "./env-path.js";
import { materialsDir } from "./paths.js";

const HOME = homedir();

async function readJsonOrNull(target) {
  if (!existsSync(target)) {
    return null;
  }

  try {
    return JSON.parse(await readFile(target, "utf8"));
  } catch {
    return null;
  }
}

async function sameAsSource(materials, step) {
  const source = path.join(materials, step.source);

  if (!existsSync(source) || !existsSync(step.target)) {
    return false;
  }

  const [a, b] = await Promise.all([
    readFile(source, "utf8"),
    readFile(step.target, "utf8"),
  ]);
  return a === b;
}

// protectExisting 的列（CLAUDE.md、config.toml）不能用逐字相同當作「完成」。
//
// 那些檔案的正常狀態就是「工作坊的內容 + 學生自己的內容」——只要他有自己的
// [projects]、自己的規則，逐字比對永遠不會相同。實測：學生按了「用 AI 合併」，
// 工作坊那段確實整段併進去了，列上還是寫「需要合併」，再按幾次都一樣。那張卡
// 因此永遠完成不了，整段跟著鎖死。
//
// 改成問「工作坊那段在不在」：範本裡每一行實質內容都要出現在目標檔案裡。學生
// 自己加的東西不影響，因為只檢查有沒有，不檢查有沒有多。
//
// TOML 的 # 是註解，可以不算；Markdown 的 # 是標題，是實質內容，不能丟。
async function containsSourceContent(materials, step) {
  const source = path.join(materials, step.source);

  if (!existsSync(source) || !existsSync(step.target)) {
    return false;
  }

  const [sourceText, targetText] = await Promise.all([
    readFile(source, "utf8"),
    readFile(step.target, "utf8"),
  ]);
  const isToml = step.target.endsWith(".toml");
  const required = sourceText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !(isToml && line.startsWith("#")));

  if (required.length === 0) {
    return false;
  }

  const targetLines = new Set(
    targetText.split("\n").map((line) => line.trim()),
  );
  return required.every((line) => targetLines.has(line));
}

// 「檔案在」不等於「檔案是對的」。hook 與 watcher 的內容改過之後，已經裝過的人
// 手上是舊版——嚮導若只看存在與否，會告訴他一切正常。這輪五個斷點的修正全都落在
// 這些檔案裡，所以逐字比對是必要的。
async function staleTargets(materials, files) {
  const stale = [];

  for (const file of files) {
    const source = path.join(materials, file.source);

    // 材料本身缺了是我們的問題，不是學生的——不要報成他裝錯。
    if (!existsSync(source) || !existsSync(file.target)) {
      continue;
    }

    const [expected, actual] = await Promise.all([
      readFile(source, "utf8"),
      readFile(file.target, "utf8"),
    ]);

    if (expected !== actual) {
      stale.push(file.target);
    }
  }

  return stale;
}

// 檔案對了不代表模式對了。
//
// config.toml 是 protectExisting 的：學生已經有檔案時我們只補缺的 key，已經有值的
// 一律不動（那是他的選擇）。於是「檔案已併入工作坊設定」可以是綠的，而 Codex 實際
// 跑的是他原本那個值——卡片全綠、行為卻不是我們教的那樣（VM 實測就是這條：三個
// 模式 key 從來沒有人回頭確認過）。
//
// 「沒設」與「設成別的值」分開講：前者是安裝沒生效，後者是他自己調過，兩種要做的
// 事不一樣。
async function codexModeIssues(step) {
  const content = await readFile(step.target, "utf8");
  const found = readCodexModes(content);
  // 舊 key 跟 default_permissions 並存時 Codex 的行為沒有定義，而畫面上看不出來
  // ——舊的靜靜讓新的失效，VM 實測就是這樣：權限選單停在 Read Only。
  const stale = readRetiredCodexKeys(content);
  const missing = [];
  const differs = [];

  for (const [key, expected] of Object.entries(CODEX_MODE_EXPECTATIONS)) {
    if (found[key] === null) {
      missing.push(key);
    } else if (found[key] !== expected) {
      differs.push(`${key} = "${found[key]}"`);
    }
  }

  return { missing, differs, stale };
}

// 模式檢查只降級、不搶話：檔案層先講完（沒裝、需要合併、內容是舊版），都通過了才
// 輪到它。反過來的話，一個「只有學生自己內容」的檔案會被講成「少了三個 key」，
// 而他真正該做的是按「用 AI 合併」。
export async function checkCopyStep(materials, step) {
  const result = await copyStepResult(materials, step);

  if (step.mergeModes !== true || result.status !== "ok") {
    return result;
  }

  const { missing, differs, stale } = await codexModeIssues(step);

  // 舊 key 排在最前面：它在的時候，底下那兩種判斷得到的結論都不算數——新的那個
  // key 就算值是對的也沒生效。
  if (stale.length > 0) {
    return {
      ...result,
      status: "warn",
      detail: `${result.detail}，但舊的 ${stale.join("、")} 還在，會讓新設定失效——重跑安裝會把它停用`,
    };
  }

  if (missing.length > 0) {
    return {
      ...result,
      status: "warn",
      detail: `${result.detail}，但少了 ${missing.join("、")}，重跑安裝就會補上`,
    };
  }

  if (differs.length > 0) {
    return {
      ...result,
      status: "warn",
      // 不叫他重裝：重裝也不會覆蓋他自己設過的值（安裝那條刻意尊重他的選擇），
      // 叫了只是白按一次。
      detail: `${result.detail}，但你自己設過 ${differs.join("、")}`,
    };
  }

  return result;
}

async function copyStepResult(materials, step) {
  if (!existsSync(step.target)) {
    return {
      id: step.id,
      label: step.label,
      status: "missing",
      detail: "尚未安裝",
    };
  }

  const matches = await sameAsSource(materials, step);

  // 已存在但內容不是我們發的：那是使用者自己寫的，蓋掉會弄丟，要合併。
  // 但先問一句「工作坊那段是不是已經在裡面了」——併過的人不該被叫回去再併一次。
  if (step.protectExisting === true && !matches) {
    if (await containsSourceContent(materials, step)) {
      return {
        id: step.id,
        label: step.label,
        status: "ok",
        detail: "已併入工作坊設定，你自己的內容也還在",
      };
    }

    return {
      id: step.id,
      label: step.label,
      status: "warn",
      detail: "已有你自己的版本，需要合併",
      needsMerge: true,
    };
  }

  // 只看檔案在不在不夠：複製到一半中斷、或檔案是空的，一樣會「存在」。
  // 逐字比對才知道裝進去的真的是這一版。
  if (!matches) {
    return {
      id: step.id,
      label: step.label,
      status: "warn",
      detail: "檔案在，但內容跟這一版不同",
    };
  }

  return { id: step.id, label: step.label, status: "ok", detail: "已安裝" };
}

// 每一列除了「結構齊全」還要驗什麼，見 docs/wizard-verification-design.md。
// behavior = 程式跑得出結果的行為驗證；eye = 只有真終端看得到、得由學生回報。
// 兩者都沒有的列（例如白名單）結構對了就是真的對了，直接綠燈。
export const VERIFICATION = {
  // 一個 agent 只做一次行為驗證。
  //
  // 格式規則在兩份檔案裡各有一份（Claude：CLAUDE.md 與 output-style；Codex：
  // AGENTS.md 與 config.toml 的 instructions），所以原本那四列跑的是同一個測試
  // ——同一題、同一組判準，只是各燒一次 API。行為驗證是整份嚮導最慢最貴的一步
  // （每次兩趟 LLM：先問一題，再把回答餵回去逐條判定）。
  //
  // 留哪一列的判準不是「誰重要」而是「誰會靜默失效」：
  //   CLAUDE.md / AGENTS.md  放著就讀，結構對＝生效，沒有中間狀態
  //   output-style           要 settings.json 的 outputStyle 啟用，沒啟用不會報錯
  //   config.toml            要 Codex 讀到那個 instructions，同樣不會報錯
  // 所以行為驗證掛在有開關的那兩列。
  //
  // 代價：學生若只裝了 CLAUDE.md 沒裝 output-style，那個 agent 就沒有行為驗證。
  // 可接受——那時 output-style 那列本身還沒綠，摘要不會全綠，人會被推去裝。
  //
  // tools 綁死在列上：按 codex 那列的驗證卻連 claude 一起跑，慢一倍不說，claude
  // 失敗還會把 codex 那列判成紅的。
  "output-style": { behavior: "verify-behavior", options: { tools: "claude" } },
  // 底部那條狀態列是純畫面：設定寫對了但沒重開 Codex，那條還是舊的，而檔案比對
  // 一路都是綠的。所以配一格眼睛（跟 tab-sync 的分頁標題同一個判準）。
  "codex-config": {
    behavior: "verify-behavior",
    options: { tools: "codex" },
    eye: "Codex 視窗最下面那一條有四段：用掉多少、哪個模型、哪個資料夾、這週還剩多少",
  },
  // 有副產物可抓的情境不給勾選框：程式判定得了就不該問學生。
  hook: { terminal: { case: "chained", agent: "claude" } },
  // 同一張卡的另一半。這兩格方向相反但驗的是同一套規矩：危險的指令一定擋下來，
  // 安全的指令一定不再問。
  //
  // 先前只有「擋」有實測。「不問」那半的結構檢查只數得出「39 條規則、defaultMode
  // 是 acceptEdits」——那證明得了檔案寫對，證明不了 Claude Code 真的照著做。今天
  // 才踩過同一種：Codex 的三個模式 key 值全對，行為卻不是我們要的。
  //
  // 原本配一格眼睛（「指令直接跑掉，沒有跳出詢問」）。拿掉了（Reed 拍板）：那一格
  // 問的事情，行為驗證的題目裡本來就要模型自己回報一次，學生等於被問了兩遍同一題。
  //
  // 代價要講清楚：現在「有沒有跳詢問」完全靠模型自我回報，沒有第二道人眼把關。這條
  // 記在 handoff 的已知問題裡——真要有副產物得改 headless 從事件流找證據。
  allowlist: {
    terminal: { case: "allowlist", agent: "claude" },
  },
  // 第三方 skill 一律只認落點在不在（那是別人的東西，我們不比對內容），唯獨 MCP
  // 這一格例外：它的落點只是 settings.json 裡多一行設定，那一行寫對了、npx 卻拉不
  // 到套件、瀏覽器沒裝起來，畫面上一樣是綠的。而學生要到 demo 段才會發現它是死的。
  //
  // 截圖檔是這整份嚮導證據力最高的副產物：那個檔案要存在，就得真的有一顆瀏覽器被
  // 開起來、真的導到那個網址、真的截了圖。模型編不出一個 PNG。
  "ext-playwright-claude": {
    terminal: { case: "mcp-playwright", agent: "claude" },
  },
  "ext-playwright-codex": {
    terminal: { case: "mcp-playwright", agent: "codex" },
  },
  // 這兩列的證據在 GitHub 上，不在這台機器上——嚮導看不到學生的瀏覽器，所以
  // 是眼睛項。程式那半（terminal）負責把終端開起來、把話送進去。
  "vault-agent-claude": {
    terminal: { case: "vault-note", agent: "claude" },
    eye: "GitHub 的改動歷史上，最上面那一行是你剛才選的那句話",
  },
  "vault-agent-codex": {
    terminal: { case: "vault-note", agent: "codex" },
    eye: "GitHub 的改動歷史上，最上面那一行是你剛才選的那句話",
  },
  // 程式驗得到「設定寫對了」，驗不到「Obsidian 打開之後真的會自己拉」——那要有人
  // 把 app 打開看左邊那排圖示。所以這一格配一格眼睛，按鈕幫他把 Obsidian 開起來。
  "obsidian-vault": {
    terminal: { case: "open-vault", agent: "claude" },
    eye: "Obsidian 左邊最下面多一個分岔圖示，右下角有一個打勾",
  },
  // 設定檔對了不代表學生看得到那一條——HUD 只在「下一次互動之後」才畫出來。
  // 所以這一格開一個真的 Claude、送一句話進去，剩下的交給眼睛。
  "claude-hud": {
    terminal: { case: "statusline", agent: "claude" },
    eye: "輸入框下面多出一行，裡面有模型名、一條進度條、專案名",
  },
  // 這一格不叫 AI：要驗的是 watcher 有沒有把名字放上分頁標題，跟模型無關。
  "tab-sync": {
    terminal: { case: "title", agent: "claude" },
    eye: "那個視窗的分頁標題變成「🔍 標題同步測試」",
  },
  // 程式驗得到的是「名字有沒有被產生」（hook 會寫檔），不是「標題有沒有變」。
  // 這兩件事會分岔——VM 實測：名字寫出來了，但 watcher 沒掛上，標題一直是預設值。
  // 卡片對學生的承諾是「你的分頁會自動命名」，所以標題那一半要有人看。
  // 驗收文件的「眼睛的」那節本來就要求看這個，是嚮導漏了問。
  "claude-namer": {
    terminal: { case: "naming", agent: "claude" },
    eye: "那個視窗的分頁標題變成「{emoji} 中文敘述」",
  },
  "claude-monitor": { terminal: { case: "context", agent: "claude" } },
  "codex-namer": {
    terminal: { case: "naming", agent: "codex" },
    eye: "那個視窗的分頁標題變成命名（第一次會問你要不要信任 hook，要接受）",
  },
  // codex-monitor 的行為驗證加回來了（Reed 決定），跟 claude-monitor 對稱。
  //
  // 它曾經被拿掉，理由記在這裡免得又被同一條路說服：一是重疊——這一格唯一抓得到的
  // 失敗是「hook 註冊了但沒真的跑」，而那個失敗 codex-namer 一定也會踩到；二是它兩
  // 次 VM 實測都誤判。
  //
  // 但那兩次誤判的原因後來都查出來也修好了：一次是測試開關的環境變數名字兩邊不一樣
  //（CODEX_TEST_MAX_CONTEXT_WINDOW），一次是比對的關鍵字對不上 codex 測試模式下的
  // 句子（改成比對 [context-monitor]）。兩者都由 test/verify-in-terminal.mjs 釘住。
  //
  // 代價仍在：多跑一分多鐘、多一筆 API。換到的是「兩邊卡片一致」——學生不會看到
  // Claude 那張要驗、Codex 這張不用，然後懷疑是不是壞了（Reed 實測就是這樣問的）。
  //
  // 如果它又開始誤判，先查上面那兩個對不上，不要直接再拿掉一次。
  "codex-monitor": { terminal: { case: "context", agent: "codex" } },
  //
  // 沒有 behavior 也沒有 terminal 的列不寫進這張表（白名單也是），結構對了就直接
  // 綠燈——留一個空物件會讓它仍被當成「要按 verify-in-terminal」，參數卻是空的。
  // skill 的行為驗證跟 hook 同一個判準：要嘛留下只有 skill 跑過才會有的副產物，
  // 要嘛就老實承認驗不到、交給學生看。
  // 同上：這支 skill 的成果就是「標題變了」，程式只驗得到名字有沒有落地。
  "skill-claude-auto-rename": {
    terminal: { case: "skill-rename", agent: "claude" },
    eye: "那個視窗的分頁標題變成「{emoji} 中文敘述」",
  },
  "skill-codex-auto-rename": {
    terminal: { case: "skill-rename", agent: "codex" },
    eye: "那個視窗的分頁標題變成「{emoji} 中文敘述」",
  },
  // 文件本身自動判定得了（章節名比對），但收尾的改名只有終端看得到——那一步是
  // 整支 skill 最容易靜靜失敗的地方（指令被 hook 擋下也不會有人說），所以配一格眼睛。
  "skill-claude-handoff": {
    terminal: { case: "skill-handoff", agent: "claude" },
    eye: "那個視窗的分頁標題最後變成「📦 ...」",
  },
  "skill-codex-handoff": {
    terminal: { case: "skill-handoff", agent: "codex" },
    eye: "那個視窗的分頁標題最後變成「📦 ...」",
  },
  // 這一支的效果是「跳出選項讓人選」，副產物是一個要人回答的 UI——程式抓不到，
  // headless 更是連 UI 都沒有。所以它是唯一走人眼判定的 skill。
  // demo 沒有「裝好了沒」可查——它是把前面裝的東西串起來跑一次。
  //
  // 網頁檔只證明前兩段（問配色、生成網頁）跑完了；第三段「逐字打 code、右邊即時
  // 長出網頁」是純畫面，只有人看得到。所以這一列兩種判定都要：程式等檔案，人看畫面。
  // 有 eye 的列不會自動變綠（見 app.js），綠燈以學生勾選為準。
  "demo-claude": {
    terminal: { case: "demo", agent: "claude" },
    eye: "左邊逐字打 code、右邊即時長出你剛才選的那個網頁",
  },
  "demo-codex": {
    terminal: { case: "demo", agent: "codex" },
    eye: "左邊逐字打 code、右邊即時長出你剛才選的那個網頁",
  },
  "skill-claude-structured-questions": {
    terminal: { case: "skill-questions", agent: "claude" },
    eye: "那個視窗裡跳出一組選項讓你選（不是用文字把選項寫出來）",
  },
  "skill-codex-structured-questions": {
    terminal: { case: "skill-questions", agent: "codex" },
    eye: "那個視窗裡跳出一組選項讓你選（不是用文字把選項寫出來）",
  },
};

// 跑「settings.json 裡真的那條指令」，而不是我們自己拼一次路徑去跑腳本。
// 差別很致命：VM 上腳本本身完全正常、直接跑必過，但註冊的指令路徑沒加引號，
// bash 把 C:\Users\Reed 的 \U \R 當跳脫吃掉 → node 找不到檔案 → exit 1 →
// PreToolUse 把 exit 1 當「hook 出錯，放行」，串接指令一路暢通。只驗腳本的話
// 這一格永遠是綠的。
// Windows 上嚮導自己的 PATH 未必看得到 Git Bash，但 Claude Code 本來就要它，
// 機器上幾乎一定有。與其把「叫不到 bash」丟給學生看（他做什麼都修不了，按安裝
// 也不會變好），不如自己去常見的安裝位置找。
export function resolveBash(exists = existsSync, platform = process.platform) {
  if (platform !== "win32") {
    return "bash";
  }

  // Claude Code 自己也要找 Git Bash，它認這個環境變數——學生設過的話，那一定是
  // 對的位置，優先用。
  const configured = process.env.CLAUDE_CODE_GIT_BASH_PATH;

  if (configured && exists(configured)) {
    return configured;
  }

  const roots = [
    process.env.ProgramFiles,
    process.env.ProgramW6432,
    process.env["ProgramFiles(x86)"],
    "C:/Program Files",
    "C:/Program Files (x86)",
    process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}/Programs`,
    process.env.USERPROFILE && `${process.env.USERPROFILE}/scoop/apps/git/current`,
  ].filter(Boolean);
  // Git for Windows 兩處都有 bash：bin 是給人用的，usr/bin 是 MSYS 本體。
  const suffixes = ["/Git/bin/bash.exe", "/Git/usr/bin/bash.exe"];
  const candidates = roots.flatMap((root) =>
    suffixes.map((suffix) => `${root}${suffix}`),
  );

  return candidates.find((candidate) => exists(candidate)) ?? "bash";
}

export function probeRegisteredHook(registeredCommand, command, env) {
  return new Promise((resolve) => {
    let child;

    try {
      // Claude Code 是把 hook 指令交給 bash 跑的，這裡照做才會踩到同一個坑。
      child = spawn(resolveBash(), ["-c", registeredCommand], {
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        ...(env === undefined ? {} : { env }),
      });
    } catch (error) {
      resolve({ exitCode: null, stderr: error.message });
      return;
    }

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) =>
      resolve({ exitCode: null, stderr: error.message }),
    );
    child.once("close", (exitCode) => resolve({ exitCode, stderr }));
    child.stdin.end(
      JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
    );
  });
}

// 真的把一段指令餵給 hook，看它擋不擋。這是唯一「結構對了但行為可能還是不對」
// 的項目——Node 不在 PATH、檔案內容壞掉，檔案與註冊都完美，hook 照樣叫不起來，
// 而且不會有任何錯誤訊息。
export function probeHook(hookPath, command) {
  return new Promise((resolve) => {
    let child;

    try {
      child = spawn("node", [hookPath], {
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({ exitCode: null, stderr: error.message });
      return;
    }

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) =>
      resolve({ exitCode: null, stderr: error.message }),
    );
    child.once("close", (exitCode) => resolve({ exitCode, stderr }));
    child.stdin.end(
      JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
    );
  });
}

// 檔案在不代表生效——真正的開關是 settings.json 的 outputStyle 欄位。
async function checkOutputStyle(materials, step) {
  const file = await checkCopyStep(materials, step);

  if (file.status !== "ok") {
    return file;
  }

  const settings = await readJsonOrNull(step.settingsTarget);

  if (settings?.outputStyle !== step.styleName) {
    return {
      id: step.id,
      label: step.label,
      status: "warn",
      detail: "檔案在，但 settings.json 沒啟用它——回覆格式不會變",
    };
  }

  return {
    id: step.id,
    label: step.label,
    status: "ok",
    detail: `已啟用「${step.styleName}」`,
  };
}

async function checkHook(step, materials) {
  const fileExists = existsSync(step.target);
  const settings = await readJsonOrNull(step.settingsTarget);
  const registration = findHookRegistration(settings ?? {});

  if (fileExists && (await staleTargets(materials, [step])).length > 0) {
    return {
      id: step.id,
      label: step.label,
      status: "warn",
      detail: "裝的是舊版——重跑安裝",
    };
  }

  if (fileExists && registration !== null) {
    // 跑註冊的那條指令，不是自己拼路徑去跑腳本。腳本幾乎永遠是好的，壞的是它被
    // 怎麼叫——Windows 上就是註冊路徑沒加引號，這一格卻一直給綠燈。
    const probe = await probeRegisteredHook(
      registration.command,
      "echo a && echo b",
      await spawnEnv(),
    );

    // 真的一台 bash 都找不到時，退回直接跑腳本本身。那比不上「跑註冊的那條指令」
    // ——路徑寫壞就抓不到了——但總比把一句學生修不了的錯誤丟在畫面上好。
    if (probe.exitCode === null) {
      const fallback = await probeHook(step.target, "echo a && echo b");

      return fallback.exitCode === 2
        ? {
            id: step.id,
            label: step.label,
            status: "ok",
            detail: "已註冊，實測會擋（這台機器沒有 bash，改驗腳本本身）",
          }
        : {
            id: step.id,
            label: step.label,
            status: "warn",
            detail: `已註冊，但實測沒擋下來（exit ${fallback.exitCode}）`,
          };
    }

    if (probe.exitCode !== 2) {
      return {
        id: step.id,
        label: step.label,
        status: "warn",
        detail: `已註冊，但實測沒擋下來（exit ${probe.exitCode}）`,
      };
    }

    return {
      id: step.id,
      label: step.label,
      status: "ok",
      detail: "已註冊，實測會擋",
    };
  }

  // 複製成功但沒註冊是最危險的狀態：hook 不會擋，也不會報錯。
  if (fileExists) {
    return {
      id: step.id,
      label: step.label,
      status: "warn",
      detail: "檔案在，但 settings.json 沒註冊——不會擋",
    };
  }

  return {
    id: step.id,
    label: step.label,
    status: "missing",
    detail: registration === null ? "尚未安裝" : "已註冊但檔案不見了",
  };
}

async function checkAllowlist(materials, step) {
  const source = path.join(materials, step.source);

  if (!existsSync(source)) {
    return {
      id: step.id,
      label: step.label,
      status: "missing",
      detail: "嚮導內建的素材不完整，請重新下載嚮導",
    };
  }

  const allowlist = JSON.parse(await readFile(source, "utf8"));
  const expected = expandAllowRules(allowlist.permissions.allow, HOME);
  const settings = await readJsonOrNull(step.settingsTarget);
  const installed = countInstalledRules(settings ?? {}, expected);

  // 這一列裝的是兩件事：白名單管「指令要不要問」，defaultMode 管「改檔案要不要問」。
  // 只數規則條數的話，模式那半靜默失效也是綠的——而學生的體感全在那半上。
  const mode = readDefaultMode(settings);

  if (installed === expected.length && mode === CLAUDE_DEFAULT_MODE) {
    return {
      id: step.id,
      label: step.label,
      status: "ok",
      detail: `${installed} 條規則，改檔案不再逐次詢問`,
    };
  }

  // 規則齊了但模式不對：分開講，因為要做的事不一樣。沒寫進去重跑安裝就好；
  // 學生自己設過的話重跑也不會覆蓋（安裝那條刻意尊重他的選擇），叫他重裝是白按。
  if (installed === expected.length) {
    return {
      id: step.id,
      label: step.label,
      status: "warn",
      detail:
        mode === null
          ? `${installed} 條規則，但預設模式沒設成 ${CLAUDE_DEFAULT_MODE}，重跑安裝就會補上`
          : `${installed} 條規則，但你自己把預設模式設成了 ${mode}`,
    };
  }

  return {
    id: step.id,
    label: step.label,
    status: installed === 0 ? "missing" : "warn",
    detail: `${installed} / ${expected.length} 條規則`,
  };
}

export async function checkTabSync(step, materials) {
  if (!existsSync(step.target)) {
    return {
      id: step.id,
      label: step.label,
      status: "missing",
      detail: "尚未安裝",
    };
  }

  const rcContent = existsSync(step.rcTarget)
    ? await readFile(step.rcTarget, "utf8")
    : "";

  if (!hasMarkedBlock(rcContent, step.rcMarker)) {
    return {
      id: step.id,
      label: step.label,
      status: "warn",
      detail: "檔案在，但 shell function 沒寫進去",
    };
  }

  // watcher 與 shell function 都改過（watcher 每輪重寫、Windows 換 -NoNewWindow）。
  // 舊版兩者都是「檔案在、標記在」，只看存在與否會給綠燈，但標題不會變。
  const staleWatcher = await staleTargets(materials, [
    { source: step.watcherSource, target: step.target },
  ]);

  if (staleWatcher.length > 0 || !rcContent.includes(step.rcBlock.trim())) {
    return {
      id: step.id,
      label: step.label,
      status: "warn",
      detail: "裝的是舊版——重跑安裝，然後開新的終端分頁",
    };
  }

  return { id: step.id, label: step.label, status: "ok", detail: "已啟用" };
}

export async function checkAgentHooks(step, materials) {
  const filesExist = step.hookFiles.every((file) => existsSync(file.target));

  // 命名 hook 的內容改過（改叫薄殼、含空白的路徑加引號）。舊版一樣是「檔案在、
  // 註冊在、白名單在」，三項全綠，但模型每次命名還是會被權限層擋下。
  if (filesExist && (await staleTargets(materials, step.hookFiles)).length > 0) {
    return {
      id: step.id,
      label: step.label,
      status: "warn",
      detail: "裝的是舊版——重跑安裝，然後開新的 session",
    };
  }

  const settings = await readJsonOrNull(step.settingsTarget);
  const registered = hasAgentHookRegistrations(
    settings ?? {},
    step.registrations,
  );

  // 命名指令沒進白名單的話，模型每次要命名都會被權限層擋下——檔案在、註冊也在，
  // 但功能是死的。只驗前兩項的話這一列會給假綠燈，而且綠燈就沒有安裝按鈕，
  // 學生連重跑的機會都沒有（實測就是卡在這）。
  const allowRuleNeeded = step.namingAllowRule !== undefined;
  const allowRuleInstalled =
    !allowRuleNeeded ||
    (settings?.permissions?.allow ?? []).includes(step.namingAllowRule);

  if (filesExist && registered && allowRuleInstalled) {
    return {
      id: step.id,
      label: step.label,
      status: "ok",
      detail: "hook 檔案與 3 筆註冊都已生效",
    };
  }

  if (filesExist && registered) {
    return {
      id: step.id,
      label: step.label,
      status: "warn",
      detail: "已註冊，但命名指令不在白名單——模型會被權限層擋下",
    };
  }

  if (filesExist) {
    return {
      id: step.id,
      label: step.label,
      status: "warn",
      detail: "檔案在，但沒註冊——不會被觸發",
    };
  }

  return {
    id: step.id,
    label: step.label,
    status: "missing",
    detail: registered ? "已註冊但 hook 檔案不完整" : "尚未安裝",
  };
}

// skill 只有一個檔案，但「檔案在」照樣不等於「是這一版」——auto-rename 的 SKILL.md
// 還要把 $HOME 換成絕對路徑才叫得動命名腳本，換錯或沒換都是安裝完看起來正常、
// 用起來被權限層擋下。所以比對的是「套過代換的原始素材」。
export async function checkSkill(step, materials) {
  const missing = step.files.filter((file) => !existsSync(file.target));

  if (missing.length > 0) {
    return {
      id: step.id,
      label: step.label,
      status: "missing",
      detail: "尚未安裝",
    };
  }

  for (const file of step.files) {
    const source = path.join(materials, file.source);

    if (!existsSync(source)) {
      return {
        id: step.id,
        label: step.label,
        status: "warn",
        detail: "嚮導內建的素材不完整，請重新下載嚮導",
      };
    }

    const [expected, actual] = await Promise.all([
      readFile(source, "utf8"),
      readFile(file.target, "utf8"),
    ]);

    if (applySubstitutions(expected, step.substitutions) !== actual) {
      return {
        id: step.id,
        label: step.label,
        status: "warn",
        detail: "裝的是舊版——重跑安裝，然後開新的 session",
      };
    }
  }

  return {
    id: step.id,
    label: step.label,
    status: "ok",
    detail: `已安裝 → ${step.files[0].target}`,
  };
}

// 第三方 skill 不是我們裝的，所以不比對內容——只認落點在不在。
export async function checkExternalSkill(step) {
  if (step.mcpServer !== undefined) {
    const config = await readJsonOrNull(step.mcpConfig);
    const registered = config?.mcpServers?.[step.mcpServer] !== undefined;

    return {
      id: step.id,
      label: step.label,
      status: registered ? "ok" : "missing",
      detail: registered
        ? `已註冊 MCP server：${step.mcpServer}`
        : "尚未註冊（要網路）",
    };
  }

  return {
    id: step.id,
    label: step.label,
    status: existsSync(step.marker) ? "ok" : "missing",
    detail: existsSync(step.marker) ? `已安裝 → ${step.marker}` : "尚未安裝（要網路）",
  };
}

// claude-hud 的三個檢查點（docs/claude-hud-card.md §6.2）：
//
//   1. settings.json 的 statusLine 指到 claude-hud，而且 refreshInterval 是 5
//      （沒有 5 的話用量倒數會卡住不動，畫面看起來像壞了）
//   2. enabledPlugins 打開了——只有 statusLine 沒有 plugin 的話指令會找不到模組
//   3. config.json 的每一個 key 都跟我們寫進去的一樣（版面被 /claude-hud:configure
//      改掉的話這裡會抓到）
//
// 不比對 statusLine 指令全文：那串裡有這台機器專屬的 node 路徑。
export async function checkClaudeHud(step) {
  const settings = existsSync(step.settingsTarget)
    ? JSON.parse(await readFile(step.settingsTarget, "utf8"))
    : {};
  const command = settings.statusLine?.command;
  const wired =
    typeof command === "string" &&
    command.includes("claude-hud") &&
    settings.statusLine?.refreshInterval === CLAUDE_HUD.refreshInterval;
  const enabled = settings.enabledPlugins?.[CLAUDE_HUD.plugin] === true;
  const config = existsSync(step.configTarget)
    ? JSON.parse(await readFile(step.configTarget, "utf8"))
    : null;
  const styled =
    config !== null &&
    Object.entries(CLAUDE_HUD.config).every(([key, value]) =>
      typeof value === "object" && value !== null
        ? Object.entries(value).every(
            ([inner, expected]) => config[key]?.[inner] === expected,
          )
        : config[key] === value,
    );
  const missing = [
    ...(enabled ? [] : ["plugin 還沒裝起來"]),
    ...(wired ? [] : ["狀態列還沒接上"]),
    ...(styled ? [] : ["版面設定還沒寫好"]),
  ];

  return {
    id: step.id,
    label: step.label,
    status: missing.length === 0 ? "ok" : "missing",
    detail:
      missing.length === 0
        ? "已接上，每 5 秒自己更新一次"
        : `${missing.join("、")}（要網路）`,
  };
}

// 跟 demo 那一列同一類：沒有「裝好了沒」可查，它就是「按下去跑一次」。
// noInstall 讓 ViewModel 別補安裝按鈕——補了也沒有東西可裝。
export function checkVaultAgent(step) {
  return {
    id: step.id,
    label: step.label,
    status: "ok",
    detail: "按右邊開終端跑一次：叫 AI 寫一篇測試筆記，然後上 GitHub 看那個檔在不在",
    noInstall: true,
  };
}

export function checkObsidianApp(step) {
  const installed = existsSync(step.app);

  return {
    id: step.id,
    label: step.label,
    status: installed ? "ok" : "missing",
    detail: installed ? `已安裝 → ${step.app}` : "尚未安裝（要網路）",
  };
}

// 四個檢查點，缺哪一個就講哪一個——「沒裝好」對學生等於沒說。
//
//   資料夾在不在        沒有的話後面全部免談
//   .git 有沒有 origin  沒有就只是本機資料夾，換電腦搬不走
//   外掛檔在不在        沒有的話 Obsidian 開起來什麼都不會發生
//   兩個設定值對不對    key 寫錯會被安靜忽略，行為退回預設值而畫面沒有錯誤
export async function checkObsidianVault(step) {
  const hasVault = existsSync(step.vault);
  const hasPlugin = existsSync(path.join(step.pluginDir, "main.js"));
  const dataPath = path.join(step.pluginDir, "data.json");
  const data = existsSync(dataPath)
    ? JSON.parse(await readFile(dataPath, "utf8"))
    : {};
  const wired =
    data.autoPullOnBoot === OBSIDIAN_GIT.settings.autoPullOnBoot &&
    data.autoSaveInterval === OBSIDIAN_GIT.settings.autoSaveInterval;
  const hasRemote =
    existsSync(path.join(step.vault, ".git", "config")) &&
    (await readFile(path.join(step.vault, ".git", "config"), "utf8")).includes(
      '[remote "origin"]',
    );
  const registry = existsSync(step.registry)
    ? JSON.parse(await readFile(step.registry, "utf8"))
    : { vaults: {} };
  const known = Object.values(registry.vaults ?? {}).some(
    (entry) => entry?.path === step.vault,
  );
  const missing = [
    ...(hasVault ? [] : ["筆記庫還沒建"]),
    ...(known ? [] : ["Obsidian 還不認得這個筆記庫"]),
    ...(hasRemote ? [] : ["還沒接上 GitHub"]),
    ...(hasPlugin ? [] : ["同步外掛還沒放進去"]),
    ...(wired ? [] : ["自動拉／自動存還沒設好"]),
  ];

  return {
    id: step.id,
    label: step.label,
    status: missing.length === 0 ? "ok" : "missing",
    detail:
      missing.length === 0
        ? `已接上 GitHub → ${step.vault}`
        : `${missing.join("、")}（要網路）`,
    // 這一列裝好之後仍然要留一顆按鈕。
    //
    // 別的列裝好就是裝好了，這一列不是：Obsidian 結束時會把自己那份筆記庫名單
    // 整份寫回去，我們登記的那一筆會被連同刪掉——四個檢查點全綠、按驗證卻跳
    // Vault not found（Reed 實測）。而且外掛的設定之後還會改版。
    //
    // 沒有這顆按鈕的話，學生唯一的自救手段是回上一張卡再往前翻。
    reinstallable: true,
  };
}

// demo 那一列沒有「安裝」這個動作，所以它永遠是「結構齊全、等你跑一次」的狀態：
// 顯示成待驗證 ◐、只掛一顆開終端的按鈕。noInstall 讓 ViewModel 別補安裝按鈕——
// 補了也沒有東西可裝，按下去只會失敗。
export function checkDemo(step) {
  return {
    id: step.id,
    label: step.label,
    status: "ok",
    detail: "按右邊開終端跑一次：問配色 → 生成網頁 → 逐字打 code 現場長出來",
    noInstall: true,
  };
}

export async function runConfigCheck({ tools, lang }) {
  const materials = materialsDir();
  const ids = stepsForTools(tools);
  const checks = [];

  for (const id of ids) {
    const step = describeStep(id, { lang, home: HOME });

    if (step.kind === "output-style") {
      checks.push(await checkOutputStyle(materials, step));
    } else if (step.kind === "hook") {
      checks.push(await checkHook(step, materials));
    } else if (step.kind === "allowlist") {
      checks.push(await checkAllowlist(materials, step));
    } else if (step.kind === "tab-sync") {
      checks.push(await checkTabSync(step, materials));
    } else if (step.kind === "agent-hooks") {
      checks.push(await checkAgentHooks(step, materials));
    } else if (step.kind === "skill") {
      checks.push(await checkSkill(step, materials));
    } else if (step.kind === "external-skill") {
      checks.push(await checkExternalSkill(step));
    } else if (step.kind === "claude-hud") {
      checks.push(await checkClaudeHud(step));
    } else if (step.kind === "vault-agent") {
      checks.push(checkVaultAgent(step));
    } else if (step.kind === "obsidian-app") {
      checks.push(checkObsidianApp(step));
    } else if (step.kind === "obsidian-vault") {
      checks.push(await checkObsidianVault(step));
    } else if (step.kind === "demo") {
      checks.push(checkDemo(step));
    } else {
      checks.push(await checkCopyStep(materials, step));
    }
  }

  return { lang, tools, checks: checks.map(withActions) };
}

// 一列檢查結果 → 那一列該掛哪幾顆按鈕。抽出來是為了測得到：ViewModel 吃的是這個
// 形狀，直接拿原始的 check 去測會少掉 verifyAction，測出來的按鈕數永遠是 0。
export function withActions(check) {
  const spec = VERIFICATION[check.id];

  return {
    ...check,
    installAction:
      check.noInstall === true ||
      (check.status === "ok" && check.reinstallable !== true)
        ? null
        : "install-config-step",
    mergeAction: check.needsMerge === true ? "merge-config-step" : null,
    // 兩種驗證形態：behavior 在頁面上跑完直接判定；terminal 是開一個真的終端
    // 視窗讓學生看，程式判定不了，所以一定配一個 eye 說明。
    verifyAction:
      spec?.behavior ?? (spec?.terminal === undefined ? null : "verify-in-terminal"),
    verifyKind: spec?.terminal === undefined ? "page" : "terminal",
    verifyOptions: spec?.terminal ?? spec?.options ?? null,
    eyeCheck: spec?.eye ?? null,
  };
}
