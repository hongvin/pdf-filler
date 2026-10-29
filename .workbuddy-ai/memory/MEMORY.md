# pdf-filler — project notes

## What it is

Browser-only filler for Malaysian statutory/bidder declaration PDFs
(`SURAT AKUAN PEMBIDA`). Detects dot-leader blanks, then writes a name, IC
number, a cursive signature and a company stamp. Deployed to Cloudflare Pages.

## Layout

- `public/` — deployable site, no build step
  - `lib/metrics.js` — glyph advance widths for standard PDF fonts
  - `lib/detect.js` — blank detection + label inference
  - `lib/roles.js` — label → semantic role rules
  - `lib/stamp.js` — vector company stamp (the "Generate one" mode)
  - `lib/fill.js` — pdf-lib writer, AcroForm + annotation handling
  - `vendor/`, `fonts/` — vendored, no runtime CDN
  - `stamp/company-stamp.png` — the bundled company stamp artwork (default mode)
- `functions/` — `_middleware.js` (Basic auth gate), `api/config.js`
- `tools/` — headless test harness + render helpers (not deployed)
  - `test.mjs` — runs the real lib modules against a PDF and prints the blanks
  - `check-detection.mjs` — asserts the detection behaviours; run after touching
    `lib/detect.js` or `lib/roles.js`
  - `check-ui-refs.mjs` — asserts `app.js`'s ids/`els.*` keys still exist in
    `index.html` and that the stamp modes agree across markup/app/writer. Run
    after touching either file.
  - `make-fixtures.mjs` — acroform / underline / `rect` fixtures. `fixture-rect`
    exists because pdf-lib only emits one path encoding; see below.
  - `stamp-compare.mjs` + `stamp-render.py` — render both stamp modes and
    measure their footprints. Measure on the **isolated** page it writes, never
    on the template; see below.

## Conventions

- `public/lib/*.js` must stay dependency-free so the same files run in the
  browser and in Node. `PDFLib` and `fontkit` are **injected**, never imported.
- Signature font must be embedded with `subset: false`. pdf-lib's subsetter
  drops most Great Vibes glyphs. There is a comment on the line.
- The access gate fails **closed**: no `APP_PASSWORD` → `/api/*` returns 503.
  Never change this to fail open — it is what keeps the IC number off the
  public internet.
- The IC number must never be written to `localStorage` (see `writeSettings`,
  which strips it) and never baked into a bundle — it comes from `/api/config`.
- **Dot clearing is off.** Earlier builds whited out the dot band across the full
  blank before writing the typed value, which erased the entire dotted leader
  for every filled row. The dotted line is the form's own structure; the value
  should sit on it, not replace it. `clearDots` and `shouldClearDots` are gone;
  `hasPrintedDots` is kept as a kind classification (`dots` / `mixed`) for
  callers that need it. The fields table no longer has a Clear column.
- **Path encodings differ.** pdf.js delivers the `re` operator as a
  `constructPath` whose command list is `[OPS.rectangle]`, not as a standalone
  op. `findUnderlines` must consume every command or it skips the path. Do not
  trust a green `fixture-underline.pdf` run to prove drawn-rule detection.
- The company-name hint (`lib/roles.js`) may only claim a blank with **no
  label**. `role === 'ignore'` includes labelled-but-unrecognised blanks.
- Never clear the file input before `file.arrayBuffer()` resolves — Chromium
  releases the File's backing store and the read fails with `NotReadableError`
  (intermittent, so it looks like a corrupt file).
- **The stamp has one size constant.** `STAMP_DIAMETER_EM` (8.66em) in
  `lib/fill.js` drives both the generated ring and the image path, which share a
  centre too. The image path once used its own 4.6em formula and printed at half
  size. Do not give either mode its own arithmetic.
- **The bundled stamp is fetched, not stored.** It is read into memory at boot
  and deliberately kept out of `localStorage` (~180 KB of base64 that never
  changes, against a ~5 MB quota). Swapping the artwork = replacing that one PNG.
- **Stamp modes are `logo` | `generated` | `upload`.** `image` is a legacy value
  and survives only as a migration in `loadSettings`; an unrecognised mode falls
  back to the default, because `setStampMode` has no branch for it and the card
  would render empty. `check-ui-refs.mjs` enforces this.
- **Trim a stamp image to its ink bounding box before shipping it.** Sizing is
  driven off the frame, so transparent padding prints the stamp small. The
  original of the bundled artwork had 11% of its width as dead margin.

## Version control

Initialised 2026-09-19 (`main`, one initial commit). Identity is set
**repo-locally** (`Koay Hong Vin` / `khvmaths2016@gmail.com`) — change it with
`git config user.email …` if that is wrong. `.dev.vars` is ignored; `node_modules`
is a sandbox symlink, so the ignore pattern has no trailing slash.

## Deploy

```
npx wrangler pages deploy public --project-name pdf-filler --commit-dirty=true
```

Watch for `✨ Uploading Functions bundle`. Then verify:

```
curl -o /dev/null -w '%{http_code}\n' https://pdf-filler-7ju.pages.dev/           # 200
curl -o /dev/null -w '%{http_code}\n' https://pdf-filler-7ju.pages.dev/api/config # 200, not 401
```

**The production alias lags the deployment.** Immediately after a deploy the
alias can still serve the previous Functions bundle for a minute or so. Check
the deployment-specific URL (`https://<hash>.pdf-filler-7ju.pages.dev`) to see
what was actually uploaded, then re-poll the alias.

Secrets: `BIDDER_IC`. Non-sensitive vars live in `wrangler.toml` under `[vars]`
— confirmed to work for Pages projects.

## Auth

**There is no auth in code as of 2026-10-29.** `functions/_middleware.js` was
deleted; access is meant to be enforced by Cloudflare Access. Restore the old
gate with `git show 022c93b:functions/_middleware.js > functions/_middleware.js`
if Access is ever dropped.

The IC number is therefore served publicly by `/api/config`. That is accepted.

Access **cannot** front `*.pages.dev` — an Access application domain must be in
a zone on the account. The project needs a custom domain for Access to do
anything, and `pages.dev` will bypass it until blocked.

`BIDDER_IC` is a Pages secret and is set (confirmed 2026-09-19). The old
`APP_PASSWORD` secret is still bound but unused; leave it alone.

## Open items

- Attach a custom domain to the Pages project and put Cloudflare Access on it.
- Consider a host-check middleware that 404s when `Host` is not the canonical
  domain, otherwise Access is bypassable via the `pages.dev` URL.
- `public/fonts/GreatVibes-Regular.ttf` is OFL; attribution is not surfaced in
  the UI yet.
