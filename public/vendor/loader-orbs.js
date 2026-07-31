(function () {
  "use strict";

  const selector = [
    ".ds-loader-orbs--solving",
    ".ds-loader-orbs--composing",
    ".ds-loader-orbs--shaping",
  ].join(",");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const darkScheme = matchMedia("(prefers-color-scheme: dark)");
  const instances = [];

  function dot(context, x, y, radius, opacity) {
    context.globalAlpha = opacity;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }

  function drawSolving(instance, phase) {
    const { context, size, small } = instance;
    const bands = small ? 3 : 5;
    const columns = small ? 5 : 8;
    const radius = small ? 1 : 2.1;
    const gapX = size * (small ? 0.19 : 0.105);
    const gapY = size * (small ? 0.25 : 0.14);
    const startX = (size - gapX * (columns - 1)) / 2;
    const startY = (size - gapY * (bands - 1)) / 2;
    const scrambling = phase < 0.7;
    const pulse = 0.92 + Math.sin(phase * Math.PI * 9) * 0.08;

    for (let band = 0; band < bands; band += 1) {
      const direction = band % 2 === 0 ? 1 : -1;
      const offset = scrambling
        ? Math.sin(phase * Math.PI * 4 + band * 1.7) *
          size *
          (small ? 0.11 : 0.13) *
          direction
        : 0;
      const vertical = scrambling
        ? Math.cos(phase * Math.PI * 3 + band) * size * 0.025
        : 0;
      for (let column = 0; column < columns; column += 1) {
        dot(
          context,
          startX + column * gapX + offset,
          startY + band * gapY + vertical,
          radius * pulse,
          0.48 + ((column + band) % 3) * 0.2,
        );
      }
    }
  }

  function drawComposing(instance, phase) {
    const { context, size, small } = instance;
    const bands = small ? 3 : 5;
    const columns = small ? 5 : 10;
    const radius = small ? 1 : 1.9;
    const gapX = (size * (small ? 0.78 : 0.8)) / (columns - 1);
    const startX = size * (small ? 0.11 : 0.1);
    const centerY = size / 2;
    const bandGap = size * (small ? 0.18 : 0.095);
    const amplitude = size * (small ? 0.12 : 0.1);

    for (let band = 0; band < bands; band += 1) {
      for (let column = 0; column < columns; column += 1) {
        const wave =
          phase * Math.PI * 2 +
          column * (small ? 0.9 : 0.58) +
          band * 0.72;
        const y =
          centerY +
          (band - (bands - 1) / 2) * bandGap +
          Math.sin(wave) * amplitude;
        dot(
          context,
          startX + column * gapX,
          y,
          radius * (0.9 + Math.cos(wave) * 0.1),
          0.42 + (band / bands) * 0.5,
        );
      }
    }
  }

  function perimeterPoint(vertices, position) {
    const scaled = position * vertices.length;
    const edge = Math.floor(scaled) % vertices.length;
    const progress = scaled - Math.floor(scaled);
    const start = vertices[edge];
    const end = vertices[(edge + 1) % vertices.length];
    return {
      x: start.x + (end.x - start.x) * progress,
      y: start.y + (end.y - start.y) * progress,
    };
  }

  function shapePoint(shape, position, radius) {
    const angle = position * Math.PI * 2 - Math.PI / 2;
    if (shape === 0) {
      return {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      };
    }
    if (shape === 1) {
      return perimeterPoint(
        [
          { x: 0, y: -radius },
          { x: radius * 0.9, y: radius * 0.72 },
          { x: radius * -0.9, y: radius * 0.72 },
        ],
        position,
      );
    }
    return perimeterPoint(
      [
        { x: -radius, y: -radius },
        { x: radius, y: -radius },
        { x: radius, y: radius },
        { x: -radius, y: radius },
      ],
      position,
    );
  }

  function drawShaping(instance, phase) {
    const { context, size, small } = instance;
    const count = small ? 12 : 32;
    const radius = size * (small ? 0.36 : 0.37);
    const radiusDot = small ? 1 : 2;
    const stage = phase * 3;
    const from = Math.floor(stage) % 3;
    const to = (from + 1) % 3;
    const rawProgress = stage - Math.floor(stage);
    const progress = rawProgress * rawProgress * (3 - 2 * rawProgress);

    for (let index = 0; index < count; index += 1) {
      const position = index / count;
      const start = shapePoint(from, position, radius);
      const end = shapePoint(to, position, radius);
      dot(
        context,
        size / 2 + start.x + (end.x - start.x) * progress,
        size / 2 + start.y + (end.y - start.y) * progress,
        radiusDot * (0.92 + Math.sin(phase * Math.PI * 2 + index) * 0.08),
        0.55 + (index % 4) * 0.13,
      );
    }
  }

  function draw(instance, now) {
    if (!instance.size) return;
    const cycles = instance.small
      ? { solving: 1900, composing: 1600, shaping: 2200 }
      : { solving: 2400, composing: 2100, shaping: 3000 };
    const phase = ((now * instance.speed) % cycles[instance.state]) /
      cycles[instance.state];
    const { context, canvas, dpr, size } = instance;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.fillStyle = instance.color;
    context.globalAlpha = 1;
    if (instance.state === "solving") drawSolving(instance, phase);
    if (instance.state === "composing") drawComposing(instance, phase);
    if (instance.state === "shaping") drawShaping(instance, phase);
    context.globalAlpha = 1;
    context.setTransform(1, 0, 0, 1, 0, 0);
    instance.size = size;
  }

  function resize(instance) {
    const box = instance.host.getBoundingClientRect();
    if (!box.width || !box.height) return false;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.round(box.width * dpr);
    const height = Math.round(box.height * dpr);
    instance.size = Math.min(box.width, box.height);
    instance.dpr = dpr;
    if (instance.canvas.width !== width || instance.canvas.height !== height) {
      instance.canvas.width = width;
      instance.canvas.height = height;
      return true;
    }
    return false;
  }

  function resolveTokens(instance) {
    const style = getComputedStyle(instance.host);
    const parsedSpeed = Number.parseFloat(
      style.getPropertyValue("--orb-speed"),
    );
    instance.color = style.color;
    instance.speed = Number.isFinite(parsedSpeed) && parsedSpeed > 0
      ? parsedSpeed
      : 1;
    instance.host.dataset.orbResolvedSpeed = String(instance.speed);
  }

  function shouldRun(instance) {
    return instance.visible &&
      !instance.host.classList.contains("is-paused") &&
      !reducedMotion.matches;
  }

  function stop(instance) {
    if (instance.frame !== null) {
      cancelAnimationFrame(instance.frame);
      instance.frame = null;
    }
  }

  function tick(instance, now) {
    instance.frame = null;
    if (!shouldRun(instance)) return;
    resize(instance);
    draw(instance, now);
    instance.frame = requestAnimationFrame((time) => tick(instance, time));
  }

  function sync(instance, representativeTime) {
    resolveTokens(instance);
    resize(instance);
    if (shouldRun(instance)) {
      if (instance.frame === null) {
        instance.frame = requestAnimationFrame((time) => tick(instance, time));
      }
      return;
    }
    stop(instance);
    draw(instance, representativeTime);
  }

  function init(host) {
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    host.append(canvas);
    const context = canvas.getContext("2d");
    const instance = {
      canvas,
      color: "",
      context,
      dpr: 1,
      frame: null,
      host,
      size: 0,
      small: host.classList.contains("ds-loader-orbs--sm"),
      speed: 1,
      state: host.classList.contains("ds-loader-orbs--solving")
        ? "solving"
        : host.classList.contains("ds-loader-orbs--composing")
          ? "composing"
          : "shaping",
      visible: false,
    };
    instances.push(instance);
    sync(instance, 620);

    new MutationObserver(() => sync(instance, 620)).observe(host, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    new ResizeObserver(() => {
      if (resize(instance) && !shouldRun(instance)) draw(instance, 620);
    }).observe(host);
    return instance;
  }

  function start() {
    const observed = [...document.querySelectorAll(selector)].map(init);
    const visibility = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const instance = observed.find((item) => item.host === entry.target);
        instance.visible = entry.isIntersecting;
        sync(instance, 620);
      });
    });
    observed.forEach((instance) => visibility.observe(instance.host));

    const refresh = () => {
      instances.forEach((instance) => sync(instance, 620));
    };
    new MutationObserver(refresh).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    darkScheme.addEventListener("change", refresh);
    reducedMotion.addEventListener("change", refresh);
    window.addEventListener("resize", refresh);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
}());
