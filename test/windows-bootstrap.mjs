import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const setupPath = fileURLToPath(new URL("../docs/setup.ps1", import.meta.url));
const setup = readFileSync(setupPath, "utf8");
const executable = setup.replace(/^\s*#.*$/gm, "");

assert.match(
  setup,
  /Get-Variable -Name JrBranch -ValueOnly -ErrorAction SilentlyContinue/,
);
assert.match(setup, /if \(-not \$branch\) \{ \$branch = "main" \}/);
assert.doesNotMatch(executable, /if \(\$JrBranch\)/);

if (process.platform === "win32") {
  const parseScript = String.raw`
$tokens = $null
$errors = $null
[System.Management.Automation.Language.Parser]::ParseInput(
  [Console]::In.ReadToEnd(),
  [ref]$tokens,
  [ref]$errors
) | Out-Null
if ($errors.Count -gt 0) {
  $errors | ForEach-Object { [Console]::Error.WriteLine($_.Message) }
  exit 1
}
`;
  const parsed = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", parseScript],
    { input: setup, encoding: "utf8" },
  );
  assert.equal(parsed.status, 0, parsed.stderr);
}

console.log("ok - Windows bootstrap 在 JrBranch 未設定時使用 main，且可由 PowerShell 5.1 解析");
