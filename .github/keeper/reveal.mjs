// Rootlinks reveal keeper: calls the NFT's public revealPending() when trees are due.
// Needs secret KEEPER_KEY (a dedicated gas-only wallet). Value 0 calls only.
import { ethers } from "ethers";
const NFT = "0x25F6DF83D43496583BC7190f02E68A15C3E3bB25";
const RPCS = ["https://bsc-dataseed.bnbchain.org", "https://bsc-rpc.publicnode.com", "https://bsc-dataseed1.defibit.io"];
const ABI = ["function pendingCount() view returns (uint256)", "function revealPending(uint256) returns (uint256)"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = process.env.KEEPER_KEY;
if (!key) { console.log("no KEEPER_KEY"); process.exit(0); }
let p;
for (const u of RPCS) { try { p = new ethers.JsonRpcProvider(u, 56, { staticNetwork: true }); await p.getBlockNumber(); break; } catch { p = null; } }
if (!p) { console.log("no rpc"); process.exit(0); }
const w = new ethers.Wallet(key, p);
const c = new ethers.Contract(NFT, ABI, w);
const deadline = Date.now() + 4.5 * 60 * 1000;   // loop ~4.5 min per run (cron is every 5 min)
let stuckSince = 0;
while (Date.now() < deadline) {
  try {
    const pending = await c.pendingCount();
    if (pending > 0n) {
      const n = await c.revealPending.staticCall(50).catch(() => 0n);
      // n == 0 while pending: either not due yet (a few seconds) or the hash expired and needs a re-target.
      if (n === 0n) {
        if (!stuckSince) stuckSince = Date.now();
        if (Date.now() - stuckSince < 20000) { await sleep(2000); continue; }
      }
      const tx = await c.revealPending(50, { gasLimit: 900000 });
      const r = await tx.wait();
      console.log(new Date().toISOString(), "pending", pending.toString(), "due", n.toString(), "tx", tx.hash, "status", r.status);
      stuckSince = 0;
      await sleep(n > 0n ? 2000 : 5000);
      continue;
    }
    stuckSince = 0;
  } catch (e) { console.log("err", e.shortMessage || e.message); }
  await sleep(4000);
}
