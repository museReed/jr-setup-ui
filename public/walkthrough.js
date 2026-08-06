// 「怎麼做」那顆按鈕跳出來的彈窗。
//
// 為什麼要有它：操作細節寫在卡片上會把卡片撐成一面文字牆，而學生九成的時間不需要
// 那些字——他只在卡住的時候要。所以卡片留「做完會多出什麼」，怎麼做移進這裡。
//
// 結構是主從的（Reed 拍板）：主節點一律是「你要做」，只看主節點就走得完整件事；
// 「會看到」「別做」「沒發生的話」是那個動作的附註，收起來，點了才展開。
//
// 內容來自 content/walkthroughs/<id>.json，用 tools/copy-studio 編。
import { urlWithToken } from "./api.js";
import { renderMock } from "./mocks.js";
import { textFor, visibleOn } from "./platform.js";

const KIND = {
  see: { icon: "wt-i-see", label: "會看到" },
  warn: { icon: "wt-i-warn", label: "別做" },
  miss: { icon: "wt-i-miss", label: "沒發生的話" },
};

// 學生的平台。步驟裡「去 Dock 找」與「看工作列在閃」是兩件不同的事，講錯等於沒講。
const PLATFORM = navigator.userAgent.includes("Windows") ? "win" : "mac";

const cache = new Map();
let overlay = null;

const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const icon = (name) => `<svg class="wt-ico" aria-hidden="true"><use href="#${name}"></use></svg>`;

function figure(visual, walkthroughId, name) {
  if (visual == null) return "";

  if (visual.type === "mock") {
    return `<figure class="wt-fig">${renderMock(visual)}<figcaption>${esc(textFor(visual.caption, PLATFORM))}</figcaption></figure>`;
  }

  // 真的要拍的那種。圖還沒補進來時不要留一個破圖——講出「這裡還缺一張」比較誠實。
  return `<figure class="wt-fig wt-fig-shot">
<img src="${esc(urlWithToken(`/walkthrough-shot/${walkthroughId}/${name}`))}" alt="" onerror="this.closest('figure').classList.add('is-missing')">
<figcaption>${esc(textFor(visual.want, PLATFORM))}</figcaption>
</figure>`;
}

// 檔名的算法跟 copy-studio 一樣，見 docs/walkthrough-architecture.md。
function shotName(stepIndex, kidIndex, kind, stepId, platform) {
  const order = String(stepIndex + 1).padStart(2, "0");
  const sub = kidIndex === null ? "" : String.fromCharCode(97 + kidIndex);
  return `${order}${sub}-${kind}-${stepId}${platform ? `.${platform}` : ""}.png`;
}

// 標題右邊只留「別做」一顆，而且是紅的。
//
// 「會看到」「沒發生的話」「有畫面」那幾顆拿掉了（Reed 指定）：那一排數字對學生沒
// 有用——他要嘛點開看，要嘛不看，知道裡面有幾個不會改變他做什麼。左邊的箭頭已經
// 說完「這裡點得開」。
//
// 但地雷那顆一定要留：它被靜靜摺進去而沒人看到的話，這個彈窗就是在幫倒忙。整份
// 十四份裡也只有一格有。
function badges(kids) {
  const warn = kids.filter((kid) => kid.kind === "warn").length;

  if (warn === 0) return "";

  return `<span class="wt-badge wt-warn" title="${esc(KIND.warn.label)}">${icon(KIND.warn.icon)}${warn}</span>`;
}

function stepHtml(step, index, walkthroughId) {
  const kids = (step.kids ?? []).filter((kid) => visibleOn(kid, PLATFORM));
  const openable = kids.length > 0 || step.visual != null;

  const kidsHtml = kids
    .map((kid, kidIndex) => {
      const meta = KIND[kid.kind] ?? KIND.see;
      return `<li class="wt-kid wt-${esc(kid.kind)}">
<span class="wt-kid-mark">${icon(meta.icon)}</span>
<div>
<span class="wt-kid-kind">${esc(meta.label)}</span>
<b>${esc(textFor(kid.title, PLATFORM))}</b>
<p>${esc(textFor(kid.detail, PLATFORM))}</p>
${figure(kid.visual, walkthroughId, shotName(index, kidIndex, kid.kind, kid.id, kid.visual?.platforms?.[0]))}
</div>
</li>`;
    })
    .join("");

  return `<li class="wt-step${index === 0 ? " is-open" : ""}">
<span class="wt-num">${index + 1}</span>
<button class="wt-head" type="button" ${openable ? `aria-expanded="${index === 0}"` : "disabled"}>
<span class="wt-title-row">
${openable ? '<i class="wt-chev" aria-hidden="true"></i>' : ""}
<b>${esc(textFor(step.title, PLATFORM))}</b>
${openable ? badges(kids) : ""}
</span>
<span class="wt-detail">${esc(textFor(step.detail, PLATFORM))}</span>
</button>
${
  openable
    ? `<div class="wt-body"><div>
${figure(step.visual, walkthroughId, shotName(index, null, "do", step.id, step.visual?.platforms?.[0]))}
${kidsHtml ? `<ul class="wt-kids">${kidsHtml}</ul>` : ""}
</div></div>`
    : ""
}
</li>`;
}

// 圖示自己帶進來，不寫在 index.html 裡：這一塊要能整個拔掉而不留殘骸。
const SPRITE = `<svg class="wt-sprite" aria-hidden="true">
<symbol id="wt-i-see" viewBox="0 0 24 24"><path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="2.8"/></symbol>
<symbol id="wt-i-warn" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/></symbol>
<symbol id="wt-i-miss" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M9.4 9.2a2.7 2.7 0 1 1 3.3 3.1v1.4"/><path d="M12.7 16.8v.01"/></symbol>
</svg>`;

function ensureOverlay() {
  if (overlay !== null) return overlay;

  document.body.insertAdjacentHTML("beforeend", SPRITE);
  overlay = document.createElement("div");
  overlay.className = "wt-overlay";
  overlay.innerHTML = `<div class="wt-panel" role="dialog" aria-modal="true" aria-labelledby="wt-title">
<button class="wt-close" type="button" aria-label="關閉">×</button>
<p class="wt-eyebrow">怎麼做</p>
<h2 id="wt-title"></h2>
<div class="wt-content"></div>
<div class="wt-foot"><button class="ds-btn ds-btn-sm ds-btn-primary wt-done" type="button">知道了</button></div>
</div>`;

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  overlay.querySelector(".wt-close").addEventListener("click", close);
  overlay.querySelector(".wt-done").addEventListener("click", close);

  // 展開／收起。每一步是一顆按鈕，點了才長出附註。
  overlay.addEventListener("click", (event) => {
    const head = event.target.closest(".wt-head");

    if (head === null || head.disabled) return;

    const step = head.closest(".wt-step");
    const open = !step.classList.contains("is-open");
    step.classList.toggle("is-open", open);
    head.setAttribute("aria-expanded", String(open));
  });

  document.body.append(overlay);
  return overlay;
}

// 收回那顆問號裡。transform-origin 還留著上次算的那個點，所以縮回去的方向自然
// 就是它來的方向；不用另外記。
function close() {
  if (overlay === null) return;
  overlay.classList.remove("is-open");
  document.body.classList.remove("wt-locked");
}

// 從那顆問號的中心長出來。
//
// 做法是把 transform-origin 設在「問號相對於彈窗左上角」的位置，再從 scale(0.02)
// 放到 1——縮放時原點那一點不會動，所以看起來就是從問號長出來的。
//
// 一定要等版面算完才量：彈窗是置中的，內容還沒填進去時量到的矩形是舊的，原點會
// 算在畫面上另一個地方，動畫看起來像從隨機的角落飛出來。
function setOrigin(panel, origin) {
  if (origin === undefined || origin === null) {
    panel.style.removeProperty("--wt-ox");
    panel.style.removeProperty("--wt-oy");
    return;
  }

  const rect = panel.getBoundingClientRect();
  panel.style.setProperty("--wt-ox", `${origin.x - rect.left}px`);
  panel.style.setProperty("--wt-oy", `${origin.y - rect.top}px`);
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") close();
});

/** 這一格有沒有操作步驟。沒有就不要畫那顆按鈕。 */
export async function loadWalkthrough(id) {
  if (cache.has(id)) return cache.get(id);

  let data = null;

  try {
    const response = await fetch(urlWithToken(`/walkthrough/${id}`));
    data = response.ok ? await response.json() : null;
  } catch {
    data = null;
  }

  // 沒寫半個字的（seed 出來還沒編）當成沒有——空彈窗比沒有按鈕更讓人困惑。
  if (data !== null) {
    const written = (data.steps ?? []).some(
      (step) => String(textFor(step.title, PLATFORM)).trim() !== "",
    );
    data = written ? data : null;
  }

  cache.set(id, data);
  return data;
}

export async function openWalkthrough(id, origin) {
  const data = await loadWalkthrough(id);

  if (data === null) return;

  const box = ensureOverlay();
  const panel = box.querySelector(".wt-panel");
  box.querySelector("#wt-title").textContent = textFor(data.row, PLATFORM);
  box.querySelector(".wt-content").innerHTML = `<ol class="wt-steps">${data.steps
    .filter((step) => visibleOn(step, PLATFORM))
    .map((step, index) => stepHtml(step, index, data.id))
    .join("")}</ol>`;

  // 先讓它有版面可以量（還沒 is-open，所以是縮著且透明的），量完再開。
  box.classList.add("is-measuring");
  setOrigin(panel, origin);
  box.classList.remove("is-measuring");

  // 下一格才加 is-open：同一格內既設 transform-origin 又改 transform 的話，
  // 瀏覽器會把兩者併成一次計算，沒有起點就沒有補間，彈窗會直接跳出來。
  requestAnimationFrame(() => {
    box.classList.add("is-open");
    document.body.classList.add("wt-locked");
    box.querySelector(".wt-close").focus();
  });
}
