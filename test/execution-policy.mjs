import assert from "node:assert/strict";

import {
  EXECUTION_POLICY_FIX,
  parseExecutionPolicy,
} from "../src/execution-policy.js";

function ok(description) {
  console.log(`ok - ${description}`);
}

assert.equal(parseExecutionPolicy("Restricted").ok, false);
ok("Restricted 會判定為需修正");

assert.equal(parseExecutionPolicy("RemoteSigned\r\n").ok, true);
ok("RemoteSigned 加換行仍會判定為通過");

assert.equal(parseExecutionPolicy("undefined").ok, false);
assert.equal(parseExecutionPolicy("UnDeFiNeD").ok, false);
ok("Undefined 不分大小寫都會判定為需修正");

assert.doesNotThrow(() => parseExecutionPolicy(""));
assert.equal(parseExecutionPolicy("").ok, false);
ok("空字串不拋錯並判定為無法判讀");

assert.doesNotThrow(() => parseExecutionPolicy(undefined));
assert.equal(parseExecutionPolicy(undefined).ok, false);
ok("undefined 不拋錯並判定為無法判讀");

const fixArgs = EXECUTION_POLICY_FIX.args.join(" ");
assert.match(fixArgs, /RemoteSigned/);
assert.match(fixArgs, /CurrentUser/);
assert.doesNotMatch(fixArgs, /LocalMachine|Bypass|Unrestricted/);
ok("修正指令只設定 CurrentUser 的 RemoteSigned");
