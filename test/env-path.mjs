import assert from "node:assert/strict";

import { mergePath, spawnEnv, withPath, withUserBin } from "../src/env-path.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

try {
  assert.equal(
    mergePath("C:\\a;C:\\b", "C:\\c", "C:\\a;C:\\d"),
    "C:\\a;C:\\b;C:\\c;C:\\d",
  );
  ok("三個來源合併後保持順序且不重複");

  // 大小寫不同的同一個目錄不能重複出現。
  assert.equal(mergePath("C:\\A", "c:\\a", ""), "C:\\A");
  ok("路徑比對不分大小寫");

  assert.equal(mergePath("C:\\a;;  ;C:\\b", "", undefined), "C:\\a;C:\\b");
  ok("空白與空項目會被丟掉");

  assert.equal(mergePath(undefined, null, "C:\\x"), "C:\\x");
  ok("來源缺漏不會拋錯");

  // claude 的 Windows 安裝器把執行檔放在 %USERPROFILE%\.local\bin，但它有沒有把那個
  // 目錄寫進登錄檔，從安裝腳本裡看不出來（codex 那支明確會寫）。所以多帶一份已知
  // 落點進來當保險——重讀登錄檔本來就是為了「剛裝好的東西要叫得動」。
  assert.equal(
    mergePath("C:\\a", "C:\\b", "C:\\c", "C:\\Users\\x\\.local\\bin"),
    "C:\\a;C:\\b;C:\\c;C:\\Users\\x\\.local\\bin",
  );
  // 登錄檔裡已經有了就不重複——大小寫不同也算同一個。
  assert.equal(
    mergePath("C:\\a", "C:\\Users\\X\\.local\\bin", "", "C:\\Users\\x\\.local\\bin"),
    "C:\\a;C:\\Users\\X\\.local\\bin",
  );
  ok("額外補進來的已知落點會併入，且不重複");

  // 迴歸（乾淨 VM 實測，兩次）：
  //   ~/.local/bin      裝完 claude，卡片仍顯示「未安裝」，畫面卻寫著「狀態已更新」
  //   /opt/homebrew/bin brew 明明裝好了，按 gh 仍說「找不到 brew 指令」
  // 兩個都是「安裝當下才被寫進 shell 設定檔」的目錄，而已經開著的終端機不會重讀
  // 設定檔。VM 上診斷出來的更精確：brew 的設定寫在 .zprofile，那只有 login shell 讀，
  // .zshrc 裡沒有——非 login shell 開的嚮導就看不到。
  assert.equal(
    withUserBin("/usr/bin:/bin", "/Users/x"),
    "/usr/bin:/bin:/Users/x/.local/bin:/opt/homebrew/bin",
  );
  ok("macOS 會把 ~/.local/bin 與 /opt/homebrew/bin 補進子程序的 PATH");

  // 已經在裡面就不重複追加，也不改變原本的順序。
  assert.equal(
    withUserBin("/opt/homebrew/bin:/Users/x/.local/bin:/usr/bin", "/Users/x"),
    "/opt/homebrew/bin:/Users/x/.local/bin:/usr/bin",
  );
  ok("已存在時不重複追加、不動順序");

  assert.equal(
    withUserBin(undefined, "/Users/x"),
    "/Users/x/.local/bin:/opt/homebrew/bin",
  );
  assert.equal(
    withUserBin("/usr/bin::  :/bin", "/Users/x"),
    "/usr/bin:/bin:/Users/x/.local/bin:/opt/homebrew/bin",
  );
  ok("PATH 缺漏或有空項目時不拋錯");

  // ⚠️ 整個 Windows 支援最陰的一個坑（Windows VM 實測：git 與 Claude Code CLI 都是
  // winget/安裝器印 Successfully installed、exit code 0，那一列還是「未安裝」，而
  // PATH 裡明明有 C:\Program Files\Git\cmd）。
  //
  // Windows 的環境變數不分大小寫，process.env 上那把鑰匙實際叫 `Path`。所以
  // { ...process.env, PATH: 重算過的 } 會同時有兩把，而 Node 在 win32 上 spawn 前
  // 會濾掉大小寫重複的鍵、保留**先出現的那一把**——`Path`（舊快照）贏，新算的
  // `PATH` 整個被丟掉。重讀登錄檔那套機制等於從來沒生效過。
  const windowsish = withPath(
    { Path: "C:\\old", USERPROFILE: "C:\\Users\\x" },
    "C:\\new",
  );
  assert.deepEqual(Object.keys(windowsish).sort(), ["PATH", "USERPROFILE"]);
  assert.equal(windowsish.PATH, "C:\\new");
  assert.equal(windowsish.Path, undefined, "舊的那把鑰匙一定要拿掉");
  // 小寫的那把也算同一把。
  assert.equal(withPath({ path: "C:\\old" }, "C:\\new").path, undefined);
  // PATH 以外的東西原封不動。
  assert.equal(windowsish.USERPROFILE, "C:\\Users\\x");
  ok("重算過的 PATH 會蓋掉不同大小寫的舊鑰匙，不留兩把");

  const env = await spawnEnv();
  assert.equal(typeof env, "object");

  if (process.platform === "darwin") {
    assert(env.PATH.includes("/.local/bin"));
    assert(env.PATH.includes("/opt/homebrew/bin"));
    ok("darwin 的子程序環境含 ~/.local/bin 與 /opt/homebrew/bin");
  } else if (process.platform !== "win32") {
    assert.equal(env, process.env);
    ok("其餘非 Windows 平台直接沿用 process.env");
  } else {
    assert.equal(typeof env.PATH, "string");
    ok("Windows 取得含 PATH 的環境變數");
  }
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
