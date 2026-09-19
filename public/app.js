/**
 * Form Filler — UI layer.
 *
 * Everything happens in the browser: the PDF is parsed with pdf.js, blanks are
 * located by lib/detect.js, and the result is written with pdf-lib. The file is
 * never uploaded anywhere. The only server call is /api/config, which hands
 * back the values that should not live in the page bundle (the IC number).
 */

import * as pdfjsLib from './vendor/pdf.min.mjs';
import { ROLES, ROLE_BY_ID } from './lib/roles.js';
import { analyseDocument } from './lib/analyse.js';
import { fillDocument, countOverlappingAnnotations, hasPrintedDots } from './lib/fill.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.mjs';

const PDFLib = window.PDFLib;
const fontkit = window.fontkit;

/* ------------------------------------------------------------------ */
/* constants                                                           */
/* ------------------------------------------------------------------ */

const ROLE_COLORS = {
  name: '#2563eb',
  ic: '#7c3aed',
  signature: '#059669',
  stamp: '#d97706',
  company: '#0891b2',
  companyReg: '#0d9488',
  date: '#db2777',
  ignore: '#98a2b3',
};

const STORE_KEY = 'pdfFiller.settings.v1';
// The IC is never written here — this key is a leftover from an early build that
// did persist it, and is only kept so "Reset" can clean up that browser.
const IC_STORE_KEY = 'pdfFiller.ic.v1';

/**
 * The company stamp artwork shipped with the app.
 *
 * Deliberately *not* stored in localStorage: it is ~180 KB of base64 that would
 * eat a third of the quota, never changes, and is already on the server. It is
 * fetched once at boot and kept in memory.
 */
const BUNDLED_STAMP_URL = './stamp/company-stamp.png';

/** Stamp sources. `image` is the legacy id for `upload`, migrated on load. */
const STAMP_MODES = ['logo', 'generated', 'upload'];
const DEFAULT_STAMP_MODE = 'logo';

/**
 * Bundled signature typefaces. All SIL Open Font License.
 *
 * `subset: false` is only needed for faces pdf-lib's bundled subsetter mangles
 * — currently just Great Vibes, which renders as two stray marks when subset.
 * Verified per font by tools/subset-check.mjs.
 */
const SIGNATURE_FONTS = [
  { id: 'KaushanScript', file: 'KaushanScript-Regular.ttf', label: 'Kaushan Script — bold brush', subset: true },
  { id: 'Norican', file: 'Norican-Regular.ttf', label: 'Norican — rounded script', subset: true },
  { id: 'MrDafoe', file: 'MrDafoe-Regular.ttf', label: 'Mr Dafoe — fine brush', subset: true },
  { id: 'GreatVibes', file: 'GreatVibes-Regular.ttf', label: 'Great Vibes — elegant, thin', subset: false },
];
const FONT_BY_ID = Object.fromEntries(SIGNATURE_FONTS.map(f => [f.id, f]));

const $ = id => document.getElementById(id);

const els = {
  dropzone: $('dropzone'), fileInput: $('fileInput'), fileCard: $('fileCard'),
  fileName: $('fileName'), fileInfo: $('fileInfo'), clearFile: $('clearFile'),
  detectNote: $('detectNote'), fieldsCard: $('fieldsCard'), fieldsBody: $('fieldsBody'),
  fieldCount: $('fieldCount'), valuesCard: $('valuesCard'), signCard: $('signCard'),
  stampCard: $('stampCard'), actions: $('actions'), preview: $('preview'),
  previewEmpty: $('previewEmpty'), legend: $('legend'), configPill: $('configPill'),
  banner: $('banner'), fillBtn: $('fillBtn'), fillStatus: $('fillStatus'),
  resetBtn: $('resetBtn'), stampGenOpts: $('stampGenOpts'), stampImgOpts: $('stampImgOpts'),
  stampLogoOpts: $('stampLogoOpts'), stripRow: $('stripRow'),
};

/** Scans are kept in localStorage as base64, which caps out around 5 MB. */
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;

const state = {
  bytes: null,
  fileName: '',
  pdfDoc: null,
  pages: [],      // [{ pageIndex, width, height, viewport }]
  blanks: [],
  mode: 'flat',   // 'flat' | 'form'
  hints: {},
  settings: {
    name: '', ic: '', company: '', companyReg: '', date: '',
    sigText: 'HongVin', sigFont: 'KaushanScript', sigScale: 1,
    stampMode: DEFAULT_STAMP_MODE, stampLine1: '', stampLine2: '', stampBottom: '',
    stampBottomMode: 'star', stampScale: 1,
    sigImage: null, stampImage: null,
  },
  configLoaded: false,
  icFromServer: false,
  bundledStamp: null,        // data URL of the bundled artwork, once fetched
  bundledStampError: false,
  staleAnnotations: 0,
  stripAnnotations: true,
  rendering: false,
  renderQueued: false,
};

/* ------------------------------------------------------------------ */
/* settings persistence                                                */
/* ------------------------------------------------------------------ */

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) Object.assign(state.settings, JSON.parse(raw));
  } catch { /* ignore corrupt storage */ }
  if (!state.settings.companyReg) state.settings.companyReg = '';
  state.settings.ic = ''; // never restored from disk; comes from the server or the user

  // Migrate the stamp mode. Early builds only had 'generated' and 'image'; the
  // image source is now split into the bundled artwork ('logo') and a user scan
  // ('upload'), so 'image' means the latter. Anything unrecognised falls back to
  // the default rather than leaving every stamp panel hidden.
  if (state.settings.stampMode === 'image') state.settings.stampMode = 'upload';
  if (!STAMP_MODES.includes(state.settings.stampMode)) {
    state.settings.stampMode = DEFAULT_STAMP_MODE;
  }
}

let saveTimer = null;
let saveWarned = false;

/**
 * Persist the settings.
 *
 * Debounced, because the signature and stamp scans live in here as base64 data
 * URLs and `input` fires on every keystroke — re-serialising a couple of
 * megabytes per character is enough to make typing stutter.
 */
function saveSettings({ immediate = false } = {}) {
  clearTimeout(saveTimer);
  if (immediate) { writeSettings(); return; }
  saveTimer = setTimeout(writeSettings, 250);
}

/** Write out anything still pending. Used when the page is going away. */
function flushSettings() {
  if (saveTimer) writeSettings();
}

function writeSettings() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const { ic, ...rest } = state.settings;
  void ic; // never persisted
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(rest));
    saveWarned = false;
  } catch {
    // Quota exceeded, or storage disabled. Say so — silently swallowing this
    // means the values look saved and then quietly vanish on the next reload.
    if (!saveWarned) {
      saveWarned = true;
      showBanner('This browser refused to save your settings — its storage is full or turned off. '
        + 'The values still work for this session, but they will not be remembered. '
        + 'A large scanned signature or stamp is the usual cause; try a smaller image.');
    }
  }
}

function cancelPendingSave() {
  clearTimeout(saveTimer);
  saveTimer = null;
}

/* ------------------------------------------------------------------ */
/* server config                                                       */
/* ------------------------------------------------------------------ */

async function loadConfig() {
  let cfg = null;
  try {
    const res = await fetch('./api/config', { headers: { accept: 'application/json' } });
    if (res.ok) cfg = await res.json();
    else if (res.status === 503) {
      const body = await res.json().catch(() => ({}));
      showBanner(body.message || 'Server config is not set up yet — fill the values in by hand.');
    }
  } catch {
    showBanner('Could not reach /api/config — fill the values in by hand.');
  }

  if (cfg) {
    if (cfg.name) state.settings.name = cfg.name;
    if (cfg.icNumber) { state.settings.ic = cfg.icNumber; state.icFromServer = true; }
    if (cfg.companyName) state.settings.company = cfg.companyName;
    if (cfg.companyReg) state.settings.companyReg = cfg.companyReg;
    if (cfg.signatureText) state.settings.sigText = cfg.signatureText;
    if (cfg.signatureFont && FONT_BY_ID[cfg.signatureFont]) state.settings.sigFont = cfg.signatureFont;
    if (cfg.stampLine2) state.settings.stampLine2 = cfg.stampLine2;
    if (cfg.stampBottomText) {
      state.settings.stampBottomMode = 'text';
      state.settings.stampBottom = cfg.stampBottomText;
    }
    els.configPill.textContent = 'config loaded';
    els.configPill.className = 'pill pill-ok';
  } else {
    els.configPill.textContent = 'no server config';
    els.configPill.className = 'pill pill-warn';
  }
  state.configLoaded = true;
  syncInputs();
}

function showBanner(msg) {
  els.banner.textContent = msg;
  els.banner.hidden = false;
}

/**
 * Fetch the bundled stamp artwork once, as a data URL.
 *
 * Failure is not fatal — the stamp simply falls back to the generated ring — so
 * this never throws, it just records the problem for `syncInputs` to report.
 */
async function loadBundledStamp() {
  try {
    const res = await fetch(BUNDLED_STAMP_URL);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    state.bundledStamp = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('could not read the image'));
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.warn('bundled stamp unavailable:', err);
    state.bundledStampError = true;
  }
  syncInputs();
}

/* ------------------------------------------------------------------ */
/* inputs                                                              */
/* ------------------------------------------------------------------ */

function syncInputs() {
  const s = state.settings;
  $('vName').value = s.name;
  $('vIc').value = s.ic;
  $('vCompany').value = s.company;
  $('vCompanyReg').value = s.companyReg;
  $('vDate').value = s.date;
  $('vSigText').value = s.sigText;
  $('vSigScale').value = s.sigScale;
  $('vStampLine1').value = s.stampLine1;
  $('vStampLine2').value = s.stampLine2;
  $('vStampBottom').value = s.stampBottom;
  $('vStampScale').value = s.stampScale;
  $('sigScaleOut').textContent = Number(s.sigScale).toFixed(1) + '×';
  $('stampScaleOut').textContent = Number(s.stampScale).toFixed(1) + '×';
  $('icSource').textContent = state.icFromServer ? 'from server' : '';
  $('sigClearBtn').hidden = !s.sigImage;
  $('stampClearBtn').hidden = !s.stampImage;

  const font = FONT_BY_ID[s.sigFont] || SIGNATURE_FONTS[0];
  $('sigState').textContent = s.sigImage
    ? 'Using your scanned signature'
    : 'Cursive typeface: ' + font.label.split(' — ')[0];

  $('vSigFont').value = font.id;
  $('vStampBottomMode').value = s.stampBottomMode;
  $('stampBottomTextRow').hidden = s.stampBottomMode !== 'text';

  const thumb = $('stampLogoThumb');
  if (state.bundledStamp) {
    thumb.src = state.bundledStamp;
    thumb.hidden = false;
  } else {
    thumb.hidden = true;
  }
  $('stampLogoState').textContent = state.bundledStamp
    ? 'The company stamp bundled with this app.'
    : state.bundledStampError
      ? 'The bundled stamp could not be loaded, so a generated one will be drawn instead.'
      : 'Loading the bundled stamp…';

  setStampMode(s.stampMode);
}

function populateFontSelect() {
  const sel = $('vSigFont');
  sel.innerHTML = '';
  for (const f of SIGNATURE_FONTS) {
    const o = document.createElement('option');
    o.value = f.id;
    o.textContent = f.label;
    sel.appendChild(o);
  }
}

function wireInputs() {
  const bind = (id, key) => {
    $(id).addEventListener('input', e => { state.settings[key] = e.target.value; saveSettings(); });
  };
  bind('vName', 'name');
  bind('vIc', 'ic');
  bind('vCompany', 'company');
  bind('vCompanyReg', 'companyReg');
  bind('vDate', 'date');
  bind('vSigText', 'sigText');
  bind('vStampLine1', 'stampLine1');
  bind('vStampLine2', 'stampLine2');
  bind('vStampBottom', 'stampBottom');

  $('vSigFont').addEventListener('change', e => {
    state.settings.sigFont = e.target.value;
    saveSettings();
    syncInputs();
  });
  $('vStampBottomMode').addEventListener('change', e => {
    state.settings.stampBottomMode = e.target.value;
    $('stampBottomTextRow').hidden = e.target.value !== 'text';
    saveSettings();
  });

  $('vSigScale').addEventListener('input', e => {
    state.settings.sigScale = Number(e.target.value);
    $('sigScaleOut').textContent = Number(e.target.value).toFixed(1) + '×';
    saveSettings();
  });
  $('vStampScale').addEventListener('input', e => {
    state.settings.stampScale = Number(e.target.value);
    $('stampScaleOut').textContent = Number(e.target.value).toFixed(1) + '×';
    saveSettings();
  });

  $('icEye').addEventListener('click', () => {
    const el = $('vIc');
    const hidden = el.type === 'password';
    el.type = hidden ? 'text' : 'password';
    $('icEye').textContent = hidden ? 'hide' : 'show';
  });

  document.querySelectorAll('.seg-btn[data-stamp]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.settings.stampMode = btn.dataset.stamp;
      setStampMode(btn.dataset.stamp);
      saveSettings();
    });
  });

  $('sigUploadBtn').addEventListener('click', () => $('sigUpload').click());
  $('stampUploadBtn').addEventListener('click', () => $('stampUpload').click());
  $('sigUpload').addEventListener('change', e => readImage(e, 'sigImage'));
  $('stampUpload').addEventListener('change', e => readImage(e, 'stampImage'));

  $('sigClearBtn').addEventListener('click', () => {
    state.settings.sigImage = null; saveSettings({ immediate: true }); syncInputs();
  });
  $('stampClearBtn').addEventListener('click', () => {
    state.settings.stampImage = null; saveSettings({ immediate: true }); syncInputs();
  });

  els.resetBtn.addEventListener('click', () => {
    if (!confirm('Clear the saved values, signature and stamp from this browser?')) return;
    // Drop any debounced write first, or it lands after the keys are removed.
    cancelPendingSave();
    localStorage.removeItem(STORE_KEY);
    localStorage.removeItem(IC_STORE_KEY);
    location.reload();
  });

  $('vStrip').addEventListener('change', e => { state.stripAnnotations = e.target.checked; });

  els.fillBtn.addEventListener('click', fillAndDownload);
}

function setStampMode(mode) {
  document.querySelectorAll('.seg-btn[data-stamp]').forEach(b => {
    b.classList.toggle('is-on', b.dataset.stamp === mode);
  });
  els.stampLogoOpts.hidden = mode !== 'logo';
  els.stampGenOpts.hidden = mode !== 'generated';
  els.stampImgOpts.hidden = mode !== 'upload';
}

function readImage(e, key) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;

  // Refuse oversized scans up front rather than letting the save fail later,
  // by which point the image is on screen and looks accepted.
  if (file.size > MAX_IMAGE_BYTES) {
    showBanner(`That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. Scans are kept in this `
      + `browser's storage, which holds roughly 5 MB in total, so anything over about 1.5 MB will `
      + `not survive a reload. Try a smaller image — a PNG with a transparent background at around `
      + `600 px wide is plenty.`);
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    state.settings[key] = reader.result; // data URL, kept in localStorage
    // Immediate: the quota is most likely to bite here, and the user needs to
    // hear about it while the image control is still in front of them.
    saveSettings({ immediate: true });
    syncInputs();
  };
  reader.readAsDataURL(file);
}

/* ------------------------------------------------------------------ */
/* file handling                                                       */
/* ------------------------------------------------------------------ */

function wireDropzone() {
  els.dropzone.addEventListener('click', () => els.fileInput.click());
  els.dropzone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.fileInput.click(); }
  });
  els.fileInput.addEventListener('change', async e => {
    const input = e.target;
    const f = input.files && input.files[0];
    if (!f) { input.value = ''; return; }
    // Clear the input only once the bytes have been read. Clearing it releases
    // the File's backing store in Chromium, and `file.arrayBuffer()` — which is
    // still in flight — then fails with NotReadableError. That is a race, so it
    // shows up as an occasional "could not be read" on a perfectly good file
    // rather than as a consistent failure.
    try { await handleFile(f); } finally { input.value = ''; }
  });

  ['dragenter', 'dragover'].forEach(ev => els.dropzone.addEventListener(ev, e => {
    e.preventDefault(); els.dropzone.classList.add('is-over');
  }));
  ['dragleave', 'drop'].forEach(ev => els.dropzone.addEventListener(ev, e => {
    e.preventDefault(); els.dropzone.classList.remove('is-over');
  }));
  els.dropzone.addEventListener('drop', e => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f);
  });

  els.clearFile.addEventListener('click', resetDocumentState);
}

/**
 * Forget everything that belongs to the loaded file.
 *
 * Called on "Remove" and again before a new file is analysed. The second call
 * is the important one: if analysis throws, the previous file's blanks must not
 * still be sitting in `state`, or "Fill & download" would write them onto the
 * new document.
 *
 * Deliberately leaves `state.rendering` alone — an in-flight preview render
 * exits on its own once `state.pages` is empty, and clearing the flag early
 * would let a second render run concurrently with it.
 */
function resetDocumentState() {
  state.bytes = null;
  state.pdfDoc = null;
  state.pages = [];
  state.blanks = [];
  state.mode = 'flat';
  state.hints = {};
  state.staleAnnotations = 0;

  els.fileCard.hidden = true;
  els.fieldsCard.hidden = true;
  els.valuesCard.hidden = true;
  els.signCard.hidden = true;
  els.stampCard.hidden = true;
  els.actions.hidden = true;
  els.stripRow.hidden = true;

  els.preview.innerHTML = '';
  els.preview.appendChild(els.previewEmpty);
  els.previewEmpty.hidden = false;
  els.legend.innerHTML = '';
  els.fieldsBody.innerHTML = '';
  els.fieldCount.textContent = '0';
  els.fileInfo.textContent = '';
  note('', false);
}

async function handleFile(file) {
  if (!/pdf$/i.test(file.name) && file.type !== 'application/pdf') {
    showBanner('That is not a PDF. Drop a .pdf file.');
    return;
  }
  showBanner('');
  els.banner.hidden = true;

  // Clear the previous document before the new bytes are installed, so a
  // failure below cannot leave the old blanks pointing at the new file.
  resetDocumentState();

  const buf = new Uint8Array(await file.arrayBuffer());
  state.bytes = buf;
  state.fileName = file.name;
  els.fileName.textContent = file.name;
  els.fileInfo.textContent = (file.size / 1024).toFixed(0) + ' KB · analysing…';
  els.fileCard.hidden = false;

  try {
    await analyse(buf);
  } catch (err) {
    console.error(err);
    state.bytes = null; // nothing to fill; the Fill button is hidden anyway
    els.fileInfo.textContent = 'could not be read';
    note('Could not read this PDF: ' + (err && err.message ? err.message : err), true);
  }
}

function note(msg, warn) {
  els.detectNote.textContent = msg;
  els.detectNote.hidden = !msg;
  els.detectNote.className = warn ? 'note is-warn' : 'note';
}

async function analyse(bytes) {
  state.pdfDoc = await pdfjsLib.getDocument({
    data: bytes.slice(),
    isEvalSupported: false,
    disableFontFace: true,
    // Draw the page as the template actually is, without any leftover
    // annotation values from a previous fill — that way the preview matches
    // what "Fill & download" will produce.
    annotationMode: pdfjsLib.AnnotationMode ? pdfjsLib.AnnotationMode.DISABLE : 0,
  }).promise;

  const n = state.pdfDoc.numPages;
  const pages = [];
  for (let i = 0; i < n; i++) {
    const page = await state.pdfDoc.getPage(i + 1);
    const vp = page.getViewport({ scale: 1 });
    let opList = null;
    try { opList = await page.getOperatorList(); } catch { /* optional */ }
    pages.push({
      pageIndex: i,
      textContent: await page.getTextContent(),
      opList,
      width: vp.width,
      height: vp.height,
    });
  }
  state.pages = pages;

  const { mode, blanks, hints } = await analyseDocument({
    PDFLib, pdfBytes: bytes, pages, OPS: pdfjsLib.OPS,
  });
  state.mode = mode;
  state.blanks = blanks;
  state.hints = hints;

  if (mode === 'form') {
    note(`${blanks.length} form field${blanks.length === 1 ? '' : 's'} found — this PDF has a real form layer, so field names are used instead of guessing from the layout.`);
  } else {
    note(blanks.length
      ? `${blanks.length} blank${blanks.length === 1 ? '' : 's'} detected by looking at the page layout.`
      : 'No dotted blanks found in this PDF. It may not be a fill-in-the-blank form.');
  }

  // Prefill company details straight out of the document when we found them
  // and the user has not supplied their own.
  if (!state.settings.company && state.hints.companyName) state.settings.company = state.hints.companyName;
  if (!state.settings.companyReg && state.hints.companyReg) state.settings.companyReg = state.hints.companyReg;

  // Templates are often re-used by filling them once in an editor, which leaves
  // the old values behind as annotations. Warn, because otherwise the user gets
  // their name printed twice.
  state.staleAnnotations = await countOverlappingAnnotations({ PDFLib, pdfBytes: bytes, blanks: state.blanks });
  els.stripRow.hidden = state.staleAnnotations === 0;
  if (state.staleAnnotations) {
    note(`${state.staleAnnotations} annotation${state.staleAnnotations === 1 ? '' : 's'} from a previous fill `
      + 'sit on top of these blanks. They will be removed so the new values are not doubled up. '
      + 'Untick the box below to keep them.');
  }

  els.fileInfo.textContent = `${(bytes.length / 1024).toFixed(0)} KB · ${n} page${n === 1 ? '' : 's'} · ${state.mode === 'form' ? 'form' : 'layout'} detection`;
  els.valuesCard.hidden = false;
  els.signCard.hidden = false;
  els.stampCard.hidden = false;
  els.fieldsCard.hidden = false;
  els.actions.hidden = false;

  syncInputs();
  renderFields();
  await renderPreview();
}

/* ------------------------------------------------------------------ */
/* fields table                                                        */
/* ------------------------------------------------------------------ */

function renderFields() {
  const body = els.fieldsBody;
  body.innerHTML = '';
  els.fieldCount.textContent = String(state.blanks.length);

  if (!state.blanks.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 4;
    td.className = 'muted';
    td.textContent = 'Nothing detected.';
    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }

  for (const b of state.blanks) {
    const tr = document.createElement('tr');
    if (b.role === 'ignore') tr.classList.add('is-off');

    const tdPage = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = 'page-badge';
    badge.textContent = String(b.page || '–');
    tdPage.appendChild(badge);

    const tdLabel = document.createElement('td');
    tdLabel.className = 'label';
    tdLabel.textContent = b.label || (b.fieldName ? b.fieldName : '(unlabelled)');
    tdLabel.title = b.fieldName || b.label || '';

    const tdRole = document.createElement('td');
    const sel = document.createElement('select');
    for (const r of ROLES) {
      const o = document.createElement('option');
      o.value = r.id;
      o.textContent = r.label;
      sel.appendChild(o);
    }
    sel.value = b.role;
    sel.addEventListener('change', () => {
      b.role = sel.value;
      tr.classList.toggle('is-off', b.role === 'ignore');
      renderPreview();
    });
    tdRole.appendChild(sel);

    const tdClear = document.createElement('td');
    tdClear.className = 'ta-c';
    if (hasPrintedDots(b)) {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = b.clear !== false;
      cb.title = 'White out the printed dots before writing';
      cb.addEventListener('change', () => { b.clear = cb.checked; });
      tdClear.appendChild(cb);
    } else {
      tdClear.innerHTML = '<span class="muted">—</span>';
    }

    tr.append(tdPage, tdLabel, tdRole, tdClear);
    body.appendChild(tr);
  }

  renderLegend();
}

function renderLegend() {
  const used = [...new Set(state.blanks.filter(b => b.role !== 'ignore').map(b => b.role))];
  els.legend.innerHTML = '';
  for (const role of used) {
    const meta = ROLE_BY_ID[role];
    if (!meta) continue;
    const s = document.createElement('span');
    const i = document.createElement('i');
    i.style.background = ROLE_COLORS[role] || '#98a2b3';
    s.append(i, document.createTextNode(meta.label));
    els.legend.appendChild(s);
  }
}

/* ------------------------------------------------------------------ */
/* preview                                                             */
/* ------------------------------------------------------------------ */

async function renderPreview() {
  if (!state.pdfDoc) return;
  // A render takes a while on a long document, and changing a role fires this
  // on every selection. Queue the request instead of dropping it, or the
  // preview is left showing the state from before the last change.
  if (state.rendering) { state.renderQueued = true; return; }
  state.rendering = true;
  try {
    els.previewEmpty.hidden = true;
    els.preview.querySelectorAll('.page-wrap').forEach(n => n.remove());

    const avail = Math.max(320, els.preview.clientWidth - 32);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    for (let i = 0; i < state.pages.length; i++) {
      const meta = state.pages[i];
      const scale = Math.min(1.5, avail / meta.width);

      const page = await state.pdfDoc.getPage(i + 1);
      const viewport = page.getViewport({ scale: scale * dpr });
      const cssViewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = Math.floor(cssViewport.width) + 'px';
      canvas.style.height = Math.floor(cssViewport.height) + 'px';

      const wrap = document.createElement('div');
      wrap.className = 'page-wrap';
      wrap.style.width = canvas.style.width;
      wrap.style.height = canvas.style.height;

      const label = document.createElement('div');
      label.className = 'page-label';
      label.textContent = 'Page ' + (i + 1);

      wrap.append(canvas, label);

      for (const b of state.blanks) {
        if (b.pageIndex !== meta.pageIndex) continue;
        if (b.kind === 'field' && !(b.x1 > b.x0)) continue;
        const color = ROLE_COLORS[b.role] || ROLE_COLORS.ignore;
        const off = b.role === 'ignore';

        // Convert the PDF-space rectangle through the viewport so page
        // rotation/cropping is handled for us.
        const [ax, ay] = cssViewport.convertToViewportPoint(b.x0, b.baseline + b.size * 0.85);
        const [bx, by] = cssViewport.convertToViewportPoint(b.x1, b.baseline - b.size * 0.3);
        const left = Math.min(ax, bx);
        const top = Math.min(ay, by);
        const w = Math.abs(bx - ax);
        const h = Math.abs(by - ay);

        const ov = document.createElement('div');
        ov.className = 'ov' + (off ? ' is-off' : '');
        ov.style.left = left + 'px';
        ov.style.top = top + 'px';
        ov.style.width = Math.max(w, 8) + 'px';
        ov.style.height = Math.max(h, 8) + 'px';
        ov.style.borderColor = color;
        ov.style.background = hexA(color, off ? 0.06 : 0.16);
        ov.style.color = color;
        ov.textContent = w > 42 ? (ROLE_BY_ID[b.role] || {}).label || '' : '';
        wrap.appendChild(ov);
      }

      els.preview.appendChild(wrap);
      await page.render({
        canvasContext: canvas.getContext('2d'),
        viewport,
        // Also has to be set per-render, not just on getDocument.
        annotationMode: pdfjsLib.AnnotationMode ? pdfjsLib.AnnotationMode.DISABLE : 0,
      }).promise;
    }
  } catch (err) {
    console.error('preview failed', err);
  } finally {
    state.rendering = false;
    if (state.renderQueued) {
      state.renderQueued = false;
      renderPreview();
    }
  }
}

function hexA(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/* ------------------------------------------------------------------ */
/* fill                                                                */
/* ------------------------------------------------------------------ */

function buildConfig() {
  const s = state.settings;
  const font = FONT_BY_ID[s.sigFont] || SIGNATURE_FONTS[0];
  return {
    name: s.name,
    icNumber: s.ic,
    companyName: s.company,
    companyReg: s.companyReg,
    date: s.date,
    signatureText: s.sigText,
    signatureScale: Number(s.sigScale) || 1,
    signatureSubset: font.subset,
    signatureFontFile: font.file,
    stampMode: s.stampMode,
    stampLine1: s.stampLine1 || s.companyReg,
    stampLine2: s.stampLine2,
    stampBottomText: s.stampBottomMode === 'text' ? s.stampBottom : '',
    stampStar: s.stampBottomMode !== 'text',
    stampScale: Number(s.stampScale) || 1,
    stripAnnotations: state.stripAnnotations,
    signatureImageBytes: s.sigImage ? dataUrlToBytes(s.sigImage) : null,
    stampImageBytes: stampBytes(),
  };
}

/**
 * Which bytes the stamp is drawn from — or null to draw the vector ring.
 *
 * The single place this decision is made, so the UI's warnings and the writer
 * can never disagree about what "stamp image" means for a given mode.
 */
function stampBytes() {
  const s = state.settings;
  if (s.stampMode === 'upload') return s.stampImage ? dataUrlToBytes(s.stampImage) : null;
  if (s.stampMode === 'logo') return state.bundledStamp ? dataUrlToBytes(state.bundledStamp) : null;
  return null; // 'generated'
}

function dataUrlToBytes(dataUrl) {
  const comma = dataUrl.indexOf(',');
  const b64 = dataUrl.slice(comma + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function fillAndDownload() {
  if (!state.bytes) return;
  const cfg = buildConfig();

  const missing = [];
  if (!cfg.name) missing.push('full name');
  if (!cfg.icNumber) missing.push('IC number');
  if (state.blanks.some(b => b.role === 'signature') && !cfg.signatureText && !cfg.signatureImageBytes) {
    missing.push('signature text');
  }
  // Every stamp mode can end up with no image at all — an upload that was never
  // made, or artwork that failed to load. In both cases the writer silently
  // falls back to the generated ring stamp, so say so up front rather than
  // drawing something the user did not ask for.
  if (state.blanks.some(b => b.role === 'stamp') && !cfg.stampImageBytes) {
    if (cfg.stampMode === 'upload') {
      missing.push('stamp image — "Upload a scan" is selected but nothing has been uploaded, '
        + 'so a generated stamp will be drawn instead');
    } else if (cfg.stampMode === 'logo') {
      missing.push('stamp image — the bundled company stamp could not be loaded, '
        + 'so a generated stamp will be drawn instead');
    }
  }
  if (missing.length && !confirm(`Not everything is filled in:\n\n  • ${missing.join('\n  • ')}\n\nFill the PDF anyway?`)) return;

  els.fillBtn.disabled = true;
  els.fillStatus.innerHTML = '<span class="spinner"></span>filling…';

  try {
    // Apply the role values onto the blanks.
    for (const b of state.blanks) {
      switch (b.role) {
        case 'name': b.value = cfg.name; break;
        case 'ic': b.value = cfg.icNumber; break;
        case 'company': b.value = cfg.companyName; break;
        case 'companyReg': b.value = cfg.companyReg; break;
        case 'date': b.value = cfg.date; break;
        default: b.value = '';
      }
    }

    let fontBytes = null;
    if (state.blanks.some(b => b.role === 'signature') && !cfg.signatureImageBytes) {
      const res = await fetch('./fonts/' + cfg.signatureFontFile);
      if (!res.ok) throw new Error('could not load the signature font');
      fontBytes = new Uint8Array(await res.arrayBuffer());
    }

    const result = await fillDocument({
      PDFLib, fontkit,
      pdfBytes: state.bytes,
      blanks: state.blanks,
      config: { ...cfg, signatureFontBytes: fontBytes },
    });

    const blob = new Blob([result.bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = state.fileName.replace(/\.pdf$/i, '') + '-filled.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);

    const filled = state.blanks.filter(b => b.role !== 'ignore').length;
    const bits = [`${filled} blank${filled === 1 ? '' : 's'} filled`,
      `${(result.bytes.length / 1024).toFixed(0)} KB`];
    if (result.removedAnnotations) {
      bits.push(`${result.removedAnnotations} stale annotation${result.removedAnnotations === 1 ? '' : 's'} removed`);
    }
    els.fillStatus.textContent = 'Done — ' + bits.join(', ') + '.';
  } catch (err) {
    console.error(err);
    els.fillStatus.textContent = 'Failed: ' + (err && err.message ? err.message : err);
  } finally {
    els.fillBtn.disabled = false;
  }
}

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */

loadSettings();
populateFontSelect();
wireInputs();
wireDropzone();
syncInputs();
// Independent round trips — the config API and the stamp artwork.
await Promise.all([loadConfig(), loadBundledStamp()]);

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (state.pdfDoc) renderPreview(); }, 250);
});

// Settings writes are debounced, so the last edit can still be in flight when
// the tab goes away.
window.addEventListener('pagehide', flushSettings);

// Expose a couple of internals for debugging from the console.
window.__pdfFiller = { state, analyseDocument, fillDocument };
