"""Rootlinks art system (final).

render(token_id, rarity, stage, mint_type, invites=None) -> 1024x1024 PIL image
placeholder() -> pre-reveal 1024x1024 image

Deterministic: every random choice comes from seeds derived from token_id (and,
for tree nodes, from the node's path), so the same inputs always give the same
pixels, and a token keeps the same tree shape as it grows from stage 1 to 5.
Style continues gen.py: flat code-drawn shapes, starry dusk sky, cut-away soil
with visible roots, invite roots glowing out to the frame edge.
"""
import math, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageChops

W = 1024          # output size
S = 1             # supersample factor for the crisp layer (final 512px downscale gives AA)
OUT = 512         # published size
CW = W * S        # canvas width

RARITIES = ["Common", "Uncommon", "Rare", "Legendary", "Mythic"]
MINT_TYPES = ["Paid", "Invite", "Free"]  # no reserve tier

# ---------------------------------------------------------------- palettes
# base set (Common / Uncommon) - the four palettes from gen.py, plus an accent
BASE = {
    "dusk":   dict(bg1=(18,16,30), bg2=(40,28,52), soil=(46,30,26), ground=(30,22,26), bark=(92,62,44), root=(140,96,62),
                   leaf=[(120,170,90),(160,200,110),(90,140,80)], accent=(236,138,168), glow=(255,210,140)),
    "frost":  dict(bg1=(14,22,34), bg2=(34,58,78), soil=(30,40,52), ground=(22,28,36), bark=(70,82,96), root=(120,150,170),
                   leaf=[(190,225,240),(150,200,225),(230,245,250)], accent=(120,160,235), glow=(200,240,255)),
    "ember":  dict(bg1=(24,10,10), bg2=(70,24,18), soil=(52,22,16), ground=(32,15,13), bark=(70,36,28), root=(150,70,40),
                   leaf=[(240,120,50),(250,170,60),(200,70,40)], accent=(255,226,120), glow=(255,170,80)),
    "golden": dict(bg1=(16,14,10), bg2=(52,40,18), soil=(44,32,16), ground=(28,21,12), bark=(110,78,36), root=(200,150,60),
                   leaf=[(240,200,90),(255,225,130),(210,160,60)], accent=(196,84,56), glow=(255,230,150)),
}
# Rare set - its own palettes, plus fireflies
RARE = {
    "verdigris": dict(bg1=(8,20,22), bg2=(22,54,56), soil=(26,36,34), ground=(16,24,24), bark=(58,70,66), root=(96,140,128),
                      leaf=[(70,180,150),(110,210,170),(40,140,120)], accent=(210,240,170), glow=(170,255,210), fly=(200,255,170)),
    "amethyst":  dict(bg1=(16,10,30), bg2=(52,30,80), soil=(36,26,46), ground=(24,18,32), bark=(78,58,92), root=(140,110,170),
                      leaf=[(170,130,230),(200,170,250),(130,100,200)], accent=(250,200,240), glow=(230,190,255), fly=(255,220,255)),
    "blush":     dict(bg1=(24,10,22), bg2=(70,30,56), soil=(48,28,36), ground=(30,18,24), bark=(96,60,62), root=(170,110,110),
                      leaf=[(250,160,190),(255,200,215),(220,120,160)], accent=(255,240,200), glow=(255,200,170), fly=(255,236,180)),
    "tide":      dict(bg1=(6,14,30), bg2=(16,50,80), soil=(22,32,46), ground=(14,20,32), bark=(50,70,90), root=(90,140,170),
                      leaf=[(60,190,220),(120,225,240),(40,140,190)], accent=(240,250,200), glow=(150,240,255), fly=(190,255,240)),
}
# Legendary set - unique palettes, luminous bark and an aura
LEGENDARY = {
    "astral":   dict(bg1=(6,6,22), bg2=(28,24,70), soil=(24,22,42), ground=(14,13,28), bark=(120,120,170), root=(150,150,200),
                     leaf=[(196,202,250),(158,168,240),(232,232,255)], accent=(170,140,255), glow=(200,210,255),
                     lum=(150,160,255), aura=(110,100,220), fly=(230,235,255)),
    "solstice": dict(bg1=(8,7,6), bg2=(34,28,20), soil=(30,25,20), ground=(18,15,12), bark=(200,170,110), root=(190,160,110),
                     leaf=[(255,248,225),(255,232,170),(245,215,140)], accent=(255,255,255), glow=(255,235,180),
                     lum=(255,200,110), aura=(255,190,90), fly=(255,240,200)),
    "aurora":   dict(bg1=(4,12,16), bg2=(10,34,40), soil=(20,30,30), ground=(12,18,20), bark=(60,90,96), root=(100,150,150),
                     leaf=[(90,240,190),(150,120,240),(120,200,250)], accent=(240,140,230), glow=(160,255,220),
                     lum=(90,255,200), aura=(80,200,190), fly=(200,255,230), ribbons=True),
}
# Mythic - World Tree, one-of-one palette
WORLD = dict(bg1=(5,8,24), bg2=(26,52,72), horizon=(150,120,80), soil=(28,30,30), ground=(16,18,20), bark=(96,84,70),
             root=(170,150,120), leaf=[(80,200,140),(150,225,120),(230,210,110),(60,160,130)], accent=(255,240,180),
             glow=(170,255,240), lum=(255,220,150), aura=(255,214,150), fly=(255,236,170))

def _mix(a, b, t):
    return tuple(int(a[i] * (1 - t) + b[i] * t) for i in range(3))

def _lift(c, k):
    return tuple(max(0, min(255, int(v + k))) for v in c)

# ---------------------------------------------------------------- tree growth
def grow(code, x, y, ang, length, width, depth, up, segs, tips, spread=None, level=0, knots=None):
    """Recursive branch. Randomness comes from `code` (the node path), so a
    deeper (older) tree keeps the shape of its younger self."""
    r = random.Random(code)
    cx, cy, a = x, y, ang
    n_seg = 6
    for i in range(n_seg):
        a += r.uniform(-0.12, 0.12)
        nx = cx + math.cos(a) * length / n_seg
        ny = cy + math.sin(a) * length / n_seg
        w = max(1.0, width * (1 - 0.35 * i / n_seg))
        segs.append((cx, cy, nx, ny, w, level))
        cx, cy = nx, ny
    if depth <= 1 or length < 6:
        tips.append((cx, cy, a, code, level))
        return
    if knots is not None and depth <= 3:
        knots.append((cx, cy, a, code, level))
    n = r.choice([2, 2, 3]) if up else r.choice([2, 3, 3])
    sp = spread if spread is not None else (0.66 if up else 0.75)
    for k in range(n):
        da = r.uniform(-sp, sp) + (k - (n - 1) / 2) * 0.25
        na = a + da
        if not up:
            na = max(min(na, math.pi - 0.12), 0.12)
        grow(code * 7 + k + 1, cx, cy, na, length * r.uniform(0.62, 0.8), width * 0.66,
             depth - 1, up, segs, tips, spread, level + 1, knots)

def _transform(segs, tips, ox, oy, k):
    f = lambda px, py: (ox + (px - ox) * k, oy + (py - oy) * k)
    s2 = [(*f(a, b), *f(c, d), w * k, l) for a, b, c, d, w, l in segs]
    t2 = [(*f(a, b), ang, code, l) for a, b, ang, code, l in tips]
    return s2, t2

def _tpts(pts, ox, oy, k):
    return [(ox + (a - ox) * k, oy + (b - oy) * k, ang, code, l) for a, b, ang, code, l in pts]

def radial_cw(img, cx, cy, rad, col, strength, squash=1.0):
    """Additive radial light on the supersampled canvas (CW coords), drawn behind the tree."""
    ys = np.arange(CW, dtype=np.float32)[:, None]; xs = np.arange(CW, dtype=np.float32)[None, :]
    dd = ((xs - cx) ** 2 + ((ys - cy) / squash) ** 2) / (rad * rad)
    f = np.exp(-dd * 2.2) * strength
    arr = np.asarray(img).astype(np.float32) + f[..., None] * np.array(col, np.float32)
    out = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")
    return out, ImageDraw.Draw(out)

def draw_segs(d, segs, col, scale=1.0, wmul=1.0):
    for x1, y1, x2, y2, w, _ in segs:
        x1, y1, x2, y2 = x1 * scale, y1 * scale, x2 * scale, y2 * scale
        ww = max(1, w * scale * wmul)
        d.line([(x1, y1), (x2, y2)], fill=col, width=int(round(ww)))
        rr = ww / 2
        d.ellipse([x2 - rr, y2 - rr, x2 + rr, y2 + rr], fill=col)

def bark_highlight(d, segs, col):
    """A thin lit edge on the left of thick limbs - reads as hand-painted."""
    for x1, y1, x2, y2, w, _ in segs:
        if w < 5 * S:
            continue
        dx, dy = x2 - x1, y2 - y1
        ln = math.hypot(dx, dy) or 1
        nx, ny = dy / ln, -dx / ln      # normal
        if nx > 0: nx, ny = -nx, -ny     # keep on the left side
        o = w * 0.28
        d.line([(x1 + nx * o, y1 + ny * o), (x2 + nx * o, y2 + ny * o)], fill=col, width=max(1, int(w * 0.22)))

def leaf_shape(d, x, y, ang, ln, wd, col, vein=None):
    pts = []
    for i in range(9):
        t = i / 8
        off = math.sin(t * math.pi) * wd / 2
        px, py = x + math.cos(ang) * ln * t, y + math.sin(ang) * ln * t
        pts.append((px - math.sin(ang) * off, py + math.cos(ang) * off))
    for i in range(7, 0, -1):
        t = i / 8
        off = math.sin(t * math.pi) * wd / 2
        px, py = x + math.cos(ang) * ln * t, y + math.sin(ang) * ln * t
        pts.append((px + math.sin(ang) * off, py - math.cos(ang) * off))
    d.polygon(pts, fill=col)
    if vein:
        d.line([(x, y), (x + math.cos(ang) * ln * 0.85, y + math.sin(ang) * ln * 0.85)], fill=vein, width=max(1, int(wd * 0.12)))

# ---------------------------------------------------------------- scenery
def sky(p, gy, horizon=None):
    yy = np.linspace(0, 1, gy)[:, None]
    top, bot = np.array(p["bg1"], float), np.array(p["bg2"], float)
    col = top * (1 - yy) + bot * yy
    if horizon is not None:
        h = np.clip((yy - 0.55) / 0.45, 0, 1) ** 2.2
        col = col * (1 - 0.55 * h) + np.array(horizon, float) * 0.55 * h
    arr = np.repeat(col[:, None, :], CW, axis=1)
    return arr

def soil(p, gy):
    n = CW - gy
    t = np.linspace(0, 1, n)[:, None]
    col = np.array(p["soil"], float) * (1 - 0.45 * t)
    return np.repeat(col[:, None, :], CW, axis=1)

def base_scene(p, rng, gy, horizon=None, stars=90):
    arr = np.zeros((CW, CW, 3), float)
    arr[:gy] = sky(p, gy, horizon)
    arr[gy:] = soil(p, gy)
    img = Image.fromarray(arr.astype(np.uint8), "RGB")
    d = ImageDraw.Draw(img)
    starc = _lift(p["bg2"], 70)
    for _ in range(stars):
        sx, sy = rng.uniform(0, CW), rng.uniform(0, gy * 0.85)
        r = rng.uniform(1, 3) * S
        d.ellipse([sx - r, sy - r, sx + r, sy + r], fill=_mix(p["bg2"], starc, rng.uniform(0.5, 1)))
    # soil strata - faint wavy bands
    for k in range(5):
        base = gy + (k + 1) * (CW - gy) / 6 + rng.uniform(-10, 10) * S
        ph, amp = rng.uniform(0, 6.28), rng.uniform(4, 10) * S
        pts = [(x, base + math.sin(x / CW * 6.28 * 1.5 + ph) * amp) for x in range(0, CW + 64, 64)]
        d.line(pts, fill=_lift(p["soil"], -8 - k * 2), width=2 * S)
    for _ in range(60):  # pebbles
        sx, sy = rng.uniform(0, CW), rng.uniform(gy + 20 * S, CW)
        r = rng.uniform(3, 9) * S
        c = _lift(p["soil"], 12)
        d.ellipse([sx - r, sy - r * 0.7, sx + r, sy + r * 0.7], fill=c)
        d.ellipse([sx - r * 0.6, sy - r * 0.6, sx + r * 0.1, sy - r * 0.1], fill=_lift(c, 8))
    # ground band with a gently uneven top edge
    ph = rng.uniform(0, 6.28)
    top = [(x, gy - 7 * S + math.sin(x / CW * 9 + ph) * 2 * S + math.sin(x / CW * 23) * 1.2 * S) for x in range(0, CW + 32, 32)]
    d.polygon(top + [(CW, gy + 6 * S), (0, gy + 6 * S)], fill=p["ground"])
    return img, d

def grass(d, p, rng, gy, n=70, flowers=0):
    """Small fanned tufts: blades spread from one root point so they never read as a skyline."""
    gc = _mix(p["ground"], p["leaf"][-1], 0.28)
    for _ in range(n):
        x = rng.uniform(0, CW)
        nb = rng.randint(3, 5)
        for j in range(nb):
            h = rng.uniform(7, 15) * S
            a = -math.pi / 2 + (j - (nb - 1) / 2) * 0.32 + rng.uniform(-0.12, 0.12)
            bx, by = x, gy - 3 * S
            mx, my = bx + math.cos(a) * h * 0.5, by + math.sin(a) * h * 0.5
            tx, ty = bx + math.cos(a + 0.25 * (1 if a > -math.pi / 2 else -1)) * h, by + math.sin(a) * h
            d.line([(bx, by), (mx, my), (tx, ty)], fill=gc, width=S)

def mint_glyph(d, p, mint_type, gy):
    """Small stone half-buried at bottom right, with a faint carved mark."""
    cx, cy = CW - 74 * S, CW - 58 * S
    stone = _lift(p["soil"], 16)
    d.ellipse([cx - 25 * S, cy - 15 * S, cx + 25 * S, cy + 20 * S], fill=_lift(p["soil"], -10))
    d.ellipse([cx - 24 * S, cy - 18 * S, cx + 24 * S, cy + 16 * S], fill=stone)
    mk = _mix(stone, p["root"], 0.55)
    lw = 2 * S
    if mint_type == "Paid":        # coin: ring + dot
        d.ellipse([cx - 9 * S, cy - 9 * S, cx + 9 * S, cy + 9 * S], outline=mk, width=lw)
        d.ellipse([cx - 2.5 * S, cy - 2.5 * S, cx + 2.5 * S, cy + 2.5 * S], fill=mk)
    elif mint_type == "Invite":    # two linked rings
        for ox in (-5, 5):
            d.ellipse([cx + ox * S - 7 * S, cy - 7 * S, cx + ox * S + 7 * S, cy + 7 * S], outline=mk, width=lw)
    else:                          # Free: leaf with midrib
        leaf_shape(d, cx - 8 * S, cy + 7 * S, -math.pi / 4, 22 * S, 10 * S, mk, vein=stone)

def invite_roots(d, gd, p, token_id, x0, gy, links, thick=1.0):
    """Glowing roots that run out of frame - one per successful invite.
    Crisp core drawn on the main canvas (d, CW scale); glow on gd (W scale)."""
    for k in range(links):
        r = random.Random(token_id * 104729 + k * 31 + 5)
        side = -1 if k % 2 == 0 else 1
        # first invite root runs shallow to the left, second deeper to the right,
        # so two invites always read as two separate roots
        y_start = gy + (24 if k == 0 else 58) * S
        ty = gy + (r.uniform(70, 130) if k == 0 else r.uniform(190, 280)) * S
        ph = r.uniform(0, 6.28)
        pts = []
        for i in range(25):
            t = i / 24
            sx0 = x0 + side * 6 * S
            px = sx0 + side * t * (abs((CW if side > 0 else 0) - sx0) + 30 * S)
            py = y_start + (ty - y_start) * (t ** 0.8) + math.sin(t * 7 + ph) * 14 * S * t
            pts.append((px, py))
        # small side tendrils
        tend = []
        for j in range(3):
            i = r.randint(6, 20)
            bx, by = pts[i]
            ln = r.uniform(30, 60) * S
            a = math.pi / 2 + side * r.uniform(0.3, 0.9)
            tend.append([(bx, by), (bx + math.cos(a) * ln * 0.5, by + math.sin(a) * ln * 0.5 + 6 * S), (bx + math.cos(a) * ln, by + math.sin(a) * ln)])
        core = _mix(p["glow"], (255, 255, 255), 0.35)
        for t in tend:
            d.line(t, fill=p["glow"], width=int(3 * S * thick), joint="curve")
            gd.line([(a / S, b / S) for a, b in t], fill=p["glow"], width=int(3 * thick))
        d.line(pts, fill=p["glow"], width=int(8 * S * thick), joint="curve")
        d.line(pts, fill=core, width=int(3 * S * thick), joint="curve")
        gd.line([(a / S, b / S) for a, b in pts], fill=p["glow"], width=int(9 * thick), joint="curve")

def add_glow(img, glow, wide=16, tight=4, k_wide=1.0, k_tight=0.7):
    g1 = glow.filter(ImageFilter.GaussianBlur(wide))
    g2 = glow.filter(ImageFilter.GaussianBlur(tight))
    if k_wide != 1.0: g1 = g1.point(lambda v: int(v * k_wide))
    g2 = g2.point(lambda v: int(v * k_tight))
    return ImageChops.add(ImageChops.add(img, g1), g2)

def radial(img, cx, cy, rad, col, strength, squash=1.0):
    """Additive radial light (W-scale coordinates)."""
    yy, xx = np.mgrid[0:W, 0:W].astype(np.float32)
    dd = ((xx - cx) ** 2 + ((yy - cy) / squash) ** 2) / (rad * rad)
    f = np.exp(-dd * 2.2) * strength
    arr = np.asarray(img).astype(np.float32) + f[..., None] * np.array(col, np.float32)
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")

_VIG = None
def finish(img, seed):
    """Hand-printed feel: soft vignette, faint paper mottling and sparse paper fibres.
    (Per-pixel grain was dropped: it tripled PNG size for no visible gain at thumbnail size.)"""
    global _VIG
    if _VIG is None:
        yy, xx = np.mgrid[0:W, 0:W].astype(np.float32)
        _VIG = 1 - 0.28 * (((xx - W / 2) ** 2 + (yy - W / 2) ** 2) / (W * W / 2)) ** 1.3
    rg = np.random.default_rng(seed)
    m = Image.fromarray((rg.random((32, 32)) * 255).astype(np.uint8), "L").resize((W, W), Image.BICUBIC)
    m = m.filter(ImageFilter.GaussianBlur(12))
    mott = (np.asarray(m).astype(np.float32) / 255 - 0.5) * 9
    arr = np.asarray(img).astype(np.float32) * _VIG[..., None] + mott[..., None]
    out = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")
    d = ImageDraw.Draw(out)
    r = random.Random(seed)
    for _ in range(140):   # paper fibres
        x, y = r.uniform(0, W), r.uniform(0, W)
        a = r.uniform(0, 3.14); ln = r.uniform(2, 6)
        px = out.getpixel((int(x), int(y)))
        d.line([(x, y), (x + math.cos(a) * ln, y + math.sin(a) * ln)], fill=_lift(px, r.choice([-10, 9])), width=1)
    return out

def particles(gd, rng, box, n, col, rmin=1.5, rmax=3.2):
    x1, y1, x2, y2 = box
    pts = []
    for _ in range(n):
        x, y = rng.uniform(x1, x2), rng.uniform(y1, y2)
        r = rng.uniform(rmin, rmax)
        gd.ellipse([x - r, y - r, x + r, y + r], fill=col)
        pts.append((x, y, r))
    return pts

def sky_ribbons(img, rng, p, gy):
    """Aurora-like ribbons for the aurora legendary palette (W scale, additive)."""
    rib = Image.new("RGB", (W, W), (0, 0, 0)); rd = ImageDraw.Draw(rib)
    for k in range(3):
        base = rng.uniform(90, 260); ph = rng.uniform(0, 6.28); amp = rng.uniform(20, 45)
        col = [(30, 170, 140), (90, 50, 160), (40, 130, 160)][k]
        pts = [(x, base + math.sin(x / W * 5 + ph) * amp + math.sin(x / W * 13 + ph) * 8) for x in range(-20, W + 40, 16)]
        rd.line(pts, fill=col, width=int(rng.uniform(18, 34)), joint="curve")
    rib = rib.filter(ImageFilter.GaussianBlur(18)).resize(img.size, Image.BILINEAR)
    out = ImageChops.add(img, rib)
    return out

# ---------------------------------------------------------------- foliage
def foliage(d, p, tips, stage, rarity, scale=1.0):
    leaves = p["leaf"]
    blobs = []
    per = 2 + stage
    for (tx, ty, a, code, lvl) in tips:
        r = random.Random(code ^ 0x5EED)
        for _ in range(per):
            lx, ly = tx + r.uniform(-22, 22) * S * scale, ty + r.uniform(-22, 18) * S * scale
            rad = r.uniform(7, 14) * S * scale * (1 + 0.04 * stage)
            blobs.append((lx, ly, rad, r.choice(leaves), r.random()))
    for lx, ly, rad, c, _ in blobs:       # shadow pass
        d.ellipse([lx - rad + rad * 0.25, ly - rad + rad * 0.32, lx + rad + rad * 0.25, ly + rad + rad * 0.32], fill=_lift(c, -55))
    for lx, ly, rad, c, _ in blobs:       # body
        d.ellipse([lx - rad, ly - rad, lx + rad, ly + rad], fill=c)
    for lx, ly, rad, c, q in blobs:       # light pass on some blobs
        if q < 0.45:
            h = rad * 0.45
            d.ellipse([lx - rad * 0.45 - h, ly - rad * 0.45 - h, lx - rad * 0.45 + h, ly - rad * 0.45 + h], fill=_lift(c, 28))
    return blobs

def accent_leaves(d, p, tips, rng, stage, scale=1.0, falling=True, gy=None, x0=None, prob=0.55):
    """Uncommon+ : pointed accent leaves sprinkled through the crown, and a few drifting down."""
    acc = p["accent"]
    vein = _lift(acc, -60)
    for (tx, ty, a, code, lvl) in tips:
        r = random.Random(code ^ 0xACC)
        if r.random() < prob:
            ang = r.uniform(0, 6.28)
            leaf_shape(d, tx + r.uniform(-16, 16) * S * scale, ty + r.uniform(-16, 12) * S * scale, ang,
                       r.uniform(14, 22) * S * scale, r.uniform(7, 10) * S * scale, acc, vein)
    if falling and gy is not None and tips:
        xs = [t[0] for t in tips]; ys = [t[1] for t in tips]
        for _ in range(3 + stage):
            fx = rng.uniform(min(xs) - 60 * S, max(xs) + 60 * S)
            fy = rng.uniform(max(ys), gy - 25 * S)
            leaf_shape(d, fx, fy, rng.uniform(0, 6.28), 15 * S, 7 * S, acc, vein)

def blossoms(d, p, tips, stage, scale=1.0):
    """Stage 2+: small five-petal blooms through the crown; stage 3 blooms fully."""
    acc = p["accent"]; core = _mix(acc, (255, 245, 200), 0.6)
    prob = 0.28 if stage == 2 else 0.6
    for (tx, ty, a, code, lvl) in tips:
        r = random.Random(code ^ 0xB10)
        if r.random() >= prob:
            continue
        bx, by = tx + r.uniform(-18, 18) * S * scale, ty + r.uniform(-18, 14) * S * scale
        pr = r.uniform(3.5, 5.5) * S * scale * (1.0 if stage == 2 else 1.25)
        rot = r.uniform(0, 6.28)
        for j in range(5):
            aa = rot + j * 1.2566
            px, py = bx + math.cos(aa) * pr, by + math.sin(aa) * pr
            d.ellipse([px - pr, py - pr, px + pr, py + pr], fill=acc)
        d.ellipse([bx - pr * 0.6, by - pr * 0.6, bx + pr * 0.6, by + pr * 0.6], fill=core)

def sapling_leaves(d, p, tips, accent=False):
    for (tx, ty, a, code, lvl) in tips:
        r = random.Random(code ^ 0x51)
        for sgn in (-1, 1):
            ang = a + sgn * r.uniform(0.6, 1.0)
            c = p["accent"] if (accent and sgn > 0 and r.random() < 0.5) else r.choice(p["leaf"])
            leaf_shape(d, tx, ty, ang, r.uniform(28, 36) * S, r.uniform(13, 17) * S, c, _lift(c, -50))

# ---------------------------------------------------------------- render
# Fixed rarity identities (match the homepage rarity cards). One palette per
# rarity; pick_palette only nudges shade per token, never the hue family.
RARITY_PAL = {
    "Common":    dict(bg1=(10,11,30), bg2=(34,28,66), soil=(34,28,30), ground=(20,18,26), bark=(96,70,50), root=(150,108,70),
                      leaf=[(96,180,80),(140,210,96),(70,150,70)], accent=(226,236,140), glow=(255,214,150)),
    "Uncommon":  dict(bg1=(26,9,8), bg2=(84,32,20), soil=(50,24,18), ground=(32,15,12), bark=(84,44,30), root=(160,84,46),
                      leaf=[(245,140,50),(255,180,70),(220,100,40)], accent=(255,214,110), glow=(255,180,80)),
    "Rare":      dict(bg1=(16,9,32), bg2=(58,32,92), soil=(36,26,48), ground=(24,17,34), bark=(82,62,100), root=(146,116,180),
                      leaf=[(170,130,235),(205,175,252),(135,100,210)], accent=(248,205,250), glow=(225,195,255), fly=(250,230,255)),
    "Legendary": dict(bg1=(4,14,18), bg2=(10,40,46), soil=(18,30,32), ground=(11,19,21), bark=(60,150,146), root=(90,170,165),
                      leaf=[(70,220,200),(120,240,225),(50,180,190)], accent=(190,120,250), glow=(140,255,230),
                      lum=(90,255,220), aura=(60,190,180), fly=(200,255,240), ribbons=True),
}
_KEYS_SHADE = ("bg1", "bg2", "leaf", "accent", "bark")

def pick_palette(token_id, rarity):
    if rarity == "Mythic":
        return "worldtree", WORLD
    base = RARITY_PAL[rarity]
    r = random.Random(token_id * 2654435761 + 17)
    k = r.uniform(-12, 12)          # small per-token brightness shift, same hue family
    p = dict(base)
    p["leaf"] = [_lift(c, k + r.uniform(-6, 6)) for c in base["leaf"]]
    p["bg2"] = _lift(base["bg2"], r.uniform(-6, 6))
    p["accent"] = _lift(base["accent"], r.uniform(-8, 8))
    return rarity.lower(), p

def default_invites(stage):
    return min(max(stage - 1, 0), 2)

def render(token_id, rarity, stage, mint_type, invites=None):
    rarity = rarity.capitalize(); mint_type = mint_type.capitalize()
    assert rarity in RARITIES and mint_type in MINT_TYPES and 1 <= stage <= 5
    links = default_invites(stage) if invites is None else max(0, min(2, invites))
    if rarity == "Mythic":
        return render_world_tree(token_id, stage, mint_type, links)
    pname, p = pick_palette(token_id, rarity)
    rng = random.Random(token_id * 7919)
    gy = int(CW * 0.64)

    x0 = CW / 2 + rng.uniform(-30, 30) * S
    gs = stage + 2                      # growth: stage 1 is already a full, mature tree
    depth = min(2 + gs, 7)
    trunk_len = (62 + gs * 10) * S       # short trunk, broad crown
    trunk_w = (6 + gs * 5) * S
    base_code = token_id * 1000003 + 11

    # --- geometry first (so lights can sit behind the tree)
    rsegs, rtips = [], []
    rr = random.Random(token_id * 31337)
    for k in range(2 + gs // 2):
        a = math.pi / 2 + rr.uniform(-0.9, 0.9)
        grow(base_code * 3 + 1000 + k, x0 + rr.uniform(-trunk_w / 3, trunk_w / 3), gy, a,
             (34 + gs * 11) * S, trunk_w * 0.45, depth - 1, False, rsegs, rtips)
    segs, tips, knots = [], [], []
    grow(base_code, x0, gy, -math.pi / 2 + rr.uniform(-0.08, 0.08), trunk_len, trunk_w, depth, True,
         segs, tips, spread=0.95, knots=knots)
    m = 1.4 + 0.12 * (stage - 1)          # mature tree fills the frame; grows a little per stage
    segs, tips = _transform(segs, tips, x0, gy, m)
    knots = _tpts(knots, x0, gy, m)
    rsegs, rtips = _transform(rsegs, rtips, x0, gy, 1.15)
    pad = 60 * S
    min_y = min(t[1] for t in tips) - 40 * S
    min_x = min(t[0] for t in tips) - 45 * S; max_x = max(t[0] for t in tips) + 45 * S
    k = 1.0
    if min_y < pad: k = min(k, (gy - pad) / (gy - min_y))
    if min_x < 30 * S: k = min(k, (x0 - 30 * S) / (x0 - min_x))
    if max_x > CW - 30 * S: k = min(k, (CW - 30 * S - x0) / (max_x - x0))
    if k < 1.0:
        segs, tips = _transform(segs, tips, x0, gy, k)
        knots = _tpts(knots, x0, gy, k)
    xs = [t[0] for t in tips]; ys = [t[1] for t in tips]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    bw = max(max(xs) - min(xs), 120 * S); bh = max(max(ys) - min(ys), 120 * S)

    # --- scene
    img, d = base_scene(p, rng, gy)
    if rarity == "Legendary":
        if p.get("ribbons"):
            img = sky_ribbons(img, random.Random(token_id * 77), p, gy / S)
        img, d = radial_cw(img, cx, cy + bh * 0.1, max(bw, bh) * 0.75 + 140 * S, p["aura"], 0.5, squash=0.9)
    grass(d, p, rng, gy)
    glow = Image.new("RGB", (W, W), (0, 0, 0)); gd = ImageDraw.Draw(glow)

    draw_segs(d, rsegs, p["root"])
    bark_highlight(d, rsegs, _lift(p["root"], 18))
    invite_roots(d, gd, p, token_id, x0, gy, links)
    fw = trunk_w * 0.9
    d.polygon([(x0 - fw, gy + 4 * S), (x0 - trunk_w * 0.45, gy - trunk_w * 0.6), (x0 + trunk_w * 0.45, gy - trunk_w * 0.6), (x0 + fw, gy + 4 * S)], fill=p["bark"])
    draw_segs(d, segs, p["bark"])
    bark_highlight(d, segs, _lift(p["bark"], 26))
    if rarity == "Legendary":   # luminous bark
        draw_segs(gd, [sg for sg in segs if sg[5] <= 3], p["lum"], scale=1 / S, wmul=0.32)

    fs = max(k, 0.75) * m
    foliage(d, p, knots + tips, gs, rarity, scale=fs * 1.05)
    if rarity != "Common":
        accent_leaves(d, p, tips, rng, stage, scale=fs, gy=gy, x0=x0, prob=0.35 + 0.15 * stage)
    if stage >= 2:
        blossoms(d, p, tips, stage, scale=fs)

    cxw, cyw, bww = cx / S, cy / S, bw / S
    if rarity in ("Rare", "Legendary"):
        frng = random.Random(token_id * 4243)
        n = 22 + 8 * stage
        particles(gd, frng, (cxw - bww / 2 - 80, min(ys) / S - 70, cxw + bww / 2 + 80, gy / S - 6), n, p["fly"], 2.0, 3.6)
    if rarity == "Legendary":
        mrng = random.Random(token_id * 9091)
        particles(gd, mrng, (cxw - bww / 2 - 40, 30, cxw + bww / 2 + 40, gy / S), 14 + 4 * stage, p["accent"], 1.0, 2.0)

    mint_glyph(d, p, mint_type, gy)
    img = img.resize((W, W), Image.LANCZOS)
    img = add_glow(img, glow, k_tight=0.8 if rarity in ("Rare", "Legendary") else 0.7)
    return finish(img, token_id * 10 + stage)

# ---------------------------------------------------------------- mythic
def render_world_tree(token_id, stage, mint_type, links):
    p = WORLD
    rng = random.Random(token_id * 7919 + 1)
    gy = int(CW * 0.60)
    x0 = CW / 2
    g = 0.82 + 0.09 * (stage - 1)                # growth factor: stage 1 already a great tree
    trunk_w = 62 * S * g
    trunk_h = 165 * S * g
    base_code = 99991 * 1000003

    # roots spread across the whole ground
    rsegs, rtips = [], []
    nroots = 11
    for k in range(nroots):
        t = k / (nroots - 1)
        a = 0.24 + t * (math.pi - 0.48)
        ln = (150 + 60 * (1 - abs(t - 0.5) * 2)) * S * g + 120 * S * abs(t - 0.5) * 2
        grow(base_code + 500 + k, x0 + (t - 0.5) * trunk_w * 1.6, gy + 12 * S, a, ln, trunk_w * 0.30,
             5 + (stage >= 3), False, rsegs, rtips, spread=0.6)
    r = random.Random(base_code)
    top_y = gy - trunk_h
    body = []
    for i in range(21):
        tt = i / 20
        wv = trunk_w * (0.5 + 0.8 * (1 - tt) ** 3) + math.sin(tt * 9) * 3 * S
        body.append((x0 - wv + math.sin(tt * 4) * 6 * S, gy + 6 * S - (trunk_h + 6 * S) * tt))
    for i in range(20, -1, -1):
        tt = i / 20
        wv = trunk_w * (0.5 + 0.8 * (1 - tt) ** 3) + math.cos(tt * 7) * 3 * S
        body.append((x0 + wv + math.sin(tt * 4) * 6 * S, gy + 6 * S - (trunk_h + 6 * S) * tt))
    segs, tips, knots = [], [], []
    nlimbs = 7
    for k in range(nlimbs):
        t = k / (nlimbs - 1)
        a = -math.pi + 0.30 + t * (math.pi - 0.60) + r.uniform(-0.08, 0.08)
        ln = (100 + 60 * math.sin(t * math.pi)) * S * g
        grow(base_code + k + 1, x0 + (t - 0.5) * trunk_w * 0.7, top_y + 14 * S, a, ln, trunk_w * 0.40,
             5 + (stage >= 3), True, segs, tips, spread=0.62, knots=knots)
    for k in range(3):   # inner canopy so the crown reads as one great dome
        a = -math.pi / 2 + (k - 1) * 0.42
        grow(base_code + 77 + k, x0 + (k - 1) * trunk_w * 0.3, top_y + 10 * S, a, 90 * S * g, trunk_w * 0.3,
             4 + (stage >= 3), True, segs, tips, spread=0.6, knots=knots)
    min_y = min(tt[1] for tt in tips) - 55 * S
    min_x = min(tt[0] for tt in tips) - 55 * S; max_x = max(tt[0] for tt in tips) + 55 * S
    k = 1.0
    if min_y < 30 * S: k = min(k, (top_y - 30 * S) / (top_y - min_y))
    if min_x < 0: k = min(k, x0 / (x0 - min_x))
    if max_x > CW: k = min(k, (CW - x0) / (max_x - x0))
    if k < 1.0:
        segs, tips = _transform(segs, tips, x0, top_y, k)
        knots = _tpts(knots, x0, top_y, k)
    xs = [t[0] for t in tips]; ys = [t[1] for t in tips]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2

    img, d = base_scene(p, rng, gy, horizon=p["horizon"], stars=170)
    # great pale disc rising behind the crown, then a warm aura - both behind the tree
    img, d = radial_cw(img, cx, cy - 20 * S, 250 * S, (70, 80, 78), 1.0)
    img, d = radial_cw(img, cx, cy, 460 * S, p["aura"], 0.22, squash=0.75)
    grass(d, p, rng, gy, n=35)
    glow = Image.new("RGB", (W, W), (0, 0, 0)); gd = ImageDraw.Draw(glow)

    draw_segs(d, rsegs, p["root"])
    bark_highlight(d, rsegs, _lift(p["root"], 22))
    invite_roots(d, gd, p, token_id, x0, gy, links, thick=1.4)
    draw_segs(d, segs, p["bark"])
    d.polygon(body, fill=p["bark"])
    for j in range(9):   # bark grooves
        xx = x0 + (j - 4) * trunk_w * 0.17
        pts = [(xx + math.sin(tt * 6 + j) * 5 * S, gy - trunk_h * tt) for tt in np.linspace(0.02, 0.97, 14)]
        d.line(pts, fill=_lift(p["bark"], -24 if j % 2 else 16), width=int(3 * S))
    bark_highlight(d, segs, _lift(p["bark"], 30))
    # faint warm rim light on trunk and great limbs only
    draw_segs(gd, [sg for sg in segs if sg[5] <= 1], _lift((0, 0, 0), 0) if False else (120, 100, 70), scale=1 / S, wmul=0.3)
    gd.line([(a / S, b / S) for a, b in body], fill=(110, 90, 60), width=2)

    foliage(d, p, knots + tips, 1 + stage, "Mythic", scale=1.3 * max(k, 0.7))
    accent_leaves(d, p, tips, rng, stage, scale=1.15, gy=gy, x0=x0, prob=0.1)
    if stage >= 2:
        blossoms(d, p, tips[::3], stage, scale=1.1)

    frng = random.Random(token_id * 4243 + 9)
    particles(gd, frng, (20, 30, W - 20, gy / S - 4), 90 + 10 * stage, p["fly"], 1.8, 3.4)
    particles(gd, frng, (20, gy / S + 14, W - 20, W - 20), 26, (120, 110, 80), 1.0, 2.0)  # spores in the soil
    mint_glyph(d, p, mint_type, gy)
    img = img.resize((W, W), Image.LANCZOS)
    img = add_glow(img, glow, wide=18, tight=4)
    return finish(img, token_id * 10 + stage + 5)

# ---------------------------------------------------------------- placeholder
def placeholder():
    p = dict(bg1=(12,12,20), bg2=(30,32,46), soil=(34,30,32), ground=(22,20,24), root=(120,110,110),
             leaf=[(150,170,140)], glow=(230,210,170), accent=(200,200,200))
    rng = random.Random(424242)
    gy = int(CW * 0.64)
    img, d = base_scene(p, rng, gy)
    grass(d, p, rng, gy, n=40)
    glow = Image.new("RGB", (W, W), (0, 0, 0)); gd = ImageDraw.Draw(glow)
    x0 = CW / 2
    stem = (150, 172, 138)
    # sprout curling into a question-mark hook
    R = 60 * S
    hx, hy = x0, gy - 215 * S        # hook centre
    pts = []
    for i in range(37):              # from lower-left, over the top, round to lower-right
        t = i / 36
        a = math.pi * 0.92 + t * math.pi * 1.36
        pts.append((hx + math.cos(a) * R, hy + math.sin(a) * R))
    ex, ey = pts[-1]
    ta = math.pi * 2.28
    tx, ty = -math.sin(ta), math.cos(ta)          # tangent at the end of the arc
    p1 = (ex + tx * R * 0.55, ey + ty * R * 0.55)
    p2 = (x0, hy + R * 1.55)
    for i in range(1, 13):           # smooth bend into the centre line
        t = i / 12
        pts.append(((1-t)**2*ex + 2*(1-t)*t*p1[0] + t*t*p2[0], (1-t)**2*ey + 2*(1-t)*t*p1[1] + t*t*p2[1]))
    for i in range(1, 9):            # then straight down to the soil
        t = i / 8
        pts.append((x0, p2[1] + (gy - 4 * S - p2[1]) * t))
    w0 = 22 * S
    for i in range(len(pts) - 1):
        ww = int(w0 * (0.62 + 0.38 * i / (len(pts) - 1)))
        d.line([pts[i], pts[i + 1]], fill=stem, width=ww)
        d.ellipse([pts[i + 1][0] - ww / 2, pts[i + 1][1] - ww / 2, pts[i + 1][0] + ww / 2, pts[i + 1][1] + ww / 2], fill=stem)
    d.ellipse([pts[0][0] - w0 * 0.3, pts[0][1] - w0 * 0.3, pts[0][0] + w0 * 0.3, pts[0][1] + w0 * 0.3], fill=stem)
    # one small leaf at the hook tip and one on the neck
    leaf_shape(d, pts[0][0], pts[0][1], math.pi * 0.9, 48 * S, 22 * S, (170, 196, 150), (110, 130, 100))
    nx, ny = pts[-4]
    leaf_shape(d, nx, ny, -0.4, 54 * S, 24 * S, (140, 165, 128), (95, 115, 90))
    # the seed below ground = the dot of the "?"
    sx, sy = x0, gy + 120 * S
    d.ellipse([sx - 30 * S, sy - 40 * S, sx + 30 * S, sy + 40 * S], fill=(120, 92, 66))
    d.ellipse([sx - 22 * S, sy - 32 * S, sx + 8 * S, sy + 4 * S], fill=(150, 116, 82))
    gd.ellipse([sx / S - 36, sy / S - 44, sx / S + 36, sy / S + 44], fill=(150, 120, 80))
    # faint unformed root hairs from the seed
    rs, rt = [], []
    for k in range(3):
        grow(777 + k, sx + (k - 1) * 8 * S, sy + 36 * S, math.pi / 2 + (k - 1) * 0.6, 34 * S, 3 * S, 3, False, rs, rt)
    draw_segs(d, rs, (96, 82, 72))
    img = img.resize((W, W), Image.LANCZOS)
    img = radial(img, W / 2, (gy / S) - 120, 220, (40, 40, 60), 0.6)
    img = add_glow(img, glow, wide=22, tight=6, k_wide=0.8, k_tight=0.4)
    return finish(img, 1)


# ---------------------------------------------------------------- publish
def render_png(token_id, rarity, stage, mint_type, invites=None, colors=96):
    """512px, palette-quantized image for publishing."""
    img = render(token_id, rarity, stage, mint_type, invites).resize((OUT, OUT), Image.LANCZOS)
    return img.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
