#!/usr/bin/env node
// PreToolUse hook: 一次只跑一個指令。
// 偵測 Bash 指令裡的串接運算子 && / || / ;（先去掉引號內字串避免誤判），
// 命中就 exit 2 擋下，並把訊息回給 Claude，要它拆成多次 Bash 呼叫。
// 單一 pipe | 允許（grep|head 這種一條資料流的單一操作）。
let raw = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  raw += chunk;
});
process.stdin.on("end", () => {
  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    process.exit(0); // 讀不到就放行，不擋別的工具
  }

  if (data?.tool_name !== "Bash") {
    process.exit(0);
  }

  const cmd = data?.tool_input?.command ?? "";
  // 去掉單/雙引號內的內容，這樣 echo "a;b" 不會誤觸
  const stripped = cmd.replace(/"[^"]*"|'[^']*'/g, "");

  if (/&&|\|\||;/.test(stripped)) {
    process.stderr.write(
      "一次只跑一個指令：偵測到 && / || / ; 串接。\n" +
        "請拆成多次 Bash 呼叫，一次一條——這樣白名單才命中，也看得清每一步。\n" +
        "（單一 pipe | 可以；需要切目錄請用絕對路徑，別用 `cd x && 指令`。）",
    );
    process.exit(2); // PreToolUse exit 2 = 擋下這次呼叫，stderr 內容回給 Claude
  }

  process.exit(0);
});
