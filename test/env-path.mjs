import assert from "node:assert/strict";

import { mergePath, spawnEnv } from "../src/env-path.js";

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

  // 非 Windows 直接沿用目前環境，不去跑 powershell。
  const env = await spawnEnv();
  assert.equal(typeof env, "object");

  if (process.platform !== "win32") {
    assert.equal(env, process.env);
    ok("非 Windows 直接沿用 process.env");
  } else {
    assert.equal(typeof env.PATH, "string");
    ok("Windows 取得含 PATH 的環境變數");
  }
} catch (error) {
  console.error(`not ok - ${error.stack ?? error.message}`);
  process.exit(1);
}
