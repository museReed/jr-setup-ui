// 合併完之後，學生原本的內容有沒有被弄丟。
//
// AI 合併規則檔時最常見的壞法不是「合失敗」，是「順手潤飾」——它把兩份內容重寫成
// 一篇讀起來更順的文件，過程中安靜地少掉幾行。畫面上是綠的、檔案也在，
// 學生要到某天發現自己的規則沒生效才知道（`seed-dirty-env.mjs` 的 dirty-configs
// 那步就是為了重現這個）。
//
// ⚠️ 判準是「這一行還在不在檔案裡」，**不是「還在不在原本的位置」**（Reed 拍板）。
// 合併本來就會重排順序、把同類的規則收在一起——那是合併該做的事，報成「弄丟了」
// 只會製造雜訊，學生看幾次就不看了。

// 比對前先正規化：前後空白與行尾差異不算改動。大小寫與內文一個字都不能變——
// 那才是真的被改寫。
function normalize(line) {
  return line.replace(/\r$/, "").trim();
}

// 空行與純分隔線不算內容。少一條 --- 不是「弄丟規則」，報出來只是雜訊。
function isNoise(text) {
  return text === "" || /^[-=*_#\s]+$/.test(text);
}

// 合併前有、合併後找不到的那幾行。
//
// 重複行用「數量」比：原本寫了三次的東西，合併後只剩一次，那也是丟了兩次。
// 只用 Set 的話這種情況完全看不到。
export function missingLines(before, after) {
  const remaining = new Map();

  for (const line of (after ?? "").split("\n")) {
    const text = normalize(line);

    if (isNoise(text)) {
      continue;
    }

    remaining.set(text, (remaining.get(text) ?? 0) + 1);
  }

  const missing = [];

  for (const [index, line] of (before ?? "").split("\n").entries()) {
    const text = normalize(line);

    if (isNoise(text)) {
      continue;
    }

    const left = remaining.get(text) ?? 0;

    if (left > 0) {
      remaining.set(text, left - 1);
      continue;
    }

    // 行號是**合併前**那份的行號——學生要對照的是他自己原本的檔案。
    missing.push({ line: index + 1, text });
  }

  return missing;
}

// 一份檔案的合併結果要說什麼。files 是 [{ target, before, after }]。
export function mergeReport(files) {
  const results = files.map((file) => ({
    target: file.target,
    missing: missingLines(file.before, file.after),
  }));
  const lost = results.filter((result) => result.missing.length > 0);
  const total = lost.reduce((sum, result) => sum + result.missing.length, 0);

  if (total === 0) {
    return { ok: true, total: 0, results, summary: "你原本的內容一行都沒少。" };
  }

  return {
    ok: false,
    total,
    results,
    summary: `合併後有 ${total} 行原本的內容找不到了——下面列出來，可以按「還原成合併前」退回去。`,
  };
}
