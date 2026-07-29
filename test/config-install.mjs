import assert from "node:assert/strict";

import {
  countInstalledRules,
  describeStep,
  expandAllowRules,
  findHookRegistration,
  mergeAllowRules,
  mergeHookRegistration,
  stepsForTools,
} from "../src/config-install.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

const HOME = "/Users/student";
const AT = { lang: "zh-TW", home: HOME };

try {
  assert.deepEqual(stepsForTools(["claude"]), [
    "claude-md",
    "output-style",
    "hook",
    "allowlist",
  ]);
  assert.deepEqual(stepsForTools(["codex"]), [
    "codex-config",
    "codex-agents",
  ]);
  assert.equal(stepsForTools(["claude", "codex"]).length, 6);
  assert.throws(() => stepsForTools([]));
  assert.throws(() => stepsForTools(["vim"]));
  ok("步驟清單跟著選的工具走，沒選工具就報錯");

  assert.equal(
    describeStep("claude-md", AT).target,
    `${HOME}/.claude/CLAUDE.md`,
  );
  assert.equal(describeStep("claude-md", AT).protectExisting, true);
  assert.equal(
    describeStep("output-style", { ...AT, lang: "en" }).source,
    "claude-code/en/output-styles/concise-structured.md",
  );
  assert.equal(describeStep("codex-config", AT).protectExisting, true);
  assert.equal(describeStep("codex-agents", AT).protectExisting, undefined);
  ok("每步知道自己的來源與目標，會蓋掉使用者內容的步驟有標記");

  assert.throws(() => describeStep("claude-md", { ...AT, lang: "ja" }));
  assert.throws(() => describeStep("不存在的步驟", AT));
  ok("語言不支援或步驟不認得時大聲報錯");

  // 迴歸：Bash() 白名單是字面比對，不會展開 ~。
  assert.deepEqual(
    expandAllowRules(
      ["Bash(~/Projects/**)", "Bash(git status)", "Read(~/notes)"],
      HOME,
    ),
    [`Bash(${HOME}/Projects/**)`, "Bash(git status)", "Read(~/notes)"],
  );
  ok("只展開 Bash() 規則裡的 ~，其他規則原樣保留");

  const hookPath = `${HOME}/.claude/hooks/block-chained-bash.js`;
  const registered = mergeHookRegistration({}, { hookPath });
  assert.deepEqual(registered.hooks.PreToolUse, [
    {
      matcher: "Bash",
      hooks: [{ type: "command", command: `node ${hookPath}`, timeout: 5 }],
    },
  ]);
  ok("空的 settings.json 會長出 hook 註冊，指令是 node 不是 python3");

  // 重跑安裝不能疊出兩份，也不能把別人的 hook 掃掉。
  const rerun = mergeHookRegistration(registered, { hookPath });
  assert.equal(rerun.hooks.PreToolUse.length, 1);
  ok("重跑安裝是冪等的：hook 不會疊出兩份");

  const withOthers = mergeHookRegistration(
    {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "node /別人的.js" }],
          },
        ],
        Stop: [{ hooks: [{ type: "command", command: "echo bye" }] }],
      },
      model: "opus",
    },
    { hookPath },
  );
  assert.equal(withOthers.hooks.PreToolUse.length, 2);
  assert.equal(withOthers.hooks.Stop.length, 1);
  assert.equal(withOthers.model, "opus");
  ok("不動使用者原本的其他 hook 與設定");

  const allow = mergeAllowRules(
    { permissions: { allow: ["Bash(ls)"], deny: ["Bash(rm)"] } },
    { allowRules: ["Bash(ls)", "Bash(git status)"] },
  );
  assert.deepEqual(allow.settings.permissions.allow, [
    "Bash(ls)",
    "Bash(git status)",
  ]);
  assert.deepEqual(allow.settings.permissions.deny, ["Bash(rm)"]);
  assert.equal(allow.addedRules, 1);
  ok("白名單只補沒有的，不動 deny 清單");

  // 驗證的關鍵：檔案複製成功但沒註冊進 settings.json，hook 一樣不會擋，
  // 而且不會有任何錯誤訊息——所以驗證必須看註冊，不能只看檔案在不在。
  assert.equal(findHookRegistration({}), null);
  assert.equal(
    findHookRegistration({
      hooks: { PreToolUse: [{ hooks: [{ command: "node /別的.js" }] }] },
    }),
    null,
  );
  assert.deepEqual(findHookRegistration(registered), {
    matcher: "Bash",
    command: `node ${hookPath}`,
  });
  ok("找得出 settings.json 裡的 hook 註冊，別人的 hook 不會誤判成有裝");

  assert.equal(
    countInstalledRules({ permissions: { allow: ["a", "b"] } }, ["a", "b", "c"]),
    2,
  );
  assert.equal(countInstalledRules({}, ["a"]), 0);
  ok("算得出白名單裝進去幾條");
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
