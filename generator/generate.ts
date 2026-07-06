// DreamCart catalog generator. Products are a mimicked shopping site, so every
// image is generated AHEAD of time, uploaded to Supabase Storage, and the
// product row points at the hosted file — the app never waits on an image
// model at browse time.
//
// Modes:
//   deno run --allow-net --allow-env generate.ts backfill
//     Re-host every product whose image_url still points at the on-demand
//     pollinations endpoint. Keeps each product's exact existing look (same
//     prompt+seed), just downloads it once and serves it from storage.
//
//   deno run --allow-net --allow-env generate.ts drop [--count 12]
//     The daily drop: compose N fresh products, generate + store their images
//     first, then insert rows (drop_date defaults to today). A product whose
//     image can't be generated is skipped, never inserted half-baked.
//
//   deno run --allow-net --allow-env generate.ts expand [--count 300] [--backdate 60]
//     Catalog expansion: like drop, but spreads drop_date over the past N days
//     so the "new drops" rail isn't flooded by a single giant batch.
//
// Env: SHOP_SUPABASE_URL, SHOP_SUPABASE_SECRET (service role key).
//
// catalog.ts here is a copy of ~/shop/supabase/functions/_shared/catalog.ts —
// if the composer changes there, re-copy it.

import { BRANDS, composeProduct, imageURL } from "./catalog.ts";

const SUPABASE_URL = Deno.env.get("SHOP_SUPABASE_URL")?.replace(/\/$/, "");
const SERVICE_KEY = Deno.env.get("SHOP_SUPABASE_SECRET");
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Set SHOP_SUPABASE_URL and SHOP_SUPABASE_SECRET");
  Deno.exit(1);
}
const BUCKET = "product-art";
const CONCURRENCY = 2;
const ATTEMPTS = 14;

// ---------- small helpers ----------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  return await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY!,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

/// Download one generated image, retrying through queue-full 500s, 429
/// rate limits, and slow renders. Returns null only after exhausting every
/// attempt — the endpoint rate-limits per IP hard, so waits are generous.
async function fetchImage(url: string, label: string): Promise<Uint8Array | null> {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let rateLimited = false;
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(150_000),
        headers: { Accept: "image/*" },
      });
      if (res.ok) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        // The endpoint's error bodies are small JSON; a real shot is >5KB.
        if (bytes.length > 5_000 && bytes[0] === 0xff) return bytes;
        console.log(`  [${label}] attempt ${attempt}: not an image (${bytes.length}b)`);
      } else {
        await res.body?.cancel();
        rateLimited = res.status === 429;
        console.log(`  [${label}] attempt ${attempt}: HTTP ${res.status}`);
      }
    } catch (e) {
      console.log(`  [${label}] attempt ${attempt}: ${(e as Error).message}`);
    }
    const base = rateLimited ? 20_000 : 10_000;
    await sleep(Math.min(base * attempt, 120_000) + Math.random() * 8_000);
  }
  return null;
}

async function uploadImage(path: string, bytes: Uint8Array): Promise<string | null> {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY!,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "content-type": "image/jpeg",
      "x-upsert": "true",
    },
    body: bytes,
  });
  if (!res.ok) {
    console.log(`  upload ${path} failed: ${res.status} ${await res.text()}`);
    return null;
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}

/// Run jobs with a small worker pool — polite to the generation endpoint.
async function pool<T>(items: T[], worker: (item: T, i: number) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await worker(items[i], i);
    }
  });
  await Promise.all(workers);
}

// ---------- backfill ----------

async function backfill() {
  const res = await rest(
    "products?select=id,name,image_url&image_url=like.*pollinations*&order=created_at.asc",
  );
  const rows: { id: string; name: string; image_url: string }[] = await res.json();
  console.log(`${rows.length} products still on on-demand URLs`);

  let done = 0, failed = 0;
  await pool(rows, async (row) => {
    const seed = new URL(row.image_url).searchParams.get("seed") ?? crypto.randomUUID();
    const bytes = await fetchImage(row.image_url, row.name);
    if (!bytes) { failed++; console.log(`FAILED ${row.name}`); return; }
    const publicUrl = await uploadImage(`${seed}.jpg`, bytes);
    if (!publicUrl) { failed++; return; }
    const patch = await rest(`products?id=eq.${row.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ image_url: publicUrl }),
    });
    if (!patch.ok) { failed++; console.log(`PATCH failed ${row.name}`); return; }
    done++;
    console.log(`[${done + failed}/${rows.length}] ${row.name}`);
  });
  console.log(`backfill complete: ${done} stored, ${failed} failed`);
  if (failed > 0) Deno.exit(2);
}

// ---------- compose + insert ----------

async function ensureBrands(): Promise<Record<string, string>> {
  await rest("brands?on_conflict=slug", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(BRANDS.map((b) => ({
      slug: b.slug, name: b.name, tagline: b.tagline, aesthetic: b.aesthetic,
      accent_hex: b.accent_hex, bg_hex: b.bg_hex, sort: b.sort,
    }))),
  });
  const rows = await (await rest("brands?select=id,slug")).json();
  const map: Record<string, string> = {};
  for (const r of rows) map[r.slug] = r.id;
  return map;
}

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff;
}

async function generate(count: number, backdateDays: number) {
  const brandMap = await ensureBrands();

  const existing = await (await rest("products?select=name&limit=5000")).json();
  const seen = new Set<string>(existing.map((r: { name: string }) => r.name));

  // Compose first (cheap), then generate the expensive images in the pool.
  const composed = [];
  let attempts = 0;
  while (composed.length < count && attempts < count * 8) {
    attempts++;
    const p = composeProduct(randomSeed());
    if (seen.has(p.name)) continue;
    seen.add(p.name);
    composed.push(p);
  }
  console.log(`composed ${composed.length} products; generating images...`);

  let inserted = 0, failed = 0;
  await pool(composed, async (p) => {
    const onDemand = imageURL(p.image_prompt, p.image_seed);
    const bytes = await fetchImage(onDemand, p.name);
    if (!bytes) { failed++; console.log(`SKIP (no image) ${p.name}`); return; }
    const publicUrl = await uploadImage(`${p.image_seed}.jpg`, bytes);
    if (!publicUrl) { failed++; return; }

    const dropDate = new Date();
    if (backdateDays > 0) {
      dropDate.setUTCDate(dropDate.getUTCDate() - Math.floor(Math.random() * backdateDays));
    }
    const ins = await rest("products", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        brand_id: brandMap[p.brand_slug],
        name: p.name, category: p.category, slot: p.slot,
        style_tags: p.style_tags, color_name: p.color_name, price: p.price,
        rarity: p.rarity, description: p.description, image_url: publicUrl,
        drop_date: dropDate.toISOString().slice(0, 10),
      }),
    });
    if (!ins.ok) { failed++; console.log(`INSERT failed ${p.name}: ${await ins.text()}`); return; }
    inserted++;
    console.log(`[${inserted + failed}/${composed.length}] ${p.name} (${p.rarity})`);
  });
  console.log(`generate complete: ${inserted} inserted, ${failed} failed`);
  if (inserted === 0) Deno.exit(2);
}

// ---------- main ----------

function argNum(name: string, fallback: number): number {
  const i = Deno.args.indexOf(`--${name}`);
  return i >= 0 ? Number(Deno.args[i + 1]) : fallback;
}

const mode = Deno.args[0];
if (mode === "backfill") {
  await backfill();
} else if (mode === "drop") {
  await generate(argNum("count", 12), 0);
} else if (mode === "expand") {
  await generate(argNum("count", 300), argNum("backdate", 60));
} else {
  console.error("usage: generate.ts backfill | drop [--count N] | expand [--count N] [--backdate D]");
  Deno.exit(1);
}
