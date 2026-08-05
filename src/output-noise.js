// 安裝器的進度動畫要在進到瀏覽器之前就丟掉。
//
// winget 不管有沒有人在看，都用同一種方式畫進度：轉圈符號（- \ | /）與方塊進度條
// 靠 \r 一格一格重畫。在真的終端機裡那是原地更新的一行動畫；透過管子接出來，每一
// 格都變成獨立的一行，一次安裝就是幾百行 `- \ | /`（Windows VM 實測，裝 Python 的
// 原始輸出整段都是這個）。--disable-interactivity 關不掉它，winget 也沒有別的旗標
// ——只能在我們這邊擋。
//
// 擋在 server 端而不是畫面上：那幾百行原本每一行都是一次 SSE 事件加一次 DOM 插入，
// 學生的 VM 本來就不快，不該把力氣花在畫垃圾上。rawOutput 也一起不收——那一份是
// 「看原始輸出」面板、失敗原因挑行、以及丟給 LLM 翻譯的來源，三個地方都不需要它。
//
// 只丟「整行都是進度」的行，不動任何帶內容的行。winget 會把訊息接在轉圈符號後面
// （實測看過 `   \ Cancelling operation`），那種行留著——寧可留一點雜訊，也不要因為
// 手滑的正規式把唯一一句錯誤訊息吃掉。

// 色碼用 fromCharCode(27) 組，不把那個字元本身放進原始碼：ESC 在編輯器與 diff 裡都
// 看不見，留一個隱形字元在這裡，下一個人只會看到一段少了開頭、看起來壞掉的正規式。
//
// 而它不能省——少了 ESC，`[warn] …` 這種一般文字的開頭也會被當成色碼吃掉。
const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;]*[A-Za-z]`, "g");

const PROGRESS_PATTERNS = [
  // 整行只有轉圈符號與空白。
  /^[\s\-\\|/]+$/,
  // 方塊進度條，後面通常跟著「已下載 / 總共」。兩者都可能單獨出現。
  /^[\s█▒░▓]+$/,
  /^[\s█▒░▓]*[\d.,]+\s*[KMGT]?B\s*\/\s*[\d.,]+\s*[KMGT]?B\s*$/,
];

export function isProgressNoise(line) {
  if (typeof line !== "string") {
    return false;
  }

  const plain = line.replace(ANSI, "");

  // 空白行是版面的一部分（安裝器用它分段），不算進度雜訊。
  if (plain.trim() === "") {
    return false;
  }

  return PROGRESS_PATTERNS.some((pattern) => pattern.test(plain));
}
