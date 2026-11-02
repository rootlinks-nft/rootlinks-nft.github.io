// Read-only BSC access over public JSON-RPC. No wallet connection anywhere on this site.
import { Interface, getAddress, toUtf8String, id as keccakId } from "../vendor/ethers-lite.min.mjs";
import { CONFIG, configured, isAddr } from "./config.js";
import { NFT_ABI, DISTRIBUTOR_ABI, TOKEN_ABI, AGENT_REGISTRY_ABI, MULTICALL3_ABI } from "./abi.js";

export const I = {
  nft: new Interface(NFT_ABI),
  dist: new Interface(DISTRIBUTOR_ABI),
  token: new Interface(TOKEN_ABI),
  reg: new Interface(AGENT_REGISTRY_ABI),
  mc: new Interface(MULTICALL3_ABI),
};

let rpcIndex = 0;
let reqId = 1;

async function rpc(method, params, timeoutMs = 12000) {
  let lastErr;
  for (let attempt = 0; attempt < CONFIG.rpcs.length; attempt++) {
    const url = CONFIG.rpcs[(rpcIndex + attempt) % CONFIG.rpcs.length];
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: reqId++, method, params }),
        signal: ctl.signal,
      });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      if (j.error) {
        // execution reverts are real answers, not transport failures
        if (/revert/i.test(j.error.message || "") || j.error.code === 3) {
          const e = new Error(j.error.message || "reverted");
          e.revert = true;
          e.data = j.error.data;
          throw e;
        }
        throw new Error(j.error.message || "rpc error");
      }
      rpcIndex = (rpcIndex + attempt) % CONFIG.rpcs.length; // stick with the one that worked
      return j.result;
    } catch (e) {
      clearTimeout(t);
      if (e.revert) throw e;
      lastErr = e;
    }
  }
  throw lastErr || new Error("All RPCs failed");
}

export const ethCall = (to, data) => rpc("eth_call", [{ to, data }, "latest"]);
export const chainId = async () => Number(BigInt(await rpc("eth_chainId", [])));

/** Batch view calls through Multicall3.tryAggregate. calls: [{iface, to, fn, args}] -> decoded or null */
export async function multi(calls, chunk = 400) {
  const out = [];
  for (let i = 0; i < calls.length; i += chunk) {
    const part = calls.slice(i, i + chunk);
    const encoded = part.map((c) => ({ target: c.to, callData: c.iface.encodeFunctionData(c.fn, c.args || []) }));
    const data = I.mc.encodeFunctionData("tryAggregate", [false, encoded]);
    const raw = await ethCall(CONFIG.multicall3, data);
    const [results] = I.mc.decodeFunctionResult("tryAggregate", raw);
    results.forEach((r, k) => {
      const c = part[k];
      if (!r.success || r.returnData === "0x") return out.push(null);
      try {
        const d = c.iface.decodeFunctionResult(c.fn, r.returnData);
        out.push(d.length === 1 ? d[0] : d);
      } catch {
        out.push(null);
      }
    });
  }
  return out;
}

const NFT_STATE_FNS = ["freeMinted", "inviteMinted", "paidMinted", "totalMinted", "totalBurned", "mintStart", "mintEnd", "outcome", "totalRaised", "poolsLeft", "pendingCount"];
const DIST_STATE_FNS = ["finalized", "launchTime", "scheduledBurned", "burnWeeksDone", "burnWeeksDue", "scheduledBurnDue", "airdropClaimedTotal", "rewardsEmitted", "token"];

/** Mint + launch state. Returns null pieces for unconfigured contracts. */
export async function readState() {
  const calls = [{ iface: I.mc, to: CONFIG.multicall3, fn: "getCurrentBlockTimestamp" }];
  const nftOn = configured("nft");
  const distOn = configured("distributor");
  if (nftOn) NFT_STATE_FNS.forEach((fn) => calls.push({ iface: I.nft, to: CONFIG.nft, fn }));
  if (distOn) DIST_STATE_FNS.filter((fn) => I.dist.getFunction(fn)).forEach((fn) => calls.push({ iface: I.dist, to: CONFIG.distributor, fn }));
  const r = await multi(calls);
  let k = 0;
  const now = Number(r[k++] ?? BigInt(Math.floor(Date.now() / 1000)));
  const st = { now, nft: null, dist: null };
  if (nftOn) {
    st.nft = {};
    NFT_STATE_FNS.forEach((fn) => (st.nft[fn] = r[k++]));
  }
  if (distOn) {
    st.dist = {};
    DIST_STATE_FNS.filter((fn) => I.dist.getFunction(fn)).forEach((fn) => (st.dist[fn] = r[k++]));
  }
  const tokenAddr = configured("token") ? CONFIG.token : st.dist && isAddr(st.dist.token) ? st.dist.token : null;
  if (tokenAddr) {
    const [supply] = await multi([{ iface: I.token, to: tokenAddr, fn: "totalSupply" }]);
    st.tokenSupply = supply;
  }
  return st;
}

/** Resolve ".ai name" or 0x address to { handle, owner, agentId } using the SPACE ID registry. */
export async function resolveAgent(query) {
  const q = String(query || "").trim();
  const reg = CONFIG.agentIdRegistry;
  if (isAddr(q)) {
    const owner = getAddress(q);
    const [handle] = await multi([{ iface: I.reg, to: reg, fn: "handleOf", args: [owner] }]);
    const h = handle || "";
    return { owner, handle: h, agentId: h ? BigInt(keccakId(h)) : null };
  }
  let h = q.normalize("NFKC").replace(/[\u200B-\u200D\uFEFF]/g, "").toLowerCase();
  if (h.endsWith(".ai")) h = h.slice(0, -3);
  if (!/^[a-z0-9]+$/.test(h)) throw new Error("Enter a .ai name (letters and digits) or a 0x wallet address.");
  const [owner] = await multi([{ iface: I.reg, to: reg, fn: "ownerOfHandle", args: [h] }]);
  if (!owner || /^0x0{40}$/i.test(owner)) return { owner: null, handle: h, agentId: BigInt(keccakId(h)), missing: true };
  return { owner: getAddress(owner), handle: h, agentId: BigInt(keccakId(h)) };
}

/** Per-Agent-ID mint data from the NFT. */
export async function agentMintData(agentId) {
  if (!configured("nft")) return null;
  const [d, rem, quota] = await multi([
    { iface: I.nft, to: CONFIG.nft, fn: "agentData", args: [agentId] },
    { iface: I.nft, to: CONFIG.nft, fn: "paidRemainingOf", args: [agentId] },
    { iface: I.nft, to: CONFIG.nft, fn: "paidQuotaOf", args: [agentId] },
  ]);
  if (!d) return null;
  return { freeUsed: d.freeUsed, paidMinted: Number(d.paidMinted), bonusPaid: Number(d.bonusPaid), inviterTokenId: Number(d.inviterTokenId), paidRemaining: Number(rem), paidQuota: Number(quota) };
}

/**
 * Trees held by `owner`. The NFT is not enumerable, so instead of scanning Transfer logs (public
 * RPCs cap log ranges) we batch ownerOf(1..totalMinted) through Multicall3: ~14 calls for 5,555.
 */
export async function treesOf(owner, onProgress) {
  if (!configured("nft")) return [];
  const [bal, total] = await multi([
    { iface: I.nft, to: CONFIG.nft, fn: "balanceOf", args: [owner] },
    { iface: I.nft, to: CONFIG.nft, fn: "totalMinted" },
  ]);
  const want = Number(bal || 0n);
  const n = Number(total || 0n);
  const found = [];
  if (!want) return found;
  const lc = owner.toLowerCase();
  const step = 500;
  for (let start = 1; start <= n && found.length < want; start += step) {
    const calls = [];
    for (let t = start; t < start + step && t <= n; t++) calls.push({ iface: I.nft, to: CONFIG.nft, fn: "ownerOf", args: [t] });
    const r = await multi(calls, step);
    r.forEach((o, k) => o && o.toLowerCase() === lc && found.push(start + k));
    onProgress && onProgress(Math.min(1, (start + step - 1) / n), found.length, want);
  }
  return found;
}

/** Rarity enum order in the contract (rarityOf returns its index). */
export const RARITY_NAMES = ["Common", "Uncommon", "Rare", "Legendary", "World Tree"];

/**
 * tokenURI -> {name, image, attributes} (on-chain base64 JSON), plus rarityOf(id) -> (revealed, rarity):
 * revealed (bool) and rarity (name, only when revealed) come from the contract, not the metadata.
 */
export async function treeMeta(ids) {
  if (!configured("nft") || !ids.length) return [];
  const calls = [];
  ids.forEach((t) => calls.push({ iface: I.nft, to: CONFIG.nft, fn: "tokenURI", args: [t] }, { iface: I.nft, to: CONFIG.nft, fn: "rarityOf", args: [t] }, { iface: I.nft, to: CONFIG.nft, fn: "stageOf", args: [t] }));
  const r = await multi(calls);
  return ids.map((id, k) => {
    const u = r[3 * k], ro = r[3 * k + 1], sg = r[3 * k + 2];
    const out = { id, name: `Rootlinks #${id}`, image: "", attributes: [], revealed: false, rarity: null, stage: sg === null || sg === undefined ? null : Number(sg) };
    try {
      const b64 = u.split(",")[1];
      const json = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
      Object.assign(out, json);
    } catch {}
    if (ro) {
      out.revealed = !!ro[0];
      out.rarity = out.revealed ? RARITY_NAMES[Number(ro[1])] || null : null;
    }
    return out;
  });
}

/** Hosted art for a revealed tree (rendered by the repo's GitHub Action within ~10 min of reveal). */
export const artUrl = (id, stage) => `art/${id}_${stage || 1}.png?v=5`;
export const MINT_TYPES = { 1: ["Paid", "付费"], 2: ["Invite", "邀请"], 3: ["Free", "免费"] };

/**
 * Newest trees for the live feed, in one Multicall3 batch: totalMinted, plus tokenData(id) and stageOf(id)
 * for ids top..top-(n-1). `top` is the last known totalMinted; the fresh total comes back so the caller can
 * catch up on the next tick.
 */
export async function latestTrees(top, n = 12) {
  if (!configured("nft")) return { total: 0, trees: [] };
  const ids = [];
  for (let t = top; t >= 1 && ids.length < n; t--) ids.push(t);
  const calls = [{ iface: I.nft, to: CONFIG.nft, fn: "totalMinted" }];
  ids.forEach((t) => calls.push({ iface: I.nft, to: CONFIG.nft, fn: "tokenData", args: [t] }, { iface: I.nft, to: CONFIG.nft, fn: "stageOf", args: [t] }));
  const r = await multi(calls);
  const total = Number(r[0] ?? top);
  const trees = ids.map((id, k) => {
    const d = r[1 + 2 * k], sg = r[2 + 2 * k];
    if (!d) return null;
    const revealed = !!d.revealed;
    return { id, mintType: Number(d.mintType), revealed, rarity: revealed ? RARITY_NAMES[Number(d.rarity)] || null : null, stage: sg === null || sg === undefined ? 1 : Number(sg) };
  }).filter(Boolean);
  return { total, trees };
}

/** Invite check for a tree id: exists, invites used. */
export async function inviteInfo(tokenId) {
  if (!configured("nft")) return null;
  const [owner, used] = await multi([
    { iface: I.nft, to: CONFIG.nft, fn: "ownerOf", args: [tokenId] },
    { iface: I.nft, to: CONFIG.nft, fn: "invitesUsedOf", args: [tokenId] },
  ]);
  return { exists: !!owner, owner, invitesUsed: used === null ? null : Number(used) };
}

export { toUtf8String };
