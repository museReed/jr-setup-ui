import assert from "node:assert/strict";

import { mergePath, spawnEnv, withUserBin } from "../src/env-path.js";

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

  // 迴歸（乾淨 VM 實測）：原生安裝器把 claude / codex 裝進 ~/.local/bin，而那個目錄
  // 是安裝當下才寫進 .zshrc 的。不補的話按完安裝、卡片還是「未安裝」，畫面卻寫著
  // 「狀態已更新」。
  assert.equal(
    withUserBin("/usr/bin:/bin", "/Users/x"),
    "/usr/bin:/bin:/Users/x/.local/bin",
  );
  ok("macOS 會把 ~/.local/bin 補進子程序的 PATH");

  // 已經在裡面就不重複追加，也不改變原本的順序。
  assert.equal(
    withUserBin("/Users/x/.local/bin:/usr/bin", "/Users/x"),
    "/Users/x/.local/bin:/usr/bin",
  );
  ok("已存在時不重複追加、不動順序");

  assert.equal(withUserBin(undefined, "/Users/x"), "/Users/x/.local/bin");
  assert.equal(withUserBin("/usr/bin::  :/bin", "/Users/x"), "/usr/bin:/bin:/Users/x/.local/bin");
  ok("PATH 缺漏或有空項目時不拋錯");

  const env = await spawnEnv();
  assert.equal(typeof env, "object");

  if (process.platform === "darwin") {
    assert(env.PATH.includes("/.local/bin"));
    ok("darwin 的子程序環境含 ~/.local/bin");
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
