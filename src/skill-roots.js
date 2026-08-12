// codex 的 skill 有兩個落點，而且**兩個都會載入**。
//
// ⚠️ 舊落點那份是**我們自己放的**，不是 codex 官方搬家留下的。查過
// jr_ai_agent_skills 的歷史：2026-07-15 的 `1e9d1bb`（fix(installer): install
// Codex skills in agents directory）之前，那支 installer 就是裝到 ~/.codex/skills；
// 那一版之後才改裝到 ~/.agents/skills，並把舊落點那份搬進 ~/.agents/skill-backups/。
//
// 所以會撞到這件事的是「**7/15 之前上過課、之後沒再重跑過那支 installer**」的機器
// ——不是所有回訪學生。這個嚮導一律裝到 ~/.agents/skills（見 config-install.js 的
// skillStep），不碰舊落點，所以那份會一直留著直到有人清掉。
//
// 2026-08-11 在 Windows VM 上實測 codex 0.147.0：同名時**兩份都列出來、不去重**，
// 由模型當場挑用哪一個。所以這不是「殘留垃圾」——是會讓行為變得不可預測的活躍設定。
// 同一個學生、同一句話，兩次可能拿到不同結果。
//
// ⚠️ 判準是「舊落點有沒有**我們待會兒要裝的**同名 skill」，不是「舊落點有沒有東西」。
// 兩個理由：
//   1. 從第一頁就講得出來——不必等新的裝完才發現打架
//   2. 學生自己放在舊落點的其他 skill 不關我們的事，不順手清別人的東西

export function legacySkillRoot(home) {
  return `${home}/.codex/skills`;
}

export function currentSkillRoot(home) {
  return `${home}/.agents/skills`;
}

// 搬去哪。⚠️ 不能只是改名留在原地——codex 掃的是 skills 底下每一個子目錄，
// 一個叫 handoff.bak.20260811 的目錄照樣會被讀進去，而它 frontmatter 裡的 name
// 仍然是 handoff，衝突原封不動。一定要搬出那個根目錄。
export function quarantineRoot(home) {
  return `${home}/.jr-setup/quarantine/codex-skills`;
}

export function conflictingLegacySkills(legacyNames, ourNames) {
  const ours = new Set(ourNames);

  return legacyNames.filter((name) => ours.has(name)).sort();
}

export function legacySkillStatus(names) {
  if (names.length === 0) {
    return { status: "ok", detail: "沒有跟這次要裝的打架的舊 skill" };
  }

  return {
    status: "warn",
    installable: false,
    fixLabel: "搬走打架的舊 skill",
    // 少數幾支就直接點名——「1 個同名 skill」會讓學生問「哪一個？」，而他在按下
    // 那顆按鈕之前有權知道什麼要被搬走。多到列不完才退回數量。
    // ⚠️ 一行。這一格右邊緊接著就是按鈕。
    detail:
      names.length <= 2
        ? `舊位置的 ${names.join("、")} 會跟這次裝的打架`
        : `舊位置有 ${names.length} 支會跟這次裝的打架`,
    conflicting: names,
  };
}
