#!/usr/bin/env python3
"""Render missing Rootlinks token images from on-chain state.

Reads the NFT on BNB Smart Chain with plain JSON-RPC (no keys), and for every
revealed token writes <repo>/art/<id>_<stage>.png for its CURRENT stage if missing.
tokenURI image = baseImageURI + id + "_" + stage + ".png".
"""
import json, os, sys, time, urllib.request

NFT = "0x25F6DF83D43496583BC7190f02E68A15C3E3bB25"
RPCS = [os.environ.get("RPC", "https://bsc-rpc.publicnode.com"),
        "https://bsc-dataseed.bnbchain.org", "https://bsc-dataseed1.defibit.io", "https://bsc.drpc.org"]
SEL = {"totalMinted": "a2309ff8", "rarityOf": "dd3b5f9a", "mintTypeOf": "b01b1600",
       "stageOf": "c7d25b15", "invitesUsedOf": "7f0a5f39"}
RARITY = ["Common", "Uncommon", "Rare", "Legendary", "Mythic"]
MINT = {1: "Paid", 2: "Invite", 3: "Free"}
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.environ.get("ART_DIR") or os.path.join(REPO, "art")   # served at /art/
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def rpc(payload):
    last = None
    for attempt in range(6):
        url = RPCS[attempt % len(RPCS)]
        try:
            req = urllib.request.Request(url, json.dumps(payload).encode(),
                                         {"Content-Type": "application/json", "User-Agent": "rootlinks-art"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception as e:
            last = e; time.sleep(1 + attempt)
    raise SystemExit(f"rpc failed: {last}")


MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11"   # canonical Multicall3, deployed on BSC


def call_data(fn, tid=None):
    return SEL[fn] + ("" if tid is None else format(tid, "064x"))


def w(n):
    return format(n, "064x")


def eth_call(to, data):
    res = rpc({"jsonrpc": "2.0", "id": 1, "method": "eth_call", "params": [{"to": to, "data": "0x" + data}, "latest"]})
    if "result" not in res:
        raise SystemExit(f"eth_call error: {str(res)[:300]}")
    return res["result"][2:]


def batch(calls):
    """calls: list of (key, fn, tid). One Multicall3.aggregate3 eth_call per 400 calls. Returns {key: hex}."""
    out = {}
    for i in range(0, len(calls), 400):
        chunk = calls[i:i + 400]
        n = len(chunk)
        heads, tails, off = [], [], 32 * n
        for _, fn, tid in chunk:
            cd = call_data(fn, tid)
            ln = len(cd) // 2
            body = w(int(NFT, 16)) + w(1) + w(0x60) + w(ln) + cd + "0" * ((-len(cd)) % 64)
            heads.append(w(off)); tails.append(body); off += len(body) // 2
        data = "82ad56cb" + w(0x20) + w(n) + "".join(heads) + "".join(tails)
        r = eth_call(MULTICALL3, data)
        base = int(r[0:64], 16) * 2           # array start
        cnt = int(r[base:base + 64], 16)
        assert cnt == n, (cnt, n)
        a0 = base + 64
        for j, (key, _, _) in enumerate(chunk):
            e = a0 + int(r[a0 + 64 * j:a0 + 64 * j + 64], 16) * 2
            ok = int(r[e:e + 64], 16)
            boff = e + int(r[e + 64:e + 128], 16) * 2
            bl = int(r[boff:boff + 64], 16)
            out[key] = r[boff + 64:boff + 64 + bl * 2] if ok else None
        time.sleep(0.3)
    return out


def words(h):
    return [int(h[k:k + 64], 16) for k in range(0, len(h), 64)]


def main():
    total = words(eth_call(NFT, call_data("totalMinted")))[0]
    try:
        prev = json.load(open(os.path.join(OUT, "state.json")))["tokens"]
    except Exception:
        prev = {}
    calls = []
    for t in range(1, total + 1):
        if str(t) not in prev:   # rarity and mint type never change once revealed
            calls += [((t, "r"), "rarityOf", t), ((t, "m"), "mintTypeOf", t)]
        calls += [((t, "s"), "stageOf", t), ((t, "i"), "invitesUsedOf", t)]
    res = batch(calls)
    state, todo = {}, []
    for t in range(1, total + 1):
        if str(t) in prev:
            info = dict(prev[str(t)])
        else:
            if res[(t, "r")] is None:
                continue
            revealed, rar = words(res[(t, "r")])[:2]
            if not revealed:
                continue
            info = {"rarity": RARITY[rar], "mintType": MINT.get(words(res[(t, "m")])[0], "Free")}
        if res[(t, "s")] is None or res[(t, "i")] is None:
            continue
        info["stage"] = words(res[(t, "s")])[0]
        info["invitesUsed"] = words(res[(t, "i")])[0]
        state[str(t)] = info
        if not os.path.exists(os.path.join(OUT, f"{t}_{info['stage']}.png")):
            todo.append(t)
    print(f"totalMinted={total} revealed={len(state)} missing={len(todo)}", flush=True)
    if todo:
        import art
        for n, t in enumerate(todo, 1):
            v = state[str(t)]
            img = art.render_png(t, v["rarity"], max(1, min(5, v["stage"])), v["mintType"], invites=min(2, v["invitesUsed"]))
            path = os.path.join(OUT, f"{t}_{v['stage']}.png")
            img.save(path + ".tmp", "PNG", optimize=True); os.replace(path + ".tmp", path)
            if n % 50 == 0: print(f"  {n}/{len(todo)}", flush=True)
    with open(os.path.join(OUT, "state.json"), "w") as f:
        json.dump({"totalMinted": total, "revealed": len(state), "tokens": state}, f, separators=(",", ":"), sort_keys=True)
    print(f"rendered {len(todo)}")


if __name__ == "__main__":
    main()
