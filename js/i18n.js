// Client-side language switch (English / Simplified Chinese).
// Static copy is rendered twice by site_dev/build_pages.py as <span class="i-en">…</span><span class="i-zh">…</span>
// and CSS shows the one matching <html lang>. Attributes use data-zh-<attr>; plain text nodes use data-en/data-zh.
// The choice is stored in localStorage ("rl-lang"); with no stored choice, browsers whose language starts with
// "zh" get Chinese, everyone else English. A tiny inline script in <head> applies it before first paint.
const KEY = "rl-lang";
const ATTRS = ["placeholder", "aria-label", "alt", "title"];

function detect() {
  try { const s = localStorage.getItem(KEY); if (s === "en" || s === "zh") return s; } catch {}
  return /^zh/i.test((typeof navigator !== "undefined" && navigator.language) || "") ? "zh" : "en";
}

export let LANG = typeof document !== "undefined" && document.documentElement.lang === "zh-CN" ? "zh" : detect();

/** Pick the string for the current language. */
export const L = (en, zh) => (LANG === "zh" ? zh : en);

/** A fragment holding both languages; CSS shows the active one, so it never needs re-rendering. */
export function tt(en, zh) {
  const f = document.createDocumentFragment();
  const a = document.createElement("span"); a.className = "i-en"; a.textContent = en;
  const b = document.createElement("span"); b.className = "i-zh"; b.lang = "zh-CN"; b.textContent = zh;
  f.append(a, b);
  return f;
}
/** Replace an element's content with both languages. */
export function setTT(el, en, zh) { if (el) el.replaceChildren(tt(en, zh)); }

export function applyAttrs(root = document) {
  for (const attr of ATTRS) {
    root.querySelectorAll(`[data-zh-${attr}]`).forEach((el) => {
      const enKey = `data-en-${attr}`;
      if (!el.hasAttribute(enKey)) el.setAttribute(enKey, el.getAttribute(attr) || "");
      el.setAttribute(attr, LANG === "zh" ? el.getAttribute(`data-zh-${attr}`) : el.getAttribute(enKey));
    });
  }
  root.querySelectorAll("[data-zh][data-en]").forEach((el) => { el.textContent = LANG === "zh" ? el.dataset.zh : el.dataset.en; });
  const meta = (n) => document.querySelector(`meta[name="${n}"]`);
  const tz = meta("rl-title-zh"), dz = meta("rl-desc-zh"), d = meta("description");
  const html = document.documentElement;
  if (!html.dataset.titleEn) html.dataset.titleEn = document.title;
  if (d && !d.dataset.en) d.dataset.en = d.content;
  document.title = LANG === "zh" && tz ? tz.content : html.dataset.titleEn;
  if (d) d.content = LANG === "zh" && dz ? dz.content : d.dataset.en;
}

export function setLang(l, persist = true) {
  LANG = l === "zh" ? "zh" : "en";
  if (persist) { try { localStorage.setItem(KEY, LANG); } catch {} }
  document.documentElement.lang = LANG === "zh" ? "zh-CN" : "en";
  applyAttrs();
  document.querySelectorAll("[data-set-lang]").forEach((a) => a.setAttribute("aria-pressed", String(a.dataset.setLang === LANG)));
  dispatchEvent(new CustomEvent("rl:lang", { detail: LANG }));
}

export function wireLang() {
  document.addEventListener("click", (e) => {
    const t = e.target.closest("#lang-toggle, [data-set-lang]");
    if (!t) return;
    e.preventDefault();
    setLang(t.id === "lang-toggle" ? (LANG === "zh" ? "en" : "zh") : t.dataset.setLang);
  });
  setLang(LANG, false);
}
