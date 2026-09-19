/**
 * Circular company stamp, drawn from scratch to match a real Malaysian company
 * rubber stamp:
 *
 *   - two thin concentric rings
 *   - the company name set in bold sans, arced around the *top*, wrapping far
 *     enough round that the end letters are tilted well past vertical
 *   - the registration numbers stacked in the middle
 *   - a solid five-pointed star at the bottom, sitting in the ring gap where
 *     the company name leaves off
 *
 * Geometry notes that took a couple of attempts to get right:
 *   - The rings are r and 0.79r, so the *gap* between them is 0.21r. The ring
 *     lettering is sized to sit in that gap (~0.25r font, ~0.18r cap height)
 *     and is centred on 0.895r. Sizing it off the outer radius instead makes it
 *     spill across both rings and look like a smudge.
 *   - pdf-lib rotates a glyph about its own baseline origin, so we place the
 *     origin at (point on arc) minus half the glyph advance *along the rotated
 *     baseline*. That centres the glyph instead of letting the run drift.
 */

/** SVG path for a solid five-pointed star, outer radius 1, pointing up. */
function starPath(innerRatio = 0.382) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = (-90 + i * 36) * Math.PI / 180;
    const rr = i % 2 === 0 ? 1 : innerRatio;
    pts.push(`${(rr * Math.cos(a)).toFixed(4)} ${(rr * Math.sin(a)).toFixed(4)}`);
  }
  return 'M ' + pts.join(' L ') + ' Z';
}

/**
 * Draw text following a circular arc.
 *
 * @param angleFn  (t) => angle in radians, t = normalised position along the run
 * @param rotFn    (angle) => glyph rotation in radians
 * @param tracking extra space per glyph, in em. Real stamps letter the ring text
 *                 loosely, which lets a smaller face still fill the arc.
 */
function arcText(page, text, { cx, cy, radius, font, size, color, angleFn, rotFn, degrees, tracking = 0 }) {
  const chars = Array.from(text);
  // Proportional spacing: wide letters claim more of the arc.
  const weights = chars.map(c => Math.max(0.35, font.widthOfTextAtSize(c, size) / size) + tracking);
  const total = weights.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return;

  let travelled = 0;
  for (let i = 0; i < chars.length; i++) {
    const t = (travelled + weights[i] / 2) / total;
    travelled += weights[i];

    const a = angleFn(t);
    const rot = rotFn(a);
    const w = font.widthOfTextAtSize(chars[i], size);

    page.drawText(chars[i], {
      x: cx + radius * Math.cos(a) - (w / 2) * Math.cos(rot),
      y: cy + radius * Math.sin(a) - (w / 2) * Math.sin(rot),
      size,
      font,
      color,
      rotate: degrees(rot * 180 / Math.PI),
    });
  }
}

/**
 * Shrink the font until the string spans no more than `maxSpan` radians,
 * accounting for letter-spacing.
 */
function fitToArc(font, text, radius, startSize, maxSpan, tracking = 0) {
  const widthAt = size => font.widthOfTextAtSize(text, size) + tracking * size * text.length;
  let size = startSize;
  let span = widthAt(size) / radius;
  if (span > maxSpan && span > 0) {
    size *= maxSpan / span;
    span = widthAt(size) / radius;
  }
  return { size, span };
}

/**
 * @param page        pdf-lib page
 * @param opts.cx     centre X
 * @param opts.cy     centre Y
 * @param opts.r      outer radius
 * @param opts.company company name, arced over the top
 * @param opts.lines  centre text lines, top to bottom
 * @param opts.star   draw the five-pointed star at the bottom (default true)
 * @param opts.bottom optional bottom arc text; suppresses the star when set
 */
export function drawGeneratedStamp(page, {
  cx, cy, r,
  company = '',
  lines = [],
  star = true,
  bottom = '',
  arcFont,
  centreFont,
  PDFLib,
  color = [0, 0, 0],
}) {
  const { rgb, degrees } = PDFLib;
  const ink = rgb(color[0], color[1], color[2]);

  const innerR = r * 0.79;
  const gapR = (r + innerR) / 2; // 0.895r — centre line of the ring gap

  // Rings. Omitting `color` keeps these stroke-only.
  page.drawCircle({ x: cx, y: cy, size: r, borderColor: ink, borderWidth: r * 0.020 });
  page.drawCircle({ x: cx, y: cy, size: innerR, borderColor: ink, borderWidth: r * 0.017 });

  // ---- company name, arced over the top -----------------------------
  const upper = (company || '').toUpperCase();
  if (upper) {
    // Wide span on purpose: a real stamp wraps the name most of the way round,
    // leaving only the bottom for the star. Letter-spaced so a modest face still
    // fills the arc — the reference stamp's ring text is smaller than an
    // unspaced Helvetica-Bold of the same span would be.
    const TRACKING = 0.085;
    const { size, span } = fitToArc(arcFont, upper, gapR, r * 0.19, 4.0, TRACKING);
    const half = span / 2;
    // Nudge the baseline inward by ~0.35em so the glyph body straddles gapR.
    arcText(page, upper, {
      cx, cy, radius: gapR - size * 0.35, font: arcFont, size, color: ink, degrees, tracking: TRACKING,
      angleFn: t => Math.PI / 2 + half - 2 * half * t,
      rotFn: a => a - Math.PI / 2,
    });
  }

  // ---- centre text --------------------------------------------------
  const clean = lines.filter(l => l != null && String(l).trim() !== '').map(String);
  if (clean.length) {
    const size = r * 0.15;
    // Stack starts just under the centre and works down, matching the
    // reference stamp's slightly low text block.
    let baseline = cy - r * 0.055;
    for (const line of clean) {
      const w = centreFont.widthOfTextAtSize(line, size);
      page.drawText(line, { x: cx - w / 2, y: baseline, size, font: centreFont, color: ink });
      baseline -= r * 0.20;
    }
  }

  // ---- bottom: star, or an optional arc of text ----------------------
  if (bottom) {
    const text = bottom.toUpperCase();
    const { size, span } = fitToArc(arcFont, text, gapR, r * 0.17, 1.5);
    const half = span / 2;
    arcText(page, text, {
      cx, cy, radius: gapR + size * 0.35, font: arcFont, size, color: ink, degrees,
      angleFn: t => -Math.PI / 2 - half + 2 * half * t,
      rotFn: a => a + Math.PI / 2,
    });
  } else if (star) {
    // Sized to sit inside the ring gap without touching either ring.
    const starR = r * 0.09;
    page.drawSvgPath(starPath(), {
      x: cx,
      y: cy - gapR,
      scale: starR,
      color: ink,
      borderWidth: 0,
    });
  }
}
