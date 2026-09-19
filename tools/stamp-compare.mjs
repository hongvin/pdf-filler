/**
 * Renders the same document twice — once with the bundled company stamp, once
 * with the generated ring — so the two can be compared side by side.
 *
 * The point is that they must occupy the *same box*. Both are driven off
 * STAMP_DIAMETER_EM in lib/fill.js; if that ever drifts, the printed geometry
 * below will show it before anyone has to eyeball a PDF.
 *
 * It also writes an *isolated* pair — a blank page carrying nothing but the
 * stamp. Measuring the footprint on the real template is useless, because the
 * template's own printed text sits in the same window; on a blank page the only
 * ink is the stamp, so tools/stamp-render.py can measure it honestly.
 *
 *   node tools/stamp-compare.mjs [input.pdf]
 *   python tools/stamp-render.py
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as PDFLib from 'pdf-lib';
import * as fontkitNs from '@pdf-lib/fontkit';

import { analyseDocument } from '../public/lib/analyse.js';
import { fillDocument, STAMP_DIAMETER_EM } from '../public/lib/fill.js';

const fontkit = fontkitNs.default || fontkitNs;
const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const input = process.argv[2] || '/Users/hongvin/Downloads/QT-2026-307-pact.pdf';

pdfjs.GlobalWorkerOptions.workerSrc = path.join(
  ROOT, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs',
);

const stampPng = new Uint8Array(
  fs.readFileSync(path.join(ROOT, 'public/stamp/company-stamp.png')),
);

/** The same stamp blank on a blank page, so nothing else can be measured. */
const ISO = {
  page: [612, 792],                     // US Letter
  blank: { pageIndex: 0, role: 'stamp', x0: 100, x1: 500, baseline: 400, size: 12, value: '' },
};
const isoBox = (() => {
  const b = ISO.blank;
  const d = b.size * STAMP_DIAMETER_EM;
  const cx = b.x0 + (b.x1 - b.x0) * 0.72;
  const cy = b.baseline + b.size * 0.35;
  return [cx - d / 2, cy - d / 2, cx + d / 2, cy + d / 2];
})();

async function fill(pdfBytes, blanks, extra) {
  return fillDocument({
    PDFLib, fontkit, pdfBytes, blanks, config: { ...BASE, ...extra },
  });
}

const BASE = {
  name: 'Koay Hong Vin',
  icNumber: '970529-02-5353',
  companyName: 'EDGE INTELLIGENCE SDN. BHD.',
  companyReg: '202301036017',
  date: '18 September 2026',
  signatureText: 'HongVin',
  signatureFontBytes: new Uint8Array(
    fs.readFileSync(path.join(ROOT, 'public/fonts/KaushanScript-Regular.ttf')),
  ),
  signatureSubset: true,
  stampLine1: '',
  stampLine2: '(1529940-V)',
  stampStar: true,
  stampScale: 1,
};

const MODES = [
  ['generated', 'generated ring', { stampMode: 'generated', stampImageBytes: null }],
  ['image', 'bundled artwork', { stampMode: 'logo', stampImageBytes: stampPng }],
];

function write(name, bytes) {
  const out = path.join(ROOT, 'tools', name);
  fs.writeFileSync(out, bytes);
  return `${(bytes.length / 1024).toFixed(0)} KB`;
}

// ---- isolated: measure the footprint ------------------------------------
const blankDoc = await PDFLib.PDFDocument.create();
blankDoc.addPage(ISO.page);
const blankBytes = await blankDoc.save();

console.log(`PDF: ${path.relative(ROOT, input)}`);
console.log(`isolated stamp box (PDF pt): `
  + `x[${isoBox[0].toFixed(2)} .. ${isoBox[2].toFixed(2)}] `
  + `y[${isoBox[1].toFixed(2)} .. ${isoBox[3].toFixed(2)}]  `
  + `diameter=${(ISO.blank.size * STAMP_DIAMETER_EM).toFixed(2)}`);

console.log('\n--- isolated (nothing on the page but the stamp) ---');
for (const [id, label, extra] of MODES) {
  const { bytes } = await fill(blankBytes, [{ ...ISO.blank }], extra);
  console.log(`  ${label.padEnd(16)} -> stamp-iso-${id}.pdf  ${write(`stamp-iso-${id}.pdf`, bytes)}`);
}

// ---- on the real template, for eyeballing -------------------------------
const bytes = new Uint8Array(fs.readFileSync(input));
const doc = await pdfjs.getDocument({
  data: bytes.slice(), useSystemFonts: false, isEvalSupported: false, disableFontFace: true,
}).promise;

const pages = [];
for (let i = 0; i < doc.numPages; i++) {
  const page = await doc.getPage(i + 1);
  const vp = page.getViewport({ scale: 1 });
  pages.push({
    pageIndex: i,
    textContent: await page.getTextContent(),
    opList: await page.getOperatorList(),
    width: vp.width,
    height: vp.height,
  });
}

console.log('\n--- on the real template ---');
for (const [id, label, extra] of MODES) {
  // Re-detect for each run: fillDocument mutates `blank.value`.
  const { blanks } = await analyseDocument({ PDFLib, pdfBytes: bytes, pages, OPS: pdfjs.OPS });
  for (const b of blanks) {
    b.value = b.role === 'name' ? BASE.name
      : b.role === 'ic' ? BASE.icNumber
        : b.role === 'company' ? BASE.companyName
          : b.role === 'companyReg' ? BASE.companyReg
            : b.role === 'date' ? BASE.date : '';
  }
  const result = await fill(bytes, blanks, extra);
  const stamp = blanks.find(b => b.role === 'stamp');
  console.log(`  ${label.padEnd(16)} p${stamp ? stamp.page : '?'} `
    + `size=${stamp ? stamp.size.toFixed(1) : '-'} -> stamp-${id}.pdf  `
    + write(`stamp-${id}.pdf`, result.bytes));
}

