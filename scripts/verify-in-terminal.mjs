// 在「真的終端視窗」裡驗證，學生什麼都不用打，只要看。
//
//   node scripts/verify-in-terminal.mjs --case=naming --agent=claude
//
// 為什麼一定要真終端：hook 的效果（分頁標題、被擋的訊息、context 警告）只有在
// 終端裡看得到。headless 的 `claude -p` 更是連 wrapper 都不會經過——wrapper 刻意
// 跳過 -p，所以用 -p 驗標題永遠是綠的假象。
//
// 這裡開的視窗跑的是 `claude "一句提問"`：互動模式帶初始提問，wrapper 包得到、
// 標題會變，而學生不用輸入任何東西。
import { spawn } from "node:child_process";
import { chmodSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const CASES = {
  naming: {
    label: "自動命名",
    prompt: "請用一句話說明你現在在哪個資料夾，不要執行任何指令。",
    env: {},
    watchFor: "分頁標題變成「{emoji} 中文敘述」，emoji 是規定的那 8 個之一",
  },
  chained: {
    label: "Shell 不串接",
    prompt: "請執行這條指令：echo a && echo b",
    env: {},
    watchFor: "畫面出現「一次只跑一個指令」的中文訊息，指令被擋下來",
  },
  context: {
    label: "Context 監控",
    // 把 context 上限假裝成 30k，門檻降到 21k，幾次工具呼叫就會跨過去。
    prompt:
      "請連續讀取這個資料夾裡的五個檔案，每讀完一個就簡短說一句話。不要修改任何東西。",
    env: { CONTEXT_MONITOR_TEST_WINDOW: "30000" },
    watchFor: "工具跑幾次之後跳出 context 用量警告（標著「（測試模式）」）",
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
const testCase = CASES[args.case ?? "naming"];
const agent = args.agent === "codex" ? "codex" : "claude";

if (testCase === undefined) {
  console.log(`FAIL  不認得的驗證情境：${args.case}`);
  process.exit(1);
}

// 腳本寫成檔案再交給終端跑：把整段指令塞進終端的參數裡，引號與換行會被各平台的
// 命令列各自重新解讀一次，中文和 && 都會被吃掉（前面踩過）。
function writeLauncher() {
  const stamp = `${process.pid}-${Date.now()}`;
  const envLines = Object.entries(testCase.env);

  if (process.platform === "win32") {
    const file = path.join(tmpdir(), `jr-verify-${stamp}.ps1`);
    const setEnv = envLines
      .map(([name, value]) => `$env:${name} = '${value}'`)
      .join("\n");
    // 不加 -NoProfile：wrapper 就住在 profile 裡，跳過它等於沒在驗。
    writeFileSync(
      file,
      `﻿${setEnv}\n${agent} '${testCase.prompt}'\n`,
      "utf8",
    );
    return file;
  }

  const file = path.join(tmpdir(), `jr-verify-${stamp}.command`);
  const setEnv = envLines
    .map(([name, value]) => `export ${name}='${value}'`)
    .join("\n");
  // -i 讓 zsh 讀 ~/.zshrc，wrapper 才會存在。
  writeFileSync(
    file,
    `#!/bin/zsh -i\n${setEnv}\n${agent} '${testCase.prompt}'\n`,
  );
  chmodSync(file, 0o755);
  return file;
}

function openTerminal(launcher) {
  if (process.platform === "win32") {
    // wt 是安裝門檻，理論上一定在；真的沒有就退回 conhost，至少驗得到內容。
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

const launcher = writeLauncher();
const { cmd, args: openArgs } = openTerminal(launcher);
const child = spawn(cmd, openArgs, { stdio: "ignore", detached: true });
child.unref();

console.log(`已開啟一個新的終端視窗，正在跑「${testCase.label}」驗證。`);
console.log("");
console.log("請看那個視窗，你不需要輸入任何東西：");
console.log(`  ▸ ${testCase.watchFor}`);
console.log("");
console.log("看到了就回來把這一列的勾選框勾起來；沒看到就按「安裝」重跑一次。");
console.log(`（視窗跑完可以直接關掉。啟動腳本：${launcher}）`);
