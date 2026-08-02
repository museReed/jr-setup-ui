// 前端的分層規則寫成測試。寫在文件裡的架構只是建議，寫成測試才擋得住下一個人
// （包含未來的自己）順手把箭頭接反。
//
//   model      規則本身。誰都不依賴。
//   viewmodel  「畫面該長什麼樣」的判斷。純函式，不碰 DOM、不發請求。
//   view       只操作 DOM。
//   api        只跟 server 講話。
//   app        接線：把 view 的事件、api 的回應、viewmodel 的判斷兜起來。
//
// 箭頭一律往內：view / viewmodel / api / app → model。反過來就是錯的。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function ok(description) {
  console.log(`ok - ${description}`);
}

function read(name) {
  return readFileSync(new URL(`../public/${name}`, import.meta.url), "utf8");
}

function importsOf(source) {
  return [...source.matchAll(/from\s+"\.\/([\w-]+)\.js"/g)].map((m) => m[1]);
}

try {
  const files = {
    model: read("model.js"),
    viewmodel: read("viewmodel.js"),
    view: read("view.js"),
    api: read("api.js"),
    app: read("app.js"),
  };

  // domain 不依賴任何人——它一旦 import 別層，就不再是「規則本身」而是黏著劑。
  assert.deepEqual(importsOf(files.model), []);
  ok("model 不依賴任何一層");

  // 資料層往回依賴呈現層是最容易發生的那種反向箭頭：api 需要一個「合法的查詢字串」，
  // 而那個函式剛好住在 viewmodel 裡，import 一下就通了——通了，架構也就散了。
  assert(
    !importsOf(files.api).includes("viewmodel"),
    "api 不可以依賴 viewmodel——需要的規則放 model",
  );
  assert(
    !importsOf(files.api).includes("view"),
    "api 不可以依賴 view",
  );
  ok("api 只往內依賴 model");

  // ViewModel 要能在 Node 裡直接單元測試，所以碰不得 DOM，也不能自己發請求。
  for (const forbidden of [
    "document.",
    "window.",
    "getElementById",
    "querySelector",
    "fetch(",
    "EventSource",
  ]) {
    assert(
      !files.viewmodel.includes(forbidden),
      `viewmodel 不可以出現 ${forbidden}——那是 view 或 api 的事`,
    );
  }
  assert(!importsOf(files.viewmodel).includes("view"));
  assert(!importsOf(files.viewmodel).includes("api"));
  ok("viewmodel 是純函式：不碰 DOM、不發請求、不依賴 view/api");

  // View 只畫畫面：要發請求就是把 api 的能力搬進了 DOM 層。
  assert(!importsOf(files.view).includes("api"), "view 不可以直接打 API");
  assert(!files.view.includes("fetch("), "view 不可以直接 fetch");
  ok("view 只操作 DOM，不自己打 API");

  // app 是接線層，本身不該直接碰 DOM——碰了就會慢慢長出第二個 view。
  for (const forbidden of ["document.getElementById", "querySelector"]) {
    assert(
      !files.app.includes(forbidden),
      `app 不可以直接操作 DOM（${forbidden}），那是 view 的事`,
    );
  }
  ok("app 只接線，DOM 操作留在 view");

  // 把 viewmodel 的函式「本身」當參數傳出去，幾乎都是漏了呼叫。
  // 實際踩過：sectionStatus(cards, completedCardIds, index) 少了一層括號，
  // 於是 sectionStatus 拿到函式去呼叫 .has()，畫面停在「正在檢查目前進度」，
  // 錯誤只在瀏覽器 console 出現。單元測試餵的是 Set，走不到這條呼叫路徑，
  // 所以只能從 app.js 的原始碼守。
  const viewmodelExports = [
    ...files.viewmodel.matchAll(/export function (\w+)/g),
  ].map((m) => m[1]);
  const appBody = files.app.slice(files.app.indexOf('} from "./viewmodel.js";'));
  for (const name of viewmodelExports) {
    assert(
      !new RegExp(`^\\s*${name},\\s*$`, "m").test(appBody),
      `app.js 把 viewmodel 的 ${name} 當值傳出去了——少了呼叫的括號？`,
    );
  }
  ok("app.js 傳的是 viewmodel 的計算結果，不是函式本身");

  // 清單第一格餵的是沒有眼睛別名的原始 verifiedSteps。餵成 effectiveVerifiedSteps()
  // 算出來的那份，學生取消眼睛勾選時第一格會跟著退勾，看起來像整張卡被重置。
  assert(
    files.app.includes("rowVerified: state.verifiedSteps.has(check.id)"),
    "清單第一格不能吃 effectiveVerifiedSteps() 的眼睛別名",
  );
  ok("清單第一格只認程式那半的驗證，不跟著眼睛勾選動");

  // 重驗那顆按鈕的字由 app 決定：env 卡是「再 check 一次」（重掃環境），config 卡是
  // 「重跑驗證」（真的開終端跑）。view 只負責畫，寫死在 view 裡就沒得分。
  assert(files.view.includes("model.retestText"), "重驗按鈕的字要由 model 帶進來");
  assert(files.app.includes('retestText: card.kind === "env"'));
  ok("重驗按鈕的字跟著卡片種類走，不是寫死在 view 裡");

  // 去重只擋文字，不能連轉圈圈一起擋掉。環境卡按「再 check 一次」印的字跟上一次
  // 一樣，整個 renderLoaders 被擋住，畫面一個字都沒動——學生只會以為按鈕壞了。
  const renderLoadersBody =
    files.view.match(/export function renderLoaders\([^)]*\)\s*\{[\s\S]*?\n\}/)?.[0] ??
    "";
  assert(
    /acceptsTerminalLine\(spec\)\)\s*\{[\s\S]*terminal-loader-line[\s\S]*loader\.hidden = false/.test(
      renderLoadersBody,
    ),
    "renderLoaders 遇到重複的字時仍要把轉圈圈掛回最後那一行",
  );
  ok("重複的進度字不再連轉圈圈一起吞掉");

  // 學生自己按的重掃要在終端留下頭尾兩句話。自動跑的那些（開頁、裝完接著跑）不講，
  // 否則每裝一個東西就多兩行雜訊。
  assert(files.app.includes('checkEnvironment(true, { manual: true })'));
  assert(files.app.includes("正在重新檢查環境狀態。"));
  assert(files.app.includes("環境檢查完成，狀態已更新。"));
  ok("學生按的環境重掃會在終端說開始與結束");

  // 終端是「現在正在做什麼」，學生的每個動作都要在裡面留下一句話。勾一格卻什麼都
  // 沒發生的話，學生不知道那一勾有沒有被記住。
  for (const [snippet, what] of [
    ["已勾選", "人工項目勾選"],
    ["取消勾選", "人工項目取消"],
    ["貼上的代碼對上了", "貼上證明"],
    ["現在這張：", "換卡"],
  ]) {
    assert(files.app.includes(snippet), `${what}要在終端留一句話`);
  }
  ok("勾選、貼上、換卡都會在終端留一句話");

  // server 沒把新檔案加進靜態白名單的話，瀏覽器載入時 404，而畫面只會整片空白。
  const server = readFileSync(
    new URL("../src/server.js", import.meta.url),
    "utf8",
  );
  for (const name of Object.keys(files)) {
    if (name === "app") continue; // app.js 也在白名單裡，下面一起檢查
    assert(
      server.includes(`"/${name}.js"`),
      `server 的靜態白名單少了 /${name}.js`,
    );
  }
  assert(server.includes('"/app.js"'));
  ok("每一層的檔案都在 server 的靜態白名單裡");

  assert(!files.view.includes('classList.toggle("is-active", station.current)'));
  assert(files.view.includes('addEventListener("mouseenter"'));
  assert(files.view.includes('addEventListener("mouseleave"'));
  ok("里程碑預覽只在 hover 時切換 is-active");

  const index = readFileSync(
    new URL("../public/index.html", import.meta.url),
    "utf8",
  );
  assert.match(
    index,
    /id="config-choice-panel" class="config-choice-panel"/,
  );
  assert(files.view.includes("body.append(elements.configChoicePanel)"));
  ok("設定 chips 與下一張按鈕共用同一張 ds-card");

  const styles = read("styles.css");
  assert.match(
    styles,
    /\.terminal-column \.terminal-title\s*\{[^}]*color: var\(--term-ink-dim\);/,
  );
  ok("終端標題使用設計系統的暗底次要文字色");

  // .ds-term-bar / .ds-term-title 在設計系統裡不存在，用了就是沒樣式的裸 div，
  // 標題會貼在圓角外被切掉。終端的頂欄只能用 .ds-term-chrome。
  assert(!index.includes("ds-term-bar"));
  assert(!index.includes("ds-term-title"));
  assert.match(index, /class="ds-term-chrome"/);
  ok("終端頂欄用設計系統真的有的 .ds-term-chrome");

  // 設計系統的 .ds-btn 沒有 disabled 樣式，置灰得靠本 repo 的 .is-done。
  // 契約檔禁止覆寫既有 ds-* selector，所以選擇器裡不能出現 .ds-btn。
  assert.match(styles, /^\.is-done\s*\{[^}]*cursor: not-allowed;/m);
  assert.doesNotMatch(styles, /\.ds-btn[\w-]*:disabled/);
  ok("已完成按鈕用本 repo 的 .is-done 置灰，沒覆寫設計系統 selector");

  // 收合是兩種狀態的切換，不做動畫。tab 只有 hover 換色會動——padding / max-height /
  // box-shadow 一旦加了過渡，看起來就像跟著捲動距離漸變。
  const tabRule = styles.match(/^\.section-tab \{[^}]*\}/m)?.[0] ?? "";
  assert.match(tabRule, /transition:\s*\n?\s*color[^;]*;/);
  assert.doesNotMatch(tabRule, /transition:[^;]*padding/);
  assert.doesNotMatch(
    styles.match(/^\.section-tabs \{[^}]*\}/m)?.[0] ?? "",
    /transition:/,
  );
  ok("tab 收合不做動畫，只有 hover 換色有過渡");

  // 段落導覽是上方 tab，不是側欄；整頁大標已移除。
  assert(!index.includes("wizard-header"));
  assert(!index.includes("wizard-sidebar"));
  assert.match(index, /<nav id="section-nav" class="section-tabs"/);
  ok("段落導覽改成上方 tab，整頁大標已移除");
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
