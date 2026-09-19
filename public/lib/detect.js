/**
 * Blank-region detection.
 *
 * Two strategies, because PDFs of this kind come in two flavours:
 *
 *   1. "Flat" PDFs (the common case — a Word export printed to PDF). There are
 *      no form fields; the blanks are literal runs of dots or underscores, or
 *      drawn horizontal rules. We find them by looking at glyph geometry.
 *
 *   2. AcroForm PDFs. Real fields exist, each with a fully-qualified name that
 *      lives in a namespace tree (e.g. `topmostSubform[0].Page1[0].Nama[0]`).
 *      Those are read straight off the form dictionary.
 *
 * Everything here is pure and dependency-free so the exact same code runs in
 * the browser and in the Node test harness.
 */

import { DOT_CHARS, advanceEm, measureEm } from './metrics.js';

const MIN_RUN_CHARS = 3;
const MIN_RUN_EM = 1.2; // a "blank" narrower than this is probably an ellipsis in prose
const LINE_TOLERANCE_EM = 0.45;
const LABEL_GAP_EM = 1.6; // how far left we will keep hoovering up label words
const MAX_LABEL_ITEMS = 4; // a label is never a paragraph
const MAX_LABEL_CHARS = 42;
const MARGIN_EM = 1.2;

/* ------------------------------------------------------------------ */
/* text items                                                          */
/* ------------------------------------------------------------------ */

/**
 * Normalise pdf.js `getTextContent()` items into a flat, predictable shape.
 * `transform` is [a,b,c,d,e,f] in PDF user space (origin bottom-left), which is
 * the same space pdf-lib draws in — so no coordinate flipping is needed.
 */
export function annotateItems(textContent, pageIndex) {
  const raw = (textContent && textContent.items) || [];
  const out = [];
  for (const it of raw) {
    if (!it || typeof it.str !== 'string') continue;
    const t = it.transform;
    if (!t) continue;
    const fontSize = Math.hypot(t[2], t[3]) || Math.hypot(t[0], t[1]) || it.height || 12;
    const str = it.str;
    if (!str.trim()) continue;
    out.push({
      pageIndex,
      str,
      x: t[4],
      baseline: t[5],
      fontSize,
      width: typeof it.width === 'number' && it.width > 0 ? it.width : measureEm(str, fontSize),
      height: it.height || fontSize,
    });
  }
  return out;
}

/** x-extent of a text item, using the measured width when it looks sane. */
function itemSpan(it) {
  const natural = measureEm(it.str, it.fontSize);
  let scale = natural > 0.5 && it.width > 0.5 ? it.width / natural : 1;
  if (!(scale > 0.55 && scale < 1.8)) scale = 1;
  return { x0: it.x, x1: it.x + natural * scale, scale };
}

/* ------------------------------------------------------------------ */
/* dotted / underscored blanks                                         */
/* ------------------------------------------------------------------ */

/**
 * Find runs of dot-like characters inside each text item.
 *
 * pdf.js gives us an item's origin and its *total* width but not per-character
 * positions, so we walk the string accumulating advances from the metrics table
 * and then scale that walk by (measured width / natural width). That self-
 * calibration is what makes this work on fonts whose metrics we don't know.
 */
export function findDotRuns(items) {
  const found = [];
  for (const it of items) {
    const chars = Array.from(it.str);
    const { scale } = itemSpan(it);
    const unit = it.fontSize * scale;

    // cumulative advance offset for each character index
    const offsets = new Array(chars.length + 1);
    let acc = 0;
    for (let i = 0; i < chars.length; i++) {
      offsets[i] = acc;
      acc += advanceEm(chars[i]) * unit;
    }
    offsets[chars.length] = acc;

    let i = 0;
    while (i < chars.length) {
      if (!DOT_CHARS.has(chars[i])) { i++; continue; }
      let j = i;
      while (j < chars.length && DOT_CHARS.has(chars[j])) j++;
      if (j - i >= MIN_RUN_CHARS) {
        const x0 = it.x + offsets[i];
        const x1 = it.x + offsets[j];
        if ((x1 - x0) / it.fontSize >= MIN_RUN_EM) {
          found.push({
            pageIndex: it.pageIndex,
            x0,
            x1,
            baseline: it.baseline,
            size: it.fontSize,
            kind: 'dots',
            chars: j - i,
            // pdf.js frequently hands back "Nama : …………" as a single item, so
            // the label is sitting *inside* the run's own item. Keep it.
            prefix: chars.slice(0, i).join(''),
          });
        }
      }
      i = j;
    }
  }
  return found;
}

/**
 * pdf.js sometimes splits a dotted run across several text items (one per
 * font/style change, or per short chunk). Stitch neighbouring runs back
 * together when they sit on the same line and are nearly touching.
 */
export function mergeRuns(runs) {
  const byPage = new Map();
  for (const r of runs) {
    if (!byPage.has(r.pageIndex)) byPage.set(r.pageIndex, []);
    byPage.get(r.pageIndex).push(r);
  }
  const merged = [];
  for (const list of byPage.values()) {
    list.sort((a, b) => a.baseline - b.baseline || a.x0 - b.x0);
    for (const r of list) {
      const prev = merged[merged.length - 1];
      const sameLine = prev && prev.pageIndex === r.pageIndex &&
        Math.abs(prev.baseline - r.baseline) <= Math.max(prev.size, r.size) * LINE_TOLERANCE_EM;
      const touching = sameLine && (r.x0 - prev.x1) <= Math.max(prev.size, r.size) * 0.35;
      if (touching) {
        prev.x1 = Math.max(prev.x1, r.x1);
        prev.chars += r.chars;
        prev.kind = prev.kind === r.kind ? prev.kind : 'mixed';
      } else {
        merged.push({ ...r });
      }
    }
  }
  return merged;
}

/* ------------------------------------------------------------------ */
/* drawn horizontal rules                                              */
/* ------------------------------------------------------------------ */

/** [a,b,c,d,e,f] matrix multiply, matching the PDF concatenation order. */
function matMul(m, n) {
  return [
    m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

const applyMat = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/**
 * A blank can also be a drawn line rather than a row of dots. pdf.js hands us
 * the page's operator list; we look for thin, wide, horizontal paths.
 *
 * Two details that are easy to get wrong:
 *
 *   - The sub-commands inside `constructPath` are pdf.js **operator codes**
 *     (OPS.moveTo = 13, OPS.lineTo = 14, …), not the 0/1 indices used by
 *     fontkit-style path encodings. Compare against the injected OPS table.
 *   - A rule drawn with the `re` operator — which is how Word, LibreOffice and
 *     Acrobat all emit one — arrives as a `constructPath` whose command list is
 *     `[OPS.rectangle]`, *not* as a standalone `OPS.rectangle` op. Every command
 *     in that list has to be consumed or the cursor desynchronises, so the
 *     rectangle case below is load-bearing, not decorative.
 *   - Path coordinates are in the user space in force at that point, so any
 *     preceding `transform` has to be applied. Without CTM tracking a rule
 *     inside a scaled or translated group lands in the wrong place entirely.
 *
 * `OPS` is injected so this module stays pdf.js-version-agnostic.
 */
export function findUnderlines(opList, OPS, pageWidth, pageIndex) {
  const out = [];
  if (!opList || !OPS) return out;
  const fnArray = opList.fnArray || [];
  const argsArray = opList.argsArray || [];

  const push = (x0, x1, y) => {
    const a = Math.min(x0, x1);
    const b = Math.max(x0, x1);
    const len = b - a;
    if (len < 40) return;                    // too short to be a field
    if (len > pageWidth * 0.88) return;      // full-column rules are page furniture
    out.push({ pageIndex, x0: a, x1: b, baseline: y + 3, size: 12, kind: 'underline' });
  };

  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];

    if (fn === OPS.save) { stack.push(ctm.slice()); continue; }
    if (fn === OPS.restore) { ctm = stack.pop() || [1, 0, 0, 1, 0, 0]; continue; }
    if (fn === OPS.transform && args && args.length === 6) { ctm = matMul(ctm, args); continue; }

    if (fn === OPS.constructPath) {
      const cmds = args && args[0];
      const coords = args && args[1];
      if (!cmds || !coords) continue;

      let ci = 0;
      let cur = null;
      const segs = [];
      for (const cmd of cmds) {
        if (cmd === OPS.moveTo) {
          cur = [coords[ci], coords[ci + 1]]; ci += 2;
        } else if (cmd === OPS.lineTo) {
          const x = coords[ci], y = coords[ci + 1]; ci += 2;
          if (cur) segs.push([cur[0], cur[1], x, y]);
          cur = [x, y];
        } else if (cmd === OPS.curveTo) {
          ci += 6; cur = [coords[ci - 2], coords[ci - 1]];
        } else if (cmd === OPS.curveTo2 || cmd === OPS.curveTo3) {
          ci += 4; cur = [coords[ci - 2], coords[ci - 1]];
        } else if (cmd === OPS.rectangle) {
          // `re`. Coords are x, y, width, height — the rectangle's own height,
          // not a position, which is why it cannot be read like the others.
          const rx = coords[ci], ry = coords[ci + 1];
          const rw = coords[ci + 2], rh = coords[ci + 3];
          ci += 4;
          // Only a thin bar is a candidate rule. A tall rectangle is a box, a
          // table cell or a page panel, and there is nothing in the operator
          // list that distinguishes those from a field — so leave them to the
          // filters rather than inventing a blank for every bordered cell.
          if (Math.abs(rh) <= 3) segs.push([rx, ry, rx + rw, ry]);
          cur = [rx, ry];
        } else if (cmd === OPS.closePath) {
          /* nothing to advance */
        } else {
          break; // unknown command — stop rather than misalign the cursor
        }
      }

      for (const [ax, ay, bx, by] of segs) {
        const [px0, py0] = applyMat(ctm, ax, ay);
        const [px1, py1] = applyMat(ctm, bx, by);
        if (Math.abs(py0 - py1) <= 1.5) push(px0, px1, (py0 + py1) / 2);
      }
    } else if (fn === OPS.rectangle && args && args.length >= 4) {
      // Fallback only. pdf.js 4.6.82 never emits `re` as a top-level op — it
      // packs it into constructPath, which the loop above handles — but the
      // encoding has moved between pdf.js releases before, and this branch is
      // cheap insurance against the next bump silently losing every drawn rule.
      const [x, y, w, h] = args;
      const [px0, py0] = applyMat(ctm, x, y);
      const [px1, py1] = applyMat(ctm, x + w, y);
      const height = Math.abs(applyMat(ctm, 0, h)[1] - applyMat(ctm, 0, 0)[1]);
      if (height <= 3 && Math.abs(py0 - py1) <= 1.5) push(px0, px1, py0);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* labels                                                              */
/* ------------------------------------------------------------------ */

/** Group items into visual lines, top-to-bottom then left-to-right. */
export function groupLines(items) {
  const lines = [];
  for (const it of items) {
    const tol = Math.max(2, it.fontSize * LINE_TOLERANCE_EM);
    let line = lines.find(l => Math.abs(l.baseline - it.baseline) <= tol);
    if (!line) {
      line = { baseline: it.baseline, size: it.fontSize, items: [] };
      lines.push(line);
    }
    line.items.push(it);
    line.size = Math.max(line.size, it.fontSize);
  }
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);
  lines.sort((a, b) => b.baseline - a.baseline); // descending y = reading order
  return lines;
}

const clean = s => s.replace(/\s+/g, ' ').replace(/^[\s.\u2026]+/, '').replace(/[\s:：.\u2026]+$/g, '').trim();

/** True when a string is nothing but blank-filler characters. */
function isDotOnly(str) {
  let seen = false;
  for (const ch of str) {
    if (/\s/.test(ch)) continue;
    if (!DOT_CHARS.has(ch)) return false;
    seen = true;
  }
  return seen;
}

/**
 * Rebuild readable text from a run of text items.
 *
 * pdf.js segments items differently in the browser than it does under Node —
 * "No.Kad" can arrive as "N" + "o.Kad" — so joining with a blanket space
 * produces "N o.Kad". Reinsert a space only where the horizontal gap says one
 * was actually printed.
 */
function joinItems(items, size) {
  let out = '';
  let prevEnd = null;
  for (const it of items) {
    const span = itemSpan(it);
    if (prevEnd != null && span.x0 - prevEnd > size * 0.15) out += ' ';
    out += it.str;
    prevEnd = span.x1;
  }
  return out;
}

/**
 * A run's in-item prefix is usually a label ("Nama : ") but can be a tail of
 * body prose. Labels are short; anything long gets trimmed back to the last
 * colon, and if there is no colon we assume it is prose and drop it.
 */
function prefixLabel(raw) {
  const s = (raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (s.length <= 60) return s;
  const i = Math.max(s.lastIndexOf(':'), s.lastIndexOf('\uFF1A'));
  return i >= 0 ? s.slice(i + 1).trim() : '';
}

/**
 * Work out which label a blank belongs to.
 *
 * Two layouts have to be handled, and this template contains both:
 *
 *   Saya,   [ BLANK ]                    No.Kad          Pengenalan
 *   [ BLANK ] yang mewakili ...
 *
 * The first blank's label is immediately to its left ("Saya,"). The second
 * starts at the left margin, so nothing precedes it on its own line — its label
 * ("No.Kad Pengenalan") is parked at the right-hand end of the line above. So:
 * look left first; if the blank hugs the left margin, look at the tail of the
 * previous line instead.
 */
export function inferLabel(blank, items, pageWidth) {
  const lines = groupLines(items);
  const tol = Math.max(2, blank.size * LINE_TOLERANCE_EM);
  const lineIdx = lines.findIndex(l => Math.abs(l.baseline - blank.baseline) <= tol);
  const line = lineIdx >= 0 ? lines[lineIdx] : null;
  const inItem = prefixLabel(blank.prefix);

  if (line) {
    const usable = line.items.filter(it => it.x < blank.x0 - 0.5 && !isDotOnly(it.str));
    if (usable.length) {
      // Grow the label cluster right-to-left. A trailing ":" is its own text
      // item in most exports and cleans away to nothing, so the gap rule alone
      // would stop too early — keep reaching left until the cluster actually
      // says something. The size cap stops us swallowing a whole sentence when
      // a blank happens to sit mid-paragraph.
      const cluster = [usable[usable.length - 1]];
      let edge = cluster[0].x;
      for (let i = usable.length - 2; i >= 0; i--) {
        const it = usable[i];
        const haveText = clean(cluster.map(c => c.str).join(' ')) !== '';
        const tooFar = edge - itemSpan(it).x1 > blank.size * LABEL_GAP_EM;
        const tooBig = cluster.length >= MAX_LABEL_ITEMS ||
          cluster.reduce((n, c) => n + c.str.length, 0) >= MAX_LABEL_CHARS;
        if (haveText && (tooFar || tooBig)) break;
        cluster.unshift(it);
        edge = it.x;
      }
      const text = clean([joinItems(cluster, blank.size), inItem].filter(Boolean).join(' '));
      if (text) return { label: text, source: 'left' };
    } else if (inItem) {
      const text = clean(inItem);
      if (text) return { label: text, source: 'in-item' };
    }
  }

  // Nothing on the left — assume the label wrapped from the line above.
  const prev = lines.filter(l => l.baseline > blank.baseline + tol)
    .sort((a, b) => a.baseline - b.baseline)[0];
  if (prev) {
    // Skip the previous line's own dot runs; another blank is not a label.
    const tail = prev.items
      .filter(it => itemSpan(it).x0 >= blank.x1 - 1 && !isDotOnly(it.str))
      .sort((a, b) => a.x - b.x);
    const pool = tail.length ? tail : prev.items.filter(it => !isDotOnly(it.str)).slice(-2);
    const text = clean(joinItems(pool, blank.size));
    if (text) return { label: text, source: 'previous-line' };
  }
  return { label: '', source: 'none' };
}

/* ------------------------------------------------------------------ */
/* top level                                                           */
/* ------------------------------------------------------------------ */

/**
 * Is there body text sitting directly on top of this rule?
 *
 * A drawn line in a document is usually one of three things: a fillable blank,
 * an underline under a word, or a table/page rule. Only the first is a field.
 * The discriminator that actually works is that a *fillable* blank has empty
 * space above it, whereas a text underline has the emphasised words right there
 * — typically 2-4pt above the rule, i.e. roughly one line height.
 */
function hasTextAbove(blank, items) {
  const needed = (blank.x1 - blank.x0) * 0.3;
  for (const it of items) {
    const span = itemSpan(it);
    const overlap = Math.min(span.x1, blank.x1) - Math.max(span.x0, blank.x0);
    if (overlap < needed) continue;
    // An underline sits a hair *below* the text baseline, and we store the rule
    // as `y + 3`, so the text can end up marginally below our nominal baseline.
    // The window therefore has to reach slightly negative.
    const dy = it.baseline - blank.baseline;
    const size = blank.size || 12;
    if (dy > -size * 0.4 && dy < size * 1.4) return true;
  }
  return false;
}

/**
 * @param {object} doc
 * @param {Array<{pageIndex:number, textContent:object, opList?:object, width:number, height:number}>} doc.pages
 * @param {object} [doc.OPS] pdf.js OPS table, enables drawn-rule detection
 * @returns {{blanks:Array, items:Array, docHints:object}}
 */
export function detectBlanks(doc) {
  const allItems = [];
  const rawRegions = [];

  for (const p of doc.pages) {
    const items = annotateItems(p.textContent, p.pageIndex);
    allItems.push(...items);
    rawRegions.push(...findDotRuns(items));
    if (p.opList && doc.OPS) {
      rawRegions.push(...findUnderlines(p.opList, doc.OPS, p.width, p.pageIndex));
    }
  }

  let regions = mergeRuns(rawRegions);

  // Drop the same region reported twice (a dotted run drawn over a rule, etc).
  regions = regions.filter((r, i) => !regions.some((o, j) =>
    j !== i && o.pageIndex === r.pageIndex &&
    Math.abs(o.baseline - r.baseline) < 2 &&
    Math.abs(o.x0 - r.x0) < 3 && Math.abs(o.x1 - r.x1) < 3));

  const itemsByPage = new Map();
  for (const it of allItems) {
    if (!itemsByPage.has(it.pageIndex)) itemsByPage.set(it.pageIndex, []);
    itemsByPage.get(it.pageIndex).push(it);
  }
  const widthByPage = new Map(doc.pages.map(p => [p.pageIndex, p.width]));

  const blanks = [];
  for (const r of regions) {
    const pageItems = itemsByPage.get(r.pageIndex) || [];
    const { label, source } = inferLabel(r, pageItems, widthByPage.get(r.pageIndex));

    // Dot runs are unambiguous. A drawn rule is not, so it has to earn its
    // place: empty space above it, plus a label that reads like a field label —
    // either immediately to its left, or a short one wrapped from the line
    // above. Without this a document's footers, table borders and underlined
    // company names all show up as phantom fields.
    if (r.kind === 'underline') {
      if (!label || hasTextAbove(r, pageItems)) continue;
      const shortEnough = label.length <= 20 && label.split(/\s+/).length <= 2;
      if (source === 'left') { /* fine */ }
      else if (source === 'previous-line' && shortEnough) { /* stacked layout */ }
      else continue;
    }

    blanks.push({
      id: `b${blanks.length + 1}`,
      ...r,
      label,
      labelSource: source,
      page: r.pageIndex + 1,
      role: 'ignore',
      value: '',
    });
  }

  // Reading order: page, then top-to-bottom, then left-to-right.
  blanks.sort((a, b) => a.pageIndex - b.pageIndex ||
    b.baseline - a.baseline || a.x0 - b.x0);

  return { blanks, items: allItems, docHints: extractDocHints(allItems) };
}

/**
 * Little facts we can read straight out of the document so the user doesn't
 * have to retype them — company name and its registration number.
 */
export function extractDocHints(items) {
  const text = items.map(i => i.str).join(' ').replace(/\s+/g, ' ');
  const hints = {};

  const company = text.match(/\b([A-Z][A-Za-z0-9&.'()-]*(?:\s+[A-Z][A-Za-z0-9&.'()-]*)*\s+SDN\.?\s*BHD\.?)/);
  if (company) hints.companyName = company[1].replace(/\s+/g, ' ').trim();

  const reg = text.match(/(?:Nombor\s+Pendaftaran|No\.?\s*Pendaftaran|Registration\s+No\.?)\s*:?\s*(\d{6,}[-\d]*)/i);
  if (reg) hints.companyReg = reg[1];
  else {
    const loose = text.match(/\b(\d{12})\b/);
    if (loose) hints.companyReg = loose[1];
  }

  return hints;
}
