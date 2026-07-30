#!/usr/bin/env python3
"""高亮 + 智慧刷新版「左打碼、右即時預覽」——workshop 一條龍 demo 的收尾。

餵任何『單檔自包含 HTML』（CSS/JS inline），左邊逐字打並語法高亮，右邊即時長出網頁。

右邊全程只有「一份不重載的 document」：
  * body 用 document.write() 開一次 stream，每拍只把新打出來的那幾個字寫進去。
    已解析的節點原地不動 → 捲動位置自然保留 → 寫到哪捲到哪，不會閃。
  * CSS 不走 stream，直接改 head 那顆 <style> 的 textContent。規則沒打完瀏覽器
    本來就會忽略，等於免費得到「一條規則打完才套用」。
（早期版本每拍用 srcdoc / data: / file:// 重載整份文件，等於每秒把畫面打掉重畫
 七八次，白閃 + 捲軸歸零就是高頻跳動的來源。換哪種 URL 都救不了，只能不重載。）

<style>...</style> 區塊會被抓出來獨立計時，用 CSS_SECONDS 秒打完；
其餘 HTML 本體（<style> 前後所有內容）合計用 BODY_SECONDS 秒打完。

用法:
    type_hl.py <你的頁面.html> [live_editor_hl.html]

環境變數:
    PW_HEADLESS=1     不開視窗（純錄影/截圖）；不設則彈瀏覽器邊打邊長
    CSS_SECONDS=10    <style> 區塊要壓縮到幾秒打完
    BODY_SECONDS=50   其餘 HTML 本體要用幾秒打完
    TICK_MS=14        每拍間隔毫秒（調大 = 顆粒感更粗，總時長仍由上面兩個秒數決定）

依賴：python playwright（`python3 -m pip install playwright && python3 -m playwright install chromium`）。
"""
import os
import sys
import time

try:
    from playwright.sync_api import sync_playwright
except ModuleNotFoundError:
    sys.exit("需要 python playwright：python3 -m pip install --user playwright && python3 -m playwright install chromium")

if len(sys.argv) < 2:
    sys.exit("用法: type_hl.py <你的頁面.html> [live_editor_hl.html]")

HERE = os.path.dirname(os.path.abspath(__file__))
SRC_PAGE = os.path.abspath(sys.argv[1])
# 預設編輯器 = 跟本腳本同目錄的 live_editor_hl.html（不管你從哪個 cwd 跑都找得到）
EDITOR = os.path.abspath(sys.argv[2]) if len(sys.argv) > 2 else os.path.join(HERE, "live_editor_hl.html")
URL = "file://" + EDITOR
HEADLESS = os.environ.get("PW_HEADLESS") == "1"
TICK_MS = int(os.environ.get("TICK_MS", "14"))
CSS_SECONDS = float(os.environ.get("CSS_SECONDS", "10"))
BODY_SECONDS = float(os.environ.get("BODY_SECONDS", "50"))
STEM = os.path.splitext(os.path.basename(SRC_PAGE))[0]
OUT_DIR = os.path.dirname(SRC_PAGE)
VIDEO_DIR = os.path.join(OUT_DIR, f"video_{STEM}_hl")
SHOT_DIR = os.path.join(OUT_DIR, f"shots_{STEM}_hl")
os.makedirs(SHOT_DIR, exist_ok=True)

with open(SRC_PAGE, encoding="utf-8") as f:
    FULL = f.read()

# <style> 區塊的邊界：CSS_TEXT_START/END 圈的是「純 CSS 內容」（不含標籤本身），
# 那段會直接餵給右邊的 <style>.textContent，不會被 stream 進 body。
CSS_OPEN = FULL.find("<style")
_gt = FULL.find(">", CSS_OPEN) if CSS_OPEN != -1 else -1
_close = FULL.find("</style>", _gt) if _gt != -1 else -1
HAS_CSS = CSS_OPEN != -1 and _gt != -1 and _close != -1
CSS_TEXT_START = _gt + 1 if HAS_CSS else -1
CSS_TEXT_END = _close if HAS_CSS else -1
CSS_BLOCK_END = _close + len("</style>") if HAS_CSS else -1


def build_segments(full, css_seconds, body_seconds):
    """切成 [(start, end, duration_seconds, kind), ...]，kind = 'stream' | 'css'。

    'css' 段 = <style>...</style> 整塊，用 css_seconds 秒；
    'stream' 段 = 其餘 HTML 本體，合計用 body_seconds 秒（依長度按比例分配）。
    沒有 <style> 時整份都是 'stream'，用兩段秒數加總（維持原本總時長）。
    """
    total = len(full)
    if not HAS_CSS:
        return [(0, total, css_seconds + body_seconds, "stream")]

    non_css_len = total - (CSS_BLOCK_END - CSS_OPEN)
    segments = []
    if CSS_OPEN > 0:
        portion = CSS_OPEN / non_css_len if non_css_len > 0 else 0
        segments.append((0, CSS_OPEN, body_seconds * portion, "stream"))
    segments.append((CSS_OPEN, CSS_BLOCK_END, css_seconds, "css"))
    if CSS_BLOCK_END < total:
        portion = (total - CSS_BLOCK_END) / non_css_len if non_css_len > 0 else 0
        segments.append((CSS_BLOCK_END, total, body_seconds * portion, "stream"))
    return [s for s in segments if s[1] > s[0]]


def main():
    print(f"[hl] 來源頁面: {SRC_PAGE}（{len(FULL)} 字）")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=HEADLESS, args=["--window-size=1440,880"])
        context = browser.new_context(
            viewport={"width": 1360, "height": 800},
            record_video_dir=VIDEO_DIR,
            record_video_size={"width": 1360, "height": 800},
        )
        page = context.new_page()
        page.goto(URL)
        page.wait_for_timeout(400)
        page.evaluate("() => window.T.begin()")   # 開一次 stream，之後全程不重載

        total = len(FULL)
        segments = build_segments(FULL, CSS_SECONDS, BODY_SECONDS)
        print(
            f"[hl] CSS 區塊目標 {CSS_SECONDS:.0f}s / 本體目標 {BODY_SECONDS:.0f}s"
            f"（共 {len(segments)} 段）"
        )
        shot_at = max(1, total // 5)
        next_shot = shot_at
        written = 0   # body stream 已經寫到 FULL 的第幾個字
        # 用真實時鐘反推目前該打到第幾個字，而非用「拍數 x TICK_MS」預估——
        # 後者忽略了 page.evaluate 往返耗時，幾千拍下來誤差會累積到肉眼可見。
        for start, end, duration_s, kind in segments:
            seg_len = end - start
            t0 = time.time()
            k = start
            while k < end:
                elapsed = time.time() - t0
                frac = min(1.0, elapsed / duration_s) if duration_s > 0 else 1.0
                k = start + round(seg_len * frac) if frac < 1.0 else end
                page.evaluate("(raw) => window.T.left(raw)", FULL[:k])

                if kind == "stream":
                    page.evaluate("(t) => window.T.mode(t)", "")
                    chunk = FULL[written:k]
                    if chunk:
                        page.evaluate("(c) => window.T.write(c)", chunk)
                        written = k
                    page.evaluate("() => window.T.follow()")
                else:
                    page.evaluate("(t) => window.T.mode(t)", "CSS 撰寫中…")
                    cur_end = min(k, CSS_TEXT_END)
                    if cur_end > CSS_TEXT_START:
                        page.evaluate("(t) => window.T.css(t)", FULL[CSS_TEXT_START:cur_end])

                if k >= next_shot:
                    page.screenshot(path=os.path.join(SHOT_DIR, f"{STEM}-{k:04d}.png"))
                    next_shot += shot_at
                if k < end:
                    page.wait_for_timeout(TICK_MS)

            if kind == "css":
                written = end   # <style> 標籤本身不進 body stream，直接跳過

        page.evaluate("() => window.T.end()")     # 收掉 stream，尾端的 <script> 也在這時跑完
        page.wait_for_timeout(1500)
        page.screenshot(path=os.path.join(SHOT_DIR, f"{STEM}-final.png"))

        if not HEADLESS:
            print("[hl] 打完了——關掉瀏覽器視窗即結束。")
            try:
                page.wait_for_event("close", timeout=0)
            except Exception:
                pass

        context.close()
        browser.close()
        print(f"[hl] 影片 → {VIDEO_DIR}")
        print(f"[hl] 截圖 → {SHOT_DIR}")


if __name__ == "__main__":
    main()
