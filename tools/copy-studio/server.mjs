#!/usr/bin/env node
// copy-studio：跑在本機的 walkthrough 編輯器。
//
// 它直接讀寫 repo 裡的 content/，不經過任何資料庫——編完 git status 就看得到動了
// 哪幾個檔，改動照常走 PR。這是刻意的：文案與截圖是原始碼的一部分，不是外部資料。
//
// 零依賴（跟整個 repo 一樣）。工具不進 npm 套件，學生端拿不到。
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";

import { mergedOrder, walkthroughOrder } from "./order.mjs";
import { isWritten, visibleOn } from "./public/platform.js";

const ROOT = path.resolve(import.meta.dirname, "../..");
const PUBLIC = path.join(import.meta.dirname, "public");
const WALKTHROUGHS = path.join(ROOT, "content/walkthroughs");
const SHOTS = path.join(ROOT, "content/shots");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

// 只認這幾種。副檔名決定存下來的名字，所以不能讓呼叫端自己帶。
const IMAGE_EXT = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" };

const MAX_SHOT_BYTES = 12 * 1024 * 1024;

// id 一律只能是 kebab-case：它會變成檔名與資料夾名，放行別的字元就等於開放路徑穿越。
const SAFE_ID = /^[a-z0-9][a-z0-9-]*$/;

function json(res, code, body) {
  const text = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(text);
}

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;

    if (size > limit) {
      throw new Error("too-large");
    }

    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

// 檔名是算出來的，不存在 JSON 裡——存了就有兩份真相，改個步驟 id 就對不上。
// 見 docs/walkthrough-architecture.md。
export function shotName(stepIndex, kidIndex, kind, stepId, platform, ext = ".png") {
  const order = String(stepIndex + 1).padStart(2, "0");
  const sub = kidIndex === null ? "" : String.fromCharCode(97 + kidIndex);
  const plat = platform === undefined || platform === null ? "" : `.${platform}`;
  return `${order}${sub}-${kind}-${stepId}${plat}${ext}`;
}

// platform 為 null 代表兩個平台一起看；給了就只算那個平台看得到的節點。
async function listWalkthroughs(platform) {
  if (!existsSync(WALKTHROUGHS)) return [];

  const files = (await readdir(WALKTHROUGHS)).filter((name) => name.endsWith(".json"));
  const ranks = mergedOrder();
  const scoped =
    platform === null ? null : new Set(walkthroughOrder(platform).map((item) => item.id));
  const meta = new Map(
    [...walkthroughOrder("darwin"), ...walkthroughOrder("win32")].map((item) => [item.id, item]),
  );
  const out = [];

  for (const file of files) {
    const data = JSON.parse(await readFile(path.join(WALKTHROUGHS, file), "utf8"));

    // 這個平台上根本不會遇到的那幾份不列出來——列了只是讓人以為漏編。
    if (scoped !== null && !scoped.has(data.id)) continue;

    let steps = 0;
    let written = 0;
    let wantShots = 0;
    let haveShots = 0;

    for (const [stepIndex, step] of (data.steps ?? []).entries()) {
      if (!visibleOn(step, platform)) continue;

      const all = [[null, step], ...(step.kids ?? []).map((kid, i) => [i, kid])];

      for (const [kidIndex, node] of all) {
        if (!visibleOn(node, platform)) continue;

        steps += 1;

        if (isWritten(node.title)) written += 1;

        if (node.visual?.type !== "shot") continue;

        for (const shotPlatform of node.visual.platforms ?? [null]) {
          wantShots += 1;
          const name = shotName(
            stepIndex,
            kidIndex,
            kidIndex === null ? "do" : node.kind,
            node.id,
            shotPlatform,
          );

          if (existsSync(path.join(SHOTS, data.id, name))) haveShots += 1;
        }
      }
    }

    out.push({
      id: data.id,
      card: data.card,
      row: data.row,
      section: meta.get(data.id)?.section ?? "其他",
      // 排不到名次的（卡片被拿掉了但檔案還在）沉到最後，不要靜靜消失。
      rank: ranks.get(data.id) ?? Number.MAX_SAFE_INTEGER,
      steps,
      written,
      wantShots,
      haveShots,
    });
  }

  return out.sort((left, right) => left.rank - right.rank);
}

async function handle(req, res, url) {
  const { pathname } = url;

  if (pathname === "/api/walkthroughs") {
    const asked = url.searchParams.get("platform");
    const platform = asked === "mac" || asked === "win" ? asked : null;
    return json(res, 200, { platform, items: await listWalkthroughs(platform) });
  }

  const one = pathname.match(/^\/api\/walkthrough\/([a-z0-9-]+)$/);

  if (one !== null) {
    const id = one[1];
    const file = path.join(WALKTHROUGHS, `${id}.json`);

    if (!SAFE_ID.test(id) || !existsSync(file)) {
      return json(res, 404, { error: `沒有這一份：${id}` });
    }

    if (req.method === "GET") {
      return json(res, 200, JSON.parse(await readFile(file, "utf8")));
    }

    if (req.method === "PUT") {
      const body = JSON.parse((await readBody(req, 2 * 1024 * 1024)).toString("utf8"));

      if (body.id !== id) {
        return json(res, 400, { error: "id 對不上" });
      }

      // 兩格縮排 + 結尾換行：跟 repo 其他 JSON 一致，diff 才乾淨。
      await writeFile(file, `${JSON.stringify(body, null, 2)}\n`);
      return json(res, 200, { saved: true });
    }

    return json(res, 405, { error: "method not allowed" });
  }

  const shot = pathname.match(/^\/api\/shot\/([a-z0-9-]+)\/([a-z0-9.-]+)$/);

  if (shot !== null) {
    const [, id, name] = shot;

    if (!SAFE_ID.test(id) || name.includes("..") || name.startsWith(".")) {
      return json(res, 400, { error: "名字不合法" });
    }

    const dir = path.join(SHOTS, id);

    if (req.method === "DELETE") {
      await rm(path.join(dir, name), { force: true });
      return json(res, 200, { removed: true });
    }

    if (req.method === "POST") {
      const type = String(req.headers["content-type"] ?? "").split(";")[0];
      const ext = IMAGE_EXT[type];

      if (ext === undefined) {
        return json(res, 400, { error: `只收 PNG / JPG / WebP，收到 ${type || "空的"}` });
      }

      let bytes;

      try {
        bytes = await readBody(req, MAX_SHOT_BYTES);
      } catch {
        return json(res, 413, { error: "檔案太大（上限 12 MB）" });
      }

      // 副檔名一律由 content-type 決定，不用呼叫端傳來的那一段。
      const final = name.replace(/\.[a-z0-9]+$/, ext);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, final), bytes);
      return json(res, 200, { saved: final, bytes: bytes.length });
    }

    return json(res, 405, { error: "method not allowed" });
  }

  // 存下來的截圖：讓編輯器把它畫在佔位框上。
  if (pathname.startsWith("/shots/")) {
    const rel = pathname.slice("/shots/".length);

    if (rel.includes("..")) {
      return json(res, 400, { error: "路徑不合法" });
    }

    const file = path.join(SHOTS, rel);

    if (!existsSync(file)) {
      res.writeHead(404);
      return res.end();
    }

    res.writeHead(200, {
      "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    return createReadStream(file).pipe(res);
  }

  // 靜態：只有 public/ 底下那幾個檔，白名單以外一律 404。
  const name = pathname === "/" ? "/index.html" : pathname;
  const file = path.join(PUBLIC, name);

  if (!file.startsWith(PUBLIC) || !existsSync(file)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    return res.end("404");
  }

  res.writeHead(200, {
    "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
    "cache-control": "no-store",
  });
  return createReadStream(file).pipe(res);
}

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");

  handle(req, res, url).catch((error) => {
    // 錯誤要講得出是哪個檔壞了——編輯器那端只看得到一句話。
    console.error(`[copy-studio] ${req.method} ${url.pathname}：${error.message}`);
    json(res, 500, { error: error.message });
  });
});

// 只綁 127.0.0.1：這是個會寫檔案的工具，不該被同網段的人打得到。
const port = Number(process.env.PORT ?? 4200);
server.listen(port, "127.0.0.1", () => {
  const address = `http://127.0.0.1:${server.address().port}/`;
  console.log(`copy-studio：${address}`);
  console.log(`寫入：content/walkthroughs/ 與 content/shots/`);

  if (process.platform === "darwin" && !process.argv.includes("--no-open")) {
    spawn("open", [address], { detached: true, stdio: "ignore" }).unref();
  }
});
