// API：跟本機 server 講話的唯一出口。所有請求都要帶啟動時產生的一次性 token。
// 只往內依賴 model（domain），不碰 View / ViewModel。
import { configQuery } from "./model.js";

const token = new URLSearchParams(window.location.search).get("t") ?? "";

function withToken(path) {
  return `${path}${path.includes("?") ? "&" : "?"}t=${encodeURIComponent(token)}`;
}

async function postJson(path, body) {
  const response = await fetch(withToken(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response;
}

export async function fetchEnv() {
  const response = await fetch(withToken("/env"));

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json();
}

export async function fetchConfigs({ tools, lang }) {
  const response = await fetch(
    withToken(`/configs?${configQuery({ tools, lang })}`),
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json();
}

export async function fetchState() {
  const response = await fetch(withToken("/state"));

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json();
}

export async function saveVerifiedStep(step) {
  const response = await postJson("/state", { step });
  return response.json();
}

// 工具／語言的選擇也存伺服器：port 每次啟動都變，localStorage 綁 origin 存不住。
export async function saveSelection(selection) {
  const response = await postJson("/state", { selection });
  return response.json();
}

export async function startRun(body) {
  const response = await postJson("/run", body);
  return response.json();
}

export async function cancelRun(runId) {
  await postJson("/cancel", { runId });
}

export async function sendInput(runId, text) {
  await postJson("/input", { runId, text });
}

export function openStream(runId) {
  return new EventSource(
    withToken(`/stream?runId=${encodeURIComponent(runId)}`),
  );
}
