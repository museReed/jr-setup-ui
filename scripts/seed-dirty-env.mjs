// 把一台乾淨的 VM 弄成「上過課的學生」，用來重現回訪學生會撞到的問題。
//
//   先看不動：  node scripts/seed-dirty-env.mjs
//   真的弄髒：  node scripts/seed-dirty-env.mjs --apply
//
// ⚠️ 這支是「弄髒」不是「修好」。只在打算重灌或還原快照的 VM 上跑。
// ⚠️ 跑之前先存快照——每一步都不可逆。
//
// ── 為什麼是一支 .mjs，不是 .ps1 加 .sh ──────────────────────────────────
//
// 要弄髒的東西兩個平台是同一份清單，只有路徑與指令不同。拆成兩支的話，之後每加一種
// 污染都要記得改兩邊——而這個 repo 已經被「同一件事寫兩份、只修到一邊」咬過好幾次
// （BOM、profile 路徑、npm 判準）。Node 兩台 VM 上本來就有（嚮導自己要跑），所以
// 這裡用一份清單 + 一層薄薄的平台分支。
//
// ── 架構 ────────────────────────────────────────────────────────────────
//
//   STEPS      純資料：每一種污染是什麼、重現哪個問題、在哪些平台有意義
//   plan()     每一步自己算出「要做什麼」，回傳一份可以印、也可以執行的計畫
//   run()      唯一會產生副作用的地方
//
// 這樣「只看不動」與「真的做」跑的是同一份計畫，不會出現「印的跟做的不一樣」。
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, appendFileSync, rmSync } from "node:fs";
import { homedir, platform } from "node:os";
import path from "node:path";

const APPLY = process.argv.includes("--apply");
const HOME = homedir();
const WIN = platform() === "win32";

// ── 污染清單 ─────────────────────────────────────────────────────────────
//
// 每一步的 reproduces 欄位是它存在的理由。哪天某個問題修好了、不必再重現，就從這裡
// 刪掉那一步——而不是讓清單默默長大到沒人知道每一步在幹嘛。
const STEPS = [
  {
    id: "npm-legacy",
    label: "npm 全域裝 codex 與 claude（上一輪的裝法）",
    reproduces: "並存偵測、「要覆蓋的落點已經有東西」",
    plan: () => [
      {
        kind: "exec",
        cmd: "npm",
        args: ["install", "-g", "@openai/codex", "@anthropic-ai/claude-code"],
      },
    ],
  },
  {
    id: "orphan-shim",
    label: "刪掉套件本體、留下 shim",
    // ⚠️ 這一種最難查：npm 說「沒裝」，但 PATH 上還有一支指向空氣的執行檔。
    // 真機（peace 那台）就是卡在這裡——官方版明明裝好了，打 codex 仍然失敗。
    reproduces: "npm ls 抓不到的孤兒 shim",
    plan: async () => {
      const root = await capture("npm", ["root", "-g"]);

      if (root === null) {
        return [{ kind: "skip", why: "問不到 npm 的全域目錄" }];
      }

      const pkg = path.join(root.trim(), "@openai", "codex");
      return existsSync(pkg)
        ? [{ kind: "remove", target: pkg }]
        : [{ kind: "skip", why: `${pkg} 不在，npm-legacy 那步可能沒成功` }];
    },
  },
  {
    id: "shadow-function",
    label: "在 shell 設定檔裡放一個遮蔽 codex 的函式",
    // 打 codex 不行、打 codex.exe 才行——就是這個。函式排在執行檔前面，而它指向
    // 一個已經不存在的路徑。
    //
    // ⚠️ Windows 兩個 profile 都寫：5.1 與 7 各讀各的，而學生用哪一個我們不知道。
    // 真機上就撞過「$PROFILE 不存在但函式存在」。
    reproduces: "舊 wrapper 遮蔽、where.exe 看不到的那一種",
    plan: () => {
      const dead = WIN
        ? String.raw`${HOME}\AppData\Roaming\npm\node_modules\@openai\codex\bin\codex.exe`
        : `${HOME}/.npm-global/lib/node_modules/@openai/codex/bin/codex`;

      const block = WIN
        ? [
            "",
            "# === 假的舊 wrapper（seed-dirty-env 產生，測完請移除）===",
            "function codex {",
            `  & '${dead}' @args`,
            "}",
            "",
          ].join("\r\n")
        : [
            "",
            "# === 假的舊 wrapper（seed-dirty-env 產生，測完請移除）===",
            "codex() {",
            `  '${dead}' "$@"`,
            "}",
            "",
          ].join("\n");

      return profilePaths().map((target) => ({
        kind: "append",
        target,
        text: block,
      }));
    },
  },
  {
    id: "dirty-configs",
    label: "讓設定檔變成「已經有你自己的內容」",
    // 沒有這一步的話，嚮導會直接整份寫進去，「需要合併」那條路根本不會出現。
    reproduces: "合併流程、AI 潤飾造成的缺行",
    plan: () => [
      {
        kind: "append",
        target: path.join(HOME, ".codex", "AGENTS.md"),
        text: "\n# 我自己的規則\n- 一律用繁體中文\n",
      },
      {
        kind: "append",
        target: path.join(HOME, ".claude", "CLAUDE.md"),
        text: "\n# 我自己的規則\n- 一律用繁體中文\n",
      },
      {
        // ⚠️ service_tier = "default" 是真機撞到的值：新版 codex 不收，連啟動都失敗
        // （unknown variant `default`, expected `fast` or `flex`）。
        kind: "append",
        target: path.join(HOME, ".codex", "config.toml"),
        text: '\nservice_tier = "default"\n',
      },
    ],
  },
  {
    id: "legacy-skill-root",
    label: "在 codex 的舊 skill 路徑放一支",
    // ⚠️ 舊落點那份是**我們自己的 installer 放的**，不是 codex 官方搬家留下的。
    // jr_ai_agent_skills 的 `1e9d1bb`（2026-07-15）之前就是裝到 ~/.codex/skills，
    // 那一版之後才改裝到 ~/.agents/skills。所以要重現的是「7/15 之前上過課、之後
    // 沒再重跑過那支 installer」的機器。
    //
    // ⚠️ codex **兩個落點都讀**——2026-08-11 在 VM 上實測，同名時兩份都列出來、不去重，
    // 由模型當場挑哪一份。所以舊落點不是「殘留垃圾」，是會讓行為變得不可預測的
    // 活躍設定。詳見 docs/handoff/2026-08-10-rework-cli-resolution.md 的 2a 節。
    //
    // 這裡寫的是「沒有 frontmatter」的版本，所以 codex 會印一行紅字。真實的回訪學生
    // 那份是格式正確的，不會有紅字、會安靜地生效——那才是難查的情況。
    reproduces: "codex skill 舊落點（會與新落點同名並存）",
    plan: () => [
      {
        kind: "write",
        target: path.join(HOME, ".codex", "skills", "handoff", "SKILL.md"),
        text: "# 上一輪裝的 handoff\n",
      },
    ],
  },
  {
    id: "native-codex",
    label: "裝原生版 codex（製造並存 + junction 漏連）",
    // junction 漏連是安裝器自己的 bug（openai/codex#30829），不用手動破壞。
    reproduces: "並存、sandbox helper 找不到（Windows）",
    plan: () =>
      WIN
        ? [
            {
              kind: "exec",
              cmd: "powershell.exe",
              args: [
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                "irm https://chatgpt.com/codex/install.ps1 | iex",
              ],
              env: { CODEX_NON_INTERACTIVE: "1" },
            },
          ]
        : [
            {
              kind: "exec",
              cmd: "bash",
              args: [
                "-c",
                "set -eo pipefail; curl -fsSL https://chatgpt.com/codex/install.sh | sh",
              ],
              env: { CODEX_NON_INTERACTIVE: "1" },
            },
          ],
  },
  {
    id: "store-pwsh",
    label: "Store 版 PowerShell 7",
    reproduces: "sandbox 的 1312（沙箱換帳號跑，MSIX 綁帳號）",
    // ⚠️ 自動化不了：Store 的安裝要走 UI，而 winget 的 msstore 來源在多數 VM 上
    // 憑證驗證會失敗。只印步驟，不裝。
    onlyWin: true,
    plan: () => [
      {
        kind: "manual",
        text: [
          "開 Microsoft Store 搜尋 PowerShell 安裝（不要用 MSI）。",
          "裝完確認：(Get-Command pwsh).Source  ← 要指到 …\\WindowsApps\\…",
          "不裝的話只有 1312 那條重現不了，其餘不受影響。",
        ],
      },
    ],
  },
];

// ── 執行 ─────────────────────────────────────────────────────────────────

function profilePaths() {
  if (!WIN) {
    return [path.join(HOME, ".zshrc")];
  }

  // 5.1 與 7 各讀各的。學生用哪一個我們不知道，所以兩個都弄髒。
  return [
    path.join(HOME, "Documents", "WindowsPowerShell", "Microsoft.PowerShell_profile.ps1"),
    path.join(HOME, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1"),
  ];
}

function capture(cmd, args) {
  return new Promise((resolve) => {
    let out = "";
    const child = spawn(cmd, args, {
      shell: WIN,
      stdio: ["ignore", "pipe", "ignore"],
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.once("error", () => resolve(null));
    child.once("close", (code) => resolve(code === 0 ? out : null));
  });
}

function exec(cmd, args, env) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      // Windows 的 npm 是 npm.cmd，不開 shell 找不到裸指令。
      shell: WIN,
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, ...(env ?? {}) },
    });
    child.once("error", () => resolve(1));
    child.once("close", (code) => resolve(code ?? 1));
  });
}

function describe(action) {
  switch (action.kind) {
    case "exec":
      return `執行 ${action.cmd} ${action.args.join(" ")}`;
    case "append":
      return `往 ${action.target} 追加一段`;
    case "write":
      return `寫出 ${action.target}`;
    case "remove":
      return `刪掉 ${action.target}`;
    case "skip":
      return `跳過（${action.why}）`;
    case "manual":
      return "要手動做（見下）";
    default:
      return action.kind;
  }
}

async function run(action) {
  if (action.kind === "exec") {
    return exec(action.cmd, action.args, action.env);
  }

  if (action.kind === "remove") {
    rmSync(action.target, { recursive: true, force: true });
    return 0;
  }

  if (action.kind === "append" || action.kind === "write") {
    mkdirSync(path.dirname(action.target), { recursive: true });
    appendFileSync(action.target, action.text, "utf8");
    return 0;
  }

  return 0;
}

console.log(`平台：${platform()}　家目錄：${HOME}`);

if (!APPLY) {
  console.log("");
  console.log("現在是「只看不動」模式。確認下面的清單之後，加 --apply 再跑一次。");
}

for (const step of STEPS) {
  if (step.onlyWin === true && !WIN) {
    continue;
  }

  console.log("");
  console.log(`=== ${step.id}｜${step.label} ===`);
  console.log(`    重現：${step.reproduces}`);

  const actions = await step.plan();

  for (const action of actions) {
    if (action.kind === "manual") {
      for (const line of action.text) {
        console.log(`    ⚠️ ${line}`);
      }
      continue;
    }

    console.log(`    ${APPLY ? "[執行]" : "[會做]"} ${describe(action)}`);

    if (APPLY && action.kind !== "skip") {
      const code = await run(action);

      if (code !== 0) {
        console.error(`    失敗（exit ${code}）——上面那段是它自己講的原因。`);
      }
    }
  }
}

console.log("");

if (!APPLY) {
  console.log("確認清單沒問題的話，再跑一次加上 --apply。");
  console.log("⚠️ 跑之前先存快照。");
  process.exit(0);
}

console.log("=== 弄髒完成，接下來 ===");
console.log("1. 開一個新的終端視窗（PATH 與 shell 設定檔都變了）");
console.log(`2. 確認並存：${WIN ? "where.exe codex" : "which -a codex"}`);
console.log(
  `3. 確認有東西遮蔽它：${WIN ? "Get-Command codex -All" : "type -a codex"}`,
);

if (WIN) {
  console.log('4. 確認沙箱壞掉：codex sandbox powershell -NoProfile -Command "Get-Location"');
}

console.log("5. 跑嚮導，第一頁應該同時亮出好幾條提示。");
