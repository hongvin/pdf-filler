/**
 * Applies the detected values to the PDF.
 *
 * `PDFLib` (pdf-lib) and `fontkit` are injected rather than imported so that the
 * exact same module runs in the browser (where they are globals loaded from
 * vendor/) and under Node in the test harness.
 */

import { drawGeneratedStamp } from './stamp.js';

const DEFAULT_INK = [0, 0, 0];            // signature ink black
const DEFAULT_STAMP = [0, 0, 0];          // stamp ink black

/**
 * Diameter of the stamp, as a multiple of the body text size.
 *
 * Both stamp modes have to agree on this. The generated ring is drawn at radius
 * 4.33em, so its diameter is 8.66em — and the image path used to draw at 4.6em,
 * barely half that, which made an uploaded scan come out undersized next to a
 * generated one. Driving both off this constant means switching modes changes
 * the artwork, never the footprint.
 */
export const STAMP_DIAMETER_EM = 8.66;

/** Shrink a font size until the string fits `maxWidth`. */
function fitSize(font, text, maxWidth, startSize) {
  let size = startSize;
  const w = font.widthOfTextAtSize(text, size);
  if (w > maxWidth && w > 0) size *= maxWidth / w;
  return size;
}

/**
 * Does this blank have printed filler alongside it?
 *
 * `mixed` counts: it is what detection reports when a dot leader and a drawn
 * rule merge into one region (a Word line with a bottom border, say). The
 * filler no longer whitens the dot band before writing — the dotted line is
 * the form's own structure, and the value is meant to sit on top of it — but
 * the predicate is still useful to callers that want to know whether a blank
 * has printed guide marks.
 */
export function hasPrintedDots(blank) {
  return blank.kind === 'dots' || blank.kind === 'mixed';
}

/**
 * Remove annotations that sit on top of the blanks we are about to fill.
 *
 * Templates are often re-used by filling them once in a PDF editor, which
 * leaves the values behind as annotations rather than page content. If we fill
 * on top of those we get double vision: two names, two stamps. Anything whose
 * rectangle overlaps a blank we are writing to gets dropped.
 *
 * @returns {number} how many annotations were removed
 */
function stripOverlappingAnnotations(pages, blanks, PDFLib, dryRun = false) {
  const { PDFName, PDFArray, PDFNumber } = PDFLib;
  const byPage = new Map();
  for (const b of blanks) {
    if (!b.role || b.role === 'ignore') continue;
    if (!byPage.has(b.pageIndex)) byPage.set(b.pageIndex, []);
    byPage.get(b.pageIndex).push(b);
  }

  let removed = 0;
  for (const [pageIndex, list] of byPage) {
    const page = pages[pageIndex];
    if (!page) continue;

    let annots = null;
    try { annots = page.node.Annots(); } catch { continue; }
    if (!annots) continue;

    const ctx = page.node.context;
    const total = annots.size();
    const kept = [];

    for (let i = 0; i < total; i++) {
      const ref = annots.get(i);
      let rect = null;
      try {
        const dict = ctx.lookup(ref);

        // Never touch form-field widgets. They live in /Annots too, but they
        // are the form itself, not stale values left behind by a previous fill
        // — deleting them destroys the fields we are about to write into.
        const subtype = dict.get(PDFName.of('Subtype'));
        const subName = subtype && subtype.encodedName
          ? subtype.encodedName
          : String(subtype || '');
        if (subName === '/Widget') { kept.push(ref); continue; }

        const arr = dict.lookup(PDFName.of('Rect'), PDFArray);
        const v = [0, 1, 2, 3].map(k => arr.lookup(k, PDFNumber).asNumber());
        rect = {
          x0: Math.min(v[0], v[2]), x1: Math.max(v[0], v[2]),
          y0: Math.min(v[1], v[3]), y1: Math.max(v[1], v[3]),
        };
      } catch {
        kept.push(ref); // unreadable geometry — leave it alone
        continue;
      }

      const hit = list.some(b =>
        rect.x1 >= b.x0 - 2 && rect.x0 <= b.x1 + 2 &&
        rect.y1 >= b.baseline - (b.size || 12) &&
        rect.y0 <= b.baseline + (b.size || 12) * 1.6);

      if (hit) removed++;
      else kept.push(ref);
    }

    if (!dryRun && kept.length !== total) {
      try {
        const next = PDFArray.withContext(ctx);
        for (const r of kept) next.push(r);
        page.node.set(PDFName.of('Annots'), next);
      } catch { /* leave the page as-is if pdf-lib refuses */ }
    }
  }
  return removed;
}

/**
 * Count, without changing anything, how many annotations would be cleared by
 * the fill. Used to warn the user up front that the template already carries
 * values from a previous fill.
 */
export async function countOverlappingAnnotations({ PDFLib, pdfBytes, blanks }) {
  try {
    const pdfDoc = await PDFLib.PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    return stripOverlappingAnnotations(pdfDoc.getPages(), blanks, PDFLib, true);
  } catch {
    return 0;
  }
}

/**
 * @param {object}   opts
 * @param {object}   opts.PDFLib          pdf-lib namespace
 * @param {object}   opts.fontkit         @pdf-lib/fontkit namespace
 * @param {Uint8Array} opts.pdfBytes
 * @param {Array}    opts.blanks          annotated blanks (role + value set)
 * @param {object}   opts.config          values + assets
 * @returns {Promise<Uint8Array>}
 */
export async function fillDocument({ PDFLib, fontkit, pdfBytes, blanks, config }) {
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  if (fontkit) pdfDoc.registerFontkit(fontkit);

  const serif = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const serifBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
  // The generated stamp uses a plain sans, matching a real rubber stamp's
  // engraved lettering. Both are standard fonts, so nothing extra is embedded.
  const sans = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const sansBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let script = null;
  if (config.signatureFontBytes) {
    // pdf-lib's bundled subsetter drops most glyphs from Great Vibes — "HongVin"
    // renders as two stray marks — so that face has to be embedded whole. The
    // other bundled script fonts subset cleanly, so they stay small. Verified
    // per font in tools/subset-check.mjs; do not assume this is uniform.
    script = await pdfDoc.embedFont(config.signatureFontBytes, {
      subset: config.signatureSubset !== false,
    });
  }

  let signatureImage = null;
  if (config.signatureImageBytes) {
    signatureImage = await embedImage(pdfDoc, config.signatureImageBytes, PDFLib);
  }
  let stampImage = null;
  if (config.stampImageBytes) {
    stampImage = await embedImage(pdfDoc, config.stampImageBytes, PDFLib);
  }

  const pages = pdfDoc.getPages();
  const form = safeForm(pdfDoc);
  let formTouched = false;

  // Do this before drawing anything: stale annotation values must go, or the
  // output shows the old name and stamp underneath the new ones.
  const removedAnnotations = config.stripAnnotations === false
    ? 0
    : stripOverlappingAnnotations(pages, blanks, PDFLib);

  for (const blank of blanks) {
    if (!blank.role || blank.role === 'ignore') continue;
    const value = blank.value != null && blank.value !== '' ? blank.value : '';
    const page = pages[blank.pageIndex];
    if (!page) continue;

    // A form field can only take a text value. Signature and stamp are graphics,
    // so for those we fall through and draw onto the widget's rectangle instead
    // of trying (and silently failing) to set text.
    const isGraphic = blank.role === 'signature' || blank.role === 'stamp';

    // --- AcroForm field (namespace-aware path) -------------------------
    if (!isGraphic && blank.fieldName && form) {
      const applied = applyToFormField(form, blank, value, PDFLib);
      if (applied) { formTouched = true; continue; }
    }

    // --- drawn / detected region ---------------------------------------
    // No white-out here: the dotted line is part of the form, and the value
    // sits on top of it. Signature and stamp are opaque enough that any dots
    // underneath are hidden by the ink; dots outside the ink footprint remain.

    if (blank.role === 'signature') {
      drawSignature(page, blank, { script, serif, signatureImage, config, PDFLib, rgb });
    } else if (blank.role === 'stamp') {
      drawStamp(page, blank, { sans, sansBold, stampImage, config, PDFLib, rgb });
    } else if (value) {
      const size = fitSize(serif, value, (blank.x1 - blank.x0) * 0.97, blank.size || 12);
      page.drawText(value, {
        x: blank.x0 + Math.max(1, blank.size * 0.08),
        y: blank.baseline,
        size,
        font: serif,
        color: rgb(0, 0, 0),
      });
    }
  }

  if (formTouched && config.flattenForm !== false) {
    try { form.flatten(); } catch { /* non-fatal */ }
  }

  return { bytes: await pdfDoc.save(), removedAnnotations };
}

function safeForm(pdfDoc) {
  try {
    const form = pdfDoc.getForm();
    return form.getFields().length ? form : null;
  } catch {
    return null;
  }
}

/**
 * Set an AcroForm field by its fully-qualified name. Names live in a namespace
 * tree (`topmostSubform[0].Page1[0].Nama[0]`), and callers may have stored
 * either the full path or just the leaf, so we accept both.
 */
function applyToFormField(form, blank, value, PDFLib) {
  let field = null;
  try { field = form.getField(blank.fieldName); } catch { /* fall through */ }
  if (!field) {
    const leaf = blank.fieldName.split('.').pop().replace(/\[\d+\]$/, '');
    field = form.getFields().find(f => {
      const n = f.getName();
      return n === blank.fieldName || n.split('.').pop().replace(/\[\d+\]$/, '') === leaf;
    });
  }
  if (!field) return false;
  try {
    const type = field.constructor.name;
    if (type === 'PDFTextField') field.setText(String(value));
    else if (type === 'PDFCheckBox') { if (value) field.check(); else field.uncheck(); }
    else if (type === 'PDFDropdown' || type === 'PDFOptionList') field.select(String(value));
    else return false;
    return true;
  } catch {
    return false;
  }
}

async function embedImage(pdfDoc, bytes, PDFLib) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const isPng = u8[0] === 0x89 && u8[1] === 0x50;
  return isPng ? pdfDoc.embedPng(u8) : pdfDoc.embedJpg(u8);
}

/* ------------------------------------------------------------------ */

function drawSignature(page, blank, { script, signatureImage, config, PDFLib, rgb }) {
  const { degrees } = PDFLib;
  const ink = config.signatureColor || DEFAULT_INK;
  const color = rgb(ink[0], ink[1], ink[2]);
  const width = blank.x1 - blank.x0;
  const size = blank.size || 12;

  if (signatureImage) {
    const targetH = size * 3.4;
    const scale = targetH / signatureImage.height;
    const w = signatureImage.width * scale;
    page.drawImage(signatureImage, {
      x: blank.x0 + (width - w) / 2,
      y: blank.baseline - size * 0.45,
      width: w,
      height: targetH,
    });
    return;
  }

  const text = config.signatureText || '';
  if (!text || !script) return;

  // Matched against a real signed copy of this form: the signature sits at the
  // left of the blank, not centred, at roughly 3.4x the body text.
  const scale = config.signatureScale || 1;
  let fontSize = size * 3.4 * scale;
  let w = script.widthOfTextAtSize(text, fontSize);
  const maxW = width * 0.6;
  if (w > maxW) { fontSize *= maxW / w; w = script.widthOfTextAtSize(text, fontSize); }

  page.drawText(text, {
    x: blank.x0 + width * 0.05,
    y: blank.baseline - size * 0.22,
    size: fontSize,
    font: script,
    color,
    rotate: degrees(config.signatureTilt || 0),
  });
}

function drawStamp(page, blank, { sans, sansBold, stampImage, config, PDFLib, rgb }) {
  const size = blank.size || 12;
  const width = blank.x1 - blank.x0;
  // The stamp is big enough to overlap the line above, so it sits in the right
  // half of its line — otherwise it lands on top of the signature.
  const cx = blank.x0 + width * 0.72;
  const cy = blank.baseline + size * 0.35;
  const diameter = size * STAMP_DIAMETER_EM * (config.stampScale || 1);

  if (stampImage) {
    // Height is driven by the shared diameter so this lands in exactly the same
    // box as the generated ring; the width follows the artwork's own aspect.
    const scale = diameter / stampImage.height;
    const w = stampImage.width * scale;
    page.drawImage(stampImage, {
      x: cx - w / 2,
      y: cy - diameter / 2,
      width: w,
      height: diameter,
      opacity: config.stampOpacity != null ? config.stampOpacity : 0.92,
    });
    return;
  }

  // Two centre lines: the current company number, then the old ROC number in
  // brackets, which is how Malaysian stamps normally carry both.
  const lines = [
    config.stampLine1 || config.companyReg || '',
    config.stampLine2 || '',
  ];

  drawGeneratedStamp(page, {
    cx,
    cy,
    r: diameter / 2,
    company: config.companyName || '',
    lines,
    star: config.stampStar !== false,
    bottom: config.stampBottomText || '',
    arcFont: sansBold,
    centreFont: sans,
    PDFLib,
    color: config.stampColor || DEFAULT_STAMP,
  });
}

/* ------------------------------------------------------------------ */
/* AcroForm introspection (the "namespace" mode)                       */
/* ------------------------------------------------------------------ */

/**
 * List every form field with its fully-qualified name. This is what the UI
 * shows when a PDF turns out to be a real form rather than a flat document.
 */
export async function listFormFields({ PDFLib, pdfBytes }) {
  const pdfDoc = await PDFLib.PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  let fields = [];
  try {
    fields = pdfDoc.getForm().getFields();
  } catch {
    return [];
  }
  return fields.map(f => {
    const name = f.getName();
    const parts = name.split('.');
    let rect = null, pageIndex = 0;
    try {
      const widgets = typeof f.acroField.getWidgets === 'function' ? f.acroField.getWidgets() : [];
      if (widgets.length) {
        const r = widgets[0].getRectangle();
        rect = { x0: r.x, x1: r.x + r.width, baseline: r.y + r.height * 0.28, size: 12 };
        const ref = widgets[0].P && widgets[0].P();
        const idx = ref ? pdfDoc.getPages().findIndex(p => p.ref === ref) : -1;
        if (idx >= 0) pageIndex = idx;
      }
    } catch { /* geometry is best-effort */ }
    return {
      fieldName: name,
      namespace: parts.slice(0, -1).join('.') || '(root)',
      leaf: parts[parts.length - 1],
      type: f.constructor.name.replace(/^PDF/, ''),
      pageIndex,
      rect,
    };
  });
}
