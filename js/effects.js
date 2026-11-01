// Visual effects, re-implemented in vanilla JS/CSS. See CREDITS.md for the references.
export const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;

/* ---------- 1. Starfield sky (inspired by React Bits "Galaxy"/Magic UI "Particles") ---------- */
export function starfield(canvas) {
  const ctx = canvas.getContext("2d");
  let w = 0, h = 0, stars = [], raf = 0, visible = true, shoot = null, last = 0;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  function resize() {
    const r = canvas.getBoundingClientRect();
    w = r.width; h = r.height;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.min(420, Math.round((w * h) / 2600));
    stars = Array.from({ length: n }, () => {
      const y = Math.pow(Math.random(), 1.4) * h * 0.92; // denser toward the top
      return { x: Math.random() * w, y, r: Math.random() < 0.08 ? 1.3 + Math.random() * 0.9 : 0.35 + Math.random() * 0.8, p: Math.random() * Math.PI * 2, s: 0.4 + Math.random() * 1.6, gold: Math.random() < 0.18 };
    });
    draw(0);
  }
  function draw(t) {
    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      const a = reduced ? 0.75 : 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(s.p + t * 0.001 * s.s));
      ctx.globalAlpha = a * (1 - s.y / h * 0.55);
      ctx.fillStyle = s.gold ? "#ffe5a6" : "#e4f6ff";
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
      if (s.r > 1.3) { ctx.globalAlpha *= 0.25; ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 3.2, 0, Math.PI * 2); ctx.fill(); }
    }
    if (shoot) {
      const k = (t - shoot.t0) / shoot.d;
      if (k >= 1) shoot = null;
      else {
        const x = shoot.x + shoot.dx * k, y = shoot.y + shoot.dy * k;
        const g = ctx.createLinearGradient(x, y, x - shoot.dx * 0.18, y - shoot.dy * 0.18);
        g.addColorStop(0, "rgba(180,255,241,.9)"); g.addColorStop(1, "rgba(180,255,241,0)");
        ctx.globalAlpha = Math.sin(k * Math.PI); ctx.strokeStyle = g; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - shoot.dx * 0.18, y - shoot.dy * 0.18); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
  function loop(t) {
    if (!visible) { raf = 0; return; }
    if (t - last > 33) { // ~30fps is plenty for twinkles
      if (!shoot && Math.random() < 0.004) shoot = { x: Math.random() * w * 0.8, y: Math.random() * h * 0.35, dx: 260 + Math.random() * 200, dy: 90 + Math.random() * 80, t0: t, d: 900 };
      draw(t); last = t;
    }
    raf = requestAnimationFrame(loop);
  }
  resize();
  let rt; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(resize, 150); });
  if (!reduced) {
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible && !raf) raf = requestAnimationFrame(loop); }).observe(canvas);
  }
}

/* ---------- 2. Glowing root spine (Magic UI "Animated Beam" + 21st.dev "Background Paths") ---------- */
export function rootSpine(svg, container) {
  const NS = "http://www.w3.org/2000/svg";
  const nodes = [...container.querySelectorAll(".sec .node")];
  let glow, total = 0, points = [], branches = [];
  function el(tag, attrs) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }
  function build() {
    const box = container.getBoundingClientRect();
    const H = container.scrollHeight;
    svg.setAttribute("viewBox", `0 0 ${box.width} ${H}`);
    svg.style.height = H + "px";
    svg.replaceChildren();
    const defs = el("defs", {});
    const lg = el("linearGradient", { id: "rootGrad", x1: "0", y1: "0", x2: "0", y2: "1", gradientUnits: "objectBoundingBox" });
    [["0", "#ffe5a6"], ["0.45", "#f3c45a"], ["0.75", "#43e2c6"], ["1", "#b4fff1"]].forEach(([o, c]) => lg.appendChild(el("stop", { offset: o, "stop-color": c })));
    const f = el("filter", { id: "rootBlur", x: "-50%", y: "-5%", width: "200%", height: "110%" });
    f.appendChild(el("feGaussianBlur", { stdDeviation: "2.2", result: "b" }));
    const m = el("feMerge", {}); m.appendChild(el("feMergeNode", { in: "b" })); m.appendChild(el("feMergeNode", { in: "SourceGraphic" })); f.appendChild(m);
    defs.append(lg, f); svg.appendChild(defs);

    points = nodes.map((n) => { const r = n.getBoundingClientRect(); return { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2, sec: n.closest(".sec") }; });
    if (!points.length) return;
    const x0 = points[0].x;
    let d = `M ${x0} 0`;
    let prev = { x: x0, y: 0 };
    let i = 0;
    for (const p of points) {
      const wob = (i++ % 2 ? 1 : -1) * Math.min(14, box.width * 0.02);
      const my = (prev.y + p.y) / 2;
      d += ` C ${prev.x + wob} ${prev.y + (my - prev.y) * 0.9}, ${p.x - wob} ${my + (p.y - my) * 0.2}, ${p.x} ${p.y}`;
      prev = p;
    }
    d += ` C ${prev.x + 10} ${prev.y + 120}, ${prev.x - 6} ${H - 160}, ${prev.x + 4} ${H - 40}`;
    const base = el("path", { d, class: "root-base" });
    glow = el("path", { d, class: "root-glow" });
    svg.append(base);
    // tendrils: small side roots at each node, lit when reached
    branches = points.map((p, k) => {
      const dir = k % 2 ? 1 : -1;
      const len = 26 + (k % 3) * 10;
      const bd = `M ${p.x} ${p.y} q ${8 * dir + 10} ${len * 0.4}, ${18 + len * 0.6} ${len}`
        + ` M ${p.x} ${p.y + 2} q ${-6} ${len * 0.5}, ${-Math.min(p.x - 2, 10 + len * 0.3)} ${len * 0.9}`;
      const b = el("path", { d: bd, class: "root-branch" });
      svg.appendChild(b);
      return b;
    });
    svg.append(glow);
    if (!reduced) svg.append(el("path", { d, class: "root-pulse", pathLength: "1460" }));
    total = glow.getTotalLength();
    glow.style.strokeDasharray = `${total} ${total}`;
    update();
  }
  function update() {
    if (!glow) return;
    const box = container.getBoundingClientRect();
    const front = innerHeight * 0.62 - box.top; // y (in container) the glow has reached
    const H = container.scrollHeight;
    const k = Math.max(0, Math.min(1, front / H));
    glow.style.strokeDashoffset = reduced ? 0 : total * (1 - k);
    points.forEach((p, idx) => {
      const lit = reduced || p.y < front;
      p.sec.classList.toggle("lit", lit);
      branches[idx] && branches[idx].classList.toggle("lit", lit);
    });
  }
  build();
  let rt; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(build, 200); });
  addEventListener("scroll", () => requestAnimationFrame(update), { passive: true });
  if ("ResizeObserver" in window) new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(build, 200); }).observe(container);
  return { rebuild: build };
}

/* ---------- 3. Number ticker (Magic UI "Number Ticker") ---------- */
export function tick(el, to, { decimals = 0, duration = 1300 } = {}) {
  const from = Number(el.dataset.value || 0);
  el.dataset.value = String(to);
  const fmt = (v) => v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  if (reduced || from === to) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  const ease = (x) => (x === 1 ? 1 : 1 - Math.pow(2, -10 * x));
  function step(t) {
    const k = Math.min(1, (t - t0) / duration);
    el.textContent = fmt(from + (to - from) * ease(k));
    if (k < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* ---------- 4. Spotlight + tilt cards (React Bits "Spotlight Card" + "Tilted Card", Magic UI "Magic Card") ---------- */
export function spotlight(selector, { tilt = 0 } = {}) {
  if (!finePointer) return;
  document.querySelectorAll(selector).forEach((card) => {
    card.addEventListener("pointermove", (e) => {
      const r = card.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      card.style.setProperty("--mx", `${x}px`);
      card.style.setProperty("--my", `${y}px`);
      if (tilt && !reduced) {
        card.style.setProperty("--rx", `${((y / r.height) - 0.5) * -tilt}deg`);
        card.style.setProperty("--ry", `${((x / r.width) - 0.5) * tilt}deg`);
      }
    });
    card.addEventListener("pointerleave", () => { card.style.setProperty("--rx", "0deg"); card.style.setProperty("--ry", "0deg"); });
  });
}
// cards in a group share the border light (React Bits spotlight reaching nearby cards)
export function groupSpotlight(group) {
  if (!finePointer) return;
  group.addEventListener("pointermove", (e) => {
    group.querySelectorAll(".rcard").forEach((c) => {
      const r = c.getBoundingClientRect();
      c.style.setProperty("--mx", `${e.clientX - r.left}px`);
      c.style.setProperty("--my", `${e.clientY - r.top}px`);
    });
  });
}

/* ---------- 5. Dock magnification (Magic UI "Dock") ---------- */
export function dock(nav) {
  const items = [...nav.querySelectorAll("a")];
  if (finePointer && !reduced && innerWidth >= 700) {
    nav.addEventListener("pointermove", (e) => {
      items.forEach((a) => {
        const r = a.getBoundingClientRect();
        const d = Math.abs(e.clientX - (r.left + r.width / 2));
        a.style.setProperty("--s", (1 + 0.55 * Math.max(0, 1 - d / 120)).toFixed(3));
      });
    });
    nav.addEventListener("pointerleave", () => items.forEach((a) => a.style.setProperty("--s", 1)));
  }
  const map = new Map(items.filter((a) => a.hash).map((a) => [a.hash.slice(1), a]));
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) { items.forEach((a) => a.classList.remove("on")); const a = map.get(en.target.id); a && a.classList.add("on"); }
    });
  }, { rootMargin: "-45% 0px -50% 0px" });
  map.forEach((_, id) => { const s = document.getElementById(id); s && io.observe(s); });
}

/* ---------- 6. Blur-fade reveal (Magic UI "Blur Fade") ---------- */
export function revealOnScroll(selector) {
  const els = document.querySelectorAll(selector);
  if (reduced || !("IntersectionObserver" in window)) return els.forEach((e) => e.classList.add("in"));
  els.forEach((e) => e.classList.add("reveal"));
  const io = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } }), { rootMargin: "0px 0px -8% 0px" });
  els.forEach((e) => io.observe(e));
}

/* ---------- 7. Copy with check morph (Uiverse copy buttons) ---------- */
export async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement("textarea"); ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch {} ta.remove();
  }
  if (btn) {
    btn.classList.add("done");
    const l = btn.querySelector(".copy-label");
    const zh = document.documentElement.lang === "zh-CN";
    if (l) l.textContent = zh ? "已复制" : "Copied";
    setTimeout(() => { btn.classList.remove("done"); if (l) l.textContent = zh ? (l.dataset.zh || "复制") : (l.dataset.en || "Copy"); }, 1600);
  }
}

export function toast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg; t.classList.add("show");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 2200);
}
