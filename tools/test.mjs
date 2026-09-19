/**
 * Headless end-to-end check.
 *
 * Runs the exact browser modules — including lib/analyse.js, which is what the
 * UI itself calls — against a real PDF, prints what was found, writes the
 * filled result, and rasterises it so the placement can be eyeballed.
 *
 *   node tools/test.mjs [input.pdf] [output.pdf]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as PDFLib from 'pdf-lib';
import * as fontkitNs from '@pdf-lib/fontkit';

import { analyseDocument } from '../public/lib/analyse.js';
import { fillDocument } from '../public/lib/fill.js';

// CJS/ESM interop: the fontkit namespace object is not itself the API.
const fontkit = fontkitNs.default || fontkitNs;

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const input = process.argv[2] || '/Users/hongvin/Downloads/QT-2026-307-pact.pdf';
const output = process.argv[3] || path.join(ROOT, 'tools', 'filled.pdf');

pdfjs.GlobalWorkerOptions.workerSrc = path.join(
  ROOT, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs',
);

const bytes = new Uint8Array(fs.readFileSync(input));
const doc = await pdfjs.getDocument({
  data: bytes.slice(),
  useSystemFonts: false,
  isEvalSupported: false,
  disableFontFace: true,
}).promise;

console.log(`PDF: ${input}`);
console.log(`pages: ${doc.numPages}`);

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

const { mode, blanks, hints } = await analyseDocument({
  PDFLib, pdfBytes: bytes, pages, OPS: pdfjs.OPS,
});

console.log(`\ndetection mode: ${mode}`);
if (Object.keys(hints).length) console.log('document hints:', hints);
console.log(`\nblank regions detected: ${blanks.length}`);
for (const b of blanks) {
  const where = b.kind === 'field'
    ? `field=${b.fieldName}`
    : `x[${b.x0.toFixed(1)}..${b.x1.toFixed(1)}] baseline=${b.baseline.toFixed(1)} size=${b.size.toFixed(1)}`;
  console.log(`  p${b.page} ${String(b.kind).padEnd(9)} ${b.role.padEnd(11)} <- ${JSON.stringify(b.label)}  ${where}`);
}

const config = {
  name: 'Koay Hong Vin',
  icNumber: '970529-02-5353',
  companyName: hints.companyName || 'EDGE INTELLIGENCE SDN. BHD.',
  companyReg: hints.companyReg || '202301036017',
  date: '18 September 2026',
  signatureText: 'HongVin',
  signatureFontBytes: new Uint8Array(fs.readFileSync(path.join(ROOT, 'public/fonts/KaushanScript-Regular.ttf'))),
  signatureSubset: true,
  stampLine1: '',
  stampLine2: '(1529940-V)',
  stampStar: true,
  stampMode: 'generated',
};

for (const b of blanks) {
  b.value = b.role === 'name' ? config.name
    : b.role === 'ic' ? config.icNumber
      : b.role === 'company' ? config.companyName
        : b.role === 'companyReg' ? config.companyReg
          : b.role === 'date' ? config.date
            : '';
}

const result = await fillDocument({ PDFLib, fontkit, pdfBytes: bytes, blanks, config });
fs.writeFileSync(output, result.bytes);
console.log(`\nwrote ${output} (${result.bytes.length} bytes)`);
console.log(`annotations removed over filled blanks: ${result.removedAnnotations}`);
