// 規則檔的安裝狀態：跟環境檢查同一個模式——一列一項，紅的給按鈕。
// 判斷依據是「真的生效了嗎」，不是「指令有沒有跑完」。
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import {
  countInstalledRules,
  describeStep,
  expandAllowRules,
  findHookRegistration,
  hasAgentHookRegistrations,
  hasMarkedBlock,
  stepsForTools,
} from "./config-install.js";
import { materialsDir } from "./paths.js";

const HOME = homedir();

async function readJsonOrNull(target) {
  if (!existsSync(target)) {
    return null;
  }

  try {
    return JSON.parse(await readFile(target, "utf8"));
  } catch {
    return null;
  }
}

async function sameAsSource(materials, step) {
  const source = path.join(materials, step.source);

  if (!existsSync(source) || !existsSync(step.target)) {
    return false;
  }

  const [a, b] = await Promise.all([
    readFile(source, "utf8"),
    readFile(step.target, "utf8"),
  ]);
  return a === b;
}

async function checkCopyStep(materials, step) {
  if (!existsSync(step.target)) {
    return {
      id: step.id,
      label: step.label,
      status: "missing",
      detail: "尚未安裝",
    };
  }

  const matches = await sameAsSource(materials, step);

  // 已存在但內容不是我們發的：那是使用者自己寫的，蓋掉會弄丟，要合併。
  if (step.protectExisting === true && !matches) {
    return {
      id: step.id,
      label: step.label,
      status: "warn",
      detail: "已有你自己的版本，需要合併",
      needsMerge: true,
    };
  }

  // 只看檔案在不在不夠：複製到一半中斷、或檔案是空的，一樣會「存在」。
  // 逐字比對才知道裝進去的真的是這一版。
  if (!matches) {
    return {
      id: step.id,
      label: step.label,
      status: "warn",
      detail: "檔案在，但內容跟這一版不同",
    };
  }

  return { id: step.id, label: step.label, status: "ok", detail: "已安裝" };
}

// 真的把一段指令餵給 hook，看它擋不擋。這是唯一「結構對了但行為可能還是不對」
// 的項目——Node 不在 PATH、檔案內容壞掉，檔案與註冊都完美，hook 照樣叫不起來，
// 而且不會有任何錯誤訊息。
export function probeHook(hookPath, command) {
  return new Promise((resolve) => {
    let child;

    try {
      child = spawn("node", [hookPath], {
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({ exitCode: null, stderr: error.message });
      return;
    }

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) =>
      resolve({ exitCode: null, stderr: error.message }),
    );
    child.once("close", (exitCode) => resolve({ exitCode, stderr }));
    child.stdin.end(
      JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
    );
  });
}

// 檔案在不代表生效——真正的開關是 settings.json 的 outputStyle 欄位。
async function checkOutputStyle(materials, step) {
  const file = await checkCopyStep(materials, step);

  if (file.status !== "ok") {
    return file;
  }

  const settings = await readJsonOrNull(step.settingsTarget);

  if (settings?.outputStyle !== step.styleName) {
    return {
      id: step.id,
      label: step.label,
      status: "warn",
      detail: "檔案在，但 settings.json 沒啟用它——回覆格式不會變",
    };
  }

  return {
    id: step.id,
    label: step.label,
    status: "ok",
    detail: `已啟用「${step.styleName}」`,
  };
}

async function checkHook(step) {
  const fileExists = existsSync(step.target);
  const settings = await readJsonOrNull(step.settingsTarget);
  const registration = findHookRegistration(settings ?? {});

  if (fileExists && registration !== null) {
    const probe = await probeHook(step.target, "echo a && echo b");

    if (probe.exitCode !== 2) {
      return {
        id: step.id,
        label: step.label,
        status: "warn",
        detail: `已註冊，但實測沒擋下來（exit ${probe.exitCode}）`,
      };
    }

    return {
      id: step.id,
      label: step.label,
      status: "ok",
      detail: "已註冊，實測會擋",
    };
  }

  // 複製成功但沒註冊是最危險的狀態：hook 不會擋，也不會報錯。
  if (fileExists) {
    return {
      id: step.id,
      label: step.label,
      status: "warn",
      detail: "檔案在，但 settings.json 沒註冊——不會擋",
    };
  }

  return {
    id: step.id,
    label: step.label,
    status: "missing",
    detail: registration === null ? "尚未安裝" : "已註冊但檔案不見了",
  };
}

async function checkAllowlist(materials, step) {
  const source = path.join(materials, step.source);

  if (!existsSync(source)) {
    return {
      id: step.id,
      label: step.label,
      status: "missing",
      detail: "嚮導內建的素材不完整，請重新下載嚮導",
    };
  }

  const allowlist = JSON.parse(await readFile(source, "utf8"));
  const expected = expandAllowRules(allowlist.permissions.allow, HOME);
  const settings = await readJsonOrNull(step.settingsTarget);
  const installed = countInstalledRules(settings ?? {}, expected);

  if (installed === expected.length) {
    return {
      id: step.id,
      label: step.label,
      status: "ok",
      detail: `${installed} 條規則`,
    };
  }

  return {
    id: step.id,
    label: step.label,
    status: installed === 0 ? "missing" : "warn",
    detail: `${installed} / ${expected.length} 條規則`,
  };
}

export async function checkTabSync(step) {
  if (!existsSync(step.target)) {
    return {
      id: step.id,
      label: step.label,
      status: "missing",
      detail: "尚未安裝",
    };
  }

  const rcContent = existsSync(step.rcTarget)
    ? await readFile(step.rcTarget, "utf8")
    : "";

  if (!hasMarkedBlock(rcContent, step.rcMarker)) {
    return {
      id: step.id,
      label: step.label,
      status: "warn",
      detail: "檔案在，但 shell function 沒寫進去",
    };
  }

  return { id: step.id, label: step.label, status: "ok", detail: "已啟用" };
}

export async function checkAgentHooks(step) {
  const filesExist = step.hookFiles.every((file) => existsSync(file.target));
  const settings = await readJsonOrNull(step.settingsTarget);
  const registered = hasAgentHookRegistrations(
    settings ?? {},
    step.registrations,
  );

  if (filesExist && registered) {
    return {
      id: step.id,
      label: step.label,
      status: "ok",
      detail: "hook 檔案與 3 筆註冊都已生效",
    };
  }

  if (filesExist) {
    return {
      id: step.id,
      label: step.label,
      status: "warn",
      detail: "檔案在，但沒註冊——不會被觸發",
    };
  }

  return {
    id: step.id,
    label: step.label,
    status: "missing",
    detail: registered ? "已註冊但 hook 檔案不完整" : "尚未安裝",
  };
}

export async function runConfigCheck({ tools, lang }) {
  const materials = materialsDir();
  const ids = stepsForTools(tools);
  const checks = [];

  for (const id of ids) {
    const step = describeStep(id, { lang, home: HOME });

    if (step.kind === "output-style") {
      checks.push(await checkOutputStyle(materials, step));
    } else if (step.kind === "hook") {
      checks.push(await checkHook(step));
    } else if (step.kind === "allowlist") {
      checks.push(await checkAllowlist(materials, step));
    } else if (step.kind === "tab-sync") {
      checks.push(await checkTabSync(step));
    } else if (step.kind === "agent-hooks") {
      checks.push(await checkAgentHooks(step));
    } else {
      checks.push(await checkCopyStep(materials, step));
    }
  }

  return {
    lang,
    tools,
    checks: checks.map((check) => ({
      ...check,
      installAction: check.status === "ok" ? null : "install-config-step",
      mergeAction: check.needsMerge === true ? "merge-config-step" : null,
    })),
  };
}
