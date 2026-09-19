/**
 * Mapping from a human label on the page to a semantic role.
 *
 * Templates like this are bilingual-ish: Malay body text with English
 * alternatives creeping in ("Nama / Name", "Tandatangan / Signature"). The
 * rules below cover both, ordered most-specific-first so that, for example,
 * "No.Kad Pengenalan" is claimed by `ic` before anything else can grab it.
 */

export const ROLES = [
  { id: 'signature',  label: 'Signature',        render: 'signature' },
  { id: 'stamp',      label: 'Company stamp',    render: 'stamp' },
  { id: 'ic',         label: 'IC number',        render: 'text' },
  { id: 'companyReg', label: 'Company reg. no.', render: 'text' },
  { id: 'company',    label: 'Company name',     render: 'text' },
  { id: 'date',       label: 'Date',             render: 'text' },
  { id: 'name',       label: 'Full name',        render: 'text' },
  { id: 'ignore',     label: '— ignore —',       render: 'none' },
];

export const ROLE_BY_ID = Object.fromEntries(ROLES.map(r => [r.id, r]));

const RULES = [
  { role: 'signature',  re: /tandatangan|signature|ditandatangani|signed\s*by/i },
  { role: 'stamp',      re: /cop\s*(syarikat|company)|company\s*(stamp|seal)|cap\s*syarikat|\bstamp\b|\bcop\b/i },
  { role: 'ic',         re: /kad\s*pengenalan|no\.?\s*kad|nric|identity\s*card|\bno\.?\s*i\.?c\.?\b|\bic\b/i },
  { role: 'companyReg', re: /no\.?\s*pendaftaran|nombor\s*pendaftaran|registration\s*(no|number)|\broc\b|\bno\.?\s*syarikat\b/i },
  { role: 'company',    re: /nama\s*syarikat|syarikat|company|firma|\bfirm\b/i },
  { role: 'date',       re: /tarikh|\bdate\b|\bhari\b/i },
  { role: 'name',       re: /\bnama\b|\bname\b|saya\b|pemohon|bidder/i },
];

/** Best-guess role for a label. Returns 'ignore' when nothing matches. */
export function mapRole(label) {
  if (!label) return 'ignore';
  for (const rule of RULES) {
    if (rule.re.test(label)) return rule.role;
  }
  return 'ignore';
}

/**
 * Role suggestions for a whole document. A few guard rails that a single
 * label-by-label pass gets wrong:
 *
 *   - Only one signature and one stamp slot per document; if the label is
 *     ambiguous, the first plausible candidate wins and later ones fall back.
 *   - A second `name` blank is more likely the company than a duplicate person.
 */
export function assignRoles(blanks, hints = {}) {
  for (const b of blanks) {
    b.role = mapRole(b.label);
  }
  // Deduplicate singleton roles.
  for (const role of ['signature', 'stamp']) {
    blanks.filter(b => b.role === role).slice(1).forEach(b => { b.role = 'ignore'; });
  }
  // If the document already prints the company name, a blank carrying no label
  // at all is most likely the company field.
  //
  // It has to be genuinely *unlabelled*. `role === 'ignore'` also covers blanks
  // whose label we simply failed to recognise — "Jawatan" (position), say — and
  // those are real fields for something else. Rewriting one of those to
  // `company` prints the company name on the wrong line of a statutory
  // declaration, which is far worse than leaving it for the user to set.
  //
  // Prefer a drawn rule over a dot run: an unlabelled company line in a
  // template is usually a rule, and dot runs with no label are as likely to be
  // part of a table.
  if (hints.companyName && !blanks.some(b => b.role === 'company')) {
    const spare = blanks.find(b => b.role === 'ignore' && !b.label && b.kind !== 'dots')
      || blanks.find(b => b.role === 'ignore' && !b.label && b.kind === 'dots');
    if (spare) spare.role = 'company';
  }
  return blanks;
}
