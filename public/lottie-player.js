// Lottie 動畫的黏合層。唯一碰 window.lottie 的地方。
//
// lottie-web 走 vendor 不走 CDN，理由跟 driver.js 一樣：學生的 VM 常常連不到外網，
// 指 CDN 的話動畫會靜靜地不出現，而且沒有人會知道為什麼。用的是 light 版（168KB，
// 少了 expressions），這兩支動畫都沒用到 expressions。
//
// 動畫檔只讀一次就快取起來：里程碑那隻貓是 261KB 的逐格 PNG，每次重畫都重抓一遍
// 的話，翻一張卡就多一次 261KB 的解析。
const cache = new Map();
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function loadAnimationData(url) {
  if (!cache.has(url)) {
    cache.set(
      url,
      fetch(url)
        .then((response) => response.json())
        // 抓不到就記 null，不要把 rejected promise 留在快取裡——之後每次用都會
        // 再炸一次，而且是沒人接的那種。
        .catch(() => null),
    );
  }

  return cache.get(url);
}

// 回傳容器，外加一個「動畫掛好了沒」的 promise。lottie 還沒載入或動畫抓不到時
// promise 給 null——少一隻貓不該把整個設定流程帶走。
//
// startFrame 是「停在哪一格」：鎖頭一開始要停在上鎖那一格（見 view.js 的 LOCK_*），
// 不給就從頭播。
export function lottieControl({
  url,
  className,
  loop = true,
  autoplay = true,
  startFrame = null,
}) {
  const box = document.createElement("span");
  box.className = className;
  box.setAttribute("aria-hidden", "true");

  const ready = loadAnimationData(url).then((animationData) => {
    if (animationData === null || window.lottie === undefined) return null;

    const animation = window.lottie.loadAnimation({
      container: box,
      renderer: "svg",
      loop,
      // 系統設了「減少動態」就不自己動。動畫是氣氛，不是資訊。
      autoplay: autoplay && !reducedMotion.matches,
      // 同一份 JSON 會被掛在好幾個地方（四個分頁各一個鎖頭），lottie 會就地改寫
      // 它拿到的物件——共用同一份的話，第二個之後的動畫會拿到已經被改過的資料。
      animationData: structuredClone(animationData),
    });

    if (startFrame !== null) {
      animation.goToAndStop(startFrame, true);
    }

    return animation;
  });

  return { box, ready };
}

export function lottieBox(options) {
  return lottieControl(options).box;
}
