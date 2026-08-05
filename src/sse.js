// SSE 的協定層：怎麼把一行輸出變成瀏覽器收得到的事件。
//
// 從 server.js 抽出來的。那個檔案原本一個人做三件事——路由、子行程監管、事件協定
// ——而這三件的變動理由完全不同：路由跟著網址走，監管跟著作業系統走，協定跟著前端
// 的 api.js 走。擠在一起的結果是「改一條 route 要先讀完 900 行」。
//
// 這一層不認識 action、不認識 run、也不認識子行程。它只認識「一個 http response」
// 和「一行文字」。

const JR_EVENT_PREFIX = "@@JR ";

// 寫進一個已經斷掉的連線會丟例外，而 SSE 的連線隨時可能斷（學生關分頁、切卡片）。
// 這裡吞掉是刻意的：那不是錯誤，是正常結束。
export function writeEvent(response, event, data) {
  if (response.destroyed || response.writableEnded) {
    return;
  }

  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// 子行程可以用這個前綴主動送結構化事件（驗證腳本就是這樣回報結果的），其餘的輸出
// 一律當成純文字。解析失敗回 null 而不是丟例外：一行壞掉的輸出不該讓整次執行收攤。
export function parseJrEventLine(line) {
  if (!line.startsWith(JR_EVENT_PREFIX)) {
    return null;
  }

  try {
    const event = JSON.parse(line.slice(JR_EVENT_PREFIX.length));

    return event !== null &&
      typeof event === "object" &&
      !Array.isArray(event) &&
      typeof event.kind === "string"
      ? event
      : null;
  } catch {
    return null;
  }
}

export function writeOutputLine(response, stream, line) {
  const event = parseJrEventLine(line);

  if (event !== null) {
    writeEvent(response, "jr", event);
    return;
  }

  writeEvent(response, "line", { stream, text: line });
}

// 把一條 stream 切成一行一行。
//
// 回傳的是「把剩下那半行沖出來」的函式——子行程結束時最後一行通常沒有換行符號，
// 不沖的話那一行會消失，而那常常正是錯誤訊息。
export function streamLines(readable, onLine) {
  let buffered = "";
  readable.setEncoding("utf8");

  readable.on("data", (chunk) => {
    buffered += chunk;
    const lines = buffered.split("\n");
    buffered = lines.pop();

    for (const line of lines) {
      onLine(line.endsWith("\r") ? line.slice(0, -1) : line);
    }
  });

  return () => {
    if (buffered.length > 0) {
      onLine(buffered);
      buffered = "";
    }
  };
}
