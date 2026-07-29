import assert from "node:assert/strict";

import {
  encodingProbeSource,
  ghosttyStatus,
  parsePowerShellVersion,
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

assert.deepEqual(windowsTerminalStatus({ WT_SESSION: "session-id" }), {
  status: "ok",
  detail: "是",
});
assert.deepEqual(windowsTerminalStatus({}), {
  status: "warn",
  detail: "不是 Windows Terminal——tab 標題功能不會運作",
});
ok("WT_SESSION 有值時是 Windows Terminal，沒有時只警告");
