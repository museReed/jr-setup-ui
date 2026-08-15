import assert from "node:assert/strict";

import {
  encodingProbeSource,
  ghosttyStatus,
  parsePowerShellVersion,
  typelessAppPaths,
  typelessStatus,
  windowsTerminalStatus,
} from "../src/env-check.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

assert.deepEqual(parsePowerShellVersion("5.1.19041.1\r\n"), {
  version: "5.1.19041.1",
  supported: true,
});
assert.deepEqual(parsePowerShellVersion("7.4.2\n"), {
  version: "7.4.2",
  supported: true,
});
assert.deepEqual(parsePowerShellVersion("5.0"), {
  version: "5.0",
  supported: false,
});
assert.deepEqual(parsePowerShellVersion("PowerShell 七"), {
  version: null,
  supported: false,
});
ok("PowerShell 5.1 與 7.x 支援，5.0 與無法辨識的輸出不支援");

const probeText = "繁體中文測試";
const probeSource = encodingProbeSource(probeText);
assert(probeSource.startsWith("\uFEFF"));
assert(probeSource.includes(probeText));
ok("中文編碼探測腳本以 UTF-8 BOM 開頭並包含預期文字");

const systemPath = "/Applications/Ghostty.app";
const userPath = "/Users/test/Applications/Ghostty.app";
assert.deepEqual(
  ghosttyStatus([systemPath, userPath], (path) => path === systemPath),
  { status: "ok", detail: "已安裝" },
);
assert.deepEqual(
  ghosttyStatus([systemPath, userPath], (path) => path === userPath),
  { status: "ok", detail: "已安裝" },
);
assert.deepEqual(
  ghosttyStatus([systemPath, userPath], () => false),
  { status: "missing", detail: "未安裝" },
);
ok("Ghostty 任一路徑存在時已安裝，兩處都不存在時未安裝");

// ⚠️ 這一條釘的是「沒裝時的狀態不能是 missing」。missing 會擋住整張卡完成
// （cardIsComplete 要求每一列 ok），而 Typeless 是選用的——那就變成學生不裝
// 就永遠打不了勾，跟 issue #4 一模一樣的死法。
assert.equal(typelessStatus(true).status, "ok");
assert.equal(typelessStatus(false).status, "optional");
assert.match(typelessStatus(false).detail, /不裝也能上課/);
assert.deepEqual(typelessAppPaths("/Users/test"), [
  "/Applications/Typeless.app",
  "/Users/test/Applications/Typeless.app",
]);
ok("Typeless 沒裝時是 optional 不是 missing，選用的東西不擋人");

assert.deepEqual(windowsTerminalStatus({ WT_SESSION: "session-id" }, true), {
  status: "ok",
  detail: "是",
});
ok("WT_SESSION 有值就是跑在 Windows Terminal 上");

// 工作坊硬性要求，所以是紅的不是黃的。
const notUsing = windowsTerminalStatus({}, true);
assert.equal(notUsing.status, "missing");
assert.equal(notUsing.installable, false);
assert.match(notUsing.detail, /重新啟動嚮導/);
ok("裝了但沒用它開 → 紅燈叫人換視窗，不給安裝按鈕");

const notInstalled = windowsTerminalStatus({}, false);
assert.equal(notInstalled.status, "missing");
assert.equal(notInstalled.installable, true);
assert.match(notInstalled.detail, /尚未安裝/);
ok("完全沒裝 → 紅燈且給安裝按鈕");
