import { CONFIG, RULES, configured, isAddr } from "./config.js";
import { buildPrompts, normalizeHandle, parseRef } from "./prompts.js";
import { readState, resolveAgent, agentMintData, treesOf, treeMeta, inviteInfo } from "./chain.js";
import { LANG, L, tt, setTT, applyAttrs, wireLang } from "./i18n.js";
import { starfield, rootSpine, tick, spotlight, groupSpotlight, dock, revealOnScroll, copyText, toast, reduced } from "./effects.js";

const $ = (s, r = document) => r.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") e.className = v; else if (k === "text") e.textContent = v;
    else if (k === "tt") e.append(tt(v[0], v[1])); // bilingual text: [en, zh]
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
};
const PARAMS = new URLSearchParams(location.search);
const validTree = (v) => /^\d{1,4}$/.test(String(v || "")) && +v >= 1 && +v <= RULES.maxSupply;
/* Invite ref: ?ref= (or legacy ?invite=) takes a tree number, a .ai name or a wallet. The contract binds
   invites to the inviter's tree id, so names/wallets are resolved read-only to one of their trees with a
   free slot (only once the NFT contract is live). Kept in sessionStorage so it survives page navigation. */
const REF_KEY = "rl-ref";
const ss = { get: () => { try { return sessionStorage.getItem(REF_KEY); } catch { return null; } }, set: (v) => { try { v ? sessionStorage.setItem(REF_KEY, v) : sessionStorage.removeItem(REF_KEY); } catch {} } };
const RAW_REF = PARAMS.get("ref") ?? PARAMS.get("invite");
let REF = RAW_REF !== null ? parseRef(RAW_REF, RULES.maxSupply) : null;
const REF_BAD = RAW_REF !== null && RAW_REF.trim() !== "" && !REF;
if (REF) ss.set(REF.kind === "tree" ? REF.id : (REF.handle ? `${REF.handle}.ai` : REF.address));
else if (RAW_REF === null) REF = parseRef(ss.get(), RULES.maxSupply);
let INVITE = REF && REF.kind === "tree" ? REF.id : null;
/** Add ?ref=N (and optional extra params) to a relative page link, keeping its #hash. */
function pageHref(href, extra = {}) {
  if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//") || href.startsWith("#") || !/\.html(\?|#|$)/.test(href)) return href;
  const [pathq, hash = ""] = href.split("#");
  const [path, q = ""] = pathq.split("?");
  const sp = new URLSearchParams(q);
  if (INVITE && !sp.has("ref")) { sp.delete("invite"); sp.set("ref", INVITE); }
  for (const [k, v] of Object.entries(extra)) sp.set(k, v);
  const qs = sp.toString();
  return path + (qs ? `?${qs}` : "") + (hash ? `#${hash}` : "");
}
const inviteUrl = (id) => `${CONFIG.siteUrl}mint.html?ref=${id}`;
const shareUrl = (id) => `https://twitter.com/intent/tweet?text=${encodeURIComponent(L(
  `My Rootlinks tree #${id} grows a root for every agent it invites. Mint yours with a Binance AI agent (.ai Agent ID needed).`,
  `我的 Rootlinks 树 #${id} 每邀请一个 Agent 就长出一条根。用 Binance AI Agent 铸造你的树（需要 .ai Agent ID）。`))}&url=${encodeURIComponent(inviteUrl(id))}`;
function preserveInvite() {
  if (!INVITE) return;
  document.querySelectorAll("a[href]").forEach((a) => { const h0 = a.getAttribute("href"); const h1 = pageHref(h0); if (h1 !== h0) a.setAttribute("href", h1); });
}
const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
const fmtBig = (wei, dp = 0) => (Number(wei) / 1e18).toLocaleString("en-US", { maximumFractionDigits: dp, minimumFractionDigits: dp });

/* ------------------------------------------------------------ static renders */
const RZH = { Common: "普通", Uncommon: "罕见", Rare: "稀有", Legendary: "传说", "World Tree": "世界之树", Unrevealed: "未开图" };
const rz = (n) => RZH[n] || n;
const SAMPLES = [
  [977, "Common", 3], [2619, "Uncommon", 3], [4118, "Common", 5], [4194, "Common", 3], [5303, "Rare", 3], [7047, "Uncommon", 5],
  [842, "Legendary", 2], [7244, "Common", 5], [1831, "Uncommon", 4], [7332, "Common", 4], [4925, "Uncommon", 4], [5093, "Legendary", 1],
  [3447, "Common", 2], [4023, "Rare", 3], [4489, "Common", 2], [4561, "Common", 2], [4692, "Uncommon", 5], [5986, "Common", 4],
  [6154, "Rare", 1], [6294, "Common", 4], [6335, "Uncommon", 2], [6363, "Common", 5], [6419, "Common", 5], [6902, "Rare", 5],
];

function renderMarquee() {
  const track = $("#marquee-track");
  if (!track) return;
  const make = ([id, rarity, stage], dup) => h("figure", { class: "mq-item", "aria-hidden": dup ? "true" : null },
    h("img", { src: `assets/samples/${id}.webp`, width: 150, height: 150, loading: "lazy", decoding: "async", alt: dup ? "" : `Sample tree, ${rarity}, stage ${stage}`, "data-zh-alt": dup ? null : `示例树，${rz(rarity)}，第 ${stage} 阶段` }),
    h("figcaption", {}, h("b", { tt: [rarity, rz(rarity)] }), h("span", { tt: [`stage ${stage}`, `第 ${stage} 阶段`] })));
  track.append(...SAMPLES.map((s) => make(s, false)), ...SAMPLES.map((s) => make(s, true)));
}

function renderRarity() {
  const grid = $("#rarity-grid");
  if (!grid) return;
  for (const r of RULES.rarity) {
    const pct = ((r.count / RULES.maxSupply) * 100).toFixed(r.count < 100 ? 2 : 1);
    grid.append(h("article", { class: "rcard", "data-k": r.key },
      h("img", { src: `assets/rarity-${r.key}.webp`, width: 400, height: 400, loading: "lazy", decoding: "async", alt: `${r.name} tree example`, "data-zh-alt": `${rz(r.name)}树示例` }),
      h("div", { class: "rc-body" },
        h("h3", { tt: [r.name, rz(r.name)] }),
        h("div", { class: "rc-meta" }, h("span", {}, h("b", { text: r.count.toLocaleString("en-US") }), ` · ${pct}%`), h("span", {}, tt("rewards ", "奖励 "), h("b", { text: r.boost }))))));
  }
  spotlight(".rcard", { tilt: 9 });
  groupSpotlight(grid);
}

function renderStages() {
  const list = $("#stages-list");
  if (!list) return;
  const txt = [["Seedling. Every tree starts here.", "幼苗。每棵树都从这里开始。"], ["1 invite: first glowing root.", "1 次邀请：第一条发光的根。"], ["2 invites: second glowing root.", "2 次邀请：第二条发光的根。"],
    ["Reserved for a later module (art only).", "留给后续模块（只影响图片）。"], ["Reserved for a later module (art only).", "留给后续模块（只影响图片）。"]];
  txt.forEach((t, i) => list.append(h("li", { class: i >= 3 ? "later" : null },
    h("img", { src: `assets/stage-${i + 1}.webp`, width: 400, height: 400, loading: "lazy", decoding: "async", alt: `Growth stage ${i + 1}`, "data-zh-alt": `成长阶段 ${i + 1}` }),
    h("p", {}, h("b", { tt: [`Stage ${i + 1}`, `第 ${i + 1} 阶段`] }), tt(t[0], t[1])))));
}

function renderContracts() {
  const box = $("#contracts-list");
  if (!box) return;
  const rows = [
    [["Rootlinks NFT", "Rootlinks NFT"], CONFIG.nft, true],
    [["Distributor (token launcher)", "Distributor（代币发行合约）"], CONFIG.distributor, true],
    [["Rootlinks token", "Rootlinks 代币"], CONFIG.token, true],
    [["SPACE ID Agent ID registry", "SPACE ID Agent ID 注册表"], CONFIG.agentIdRegistry, false],
  ];
  for (const [name, addr, ours] of rows) {
    const ok = isAddr(addr);
    box.append(h("div", { class: "ct" },
      h("h3", { tt: name }),
      ok ? h("div", { class: "addr", text: addr }) : h("div", { class: "addr pending", tt: ["Published here on launch day", "开铸当天在这里公布"] }),
      h("div", { class: "links" },
        ok ? h("a", { href: `${CONFIG.explorer}/address/${addr}#code`, target: "_blank", rel: "noopener", text: "BscScan" }) : null,
        ok && ours ? h("a", { href: `${CONFIG.sourcify}/${addr}/`, target: "_blank", rel: "noopener", text: "Sourcify" }) : null,
        ok ? h("button", { class: "copy", type: "button", "data-copy": addr }, h("span", { class: "copy-label", "data-en": "Copy", "data-zh": "复制", text: L("Copy", "复制") })) : null)));
  }
  if (CONFIG.sourceRepo) box.append(h("p", { class: "fine" }, tt("Source: ", "源码："), h("a", { href: CONFIG.sourceRepo, target: "_blank", rel: "noopener", text: CONFIG.sourceRepo })));
  box.addEventListener("click", (e) => { const b = e.target.closest("[data-copy]"); if (b) copyText(b.dataset.copy, b); });
}

/* ------------------------------------------------------------ prompts */
const state = { tab: "free", resolved: null };
const F = {
  handle: $("#f-handle"), wallet: $("#f-wallet"), qty: $("#f-qty"), inviter: $("#f-inviter"),
  ids: $("#f-ids"), tid: $("#f-tid"), to: $("#f-to"),
};

const val = (el) => (el ? el.value.trim() : "");
function inputs() {
  return {
    handle: val(F.handle), wallet: val(F.wallet), qty: F.qty ? F.qty.value : "1", inviter: F.inviter ? val(F.inviter) : "",
    tokenIds: val(F.ids), recipient: val(F.to), transferId: val(F.tid),
  };
}

function renderPromptBody(text) {
  const pre = $("#term-body");
  pre.replaceChildren();
  for (const line of text.split("\n")) {
    let cls = null;
    if (/^STOP:/.test(line)) cls = "hl-stop";
    else if (/^\s+baw /.test(line)) cls = "hl-cmd";
    const span = h("span", { class: cls });
    const m = /^(\d+\.)( .*)$/.exec(line);
    if (m && !cls) { span.append(h("span", { class: "hl-k", text: m[1] }), m[2]); } else span.textContent = line;
    pre.append(span, "\n");
  }
}

function renderPrompts() {
  const tabs = $("#prompt-tabs");
  const only = (tabs.dataset.prompts || "").split(",").map((x) => x.trim()).filter(Boolean);
  const ps = buildPrompts(inputs(), CONFIG, LANG).filter((p) => !only.length || only.includes(p.id));
  if (!tabs.childElementCount) {
    ps.forEach((p) => {
      const b = h("button", { class: "tab", role: "tab", type: "button", id: `tab-${p.id}`, "aria-controls": "term", "data-id": p.id, text: p.title.replace(/ ×\d+$/, "") });
      tabs.append(b);
    });
    tabs.addEventListener("click", (e) => { const b = e.target.closest(".tab"); if (!b) return; state.tab = b.dataset.id; renderPrompts(); });
    tabs.addEventListener("keydown", (e) => {
      if (!["ArrowRight", "ArrowLeft"].includes(e.key)) return;
      const all = [...tabs.children]; const i = all.findIndex((x) => x.dataset.id === state.tab);
      const n = all[(i + (e.key === "ArrowRight" ? 1 : all.length - 1)) % all.length];
      state.tab = n.dataset.id; renderPrompts(); n.focus();
    });
  }
  [...tabs.children].forEach((b) => { const p0 = ps.find((x) => x.id === b.dataset.id); if (p0) b.textContent = p0.title.replace(/ ×\d+$/, ""); const on = b.dataset.id === state.tab; b.setAttribute("aria-selected", on); b.tabIndex = on ? 0 : -1; });
  const p = ps.find((x) => x.id === state.tab) || ps[0];
  state.tab = p.id;
  $("#term-title").textContent = p.title;
  $("#term-sum").textContent = p.summary;
  renderPromptBody(p.text);
  state.text = p.text;
}

let resolveTimer;
async function onHandle() {
  const hint = $("#f-wallet-hint");
  const raw = F.handle.value.trim();
  const n = normalizeHandle(raw);
  F.handle.setAttribute("aria-invalid", raw && !n ? "true" : "false");
  if (!n) { raw ? setTT(hint, "use letters and digits, e.g. name.ai", "请使用字母和数字，例如 name.ai") : setTT(hint, "filled from the registry", "从注册表自动填入"); renderPrompts(); return; }
  setTT(hint, "checking registry…", "正在查询注册表…");
  try {
    const r = await resolveAgent(n);
    if (normalizeHandle(F.handle.value) !== n) return;
    if (r.missing) { setTT(hint, `${n}.ai is not registered`, `${n}.ai 尚未注册`); }
    else {
      setTT(hint, `owned by ${short(r.owner)}`, `持有者 ${short(r.owner)}`);
      if (!F.wallet.value || F.wallet.dataset.auto === "1") { F.wallet.value = r.owner; F.wallet.dataset.auto = "1"; }
    }
  } catch { setTT(hint, "registry unreachable; fill the wallet yourself", "无法连接注册表，请自行填写钱包"); }
  renderPrompts();
}

function inviteBanner() {
  if (!INVITE) return;
  const onMint = !!F.inviter;
  const p = onMint
    ? h("p", {}, tt(`You were invited by tree #${INVITE}. The invite prompts below already name it.`, `你收到了树 #${INVITE} 的邀请。下方的邀请提示词已经填好了它。`))
    : h("p", {}, tt(`You were invited by tree #${INVITE}. `, `你收到了树 #${INVITE} 的邀请。`), h("a", { href: pageHref("mint.html#mint"), tt: ["Open the mint prompts", "打开铸造提示词"] }), tt(" and the invite is already filled in.", "，邀请人已自动填好。"));
  const old = $(".invite-banner"); old && old.remove();
  $("#top").after(h("div", { class: "invite-banner" }, p));
}
function refChip() {
  const tabs = $("#prompt-tabs");
  if (!tabs) return;
  const old = $("#ref-chip"); old && old.remove();
  let el = null;
  if (INVITE) {
    const x = h("button", { type: "button", class: "ref-x", "aria-label": "Remove invite", "data-zh-aria-label": "移除邀请" }, "×");
    x.addEventListener("click", () => { INVITE = null; REF = null; ss.set(""); if (F.inviter) F.inviter.value = ""; const b = $(".invite-banner"); b && b.remove(); refChip(); renderPrompts(); });
    el = h("p", { class: "ref-chip", id: "ref-chip" }, tt(`Invited by tree #${INVITE}`, `邀请人：树 #${INVITE}`), x);
  } else if (REF_BAD) {
    el = h("p", { class: "fine ref-note", id: "ref-chip", tt: ["That invite link looks broken, so it was skipped. You can still mint normally.", "这个邀请链接似乎有误，已忽略。你仍然可以正常铸造。"] });
  } else if (REF) {
    const who = REF.kind === "name" ? `${REF.handle}.ai` : short(REF.address);
    el = h("p", { class: "fine ref-note", id: "ref-chip", tt: configured("nft")
      ? [`Finding a tree held by ${who}…`, `正在查找 ${who} 持有的树…`]
      : [`Invited by ${who}. Invites use a tree number, so ask them for their tree # once the mint opens.`, `邀请人：${who}。邀请需要树编号，铸造开启后请向对方要树的编号。`] });
  }
  if (el) tabs.before(el);
}
/** .ai name or wallet ref -> first tree it holds with an invite slot left (read-only). */
async function resolveRef() {
  if (!REF || REF.kind === "tree" || !configured("nft")) return;
  try {
    const r = await resolveAgent(REF.kind === "name" ? REF.handle : REF.address);
    const ids = r && !r.missing ? await treesOf(r.owner) : [];
    for (const id of ids.slice(0, 40)) {
      const info = await inviteInfo(id);
      if (info && info.exists && info.invitesUsed !== null && info.invitesUsed < RULES.maxInvitesPerTree) {
        INVITE = String(id); ss.set(INVITE);
        if (F.inviter && !F.inviter.value) { F.inviter.value = INVITE; state.tab = "invite-free"; }
        inviteBanner(); refChip(); renderPrompts(); return;
      }
    }
  } catch {}
  const c = $("#ref-chip");
  c && setTT(c, "No tree with a free invite slot found for that link. You can still mint normally.", "没有找到该链接对应、仍有邀请名额的树。你仍然可以正常铸造。");
}

function wirePrompts() {
  if (!$("#prompt-tabs")) return;
  if (F.inviter && INVITE) { F.inviter.value = INVITE; state.tab = "invite-free"; }
  refChip();
  const agent = normalizeHandle(PARAMS.get("agent"));
  if (agent && F.handle) { F.handle.value = `${agent}.ai`; onHandle(); }
  if (F.ids && PARAMS.get("ids")) F.ids.value = PARAMS.get("ids").split(",").filter(validTree).slice(0, 20).join(", ");
  F.handle && F.handle.addEventListener("input", () => { clearTimeout(resolveTimer); resolveTimer = setTimeout(onHandle, 450); });
  F.wallet && F.wallet.addEventListener("input", () => { F.wallet.dataset.auto = "0"; F.wallet.setAttribute("aria-invalid", F.wallet.value && !isAddr(F.wallet.value.trim()) ? "true" : "false"); renderPrompts(); });
  F.to && F.to.addEventListener("input", () => { F.to.setAttribute("aria-invalid", F.to.value && !isAddr(F.to.value.trim()) ? "true" : "false"); renderPrompts(); });
  [F.qty, F.inviter, F.ids, F.tid].forEach((el) => el && el.addEventListener("input", renderPrompts));
  $("#copy-prompt").addEventListener("click", (e) => { copyText(state.text, e.currentTarget); toast(L("Prompt copied. Paste it into your agent.", "提示词已复制，粘贴给你的 Agent 即可。")); });
  renderPrompts();
  addEventListener("rl:lang", renderPrompts);
}

/* ------------------------------------------------------------ live counters */
let chainOffset = 0; // chain time - local time
let mintEnd = 0, mintStartV = 0;
function setStatus(kind, en, zh) { const s = $("#status"); s.dataset.state = kind; setTT($("#status-text"), en, zh); }
const cdLabel = (en, zh) => setTT($("#cd-label"), en, zh);
function setTier(name, val, cap) {
  const el = $(`.tier[data-tier="${name}"]`);
  if (!el) return;
  tick(el.querySelector(".ticker"), val);
  el.querySelector(".bar i").style.width = `${Math.min(100, (val / cap) * 100)}%`;
}
function countdownTick() {
  const el = $("#countdown");
  if (!el) return;
  if (!mintStartV) { el.textContent = `${RULES.mintHours}:00:00`; return; }
  const now = Date.now() / 1000 + chainOffset;
  let s = Math.max(0, Math.floor(mintEnd - now));
  const hh = Math.floor(s / 3600); s -= hh * 3600; const mm = Math.floor(s / 60); const ss = s - mm * 60;
  el.textContent = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

async function refreshLive() {
  if (!$("#status")) return;
  if (!configured("nft")) {
    setStatus("soon", "Mint opens soon", "铸造即将开启");
    cdLabel("Window length", "窗口时长");
    countdownTick();
    return;
  }
  try {
    const st = await readState();
    chainOffset = st.now - Date.now() / 1000;
    const n = st.nft;
    mintStartV = Number(n.mintStart || 0n); mintEnd = Number(n.mintEnd || 0n);
    const outcome = Number(n.outcome ?? 0);
    const totalMinted = Number(n.totalMinted || 0n), burned = Number(n.totalBurned || 0n);
    tick($("#t-total"), totalMinted - burned);
    setTier("free", Number(n.freeMinted || 0n), RULES.caps.free);
    setTier("invite", Number(n.inviteMinted || 0n), RULES.caps.invite);
    setTier("paid", Number(n.paidMinted || 0n), RULES.caps.paid);
    tick($("#raised"), Number(n.totalRaised || 0n) / 1e18, { decimals: 3 });
    const finalized = st.dist && st.dist.finalized;
    if (!mintStartV) { setStatus("soon", "Mint opens soon", "铸造即将开启"); cdLabel("Window length", "窗口时长"); }
    else if (outcome === 0 && st.now < mintEnd) { setStatus("live", "Minting live", "铸造进行中"); cdLabel("Closes in", "距离结束"); }
    else if (outcome === 0) { setStatus("soon", "Window ended · anyone can call close()", "窗口已结束 · 任何人都可调用 close()"); cdLabel("Closed", "已结束"); }
    else if (outcome === 1) {
      if (finalized) setStatus("live", "Sold out · token live", "已售罄 · 代币已上线");
      else setStatus("live", "Sold out · token launch next", "已售罄 · 即将发币");
      cdLabel("Closed", "已结束");
    }
    else { setStatus("failed", "Not sold out · refunds open", "未售罄 · 退款已开放"); cdLabel("Closed", "已结束"); }
    const tm = new Date().toLocaleTimeString();
    setTT($("#rpc-note"), `Read live from BSC via public RPC · ${tm}`, `通过公共 RPC 实时读取 BSC · ${tm}`);
    countdownTick();
    if (st.dist) renderBurn(st);
  } catch (e) {
    setTT($("#rpc-note"), "Public RPC is busy. Retrying shortly.", "公共 RPC 繁忙，稍后自动重试。");
  }
}

function renderBurn(st) {
  const d = st.dist;
  if (!d.finalized || !$("#burn-bar")) return;
  const burned = Number(d.scheduledBurned || 0n) / 1e18;
  const weeksDone = Number(d.burnWeeksDone || 0n);
  tick($("#burn-done"), Math.round(burned));
  $("#burn-bar").style.width = `${Math.min(100, (burned / RULES.burn.total) * 100)}%`;
  setTT($("#burn-weeks"), `Week ${weeksDone} / ${RULES.burn.weeks}`, `第 ${weeksDone} / ${RULES.burn.weeks} 周`);
  const due = d.scheduledBurnDue ? Number(d.scheduledBurnDue) / 1e18 : 0;
  const dueTxt = Math.round(due).toLocaleString("en-US");
  if (due > 0) setTT($("#burn-next"), `${dueTxt} tokens are due now. Anyone can call burnScheduled().`, `现在有 ${dueTxt} 枚代币到期待销毁。任何人都可以调用 burnScheduled()。`);
  else if (weeksDone >= RULES.burn.weeks) setTT($("#burn-next"), "All 52 weekly burns are done.", "52 周的销毁已全部完成。");
  else {
    const next = Number(d.launchTime) + (Number(d.burnWeeksDue || 0n) + 1) * 7 * 86400;
    const nd = new Date(next * 1000);
    setTT($("#burn-next"), `Next burn due ${nd.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}.`, `下次销毁时间：${nd.toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" })}。`);
  }
}

/* ------------------------------------------------------------ lookup */
function safeImage(src) {
  if (typeof src !== "string") return "assets/placeholder.webp";
  if (src.startsWith("https://") || /^data:image\/(png|webp|jpeg|gif|svg\+xml);/.test(src)) return src;
  if (src.startsWith("ipfs://")) return "https://ipfs.io/ipfs/" + src.slice(7).replace(/^ipfs\//, "");
  return "assets/placeholder.webp";
}
// label and value may be [en, zh] pairs
const both = (v) => (Array.isArray(v) ? { tt: v } : { text: v });
function stat(label, value, mono) { return h("div", { class: "lk-stat" }, h("span", both(label)), h(mono ? "div" : "b", { class: mono ? "mono" : null, ...both(value) })); }

async function lookup(q) {
  const out = $("#lookup-out");
  out.replaceChildren(h("p", { class: "lk-msg", tt: ["Reading the chain…", "正在读取链上数据…"] }));
  try {
    const r = await resolveAgent(q);
    if (r.missing) { out.replaceChildren(h("p", { class: "lk-msg err", tt: [`${r.handle}.ai is not a registered Agent ID.`, `${r.handle}.ai 不是已注册的 Agent ID。`] })); return; }
    const card = h("div", { class: "card" });
    const grid = h("div", { class: "lk-grid" });
    grid.append(stat("Agent ID", r.handle ? `${r.handle}.ai` : ["None on this wallet", "该钱包没有"]));
    grid.append(stat(["Wallet", "钱包"], r.owner, true));
    if (r.agentId !== null) grid.append(stat(["Agent ID number", "Agent ID 编号"], r.agentId.toString(), true));
    card.append(grid);
    out.replaceChildren(card);

    if (r.handle) card.append(h("p", { class: "lk-next" }, h("a", { class: "btn btn-small btn-ghost", href: pageHref("mint.html#mint", { agent: r.handle }), tt: [`Mint prompts for ${r.handle}.ai`, `${r.handle}.ai 的铸造提示词`] })));
    if (!configured("nft")) {
      card.append(h("p", { class: "fine", tt: r.handle ? ["This wallet can mint. Mint data and trees appear here once the Rootlinks contract is live.", "该钱包可以铸造。Rootlinks 合约上线后，铸造数据和持有的树会显示在这里。"] : ["Without an Agent ID this wallet cannot mint, but it can hold and buy trees.", "没有 Agent ID 的钱包不能铸造，但可以持有和购买树。"] }));
      card.append(treeCards([]));
      return;
    }
    if (r.agentId !== null && r.handle) {
      const m = await agentMintData(r.agentId);
      if (m) {
        const g2 = h("div", { class: "lk-grid", style: "margin-top:14px" });
        g2.append(stat(["Free mint", "免费铸造"], m.freeUsed ? ["Used", "已使用"] : ["Available", "可用"]));
        g2.append(stat(["Paid minted", "已付费铸造"], `${m.paidMinted} / ${m.paidQuota}`));
        g2.append(stat(["Paid remaining", "剩余付费额度"], String(m.paidRemaining)));
        g2.append(stat(["Invite bonus", "邀请奖励额度"], [`+${m.bonusPaid} of +${RULES.maxBonusPaid}`, `+${m.bonusPaid} / +${RULES.maxBonusPaid}`]));
        g2.append(stat(["Bound inviter", "已绑定邀请人"], m.inviterTokenId ? [`Tree #${m.inviterTokenId}`, `树 #${m.inviterTokenId}`] : ["None yet", "暂无"]));
        card.append(g2);
      }
    }
    const prog = h("div", { class: "progress" }, h("i"));
    const msg = h("p", { class: "fine", tt: ["Finding trees held by this wallet…", "正在查找该钱包持有的树…"] });
    card.append(msg, prog);
    const ids = await treesOf(r.owner, (k, f, w) => { prog.firstChild.style.width = `${Math.round(k * 100)}%`; setTT(msg, `Scanning trees… ${f} of ${w} found`, `正在扫描… 已找到 ${f} / ${w}`); });
    prog.remove();
    if (!ids.length) { setTT(msg, "This wallet holds no trees.", "该钱包没有持有树。"); return; }
    setTT(msg, `Holds ${ids.length} tree${ids.length > 1 ? "s" : ""}.`, `持有 ${ids.length} 棵树。`);
    const metas = await treeMeta(ids.slice(0, 20));
    card.append(treeCards(metas.slice(0, 20)));
    if (ids.length > 20) card.append(h("p", { class: "fine", tt: [`Showing 20 of ${ids.length}.`, `显示 ${ids.length} 棵中的 20 棵。`] }));
    if (F.ids && $("#prompt-tabs")) { F.ids.value || (F.ids.value = ids.slice(0, 20).join(", ")); renderPrompts(); }
    if (r.handle) card.append(h("p", { class: "lk-next" }, h("a", { class: "btn btn-small btn-ghost", href: pageHref("mint.html#mint", { agent: r.handle, ids: ids.slice(0, 20).join(",") }), tt: [`Refund / claim prompts for ${r.handle}.ai`, `${r.handle}.ai 的退款 / 领取提示词`] })));
  } catch (e) {
    const bad = e && e.message && e.message.startsWith("Enter");
    out.replaceChildren(h("p", { class: "lk-msg err", tt: bad ? [e.message, "请输入 .ai 名称（字母和数字）或 0x 开头的钱包地址。"] : ["Couldn’t reach a public BSC RPC. Try again in a moment.", "无法连接公共 BSC RPC，请稍后再试。"] }));
  }
}

/* ------------------------------------------------------------ "Your tree" card
   Rarity/stage/image come from tokenURI metadata (contract-agnostic). A tree that is still revealing
   (no Rarity, or "Unrevealed") is re-read every 5 s for up to 3 min. Inert until CONFIG.nft is set. */
const PLACEHOLDER = "assets/placeholder.webp";
const isRevealed = (r) => r && r !== "Unrevealed" && r !== "Pending";
const shareTreeUrl = (id, rarity) => {
  const url = inviteUrl(id);
  const rEn = isRevealed(rarity) ? rarity : "still revealing", rZh = isRevealed(rarity) ? rz(rarity) : "开图中";
  const text = L(`Planted Rootlinks tree #${id} (${rEn}) with my Binance AI agent 🌱\nInvite code: ${id}. Use it and my tree grows a root.\nNeeds a .ai Agent ID.`,
    `我用 Binance AI Agent 种下了 Rootlinks 树 #${id}（${rZh}）🌱\n邀请码：${id}。用它铸造，我的树会长出一条根。\n需要 .ai Agent ID。`);
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
};
/** Save the tree image as rootlinks-<id>.png: fetch -> blob -> canvas PNG -> <a download>; open in a tab if CORS blocks. */
async function downloadTree(src, id) {
  const name = `rootlinks-${id}.png`;
  try {
    const res = await fetch(src, { mode: "cors", referrerPolicy: "no-referrer" });
    if (!res.ok) throw new Error("http");
    let blob = await res.blob();
    if (blob.type !== "image/png") {
      const url = URL.createObjectURL(blob);
      const img = new Image(); img.src = url; await img.decode();
      const w = img.naturalWidth || 1024, hh = img.naturalHeight || 1024;
      const c = document.createElement("canvas"); c.width = w; c.height = hh; c.getContext("2d").drawImage(img, 0, 0, w, hh);
      URL.revokeObjectURL(url);
      blob = await new Promise((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("png"))), "image/png"));
    }
    const href = URL.createObjectURL(blob);
    const a = h("a", { href, download: name, style: "display:none" }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 4000);
    toast(L("Image saved.", "图片已保存。"));
  } catch {
    window.open(src, "_blank", "noopener");
    toast(L("Opened the image. Long-press or right-click to save.", "已打开图片，长按或右键保存。"));
  }
}
/** One tree card. meta = {id, image, attributes} from treeMeta, or null for the pre-launch preview. */
function treeCard(meta) {
  const live = !!meta && configured("nft");
  const id = live ? String(meta.id) : null;
  const card = h("article", { class: "tree-card" });
  const render = (m) => {
    const attrs = Object.fromEntries(((m && m.attributes) || []).map((a) => [a.trait_type, a.value]));
    const rarity = attrs.Rarity;
    const revealed = live && isRevealed(rarity);
    const src = live && m.image ? safeImage(m.image) : PLACEHOLDER;
    const img = h("img", { src, alt: id ? `Rootlinks #${id}` : "Seed placeholder", width: 260, height: 260, loading: "lazy", referrerpolicy: "no-referrer" });
    img.addEventListener("error", () => { if (!img.src.endsWith(PLACEHOLDER)) img.src = PLACEHOLDER; }, { once: true });
    const code = id || L("<tree #>", "<树编号>");
    const link = id ? inviteUrl(id) : `${CONFIG.siteUrl}mint.html?ref=<tree #>`;
    const btn = (en, zh, on, extra = {}) => { const b = h("button", { class: "btn btn-small" + (extra.ghost ? " btn-ghost" : ""), type: "button", disabled: id ? null : "disabled", "aria-disabled": id ? null : "true", tt: [en, zh] }); id && b.addEventListener("click", on); return b; };
    const slots = h("span", { class: "fine", style: "margin:0", tt: id ? ["Checking invite slots…", "正在检查邀请名额…"] : [`${RULES.maxInvitesPerTree} invite slots per tree. Mint opens soon.`, `每棵树 ${RULES.maxInvitesPerTree} 个邀请名额。铸造即将开启。`] });
    if (id) inviteInfo(id).then((info) => {
      if (!info || info.invitesUsed === null) { slots.textContent = ""; return; }
      const left = Math.max(0, RULES.maxInvitesPerTree - info.invitesUsed);
      setTT(slots, left ? `${left} of ${RULES.maxInvitesPerTree} invite slots left` : "Both invite slots used", left ? `剩余 ${left} / ${RULES.maxInvitesPerTree} 个邀请名额` : "2 个邀请名额已用完");
    }).catch(() => { slots.textContent = ""; });
    const x = h("a", { class: "btn btn-small btn-ghost", target: "_blank", rel: "noopener", href: id ? shareTreeUrl(id, rarity) : null, "aria-disabled": id ? null : "true", tt: ["Share on X", "分享到 X"] });
    card.replaceChildren(
      h("div", { class: "tc-img" }, img),
      h("div", { class: "tc-body" },
        h("h3", { class: "card-h", tt: ["Your tree", "你的树"] }),
        h("div", { class: "lk-grid" },
          stat(["Token ID", "树编号"], id ? `#${id}` : "—"),
          stat(["Rarity", "稀有度"], revealed ? [rarity, rz(rarity)] : live ? ["Revealing…", "开图中…"] : ["Reveals ~10 s after mint", "铸造后约 10 秒开图"]),
          stat(["Stage", "阶段"], live && attrs.Stage !== undefined ? String(attrs.Stage) : "1")),
        h("p", { class: "tc-label", tt: ["Your invite code", "你的邀请码"] }),
        h("div", { class: "row" }, h("code", { class: "mono tc-code", text: code }), btn("Copy code", "复制邀请码", (e) => { copyText(id, e.currentTarget); toast(L("Invite code copied.", "邀请码已复制。")); })),
        h("p", { class: "tc-label", tt: ["Your invite link", "你的邀请链接"] }),
        h("code", { class: "mono tc-link", text: link }),
        h("div", { class: "row" },
          btn("Copy link", "复制链接", (e) => { copyText(link, e.currentTarget); toast(L("Invite link copied.", "邀请链接已复制。")); }),
          x,
          btn("Download PNG", "下载 PNG", () => downloadTree(src, id), { ghost: true })),
        slots,
        live && !revealed ? h("p", { class: "fine", tt: ["Rarity appears about 10 seconds after the mint. The next mint reveals it, or anyone can call revealPending(). This card refreshes on its own.", "稀有度在铸造约 10 秒后出现。下一次铸造会自动开图，任何人也可以调用 revealPending()。此卡片会自动刷新。"] }) : null));
    return revealed;
  };
  const done = render(meta);
  if (live && !done) {
    let n = 0;
    const timer = setInterval(async () => {
      if (++n > 36 || !card.isConnected) return clearInterval(timer);
      try { const [m] = await treeMeta([meta.id]); if (m && render(m)) clearInterval(timer); } catch {}
    }, 5000);
  }
  return card;
}
function treeCards(metas) {
  const box = h("div", { class: "tree-cards" });
  if (!configured("nft") || !metas.length) box.append(treeCard(null), h("p", { class: "fine", tt: ["Preview. Once you hold a tree, its card appears here with your invite code, ready to copy and share.", "预览。持有树之后，这里会显示你的树卡片和邀请码，可直接复制和分享。"] }));
  else metas.forEach((m) => box.append(treeCard(m)));
  return box;
}
/** mint.html / lookup.html: "Just minted?" box and ?tree=N. */
function wireYourTree() {
  const form = $("#yt-form"), out = $("#yt-out");
  if (!out) return;
  const show = async (v) => {
    if (validTree(v) && configured("nft")) {
      out.replaceChildren(h("p", { class: "lk-msg", tt: ["Reading the chain…", "正在读取链上数据…"] }));
      try { const [m] = await treeMeta([+v]); const info = await inviteInfo(+v); out.replaceChildren(info && info.exists ? treeCards([m]) : h("p", { class: "lk-msg err", tt: [`Tree #${+v} doesn’t exist yet.`, `树 #${+v} 还不存在。`] })); }
      catch { out.replaceChildren(h("p", { class: "lk-msg err", tt: ["Couldn’t reach a public BSC RPC. Try again in a moment.", "无法连接公共 BSC RPC，请稍后再试。"] })); }
    } else if (v && !validTree(v) && form && form.dataset.lookup) location.href = pageHref(`lookup.html?q=${encodeURIComponent(v)}`);
    else out.replaceChildren(treeCards([]));
  };
  form && form.addEventListener("submit", (e) => { e.preventDefault(); show($("#yt-q").value.trim().replace(/^#/, "")); });
  const t0 = PARAMS.get("tree");
  if (t0 && validTree(t0)) { $("#yt-q") && ($("#yt-q").value = t0); show(t0); } else out.replaceChildren(treeCards([]));
}

function wireLookup() {
  const form = $("#lookup-form");
  if (!form) return;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("#lookup-q").value.trim();
    if (!q) return;
    lookup(q);
  });
  const q0 = PARAMS.get("q");
  if (q0) { $("#lookup-q").value = q0.slice(0, 64); lookup(q0.slice(0, 64)); }
}

/* ------------------------------------------------------------ invite */
function wireInvite() {
  const input = $("#inv-id");
  if (!input) return;
  const box = $("#invite-link");
  let t;
  input.addEventListener("input", () => {
    const v = input.value.trim();
    const ok = /^\d{1,4}$/.test(v) && +v >= 1 && +v <= RULES.maxSupply;
    input.setAttribute("aria-invalid", v && !ok ? "true" : "false");
    box.hidden = !ok;
    if (!ok) return;
    const url = inviteUrl(+v);
    $("#invite-url").textContent = url;
    $("#invite-x").href = shareUrl(+v);
    const st = $("#invite-status");
    configured("nft") ? setTT(st, "Checking tree…", "正在检查树…") : setTT(st, "Invites work once the mint is live.", "铸造开启后邀请才会生效。");
    clearTimeout(t);
    if (configured("nft")) t = setTimeout(async () => {
      try {
        const info = await inviteInfo(+v);
        if (!info || !info.exists) setTT(st, `Tree #${+v} doesn’t exist yet.`, `树 #${+v} 还不存在。`);
        else { const left = RULES.maxInvitesPerTree - info.invitesUsed; left > 0 ? setTT(st, `${left} invite${left > 1 ? "s" : ""} left on tree #${+v}.`, `树 #${+v} 还剩 ${left} 次邀请。`) : setTT(st, `Tree #${+v} has used both invites.`, `树 #${+v} 的 2 次邀请已用完。`); }
      } catch { st.textContent = ""; }
    }, 400);
  });
  $("#invite-copy").addEventListener("click", (e) => { copyText($("#invite-url").textContent, e.currentTarget); toast(L("Invite link copied.", "邀请链接已复制。")); });
  addEventListener("rl:lang", () => { if (input.value) input.dispatchEvent(new Event("input")); });
}

/* ------------------------------------------------------------ boot */
wireLang();
preserveInvite();
inviteBanner();
renderMarquee();
renderRarity();
renderStages();
renderContracts();
wirePrompts();
resolveRef();
wireLookup();
wireYourTree();
wireInvite();
$("#sky") && starfield($("#sky"));
dock($("#dock"));
spotlight(".b.spot");
revealOnScroll(".sec-head .h2, .sec-head .sec-lede, .mint-card, .mint-grid, .lookup-form, .invite-grid, .steps li, .timeline li, .rarity-grid, .stages li, .bento .b, .ct, .faq details, .warn, .refund, .rule, .agent-link, .more-link");
if ($("#spine") && $("#soil")) { const spine = rootSpine($("#spine"), $("#soil")); addEventListener("load", () => spine.rebuild()); }
applyAttrs();
refreshLive();
if ($("#countdown")) setInterval(countdownTick, 1000);
if (configured("nft") && $("#status")) setInterval(() => document.visibilityState === "visible" && refreshLive(), 20000);
if (reduced) document.documentElement.classList.add("reduced");
