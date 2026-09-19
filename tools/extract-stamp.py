import pymupdf

doc = pymupdf.open('/Users/hongvin/Downloads/QT-2026-307-pact.pdf')

# Find /Im1 in the appearance stream's Resources.
for xref in range(1, doc.xref_length()):
    obj = doc.xref_object(xref, compressed=True)
    if '/Im1' in obj and '/XObject' in obj:
        print('resources xref', xref)
        print(obj[:400])

# The image itself.
for xref in range(1, doc.xref_length()):
    try:
        info = doc.extract_image(xref)
    except Exception:
        continue
    if not info:
        continue
    if info.get('width', 0) > 200 and info.get('height', 0) > 100:
        print(f"xref {xref}: {info['width']}x{info['height']} ext={info['ext']} cs={info.get('colorspace')} bpc={info.get('bpc')} bytes={len(info['image'])}")
        with open(f"tools/extracted-{xref}.{info['ext']}", 'wb') as f:
            f.write(info['image'])
