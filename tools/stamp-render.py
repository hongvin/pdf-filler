"""
Measures the footprint the stamp actually occupies, in both modes.

Measuring on the real template does not work: the template's own printed text
sits inside the same window, so an ink bounding box there measures the template,
not the stamp. The isolated PDFs written by tools/stamp-compare.mjs carry
nothing but the stamp on a blank page, so the only ink is the stamp itself.

    python tools/stamp-render.py
"""

import fitz
from PIL import Image

ROOT = "/Users/hongvin/workbuddy-ai/pdf-filler"
DPI = 200
SCALE = DPI / 72.0
# The isolated box printed by tools/stamp-compare.mjs — a stamp blank at
# x0=100, x1=500, baseline=400, size=12 on US Letter.
EXPECTED = (336.04, 352.24, 439.96, 456.16)  # x0, y0, x1, y1 in PDF points
EXPECTED_D = 103.92
SIZE = 12.0


def rasterise(path, page_no=0):
    doc = fitz.open(path)
    page = doc[page_no]
    pix = page.get_pixmap(dpi=DPI)
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples), page.rect.height


def pdf_box_to_px(box, height_pt):
    x0, y0, x1, y1 = box
    # PDF space is y-up from the bottom; raster space is y-down from the top.
    return (int(x0 * SCALE), int((height_pt - y1) * SCALE),
            int(x1 * SCALE), int((height_pt - y0) * SCALE))


def ink_bbox(img, px_box):
    crop = img.crop(px_box).convert("L")
    # The stamp is black ink at 0.92 opacity on white paper, so even the
    # anti-aliased edge is far darker than this.
    mask = crop.point(lambda v: 255 if v < 200 else 0)
    bbox = mask.getbbox()
    if bbox is None:
        return None
    return (bbox[0] + px_box[0], bbox[1] + px_box[1],
            bbox[2] + px_box[0], bbox[3] + px_box[1])


results = {}
print("isolated stamp: expected diameter %.2f pt (%.2f em at size %.0f)\n"
      % (EXPECTED_D, EXPECTED_D / SIZE, SIZE))

for label, name in (("generated ring", "stamp-iso-generated.pdf"),
                    ("bundled artwork", "stamp-iso-image.pdf")):
    path = "%s/tools/%s" % (ROOT, name)
    img, height_pt = rasterise(path)
    # A generous window: deliberately wider than the expected box so the
    # measurement is not clipped by the thing it is measuring.
    px_box = pdf_box_to_px((EXPECTED[0] - 12, EXPECTED[1] - 12,
                            EXPECTED[2] + 12, EXPECTED[3] + 12), height_pt)
    bbox = ink_bbox(img, px_box)
    if bbox is None:
        print("%-16s nothing drawn" % label)
        continue

    w = (bbox[2] - bbox[0]) / SCALE
    h = (bbox[3] - bbox[1]) / SCALE
    # Centre, expressed back in PDF space.
    cx = (bbox[0] + bbox[2]) / 2 / SCALE
    cy = height_pt - (bbox[1] + bbox[3]) / 2 / SCALE
    results[label] = (w, h, cx, cy)
    print("%-16s ink %.2f x %.2f pt  = %.3f x %.3f em   centre (%.2f, %.2f)  "
          "err vs expected: %+.2f pt" % (label, w, h, w / SIZE, h / SIZE, cx, cy, w - EXPECTED_D))

    crop = img.crop((px_box[0] + 6, px_box[1] + 6, px_box[2] - 6, px_box[3] - 6))
    crop.save("%s/tools/stamp-crop-%s.png" % (ROOT, label.split()[0]))

if len(results) == 2:
    a, b = results["generated ring"], results["bundled artwork"]
    print("\nbetween the two modes:")
    print("  diameter  %+.2f pt (%.2f%%)" % (a[0] - b[0], 100 * (a[0] - b[0]) / a[0]))
    print("  height    %+.2f pt (%.2f%%)" % (a[1] - b[1], 100 * (a[1] - b[1]) / a[1]))
    print("  centre    dx=%+.2f pt  dy=%+.2f pt" % (a[2] - b[2], a[3] - b[3]))

    ca = Image.open("%s/tools/stamp-crop-generated.png" % ROOT)
    cb = Image.open("%s/tools/stamp-crop-bundled.png" % ROOT)
    gap = 40
    strip = Image.new("RGB", (ca.width + cb.width + gap, max(ca.height, cb.height)), "white")
    strip.paste(ca, (0, 0))
    strip.paste(cb, (ca.width + gap, 0))
    strip.save("%s/tools/stamp-side-by-side.png" % ROOT)
    print("\nwrote tools/stamp-side-by-side.png  (left: generated, right: bundled artwork)")
