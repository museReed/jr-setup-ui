// copy-studio 的前端。狀態只有兩件事：現在編哪一份、那一份的內容。
// 存檔靠 debounce，不用按鈕——編輯器要求人記得存檔，人就會忘記存檔。
import { MOCK_KINDS, TERM_TONES, WIZARD_PLACES, blankMock, renderMock } from "/mocks.js";
import {
  PLATFORM_KEYS,
  PLATFORM_LABEL,
  isSplit,
  textFor,
  toPlain,
  toSplit,
  visibleOn,
} from "/platform.js";

const KINDS = {
  do: { icon: "i-do", label: "你要做" },
  see: { icon: "i-see", label: "會看到" },
  warn: { icon: "i-warn", label: "別做" },
  miss: { icon: "i-miss", label: "沒發生的話" },
};

const PLATFORMS = [
  { id: null, label: "兩平台共用" },
  { id: "mac", label: "只有 mac" },
  { id: "win", label: "只有 Windows" },
];

const SECTIONS = [
  { id: "env", label: "讓 AI 能跑起來" },
  { id: "rules", label: "讓它照你的規矩回話" },
  { id: "skills", label: "給它技能包" },
  { id: "demo", label: "跑一次給你看" },
];

// platform 為 null＝兩個平台一起看。它同時決定三件事：清單列哪幾份、哪些節點畫出來、
// 分平台的欄位要編哪一邊。
const state = { list: [], id: null, data: null, dirty: false, platform: null };

const el = {
  rail: document.getElementById("rail-list"),
  summary: document.getElementById("summary"),
  main: document.getElementById("main"),
  toast: document.getElementById("toast"),
  preview: document.getElementById("preview"),
  previewBody: document.getElementById("preview-body"),
};

const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const icon = (name, cls = "") =>
  `<svg class="ico ${cls}" aria-hidden="true"><use href="#${name}"></use></svg>`;

let toastTimer = 0;
function toast(message, tone = "ok") {
  el.toast.textContent = message;
  el.toast.className = `toast is-${tone}`;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2400);
}

async function api(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body.error ?? `${response.status}`);
  }

  return body;
}

// ── 檔名 ───────────────────────────────────────────────────────────
// 跟 server.mjs 的 shotName 是同一條規則。兩邊各寫一次是刻意的：前端要在圖還沒
// 上傳前就顯示「它會存成什麼名字」，而後端不能相信前端算的名字。
function shotName(stepIndex, kidIndex, kind, stepId, platform, ext = ".png") {
  const order = String(stepIndex + 1).padStart(2, "0");
  const sub = kidIndex === null ? "" : String.fromCharCode(97 + kidIndex);
  const plat = platform ? `.${platform}` : "";
  return `${order}${sub}-${kind}-${stepId || "untitled"}${plat}${ext}`;
}

// ── 存檔 ───────────────────────────────────────────────────────────
let saveTimer = 0;
function scheduleSave() {
  state.dirty = true;
  paintSaveState();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 600);
}

async function save() {
  if (state.data === null) return;

  try {
    await api(`/api/walkthrough/${state.data.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(state.data),
    });
    state.dirty = false;
    paintSaveState();
    await refreshList();
  } catch (error) {
    toast(`存不進去：${error.message}`, "bad");
  }
}

function paintSaveState() {
  const badge = document.getElementById("save-state");
  if (badge === null) return;
  badge.textContent = state.dirty ? "編輯中…" : "已寫進檔案";
  badge.className = `save-state ${state.dirty ? "is-dirty" : ""}`;
}

// ── 左側清單 ────────────────────────────────────────────────────────
async function refreshList() {
  const query = state.platform === null ? "" : `?platform=${state.platform}`;
  const { items } = await api(`/api/walkthroughs${query}`);
  state.list = items;
  paintList();
}

function paintList() {
  const totalShots = state.list.reduce((n, item) => n + item.wantShots, 0);
  const haveShots = state.list.reduce((n, item) => n + item.haveShots, 0);
  const done = state.list.filter((item) => item.written === item.steps && item.steps > 0).length;

  el.summary.innerHTML = `
<div class="switch" role="group" aria-label="平台">
<button data-platform="" class="${state.platform === null ? "is-now" : ""}">兩個平台</button>
<button data-platform="mac" class="${state.platform === "mac" ? "is-now" : ""}">mac</button>
<button data-platform="win" class="${state.platform === "win" ? "is-now" : ""}">Windows</button>
</div>
<div class="stat"><b>${done}</b><span>/ ${state.list.length} 份文案寫完</span></div>
<div class="stat"><b>${haveShots}</b><span>/ ${totalShots} 張截圖補齊</span></div>`;

  // 照學生實際遇到的順序排（伺服器算好的 rank），並照嚮導的四段分組——字母序排出來
  // 的清單看不出「他先遇到哪一個」，而先後正是判斷文案夠不夠用的依據。
  el.rail.innerHTML = SECTIONS.map((section) => {
    const items = state.list.filter((item) => item.section === section.id);

    if (items.length === 0) return "";

    return `<li class="rail-sec">${esc(section.label)}</li>${items.map(railItem).join("")}`;
  }).join("");
}

function railItem(item) {
  const copyDone = item.steps > 0 && item.written === item.steps;
  const shotsDone = item.wantShots === item.haveShots;
  return `<li>
<button class="rail-item ${item.id === state.id ? "is-now" : ""}" data-open="${esc(item.id)}">
<span class="rail-row">${esc(item.row)}</span>
<span class="rail-meta">
<span class="tag ${copyDone ? "is-ok" : "is-todo"}">文案 ${item.written}/${item.steps}</span>
${item.wantShots > 0 ? `<span class="tag ${shotsDone ? "is-ok" : "is-todo"}">圖 ${item.haveShots}/${item.wantShots}</span>` : ""}
</span>
<code>${esc(item.id)}</code>
</button>
</li>`;
}

el.summary.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-platform]");
  if (button === null) return;

  state.platform = button.dataset.platform === "" ? null : button.dataset.platform;
  await refreshList();

  if (state.data !== null) paintEditor();
});

// ── 主編輯區 ────────────────────────────────────────────────────────
async function open(id) {
  state.id = id;
  state.data = await api(`/api/walkthrough/${id}`);
  paintList();
  paintEditor();
}

function paintEditor() {
  const data = state.data;
  el.main.innerHTML = `
<header class="doc-head">
<div class="doc-meta"><code>${esc(data.id)}</code><span>卡片：${esc(data.card)}</span><span id="save-state" class="save-state">已寫進檔案</span></div>
<h2>${esc(data.row)}</h2>
${data.note ? `<p class="doc-note">${esc(data.note)}</p>` : ""}
<div class="doc-actions">
<button class="btn ghost sm" id="open-preview">看學生的樣子</button>
</div>
</header>
<ol class="steps">${data.steps.map((step, index) => stepHtml(step, index)).join("")}</ol>
<button class="btn ghost wide" data-add-step>＋ 加一個「你要做」</button>`;

  paintSaveState();
  wireEditor();
}

// 會分平台的欄位（標題與說明）都走這裡。沒分平台就一個框；分了就兩個框，各自標
// mac / Windows。切到單一平台時只畫那一邊——編的時候不用被另一個平台的字干擾。
function splitField(node, field, label, placeholder, rows) {
  const value = node[field];
  const split = isSplit(value);
  const head = `<label>${label}
<button class="mini ${split ? "is-on" : ""}" data-split="${field}" type="button">${split ? "合併平台" : "分平台"}</button>
</label>`;

  if (!split) {
    return `<div class="field">${head}
<textarea rows="${rows}" data-field="${field}" placeholder="${esc(placeholder)}">${esc(value ?? "")}</textarea>
</div>`;
  }

  const keys = state.platform === null ? PLATFORM_KEYS : [state.platform];
  const boxes = keys
    .map(
      (key) => `<div class="plat-box">
<span class="plat-tag">${PLATFORM_LABEL[key]}</span>
<textarea rows="${rows}" data-field="${field}" data-plat="${key}" placeholder="${esc(placeholder)}">${esc(value[key] ?? "")}</textarea>
</div>`,
    )
    .join("");
  return `<div class="field">${head}<div class="plats">${boxes}</div></div>`;
}

function onlyPicker(node) {
  const now = node.only ?? "";
  return `<label class="only-pick">只在
<select data-field="only">
<option value=""${now === "" ? " selected" : ""}>兩個平台</option>
${PLATFORM_KEYS.map((key) => `<option value="${key}"${now === key ? " selected" : ""}>${PLATFORM_LABEL[key]}</option>`).join("")}
</select>
</label>`;
}

function stepHtml(step, index) {
  // 切到單一平台時，只屬於另一邊的整格不畫——它在那個平台上不存在。
  if (!visibleOn(step, state.platform)) return "";

  const kids = (step.kids ?? [])
    .map((kid, kidIndex) => kidHtml(kid, index, kidIndex))
    .join("");

  return `<li class="step${step.only ? " is-scoped" : ""}" data-step="${index}">
<div class="step-mark"><span class="step-num">${index + 1}</span>${icon("i-do", "k-do")}</div>
<div class="step-body">
${step.only ? `<span class="scope-tag">只有 ${PLATFORM_LABEL[step.only]}</span>` : ""}
${splitField(step, "title", "這一步要學生做什麼", "例如：按卡片上的「開啟並送出測試句」", 1)}
${splitField(step, "detail", "補一句說明", "為什麼要按、按了會怎樣", 2)}
<div class="field id-field">
<label>步驟 id<em>會變成截圖檔名的一段，用英文 kebab-case</em></label>
<input data-field="id" value="${esc(step.id)}" placeholder="click-open-and-send">
</div>
${visualHtml(step, index, null, "do")}
<div class="kids">${kids}</div>
<div class="step-tools">
<button class="btn ghost sm" data-add-kid="see">${icon("i-see")} 加「會看到」</button>
<button class="btn ghost sm" data-add-kid="warn">${icon("i-warn")} 加「別做」</button>
<button class="btn ghost sm" data-add-kid="miss">${icon("i-miss")} 加「沒發生的話」</button>
<span class="grow"></span>
${onlyPicker(step)}
<button class="btn ghost sm danger" data-del-step>刪掉這一步</button>
</div>
</div>
</li>`;
}

function kidHtml(kid, stepIndex, kidIndex) {
  if (!visibleOn(kid, state.platform)) return "";

  const meta = KINDS[kid.kind] ?? KINDS.see;
  return `<div class="kid k-${esc(kid.kind)}${kid.only ? " is-scoped" : ""}" data-kid="${kidIndex}">
<div class="kid-mark" title="${esc(meta.label)}">${icon(meta.icon)}</div>
<div class="kid-body">
${kid.only ? `<span class="scope-tag">只有 ${PLATFORM_LABEL[kid.only]}</span>` : ""}
${splitField(kid, "title", meta.label, "一句話", 1)}
${splitField(kid, "detail", "說明", "說明", 2)}
<div class="field id-field">
<label>id</label>
<input data-field="id" value="${esc(kid.id)}" placeholder="new-terminal">
</div>
${visualHtml(kid, stepIndex, kidIndex, kid.kind)}
<div class="kid-tools">${onlyPicker(kid)}<span class="grow"></span><button class="btn ghost sm danger" data-del-kid>刪掉</button></div>
</div>
</div>`;
}

// ── 畫面：畫的 / 拍的 / 沒有 ─────────────────────────────────────────
function visualHtml(node, stepIndex, kidIndex, kind) {
  const visual = node.visual;
  const mode = visual === null || visual === undefined ? "none" : visual.type;

  const tabs = `<div class="vis-tabs">
<button class="vis-tab ${mode === "none" ? "is-now" : ""}" data-vis="none">不放畫面</button>
<button class="vis-tab ${mode === "mock" ? "is-now" : ""}" data-vis="mock">${icon("i-draw")} 用畫的</button>
<button class="vis-tab ${mode === "shot" ? "is-now" : ""}" data-vis="shot">${icon("i-shot")} 要截圖</button>
</div>`;

  if (mode === "none") {
    return `<div class="vis">${tabs}<p class="vis-hint">這一格沒有畫面可指認——按按鈕、記得關視窗這種不用配圖。</p></div>`;
  }

  if (mode === "mock") {
    return `<div class="vis">${tabs}
<div class="vis-grid">
<div class="vis-form">${mockForm(visual)}</div>
<figure class="vis-out">${renderMock(visual)}<figcaption>${esc(visual.caption) || "（還沒寫說明）"}</figcaption></figure>
</div>
</div>`;
  }

  const platforms = visual.platforms ?? [null];
  const slots = platforms
    .map((platform) => {
      const name = shotName(stepIndex, kidIndex, kind, node.id, platform);
      const src = `/shots/${state.data.id}/${name}`;
      return `<div class="slot" data-slot="${esc(name)}" data-platform="${platform ?? ""}">
<div class="slot-drop">
<img alt="" data-probe src="${src}" hidden>
<div class="slot-empty">
<strong>把截圖拖進來</strong>
<span>或點一下選檔案</span>
</div>
<input type="file" accept="image/png,image/jpeg,image/webp" hidden>
</div>
<div class="slot-meta">
<code>${esc(name)}</code>
<button class="btn ghost sm danger" data-del-shot hidden>換掉</button>
</div>
</div>`;
    })
    .join("");

  return `<div class="vis">${tabs}
<div class="field">
<label>這張圖要拍什麼<em>拍的人照這句話拍</em></label>
<textarea rows="2" data-vfield="want" placeholder="例如：系統設定 → 隱私權 → 完全取用磁碟，Ghostty 那一列">${esc(visual.want)}</textarea>
</div>
<div class="field">
<label>平台</label>
<select data-field="platforms">
${PLATFORMS.map((p) => {
  const value = p.id ?? "";
  const now = platforms.length === 2 ? "both" : (platforms[0] ?? "");
  return `<option value="${value}"${now === value ? " selected" : ""}>${p.label}</option>`;
}).join("")}
<option value="both"${platforms.length === 2 ? " selected" : ""}>兩張都要（mac 與 Windows 各一）</option>
</select>
</div>
<div class="slots">${slots}</div>
</div>`;
}

function mockForm(visual) {
  const picker = `<div class="field">
<label>畫哪一種</label>
<select data-field="mock">
${MOCK_KINDS.map((k) => `<option value="${k.id}"${visual.mock === k.id ? " selected" : ""}>${k.label}</option>`).join("")}
</select>
<em class="hint">${esc(MOCK_KINDS.find((k) => k.id === visual.mock)?.hint ?? "")}</em>
</div>`;

  const caption = `<div class="field">
<label>圖說</label>
<input data-vfield="caption" value="${esc(visual.caption)}" placeholder="Dock 上的終端機圖示，底下有小點">
</div>`;

  if (visual.mock === "term") {
    const lines = (visual.lines ?? [])
      .map(
        (line, index) => `<div class="line-row" data-line="${index}">
<select data-line-field="tone">${TERM_TONES.map((t) => `<option value="${t.id}"${line.tone === t.id ? " selected" : ""}>${t.label}</option>`).join("")}</select>
<input data-line-field="text" value="${esc(line.text)}" placeholder="這一行印什麼">
<button class="btn ghost sm danger" data-del-line>×</button>
</div>`,
      )
      .join("");
    return `${picker}${caption}
<div class="field"><label>終端裡的每一行</label><div class="lines">${lines}</div>
<button class="btn ghost sm" data-add-line>＋ 加一行</button></div>`;
  }

  if (visual.mock === "titlebar") {
    return `${picker}${caption}
<div class="field"><label>標題會變成什麼<em>寫一個真的例子，不要寫「emoji ＋ 中文」</em></label><input data-vfield="title" value="${esc(visual.title)}" placeholder="🔧 修登入的錯誤"></div>
<div class="field"><label>視窗裡面隨便寫點什麼<em>選填，讓它看起來像真的視窗</em></label><input data-vfield="body" value="${esc(visual.body)}"></div>`;
  }

  if (visual.mock === "wizard") {
    return `${picker}${caption}
<div class="field"><label>按鈕在哪<em>畫錯了學生會照著找一顆不存在的按鈕</em></label>
<select data-vfield="place">
${WIZARD_PLACES.map((p) => `<option value="${p.id}"${(visual.place ?? "below") === p.id ? " selected" : ""}>${p.label}</option>`).join("")}
</select></div>
<div class="field"><label>${visual.place === "step" ? "那一步的標題" : "那一列寫什麼"}</label><input data-vfield="row" value="${esc(visual.row)}"></div>
<div class="field"><label>再一列（選填）<em>多畫一列，「在清單下面」才看得出是下面</em></label><input data-vfield="row2" value="${esc(visual.row2)}"></div>
<div class="field"><label>要圈的按鈕</label><input data-vfield="button" value="${esc(visual.button)}"></div>`;
  }

  if (visual.mock === "browser") {
    return `${picker}${caption}
<div class="field"><label>網址</label><input data-vfield="url" value="${esc(visual.url)}"></div>
<div class="field"><label>頁面上寫什麼</label><input data-vfield="body" value="${esc(visual.body)}"></div>`;
  }

  return `${picker}${caption}
<div class="field"><label>那個 app 叫什麼</label><input data-vfield="app" value="${esc(visual.app)}"></div>`;
}

// ── 找節點 ─────────────────────────────────────────────────────────
function nodeAt(element) {
  const stepEl = element.closest("[data-step]");
  const kidEl = element.closest("[data-kid]");
  const step = state.data.steps[Number(stepEl.dataset.step)];
  return kidEl === null ? step : step.kids[Number(kidEl.dataset.kid)];
}

function indexAt(element) {
  const stepEl = element.closest("[data-step]");
  const kidEl = element.closest("[data-kid]");
  return {
    stepIndex: Number(stepEl.dataset.step),
    kidIndex: kidEl === null ? null : Number(kidEl.dataset.kid),
  };
}

// ── 接線 ───────────────────────────────────────────────────────────
// el.main 的三個委派只掛一次。paintEditor 會重畫 innerHTML，但那個容器本身不會換
// ——每次重畫都掛一遍的話 listener 會疊上去，一次點擊跑兩次 handler，第二次拿到的
// 還是已經被換掉的舊 DOM。
let editorWired = false;

function wireEditor() {
  for (const box of el.main.querySelectorAll("textarea")) autosize(box);
  wireSlots();
  document.getElementById("open-preview")?.addEventListener("click", showPreview);

  if (editorWired) return;

  editorWired = true;
  el.main.addEventListener("input", onInput);
  el.main.addEventListener("change", onChange);
  el.main.addEventListener("click", onClick);
}

function autosize(box) {
  box.style.height = "auto";
  box.style.height = `${box.scrollHeight}px`;
}

function onInput(event) {
  const target = event.target;
  const field = target.dataset.field ?? target.dataset.vfield ?? target.dataset.lineField;
  if (field === undefined) return;

  if (target.tagName === "TEXTAREA") autosize(target);

  const node = nodeAt(target);

  if (target.dataset.lineField !== undefined) {
    const index = Number(target.closest("[data-line]").dataset.line);
    node.visual.lines[index][target.dataset.lineField] = target.value;
    repaintMock(target);
    scheduleSave();
    return;
  }

  // 畫面的欄位用 data-vfield，跟節點自己的欄位分開：兩邊都有 title，靠白名單分辨
  // 的話「分頁標題」那種畫面一打字就會蓋掉整個步驟的標題。
  if (target.dataset.vfield !== undefined) {
    node.visual[field] = target.value;
    repaintMock(target);
    scheduleSave();
    return;
  }

  // 分平台的欄位帶 data-plat，寫進那一邊；沒帶就是整個換掉。
  if (target.dataset.plat !== undefined) {
    node[field][target.dataset.plat] = target.value;
    scheduleSave();
    return;
  }

  if (!["id", "title", "detail"].includes(field)) return;

  node[field] = target.value;
  scheduleSave();
}

function onChange(event) {
  const target = event.target;

  if (target.dataset.lineField === "tone") {
    const node = nodeAt(target);
    node.visual.lines[Number(target.closest("[data-line]").dataset.line)].tone = target.value;
    repaintMock(target);
    scheduleSave();
    return;
  }

  // 按鈕位置換了要整個重畫：step 版的欄位標題跟另外兩種不一樣。
  if (target.dataset.vfield === "place") {
    nodeAt(target).visual.place = target.value;
    scheduleSave();
    paintEditor();
    return;
  }

  if (target.dataset.field === "mock") {
    const node = nodeAt(target);
    node.visual = { ...blankMock(target.value), caption: node.visual.caption ?? "" };
    scheduleSave();
    paintEditor();
    return;
  }

  if (target.dataset.field === "platforms") {
    const node = nodeAt(target);
    node.visual.platforms =
      target.value === "both" ? ["mac", "win"] : target.value === "" ? [null] : [target.value];
    scheduleSave();
    paintEditor();
    return;
  }

  if (target.dataset.field === "only") {
    const node = nodeAt(target);

    if (target.value === "") {
      delete node.only;
    } else {
      node.only = target.value;
    }

    scheduleSave();
    paintEditor();
  }
}

function repaintMock(from) {
  const vis = from.closest(".vis");
  const node = nodeAt(from);
  const out = vis.querySelector(".vis-out");
  if (out === null) return;
  out.innerHTML = `${renderMock(node.visual)}<figcaption>${esc(node.visual.caption) || "（還沒寫說明）"}</figcaption>`;
}

function onClick(event) {
  const target = event.target.closest("button");
  if (target === null) return;

  // 「分平台」：兩邊先填一樣的字，人只改要改的那一邊。合併時留 mac 那句。
  if (target.dataset.split !== undefined) {
    const node = nodeAt(target);
    const field = target.dataset.split;
    node[field] = isSplit(node[field]) ? toPlain(node[field]) : toSplit(node[field]);
    scheduleSave();
    paintEditor();
    return;
  }

  if (target.dataset.vis !== undefined) {
    const node = nodeAt(target);
    node.visual =
      target.dataset.vis === "none"
        ? null
        : target.dataset.vis === "mock"
          ? blankMock("term")
          : { type: "shot", want: "", platforms: [null] };
    scheduleSave();
    paintEditor();
    return;
  }

  if (target.dataset.addKid !== undefined) {
    const node = nodeAt(target);
    node.kids = node.kids ?? [];
    node.kids.push({ id: "", kind: target.dataset.addKid, title: "", detail: "", visual: null });
    scheduleSave();
    paintEditor();
    return;
  }

  if (target.dataset.delKid !== undefined) {
    const { stepIndex, kidIndex } = indexAt(target);
    state.data.steps[stepIndex].kids.splice(kidIndex, 1);
    scheduleSave();
    paintEditor();
    return;
  }

  if (target.dataset.delStep !== undefined) {
    const { stepIndex } = indexAt(target);
    state.data.steps.splice(stepIndex, 1);
    scheduleSave();
    paintEditor();
    return;
  }

  if (target.dataset.addStep !== undefined) {
    state.data.steps.push({ id: "", title: "", detail: "", visual: null, kids: [] });
    scheduleSave();
    paintEditor();
    return;
  }

  if (target.dataset.addLine !== undefined) {
    nodeAt(target).visual.lines.push({ tone: "dim", text: "" });
    scheduleSave();
    paintEditor();
    return;
  }

  if (target.dataset.delLine !== undefined) {
    const node = nodeAt(target);
    node.visual.lines.splice(Number(target.closest("[data-line]").dataset.line), 1);
    scheduleSave();
    paintEditor();
    return;
  }

  if (target.dataset.delShot !== undefined) {
    const slot = target.closest("[data-slot]");
    removeShot(slot);
  }
}

// ── 截圖：拖進來就存，檔名由系統算 ──────────────────────────────────
function wireSlots() {
  for (const slot of el.main.querySelectorAll("[data-slot]")) {
    const drop = slot.querySelector(".slot-drop");
    const input = slot.querySelector("input[type=file]");
    const probe = slot.querySelector("[data-probe]");

    // 檔案在不在，用「載得起來嗎」問。省一支 API，而且畫面跟磁碟永遠一致。
    probe.addEventListener("load", () => markFilled(slot, true));
    probe.addEventListener("error", () => markFilled(slot, false));
    probe.src = `${probe.src}?t=${Date.now()}`;

    drop.addEventListener("click", () => input.click());
    input.addEventListener("change", () => {
      if (input.files[0]) upload(slot, input.files[0]);
    });

    for (const type of ["dragenter", "dragover"]) {
      drop.addEventListener(type, (event) => {
        event.preventDefault();
        drop.classList.add("is-over");
      });
    }

    for (const type of ["dragleave", "drop"]) {
      drop.addEventListener(type, () => drop.classList.remove("is-over"));
    }

    drop.addEventListener("drop", (event) => {
      event.preventDefault();
      const file = event.dataTransfer?.files?.[0];
      if (file) upload(slot, file);
    });
  }
}

function markFilled(slot, filled) {
  slot.classList.toggle("is-filled", filled);
  slot.querySelector("[data-probe]").hidden = !filled;
  slot.querySelector("[data-del-shot]").hidden = !filled;
}

async function upload(slot, file) {
  const name = slot.dataset.slot;

  try {
    const result = await api(`/api/shot/${state.data.id}/${name}`, {
      method: "POST",
      headers: { "content-type": file.type },
      body: file,
    });
    const probe = slot.querySelector("[data-probe]");
    // 副檔名可能被伺服器換掉（jpg 拖進來時），照它回的名字重載。
    slot.dataset.slot = result.saved;
    slot.querySelector("code").textContent = result.saved;
    probe.src = `/shots/${state.data.id}/${result.saved}?t=${Date.now()}`;
    toast(`存好了：${result.saved}`);
    await refreshList();
  } catch (error) {
    toast(`存不進去：${error.message}`, "bad");
  }
}

async function removeShot(slot) {
  try {
    await api(`/api/shot/${state.data.id}/${slot.dataset.slot}`, { method: "DELETE" });
    markFilled(slot, false);
    toast("刪掉了，可以拖新的進來");
    await refreshList();
  } catch (error) {
    toast(`刪不掉：${error.message}`, "bad");
  }
}

// ── 預覽：學生看到的樣子 ────────────────────────────────────────────
function showPreview() {
  el.preview.hidden = false;
  // 預覽照現在選的平台走。「兩個平台」時用 mac 那一邊，並在標題說清楚——不講的話
  // 會以為預覽是兩邊通用的。
  const platform = state.platform ?? "mac";
  el.previewBody.innerHTML = `
<h3>${esc(state.data.row)}</h3>
<p class="pv-plat">用 ${PLATFORM_LABEL[platform]} 的內容預覽${state.platform === null ? "（沒選平台時預設看 mac）" : ""}</p>
<ol class="pv-steps">
${state.data.steps
  .filter((step) => visibleOn(step, platform))
  .map(
    (step, index) => `<li class="pv-step">
<span class="pv-num">${index + 1}</span>
<div>
<b>${esc(textFor(step.title, platform)) || "（還沒寫）"}</b>
<p>${esc(textFor(step.detail, platform))}</p>
${step.visual ? pvVisual(step.visual, step, index, null, "do") : ""}
${(step.kids ?? [])
  .filter((kid) => visibleOn(kid, platform))
  .map((kid, kidIndex) => {
    const meta = KINDS[kid.kind] ?? KINDS.see;
    return `<div class="pv-kid k-${esc(kid.kind)}">
${icon(meta.icon)}
<div><b>${esc(textFor(kid.title, platform)) || "（還沒寫）"}</b><p>${esc(textFor(kid.detail, platform))}</p>
${kid.visual ? pvVisual(kid.visual, kid, index, kidIndex, kid.kind) : ""}</div>
</div>`;
  })
  .join("")}
</div>
</li>`,
  )
  .join("")}
</ol>`;
}

function pvVisual(visual, node, stepIndex, kidIndex, kind) {
  if (visual.type === "mock") {
    return `<figure class="pv-fig">${renderMock(visual)}<figcaption>${esc(visual.caption)}</figcaption></figure>`;
  }

  const platform = (visual.platforms ?? [null])[0];
  const name = shotName(stepIndex, kidIndex, kind, node.id, platform);
  return `<figure class="pv-fig"><img src="/shots/${state.data.id}/${name}" alt="" onerror="this.closest('figure').classList.add('is-missing')"><figcaption>${esc(visual.want) || "還缺這張圖"}</figcaption></figure>`;
}

document.getElementById("close-preview").addEventListener("click", () => {
  el.preview.hidden = true;
});

// ── 還缺哪些截圖 ────────────────────────────────────────────────────
document.getElementById("show-todo").addEventListener("click", showTodo);

async function showTodo() {
  const rows = [];

  for (const item of state.list) {
    if (item.wantShots === 0) continue;

    const data = await api(`/api/walkthrough/${item.id}`);

    for (const [stepIndex, step] of data.steps.entries()) {
      const all = [[null, step, "do"], ...(step.kids ?? []).map((kid, i) => [i, kid, kid.kind])];

      for (const [kidIndex, node, kind] of all) {
        if (node.visual?.type !== "shot") continue;

        for (const platform of node.visual.platforms ?? [null]) {
          rows.push({
            id: data.id,
            file: shotName(stepIndex, kidIndex, kind, node.id, platform),
            want: textFor(node.visual.want, platform ?? "mac"),
            title: textFor(node.title, platform ?? "mac"),
          });
        }
      }
    }
  }

  state.id = null;
  paintList();
  el.main.innerHTML = `
<header class="doc-head"><h2>還缺哪些截圖</h2>
<p class="doc-note">能畫的都畫掉了，剩下這些非拍不可。存成這個檔名放進 <code>content/shots/&lt;那一份&gt;/</code>，或直接拖進編輯器裡的框。</p></header>
${
  rows.length === 0
    ? `<p class="empty">目前沒有任何一格標成「要截圖」。</p>`
    : `<table class="todo">
<thead><tr><th>檔名</th><th>拍什麼</th><th>哪一步</th></tr></thead>
<tbody>${rows
  .map(
    (row) =>
      `<tr><td><code>${esc(row.id)}/${esc(row.file)}</code></td><td>${esc(row.want) || "<i>還沒寫拍什麼</i>"}</td><td>${esc(row.title)}</td></tr>`,
  )
  .join("")}</tbody></table>`
}`;
}

// ── 起手 ───────────────────────────────────────────────────────────
el.rail.addEventListener("click", (event) => {
  const button = event.target.closest("[data-open]");
  if (button !== null) open(button.dataset.open);
});

// 離開前把還沒寫進去的存掉——debounce 沒跑完就關掉分頁會掉一次編輯。
window.addEventListener("beforeunload", () => {
  if (state.dirty) navigator.sendBeacon?.(`/api/walkthrough/${state.data.id}`, JSON.stringify(state.data));
});

await refreshList();
