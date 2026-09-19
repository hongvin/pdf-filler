/**
 * Glyph advance widths for the standard PDF fonts, in 1/1000 em units.
 *
 * We only need these to locate *where inside a text item* a run of dots starts.
 * pdf.js hands us the item's total width, so we self-calibrate (see detect.js):
 * the table only has to be approximately right, and the measured item width
 * corrects the residual error. That makes the detector font-agnostic enough to
 * work on templates we have never seen.
 */

// Times-Roman / Times-Bold share these metrics closely enough for our purpose.
export const TIMES_ROMAN_WIDTHS = {
  ' ': 250, '!': 333, '"': 408, '#': 500, $: 500, '%': 833, '&': 778, "'": 180,
  '(': 333, ')': 333, '*': 500, '+': 564, ',': 250, '-': 333, '.': 250, '/': 278,
  0: 500, 1: 500, 2: 500, 3: 500, 4: 500, 5: 500, 6: 500, 7: 500, 8: 500, 9: 500,
  ':': 278, ';': 278, '<': 564, '=': 564, '>': 564, '?': 444, '@': 921,
  A: 722, B: 667, C: 667, D: 722, E: 611, F: 556, G: 722, H: 722, I: 333,
  J: 389, K: 722, L: 611, M: 889, N: 722, O: 722, P: 556, Q: 722, R: 667,
  S: 556, T: 611, U: 722, V: 722, W: 944, X: 722, Y: 722, Z: 611,
  '[': 333, '\\': 278, ']': 333, '^': 469, _: 500, '`': 333,
  a: 444, b: 500, c: 444, d: 500, e: 444, f: 333, g: 500, h: 500, i: 278,
  j: 278, k: 500, l: 278, m: 778, n: 500, o: 500, p: 500, q: 500, r: 333,
  s: 389, t: 278, u: 500, v: 500, w: 722, x: 500, y: 500, z: 444,
  '{': 480, '|': 200, '}': 480, '~': 541,
  // Typographic characters that show up in dotted-line templates.
  '\u2026': 1000, // …
  '\u00b7': 250,  // ·
  '\u2022': 350,  // •
  '\u2013': 500,  // –
  '\u2014': 1000, // —
  '\u2018': 333, '\u2019': 333, '\u201c': 444, '\u201d': 444,
};

export const DEFAULT_ADVANCE = 0.5;

/** Advance width of a single character, in em. */
export function advanceEm(ch) {
  const w = TIMES_ROMAN_WIDTHS[ch];
  return (w === undefined ? DEFAULT_ADVANCE * 1000 : w) / 1000;
}

/** Total natural advance width of a string at the given font size. */
export function measureEm(str, fontSize) {
  let total = 0;
  for (const ch of str) total += advanceEm(ch);
  return total * fontSize;
}

/**
 * Characters that make up a "blank" in a dotted-line form.
 * '.' and '…' are the common ones; '_' and '·' appear in some templates.
 */
export const DOT_CHARS = new Set(['.', '\u2026', '_', '\u00b7', '\u2022']);
