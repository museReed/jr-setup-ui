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

# 來源內容整個變成 JS 字串常數。裡面**每一個** `<` 都要換成 <，不能只處理 `</`。
#
# ⚠️ 只拆 `</` 是不夠的，而且錯得很難看（Windows VM 實測：整頁變成一堆 \n 與 <\/span>
# 的文字）。HTML parser 讀 <script> 內容時有三種狀態，換狀態的關鍵字不只 `</script`：
#
#   看到 <!--     → 進入 script data escaped
#   接著看到 <script → 進入 script data double escaped
#   在那個狀態下，`</script>` **關不掉** script，要先出現 -->
#
# 而 json.dumps 不會動 `<!--` 也不會動 `<script`。AI 產出的示範頁通常兩樣都有
# （它會寫註解，也常放一小段 script），於是樣板自己的 </script> 關不掉，整段 JS
# 變成畫面上的文字——那正是學生看到的畫面。
#
# 換成 < 就一次擋掉三種：`</script`、`<!--`、`<script` 都不再是字面上的 `<`。
# JS 字串裡的 < 解出來仍然是 `<`，內容一個字都沒變。
embedded = json.dumps(source, ensure_ascii=False).replace("<", "\\u003C")

# 佔位符只准出現一次。
#
# ⚠️ 這一條是實測撞出來的：樣板開頭的說明註解裡也寫了 __SOURCE__ 的字面，於是整份
# 來源被塞進那段註解，而來源自己的 `-->` 把註解提早收掉——畫面左上角冒出一堆
# <script>… 的亂碼，而下面的動畫看起來又是好的，完全看不出關聯。
#
# 靠「記得不要在註解裡寫」守不住，所以在這裡擋。
if template.count("__SOURCE__") != 1:
    sys.exit(
        f"樣板裡的 __SOURCE__ 出現了 {template.count('__SOURCE__')} 次，只能有一次"
        "——說明文字裡不要寫出它的字面（見 live_editor_self.html 開頭的註解）。"
    )

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
