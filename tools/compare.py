"""Render the app's output over exactly the same page region and at exactly the
same scale as the reference screenshot, then stack the two.

The reference crop's mapping was derived in tools/measure-ref.py:
  PX_PER_PT = 2.8788
  page x 33.75 is at px x 11
  the first dotted row (page y 784.9) is at px y 60.5
"""

import pymupdf
from PIL import Image

REF = '/Users/hongvin/Pictures/Screenshot 2026-09-18 at 20-39-10.png'
MINE = '/Users/hongvin/workbuddy-ai/pdf-filler/tools/demo-filled.pdf'

PX_PER_PT = 2.8788
ref = Image.open(REF).convert('RGB')
W, H = ref.size

# Map the reference crop back to page coordinates (PDF space, origin bottom-left).
page_x0 = 33.75 - 11 / PX_PER_PT
page_x1 = page_x0 + W / PX_PER_PT
page_y_baseline = 784.9          # Tandatangan blank baseline
page_y_top = page_y_baseline + 60.5 / PX_PER_PT
page_y_bottom = page_y_baseline - (H - 60.5) / PX_PER_PT

doc = pymupdf.open(MINE)
page = doc[1]
ph = page.rect.height
# pymupdf clips use a top-left origin, so flip.
clip = pymupdf.Rect(page_x0, ph - page_y_top, page_x1, ph - page_y_bottom)
page.get_pixmap(clip=clip, matrix=pymupdf.Matrix(PX_PER_PT, PX_PER_PT)).save('/tmp/mine-scaled.png')

mine = Image.open('/tmp/mine-scaled.png').convert('RGB')
print('reference', ref.size, '-> mine', mine.size)

w = max(ref.width, mine.width)
pad = 14
out = Image.new('RGB', (w, ref.height + mine.height + pad * 3), 'white')
out.paste(ref, (0, pad))
out.paste(mine, (0, ref.height + pad * 2))
out.save('/Users/hongvin/workbuddy-ai/pdf-filler/tools/compare.png')
print('wrote tools/compare.png', out.size)
