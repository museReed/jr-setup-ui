import assert from "node:assert/strict";

import { SKILL_NAMES } from "../src/config-install.js";
import { checksForPlatform, checksForTools } from "../src/env-check.js";
import {
  conflictingLegacySkills,
  currentSkillRoot,
  legacySkillRoot,
  legacySkillStatus,
  quarantineRoot,
} from "../src/skill-roots.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

const HOME = "/Users/reed";
const OURS = [...SKILL_NAMES, "vault-sync"];

try {
  assert.equal(legacySkillRoot(HOME), "/Users/reed/.codex/skills");
  assert.equal(currentSkillRoot(HOME), "/Users/reed/.agents/skills");
  ok("兩個落點的路徑寫在同一個地方，不再散落");

  // 只認「我們待會兒要裝的」那幾支。學生自己放在舊落點的東西不關我們的事——
  // 順手清掉別人的 skill 是完全不同性質的一件事。
  const conflicting = conflictingLegacySkills(
    ["handoff", "my-own-thing", "auto-rename"],
    OURS,
  );
  assert.deepEqual(conflicting, ["auto-rename", "handoff"]);
  ok("只挑出跟這次要裝的同名的，學生自己的 skill 不動");

  assert.deepEqual(conflictingLegacySkills(["my-own-thing"], OURS), []);
  assert.deepEqual(conflictingLegacySkills([], OURS), []);
  ok("沒有打架的東西時回空陣列");

  const clean = legacySkillStatus([]);
  assert.equal(clean.status, "ok");
  assert.equal(clean.fixLabel, undefined);
  ok("沒問題時是綠的，也不長按鈕");

  const dirty = legacySkillStatus(["auto-rename", "handoff"]);
  assert.equal(dirty.status, "warn");
  assert.equal(dirty.installable, false);
  assert.equal(dirty.fixLabel, "搬走打架的舊 skill");
  assert.deepEqual(dirty.conflicting, ["auto-rename", "handoff"]);
  assert.ok(dirty.detail.length <= 40, `detail 太長會把按鈕擠出畫面：${dirty.detail}`);
  ok("有打架時是黃的、不長安裝鍵，說明一行講完");

  // ⚠️ 隔離區一定要在 skills 根目錄**外面**。留在裡面的話（例如改名成
  // handoff.bak.20260811），codex 照樣會掃到它、照樣讀到 name: handoff，
  // 衝突原封不動。
  assert.ok(!quarantineRoot(HOME).startsWith(legacySkillRoot(HOME)));
  assert.ok(!quarantineRoot(HOME).startsWith(currentSkillRoot(HOME)));
  ok("隔離區在兩個 skill 根目錄之外，搬過去就不會再被掃到");

  // 這一列跟平台無關——~/.codex/skills 這個舊落點 mac 上一樣有。
  for (const platform of ["win32", "darwin"]) {
    assert.ok(
      checksForPlatform(platform)
        .map((check) => check.id)
        .includes("codex-legacy-skills"),
      `${platform} 少了 codex-legacy-skills`,
    );
  }
  ok("兩個平台都有這一列");

  // 只選 Claude 的學生不該看到 Codex 的 skill 落點問題。
  const claudeOnly = checksForTools(checksForPlatform("darwin"), ["claude"]).map(
    (check) => check.id,
  );
  assert.ok(!claudeOnly.includes("codex-legacy-skills"));
  ok("只選 Claude 時這一列會被濾掉");
} catch (error) {
  console.error(error);
  process.exit(1);
}
