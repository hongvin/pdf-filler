"""Measure the reference screenshot so the stamp/signature can be matched by
ratio rather than by eye. Prints everything in page points, derived from the
known 16.5pt line pitch of the form."""

from PIL import Image

REF = '/Users/hongvin/Pictures/Screenshot 2026-09-18 at 20-39-10.png'
im = Image.open(REF).convert('L')
W, H = im.size
px = im.load()
print('screenshot px:', W, 'x', H)

DARK = 128
def is_dark(x, y):
    return px[x, y] < DARK

# ---- 1. dotted-line rows give us the px-per-point scale -------------------
# The dotted leaders live on the right of the label column.
def row_counts(x0, x1):
    out = []
    for y in range(H):
        c = 0
        for x in range(x0, x1):
            if is_dark(x, y):
                c += 1
        out.append(c)
    return out

counts = row_counts(int(W * 0.30), int(W * 0.62))
rows = [y for y, c in enumerate(counts) if c > (0.62 - 0.30) * W * 0.12]
# group adjacent rows into lines
groups = []
for y in rows:
    if groups and y - groups[-1][-1] <= 3:
        groups[-1].append(y)
    else:
        groups.append([y])
centres = [sum(g) / len(g) for g in groups]
print('dotted-line rows (px):', [round(c, 1) for c in centres])
if len(centres) >= 2:
    pitches = [round(centres[i + 1] - centres[i], 2) for i in range(len(centres) - 1)]
    print('pitches (px):', pitches, '-> nominal 16.5pt each')
    pitch = sorted(pitches)[len(pitches) // 2]
    PX_PER_PT = pitch / 16.5
    print(f'PX_PER_PT = {PX_PER_PT:.4f}')
else:
    raise SystemExit('could not find the dotted lines')

# ---- 2. stamp geometry ----------------------------------------------------
# Columns through the ring's left/right edges hold the most dark pixels.
def col_counts(x0, x1, y0, y1):
    out = []
    for x in range(x0, x1):
        c = 0
        for y in range(y0, y1):
            if is_dark(x, y):
                c += 1
        out.append((x, c))
    return out

# Stamp lives in the right part of the screenshot, below the top edge.
sx0, sx1 = int(W * 0.55), W
prof = col_counts(sx0, sx1, 0, H)
peak = max(c for _, c in prof)
strong = [x for x, c in prof if c > peak * 0.55]
if strong:
    left, right = min(strong), max(strong)
    print(f'stamp ring columns: {left}..{right} -> diameter {right-left}px '
          f'= {(right-left)/PX_PER_PT:.1f}pt, radius {(right-left)/2/PX_PER_PT:.1f}pt')

# Vertical extent at the stamp's centre column.
cx = (left + right) // 2 if strong else sx0
ys = [y for y in range(H) if is_dark(cx, y)]
if ys:
    print(f'stamp vertical extent at x={cx}: {min(ys)}..{max(ys)} '
          f'= {(max(ys)-min(ys))/PX_PER_PT:.1f}pt')

# ---- 3. signature geometry ------------------------------------------------
# Signature sits above the first dotted line, but its descender drops past it,
# so the band has to run down to just short of the "Koay Hong Vin" line.
y_bot = 100
band_x0, band_x1 = int(W * 0.20), int(W * 0.58)
xs, ys2 = [], []
for x in range(band_x0, band_x1):
    for y in range(0, y_bot):
        if is_dark(x, y):
            xs.append(x); ys2.append(y)
if xs:
    print(f'signature bbox px: x {min(xs)}..{max(xs)} y {min(ys2)}..{max(ys2)}')
    print(f'  width {(max(xs)-min(xs))/PX_PER_PT:.1f}pt, '
          f'height {(max(ys2)-min(ys2))/PX_PER_PT:.1f}pt')

# ---- 4. anchor: the page's left text margin -------------------------------
# "Yang benar," / the label column start at page x = 33.75.
leftmost = W
for y in range(H):
    for x in range(0, int(W * 0.2)):
        if is_dark(x, y):
            leftmost = min(leftmost, x)
            break
print(f'page text left margin at px x={leftmost}  (page x = 33.75)')

def to_page(px_x):
    return 33.75 + (px_x - leftmost) / PX_PER_PT

print(f'stamp centre  -> page x {to_page(cx):.1f}  (blank centre is 309.3)')
if xs:
    print(f'signature     -> page x {to_page(min(xs)):.1f} .. {to_page(max(xs)):.1f} '
          f'(blank starts at 141.3)')


