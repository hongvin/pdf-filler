# pdf-filler — project notes

## What it is

Browser-only filler for Malaysian statutory/bidder declaration PDFs
(`SURAT AKUAN PEMBIDA`). Detects dot-leader blanks, then writes a name, IC
number, a cursive signature and a company stamp. Deployed to **Cloudflare
Workers** (Static Assets) at https://pdf-filler.hongvin.workers.dev.

## Layout

- `public/` — static assets, no build step
  - `lib/metrics.js` — glyph advance widths for standard PDF fonts
  - `lib/detect.js` — blank detection + label inference
  - `lib/roles.js` — label → semantic role rules
  - `lib/stamp.js` — vector company stamp (the "Generate one" mode)
  - `lib/fill.js` — pdf-lib writer, AcroForm + annotation handling
  - `vendor/`, `fonts/` — vendored, no runtime CDN
  - `stamp/company-stamp.png` — the bundled company stamp artwork (default mode)
- `worker.js` — the Worker: `/api/config` + `env.ASSETS.fetch()` passthrough.
  Re-applies the security headers in code; do not rely on `public/_headers`,
  which is a Pages convention.
- `wrangler.toml` — `main`, `[assets]` (`run_worker_first = true`), `[vars]`
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
  public internet. *(Historical: the code gate is gone as of 2026-10-29; access
  is meant to come from Cloudflare Access. Restore the middleware from
  `git show 022c93b:functions/_middleware.js` if Access is ever dropped.)*
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
npx wrangler deploy
```

Uploads `worker.js` + the 18 files in `public/` as one unit. Then verify:

```
curl -o /dev/null -w '%{http_code}\n' https://pdf-filler.hongvin.workers.dev/           # 200
curl -s https://pdf-filler.hongvin.workers.dev/api/config | head -c 120                 # JSON
```

`wrangler deploy --dry-run` prints the binding table and asset count without
pushing — the fastest way to catch a config mistake.

Secrets: `BIDDER_IC` (`wrangler secret put BIDDER_IC`). Worker secrets apply on
the next request; no redeploy needed. Pages secrets do **not** carry over.

## Auth

**There is no auth in code as of 2026-10-29.** `functions/_middleware.js` was
deleted; access is meant to be enforced by Cloudflare Access. Restore the old
gate with `git show 022c93b:functions/_middleware.js` if Access is ever dropped.

The IC number is therefore served publicly by `/api/config`. That is accepted.

Why the project is a Worker and not Pages:

- A Pages project **always** exposes `<project>.pages.dev`. It cannot be removed,
  and it cannot be an Access application domain (Access domains must belong to a
  zone on the account; `pages.dev` is Cloudflare's).
- A Worker's `workers.dev` route **can** be disabled (`workers_dev = false`) and
  **can** be gated with Access directly (Settings → Domains & Routes →
  workers.dev → Enable Cloudflare Access), with no custom domain at all.

`BIDDER_IC` is set as a Worker secret. The old Pages project still exists and
still serves its last build — it must be deleted by hand.

## Open items

- Delete the `pdf-filler` **Pages** project. Until then
  `pdf-filler-7ju.pages.dev` is a public, ungated copy of the same data.
- Enable Cloudflare Access on the Worker (workers.dev route, or a custom domain
  plus `workers_dev = false`).
- Consider a host-check in `worker.js` that 404s when `Host` is not the
  canonical domain, so a second hostname can never bypass Access.
- `public/fonts/GreatVibes-Regular.ttf` is OFL; attribution is not surfaced in
  the UI yet.
