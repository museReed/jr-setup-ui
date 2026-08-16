// 家目錄裡有東西不是學生的：判準在 src/home-perms.js，這裡測它問的那幾個問題，
// 以及那一列接得到按鈕、按鈕接得到真的 action。
//
// 來源是兩份真實回報（2026-08-16 同一場課，museReed/jr-setup-feedback#6）：
//
//   login-gh             ✓ Authentication complete → mkdir ~/.config/gh: permission denied
//   install-config-step  已備份 → .zshrc.bak.…  →  EACCES: permission denied, open '~/.zshrc'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  WRITE_TARGETS,
  blockedSummary,
  blockedWriteTargets,
  ghConfigBlocked,
  homePermsRow,
} from "../src/home-perms.js";
import { FIX_ACTIONS } from "../src/env-check.js";
import { actions } from "../src/actions.js";
import { flattenCheckCards } from "../public/model.js";
import { fixButtonText } from "../public/viewmodel.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

const HOME = "/Users/daisy";

// 一組假的檔案系統：列出「存在的」與「寫不進去的」，其餘一律當成好的。
function probes({ present = [], readOnly = [] }) {
  const exists = new Set(present.map((name) => `${HOME}/${name}`));
  const locked = new Set(readOnly.map((name) => `${HOME}/${name}`));

  return {
    exists: (path) => exists.has(path),
    writable: (path) => !locked.has(path),
  };
}

try {
  // 一台正常的機器：東西都在、都是他的。
  assert.deepEqual(
    blockedWriteTargets(
      HOME,
      probes({ present: WRITE_TARGETS.map((target) => target.name) }),
    ),
    [],
  );
  ok("每一樣都寫得進去時沒有任何一項被點名");

  // ⚠️ 不存在**不算**問題。嚮導會自己建，而建得出來只需要家目錄可寫——那一項自己
  // 會被查到。把「還沒有 .zprofile」也算成毛病的話，全新的 mac 一開機就是黃燈。
  assert.deepEqual(blockedWriteTargets(HOME, probes({})), []);
  ok("那幾樣還不存在時不算毛病（嚮導自己會建）");

  // 回報裡的第一種：~/.config 是 root 的 → gh 走完授權才死在 mkdir。
  const configOnly = blockedWriteTargets(
    HOME,
    probes({ present: [".config"], readOnly: [".config"] }),
  );
  assert.deepEqual(
    configOnly.map((item) => item.name),
    [".config"],
  );
  // 每一項都要說得出「這一步會壞在哪」——學生看到一列檔名，沒有這句話不知道
  // 為什麼嚮導要碰他的 .config。
  assert.match(configOnly[0].why, /GitHub CLI/);
  ok("~/.config 不是他的時候被點名，而且說得出那會壞掉哪一步");

  // 回報裡的第二種：~/.zshrc 是 root 的 → 分頁標題那一步每按一次就多兩個 .bak。
  const both = blockedWriteTargets(
    HOME,
    probes({
      present: [".config", ".zshrc", ".codex"],
      readOnly: [".config", ".zshrc"],
    }),
  );
  assert.deepEqual(
    both.map((item) => item.name),
    [".config", ".zshrc"],
  );
  ok("同一台機器上兩樣都被鎖住時，兩樣都列出來（回報裡就是這樣）");

  // ⚠️ 家目錄本身寫不進去是另一回事，而且排第一：上面那幾樣都要在它裡面建出來。
  const homeLocked = blockedWriteTargets(HOME, {
    exists: () => false,
    writable: (path) => path !== HOME,
  });
  assert.deepEqual(
    homeLocked.map((item) => item.name),
    ["家目錄本身"],
  );
  ok("家目錄本身寫不進去時自成一項，而且排在最前面");

  // ── 那一列長什麼樣 ────────────────────────────────────────────────────
  //
  // 沒事就不要長一列出來。多數學生的家目錄是好的，一列「權限正常」只是多一列
  // 要讀（跟 quarantineRow 同一個判準）。
  assert.equal(homePermsRow([]), null);
  ok("沒有東西被鎖住時這一列不出現");

  const row = homePermsRow(both);
  assert.equal(row.status, "warn");
  // 這一列沒有東西可以「安裝」，補一顆安裝鍵只會讓學生問安裝什麼。
  assert.equal(row.installable, false);
  assert.ok(
    row.detail.length <= 40,
    `detail 太長會把按鈕擠出畫面：${row.detail}`,
  );
  assert.ok(row.detail.includes(".config"));
  // ⚠️ 只回名字，不回完整路徑。這一列會整包送到瀏覽器，而「這一頁卡住了」那顆會把
  // 畫面上的東西貼到公開的 issue 上——完整路徑裡有學生的使用者名稱（常常是本名）。
  assert.deepEqual(row.blocked, [".config", ".zshrc"]);
  assert.ok(
    JSON.stringify(row).includes(HOME) === false,
    "這一列不能帶出完整路徑——它會被貼到公開的 issue 上",
  );
  ok("那一列是黃燈、一行講完、而且不帶出家目錄的完整路徑");

  // 名字多的時候要收短，不然 40 字的上限一定破，而被擠掉的是按鈕。
  assert.ok(
    blockedSummary(WRITE_TARGETS).length <= 40,
    blockedSummary(WRITE_TARGETS),
  );
  assert.match(blockedSummary(WRITE_TARGETS), /等 6 樣/);
  ok("被鎖住的東西很多時，那一行收成「等 N 樣」而不是列滿");

  // 引導要講出「按下去會發生什麼」：那顆按鈕會跳出一個問密碼的視窗。
  assert.match(row.guidance.checks.join("\n"), /sudo/);
  assert.match(row.guidance.checks.join("\n"), /密碼/);
  assert.match(row.guidance.checks.join("\n"), /不碰/);
  ok("引導講得出成因、會做什麼、以及不會動到什麼");

  // ── 按鈕接得上 ────────────────────────────────────────────────────────
  assert.equal(FIX_ACTIONS["home-perms"]("warn", row), "fix-home-perms");
  assert.equal(fixButtonText({ id: "home-perms", fixAction: "fix-home-perms" }), "修好檔案權限（開終端）");
  // ⚠️ 文字裡要有「開終端」：按下去會跳出一個跟他要 Mac 密碼的黑視窗，沒先講的話
  // 第一個反應是關掉它。
  assert.match(fixButtonText({ fixAction: "fix-home-perms" }), /開終端/);
  ok("那一列掛得出修復鍵，而且按鈕先講了會開終端");

  // 那顆 action 真的註冊過，不然按下去會回 400。
  assert.notEqual(actions["fix-home-perms"], undefined);
  assert.equal(actions["fix-home-perms"].kind, "fixed");
  ok("修權限那顆 action 註冊過了");

  // ── gh 那一列要改口 ──────────────────────────────────────────────────
  //
  // ⚠️ 「未登入」配一顆「開始登入」是一條死路：授權每次都會走完，然後 token 存不
  // 下來。實際回報裡那位同學就是這樣重試的。
  assert.equal(ghConfigBlocked(both), true);
  assert.equal(ghConfigBlocked(homeLocked), true, "家目錄本身鎖住時 gh 一樣存不進去");
  assert.equal(
    ghConfigBlocked(
      blockedWriteTargets(HOME, probes({ present: [".zshrc"], readOnly: [".zshrc"] })),
    ),
    false,
    "只有 .zshrc 被鎖住時，gh 是好的——不要順手把它也判成壞的",
  );

  const ghBlocked = { id: "gh-auth", status: "warn", permBlocked: true };
  assert.equal(FIX_ACTIONS["gh-auth"]("warn", ghBlocked), "fix-home-perms");
  assert.notEqual(
    fixButtonText({ ...ghBlocked, fixAction: "fix-home-perms" }),
    "開始登入",
  );
  // 真的沒登入的那種完全不受影響。
  assert.equal(
    FIX_ACTIONS["gh-auth"]("warn", { id: "gh-auth", status: "warn" }),
    "login-gh",
  );
  assert.equal(FIX_ACTIONS["gh-auth"]("ok", { status: "ok" }), null);
  ok("設定夾被鎖住時 gh 那一列改掛修權限，真的沒登入時照舊給登入鍵");

  // ── 判準只有一份 ──────────────────────────────────────────────────────
  //
  // ⚠️ 畫面上那一列與修復腳本共用同一支函式。兩邊各寫一份的話會出現「畫面說有問題、
  // 按下去卻說沒事」——最傷信任的那種不一致（brew／npm 那兩顆共用 npm ls -g 是同
  // 一個理由）。
  const fixSource = readFileSync(
    new URL("../scripts/fix-home-perms.mjs", import.meta.url),
    "utf8",
  );
  assert.match(fixSource, /blockedWriteTargets/);
  // ⚠️ 家目錄本身只 chown 它自己、不加 -R：整個家目錄遞迴下去會掃到 Library 與
  // iCloud，跑很久，而且遠遠超出我們該碰的範圍。
  assert.match(fixSource, /recursive: false/);
  // ⚠️ 換的是「現在跑這支的人」，不能寫死名字：學生的帳號名不是 daisy 就是別的，
  // 而這段是在他自己的終端裡跑的，id 問得到。
  assert.match(fixSource, /\$\(id -un\):\$\(id -gn\)/);
  // ⚠️ 唯讀模式（444）那一種只 chown 修不好，畫面上那一列會一直說還沒好。
  assert.match(fixSource, /chmod u\+w/);
  ok("修復腳本跟畫面用同一支判準，而且不遞迴整個家目錄");

  // 備份要在確認改得動之後才做。回報裡那位同學按了三次，家目錄多了六個沒用的 .bak。
  const installSource = readFileSync(
    new URL("../scripts/install-configs.mjs", import.meta.url),
    "utf8",
  );
  const backupBody = installSource.slice(
    installSource.indexOf("async function backup("),
    installSource.indexOf("function sourcePath("),
  );
  assert.ok(
    backupBody.indexOf("accessSync") < backupBody.indexOf("copyFile"),
    "要先確認改得動再備份——不然每按一次失敗都留下一份沒有用的 .bak",
  );
  ok("改不動的檔案不會先被備份一份");

  // ── 卡片有名分 ────────────────────────────────────────────────────────
  //
  // ⚠️ 沒登記在 ENV_CARD_META 的 id 會退回機器寫的預設模板（「準備 <整句 label>，
  // 讓後面的課堂步驟可以正常進行。」），讀起來像機器寫的。
  const envCards = flattenCheckCards(
    [],
    [
      { id: "git", label: "Git", status: "ok", detail: "x" },
      { id: "home-perms", label: "家目錄裡的設定檔是你的", status: "warn", detail: "x" },
    ],
  )[0].cards.filter((card) => (card.checks ?? []).length > 0);

  assert.equal(envCards[0].checkId, "home-perms", "這張卡要排在整段最前面");
  assert.equal(envCards[0].label, "把被鎖住的設定檔改回你的");
  assert.doesNotMatch(envCards[0].detail ?? "", /讓後面的課堂步驟可以正常進行/);
  ok("那一列有自己的卡片標題與說明，而且排在整段最前面");
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
