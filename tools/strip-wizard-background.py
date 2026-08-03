"""把 wizard.json 裡 56 張 webp 的「外框白底」挖成透明。

不能整張把白色都挖掉：巫師的鬍子與臉本來就是近白色，挖了會破洞。
所以從四邊往內 flood fill，只挖連得到畫面邊緣的那一片白。

邊緣的抗鋸齒像素給半透明（用它離純白的距離換算），不然透明區與圖形交界會留下一圈白邊。
"""

import base64
import io
import json
from collections import deque

from PIL import Image

import sys

SRC_IN = "/Users/reed/Downloads/Wizard.json"
SRC = "/Users/reed/Projects/jr-setup-ui-wt/ui-cards/public/vendor/wizard.json"
QUALITY = int(sys.argv[1]) if len(sys.argv) > 1 else 88
WHITE_MIN = 248  # 這個值以上算「底」
EDGE_MIN = 225   # 這個值以上算「交界的抗鋸齒」，給半透明


def strip_background(im):
    rgba = im.convert("RGBA")
    w, h = rgba.size
    px = rgba.load()
    outside = bytearray(w * h)
    queue = deque()

    def maybe_push(x, y):
        idx = y * w + x
        if outside[idx]:
            return
        r, g, b, _ = px[x, y]
        if min(r, g, b) < WHITE_MIN:
            return
        outside[idx] = 1
        queue.append((x, y))

    for x in range(w):
        maybe_push(x, 0)
        maybe_push(x, h - 1)
    for y in range(h):
        maybe_push(0, y)
        maybe_push(w - 1, y)

    while queue:
        x, y = queue.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h:
                maybe_push(nx, ny)

    # 挖掉背景；緊鄰背景的淺色像素給部分透明，交界才不會留白邊。
    for y in range(h):
        row = y * w
        for x in range(w):
            if outside[row + x]:
                px[x, y] = (0, 0, 0, 0)
                continue

            r, g, b, _ = px[x, y]
            level = min(r, g, b)

            if level < EDGE_MIN:
                continue

            touches = False
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h and outside[ny * w + nx]:
                    touches = True
                    break

            if touches:
                alpha = int(255 * (255 - level) / (255 - EDGE_MIN))
                px[x, y] = (r, g, b, max(0, min(255, alpha)))

    return rgba


data = json.load(open(SRC_IN))
total_before = 0
total_after = 0

for asset in data["assets"]:
    head, payload = asset["p"].split(",", 1)
    raw = base64.b64decode(payload)
    total_before += len(raw)
    out = io.BytesIO()
    stripped = strip_background(Image.open(io.BytesIO(raw)))
    # 畫面上只有 260×195，原圖 800×600 是浪費。縮到 2× 顯示尺寸（Retina 也夠），
    # 檔案小一大截而看不出差別。lottie 的圖層座標吃的是 asset 宣告的 w/h，所以
    # 這裡不改 w/h，只換實際像素——瀏覽器會照宣告的尺寸畫。
    stripped.save(out, format="WEBP", quality=QUALITY, method=6)
    encoded = out.getvalue()
    total_after += len(encoded)
    asset["p"] = "data:image/webp;base64," + base64.b64encode(encoded).decode("ascii")

json.dump(data, open(SRC, "w"), separators=(",", ":"))
print("frames", len(data["assets"]))
print("images %.0f KB -> %.0f KB" % (total_before / 1024, total_after / 1024))
