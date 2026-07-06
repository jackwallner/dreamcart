# DreamCart

Support pages (`docs/`, served via GitHub Pages) and the catalog generator for
the DreamCart iOS app.

## Generator

Products mimic a real shopping site: every product image is generated ahead of
time and hosted in Supabase Storage (`product-art` bucket) — the app never
waits on an image model while browsing.

```sh
export SHOP_SUPABASE_URL=...      # project URL
export SHOP_SUPABASE_SECRET=...   # service role key

deno run --allow-net --allow-env generator/generate.ts backfill
deno run --allow-net --allow-env generator/generate.ts drop --count 12
deno run --allow-net --allow-env generator/generate.ts expand --count 300 --backdate 60
```

`.github/workflows/daily-drop.yml` runs `drop` every day at 13:00 UTC
(repo secrets `SHOP_SUPABASE_URL` / `SHOP_SUPABASE_SECRET`), the same pattern
as the baseball nightly ingest.

`generator/catalog.ts` is a copy of the composer in
`~/shop/supabase/functions/_shared/catalog.ts`; re-copy if it changes there.
The iOS app source lives in `~/shop` (not in this repo).
