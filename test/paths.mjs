import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { execFileSync } from "node:child_process";

import { actions } from "../src/actions.js";
import { LANGUAGES, STEP_IDS, describeStep } from "../src/config-install.js";
import { materialsDir, moduleFile } from "../src/paths.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

// 迴歸：原本用 new URL(...).pathname 取檔案路徑，Windows 上會回傳
// "/C:/Users/..."（前面多一條斜線），當成指令參數就被接成 "C:\C:\Users\..."。
// macOS 上 pathname 剛好是對的，所以只有 Windows 會炸——這個形狀檢查兩邊都成立。
const LOOKS_LIKE_BROKEN_WINDOWS_PATH = /^\/[A-Za-z]:/;

try {
  const materials = materialsDir();
  assert(path.isAbsolute(materials), "materialsDir 必須是絕對路徑");
  assert(
    !LOOKS_LIKE_BROKEN_WINDOWS_PATH.test(materials),
    `materialsDir 帶了前導斜線：${materials}`,
  );
  assert(existsSync(materials), "materialsDir 指到的目錄要真的存在");
  ok("素材目錄是可用的絕對路徑");

  assert(existsSync(path.join(materials, "claude-code", "hooks")), "素材不完整");
  ok("素材目錄裡有預期的內容");

  // action 的 buildArgs 產出的第一個參數是腳本路徑，那是實際被 spawn 的東西。
  // 不帶參數的腳本型 action（args 寫死）也要指到存在的檔案。
  for (const [name, action] of Object.entries(actions)) {
    if (action.cmd !== process.execPath || !Array.isArray(action.args)) {
      continue;
    }

    const [scriptPath] = action.args;
    assert(path.isAbsolute(scriptPath), `${name} 的腳本路徑不是絕對路徑`);
    assert(
      !LOOKS_LIKE_BROKEN_WINDOWS_PATH.test(scriptPath),
      `${name} 的腳本路徑帶了前導斜線：${scriptPath}`,
    );
    assert(existsSync(scriptPath), `${name} 指到的腳本不存在：${scriptPath}`);
  }

  const scripted = Object.entries(actions).filter(
    ([, action]) => typeof action.buildArgs === "function",
  );
  assert(scripted.length >= 3, "帶 buildArgs 的 action 應該有三個以上");

  for (const [name, action] of scripted) {
    const [scriptPath] = action.buildArgs({
      step: "hook",
      lang: "zh-TW",
      tools: "claude",
    });
    assert(path.isAbsolute(scriptPath), `${name} 的腳本路徑不是絕對路徑`);
    assert(
      !LOOKS_LIKE_BROKEN_WINDOWS_PATH.test(scriptPath),
      `${name} 的腳本路徑帶了前導斜線：${scriptPath}`,
    );
    assert(existsSync(scriptPath), `${name} 指到的腳本不存在：${scriptPath}`);
  }

  ok("每個帶參數的 action 都指到真實存在的腳本");

  const file = moduleFile("../package.json", import.meta.url);
  assert(existsSync(file), "moduleFile 解出來的路徑要能讀到");
  assert(!LOOKS_LIKE_BROKEN_WINDOWS_PATH.test(file));
  ok("moduleFile 解出來的路徑可以直接用");

  // 上面那些形狀檢查只有在 Windows 上跑才抓得到，macOS 新舊寫法都會過。
  // 所以再擋一次源頭：整個 src/ 與 scripts/ 都不准出現 .pathname。
  const root = moduleFile("..", import.meta.url);
  const offenders = [];

  for (const dir of ["src", "scripts"]) {
    for (const entry of readdirSync(path.join(root, dir))) {
      if (!entry.endsWith(".js") && !entry.endsWith(".mjs")) {
        continue;
      }

      const source = readFileSync(path.join(root, dir, entry), "utf8");

      if (/import\.meta\.url[\s\S]{0,40}?\)\s*\.pathname/.test(source)) {
        offenders.push(`${dir}/${entry}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `這些檔案又用了 .pathname 取路徑（Windows 會炸）：${offenders.join(", ")}`,
  );
  ok("沒有任何檔案用 .pathname 取模組路徑");

  // 每個安裝步驟的素材都要在，而且要被 git 追蹤。
  // 迴歸：.gitignore 有一條沒錨定的 AGENTS.md，把 materials/codex/*/AGENTS.md
  // 一起吞掉——本機檔案在、測試也過，但學生抓到的壓縮檔裡沒有那三個檔。
  const sources = new Set();

  for (const lang of LANGUAGES) {
    for (const id of STEP_IDS) {
      const step = describeStep(id, { lang, home: "/tmp/x" });

      if (typeof step.source === "string") {
        sources.add(step.source);
      }

      // .gitignore 在素材裡叫 gitignore（npm 打包會把 .gitignore 吃掉），
      // 它跟 source 一樣是「一定要跟著壓縮檔出去」的檔案。
      if (typeof step.gitignoreSource === "string") {
        sources.add(step.gitignoreSource);
      }
    }
  }

  for (const source of sources) {
    assert(
      existsSync(path.join(materials, source)),
      `素材少了 ${source}`,
    );
  }

  ok(`${sources.size} 個素材檔都在`);

  const tracked = new Set(
    execFileSync("git", ["-c", "core.quotePath=false", "ls-files", "materials"], {
      cwd: root,
      encoding: "utf8",
    })
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => line.replace(/^materials\//, "")),
  );
  const untracked = [...sources].filter((source) => !tracked.has(source));

  assert.deepEqual(
    untracked,
    [],
    `這些素材沒被 git 追蹤，學生抓到的壓縮檔會少檔案：${untracked.join(", ")}`,
  );
  ok("每個素材檔都有被 git 追蹤");
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
