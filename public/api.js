// API：跟本機 server 講話的唯一出口。所有請求都要帶啟動時產生的一次性 token。
// 只往內依賴 model（domain），不碰 View / ViewModel。
import { configQuery } from "./model.js";

const token = new URLSearchParams(window.location.search).get("t") ?? "";

// <img src> 由瀏覽器自己發請求，沒辦法走 fetch 那條路加 header——網址得自己帶 token。
export function urlWithToken(path) {
  return withToken(path);
}

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

// tools 決定要不要查 Claude Code / Codex 那幾列——第一張卡選了什麼，環境段就只
// 出現什麼。省略時後端照舊全查。
export async function fetchEnv(tools = "") {
  const query = tools.length > 0 ? `?tools=${encodeURIComponent(tools)}` : "";
  const response = await fetch(withToken(`/env${query}`));

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

// 哪幾格有操作步驟可看。只回 id，內容等學生真的按下去再抓。
export async function fetchWalkthroughIds() {
  const response = await fetch(withToken("/walkthroughs"));

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json();
}

export async function saveVerifiedStep(step) {
  const response = await postJson("/state", { step });
  return response.json();
}

// 人工勾選整份覆蓋：取消勾選也要存得回去，逐筆新增做不到。
export async function saveManualChecked(ids) {
  const response = await postJson("/state", { manual: ids });
  return response.json();
}

// 跳過清單整份覆蓋：卡片驗過之後要從清單裡消失，逐筆新增做不到（跟 manual 同理）。
export async function saveSkippedCards(ids) {
  const response = await postJson("/state", { skipped: ids });
  return response.json();
}

// 程式那半驗過了。有眼睛勾選框的列也送這一筆——整列綠不綠是 saveVerifiedStep 的事。
export async function saveBehaviorVerified(step) {
  const response = await postJson("/state", { step, kind: "behavior" });
  return response.json();
}

// 重驗之前先把上一輪的結論忘掉，兩本帳都要清。只清瀏覽器記憶體的話，驗證失敗
// 時畫面說沒過、重新整理之後上一輪的勾又回來了。
export async function forgetVerification(step) {
  await Promise.all([
    postJson("/state", { step, clear: true }),
    postJson("/state", { step, kind: "behavior", clear: true }),
  ]);
}

// 「這一頁卡住了」。伺服器那邊交給 `gh issue create --body-file`——回傳的是
// 一則真的 issue 的網址，不是「打開一個預填好的頁面」。
export async function sendReport(title, body) {
  const response = await postJson("/report", { title, body });

  // 失敗時伺服器回的是 JSON（帶人話訊息），只有格式錯誤才是純文字。
  try {
    return await response.json();
  } catch {
    return { ok: false, message: "回報失敗，請再試一次。", detail: "" };
  }
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
