/**
 * Regression checks for the detection fixes. Each case is a small PDF built
 * here so the encoding is under our control.
 *
 *   node tools/check-detection.mjs
 *
 * 1. fixture-rect.pdf really is a `constructPath` + `re` document, and the
 *    rules in it are found. (They were silently invisible before the rectangle
 *    case was added to findUnderlines.)
 * 2. A blank whose label we failed to recognise is NOT rewritten to `company`
 *    just because the document prints a company name. It used to be, which put
 *    the company name on the "Jawatan" line of a declaration.
 * 3. An unlabelled blank IS still offered as the company field.
 * 4. A dot leader merged with a drawn rule is classified as `mixed`, so the
 *    blank can be told apart from a plain drawn rule.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as PDFLib from 'pdf-lib';
import { detectBlanks } from '../public/lib/detect.js';
import { assignRoles } from '../public/lib/roles.js';
import { hasPrintedDots } from '../public/lib/fill.js';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const { PDFDocument, StandardFonts, rgb } = PDFLib;
const names = Object.fromEntries(Object.entries(pdfjs.OPS).map(([k, v]) => [v, k]));

const failures = [];
function check(name, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures.push(name);
}

/** Render a document's first page into the shape detectBlanks wants. */
async function analyse(doc) {
  const bytes = new Uint8Array(await doc.save());
  const pdoc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  const page = await pdoc.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const pages = [{
    pageIndex: 0,
    textContent: await page.getTextContent(),
    opList: await page.getOperatorList(),
    width: vp.width,
    height: vp.height,
  }];
  const { blanks, docHints } = detectBlanks({ pages, OPS: pdfjs.OPS });
  assignRoles(blanks, docHints);
  return { blanks, docHints, page, opList: pages[0].opList, width: vp.width };
}

/* ---------------------------------------------------------------- 1 */

{
  const bytes = new Uint8Array(fs.readFileSync(path.join(ROOT, 'tools/fixture-rect.pdf')));
  const pdoc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  const page = await pdoc.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const op = await page.getOperatorList();

  let inConstructPath = 0;
  let standalone = 0;
  for (let i = 0; i < op.fnArray.length; i++) {
    const n = names[op.fnArray[i]];
    if (n === 'constructPath' && op.argsArray[i][0].map(c => names[c]).includes('rectangle')) inConstructPath++;
    if (n === 'rectangle') standalone++;
  }
  check('fixture-rect uses constructPath + re, not a standalone rectangle op',
    inConstructPath === 6 && standalone === 0,
    `constructPath=${inConstructPath} standalone=${standalone}`);

  const { blanks } = await analyse(await PDFDocument.load(bytes));
  check('fixture-rect rules are detected', blanks.length === 6, `${blanks.length} blanks`);
}

/* ---------------------------------------------------------------- 2 & 3 */

{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const page = doc.addPage([595, 842]);
  const line = (t, y, x = 40) => page.drawText(t, { x, y, size: 12, font, color: rgb(0, 0, 0) });
  const rule = (y, x0, x1) => page.drawLine({
    start: { x: x0, y }, end: { x: x1, y }, thickness: 0.8, color: rgb(0, 0, 0),
  });

  // The document prints its own company name, so docHints.companyName is set.
  line('EDGE INTELLIGENCE SDN. BHD.', 800);
  line('No. Pendaftaran : 202301036017', 780);
  // A blank whose label we do not recognise — a real field for something else.
  line('Jawatan', 640);
  rule(638, 120, 400);

  const { blanks, docHints } = await analyse(doc);
  check('document hints still pick up the company name', !!docHints.companyName, docHints.companyName);

  const jawatan = blanks.find(b => b.label === 'Jawatan');
  check('a labelled but unrecognised blank is left alone',
    jawatan && jawatan.role === 'ignore', jawatan && `role=${jawatan.role}`);
}

{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const page = doc.addPage([595, 842]);

  // Dots at the very top, so there is no line above to borrow a label from and
  // nothing to the left of them: a genuinely unlabelled blank.
  page.drawText('.......................', { x: 160, y: 700, size: 12, font, color: rgb(0, 0, 0) });
  // The company name is printed, but well below, so it is not a label.
  page.drawText('EDGE INTELLIGENCE SDN. BHD.', { x: 40, y: 400, size: 12, font, color: rgb(0, 0, 0) });

  const { blanks, docHints } = await analyse(doc);
  check('an unlabelled blank is still offered as the company field',
    !!docHints.companyName && blanks.some(b => b.role === 'company' && !b.label),
    blanks.map(b => `${JSON.stringify(b.label)}:${b.role}`).join(' '));
}

/* ---------------------------------------------------------------- 4 */

{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const page = doc.addPage([595, 842]);

  // Word-style line: a literal dot leader with a bottom border 3pt lower. The
  // two merge into one region, which used to be classified in a way that
  // disabled dot clearing.
  page.drawText('Nama : ..........................', { x: 40, y: 700, size: 12, font, color: rgb(0, 0, 0) });
  page.drawLine({
    start: { x: 130, y: 697 }, end: { x: 500, y: 697 }, thickness: 0.8, color: rgb(0, 0, 0),
  });

  const { blanks } = await analyse(doc);
  const region = blanks[0];
  // Clearing no longer happens — the dotted line is the form's own structure.
  // What still matters here is that the merged region is classified `mixed`
  // (so callers can tell it apart from a plain drawn rule) and that
  // hasPrintedDots correctly flags it.
  check('a merged dot+rule region is classified as mixed',
    !!region && region.kind === 'mixed',
    region && `kind=${region.kind}`);
  check('hasPrintedDots still flags the merged region',
    !!region && hasPrintedDots(region),
    region && `kind=${region.kind} hasPrintedDots=${hasPrintedDots(region)}`);
  check('the merged region still resolves to a role', !!region && region.role === 'name',
    region && `role=${region.role} label=${JSON.stringify(region.label)}`);
}

console.log(failures.length ? `\n${failures.length} check(s) failed.` : '\nAll checks passed.');
process.exit(failures.length ? 1 : 0);
