import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Playwright 驗證存的那張截圖。這裡與 verify-in-terminal.mjs 各有一份路徑會走鐘，
// 所以定在這支共用檔裡，兩邊都從這裡拿。
//
// 一個 agent 一個檔名：兩邊共用同一個檔的話，先驗 claude 再驗 codex，claude 那張
// 卡上顯示的會是 codex 截的圖——兩張卡看起來都通過，其實只驗了一次。而且判定用的
// 是「檔案有沒有比開始時間新」，共用一個檔會讓第二次驗證直接撿到第一次的結果。
export const VERIFY_SHOT_AGENTS = ["claude", "codex"];

export function verifyShotPath(agent = "claude") {
  const safe = VERIFY_SHOT_AGENTS.includes(agent) ? agent : "claude";
  return resolve(
    homedir(),
    ".jr-setup",
    "verify",
    `mcp-playwright-${safe}.png`,
  );
}

export function ensureWorkDir() {
  const workDir = resolve(homedir(), ".jr-setup", "workdir");
  mkdirSync(workDir, { recursive: true });
  return workDir;
}

// ⚠️ 一律用 fileURLToPath，不要用 new URL(...).pathname。
// Windows 上 pathname 會回傳 "/C:/Users/..."（前面多一條斜線），拿去當指令參數
// 會被接成 "C:\C:\Users\..." 而找不到檔案。macOS 上 pathname 剛好是對的，
// 所以這個錯只有在 Windows 才會現形（實測踩過）。
export function moduleFile(relativePath, baseUrl) {
  return fileURLToPath(new URL(relativePath, baseUrl));
}

// 規則檔素材內建在 repo 裡（scripts/sync-materials.sh 從 jr_ai_agent_configs 同步）。
// 不在安裝時上網抓：工作坊現場網路不一定穩，少一個會壞的環節。
export function materialsDir() {
  return moduleFile("../materials", import.meta.url);
}

// 操作步驟與截圖。跟 materials 一樣內建在 repo 裡、跟著套件一起送——它們是學生
// 卡住時唯一的說明，不能靠上網抓。編輯用 tools/copy-studio。
export function contentDir() {
  return moduleFile("../content", import.meta.url);
}
