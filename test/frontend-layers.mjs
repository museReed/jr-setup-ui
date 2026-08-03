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

  // 開視窗的按鈕搬進清單、掛在它負責的那一步旁邊。留在 paste-proof 裡的話學生
  // 仍然要自己配對哪顆帶他做哪一格。
  const cardStyles = read("styles.css");
  assert(!files.view.includes("paste-proof-actions"));
  assert(files.view.includes("checklist-step"));
  assert(!cardStyles.includes(".paste-proof-actions"));
  assert.match(cardStyles, /^\.checklist-step \{/m);
  ok("開視窗的按鈕掛在清單裡它負責的那一步旁邊");

  // 登入那一塊也掛回它對應的那一格底下。原本畫在清單外面、按鈕列的下方，學生要
  // 自己把「未登入」跟下面那顆授權按鈕連起來（VM 實測 Claude Code 那張）。
  assert.match(
    files.view,
    /item\.id === `system-\$\{login\.authCheckId\}`/,
  );
  assert(files.view.includes("!loginInChecklist && model.login !== null"));
  assert.match(cardStyles, /^\.ds-checklist \.login-hints \{/m);
  ok("登入那一塊掛在「登入狀態」那一格底下");

  // 每張卡各有一份終端內容。共用一份的話，換一張卡就看到上一張的驗證訊息——
  // 那些話講的是別的東西，留著只會讓學生以為現在這張已經跑過了。
  for (const name of ["showTranscript", "pinTranscript", "unpinTranscript"]) {
    assert(
      files.view.includes(`export function ${name}`),
      `view 要有 ${name}——終端內容分張存`,
    );
    assert(files.app.includes(`view.${name}(`), `app 要呼叫 ${name}`);
  }
  // 換卡時先切終端再講話，不然「現在這張」會落在上一張的那一份裡。
  assert.match(
    files.app,
    /view\.showTranscript\(card\.checkId\);\s*\n\s*view\.addLine\(`現在這張/,
  );
  // 跑一輪只換掉原始輸出。連白話那幾行一起清的話，翻回這張卡就看不到當時的紀錄，
  // 而且按「重跑驗證」時剛印的那句話會被自己的執行清掉。
  assert(files.app.includes("view.clearRawOutput()"));
  assert(!files.view.includes("export function clearOutput"));
  ok("終端內容分張存，跑一輪只換掉原始輸出");

  // 「重掃中」要在結果回來的那一刻關掉，然後才畫。留到 finally 才關的話，那次
  // renderWizard 畫的還是退勾的清單，而後面沒有人再畫一次——畫面停在「0 / 1、
  // 但徽章寫已完成」（VM 實測 Node.js 那張）。
  assert.match(
    files.app,
    /state\.manualRecheck = false;\s*\n\s*renderWizard\(\);/,
  );
  // 環境檢查是一支 HTTP 請求，沒有逐字稿。把每一列的結果寫進原始輸出，那塊才不是空的。
  assert(files.app.includes("view.addRawLine("));
  ok("環境重掃畫完才關掉退勾狀態，原始輸出也留得下結果");

  // 鎖住的分頁原本只是淡一點——淡的東西看起來像「還沒載入」或「壞掉」，不像
  // 「做完前面才會開」。鎖頭一眼就說得清楚。
  assert(files.view.includes("section-tab-lock"));
  ok("鎖住的分頁在標題前面畫一個鎖頭");

  // 進度條上那隻從左邊外面滾進來，換段時從右邊外面滾出去。兩個位置都要超出
  // 0% / 100%——停在 0% 是「站在第一個點左邊一點」，看起來像被截斷。
  assert(files.view.includes("const CAT_ENTER_FROM = -8;"));
  assert(files.view.includes("const CAT_EXIT_TO = 108;"));
  assert.match(files.view, /firstPaint \|\| sectionChanged/);
  // 收手的計時器只在真的重開一輪進出場時清掉。無條件清的話，環境檢查期間的每次
  // 重畫都會把「滾完了要收手」那一刀清掉，牠就一直轉下去（實際踩到）。
  assert.match(
    files.view,
    /firstPaint \|\| sectionChanged\)\) \{\s*\n(\s*\/\/[^\n]*\n)*\s*window\.clearTimeout\(catTimer\);/,
  );
  // 搬到畫面外面時不能有過渡，不然「搬過去」跟「滾回來」會被合併成一次。
  assert(files.view.includes("classList.add(\"no-transition\")"));
  assert.match(cardStyles, /\.ds-pbar--milestones \.ds-duck\.no-transition \{\s*\n\s*transition: none;/);
  // 滾動掛在裡面那層：外層已經用 transform 做水平翻轉，兩個 transform 不能疊在
  // 同一個元素上。
  assert.match(cardStyles, /\.is-rolling \.milestone-cat-art \{\s*\n\s*animation: cat-roll/);
  assert.match(cardStyles, /^\.milestone-cat \{[^}]*transform: scaleX\(-1\);/m);
  ok("進度條上那隻從左邊滾進來、換段時從右邊滾出去");

  // 鎖頭是常駐的三態指示，不是一次性的慶祝動畫：鎖著、開了、打勾各停在動畫的
  // 一格。所以它不能再淡出——淡掉的話「這一段做完了」在分頁上就沒有痕跡了。
  assert.match(cardStyles, /\.section-tab > \.section-tab-lock \{\s*\n\s*display: block;/);
  assert(!cardStyles.includes("tab-unlock-fade"));
  assert(files.view.includes("const LOCK_CLOSED_FRAME = 32;"));
  assert(files.view.includes("const LOCK_OPEN_FRAME = 60;"));
  assert(files.view.includes("const LOCK_DONE_FRAME = 140;"));
  assert.match(files.view, /startFrame: LOCK_CLOSED_FRAME/);
  assert.match(
    files.view,
    /playSegments\(\[LOCK_FRAMES\[previous\], frame\], true\)/,
  );
  // 「開了但還沒做完」跟「做完了」是兩態。先看鎖再看做完沒——一段可以開了還沒
  // 做完，但不可能做完了還鎖著。done 是 undefined（資料還沒回來）時不給打勾。
  assert.match(files.view, /if \(lockStates\[id\]\?\.locked === true\) return "locked";/);
  assert.match(files.view, /done\?\.\[id\] === true \? "done" : "open"/);
  assert(files.app.includes("view.renderSectionLocks(lockStates, done)"));

  // 動畫只在「真的換了一態」那一刻放。每次重畫都放的話，光是勾一個項目就會炸
  // 一次煙火；第一次畫（previous 是 null）也不放，一開頁就慶祝學生不知道在慶祝什麼。
  assert.match(files.view, /const previous = renderedLocks\?\.\[id\] \?\? null;/);
  // 只往前演、只往前慶祝。往回退（換了工具選項害某一段又鎖回去）不是成就，而且
  // lottie 的 playSegments 只往前播——餵一段反向的區間會停在中間某一格不動。
  assert.match(
    files.view,
    /LOCK_STATES\.indexOf\(state\) > LOCK_STATES\.indexOf\(previous\)/,
  );
  assert(files.view.includes('const LOCK_STATES = ["locked", "open", "done"];'));

  // 剛達成解鎖條件時不放開鎖動畫：學生人在別的分頁上做事，演完他也沒看到——
  // 而那正是最需要讓他知道的一件事。改成放大兩倍加輕微搖晃，一直招手到他點進來。
  assert.match(files.view, /previous === "locked" && state === "open"/);
  assert(files.view.includes("pendingUnlock.add(id);"));
  // 招手期間要餵 locked 給 playLockTo，餵真的 state 它就直接跳到開鎖那一格，
  // 學生點進來也沒東西可演。
  assert.match(
    files.view,
    /playLockTo\(button, pending \? "locked" : state, pending \? null : previous\)/,
  );
  // 開鎖動畫在點下去那一刻才放，而且演完才縮回原尺寸。
  assert.match(files.view, /openPendingLock\(button\);\s*\n\s*handler\(/);
  assert.match(files.view, /animation\.addEventListener\("complete", shrink\)/);
  // 演的那 0.6 秒不要碰它：renderSectionLocks 每次重畫都會跑，這時餵 open 就是
  // goToAndStop 到最後一格，動畫演到一半被切掉。
  assert.match(
    files.view,
    /if \(!lock\?\.classList\.contains\("is-opening"\)\) \{/,
  );
  assert.match(cardStyles, /\.section-tab-lock\.is-announcing \{\s*\n\s*animation: lock-wave/);
  assert.match(cardStyles, /@keyframes lock-wave \{[\s\S]*?scale\(2\)/);
  assert.match(cardStyles, /\.section-tab-lock\.is-opening \{\s*\n\s*transform: scale\(2\);/);
  assert(files.view.includes("if (reducedMotion.matches) return;"));
  assert.match(cardStyles, /@keyframes tab-unlock-shake/);
  // 慶祝用的動畫要尊重系統設定：關掉不影響理解。減少動態時鎖頭直接跳到該停的
  // 那一格，狀態還是看得到——那是資訊，不是慶祝。
  assert.match(files.view, /if \(!forward \|\| reducedMotion\.matches\) \{/);
  assert.match(
    cardStyles,
    /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.section-tab\.is-unlocking/,
  );
  ok("分頁鎖頭是三態指示，只在真的換態時演，且尊重減少動態設定");

  // 鎖狀態要跟著每一次重畫一起算。原本只有勾選、換工具、點分頁才重算，於是最後
  // 一張卡驗過的當下沒有人去看鎖——下一段其實開了，畫面還鎖著，開鎖動畫也就永遠
  // 錯過那一刻（VM 實測）。
  assert.match(
    files.app,
    /renderControls\(\);\s*\n(\s*\/\/[^\n]*\n)*\s*const lockStates = renderNavigation\(\);/,
  );
  ok("每次重畫卡片都跟著重算分頁的鎖");

  // 合併的卡有兩份設定：裝完第一份要接著裝第二份，兩份都好了才輪到驗證。順序反了
  // 的話，驗的是只裝了一半的狀態。
  assert.match(
    files.app,
    /if \(sibling !== null\) \{[\s\S]*?return;\s*\n\s*\}\s*\n\s*if \(followUp === "auto"\)/,
  );
  // 安裝按鈕對著還沒好的那一份，驗證仍然掛在主 check 上。
  assert(files.app.includes("runConfigCheckAction(rowCheck, action, button, extra)"));
  assert.match(files.app, /configRowModel\(rowCheck,/);
  ok("合併卡先把兩份都裝完才驗證，按鈕對著還沒好的那一份");

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

  // 小鴨抵達時自己跳出來的那張預覽三秒後自己收掉：它是報喜用的，不是要學生讀完
  // 的東西，留著會蓋住下一張卡的標題。滑鼠移上去就取消倒數——那代表學生在讀。
  assert.match(files.view, /closePreviewAt = Date\.now\(\) \+ 3000/);
  assert.match(files.view, /pin\(point, key\);\s*\n\s*autoUnpin\(point\);/);
  assert(files.view.includes('preview.addEventListener("mouseenter", keepPreviewOpen)'));
  // 記的是「收掉的時刻」而不是「還剩幾秒」：renderWizard 跑得很勤，每次重畫都會
  // 清掉計時器再重新釘住——只記剩餘秒數的話那三秒永遠重新開始，預覽再也不會關
  //（VM 實測：驗證中的卡片，預覽一直掛著）。
  assert.match(files.view, /const left = closePreviewAt - Date\.now\(\)/);
  assert.match(
    files.view,
    /pin\(point, nextKey\);\s*\n\s*scheduleUnpin\(point\);/,
  );
  ok("抵達時跳出的預覽三秒後自己收掉，重畫也不會把倒數洗掉");

  // 翻頁按鈕釘在畫面兩側，不在卡片裡：每張卡高度不同，放在卡片裡按鈕就會上下跳，
  // 學生每翻一張都要重新找它在哪。
  const cardIndex = readFileSync(
    new URL("../public/index.html", import.meta.url),
    "utf8",
  );
  assert(cardIndex.includes('id="wizard-prev"'));
  assert(cardIndex.includes('id="wizard-next"'));
  assert(!files.view.includes('next.textContent = "下一張"'));
  // 自成一列排在卡片下方，左右各自貼齊卡片與終端的外緣。只剩一顆時另一顆的位置
  // 不能跑掉——所以兩顆各自用 auto margin 推到底，不是靠 space-between 分配。
  assert.match(cardStyles, /^\.wizard-nav-row \{[^}]*justify-content: space-between;/m);
  assert.match(cardStyles, /^\.wizard-nav--prev \{\s*margin-right: auto;/m);
  assert.match(cardStyles, /^\.wizard-nav--next \{\s*margin-left: auto;/m);
  ok("翻頁按鈕自成一列排在卡片下方，左右貼齊外緣");

  // 只有「往前」那顆值得慶祝——回頭的那顆出現不是成就，只是「你可以往回看」。
  assert.match(files.view, /key === "next" && !reducedMotion\.matches/);
  assert(files.view.includes("shownNav[key]"));
  ok("下一張剛出現時晃一下加煙火，上一張不慶祝");

  // 走到一段的最後一張，「下一張」換成「下一段：⋯」，點下去落在新那段的第一張。
  assert(files.app.includes("下一段："));
  assert.match(files.app, /goToSection\(nextSection\.id, "first"\)/);
  ok("一段做完時翻頁按鈕帶去下一段的第一張");

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

  // .ds-term--typing 這個 component 唯一看得出來的地方就是那顆閃爍游標。我們一直
  // 掛著那個 class 卻從來沒把游標畫出來，右邊那個終端看起來像截圖不像活的視窗。
  assert.match(index, /class="ds-term ds-term--typing/);
  assert(files.view.includes('cursor.className = "ds-term-cursor"'));
  // 掛著轉圈圈的那一行不放游標——兩個東西同時在動只是雜訊。
  assert.match(files.view, /last\.querySelector\("\.row-loader"\) !== null/);
  ok("會動的終端補上 .ds-term-cursor，轉圈圈那一行讓位");

  // 新的一行逐字打出來。三條規矩都是為了「動畫不能拖慢真的進度」：排隊超過三行
  // 就整批印完（驗證一次會噴很多行）、系統設了減少動態就不演、翻回舊卡片的紀錄
  // 直接印（那是歷史，不是正在發生的事）。
  assert(files.view.includes("typeInto(line, spec.text)"));
  assert.match(files.view, /TYPING_CHARS_PER_SECOND = 20/);
  assert.match(files.view, /if \(typingQueue\.length > 3\) \{\s*\n\s*flushTyping\(\);/);
  assert.match(
    files.view,
    /function typeInto\([^)]*\) \{\s*\n\s*if \(reducedMotion\.matches\)/,
  );
  assert.match(
    files.view,
    /function paintTranscript\([^)]*\) \{\s*\n(\s*\/\/[^\n]*\n)*\s*flushTyping\(\);/,
  );
  ok("終端逐字打字，但排太多、關動畫、翻舊紀錄時直接印完");

  // 轉圈圈那幾行也要打字。字放在自己的 <span> 裡，轉圈圈掛在它旁邊——打字是直接寫
  // textContent，寫在整行上的話每打一個字就把轉圈圈清掉一次。
  assert.match(
    files.view,
    /const text = document\.createElement\("span"\);[\s\S]*?typeInto\(text, spec\.text\)/,
  );
  ok("正在跑的那幾行也逐字打，轉圈圈不會被洗掉");

  // 這張卡還沒完成，「重跑驗證」就是現在該按的那顆。原本看那一列的狀態，於是驗證
  // 失敗、正在跑、或狀態是別的值時按鈕就退回空心（VM 實測 tab-sync 那張）。
  assert(files.app.includes("retestPrimary: card.kind !== \"env\" && !cardDone"));
  ok("卡片沒完成時，重跑驗證一律是主要動作");

  // 卡片裡「照原樣印給你對照」的那幾行也畫成終端，不再是一個裸的 <code>。
  assert(files.view.includes('term.className = "ds-term card-hints-term"'));
  assert(!files.view.includes("card-hints-block"));
  assert.match(cardStyles, /^\.card-hints-term \.ds-term-line \{/m);
  ok("卡片裡的提示區塊改用設計系統的靜態終端");

  // 會按的按鈕一律用灌色按鈕（.ds-btn-fill），而且每顆前面都有一個 icon。設計系統
  // 只給了品牌 logo，沒有通用的動作 icon，所以 icon 自己畫、集中在一張表裡。
  assert(files.view.includes("function fillButton("));
  assert(files.view.includes("const ICONS = {"));
  assert(!files.view.includes("ds-btn ds-btn-primary ds-btn-sm"));
  assert(!files.view.includes("ds-btn-secondary"));
  // 彈窗那兩顆維持原本的實心／幽靈按鈕：它是一個「二選一」的問句，兩顆並排的
  // 空心藥丸看起來像同一個選項的兩半（VM 實測）。
  assert.match(cardIndex, /id="verify-modal-confirm" class="ds-btn ds-btn-primary"/);
  assert.match(cardIndex, /id="verify-modal-later" class="ds-btn ds-btn-ghost"/);

  for (const id of ["recheck-configs", "recheck-env", "cancel"]) {
    assert.match(
      cardIndex,
      new RegExp(`id="${id}" class="ds-btn-fill[^"]*"[^>]*>\\s*<svg`),
      `${id} 要是灌色按鈕而且帶 icon`,
    );
  }
  // 翻頁那兩顆也是灌色按鈕，長相交給 .ds-btn-fill，styles.css 只管它們站在哪。
  // 兩顆都預先灌滿：空心那顆並排時看起來像停用的（Reed 指定統一）。
  assert.match(cardIndex, /id="wizard-prev" class="ds-btn-fill is-primary wizard-nav/);
  assert.match(cardIndex, /id="wizard-next" class="ds-btn-fill is-primary wizard-nav/);
  assert.doesNotMatch(cardStyles, /^\.wizard-nav \{/m);
  ok("會按的按鈕都是灌色按鈕，每顆前面都有 icon");

  // 灌滿之後字是白的。設計系統預設把字轉成深色，在橘色底上像沒對比的髒色；而且
  // 實心的按鈕不需要再畫一圈同色外框，那只會在邊緣多一道深色（VM 實測）。
  assert.match(cardStyles, /^\.ds-btn-fill \{\s*\n\s*--fill-ink: #fff;/m);
  assert.match(cardStyles, /^\.ds-btn-fill\.is-primary \{[^}]*border-color: transparent;/m);
  ok("灌滿之後字是白的，而且不留外框");

  // 換字只換裡面那個 <span>。整顆 textContent 洗掉的話，前面那個 icon 會一起不見。
  assert(files.view.includes("export function setButtonLabel"));
  assert(!files.app.includes('button.textContent = "已複製"'));
  ok("按鈕換字不會把 icon 洗掉");

  // 設計系統的 .ds-btn 沒有 disabled 樣式，置灰得靠本 repo 的 .is-done。
  // 契約檔禁止覆寫既有 ds-* selector，所以選擇器裡不能出現 .ds-btn。
  //
  // .ds-btn-fill 是另一個元件、另一個缺口：它同樣沒有 disabled 樣式，而它現在是
  // 卡片上真正在按的那些按鈕（跑東西的時候整排會被鎖住）。沒有樣式的話，鎖住跟
  // 沒鎖住長得一模一樣，學生會一直按。所以只放行這一個。
  assert.match(styles, /^\.is-done\s*\{[^}]*cursor: not-allowed;/m);
  assert.doesNotMatch(styles, /\.ds-btn(-primary|-ghost|-sm|-dark|-secondary)?:disabled/);
  assert.match(styles, /^\.ds-btn-fill:disabled \{[^}]*cursor: not-allowed;/m);
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

  // ── 導覽（driver.js）─────────────────────────────────────────────
  //
  // driver 只負責畫高亮泡泡。卡片順序、解鎖、完成判定仍然由 model / viewmodel 決定，
  // 所以 tour 這一層不准反過來去碰它們，也不准自己打 API。
  const tourModel = read("tour-model.js");
  const tour = read("tour.js");

  assert.deepEqual(importsOf(tourModel), []);
  for (const forbidden of ["document.", "window.", "querySelector", "fetch("]) {
    assert(
      !tourModel.includes(forbidden),
      `tour-model 不可以出現 ${forbidden}——那是 tour.js 的事`,
    );
  }
  ok("tour-model 是純函式：只決定要不要講、講什麼");

  assert(!importsOf(tour).includes("api"), "tour 不可以直接打 API");
  assert(!importsOf(tour).includes("viewmodel"), "tour 不可以依賴 viewmodel");
  assert(!tour.includes("fetch("), "tour 不可以直接 fetch");
  ok("tour 只畫泡泡，不打 API、不碰 viewmodel");

  // driver.js 跟設計系統一樣走 vendor：學生的 VM 常常連不到外網，指向 CDN 的話
  // 導覽會靜靜地不出現，而且沒有人會知道為什麼。
  assert.match(index, /<link rel="stylesheet" href="\/vendor\/driver\.css" \/>/);
  assert.match(tour, /from "\/vendor\/driver\.mjs"/);
  assert(!index.includes("cdn.jsdelivr"));
  assert(!index.includes("unpkg.com"));
  ok("driver.js 走 vendor，不從 CDN 抓");

  // 頁面同一時間只有一張卡在 DOM 裡（renderCard 每次都重畫一張 article），所以
  // 導覽指得到「現在這張卡」的唯一辦法就是每次把身分寫回元素上。
  assert(files.view.includes("article.dataset.cardId = model.card.checkId"));
  ok("卡片身分寫在 data-card-id 上，導覽才指得到現在這張");

  // 版面導覽指的必須是 index.html 裡寫死的骨架。指到卡片內部生出來的元素，
  // 學生翻到下一張時泡泡就會貼到畫面左上角。
  for (const selector of ["#section-nav", "#milestone-bar", "#current-card", "#terminal", "#wizard-nav-row"]) {
    assert(
      index.includes(`id="${selector.slice(1)}"`),
      `版面導覽指的 ${selector} 必須是 index.html 的骨架`,
    );
  }
  ok("版面導覽只指不會被重畫的骨架");

  // 跑到一半跳提示會蓋住終端正在印的字。
  assert(tourModel.includes("if (runInProgress === true || tourRunning === true) return null;"));
  ok("執行中不跳導覽提示");

  // 重看導覽那顆也照灌色按鈕的規矩來。
  assert.match(
    index,
    /id="replay-tour" class="ds-btn-fill[^"]*"[^>]*>\s*<svg/,
    "replay-tour 要是灌色按鈕而且帶 icon",
  );
  ok("重看導覽是灌色按鈕，前面帶 icon");
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
