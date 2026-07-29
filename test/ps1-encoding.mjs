// PowerShell 5.1 讀 .ps1 時，沒有 BOM 就當成系統 ANSI 編碼——檔案裡的中文會變
// 亂碼，而且亂碼字元可能剛好破壞字串引號，整支腳本連 parse 都過不了。
//
// 這種錯只有 Windows 會現形，macOS 上跑一百次都是綠的。所以這裡改成檢查「檔案
// 的形狀」：repo 裡任何一支帶非 ASCII 的 .ps1 都必須以 UTF-8 BOM 開頭。這條在
// 任何平台都會紅，不用等 VM。
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set(["node_modules", ".git", ".codex-task"]);
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

function collectPs1(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        found.push(...collectPs1(path.join(dir, entry.name)));
      }
    } else if (entry.name.endsWith(".ps1")) {
      found.push(path.join(dir, entry.name));
    }
  }
  return found;
}

// docs/setup.ps1 是給 `irm ... | iex` 用的，從來不是以檔案身分被 PowerShell 讀，
// 編碼由 HTTP 回應決定。加了 BOM 反而會在字串開頭多一個 U+FEFF 餵進 iex。
const EXEMPT = new Set(["docs/setup.ps1"]);

const files = collectPs1(repoRoot);
assert(files.length > 0, "一支 .ps1 都沒找到，這個測試等於沒在測");

for (const file of files) {
  if (EXEMPT.has(path.relative(repoRoot, file))) continue;

  const bytes = readFileSync(file);
  // 純 ASCII 的腳本沒有 BOM 也不會壞，不強求。
  if (bytes.every((byte) => byte < 0x80)) continue;

  assert(
    bytes.subarray(0, 3).equals(BOM),
    `${path.relative(repoRoot, file)} 有非 ASCII 字元卻沒有 UTF-8 BOM，` +
      "PowerShell 5.1 會讀成亂碼",
  );
}

console.log(`ok - 帶中文的 .ps1 都以 UTF-8 BOM 開頭（共檢查 ${files.length} 支）`);
