import assert from "node:assert/strict";

import {
  SECTIONS,
  flattenCheckCards,
  groupChecks,
} from "../public/model.js";
import { envLogoFor, progressSummary } from "../public/viewmodel.js";

function check(id) {
  return { id, label: id, status: "ok", detail: "已安裝" };
}

function section(groups, sectionId) {
  return groups.find((group) => group.sectionId === sectionId);
}

try {
  assert.deepEqual(
    SECTIONS.map(({ id }) => id),
    ["env", "rules", "skills", "demo"],
  );

  const rules = section(
    groupChecks([
      check("codex-config"),
      check("claude-md"),
      check("tab-sync"),
      check("codex-agents"),
      check("hook"),
    ]),
    "rules",
  );
  assert.deepEqual(
    rules.cards.map(({ agent, label, logo, checks }) => ({
      agent,
      label,
      logo,
      checks: checks.map(({ id }) => id),
    })),
    [
      {
        agent: "claude",
        label: "Claude",
        logo: "logo-claude",
        checks: ["claude-md", "hook"],
      },
      {
        agent: "codex",
        label: "Codex",
        logo: "logo-openai",
        checks: ["codex-config", "codex-agents"],
      },
      {
        agent: "shared",
        label: "兩邊共用",
        logo: "logo-terminal",
        checks: ["tab-sync"],
      },
    ],
  );

  const claudeOnly = groupChecks([
    check("claude-md"),
    check("skill-claude-handoff"),
    check("demo-claude"),
  ]);
  assert(
    claudeOnly.every((group) =>
      group.cards.every(({ agent }) => agent !== "codex"),
    ),
  );

  const withUnknown = section(
    groupChecks([check("claude-md"), check("future-config-step")]),
    "rules",
  );
  assert.equal(withUnknown.cards.at(-1).label, "其他");
  assert.deepEqual(
    withUnknown.cards.at(-1).checks.map(({ id }) => id),
    ["future-config-step"],
  );

  const progressChecks = [
    check("claude-md"),
    {
      ...check("output-style"),
      verifyAction: "verify-behavior",
    },
  ];
  assert.deepEqual(
    progressSummary(
      [check("claude"), { ...check("codex"), status: "missing" }],
      progressChecks,
    ),
    { loading: false, done: 2, total: 4, percent: 50 },
  );
  assert.equal(
    progressSummary(
      [check("claude"), { ...check("codex"), status: "missing" }],
      progressChecks,
      new Set(["output-style"]),
    ).percent,
    75,
  );
  assert.equal(progressSummary(null, progressChecks).loading, true);

  assert.equal(envLogoFor("claude-auth"), "logo-claude");
  assert.equal(envLogoFor("execution-policy"), "logo-powershell");
  assert.equal(envLogoFor("unknown"), null);

  const flattened = flattenCheckCards(
    groupChecks([
      check("tab-sync"),
      check("codex-config"),
      check("claude-md"),
      check("future-config-step"),
    ]),
    [check("node"), check("codex"), check("claude")],
  );
  assert.equal(section(flattened, "env").cards.length, 4);
  assert.deepEqual(
    section(flattened, "env").cards.map(({ checkId }) => checkId),
    ["env-config", "claude", "codex", "node"],
  );
  assert.deepEqual(
    section(flattened, "rules").cards.map(({ checkId, agent }) => ({
      checkId,
      agent,
    })),
    [
      { checkId: "claude-md", agent: "claude" },
      { checkId: "codex-config", agent: "codex" },
      { checkId: "tab-sync", agent: "shared" },
      { checkId: "future-config-step", agent: "other" },
    ],
  );

  console.log("ok - sections 分組、單卡順序、進度、logo 與未知 step fallback");
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
