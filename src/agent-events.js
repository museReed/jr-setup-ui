// 千分位，不用 toLocaleString 以免受執行環境語系影響。
function groupDigits(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function tokenSummary(pairs) {
  const parts = pairs
    .filter(([, value]) => typeof value === "number" && value > 0)
    .map(([label, value]) => `${label} ${groupDigits(value)}`);

  return parts.length > 0 ? `（${parts.join("、")} tokens）` : "";
}

function parseLine(line) {
  try {
    return { value: JSON.parse(line) };
  } catch {
    return {
      event: {
        kind: "status",
        text: line,
      },
    };
  }
}

export function parseClaudeLine(line) {
  const parsed = parseLine(line);

  if (parsed.event) {
    return parsed.event;
  }

  const value = parsed.value;

  if (value?.is_error === true) {
    return { kind: "error", text: "Claude 回報錯誤" };
  }

  // 收尾那行帶用量。$ 是 API 等價估算，訂閱制下不是實付金額。
  if (typeof value?.total_cost_usd === "number") {
    const usage = value.usage ?? {};
    const summary = tokenSummary([
      ["輸入", usage.input_tokens],
      ["快取寫入", usage.cache_creation_input_tokens],
      ["快取讀取", usage.cache_read_input_tokens],
      ["輸出", usage.output_tokens],
    ]);
    return {
      kind: "status",
      text: `本次消耗：$${value.total_cost_usd.toFixed(4)}${summary}`,
    };
  }

  if (
    value?.type === "stream_event" &&
    value.event?.type === "content_block_delta" &&
    value.event.delta?.type === "text_delta" &&
    typeof value.event.delta.text === "string"
  ) {
    return { kind: "text", text: value.event.delta.text };
  }

  if (value?.type === "assistant" && Array.isArray(value.message?.content)) {
    const toolUse = value.message.content.find(
      (item) => item?.type === "tool_use" && typeof item.name === "string",
    );

    if (toolUse) {
      return { kind: "tool", text: `使用工具：${toolUse.name}` };
    }
  }

  if (value?.type === "system" && value.subtype === "init") {
    return { kind: "status", text: "Claude 已啟動" };
  }

  if (value?.type === "system" && value.subtype === "status") {
    return { kind: "status", text: "思考中…" };
  }

  return null;
}

export function parseCodexLine(line) {
  const parsed = parseLine(line);

  if (parsed.event) {
    return parsed.event;
  }

  const value = parsed.value;

  if (
    value?.type === "item.started" &&
    value.item?.type === "command_execution" &&
    typeof value.item.command === "string"
  ) {
    const command =
      value.item.command.length > 120
        ? `${value.item.command.slice(0, 120)}…`
        : value.item.command;
    return { kind: "tool", text: `執行指令：${command}` };
  }

  if (
    value?.type === "item.completed" &&
    value.item?.type === "agent_message" &&
    typeof value.item.text === "string"
  ) {
    return { kind: "text", text: value.item.text };
  }

  if (value?.type === "thread.started") {
    return { kind: "status", text: "Codex 已啟動" };
  }

  // Codex 只給 token 數，沒有金額。
  if (value?.type === "turn.completed") {
    const usage = value.usage ?? {};
    const summary = tokenSummary([
      ["輸入", usage.input_tokens],
      ["快取讀取", usage.cached_input_tokens],
      ["輸出", usage.output_tokens],
    ]);
    return { kind: "status", text: `完成${summary}` };
  }

  return null;
}
