/**
 * One place that turns a PDF into "blanks with roles".
 *
 * Both the browser UI and the Node test harness call this, so the harness can
 * never drift from what actually ships.
 */

import { detectBlanks } from './detect.js';
import { assignRoles } from './roles.js';
import { listFormFields } from './fill.js';

/**
 * @param {object}   opts
 * @param {object}   opts.PDFLib     pdf-lib namespace
 * @param {Uint8Array} opts.pdfBytes raw file bytes
 * @param {Array}    opts.pages      [{ pageIndex, textContent, opList, width, height }]
 * @param {object}   [opts.OPS]      pdf.js OPS table, enables drawn-rule detection
 * @returns {Promise<{mode:'form'|'flat', blanks:Array, hints:object}>}
 */
export async function analyseDocument({ PDFLib, pdfBytes, pages, OPS }) {
  // A real form layer is a stronger signal than geometry, so prefer it.
  let fields = [];
  try {
    fields = await listFormFields({ PDFLib, pdfBytes });
  } catch { /* not a form, or unreadable form dictionary */ }

  if (fields.length) {
    const blanks = fields.map((f, i) => ({
      id: 'f' + (i + 1),
      fieldName: f.fieldName,
      namespace: f.namespace,
      leaf: f.leaf,
      fieldType: f.type,
      pageIndex: f.pageIndex,
      page: f.pageIndex + 1,
      label: f.leaf,
      kind: 'field',
      clear: false, // a form field has no printed dots to white out
      ...(f.rect || { x0: 0, x1: 0, baseline: 0, size: 12 }),
    }));
    assignRoles(blanks, {});
    return { mode: 'form', blanks, hints: {} };
  }

  const { blanks, docHints } = detectBlanks({ pages, OPS });
  // `assignRoles` also handles the "document prints its own company name, so an
  // unlabelled blank is the company field" case — it lives there rather than
  // here so the rule is in one place and applies to form mode too.
  assignRoles(blanks, docHints);

  return { mode: 'flat', blanks, hints: docHints };
}
