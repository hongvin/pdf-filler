import pymupdf, re

doc = pymupdf.open('/Users/hongvin/Downloads/QT-2026-307-pact.pdf')
page = doc[1]

for a in page.annots():
    print('=== annotation xref', a.xref, a.type)
    ap = doc.xref_get_key(a.xref, 'AP/N')
    print('AP/N:', ap)

    # Resolve the appearance stream object and decompress it.
    xref = None
    if ap and ap[0] == 'xref':
        xref = int(ap[1].split()[0])
    if xref is None:
        continue

    print('--- Form XObject dict ---')
    print(doc.xref_object(xref)[:900])
    print('--- stream ---')
    stream = doc.xref_stream(xref)
    text = stream.decode('latin-1')
    print(len(text), 'bytes')
    print(text[:6000])
