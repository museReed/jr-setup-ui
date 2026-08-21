import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { transformStepSource } from "./config-install.js";

// 合併 prompt 只能看到這個平台真的需要的 template。沒有 transform 的步驟仍直接
// 指向 materials；需要 transform 的才物化暫存檔，避免複製第二份長期 template。
export function stageMergeSources(
  materials,
  entries,
  { temporaryRoot = tmpdir() } = {},
) {
  const sources = new Map();
  let stagingDir = null;

  try {
    for (const [index, entry] of entries.entries()) {
      const source = path.join(materials, entry.source);

      if (entry.sourceTransform === undefined) {
        sources.set(entry.target, source);
        continue;
      }

      stagingDir ??= mkdtempSync(
        path.join(temporaryRoot, "jr-merge-sources-"),
      );
      const staged = path.join(
        stagingDir,
        `${index}-${entry.id}-${path.basename(entry.source)}`,
      );
      const content = transformStepSource(readFileSync(source, "utf8"), entry);
      writeFileSync(staged, content);
      sources.set(entry.target, staged);
    }
  } catch (error) {
    if (stagingDir !== null) {
      rmSync(stagingDir, { recursive: true, force: true });
    }
    throw error;
  }

  return {
    stagingDir,
    sourceFor(entry) {
      return sources.get(entry.target);
    },
    cleanup() {
      if (stagingDir !== null) {
        rmSync(stagingDir, { recursive: true, force: true });
      }
    },
  };
}

// 正常返回時由 caller 依「完成／逾時」決定何時清；只有啟動或輪詢拋錯時，這裡
// 保證不留下已經沒有人會再讀的 staging。
export async function withMergeSourceFailureCleanup(mergeSources, operation) {
  try {
    return await operation();
  } catch (error) {
    mergeSources.cleanup();
    throw error;
  }
}
