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
  - `lib/stamp.js` — vector company stamp
  - `lib/fill.js` — pdf-lib writer, AcroForm + annotation handling
  - `vendor/`, `fonts/` — vendored, no runtime CDN
- `functions/` — `_middleware.js` (Basic auth gate), `api/config.js`
- `tools/` — headless test harness + render helpers (not deployed)
  - `test.mjs` — runs the real lib modules against a PDF and prints the blanks
  - `check-detection.mjs` — asserts the detection behaviours; run after touching
    `lib/detect.js` or `lib/roles.js`
  - `make-fixtures.mjs` — acroform / underline / `rect` fixtures. `fixture-rect`
    exists because pdf-lib only emits one path encoding; see below.

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
- **Dot clearing has one predicate**: `hasPrintedDots()` / `shouldClearDots()`
  in `lib/fill.js`. The fields table and the writer must both use it — they
  independently tested `kind === 'dots'` once and both skipped `mixed` regions.
- **Path encodings differ.** pdf.js delivers the `re` operator as a
  `constructPath` whose command list is `[OPS.rectangle]`, not as a standalone
  op. `findUnderlines` must consume every command or it skips the path. Do not
  trust a green `fixture-underline.pdf` run to prove drawn-rule detection.
- The company-name hint (`lib/roles.js`) may only claim a blank with **no
  label**. `role === 'ignore'` includes labelled-but-unrecognised blanks.
- Never clear the file input before `file.arrayBuffer()` resolves — Chromium
  releases the File's backing store and the read fails with `NotReadableError`
  (intermittent, so it looks like a corrupt file).

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
curl -o /dev/null -w '%{http_code}\n' https://pdf-filler-7ju.pages.dev/           # 401
curl -o /dev/null -w '%{http_code}\n' https://pdf-filler-7ju.pages.dev/api/config # 401, not 404
```

Secrets: `APP_PASSWORD`, `BIDDER_IC`. Non-sensitive vars live in `wrangler.toml`
under `[vars]` — confirmed to work for Pages projects.

## Open items

- `BIDDER_IC` is not set on the deployment. The user planned to add it later.
- `public/fonts/GreatVibes-Regular.ttf` is OFL; attribution is not surfaced in
  the UI yet.
