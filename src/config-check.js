// 規則檔的安裝狀態：跟環境檢查同一個模式——一列一項，紅的給按鈕。
// 判斷依據是「真的生效了嗎」，不是「指令有沒有跑完」。
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import {
  countInstalledRules,
  describeStep,
  expandAllowRules,
  findHookRegistration,
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

async function checkMaterials(materials) {
  const ready = existsSync(path.join(materials, "claude-code"));

  return {
    id: "materials",
    label: "設定素材",
    status: ready ? "ok" : "missing",
    detail: ready ? "已下載" : "尚未下載",
  };
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

  // 已存在但內容不是我們發的：那是使用者自己寫的，蓋掉會弄丟，要合併。
  if (step.protectExisting === true && !(await sameAsSource(materials, step))) {
    return {
      id: step.id,
      label: step.label,
      status: "warn",
      detail: "已有你自己的版本，需要合併",
      needsMerge: true,
    };
  }

  return { id: step.id, label: step.label, status: "ok", detail: "已安裝" };
}

async function checkHook(step) {
  const fileExists = existsSync(step.target);
  const settings = await readJsonOrNull(step.settingsTarget);
  const registration = findHookRegistration(settings ?? {});

  if (fileExists && registration !== null) {
    return {
      id: step.id,
      label: step.label,
      status: "ok",
      detail: "檔案就位且已註冊",
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
      detail: "尚未下載素材",
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

export async function runConfigCheck({ tools, lang }) {
  const materials = materialsDir();
  const ids = stepsForTools(tools);
  const checks = [];

  for (const id of ids) {
    const step = describeStep(id, { lang, home: HOME });

    if (step.kind === "download") {
      checks.push(await checkMaterials(materials));
    } else if (step.kind === "hook") {
      checks.push(await checkHook(step));
    } else if (step.kind === "allowlist") {
      checks.push(await checkAllowlist(materials, step));
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
