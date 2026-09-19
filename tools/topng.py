import fitz, sys
src = sys.argv[1] if len(sys.argv) > 1 else "/Users/hongvin/workbuddy-ai/pdf-filler/tools/filled.pdf"
d = fitz.open(src)
for i, page in enumerate(d):
    page.get_pixmap(dpi=120).save(f"/Users/hongvin/workbuddy-ai/pdf-filler/tools/out{i+1}.png")
print("rendered", d.page_count, "pages from", src)
