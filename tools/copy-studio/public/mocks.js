// 畫得出來的畫面。
//
// 為什麼不用截圖：Claude Code 改版、按鈕搬家，截圖就錯了——而畫面上一切正常，
// 沒有任何測試抓得到。跟這個 repo 一路在防的假綠燈同一類。畫的東西改版不會過期，
// 雙平台三語也只要換字串。見 docs/walkthrough-architecture.md。
//
// 這一支同時給 copy-studio 的預覽與嚮導的彈窗用，所以只回字串、不碰 DOM。

export const MOCK_KINDS = [
  { id: "term", label: "終端視窗", hint: "印出來的幾行字，可以反白其中一行" },
  { id: "dock", label: "mac 的 Dock", hint: "某個 app 底下有小圓點＝它開著" },
  { id: "taskbar", label: "Windows 工作列", hint: "某個項目在閃＝它開著但沒跳到前面" },
  { id: "wizard", label: "嚮導的卡片", hint: "圈出學生要按的那顆按鈕" },
  { id: "browser", label: "瀏覽器視窗", hint: "登入時跳出來的那一頁" },
];

export const TERM_TONES = [
  { id: "prompt", label: "提示字" },
  { id: "ok", label: "成功／重點" },
  { id: "err", label: "錯誤" },
  { id: "dim", label: "淡的" },
  { id: "sel", label: "反白（選取中）" },
];

const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function term(visual) {
  const lines = (visual.lines ?? [])
    .map((line) => {
      const text = esc(line.text) || "&nbsp;";
      const body = line.tone === "sel" ? `<span class="m-sel">${text}</span>` : text;
      return `<div class="m-line m-${esc(line.tone ?? "dim")}">${body}</div>`;
    })
    .join("");
  return `<div class="m-term">
<div class="m-term-bar"><i></i><i></i><i></i></div>
<div class="m-term-body">${lines || '<div class="m-line m-dim">&nbsp;</div>'}</div>
</div>`;
}

function dock(visual) {
  const label = esc(visual.app ?? ">_");
  return `<div class="m-dock">
<span class="m-app"></span><span class="m-app"></span>
<span class="m-app is-live"><b>${label}</b><i></i></span>
<span class="m-app"></span>
</div>`;
}

function taskbar(visual) {
  const label = esc(visual.app ?? "終端機");
  return `<div class="m-taskbar">
<span class="m-tb-item"></span>
<span class="m-tb-item is-flash">${label}</span>
<span class="m-tb-item"></span>
</div>`;
}

// 嚮導自己的一列＋那顆按鈕。學生看到的是同一套視覺，指認起來不用翻譯。
function wizard(visual) {
  return `<div class="m-card">
<div class="m-row">
<span class="m-box"></span>
<span class="m-row-text">${esc(visual.row ?? "（哪一列）")}</span>
<span class="m-btn is-target">${esc(visual.button ?? "（哪顆按鈕）")}</span>
</div>
</div>`;
}

function browser(visual) {
  return `<div class="m-browser">
<div class="m-browser-bar"><i></i><i></i><i></i><span class="m-url">${esc(visual.url ?? "example.com")}</span></div>
<div class="m-browser-body">${esc(visual.body ?? "")}</div>
</div>`;
}

const RENDERERS = { term, dock, taskbar, wizard, browser };

/** 回一段 HTML；認不得的 mock 回一個講得出問題的框，不要靜靜畫成空白。 */
export function renderMock(visual) {
  const render = RENDERERS[visual?.mock];

  if (render === undefined) {
    return `<div class="m-unknown">認不得的畫面類型：${esc(visual?.mock)}</div>`;
  }

  return render(visual);
}

/** 新增一個 mock 時的預設內容，讓它一畫出來就有東西看，不是空框。 */
export function blankMock(kind) {
  if (kind === "term") {
    return {
      type: "mock",
      mock: "term",
      caption: "",
      lines: [{ tone: "prompt", text: "› " }],
    };
  }

  if (kind === "wizard") {
    return { type: "mock", mock: "wizard", caption: "", row: "", button: "" };
  }

  if (kind === "browser") {
    return { type: "mock", mock: "browser", caption: "", url: "", body: "" };
  }

  return { type: "mock", mock: kind, caption: "", app: kind === "dock" ? ">_" : "終端機" };
}
