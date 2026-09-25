"""
STAKE-OUT V12 -- one-off asset prep for the new player-screen UI layers.

WHAT THIS DOES, IN PLAIN ENGLISH
--------------------------------
The V12 art arrives as separate transparent PNGs in reference/UI_scaled_up
(which is git-ignored, like the rest of reference/). They were each scaled up
on their own, so stacked as-is they do NOT line up: the play screen comes out
~1.2x too big and runs over the bezel and the left D-pad, the pads miss their
holes in the bezel, and the logo lands on top of the panels.

So this script:
  1. REGISTERS each layer onto the concept master ("updated ui_resized_concept
     _master.png") with the scale + offset found by a best-fit search. The
     numbers are in FITS below; re-run the fit if the art is re-exported.
  2. CLEANS a copy of the play screen. The play screen has the moving parts
     painted into it -- the white point dot, the bubble parked at centre, the
     green 888.888 readouts, the grey timestamp ghost and all four direction
     triangles lit. Those have to go from the static base so the game can
     draw the live versions on top. Each one is painted out by copying the
     surrounding art over it (a mirror, a row or a column clone), never by
     drawing new art.
  3. SLICES the moving parts into sprites: the four triangles, the D-pads and
     MEASURE buttons, the two logos, the bubble, the point glow and the LCD
     digits.
  4. Writes everything to assets/img/v12/ as PNG plus a WebP copy, and prints
     the placement numbers that css/styles.css and js/ui-skin.js use.

Nothing in reference/ is modified. Needs Pillow, numpy and scipy:
    python -m pip install pillow numpy scipy
    python tools/prep_v12_layers.py
"""
import os
import numpy as np
from PIL import Image
from scipy import ndimage as nd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'reference', 'UI_scaled_up')
OUT = os.path.join(ROOT, 'assets', 'img', 'v12')
os.makedirs(OUT, exist_ok=True)

# ---- the stage frame --------------------------------------------------------
# Everything is laid out in "master pixels": the 1920x1080 concept master. The
# instrument itself only occupies y 62..1005 of that, so the stage crops the
# empty black above and below and is 1920 x 960 (exactly 2:1). That crop is a
# big part of the mobile-landscape win: a 2:1 box fills far more of a ~2.2:1
# phone screen than the old 3:2 one did.
FRAME_Y0, FRAME_W, FRAME_H = 52, 1920, 960

# ---- registration: (file, scale, x offset, y offset) onto the master ---------
FITS = {
    'bezel':  ('updated_bezel.png',     0.984, 15, 12),
    'screen': ('playscreen_scaled.png', 0.828, 173, 60),
    'dpad':   ('dpad_scaled_up.png',    0.980, 19, -56),
}
# The logo layer's two logos are scaled differently from each other, so no
# single fit exists; each is cut out and fitted on its own.
LOGOS = {
    'logo_top':    ((623, 44, 1331, 182), 0.66, 737, 80),
    'logo_bottom': ((687, 895, 1280, 1026), 0.72, 745, 854),
}


def load(name):
    return Image.open(os.path.join(SRC, name)).convert('RGBA')


def registered(key):
    f, s, tx, ty = FITS[key]
    layer = load(f).resize((round(1920 * s), round(1080 * s)), Image.LANCZOS)
    canvas = Image.new('RGBA', (1920, 1080), (0, 0, 0, 0))
    canvas.paste(layer, (tx, ty))
    return canvas


def snap_alpha(arr):
    """The layers' 'solid' pixels are alpha 251-253, never 255, so they are
    about 1% see-through. Harmless on black, but two stacked copies of the
    same art (the base and a dimmable panel on top of it) would compound it,
    so near-opaque is snapped to fully opaque. Soft edges are left alone."""
    a = arr[:, :, 3]
    a[a >= 245] = 255
    return arr


def save(img, name):
    img.save(os.path.join(OUT, name + '.png'), optimize=True)
    img.save(os.path.join(OUT, name + '.webp'), quality=90, method=6)


def pct(x0, y0, w, h):
    """Master-pixel box -> CSS percentages of the 1920x960 stage frame."""
    return ('left: %.3f%%; top: %.3f%%; width: %.3f%%; height: %.3f%%;' %
            (x0 / FRAME_W * 100, (y0 - FRAME_Y0) / FRAME_H * 100,
             w / FRAME_W * 100, h / FRAME_H * 100))


report = []


def note(line):
    report.append(line)
    print(line)


# ============================================================================
# 1. BEZEL -- straight registration, cropped to the stage frame
# ============================================================================
bezel = np.array(registered('bezel'))
bezel = snap_alpha(bezel)
save(Image.fromarray(bezel).crop((0, FRAME_Y0, FRAME_W, FRAME_Y0 + FRAME_H)), 'bezel')
note('bezel      : full frame')

# ============================================================================
# 2. PLAY SCREEN -- register, then paint out every baked-in moving part
# ============================================================================
scr = snap_alpha(np.array(registered('screen')))
work = scr.astype(np.float32)
R, G, B, A = [scr[:, :, i].astype(int) for i in range(4)]

# ---- measured geometry (master px) -----------------------------------------
# Both come from an ellipse fit to the painted rings (sampled every 2 degrees,
# skipping the axes where the crosshair and index bars get in the way).
#
# The art is very slightly squashed -- the rings fit rx:ry of about 1.045:1,
# presumably from the concept master being resized to 16:9 -- so each radius
# below is the mean of the two. That is under 7px of error at the rim, and it
# keeps the gauges true circles, which is what the engine draws and steers in.
#
# Position dial: the grey outer ring. The engine calls this r (POS_GAUGE.r).
DIAL_CX, DIAL_CY, DIAL_R = 698.0, 475.0, 174.0
# Bubble vial: the outer edge of the green glass. Again the engine's r
# (BUBBLE_GAUGE.r) -- the bubble can travel out to exactly here.
VIAL_CX, VIAL_CY, VIAL_R = 1233.0, 475.0, 157.5

lum = (R + G + B) / 3.0
note('dial       : centre (%.1f, %.1f)  r %.1f' % (DIAL_CX, DIAL_CY, DIAL_R))
note('vial       : centre (%.1f, %.1f)  r %.1f' % (VIAL_CX, VIAL_CY, VIAL_R))

# ---- (a) the white point dot: mirror the dial across its vertical axis -----
# The dial face is left/right symmetric apart from the dot, so the pixels at
# the mirror position are exactly what belongs under it.
dot_cx, dot_cy, dot_r = 788, 537, 14
for y in range(dot_cy - dot_r, dot_cy + dot_r + 1):
    for x in range(dot_cx - dot_r, dot_cx + dot_r + 1):
        if (x - dot_cx) ** 2 + (y - dot_cy) ** 2 <= dot_r ** 2:
            mx = int(round(2 * DIAL_CX - x))
            work[y, x] = work[y, mx]

# ---- (b) the bubble parked at the vial centre -------------------------------
# Under it is plain vial glass with the crosshair running through. Rebuild
# that: every masked pixel takes the glass from above/below the bubble (which
# carries the vertical crosshair line straight through), except the rows on
# the horizontal line, which take it from left/right instead.
#
# The bubble sits snugly inside the white centring ring (inner edge ~r47), so
# there is no clean glass between the two. The samples are taken from OUTSIDE
# the ring, at 62px out, where the glass is the same flat dark green.
BUB_MASK_R = 46
SRC_OFF = 62
yy, xx = np.mgrid[0:1080, 0:1920]
bmask = (xx - VIAL_CX) ** 2 + (yy - VIAL_CY) ** 2 <= BUB_MASK_R ** 2
top_src, bot_src = int(VIAL_CY - SRC_OFF), int(VIAL_CY + SRC_OFF)
lft_src, rgt_src = int(VIAL_CX - SRC_OFF), int(VIAL_CX + SRC_OFF)
# where exactly the horizontal crosshair line runs, read off the glass beside it
col = lum[int(VIAL_CY) - 12:int(VIAL_CY) + 13, lft_src]
hline = [int(VIAL_CY) - 12 + i for i, v in enumerate(col) if v > col.max() * 0.55]
before = work.copy()
for y in range(int(VIAL_CY - BUB_MASK_R), int(VIAL_CY + BUB_MASK_R) + 1):
    for x in range(int(VIAL_CX - BUB_MASK_R), int(VIAL_CX + BUB_MASK_R) + 1):
        if not bmask[y, x]:
            continue
        if y in hline:
            t = (x - lft_src) / (rgt_src - lft_src)
            work[y, x] = before[y, lft_src] * (1 - t) + before[y, rgt_src] * t
        else:
            # the glass is darkest at the centre and the samples sit out in
            # the lighter band, so blend toward the darkest glass sample
            t = (y - top_src) / (bot_src - top_src)
            work[y, x] = before[top_src, x] * (1 - t) + before[bot_src, x] * t
note('bubble     : painted out, r=%d, crosshair rows %s' % (BUB_MASK_R, hline))


# ---- (c) the baked LCD digits -------------------------------------------------
def row_clone_fill(x0, y0, x1, y1, src_x):
    """Fill a box with the column at src_x, row by row. For flat, horizontally
    uniform backgrounds like an LCD window this is invisible."""
    for y in range(y0, y1):
        work[y, x0:x1] = before2[y, src_x]


before2 = work.copy()
LCD_BOXES = {
    # name: (x0, y0, x1, y1) of the baked digits, padded, and a clean column
    'lr': (476, 716, 716, 787, 470),
    'ta': (807, 716, 1051, 787, 801),
    'ts': (1140, 716, 1474, 790, 1136),
}
for name, (x0, y0, x1, y1, sx) in LCD_BOXES.items():
    row_clone_fill(x0, y0, x1, y1, sx)
    note('lcd %-6s : digits painted out  box x %d..%d  y %d..%d' % (name, x0, x1, y0, y1))

# ---- (c2) V12.5a: swap the LEFT/RIGHT and TO/AWAY labels ---------------------
# Real data collectors put TO/AWAY on the left, nearest the up/down triangles,
# and the art has them the other way round. The values are moved by swapping
# two CSS boxes; the LABELS are painted into the art, so they are swapped here:
# each label's pixels are lifted out, both label bands are wiped with the flat
# panel behind them, and each is pasted back centred in the other box.
LABEL_BOX = {          # interior of each readout box, measured off the art
    'lr': (452, 773),
    'ta': (788, 1112),
}
LABEL_TEXT = {         # the label's own pixels
    'lr': (526, 674, 690, 702),
    'ta': (875, 674, 1015, 702),
}
lifted = {}
for name, (tx0, ty0, tx1, ty1) in LABEL_TEXT.items():
    lifted[name] = work[ty0:ty1, tx0:tx1].copy()
before_lab = work.copy()
for name in LABEL_TEXT:
    bx0, bx1 = LABEL_BOX[name]
    tx0, ty0, tx1, ty1 = LABEL_TEXT[name]
    for y in range(ty0, ty1):
        work[y, bx0 + 4:bx1 - 4] = before_lab[y, bx0 + 6]
for name, other in (('lr', 'ta'), ('ta', 'lr')):
    bx0, bx1 = LABEL_BOX[name]
    art = lifted[other]
    tx0, ty0, tx1, ty1 = LABEL_TEXT[other]
    px = int((bx0 + bx1) / 2 - art.shape[1] / 2)
    work[ty0:ty1, px:px + art.shape[1]] = art
    note('label swap : %s box now carries the %s label at x %d' % (name, other, px))

# ---- (d) the four triangles ---------------------------------------------------
# Each is cut out as a sprite (so the game can light it or leave it dark) and
# then painted out of the base. Up/down sit on horizontal structure (the dial
# rim, the readout-box border), so they are filled from beside themselves;
# left/right from above and below.
TRIS = {
    'up':    (672, 274, 728, 308),
    'down':  (670, 638, 727, 671),
    'left':  (473, 446, 514, 506),
    'right': (883, 445, 925, 506),
}
yel = (R > 170) & (G > 130) & (B < 110) & (A > 150)
before3 = work.copy()
tri_meta = {}
for name, (x0, y0, x1, y1) in TRIS.items():
    pad = 4
    bx0, by0, bx1, by1 = x0 - pad, y0 - pad, x1 + pad, y1 + pad
    m = np.zeros_like(yel)
    m[by0:by1, bx0:bx1] = yel[by0:by1, bx0:bx1]
    # keep only the triangle itself, not the readout border it touches
    lab, n = nd.label(m)
    sizes = nd.sum(m, lab, range(1, n + 1))
    keep = lab == (int(np.argmax(sizes)) + 1)
    if name == 'down':
        keep[665:, :] &= False  # the readout-box border starts at y=662
        keep |= (lab == (int(np.argmax(sizes)) + 1)) & (yy < 671) & \
                (np.abs(xx - (x0 + x1) / 2) < (671 - yy) * 0.9 + 2)
    soft = nd.binary_dilation(keep, iterations=2)
    # sprite: the art's own pixels, alpha from a feathered mask
    feather = nd.gaussian_filter(soft.astype(np.float32), 0.8)
    sprite = scr[by0:by1, bx0:bx1].copy()
    sprite[:, :, 3] = (feather[by0:by1, bx0:bx1] * 255).clip(0, 255).astype(np.uint8)
    save(Image.fromarray(sprite), 'tri_' + name)
    tri_meta[name] = (bx0, by0, bx1 - bx0, by1 - by0)
    # paint it out of the base
    fill = nd.binary_dilation(keep, iterations=4)
    ys, xs = np.where(fill)
    for y, x in zip(ys, xs):
        if name in ('up', 'down'):
            off = (bx1 - bx0) + 6
            src = x - off if x < (x0 + x1) / 2 else x + off
            work[y, x] = before3[y, src]
        else:
            off = (by1 - by0) + 6
            src = y - off if y < (y0 + y1) / 2 else y + off
            work[y, x] = before3[src, x]
    note('triangle %-5s: sprite box %s' % (name, tri_meta[name]))

screen_clean = work.clip(0, 255).astype(np.uint8)
save(Image.fromarray(screen_clean).crop((0, FRAME_Y0, FRAME_W, FRAME_Y0 + FRAME_H)), 'screen')

# ---- dimmable gauge faces ----------------------------------------------------
# The dial face and the vial are cut out again as circles and laid exactly on
# top of the base, so the game can grey out one gauge (a CSS filter on that
# layer) without greying the panel title or anything else around it.
def disc(cx, cy, r, name):
    x0, y0 = int(cx - r), int(cy - r)
    x1, y1 = int(cx + r) + 1, int(cy + r) + 1
    face = screen_clean[y0:y1, x0:x1].copy()
    my, mx = np.mgrid[y0:y1, x0:x1]
    d = np.sqrt((mx - cx) ** 2 + (my - cy) ** 2)
    face[:, :, 3] = (np.clip(r - d, 0, 1.5) / 1.5 * face[:, :, 3]).astype(np.uint8)
    save(Image.fromarray(face), name)
    note('%-10s : %s' % (name, pct(x0, y0, x1 - x0, y1 - y0)))
    return (x0, y0, x1 - x0, y1 - y0)


disc(DIAL_CX, DIAL_CY, DIAL_R + 12, 'dial_face')
disc(VIAL_CX, VIAL_CY, VIAL_R + 44, 'vial_face')

# ============================================================================
# 3. D-PADS + MEASURE -- register, then split into four pieces
# ============================================================================
dp = snap_alpha(np.array(registered('dpad')))
# Each side is one blob (the pad's soft shadow touches the button's), so the
# pad and the MEASURE button are split at the thinnest row between them.
lab, n = nd.label(dp[:, :, 3] > 24)
sides = []
for i, o in enumerate(nd.find_objects(lab)):
    if (lab[o] == i + 1).sum() > 5000:
        sides.append((o[1].start, o[0].start, o[1].stop, o[0].stop))
sides.sort()
pieces = []
for (x0, y0, x1, y1) in sides:
    solid = (dp[y0:y1, x0:x1, 3] > 128).sum(1)
    h = y1 - y0
    cut = y0 + int(h * 0.55) + int(np.argmin(solid[int(h * 0.55):int(h * 0.85)]))
    for (a0, a1) in ((y0, cut), (cut, y1)):
        cols = np.where((dp[a0:a1, x0:x1, 3] > 24).any(0))[0]
        rows = np.where((dp[a0:a1, x0:x1, 3] > 24).any(1))[0]
        pieces.append((x0 + cols[0], a0 + rows[0], x0 + cols[-1] + 1, a0 + rows[-1] + 1))
names = ['pad_l', 'meas_l', 'pad_r', 'meas_r']
for name, (x0, y0, x1, y1) in zip(names, pieces):
    x0, y0, x1, y1 = x0 - 2, y0 - 2, x1 + 2, y1 + 2
    save(Image.fromarray(dp[y0:y1, x0:x1]), name)
    note('%-10s : box (%d,%d)-(%d,%d)  %s' % (name, x0, y0, x1, y1, pct(x0, y0, x1 - x0, y1 - y0)))

# ============================================================================
# 4. LOGOS
# ============================================================================
brand = load('TotalStationTech_Branding_Layer_1920x1080.png')
for name, (box, s, x, y) in LOGOS.items():
    c = brand.crop(box)
    c = c.resize((round(c.width * s), round(c.height * s)), Image.LANCZOS)
    save(c, name)
    note('%-10s : %s' % (name, pct(x, y, c.width, c.height)))

# ============================================================================
# 5. SPRITES -- bubble, point glow, LCD digits, timestamp ghost
# ============================================================================
def crop_alpha(img, thresh=6):
    a = np.array(img)[:, :, 3]
    return img.crop(Image.fromarray(((a > thresh) * 255).astype(np.uint8)).getbbox())


bub = crop_alpha(load('neon_bubble.png'))
bub = bub.resize((160, round(160 * bub.height / bub.width)), Image.LANCZOS)
save(bub, 'bubble')
note('bubble     : %dx%d sprite' % bub.size)

glow = crop_alpha(load('point_glow.png'), 2)
glow = glow.resize((256, round(256 * glow.height / glow.width)), Image.LANCZOS)
save(glow, 'point_glow')
note('point_glow : %dx%d sprite' % glow.size)

# digits_1.png: three rows (green / yellow / red) of 0-9. Each glyph is found
# by its alpha footprint and packed into an even-celled strip.
CELL_W, CELL_H = 96, 132
sheet = load('digits_1.png')
sa = np.array(sheet)[:, :, 3] > 40
rows = nd.find_objects(nd.label(nd.binary_dilation(sa.any(1)[:, None].repeat(4, 1), iterations=8)[:, 0:1])[0])
row_boxes = [(r[0].start, r[0].stop) for r in rows if r[0].stop - r[0].start > 80]
atlas = Image.new('RGBA', (CELL_W * 11, CELL_H * 3), (0, 0, 0, 0))
glyph_h = max(y1 - y0 for y0, y1 in row_boxes)
for ri, (y0, y1) in enumerate(row_boxes[:3]):
    band = sa[y0:y1]
    lab, n = nd.label(nd.binary_dilation(band.any(0)[None, :].repeat(3, 0), iterations=3)[1:2])
    cols = [(o[1].start, o[1].stop) for o in nd.find_objects(lab)]
    cols = [c for c in cols if c[1] - c[0] > 20][:10]
    for di, (cx0, cx1) in enumerate(cols):
        g = sheet.crop((cx0, y0, cx1, y1))
        # every glyph is scaled by the SAME factor so a '1' stays narrow
        k = (CELL_H - 16) / glyph_h
        g = g.resize((max(1, round(g.width * k)), max(1, round(g.height * k))), Image.LANCZOS)
        # right-align inside the cell, like a real seven-segment '1'
        atlas.paste(g, (di * CELL_W + CELL_W - g.width - 4, ri * CELL_H + 8), g)
    note('digits row %d: %d glyphs' % (ri, len(cols)))

# The decimal point: none in digits_1, so it comes from lcd_readouts.png, where
# the green 888.888 carries one. Found as the small blob low on the line.
lr = load('lcd_readouts.png')
la = np.array(lr)
g_mask = (la[:, :, 1] > 150) & (la[:, :, 0] < 140) & (la[:, :, 3] > 120)
lab, n = nd.label(g_mask)
dots = []
for i, o in enumerate(nd.find_objects(lab)):
    w, h = o[1].stop - o[1].start, o[0].stop - o[0].start
    if 6 < w < 30 and 6 < h < 30 and o[1].start < 560:
        dots.append(o)
dots.sort(key=lambda o: -o[0].start)
if dots:
    o = dots[0]
    dot = lr.crop((o[1].start - 3, o[0].start - 3, o[1].stop + 3, o[0].stop + 3))
    k = (CELL_H - 16) / 104.0  # lcd_readouts digits are ~104 px tall
    dot = dot.resize((max(1, round(dot.width * k)), max(1, round(dot.height * k))), Image.LANCZOS)
    for ri, tint in enumerate([(40, 235, 40), (255, 210, 30), (255, 50, 40)]):
        d = np.array(dot).astype(np.float32)
        lumd = d[:, :, :3].max(2, keepdims=True) / 255.0
        d[:, :, :3] = lumd * np.array(tint, np.float32)
        di = Image.fromarray(d.clip(0, 255).astype(np.uint8))
        atlas.paste(di, (10 * CELL_W + (CELL_W - di.width) // 2, ri * CELL_H + CELL_H - 8 - di.height), di)
    note('decimal pt : %dx%d' % dot.size)
save(atlas, 'lcd_digits')
note('lcd_digits : atlas %dx%d, cells %dx%d, 11 per row (0-9 then .)' % (atlas.width, atlas.height, CELL_W, CELL_H))

# The unlit timestamp ghost "88.88.88" -- the right-hand group in lcd_readouts.
grey = (np.abs(la[:, :, 0].astype(int) - la[:, :, 1]) < 20) & (la[:, :, 3] > 60) & (np.arange(la.shape[1])[None, :] > 1100)
ys, xs = np.where(grey)
ghost = lr.crop((xs.min() - 2, ys.min() - 2, xs.max() + 3, ys.max() + 3))
save(ghost, 'ts_ghost')
note('ts_ghost   : %dx%d' % ghost.size)
# glyph columns inside the ghost, so the live digits can land on them exactly
# (by brightness, not alpha: a drop shadow joins the glyphs in the alpha)
gg = np.array(ghost).astype(int)
ga = (gg[:, :, 3] > 100) & (gg[:, :, :3].mean(2) > 80)
spans = []
lab, n = nd.label(ga.any(0))
for o in nd.find_objects(lab):
    if o[0].stop - o[0].start > 3:
        spans.append((o[0].start, o[0].stop))
note('ts_ghost cols: %s' % spans)

with open(os.path.join(OUT, 'README.txt'), 'w') as fh:
    fh.write('Generated by tools/prep_v12_layers.py from reference/UI_scaled_up.\n'
             'Do not hand-edit; re-run the script instead.\n\n' + '\n'.join(report) + '\n')
print('\nwrote', OUT)
