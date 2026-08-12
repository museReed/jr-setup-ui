// 隔離區＝前面那兩顆清理鍵把東西搬去的地方。
//
//   ~/.jr-setup/quarantine/codex-skills   舊落點那些會打架的 skill（fix-legacy-skills）
//   ~/.jr-setup/quarantine/npm-cli        上一輪 npm 裝的 claude / codex（fix-legacy-cli）
//
// 那兩顆刻意是「搬」不是「刪」——東西是學生的，可能被他改過，我們沒有資格替他決定
// 丟掉。但搬完之後那份備份就一直躺在那裡，而且沒有任何地方講得出它存在。這一列
// 負責把它講出來，並給一顆真的刪掉的按鈕。
//
// ⚠️ 這一列的出現條件是「兩列清理都已經 ok」，理由不是儀式感：隔離區裡的東西正是
// 那兩顆按鈕搬進去的，它們還沒綠就代表**可能還要搬回來**。在那之前給刪除鍵，等於
// 在退路還用得到的時候把退路收掉。
//
// ⚠️ 只刪 quarantine 這個資料夾底下的東西。同一層的 ~/.jr-setup/merge-backups
// （合併的還原點）與各個 profile 旁邊的 .bak.<時間戳> 都不在範圍內——那是另一件事，
// 而且是唯一能把學生自己寫的規則救回來的東西（Reed 拍板：.bak 不一起刪）。

export function quarantineHome(home) {
  return `${home}/.jr-setup/quarantine`;
}

// 隔離區底下的分區，以及各自是誰搬進去的。列出來的時候要講得出「這是什麼」——
// 一串 codex-skills/handoff-20260811 這種路徑對學生沒有意義。
export const QUARANTINE_AREAS = [
  { dir: "codex-skills", what: "舊版 skill", from: "codex-legacy-skills" },
  { dir: "npm-cli", what: "npm 裝的舊版 CLI", from: "legacy-npm-cli" },
];

// 這一列要看哪幾列的臉色。跟 QUARANTINE_AREAS 的 from 是同一組，分開寫只會有一天
// 加了新分區卻忘了把它的來源列進判準。
export const CLEANUP_CHECK_IDS = QUARANTINE_AREAS.map((area) => area.from);

function cleanupsSettled(checks) {
  const byId = new Map(checks.map((check) => [check.id, check]));

  // 「找不到那一列」也算沒過。學生只選 Codex 時 legacy-npm-cli 仍然會查（那是共用
  // 的前置），但選擇一改、清單一變，這裡寧可少出現一列，也不要在還沒確認的狀態下
  // 給出刪除鍵。
  return CLEANUP_CHECK_IDS.every((id) => byId.get(id)?.status === "ok");
}

// 隔離區裡現在有什麼。fs 從外面注入，判準本身才測得到（跟 shell-wrapper 同一個形狀）。
//
// 只列每個分區底下的第一層：搬進去的單位就是「一個 skill 資料夾」或「一支 shim」，
// 再往下走只會列出一堆學生看不懂的內部檔案。
//
// ⚠️ `list` 對「資料夾不存在」要回 **null**，對「存在但空的」回 []。兩者差很多：
//
//   分區不存在  這台從來沒有東西被搬進隔離區 → 這一列根本不該出現
//   分區是空的  搬過、而且已經清乾淨了      → 這一列要留著，打勾
//
// 分不出來的話，學生按完「清掉隔離區」整張卡就會消失、里程碑少一站（Reed 指定
// 要改掉的正是這個）。而這個判準不需要記任何狀態：那兩個分區資料夾只有在某顆
// 清理鍵真的搬過東西時才會被建出來，清空腳本又只刪裡面的東西、不刪分區本身。
export function quarantineState(home, { list }) {
  let used = false;
  const entries = QUARANTINE_AREAS.flatMap((area) => {
    const dir = `${quarantineHome(home)}/${area.dir}`;
    const names = list(dir);

    if (names === null) {
      return [];
    }

    used = true;
    return names.map((name) => ({
      name,
      what: area.what,
      path: `${dir}/${name}`,
    }));
  });

  return { used, entries };
}

// 回 null＝這一列根本不要出現。兩種情況：從來沒搬過東西進隔離區，或者前面那兩列
// 清理還沒做完。
//
// 「從來沒搬過」不長一列「隔離區：沒有東西」出來是刻意的：那是一句對誰都沒有用的
// 話，而環境段每多一列，學生就多一列要讀。
export function quarantineRow({ used, entries }, checks = []) {
  if (!used || !cleanupsSettled(checks)) {
    return null;
  }

  // 搬過、而且已經清乾淨了。這一列要留著並打勾——不留的話學生按完那顆按鈕，
  // 整張卡連同里程碑會一起消失（Reed 指定要改掉的正是這個）。
  if (entries.length === 0) {
    return { status: "ok", detail: "已經清乾淨了" };
  }

  return {
    // ⚠️ FIX_ACTIONS 看這一項決定給不給按鈕，不是看 status——這一列不管有沒有
    // 東西可刪都是綠的（它不是問題，是可選的收尾）。
    clearable: true,
    // ⚠️ 綠燈不是筆誤。這一列不是問題，是一個「可以順手做」的收尾——判成黃燈的話
    // 環境段永遠不會全綠，學生會被一個他明明沒有毛病的狀態擋在段落閘門外。
    // 按鈕不看 status，所以綠燈照樣掛得上（見 viewmodel 的 envRowModel）。
    status: "ok",
    // ⚠️ 一行，右邊緊接著就是按鈕（守門測試盯著 40 字上限）。
    detail: `搬走的 ${entries.length} 樣還留著，可以刪了`,
    // 按之前先讓他看見要刪什麼。這是唯一一顆真的刪東西的按鈕，而刪掉就回不來了
    // ——所以清單畫在卡片上，不是按下去才在終端機裡追認。
    guidance: {
      symptom: `隔離區裡還留著 ${entries.length} 樣先前搬走的東西`,
      // 一併講「不會動到什麼」。刪除鍵最讓人不敢按的不是「會刪掉這些」，
      // 而是「還會不會順手刪掉別的」——尤其學生剛才才被合併改寫過自己的規則檔。
      expected: "下面這幾樣會被刪掉，合併的還原點與 .bak 不動",
      checks: entries.map((entry) => `${entry.what}：${entry.name}`),
      diagnose: null,
    },
    // ⚠️ 只回名字，不回完整路徑。這一列會整包送到瀏覽器，而路徑裡有學生的使用者
    // 名稱（常常是本名）——「這一頁卡住了」那顆會把畫面上的東西貼到公開的 issue 上。
    // 真正要刪的路徑由 scripts/clear-quarantine.mjs 在本機自己算一次。
  };
}
