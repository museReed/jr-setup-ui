// 後端的分層規則寫成測試，跟 frontend-layers.mjs 同一個用意：寫在文件裡的架構只是
// 建議，寫成測試才擋得住下一個人（包含未來的自己）順手把箭頭接反。
//
// 後端不是 MVC——它不產生畫面，硬套只會得到一個空的 View 層。實際的形狀是
// 「薄轉接頭 + 純領域」（ports and adapters）：
//
//   轉接頭  server.js        HTTP 路由、把請求翻成一次執行
//           run-registry.js  子行程的一生：spawn、接輸出、被中止時怎麼收尾
//           sse.js           事件協定：怎麼把一行輸出送到瀏覽器
//
// run-registry 算轉接頭不算領域：它一手收 http response、一手 spawn，站在兩個外部
// 世界中間，本來就不會是純的。但它只做這件事——路由不在裡面，領域規則也不在。
//   白名單  actions.js  哪些指令允許被跑、參數長什麼樣——這是安全邊界
//   領域    config-install / config-check / env-check / installers / …
//           裝什麼、驗什麼。不知道 HTTP 存在，所以在 Node 裡直接測得動
//   持久化  progress-state.js
//
// 箭頭一律往內：轉接頭 → 白名單 → 領域。反過來就是錯的。
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

function ok(description) {
  console.log(`ok - ${description}`);
}

const SRC = new URL("../src/", import.meta.url);

function read(name) {
  return readFileSync(new URL(name, SRC), "utf8");
}

function importsOf(source) {
  return [...source.matchAll(/from\s+"\.\/([\w-]+)\.js"/g)].map((m) => m[1]);
}

const ADAPTERS = ["server", "run-registry", "sse"];

// 領域＝src 底下扣掉轉接頭的其餘模組。用「列出目錄再扣掉」而不是寫死一張清單：
// 新增一個檔案時它自動被納管，不會因為沒人記得加而漏掉。
const DOMAIN = readdirSync(SRC)
  .filter((name) => name.endsWith(".js"))
  .map((name) => name.replace(/\.js$/, ""))
  .filter((name) => !ADAPTERS.includes(name));

try {
  assert(DOMAIN.includes("config-install"), "領域清單推導壞了");

  // 領域不可以知道 HTTP 存在。一旦它 import 了轉接頭，就再也不能在 Node 裡單獨
  // 測試——而那 400 多條測試能存在，靠的就是這些模組是純的。
  for (const name of DOMAIN) {
    const imports = importsOf(read(`${name}.js`));

    for (const adapter of ADAPTERS) {
      assert(
        !imports.includes(adapter),
        `${name}.js 不可以依賴 ${adapter}.js——那是轉接頭，領域不該知道 HTTP 存在`,
      );
    }
  }
  ok("領域模組不依賴 HTTP 轉接頭");

  // 只有轉接頭能開 server。領域裡冒出一個 http.createServer 就是第二個入口，
  // 而入口是要驗 token 的地方。
  for (const name of DOMAIN) {
    const source = read(`${name}.js`);
    assert(
      !source.includes('from "node:http"'),
      `${name}.js 不可以自己開 HTTP——入口只有 server.js 一個，token 驗證在那裡`,
    );
  }
  ok("HTTP 入口只有一個");

  // 誰可以 spawn 子行程。
  //
  // 這條不是「領域一律不准 spawn」——env-check 與 config-check 的工作本來就是
  // 「跑一下看看裝好了沒」，那是探針不是使用者指令，兩者的差別在於前者的指令是
  // 寫死的、後者來自網路。env-path 則是為了重讀登錄檔。
  //
  // 例外寫死在這裡，就是為了讓「多一個檔案開始 spawn」這件事必須先改測試——改測試
  // 會逼人想一次：這條指令是誰決定的？
  // server.js 不在這張清單裡了：抽出 run-registry 之後它不再自己開子行程，
  // 那是這次重構要換到的東西之一。
  const SPAWNERS = ["run-registry", "env-check", "config-check", "env-path"];

  for (const name of [...DOMAIN, ...ADAPTERS]) {
    if (SPAWNERS.includes(name)) continue;

    assert(
      !read(`${name}.js`).includes("node:child_process"),
      `${name}.js 不在允許 spawn 的清單裡——要開子行程請先想清楚那條指令是誰決定的`,
    );
  }
  ok("能開子行程的模組是一份寫死的清單");

  // 白名單是安全邊界：從網路進來的東西只能挑選 action，不能組出 action。
  //
  // server.js 的 resolveOptions 會把 options 逐個比對 action 自己宣告的白名單，
  // 所以「哪些值合法」必須是 actions.js 說了算。這條擋的是有人在 server.js 裡直接
  // 用 body 的內容組指令、繞過那張表。
  const server = read("server.js");
  assert(
    importsOf(server).includes("actions"),
    "server.js 要從 actions.js 取得可執行的指令表",
  );
  // 真正組指令的地方在 run-registry：它只准從 action 物件上取 cmd/args，
  // 不准直接把請求內容拼進去。
  assert(
    /const command =[\s\S]{0,400}action\.(cmd|buildArgs|args)/.test(
      read("run-registry.js"),
    ),
    "run-registry.js 組指令時要從 action 上取，不可以直接吃請求內容",
  );
  ok("可執行的指令只能來自 actions.js 的白名單");

  // 路由是攻擊面，所以整份要看得完、而且要有人數過。改成表之後這件事斷言得出來
  // ——原本十條 if 散在三百多行裡，沒有任何一處看得到「全部就是這些」。
  //
  // 這張清單變動時要停下來想一次：新的那條驗 token 了嗎？它接不接受請求內容？
  const declared = [
    ...read("server.js").matchAll(/^ {2}"([A-Z]+ \/[\w-]*)": async \(/gm),
  ].map((m) => m[1]);

  assert.deepEqual(declared, [
    "GET /",
    "GET /env",
    "GET /configs",
    "GET /verify-shot",
    "GET /state",
    "POST /state",
    "POST /run",
    "POST /input",
    "POST /cancel",
    "GET /stream",
  ]);
  ok("路由表就是這十條，多一條會被抓到");

  // token 檢查要在路由表之前，不是每個 handler 自己記得做。靜態檔是刻意的例外
  // （<link> 與 import 由瀏覽器自己發請求，補不上查詢字串），它排在更前面。
  const dispatchAt = server.indexOf("const handler = routes[");
  assert(
    server.indexOf("tokenMatches(") < dispatchAt,
    "token 驗證要在派發之前，不能交給各個 handler 自己記得",
  );
  ok("token 驗證擋在路由表前面");

  // sse.js 是最底下那層：它只認識 response 與一行文字。它一旦 import 別人，
  // 就會變成第二個什麼都知道的地方。
  assert.deepEqual(
    importsOf(read("sse.js")),
    [],
    "sse.js 不依賴任何一層——它只是事件格式",
  );
  ok("sse.js 是純協定層，不依賴任何人");
} catch (error) {
  console.log(`not ok - ${error.message}`);
  process.exitCode = 1;
}
