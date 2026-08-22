import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { actions } from "../src/actions.js";
import { CARD_GATES, MANUAL_STEPS } from "../public/model.js";

import {
  applyGhosttyBlock,
  applyZshBlock,
  GHOSTTY_MARKER,
  ghosttyBlock,
  ghosttyConfigRow,
  ghosttyConfigStatus,
  zshBlock,
  ZSH_MARKER,
} from "../src/ghostty-config.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

try {
  const config = ghosttyBlock();
  // 註解裡會提到 no-title / no-notify 這些字（那正是在解釋為什麼要設）。判定要看的是
  // 真正生效的那幾行，所以先把註解濾掉——不濾的話測試會被自己的說明文字騙過去。
  const directives = config
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");

  // ⚠️ 這一條守的是「auto-rename 不會被終端機自己蓋掉」。
  //
  // Ghostty 的 shell integration 預設清單裡有 title——它會在每一次 prompt 把標題改成
  // 目前的指令或目錄，而那正好蓋掉命名 hook 寫進去的名字。沒有這一行的話，「分頁自己
  // 報上名字」那張卡在 Ghostty 上會變成「名字閃一下就沒了」。
  assert.match(directives, /shell-integration-features\s*=/);
  assert.match(directives, /no-title/);
  assert.doesNotMatch(
    directives,
    /shell-integration-features\s*=\s*[^\n]*[^-]\btitle\b/,
    "清單裡不能留下沒有被 no- 否定掉的 title",
  );
  ok("關掉 Ghostty 自己的標題功能，命名 hook 寫的名字才留得住");

  // 通知要三行一起才成立。最容易漏的是 action 那行——它的預設是 bell,no-notify，
  // 只設前兩行的話只會響鈴，桌面通知永遠不出現。
  assert.match(directives, /notify-on-command-finish\s*=\s*unfocused/);
  assert.match(directives, /notify-on-command-finish-after\s*=/);
  assert.match(directives, /notify-on-command-finish-action\s*=\s*[^\n]*\bnotify\b/);
  assert.doesNotMatch(directives, /no-notify/);
  ok("通知三行都在，而且 action 沒有停在預設的 no-notify");

  assert.match(directives, /maximize\s*=\s*true/);
  ok("一開就最大化，標題列與分頁列不會消失");

  // ⚠️ 只解掉全螢幕那兩顆。學生會用到的那三顆不能被波及：
  //
  //   cmd+d            分割視窗（new_split:right）
  //   cmd+w            關掉這一格（close_surface）
  //   cmd+shift+enter  把這一格放到最大（toggle_split_zoom）
  //
  // 它們是 Ghostty 的預設鍵，我們不重綁也不解綁——這條測試防的是「以後有人為了別的
  // 需求往這個區塊加 unbind，順手把學生天天在用的鍵關掉」。
  const unbound = [...directives.matchAll(/keybind\s*=\s*([^=\n]+)=unbind/g)].map(
    (match) => match[1].trim(),
  );
  assert.deepEqual(unbound.sort(), ["cmd+ctrl+f", "cmd+enter"]);

  for (const key of ["cmd+d", "cmd+w", "cmd+shift+enter"]) {
    assert.doesNotMatch(
      directives,
      new RegExp(`keybind\\s*=\\s*${key.replaceAll("+", "\\+")}=`),
      `${key} 是學生天天在用的鍵，這個區塊不該碰它`,
    );
  }
  ok("只解掉全螢幕那兩顆，cmd+d / cmd+w / cmd+shift+enter 原封不動");

  // 拖資料夾進來按 Enter 就跳過去——zsh 原生的選項，不需要 oh-my-zsh。
  assert.match(zshBlock(), /setopt auto_cd/);
  ok("zsh 那半只做一件事：auto_cd");

  // 三態。學生上一輪裝過舊版的話，只看標記在不在會給綠燈，而他手上是舊設定——
  // 那正是 tab-sync 踩過的假綠燈。
  assert.equal(
    ghosttyConfigStatus({ configText: "", zshrcText: "" }).status,
    "missing",
  );
  assert.equal(
    ghosttyConfigStatus({
      configText: applyGhosttyBlock(""),
      zshrcText: applyZshBlock(""),
    }).status,
    "ok",
  );
  assert.equal(
    ghosttyConfigStatus({
      configText: `# >>> ${GHOSTTY_MARKER} >>>\nmaximize = true\n# <<< ${GHOSTTY_MARKER} <<<`,
      zshrcText: applyZshBlock(""),
    }).status,
    "warn",
    "標記在但內容是舊版時不能給綠燈",
  );
  assert.equal(
    ghosttyConfigStatus({
      configText: applyGhosttyBlock(""),
      zshrcText: `# >>> ${ZSH_MARKER} >>>\n# <<< ${ZSH_MARKER} <<<`,
    }).status,
    "warn",
    "兩個檔案任何一邊是舊版都不算完成",
  );
  ok("三態：沒設過、設過但舊版、都是最新的");

  // 學生自己的設定不能被洗掉——重跑安裝只換我們那一段。
  const mine = "font-size = 22\ntheme = catppuccin\n";
  const once = applyGhosttyBlock(mine);
  const twice = applyGhosttyBlock(once);
  assert.equal(once, twice, "重複套用要是同一個結果");
  assert.match(twice, /font-size = 22/);
  assert.match(twice, /theme = catppuccin/);
  ok("只換我們那一段，學生原本的設定留著，重跑也不會疊加");

  assert.equal(ghosttyConfigRow({ configText: "", zshrcText: "" }).id, "ghostty-config");
  ok("那一列的 id 跟 env-check 與 FIX_ACTIONS 對得上");

  // 通知那一格是人工項：macOS 的通知權限是 TCC 保護的，程式點不動。它要三個東西
  // 對得起來才畫得出按鈕——少任何一個都是「勾選框在、按鈕不見了」，而學生會以為
  // 自己要憑空找到系統設定。
  const gate = CARD_GATES.ghostty;
  assert.equal(gate.length, 1);
  assert.equal(gate[0].id, "ghostty-notify");

  const step = MANUAL_STEPS[gate[0].stepId];
  assert.ok(step, `${gate[0].stepId} 沒有登記在 MANUAL_STEPS，那一步不會有按鈕`);
  assert.equal(typeof step.buttonText, "string");

  // 那顆按鈕走的是 verify-in-terminal（app.js 的 onOpenStep 寫死的），所以 case
  // 名字必須在白名單裡，否則按下去會被 action 層擋掉。
  assert.ok(
    actions["verify-in-terminal"].options.case.includes(step.action),
    `${step.action} 不在 verify-in-terminal 的 case 白名單裡`,
  );

  // ⚠️ 它不叫 agent。沒登記進 NO_AGENT_CASES 的話，「還沒裝 Codex」的學生會被那支
  // 探測擋在一個根本不需要 Codex 的步驟前面。
  const verifySource = readFileSync(
    new URL("../scripts/verify-in-terminal.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    verifySource,
    new RegExp(`NO_AGENT_CASES = new Set\\([^)]*"${step.action}"`),
    `${step.action} 要登記進 NO_AGENT_CASES`,
  );
  ok("通知那一格：人工項、按鈕、case 白名單、不叫 agent，四邊對得上");
} catch (error) {
  console.error(error);
  process.exit(1);
}
