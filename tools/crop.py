import pymupdf, sys
src = sys.argv[1]
page_no = int(sys.argv[2])
x0, y0, x1, y1 = (float(v) for v in sys.argv[3:7])
out = sys.argv[7]
d = pymupdf.open(src)
page = d[page_no - 1]
# PDF coords (origin bottom-left) -> pymupdf (origin top-left)
h = page.rect.height
clip = pymupdf.Rect(x0, h - y1, x1, h - y0)
page.get_pixmap(dpi=520, clip=clip).save(out)
print("wrote", out, clip)
