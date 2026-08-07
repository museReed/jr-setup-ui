// 把筆記庫的 GitHub 頁面在瀏覽器開起來。
//
//   node scripts/open-vault-repo.mjs
//
// 網址不寫死也不問學生：他不需要知道自己的帳號叫什麼，那個資訊在他機器上的
// git 設定裡。remote 是 https://github.com/<誰>/obsidian-vault.git，砍掉尾巴的
// .git 就是網頁。
import { execFileSync, spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";

import { VAULT_DIR } from "../src/config-install.js";

const vault = path.join(homedir(), VAULT_DIR);

function emitJr(event) {
  console.log(`@@JR ${JSON.stringify(event)}`);
}

let url;

try {
  url = execFileSync("git", ["-C", vault, "remote", "get-url", "origin"], {
    encoding: "utf8",
  })
    .trim()
    .replace(/\.git$/, "")
    // 直接帶到 commit 歷史：repo 首頁看到的是「現在有哪些檔」，
    // 學生要看的是「我改過什麼、每一次改了什麼」。
    .concat("/commits/main/");
} catch {
  const message =
    "還找不到 GitHub 上的筆記庫——先把上面那張「接到 GitHub 的筆記庫」裝好再回來";
  console.error(message);
  emitJr({ kind: "result", ok: false, summary: message });
  process.exit(1);
}

// 走 GitHub 的登入轉址，不要直接開那一頁。
//
// 筆記庫是 private：瀏覽器沒登入的話 GitHub 一律回 404（不是 403），學生看到的
// 是「這個頁面不存在」——他會以為是我們的網址壞了（Windows VM 實測）。
//
// /login?return_to=… 兩種狀態都對：沒登入先跳登入頁、登完自動回到這一頁；
// 已經登入就直接轉過去，中間那一頁看都看不到。
const target = new URL(url);
const open = `https://github.com/login?return_to=${encodeURIComponent(target.pathname)}`;

console.log(`打開：${url}`);

// detached + unref：瀏覽器開起來之後這支就該結束，不然卡片會一直轉圈。
const child =
  process.platform === "win32"
    ? spawn("cmd", ["/c", "start", "", open], { detached: true, stdio: "ignore" })
    : spawn("open", [open], { detached: true, stdio: "ignore" });

child.unref();

emitJr({
  kind: "result",
  ok: true,
  summary: "GitHub 上的改動歷史已經開起來了，每一行就是你的一次改動。",
});
