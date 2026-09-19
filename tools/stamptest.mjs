/**
 * Renders the generated stamp at poster size next to the reference crop, so the
 * two can be compared directly.
 *
 *   node tools/stamptest.mjs
 */

import fs from 'node:fs';
import * as PDFLib from 'pdf-lib';
import * as fontkitNs from '@pdf-lib/fontkit';
import { drawGeneratedStamp } from '../public/lib/stamp.js';

const fontkit = fontkitNs.default || fontkitNs;

const doc = await PDFLib.PDFDocument.create();
doc.registerFontkit(fontkit);
const sans = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
const sansBold = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
const label = await doc.embedFont(PDFLib.StandardFonts.Helvetica);

const opts = {
  company: 'EDGE INTELLIGENCE SDN. BHD.',
  lines: ['202301036017', '(1529940-V)'],
  star: true,
  arcFont: sansBold,
  centreFont: sans,
  PDFLib,
};

// page 1 — poster, next to the reference crop
const p1 = doc.addPage([760, 430]);
drawGeneratedStamp(p1, { ...opts, cx: 215, cy: 215, r: 170 });
p1.drawText('generated', { x: 160, y: 20, size: 9, font: label });

const refBytes = new Uint8Array(fs.readFileSync('tools/ref-stamp.png'));
const ref = await doc.embedPng(refBytes);
const refW = 400;
p1.drawImage(ref, { x: 350, y: 215 - (ref.height * (refW / ref.width)) / 2, width: refW, height: ref.height * (refW / ref.width) });
p1.drawText('reference', { x: 520, y: 20, size: 9, font: label });

// page 2 — the sizes actually used on a form
const p2 = doc.addPage([520, 260]);
for (const [i, r] of [41, 34, 28].entries()) {
  drawGeneratedStamp(p2, { ...opts, cx: 95 + i * 160, cy: 150, r });
  p2.drawText(`r=${r}`, { x: 72 + i * 160, y: 70, size: 10, font: label });
}

fs.writeFileSync('/tmp/stamp-compare.pdf', await doc.save());
console.log('wrote /tmp/stamp-compare.pdf');
