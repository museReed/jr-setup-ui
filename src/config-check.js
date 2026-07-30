// 規則檔的安裝狀態：跟環境檢查同一個模式——一列一項，紅的給按鈕。
// 判斷依據是「真的生效了嗎」，不是「指令有沒有跑完」。
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import {
  applySubstitutions,
  countInstalledRules,
  describeStep,
  expandAllowRules,
  findHookRegistration,
  hasAgentHookRegistrations,
  hasMarkedBlock,
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

async function checkCopyStep(materials, step) {
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
  if (step.protectExisting === true && !matches) {
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
  "codex-config": { behavior: "verify-behavior", options: { tools: "codex" } },
  // 有副產物可抓的情境不給勾選框：程式判定得了就不該問學生。
  hook: { terminal: { case: "chained", agent: "claude" } },
  // 這一格不叫 AI：要驗的是 watcher 有沒有把名字放上分頁標題，跟模型無關。
  "tab-sync": {
    terminal: { case: "title", agent: "claude" },
    eye: "那個視窗的分頁標題變成「🔍 標題同步測試」",
  },
  "claude-namer": { terminal: { case: "naming", agent: "claude" } },
  "claude-monitor": { terminal: { case: "context", agent: "claude" } },
  "codex-namer": {
    terminal: { case: "naming", agent: "codex" },
    eye: "那個視窗的分頁標題變成命名（第一次會問你要不要信任 hook，要接受）",
  },
  "codex-monitor": { terminal: { case: "context", agent: "codex" } },
  // skill 的行為驗證跟 hook 同一個判準：要嘛留下只有 skill 跑過才會有的副產物，
  // 要嘛就老實承認驗不到、交給學生看。
  "skill-claude-auto-rename": {
    terminal: { case: "skill-rename", agent: "claude" },
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

  if (installed === expected.length) {
    return {
      id: step.id,
      label: step.label,
      status: "ok",
      detail: `${installed} 條規則`,
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
      check.noInstall === true || check.status === "ok"
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
