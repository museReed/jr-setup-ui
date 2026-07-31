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

  // 段落導覽是上方 tab，不是側欄；整頁大標已移除。
  assert(!index.includes("wizard-header"));
  assert(!index.includes("wizard-sidebar"));
  assert.match(index, /<nav id="section-nav" class="section-tabs"/);
  ok("段落導覽改成上方 tab，整頁大標已移除");
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
