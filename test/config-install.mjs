import assert from "node:assert/strict";

import {
  expandAllowRules,
  mergeClaudeSettings,
  planInstall,
} from "../src/config-install.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

const HOME = "/Users/student";

try {
  const claude = planInstall({
    tools: ["claude"],
    lang: "zh-TW",
    home: HOME,
    existing: {},
  });
  assert.deepEqual(
    claude.steps.map((step) => step.target),
    [
      `${HOME}/.claude/CLAUDE.md`,
      `${HOME}/.claude/output-styles/concise-structured.md`,
      `${HOME}/.claude/hooks/block-chained-bash.py`,
      `${HOME}/.claude/settings.json`,
    ],
  );
  assert.equal(claude.manual.length, 0);
  ok("乾淨的機器裝 Claude 走四個步驟、沒有要人工處理的");

  assert.equal(
    claude.steps.find((step) => step.source.endsWith("block-chained-bash.py"))
      .executable,
    true,
  );
  ok("hook 檔要標成可執行");

  // 已經有 CLAUDE.md 就不能蓋——那是使用者自己的規則。
  const withExisting = planInstall({
    tools: ["claude"],
    lang: "zh-TW",
    home: HOME,
    existing: { claudeMd: true },
  });
  assert(
    !withExisting.steps.some((step) =>
      step.target.endsWith("/.claude/CLAUDE.md"),
    ),
  );
  assert.deepEqual(
    withExisting.manual.map((item) => item.id),
    ["merge-claude-md"],
  );
  ok("已存在的 CLAUDE.md 不進自動步驟，改列為要人工合併");

  const codex = planInstall({
    tools: ["codex"],
    lang: "en",
    home: HOME,
    existing: {},
  });
  assert.deepEqual(
    codex.steps.map((step) => step.source),
    ["codex/en/config.toml.example", "codex/en/AGENTS.md"],
  );
  ok("Codex 走 config.toml 與 AGENTS.md，語言路徑跟著選擇走");

  const codexExisting = planInstall({
    tools: ["codex"],
    lang: "en",
    home: HOME,
    existing: { codexConfig: true },
  });
  assert.deepEqual(
    codexExisting.manual.map((item) => item.id),
    ["merge-codex-config"],
  );
  ok("已存在的 config.toml 改列為要人工合併");

  const both = planInstall({
    tools: ["claude", "codex"],
    lang: "zh-CN",
    home: HOME,
    existing: {},
  });
  assert.equal(both.steps.length, 6);
  ok("兩個都選就是兩邊的步驟相加");

  assert.throws(() => planInstall({ tools: [], lang: "zh-TW", home: HOME }));
  assert.throws(() =>
    planInstall({ tools: ["claude"], lang: "ja", home: HOME }),
  );
  ok("沒選工具或語言不支援時大聲報錯");

  // 迴歸：Bash() 白名單是字面比對，不會展開 ~。
  assert.deepEqual(
    expandAllowRules(
      ["Bash(~/Projects/**)", "Bash(git status)", "Read(~/notes)"],
      HOME,
    ),
    [`Bash(${HOME}/Projects/**)`, "Bash(git status)", "Read(~/notes)"],
  );
  ok("只展開 Bash() 規則裡的 ~，其他規則原樣保留");

  const fresh = mergeClaudeSettings(
    {},
    { hookPath: "/h/block-chained-bash.py", allowRules: ["Bash(git status)"] },
  );
  assert.deepEqual(fresh.settings.hooks.PreToolUse, [
    {
      matcher: "Bash",
      hooks: [
        {
          type: "command",
          command: "python3 /h/block-chained-bash.py",
          timeout: 5,
        },
      ],
    },
  ]);
  assert.deepEqual(fresh.settings.permissions.allow, ["Bash(git status)"]);
  assert.equal(fresh.addedRules, 1);
  ok("空的 settings.json 會長出 hook 與白名單");

  // 重跑安裝不能疊出兩份 hook，也不能把別人的 hook 掃掉。
  const rerun = mergeClaudeSettings(fresh.settings, {
    hookPath: "/h/block-chained-bash.py",
    allowRules: ["Bash(git status)", "Bash(git log)"],
  });
  assert.equal(rerun.settings.hooks.PreToolUse.length, 1);
  assert.deepEqual(rerun.settings.permissions.allow, [
    "Bash(git status)",
    "Bash(git log)",
  ]);
  assert.equal(rerun.addedRules, 1);
  ok("重跑安裝是冪等的：hook 不疊、白名單只補沒有的");

  const withOtherHook = mergeClaudeSettings(
    {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "python3 /別人的.py" }],
          },
        ],
        Stop: [{ hooks: [{ type: "command", command: "echo bye" }] }],
      },
      permissions: { allow: ["Bash(ls)"], deny: ["Bash(rm)"] },
      model: "opus",
    },
    { hookPath: "/h/block-chained-bash.py", allowRules: ["Bash(ls)"] },
  );
  assert.equal(withOtherHook.settings.hooks.PreToolUse.length, 2);
  assert.equal(withOtherHook.settings.hooks.Stop.length, 1);
  assert.deepEqual(withOtherHook.settings.permissions.deny, ["Bash(rm)"]);
  assert.deepEqual(withOtherHook.settings.permissions.allow, ["Bash(ls)"]);
  assert.equal(withOtherHook.settings.model, "opus");
  ok("不動使用者原本的其他 hook、deny 清單與設定");
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
