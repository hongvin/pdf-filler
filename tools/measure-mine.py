"""Measure the stamp and signature in the app's own output and compare with the
reference numbers from tools/measure-ref.py."""

import pymupdf

REF = {
    'stamp_radius': 51.9,
    'stamp_centre_x': 380.4,
    'sig_width': 138.6,
    'sig_x0': 157.1,
}

doc = pymupdf.open('/Users/hongvin/workbuddy-ai/pdf-filler/tools/demo-filled.pdf')
page = doc[1]

# ---- stamp: the two circles we drew ---------------------------------------
# pdf-lib emits a circle as four bezier quarters, so the *item* bboxes are only
# quarter-circles. `drawing['rect']` is the bbox of the whole path — use that.
shapes = []
for d in page.get_drawings():
    r = d['rect']
    if r.width > 20 and abs(r.width - r.height) < 1.5:
        shapes.append((r.width / 2, (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2))

shapes.sort(reverse=True)
if shapes:
    r, cx, cy = shapes[0]
    print(f"MY stamp: radius {r:.1f}pt (ref {REF['stamp_radius']}), "
          f"centre x {cx:.1f} (ref {REF['stamp_centre_x']})")
    if len(shapes) > 1:
        print(f"          inner radius {shapes[1][0]:.1f}pt "
              f"= {shapes[1][0]/r:.3f} of outer (ref ratio 0.79)")

# ---- signature: the cursive run -------------------------------------------
best = None
for b in page.get_text('dict')['blocks']:
    if b['type'] != 0:
        continue
    for l in b['lines']:
        for s in l['spans']:
            if 'HongVin' in s['text']:
                w = s['bbox'][2] - s['bbox'][0]
                if best is None or w > best[0]:
                    best = (w, s['bbox'][0], s['size'])
if best:
    print(f"MY signature: width {best[0]:.1f}pt (ref {REF['sig_width']}), "
          f"x0 {best[1]:.1f} (ref {REF['sig_x0']}), font size {best[2]:.1f}")
