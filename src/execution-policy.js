export const EXECUTION_POLICY_PROBE = {
  cmd: "powershell.exe",
  args: [
    "-NoProfile",
    "-Command",
    "Get-ExecutionPolicy -Scope CurrentUser",
  ],
};

export const EXECUTION_POLICY_FIX = {
  cmd: "powershell.exe",
  args: [
    "-NoProfile",
    "-Command",
    "Set-ExecutionPolicy -Scope CurrentUser RemoteSigned -Force",
  ],
};

export function parseExecutionPolicy(stdout) {
  try {
    if (typeof stdout !== "string") {
      return { ok: false, detail: "無法判讀" };
    }

    const value = stdout.split(/\r?\n/, 1)[0].trim();
    const normalized = value.toLowerCase();

    if (normalized === "restricted" || normalized === "allsigned") {
      return {
        ok: false,
        detail: `目前是 ${value}，會擋掉 claude 與 codex`,
      };
    }

    if (
      normalized === "remotesigned" ||
      normalized === "unrestricted" ||
      normalized === "bypass"
    ) {
      return { ok: true, detail: `目前是 ${value}` };
    }

    if (normalized === "undefined") {
      return { ok: false, detail: "未設定，會擋掉 claude 與 codex" };
    }

    return { ok: false, detail: "無法判讀" };
  } catch {
    return { ok: false, detail: "無法判讀" };
  }
}
