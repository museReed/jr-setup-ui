import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describeStep } from "./config-install.js";
import { ensureWorkDir } from "./paths.js";

const VERSION = 1;

function locations(options) {
  if (options.home !== undefined && options.stateFile !== undefined) {
    return { home: options.home, stateFile: options.stateFile };
  }

  const root = path.dirname(ensureWorkDir());

  return {
    home: options.home ?? path.dirname(root),
    stateFile: options.stateFile ?? path.join(root, "state.json"),
  };
}

// 這一步自己的檔案。settings.json 不算在裡面——它是大家共用的一本，見下面。
function installedTargets(step) {
  if (step.kind === "copy") {
    return [step.target];
  }

  if (step.kind === "output-style" || step.kind === "hook") {
    return [step.target];
  }

  if (step.kind === "allowlist") {
    return [];
  }

  if (step.kind === "tab-sync") {
    return [step.target, step.rcTarget];
  }

  if (step.kind === "agent-hooks") {
    return [
      ...step.hookFiles.map((file) => file.target),
      ...step.supportFiles.map((file) => file.target),
    ];
  }

  if (step.kind === "skill") {
    return step.files.map((file) => file.target);
  }

  if (step.kind === "external-skill") {
    return [step.marker ?? step.mcpConfig];
  }

  return [];
}

// settings.json 是大家共用的一本筆記本，每一步在上面寫自己那一段。整本一起算的話，
// 別人在別頁寫一行字，我這一步的指紋就對不上——Output Style 驗過（最貴的一步，兩趟
// LLM），接著裝 hook、裝白名單、裝命名 hook，每一次都把它作廢一次（VM 實測）。
//
// 所以只取自己那一段。別人動別頁，我這段沒變，指紋照樣對得上。
function ownFileNames(step) {
  return [
    ...(step.hookFiles ?? []).map((file) => path.basename(file.target)),
    ...(step.target === undefined ? [] : [path.basename(step.target)]),
  ];
}

// Claude 的 settings.json 把所有 hook 註冊放在同一個物件裡，所以還要再篩一層：
// 只留提到自己檔名的那幾筆。不篩的話裝命名 hook 一樣會動到「Shell 不串接」那段。
function pickRegistrations(hooks, names) {
  if (hooks === null || typeof hooks !== "object" || names.length === 0) {
    return null;
  }

  const picked = {};

  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) continue;
    const mine = entries.filter((entry) =>
      names.some((name) => JSON.stringify(entry).includes(name)),
    );
    if (mine.length > 0) picked[event] = mine;
  }

  return Object.keys(picked).length === 0 ? null : picked;
}

function settingsSlice(step, settings) {
  if (settings === null || typeof settings !== "object") {
    return null;
  }

  if (step.kind === "output-style") {
    return { outputStyle: settings.outputStyle ?? null };
  }

  if (step.kind === "allowlist") {
    return { allow: settings.permissions?.allow ?? [] };
  }

  if (step.kind === "hook" || step.kind === "agent-hooks") {
    const names = ownFileNames(step);
    const slice = { hooks: pickRegistrations(settings.hooks ?? null, names) };

    if (step.namingAllowRule !== undefined) {
      slice.allow = (settings.permissions?.allow ?? []).filter(
        (rule) => rule === step.namingAllowRule,
      );
    }

    return slice;
  }

  return null;
}

// 兩本帳，因為它們回答的是兩個不同的問題：
//
//   verified  這一列整個綠了嗎——有眼睛勾選框的列，要學生看完畫面說了算
//   behavior  程式跑得出來的那半驗過了嗎——跟學生有沒有勾無關
//
// 原本只有一本，於是有眼睛的列連「程式驗過了」都無處可記，結果就被丟掉：終端印著
// 「驗證成功」，清單第一格卻還是空的，非要學生勾完眼睛才一起變（Reed 實測）。
//
// 兩本都吃同一套指紋失效：裝的檔案一改，先前驗過的結論就不算數。
const BUCKETS = ["verified", "behavior"];

async function readStoredState(stateFile) {
  const empty = () => ({ version: VERSION, verified: {}, behavior: {} });

  try {
    const state = JSON.parse(await readFile(stateFile, "utf8"));

    if (state?.version !== VERSION) {
      return empty();
    }

    for (const bucket of BUCKETS) {
      if (
        state[bucket] === null ||
        typeof state[bucket] !== "object" ||
        Array.isArray(state[bucket])
      ) {
        // 只有壞掉的那本歸零，另一本沒理由陪葬。
        state[bucket] = {};
      }
    }

    return state;
  } catch {
    return empty();
  }
}

// selection 不受指紋管轄，所以要在寫入 verified 時原樣帶著，別被蓋掉。

// 工具與語言的選擇存在 state.json，不是瀏覽器。
//
// localStorage 綁在 origin 上，而這個伺服器每次啟動都換一個 port——重開伺服器
// origin 就變了，存的東西等於不見。學生勾了 Codex、重開一次嚮導就默默退回只有
// Claude，卡片少了一半也沒有任何提示（Reed 實測踩到）。
//
// 這裡不需要指紋失效：它是使用者的偏好，不是「裝過而且還有效」的宣稱。
export async function loadSelection(options = {}) {
  const resolved = locations(options);
  const state = await readStoredState(resolved.stateFile);
  const selection = state.selection;

  if (selection === null || typeof selection !== "object") {
    return null;
  }

  const tools = Array.isArray(selection.tools)
    ? selection.tools.filter((tool) => tool === "claude" || tool === "codex")
    : [];

  return {
    tools: tools.length > 0 ? tools : null,
    lang: typeof selection.lang === "string" ? selection.lang : null,
  };
}

// 人工勾選跟 selection 一樣不受指紋管轄：它是「學生說他看到了」的宣稱，不是
// 「裝過而且還有效」——重裝檔案不該讓人重看一次畫面。
export async function loadManualChecked(options = {}) {
  const resolved = locations(options);
  const state = await readStoredState(resolved.stateFile);

  return Array.isArray(state.manual)
    ? state.manual.filter((id) => typeof id === "string")
    : [];
}

export async function saveManualChecked(ids, options = {}) {
  const resolved = locations(options);
  const state = await readStoredState(resolved.stateFile);

  state.version = VERSION;
  state.manual = ids.filter((id) => typeof id === "string");
  await mkdir(path.dirname(resolved.stateFile), { recursive: true });
  await writeFile(resolved.stateFile, `${JSON.stringify(state, null, 2)}\n`);
  return state.manual;
}

export async function saveSelection(selection, options = {}) {
  const resolved = locations(options);
  const state = await readStoredState(resolved.stateFile);

  state.version = VERSION;
  state.selection = selection;
  await mkdir(path.dirname(resolved.stateFile), { recursive: true });
  await writeFile(resolved.stateFile, `${JSON.stringify(state, null, 2)}\n`);
  return selection;
}

export async function fingerprintStep(
  stepId,
  { home, lang = "zh-TW", platform = process.platform, stateFile } = {},
) {
  const resolved = locations({ home, stateFile });
  const step = describeStep(stepId, {
    lang,
    home: resolved.home,
    platform,
  });
  const targets = installedTargets(step);
  const contents = [];

  for (const target of targets) {
    try {
      contents.push(await readFile(target));
    } catch {
      return "";
    }
  }

  // settings.json 只取自己那一段，不是整本。
  let slice = null;

  if (step.settingsTarget !== undefined) {
    try {
      slice = settingsSlice(step, JSON.parse(await readFile(step.settingsTarget, "utf8")));
    } catch {
      slice = null;
    }
  }

  if (contents.length === 0 && slice === null) {
    return "";
  }

  const hash = createHash("sha256");

  for (const content of contents) {
    hash.update(content);
  }

  if (slice !== null) {
    hash.update(JSON.stringify(slice));
  }

  return hash.digest("hex");
}

// 指紋不再讓紀錄消失，只回報「驗過之後有沒有被動過」。
//
// 原本對不上就整筆丟掉。但「裝好了卻不生效」這條防線後來做進即時檢查裡了（缺少、
// 開關被改掉、裝的是舊版都驗得出來），而畫面上那個勾本來就要求那一列現在還是好的
// ——指紋變成第二套機制，抓的東西重疊，卻用整檔比對，於是只剩誤傷。
//
// 留下來的用處只有一個，而且是即時檢查補不起來的：學生自己也會寫的那些檔案
// （合併過的 CLAUDE.md），工作坊那段還在、檢查照樣說 ok，但他新加的規則可能已經
// 跟驗過的行為打架。這種情況值得提醒，不值得直接作廢——所以現在只是一句話。
async function loadBucket(bucket, options) {
  const resolved = locations(options);
  const state = await readStoredState(resolved.stateFile);
  const recorded = [];
  const changed = [];

  for (const [stepId, record] of Object.entries(state[bucket])) {
    if (
      record === null ||
      typeof record !== "object" ||
      typeof record.fingerprint !== "string"
    ) {
      continue;
    }

    recorded.push(stepId);

    try {
      const fingerprint = await fingerprintStep(stepId, {
        ...options,
        home: resolved.home,
        stateFile: resolved.stateFile,
      });

      if (fingerprint !== record.fingerprint) {
        changed.push(stepId);
      }
    } catch {
      // 舊版或手改的未知 step 不該讓整份進度讀取失敗。算不出指紋就不提醒。
    }
  }

  return { recorded, changed };
}

async function markBucket(bucket, stepId, options) {
  const resolved = locations(options);
  const state = await readStoredState(resolved.stateFile);
  const fingerprint = await fingerprintStep(stepId, {
    ...options,
    home: resolved.home,
    stateFile: resolved.stateFile,
  });
  const record = {
    at: new Date().toISOString(),
    fingerprint,
  };

  state.version = VERSION;
  state[bucket][stepId] = record;
  await mkdir(path.dirname(resolved.stateFile), { recursive: true });
  await writeFile(resolved.stateFile, `${JSON.stringify(state, null, 2)}\n`);
  return record;
}

// 重驗之前要先把上一輪的結論忘掉。只清記憶體不夠：驗證失敗時那一格會留在畫面上
// 沒勾，但重新整理之後上一輪的勾又回來了——畫面說沒過、清單說過了。
async function clearBucket(bucket, stepId, options) {
  const resolved = locations(options);
  const state = await readStoredState(resolved.stateFile);

  if (state[bucket][stepId] === undefined) {
    return false;
  }

  delete state[bucket][stepId];
  state.version = VERSION;
  await mkdir(path.dirname(resolved.stateFile), { recursive: true });
  await writeFile(resolved.stateFile, `${JSON.stringify(state, null, 2)}\n`);
  return true;
}

export async function clearStepVerified(stepId, options = {}) {
  return clearBucket("verified", stepId, options);
}

export async function clearBehaviorVerified(stepId, options = {}) {
  return clearBucket("behavior", stepId, options);
}

export async function loadVerifiedSteps(options = {}) {
  return (await loadBucket("verified", options)).recorded;
}

export async function markStepVerified(stepId, options = {}) {
  return markBucket("verified", stepId, options);
}

// 「驗過之後這一步的東西被改過」——兩本帳一起看，畫面上只是多一句提醒。
export async function loadChangedSteps(options = {}) {
  const [verified, behavior] = await Promise.all([
    loadBucket("verified", options),
    loadBucket("behavior", options),
  ]);

  return [...new Set([...verified.changed, ...behavior.changed])];
}

// 程式那半驗過了——有眼睛勾選框的列也記，整列綠不綠是另一本帳的事。
export async function loadBehaviorVerifiedSteps(options = {}) {
  return (await loadBucket("behavior", options)).recorded;
}

export async function markBehaviorVerified(stepId, options = {}) {
  return markBucket("behavior", stepId, options);
}
