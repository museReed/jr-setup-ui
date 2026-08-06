// 同一份 walkthrough 要同時服務 mac 與 Windows。兩種差異，各有各的表示法：
//
//   整段話不一樣   欄位從字串換成 { mac, win }
//   整格只有一邊有 節點加 only: "mac" | "win"
//
// 為什麼不拆成兩個檔案：十四份會變二十八份，而其中大部分逐字相同——改一句話要記得
// 改兩個地方，第二個地方遲早會忘。差異放在有差異的那一行上，沒差異的只有一份。

export const PLATFORM_KEYS = ["mac", "win"];

export const PLATFORM_LABEL = { mac: "mac", win: "Windows" };

/** 這個節點在那個平台上出現嗎。platform 為 null 代表「兩個平台都看」。 */
export function visibleOn(node, platform) {
  if (platform === null || node?.only === undefined || node.only === null) {
    return true;
  }

  return node.only === platform;
}

/** 這個欄位有分平台嗎。 */
export function isSplit(value) {
  return value !== null && typeof value === "object";
}

/** 取那個平台該顯示的內容。沒分平台就回原值。可能是一句話，也可能是一串。 */
export function valueFor(value, platform) {
  if (Array.isArray(value)) return value;

  if (!isSplit(value)) return value ?? "";

  // 兩個平台一起看時先給 mac 的，編輯器會把兩格都畫出來，這個只是給預覽用的。
  return value[platform ?? "mac"] ?? "";
}

/** 同上，但一定回一句話。要畫成清單的地方用 listFor。 */
export function textFor(value, platform) {
  const picked = valueFor(value, platform);
  return Array.isArray(picked) ? (picked[0] ?? "") : picked;
}

/**
 * 一句話講不完的地方畫成一串項目，不要用句號把兩三句擠成一段（Reed 定的規矩）。
 * 回傳陣列：只有一句就是長度 1。
 */
export function listFor(value, platform) {
  const picked = valueFor(value, platform);
  const items = Array.isArray(picked) ? picked : [picked];
  return items.map((item) => String(item ?? "").trim()).filter((item) => item !== "");
}

/** 字串 → 分平台。兩邊都先填原本那句，人只改要改的那一邊。 */
export function toSplit(value) {
  const text = isSplit(value) ? (value.mac ?? "") : (value ?? "");
  return { mac: text, win: isSplit(value) ? (value.win ?? text) : text };
}

/** 分平台 → 字串。留 mac 那句，因為兩者相同時通常是它先寫的。 */
export function toPlain(value) {
  return isSplit(value) ? (value.mac ?? "") : (value ?? "");
}

/** 寫完了嗎——分平台的要兩邊都有字才算。 */
export function isWritten(value) {
  if (isSplit(value)) {
    return PLATFORM_KEYS.every((key) => String(value[key] ?? "").trim() !== "");
  }

  return String(value ?? "").trim() !== "";
}
