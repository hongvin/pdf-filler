# Form Filler

Drop in a Malaysian bidder's declaration (or any fill-in-the-blank PDF) and get
it back with your name, IC number, a cursive signature and a company stamp
applied. Runs entirely in the browser and deploys to Cloudflare Pages.

Built for templates like `SURAT AKUAN PEMBIDA` / `LAMPIRAN 6`, where the blanks
are rows of dots rather than real PDF form fields.

---

## What it actually does

**1. Finds the blanks.** Two strategies, picked automatically:

| PDF kind | How blanks are found |
|---|---|
| Flat export (the usual case) | Scans glyph geometry for runs of `.` / `…` / `_`, and for thin drawn horizontal rules. |
| Real AcroForm | Reads the form dictionary and uses each field's fully-qualified name — the field *namespace*, e.g. `topmostSubform[0].Page1[0].Nama[0]`. |

**2. Works out what each blank is for.** The label is taken from the text to the
left of the blank; if the blank hugs the left margin (a wrapped two-column
layout, which this template has) the label is read from the tail of the line
above. The label is then matched against a rule table:

| Role | Matches |
|---|---|
| `signature` | tandatangan, signature |
| `stamp` | cop syarikat, cop, stamp, company seal |
| `ic` | kad pengenalan, no. kad, NRIC, IC |
| `companyReg` | no. pendaftaran, registration no., ROC |
| `company` | nama syarikat, syarikat, company, firma |
| `date` | tarikh, date, hari |
| `name` | nama, name, saya |

Every guess is shown in a table and is overridable before you fill.

**3. Fills it.** pdf-lib writes the values into the page content stream. The
printed dots are whited out first so the typed text does not sit on top of them.
Text uses Times-Roman to match the template; the signature is set in one of four
bundled script faces (Kaushan Script by default).

The stamp has three sources, picked from the segmented control:

| Mode | What is drawn |
|---|---|
| **Company logo** (default) | `public/stamp/company-stamp.png` — the real stamp artwork, bundled with the app. Works with no upload. |
| **Generate one** | A vector ring stamp drawn from the company name and registration numbers. Use this when you have no artwork. |
| **Upload a scan** | Your own image, kept in `localStorage`. |

All three are sized off one constant (`STAMP_DIAMETER_EM` in `lib/fill.js`), so
switching modes changes the artwork, never the footprint.

The PDF never leaves the browser — there is no upload step.

---

## Layout

```
public/                 ← the deployable site
  index.html
  app.js                ← UI wiring, preview, download
  styles.css
  lib/
    metrics.js          ← glyph advance widths (standard PDF fonts)
    detect.js           ← blank detection + label inference
    roles.js            ← label → role rules
    stamp.js            ← vector company stamp
    fill.js             ← pdf-lib writer, AcroForm support
  vendor/               ← pdf.js, pdf-lib, fontkit (vendored, no CDN at runtime)
  fonts/                ← four script faces for the signature (all OFL)
  stamp/
    company-stamp.png   ← the bundled company stamp artwork
functions/
  _middleware.js        ← HTTP Basic auth gate
  api/config.js         ← serves BIDDER_* env vars
tools/                  ← headless test harness + render helpers
```

`lib/` is plain dependency-free ES modules, which is why the same files run
unmodified in the browser and under Node in `tools/test.mjs`.

---

## Configuration

Set these as Cloudflare Pages environment variables. `APP_PASSWORD` and
`BIDDER_IC` should be **secrets**:

```bash
npx wrangler pages secret put APP_PASSWORD --project-name pdf-filler
npx wrangler pages secret put BIDDER_IC     --project-name pdf-filler
```

| Variable | Purpose |
|---|---|
| `APP_PASSWORD` | Shared password for the whole site. **Also the on/off switch for the gate.** |
| `APP_USER` | Basic-auth username. Defaults to `bidder`. |
| `BIDDER_NAME` | Full name, e.g. `Koay Hong Vin` |
| `BIDDER_IC` | IC number. Served from the server so it is never in the JS bundle. |
| `BIDDER_COMPANY` | Company name |
| `BIDDER_COMPANY_REG` | Company registration number |
| `SIGNATURE_TEXT` | What the cursive signature reads. Default `HongVin`. |
| `SIGNATURE_FONT` | Which bundled script face to sign with: `KaushanScript` (default), `Norican`, `MrDafoe` or `GreatVibes`. |
| `STAMP_LINE2` | Second centre line of the **generated** stamp — the company's old ROC number, e.g. `(1529940-V)`. Ignored in the other two modes. |
| `STAMP_BOTTOM_TEXT` | Optional bottom arc for the **generated** stamp. Leave it unset — the default — and a five-pointed star is drawn instead. |

### Replacing the bundled stamp

`public/stamp/company-stamp.png` is the stamp the app draws by default. To swap
in different artwork, drop the file over it — nothing else needs to change.

Two things are worth knowing:

- **It must have a transparent background**, not a white one, or the white box
  will print over the form. A PNG at roughly 460 × 460 is plenty.
- **Trim the transparent margin.** Sizing is driven off the image's *frame*, so
  padding around the artwork makes the stamp print smaller than it should. The
  shipped file was trimmed to its ink bounding box for exactly this reason.
  Anything with a visible transparent border can be fixed with:

  ```python
  from PIL import Image
  im = Image.open('logo.png').convert('RGBA')
  box = im.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
  im.crop(box).save('public/stamp/company-stamp.png', optimize=True)
  ```

The artwork is fetched at boot and held in memory. It is deliberately **not**
written to `localStorage`: it is ~180 KB of base64, never changes, and would eat
a third of the quota for nothing. If the fetch fails the app says so and falls
back to the generated stamp rather than drawing nothing.

### Defaults currently in place

| Field | Value | Where |
|---|---|---|
| Name | `Koay Hong Vin` | `wrangler.toml` → `[vars]` |
| IC number | `970529-02-5353` | Pages secret `BIDDER_IC` |
| Company | `EDGE INTELLIGENCE SDN. BHD.` | `wrangler.toml` → `[vars]` |
| Company reg. | `202301036017` | `wrangler.toml` → `[vars]` |
| Signature reads | `HongVin` | `wrangler.toml` → `[vars]` |

The IC is deliberately **not** in `wrangler.toml` and **not** in any JS file.
`[vars]` are plaintext and visible in the dashboard, so anything sensitive
belongs in a secret.

To change the IC:

```bash
npx wrangler pages secret put BIDDER_IC --project-name pdf-filler
npx wrangler pages deploy public --project-name pdf-filler --commit-dirty=true
```

Secrets are bound at deploy time, so a redeploy is needed before the new value
is served.

### About the access gate

This app holds an IC number, so the default is to lock the whole site behind
HTTP Basic auth. The gate **fails closed**: if `APP_PASSWORD` is unset, static
files still serve so you can see what is wrong, but `/api/config` returns 503
rather than handing out the IC number. It will not silently go public.

If you genuinely want it public, delete `functions/_middleware.js` and
`functions/api/config.js` and type the values in by hand — they persist in
`localStorage` (the IC deliberately does not).

---

## Local development

```bash
cp .dev.vars.example .dev.vars     # then edit it
npx wrangler pages dev public --port 8788
```

Open <http://127.0.0.1:8788> and log in with `APP_USER` / `APP_PASSWORD`.

### Headless check

`tools/test.mjs` runs the real detection and fill code — including
`lib/analyse.js`, which is what the UI itself calls — against a PDF and prints
what it found. Useful when a new template does not detect cleanly:

```bash
node tools/test.mjs path/to/form.pdf tools/filled.pdf
```

`tools/make-fixtures.mjs` generates three synthetic PDFs covering the code paths
the declaration template cannot reach: an AcroForm with namespaced field names,
a flat document whose blanks are drawn rules instead of dots, and the same
document with its rules drawn via the `re` operator — a different branch of the
same detector, and the encoding Word and LibreOffice actually emit.

`tools/check-detection.mjs` asserts the detection behaviour directly, without
needing a PDF from outside the repo.

`tools/check-ui-refs.mjs` is a static cross-check between `app.js` and
`index.html`. The UI reaches into the markup by id, which is a link no bundler
or test can see — rename an id and the code silently reads `null` on whichever
branch touches it. It also checks that the stamp modes in the markup, in `app.js`
and in the writer agree, and that the legacy `image` mode survives only as a
migration.

```bash
node tools/make-fixtures.mjs
node tools/check-detection.mjs
node tools/check-ui-refs.mjs
node tools/test.mjs tools/fixture-acroform.pdf  tools/out-acroform.pdf
node tools/test.mjs tools/fixture-underline.pdf tools/out-underline.pdf
node tools/test.mjs tools/fixture-rect.pdf      tools/out-rect.pdf
node tools/test.mjs path/to/form.pdf            tools/filled.pdf
```

### Checking the stamp

The two stamp modes must occupy the same box. `tools/stamp-compare.mjs` renders
both, onto the real template *and* onto a blank page carrying nothing but the
stamp — measuring on the template alone is useless, because the template's own
printed text sits in the same window and the measurement just picks that up.
`tools/stamp-render.py` then rasterises the isolated pair and reports the ink
bounding box of each:

```bash
node tools/stamp-compare.mjs path/to/form.pdf
python tools/stamp-render.py          # prints both footprints and the delta
```

Rasterise any result to look at it:

```bash
python tools/topng.py tools/filled.pdf
python tools/crop.py tools/filled.pdf 2 240 685 380 800 zoom.png   # page 2, a region
```

---

## Deploy

```bash
npx wrangler pages deploy public --project-name pdf-filler --commit-dirty=true
```

`wrangler pages deploy <dir>` picks up `functions/` from the working directory
and uploads it as the Functions bundle — watch for `✨ Uploading Functions
bundle` in the output. If it is missing, the site ships without the config
endpoint.

Verify afterwards:

```bash
curl -o /dev/null -w '%{http_code}\n' https://pdf-filler.pages.dev/          # expect 401
curl -o /dev/null -w '%{http_code}\n' https://pdf-filler.pages.dev/api/config # expect 401, not 404
```

A `200` on the first means the gate is not enforcing. A `404` on the second means
the Functions bundle did not upload.

---

## Notes and gotchas

- **Templates often arrive pre-filled as annotations, not as page content.** The
  sample this was built against already carried `Koay Hong Vin` and an IC number
  as FreeText annotations plus a whole company stamp as a Stamp annotation. If
  you fill on top of those you get everything twice — two names, two stamps. The
  filler detects annotations whose rectangle overlaps a blank it is about to
  write and removes them (`stripOverlappingAnnotations` in `fill.js`), warns you
  in the UI, and lets you turn it off. The preview deliberately hides
  annotations so what you see matches what you will get.
- **Do not enable font subsetting for the signature font.** `pdf-lib`'s bundled
  subsetter drops most glyphs from Great Vibes — `HongVin` renders as two stray
  marks. `fill.js` embeds the full face (`subset: false`), which costs ~200 KB
  and renders correctly. There is a comment on the line so it does not get
  "optimised" back.
- **`pdf.js` splits text items unpredictably**, and differently in the browser
  than under Node. `Nama : …………` may arrive as one item or three, and `No.Kad`
  may arrive as `N` + `o.Kad`. Label inference handles all of it: it reads the
  label from inside the run's own item when needed, only reinserts spaces where
  the horizontal gap says one was printed, and ignores punctuation-only items
  that clean away to an empty string.
- **The stamp is larger than the line it sits on.** That is true of real stamps
  too. Use the size slider if it collides with something you care about.
- **Both stamp modes are sized off one constant, and the image path used to be
  wrong.** `drawStamp` in `fill.js` derives the diameter from
  `STAMP_DIAMETER_EM` (8.66em — the generated ring's radius is 4.33em, so that is
  its diameter). The image path previously used 4.6em, barely half, so an
  uploaded scan printed at about half the size of a generated stamp and the two
  modes did not line up. Anything that sizes a stamp must read that constant.
  Measured on a blank page: generated 105.12pt, bundled artwork 102.96pt, centres
  identical. The residual ~2% is the generated ring's own stroke width (it is
  stroked *on* the radius, so half the stroke falls outside) plus anti-aliasing
  on the artwork's edge — not a sizing error.
- **The bundled stamp is fetched, not stored.** It lives at
  `public/stamp/company-stamp.png` and is read into memory once at boot. Putting
  it in `localStorage` instead would burn ~180 KB of a ~5 MB quota on something
  that never changes.
- **Drawn rules are ambiguous, so they have to earn their place.** A line in a
  PDF is a fillable blank, an underline under a word, or a table/page rule — and
  only the first is a field. A naive scan of the operator list picks up all
  three: on the declaration template it produced five phantom fields, one of
  which grabbed the `company` role and would have printed the company name into
  a page footer. Rules now have to pass three tests: shorter than 88% of the
  page width, no body text sitting on top of them (a text underline has its
  words ~2-4pt above the rule), and a label that reads like a field label.
  Three further details: the sub-commands inside `constructPath` are pdf.js
  *operator codes* (`OPS.moveTo` = 13, `OPS.lineTo` = 14), not the 0/1 indices
  other path encodings use; a rule drawn with the `re` operator arrives as a
  `constructPath` whose command list is `[OPS.rectangle]` rather than as a
  standalone `OPS.rectangle` op, so that command has to be consumed like any
  other or the whole path is skipped; and path coordinates are in the user space
  in force at that point, so any preceding `transform` must be applied or the
  rule lands in the wrong place. `tools/fixture-rect.pdf` covers the `re`
  encoding specifically — `fixture-underline.pdf` does not, because pdf-lib
  draws its rules as `moveTo`/`lineTo`, which is a different branch.
- **The "this blank is the company field" guess only takes unlabelled blanks.**
  When the document prints its own company name, a blank with no label at all is
  offered as the company field. It has to be genuinely unlabelled: `role ===
  'ignore'` also covers blanks whose label we simply failed to recognise, and
  rewriting one of those — "Jawatan", say — prints the company name on the wrong
  line of a declaration. A wrong guess here is worse than leaving the field for
  the user to set.
- **A dot leader merged with a drawn rule is `kind: 'mixed'`, and still
  clearable.** A Word line with a bottom border merges into one region. Both the
  fields table and the writer used to test `kind === 'dots'`, so a `mixed`
  region silently kept its printed dots and offered no way to remove them. They
  now share `hasPrintedDots()` / `shouldClearDots()` in `fill.js` so they cannot
  drift apart again.
- **Form-field widgets live in `/Annots` too.** The stale-annotation cleanup
  must skip anything with `/Subtype /Widget`, or it deletes the very fields it
  is about to write into.
- **A form field can only hold text.** Signature and stamp are graphics, so for
  those roles the filler bypasses the form path and draws onto the widget's
  rectangle instead of silently failing to `setText`.
- **MuPDF logs `cannot find object in xref` when rendering the synthetic
  fixtures.** Verified harmless: the fixtures parse cleanly in both pdf.js and
  pdf-lib, render correctly, and the real document's output produces no such
  warning. It only appears on minimal pdf-lib-generated files carrying the full
  embedded signature font.
- Fonts and libraries are vendored under `public/vendor/` and `public/fonts/` —
  no CDN is contacted at runtime.
- **Settings live in `localStorage`, and the scans live with them.** The
  signature and stamp images are stored as base64 data URLs, which is why they
  are capped at 1.5 MB on upload (the origin quota is around 5 MB) and why
  writes are debounced rather than run on every keystroke. If the browser
  refuses a write — quota exceeded, or storage disabled — a banner says so,
  because the alternative is values that look saved and then vanish on reload.
  The IC number is never written to `localStorage`.
