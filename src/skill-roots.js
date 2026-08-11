// codex 的 skill 有兩個落點，而且**兩個都會載入**。
//
// 舊版讀 ~/.codex/skills，現在的官方 user 目錄是 ~/.agents/skills。我們一律裝到後者
// （見 config-install.js 的 skillStep），但上過課的機器前者還留著上一輪那份。
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
    // ⚠️ 一行。這一格右邊緊接著就是按鈕。
    detail: `舊位置還有 ${names.length} 個同名 skill，Codex 會兩份都載入`,
    conflicting: names,
  };
}
