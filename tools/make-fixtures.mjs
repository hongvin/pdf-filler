/**
 * Generates test fixtures for the code paths that the real declaration PDF
 * cannot exercise:
 *
 *   A. AcroForm PDF — real form fields with namespace-style names, so the
 *      "detect the namespace" branch in fill.js gets tested.
 *   B. Underline PDF — flat, but blanks are drawn rules rather than dot runs.
 *      pdf-lib emits these as moveTo/lineTo, one encoding among several.
 *   C. `re` PDF — the same flat shape, but the rules are drawn with the `re`
 *      operator, which is what Word / LibreOffice / Acrobat actually emit.
 *      pdf.js packs `re` into constructPath as a *command*, so this fixture
 *      covers a different branch of findUnderlines than B does. It exists
 *      because B alone passed while C was silently detecting nothing.
 *
 *   node tools/make-fixtures.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as PDFLib from 'pdf-lib';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = path.join(ROOT, 'tools');
const { PDFDocument, StandardFonts, rgb } = PDFLib;

/* ---------------------------------------------------------------- */
/* A. AcroForm with namespaced field names                          */
/* ---------------------------------------------------------------- */

{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const page = doc.addPage([595, 842]);
  const form = doc.getForm();

  const line = (text, y, size = 12, x = 40) =>
    page.drawText(text, { x, y, size, font, color: rgb(0, 0, 0) });

  line('UNIVERSITI MALAYA', 780, 14, 220);
  line('SURAT AKUAN PEMBIDA', 750, 13, 224);
  line('Saya,', 700);
  line('No.Kad Pengenalan', 670);
  line('Nama', 640);
  line('Tandatangan', 610);
  line('Cop Syarikat', 580);

  // Names deliberately shaped like a real template's namespace tree.
  const fields = [
    ['topmostSubform[0].Page1[0].Nama[0]', 700],
    ['topmostSubform[0].Page1[0].NoKadPengenalan[0]', 670],
    ['topmostSubform[0].Page1[0].Tandatangan[0]', 610],
    ['topmostSubform[0].Page1[0].CopSyarikat[0]', 580],
  ];
  for (const [name, y] of fields) {
    const f = form.createTextField(name);
    f.addToPage(page, { x: 160, y: y - 4, width: 260, height: 20 });
  }

  const out = await doc.save();
  fs.writeFileSync(path.join(OUT, 'fixture-acroform.pdf'), out);
  console.log('wrote fixture-acroform.pdf', out.length, 'bytes');
}

/* ---------------------------------------------------------------- */
/* B. Flat PDF with drawn underline blanks                          */
/* ---------------------------------------------------------------- */

{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const page = doc.addPage([595, 842]);

  const line = (text, y, size = 12, x = 40) =>
    page.drawText(text, { x, y, size, font, color: rgb(0, 0, 0) });

  const rule = (y, x0 = 160, x1 = 500) =>
    page.drawLine({
      start: { x: x0, y }, end: { x: x1, y },
      thickness: 0.7, color: rgb(0.1, 0.1, 0.1),
    });

  line('SURAT PERAKUAN', 780, 14, 220);
  line('Nama', 700);
  rule(697);
  line('No.Kad Pengenalan', 665);
  rule(662);
  line('Jawatan', 630);
  rule(627);
  line('Tarikh', 595);
  rule(592);
  line('Tandatangan', 540);
  rule(537);
  line('Cop Syarikat', 490);
  rule(487);

  const out = await doc.save();
  fs.writeFileSync(path.join(OUT, 'fixture-underline.pdf'), out);
  console.log('wrote fixture-underline.pdf', out.length, 'bytes');
}

/* ---------------------------------------------------------------- */
/* C. Same shape, but rules drawn with the `re` operator            */
/* ---------------------------------------------------------------- */

{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const page = doc.addPage([595, 842]);

  const line = (text, y, size = 12, x = 40) =>
    page.drawText(text, { x, y, size, font, color: rgb(0, 0, 0) });

  // `re` then `f`: a filled bar. This is the encoding that matters — Word,
  // LibreOffice and Acrobat all draw a fill-in rule this way, and pdf.js hands
  // it over as a constructPath whose command list is [OPS.rectangle].
  const rule = (y, x0 = 160, x1 = 500) =>
    page.pushOperators(
      PDFLib.setFillingRgbColor(0.1, 0.1, 0.1),
      PDFLib.rectangle(x0, y, x1 - x0, 1),
      PDFLib.fill(),
    );

  line('SURAT PERAKUAN', 780, 14, 220);
  line('Nama', 700);
  rule(697);
  line('No.Kad Pengenalan', 665);
  rule(662);
  line('Jawatan', 630);
  rule(627);
  line('Tarikh', 595);
  rule(592);
  line('Tandatangan', 540);
  rule(537);
  line('Cop Syarikat', 490);
  rule(487);

  const out = await doc.save();
  fs.writeFileSync(path.join(OUT, 'fixture-rect.pdf'), out);
  console.log('wrote fixture-rect.pdf', out.length, 'bytes');
}
