#!/usr/bin/env python3
"""把一份 HTML 變成「打開就自己演」的單檔展示頁。

    python3 self_play.py <你的頁面.html> [輸出.html]

產出的檔案自己帶著全文與計時器，打開就開始演：左邊逐字打 code（語法高亮）、
右邊即時長出網頁。沒有任何外部依賴——瀏覽器直接開、Playwright MCP 開、`open`
指令開都一樣。

跟隔壁 live-preview/type_hl.py 的差別只有「誰在打字」：
    type_hl.py   Python 每 14ms 用 page.evaluate 餵一段字進頁面
                 → 要 python playwright + chromium（workshop 現場多兩個安裝步驟）
                 → 但可以每隔幾拍存一張 PNG，做影片/投影片用
    self_play.py 全文在產出時 inline 進頁面，計時器改用頁面自己的 setInterval
                 → 零依賴，只要有瀏覽器
                 → 沒有影格輸出（瀏覽器裡的 JS 存不了檔到硬碟）

兩支並存，各自有用武之地：現場演示用這支，要出影格用那支。

環境變數（跟原版同名同義）：
    CSS_SECONDS=10    <style> 區塊要壓縮到幾秒打完
    BODY_SECONDS=50   其餘 HTML 本體合計幾秒打完
    TICK_MS=14        每拍間隔毫秒（調大 = 顆粒感更粗，總時長仍由上面兩個秒數決定）

只用標準函式庫，不需要 pip install 任何東西。
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = os.path.join(HERE, "live_editor_self.html")

if len(sys.argv) < 2:
    sys.exit("用法: self_play.py <你的頁面.html> [輸出.html]")

SRC_PAGE = os.path.abspath(sys.argv[1])

if not os.path.exists(SRC_PAGE):
    sys.exit(f"找不到來源頁面：{SRC_PAGE}")

stem = os.path.splitext(os.path.basename(SRC_PAGE))[0]
OUT_PAGE = os.path.abspath(
    sys.argv[2]
    if len(sys.argv) > 2
    else os.path.join(os.path.dirname(SRC_PAGE), f"{stem}-self-play.html")
)

with open(SRC_PAGE, encoding="utf-8") as f:
    source = f.read()

with open(TEMPLATE, encoding="utf-8") as f:
    template = f.read()

# 來源內容整個變成 JS 字串常數。裡面的 </script> 會提早關掉外層的 <script>——
# HTML parser 只認字面上的 `</script`，不管它在不在 JS 字串裡，所以要把 `</` 拆開。
embedded = json.dumps(source, ensure_ascii=False).replace("</", "<\\/")

page = (
    template.replace("__SOURCE__", embedded)
    .replace("__CSS_SECONDS__", os.environ.get("CSS_SECONDS", "10"))
    .replace("__BODY_SECONDS__", os.environ.get("BODY_SECONDS", "50"))
    .replace("__TICK_MS__", os.environ.get("TICK_MS", "14"))
)

with open(OUT_PAGE, "w", encoding="utf-8") as f:
    f.write(page)

print(f"已產出自走版：{OUT_PAGE}")
print("直接用瀏覽器打開它就會開始演（右上角有「重播」）。")
