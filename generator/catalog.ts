// The catalog composer: procedurally builds fashion products with real-feeling
// names, colorways, prices, rarity, and a consistent product-shot image prompt.
// Shared by the daily `generate-products` edge function and the seed run, so
// the store and the daily drop speak the same design language.
//
// Determinism: every product gets a stable image seed from its name+color, and
// the image prompt runs through one house-style wrapper per brand, so a brand's
// shelf reads as one coherent lookbook (same backdrop, same lighting) the way
// Sideline's card art does — different endpoint (pollinations on-demand), so it
// never touches Sideline's Cloudflare/pollen quota.

export interface Brand {
  slug: string;
  name: string;
  tagline: string;
  aesthetic: string; // injected into every image prompt for this brand
  accent_hex: string;
  bg_hex: string; // studio backdrop keeps a brand's shots consistent
  bgWords: string; // how that backdrop reads to the image model
  sort: number;
}

export const BRANDS: Brand[] = [
  { slug: "halcyon", name: "Halcyon", tagline: "Quiet luxury, loud calm.",
    aesthetic: "quiet-luxury minimalist wardrobe, oatmeal camel and ivory tones, refined natural fabrics",
    accent_hex: "#B99C7A", bg_hex: "#EFE9E0", bgWords: "warm ivory", sort: 1 },
  { slug: "voltage", name: "Voltage", tagline: "Dress like a notification.",
    aesthetic: "Y2K electric streetwear, chrome and neon accents, glossy futuristic club fashion",
    accent_hex: "#FF2E88", bg_hex: "#14141C", bgWords: "deep charcoal", sort: 2 },
  { slug: "meridian", name: "Meridian & Co.", tagline: "Heritage, pressed sharp.",
    aesthetic: "heritage tailoring, navy forest-green and oxblood, structured old-money menswear-inspired",
    accent_hex: "#1F3A5F", bg_hex: "#E7E4DC", bgWords: "stone grey", sort: 3 },
  { slug: "fleur", name: "Fleur Sauvage", tagline: "Wildflower, tamed.",
    aesthetic: "romantic cottage-core florals, blush sage and cream, soft feminine silhouettes",
    accent_hex: "#D98A99", bg_hex: "#F4EEF0", bgWords: "soft blush", sort: 4 },
  { slug: "nocturne", name: "Nocturne", tagline: "For the hours after ten.",
    aesthetic: "sleek after-dark going-out fashion, black silver and gunmetal, sultry night-out glamour",
    accent_hex: "#8A8FA3", bg_hex: "#17171B", bgWords: "near-black slate", sort: 5 },
  { slug: "sunbleach", name: "Sunbleach", tagline: "Salt in your hair, sand in your shoes.",
    aesthetic: "coastal surf-town fashion, terracotta aqua and sun-faded tones, breezy relaxed vacation wear",
    accent_hex: "#E38B5B", bg_hex: "#EFEAE1", bgWords: "sun-bleached sand", sort: 6 },
  { slug: "ironwood", name: "Ironwood Supply", tagline: "Built to be worn out.",
    aesthetic: "rugged American workwear, olive rust and tan, heavy canvas and raw denim, utilitarian",
    accent_hex: "#6B7042", bg_hex: "#E6E2D6", bgWords: "raw linen", sort: 7 },
  { slug: "prism", name: "Prism", tagline: "Beige is a cry for help.",
    aesthetic: "maximalist color-pop fashion, primary brights and bold color-blocking, playful graphic",
    accent_hex: "#3A6EF0", bg_hex: "#F1F0EC", bgWords: "clean white", sort: 8 },
  { slug: "etoile", name: "Étoile", tagline: "Occasion optional.",
    aesthetic: "elevated eveningwear, champagne gold and deep jewel tones, liquid satin and beading, red-carpet",
    accent_hex: "#C9A24B", bg_hex: "#F3EFE6", bgWords: "champagne cream", sort: 9 },
  { slug: "cloudnine", name: "Cloud Nine", tagline: "Comfort, upgraded.",
    aesthetic: "cozy elevated loungewear and athleisure, cream dove-grey and sky-blue, soft brushed knits",
    accent_hex: "#A9B5C4", bg_hex: "#EEF1F4", bgWords: "cool cloud grey", sort: 10 },
];

type Category =
  | "top" | "bottom" | "dress" | "outerwear" | "shoes"
  | "bag" | "jewelry" | "sunglasses" | "hat" | "accessory";

// Which outfit-builder slot a category fills.
export const SLOT_FOR: Record<Category, string> = {
  top: "top", dress: "top", bottom: "bottom", outerwear: "outerwear",
  shoes: "footwear", bag: "bag", jewelry: "jewelry", sunglasses: "eyewear",
  hat: "headwear", accessory: "accessory",
};

interface Garment {
  noun: string;       // the item ("Cargo Pants")
  visual: string;     // how it reads to the image model
  materials: string[];
  base: number;       // base coin price before rarity
}

// Per-category garment pools. `visual` is the literal thing the camera sees.
const GARMENTS: Record<Category, Garment[]> = {
  top: [
    { noun: "Ribbed Turtleneck", visual: "ribbed knit turtleneck sweater", materials: ["merino wool", "cashmere", "cotton rib"], base: 220 },
    { noun: "Boxy Tee", visual: "boxy heavyweight cotton t-shirt", materials: ["heavyweight cotton", "organic jersey", "pima cotton"], base: 90 },
    { noun: "Silk Blouse", visual: "draped silk button blouse", materials: ["washed silk", "satin", "crepe"], base: 260 },
    { noun: "Cropped Cardigan", visual: "cropped ribbed button cardigan", materials: ["lambswool", "cotton blend", "mohair"], base: 240 },
    { noun: "Oxford Shirt", visual: "crisp oxford button-down shirt", materials: ["oxford cotton", "poplin", "linen"], base: 180 },
    { noun: "Corset Top", visual: "structured corset bustier top", materials: ["duchess satin", "denim", "leather"], base: 300 },
    { noun: "Halter Knit", visual: "backless halter knit top", materials: ["fine gauge knit", "ribbed viscose"], base: 210 },
    { noun: "Graphic Baby Tee", visual: "fitted baby tee with abstract graphic print", materials: ["cotton jersey", "stretch cotton"], base: 110 },
  ],
  bottom: [
    { noun: "Wide-Leg Trousers", visual: "flowing wide-leg tailored trousers", materials: ["wool suiting", "linen", "tencel"], base: 280 },
    { noun: "Baggy Jeans", visual: "baggy low-rise denim jeans", materials: ["raw denim", "washed denim", "selvedge"], base: 240 },
    { noun: "Cargo Pants", visual: "utility cargo pants with pockets", materials: ["ripstop cotton", "nylon", "canvas"], base: 230 },
    { noun: "Pleated Mini Skirt", visual: "pleated micro-mini skirt", materials: ["wool blend", "leather", "satin"], base: 190 },
    { noun: "Maxi Skirt", visual: "bias-cut floor-length maxi skirt", materials: ["silk", "chiffon", "jersey"], base: 250 },
    { noun: "Bike Shorts", visual: "sculpting bike shorts", materials: ["compression knit", "ribbed spandex"], base: 120 },
    { noun: "Tailored Shorts", visual: "sharp tailored dress shorts", materials: ["wool", "linen blend", "cotton twill"], base: 170 },
  ],
  dress: [
    { noun: "Slip Dress", visual: "bias-cut satin slip dress", materials: ["charmeuse satin", "silk", "cupro"], base: 320 },
    { noun: "Wrap Dress", visual: "knee-length wrap dress", materials: ["jersey", "crepe", "printed viscose"], base: 300 },
    { noun: "Shirt Dress", visual: "collared belted shirt dress", materials: ["poplin", "chambray", "linen"], base: 290 },
    { noun: "Sequin Mini", visual: "all-over sequin mini party dress", materials: ["sequin mesh", "beaded tulle"], base: 420 },
    { noun: "Knit Column Dress", visual: "ribbed column midi knit dress", materials: ["ribbed knit", "merino"], base: 340 },
    { noun: "Jumpsuit", visual: "sleeveless wide-leg jumpsuit", materials: ["crepe", "linen", "tencel"], base: 360 },
  ],
  outerwear: [
    { noun: "Oversized Blazer", visual: "oversized double-breasted blazer", materials: ["wool suiting", "tweed", "linen"], base: 420 },
    { noun: "Leather Moto Jacket", visual: "cropped leather moto jacket", materials: ["lambskin leather", "vegan leather"], base: 520 },
    { noun: "Trench Coat", visual: "belted knee-length trench coat", materials: ["cotton gabardine", "waxed cotton"], base: 560 },
    { noun: "Puffer Jacket", visual: "glossy quilted puffer jacket", materials: ["ripstop nylon", "recycled shell"], base: 480 },
    { noun: "Denim Jacket", visual: "boxy trucker denim jacket", materials: ["rigid denim", "washed denim"], base: 300 },
    { noun: "Wool Overcoat", visual: "long tailored wool overcoat", materials: ["melton wool", "camel hair"], base: 620 },
    { noun: "Bomber Jacket", visual: "satin souvenir bomber jacket", materials: ["satin", "nylon", "suede"], base: 360 },
  ],
  shoes: [
    { noun: "Chunky Sneakers", visual: "chunky platform sneakers", materials: ["mesh and suede", "leather"], base: 340 },
    { noun: "Knee Boots", visual: "pointed knee-high boots", materials: ["leather", "suede", "patent"], base: 460 },
    { noun: "Strappy Heels", visual: "strappy stiletto heels", materials: ["satin", "metallic leather"], base: 380 },
    { noun: "Loafers", visual: "chunky penny loafers", materials: ["polished leather", "suede"], base: 320 },
    { noun: "Ballet Flats", visual: "mesh ballet flats with ankle ties", materials: ["mesh", "satin", "leather"], base: 260 },
    { noun: "Combat Boots", visual: "lug-sole combat boots", materials: ["leather", "vegan leather"], base: 380 },
    { noun: "Slide Sandals", visual: "padded slide sandals", materials: ["leather", "foam"], base: 180 },
  ],
  bag: [
    { noun: "Shoulder Bag", visual: "slouchy leather shoulder bag", materials: ["leather", "suede", "nylon"], base: 380 },
    { noun: "Mini Bag", visual: "tiny structured top-handle mini bag", materials: ["patent leather", "leather"], base: 300 },
    { noun: "Tote Bag", visual: "oversized canvas tote bag", materials: ["waxed canvas", "leather"], base: 260 },
    { noun: "Baguette Bag", visual: "logo-free baguette shoulder bag", materials: ["satin", "leather"], base: 340 },
    { noun: "Crossbody", visual: "nylon crossbody sling bag", materials: ["ripstop nylon", "leather"], base: 240 },
    { noun: "Clutch", visual: "beaded evening clutch", materials: ["beaded satin", "metallic"], base: 320 },
  ],
  jewelry: [
    { noun: "Chunky Hoops", visual: "oversized chunky gold hoop earrings", materials: ["gold vermeil", "brass"], base: 140 },
    { noun: "Chain Necklace", visual: "bold curb-chain necklace", materials: ["gold plate", "sterling silver"], base: 180 },
    { noun: "Pearl Choker", visual: "baroque pearl choker", materials: ["freshwater pearl", "glass pearl"], base: 200 },
    { noun: "Stacking Rings", visual: "set of stacking rings", materials: ["gold vermeil", "silver"], base: 120 },
    { noun: "Tennis Bracelet", visual: "crystal tennis bracelet", materials: ["cubic zirconia", "crystal"], base: 220 },
    { noun: "Statement Cuff", visual: "wide sculptural metal cuff", materials: ["brushed brass", "silver"], base: 160 },
  ],
  sunglasses: [
    { noun: "Cat-Eye Shades", visual: "sharp cat-eye sunglasses", materials: ["acetate", "metal"], base: 160 },
    { noun: "Shield Sunglasses", visual: "wraparound shield sunglasses", materials: ["injected nylon", "acetate"], base: 190 },
    { noun: "Round Frames", visual: "thin round metal-frame sunglasses", materials: ["metal", "acetate"], base: 150 },
    { noun: "Rectangle Micro Shades", visual: "slim rectangular micro sunglasses", materials: ["acetate"], base: 150 },
    { noun: "Oversized Squares", visual: "oversized square sunglasses", materials: ["acetate", "gradient lens"], base: 170 },
  ],
  hat: [
    { noun: "Bucket Hat", visual: "structured bucket hat", materials: ["cotton twill", "nylon", "terry"], base: 120 },
    { noun: "Wool Beanie", visual: "ribbed cuffed beanie", materials: ["merino wool", "cashmere"], base: 100 },
    { noun: "Baseball Cap", visual: "unstructured baseball cap", materials: ["cotton twill", "corduroy"], base: 110 },
    { noun: "Wide-Brim Hat", visual: "wide-brim felt hat", materials: ["wool felt", "straw"], base: 200 },
    { noun: "Newsboy Cap", visual: "paneled newsboy cap", materials: ["tweed", "wool"], base: 140 },
  ],
  accessory: [
    { noun: "Leather Belt", visual: "wide leather belt with sculptural buckle", materials: ["leather", "suede"], base: 130 },
    { noun: "Silk Scarf", visual: "printed silk neck scarf", materials: ["silk twill", "satin"], base: 120 },
    { noun: "Leg Warmers", visual: "ribbed knit leg warmers", materials: ["chunky knit", "wool"], base: 90 },
    { noun: "Opera Gloves", visual: "satin opera gloves", materials: ["satin", "leather"], base: 150 },
    { noun: "Layered Belt Bag", visual: "utility belt bag on a chain", materials: ["nylon", "leather"], base: 170 },
  ],
};

// Series/collection words that front a product name so two "Cargo Pants" read
// as different drops.
const SERIES = [
  "Atelier", "Après", "Baseline", "Cascade", "District", "Ember", "Fable",
  "Grove", "Halo", "Icon", "Juno", "Kismet", "Lumen", "Marfa", "Nova",
  "Onyx", "Palermo", "Quartz", "Riviera", "Solstice", "Tundra", "Umbra",
  "Verona", "Wilder", "Xanadu", "Yuzu", "Zephyr", "Muse", "Rogue", "Echo",
];

// Colorways, tagged by mood so a brand pulls from a fitting palette.
const COLORWAYS: Record<string, string[]> = {
  neutral: ["Oatmeal", "Bone", "Camel", "Espresso", "Fog", "Sand", "Char", "Ivory", "Taupe", "Slate"],
  bright: ["Electric Blue", "Acid Lime", "Hot Pink", "Tangerine", "Cobalt", "Chartreuse", "Fuchsia", "Marigold"],
  dark: ["Jet Black", "Gunmetal", "Onyx", "Midnight", "Oxblood", "Deep Plum", "Forest", "Storm"],
  soft: ["Blush", "Sage", "Butter", "Powder Blue", "Lilac", "Peach", "Seafoam", "Rose"],
  jewel: ["Emerald", "Sapphire", "Ruby", "Amethyst", "Champagne", "Bronze", "Garnet", "Teal"],
  warm: ["Terracotta", "Rust", "Ochre", "Clay", "Sunset", "Paprika", "Honey", "Brick"],
};

const BRAND_PALETTE: Record<string, string[]> = {
  halcyon: ["neutral", "soft"], voltage: ["bright", "dark"], meridian: ["dark", "neutral"],
  fleur: ["soft", "neutral"], nocturne: ["dark", "jewel"], sunbleach: ["warm", "soft"],
  ironwood: ["warm", "neutral"], prism: ["bright", "jewel"], etoile: ["jewel", "neutral"],
  cloudnine: ["neutral", "soft"],
};

const STYLE_TAGS_POOL: Record<string, string[]> = {
  halcyon: ["minimal", "quiet-luxury", "workwear", "capsule"],
  voltage: ["y2k", "streetwear", "clubwear", "going-out"],
  meridian: ["preppy", "tailored", "old-money", "heritage"],
  fleur: ["cottagecore", "romantic", "floral", "feminine"],
  nocturne: ["going-out", "sultry", "party", "night"],
  sunbleach: ["coastal", "vacation", "surf", "relaxed"],
  ironwood: ["workwear", "rugged", "utility", "denim"],
  prism: ["colorful", "playful", "statement", "maximalist"],
  etoile: ["evening", "formal", "glam", "occasion"],
  cloudnine: ["loungewear", "athleisure", "cozy", "off-duty"],
};

const RARITIES: { name: string; weight: number; mult: number }[] = [
  { name: "common", weight: 58, mult: 1.0 },
  { name: "rare", weight: 26, mult: 1.5 },
  { name: "epic", weight: 12, mult: 2.4 },
  { name: "legendary", weight: 4, mult: 4.0 },
];

// Category mix for a generated batch — weighted toward wearables, with a
// healthy tail of accessories so outfit-building has jewelry/hats/shades.
const CATEGORY_WEIGHTS: [Category, number][] = [
  ["top", 20], ["bottom", 16], ["dress", 10], ["outerwear", 10], ["shoes", 12],
  ["bag", 9], ["jewelry", 9], ["sunglasses", 5], ["hat", 5], ["accessory", 4],
];

// ---- deterministic RNG so a seed reproduces a whole batch if needed ----
export function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(rng: () => number, arr: T[]): T => arr[Math.floor(rng() * arr.length)];
function weighted<T>(rng: () => number, pairs: [T, number][]): T {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [v, w] of pairs) { if ((r -= w) <= 0) return v; }
  return pairs[0][0];
}

export interface NewProduct {
  brand_slug: string;
  name: string;
  category: Category;
  slot: string;
  style_tags: string[];
  color_name: string;
  price: number;
  rarity: string;
  description: string;
  image_seed: number;
  image_prompt: string;
}

/** FNV-1a masked to 31 bits — pollinations rejects seeds above int32 max. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(text)) {
    h ^= b; h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h & 0x7fffffff;
}

function priceFor(base: number, mult: number, rng: () => number): number {
  const jitter = 0.9 + rng() * 0.25;                 // ±, so prices aren't uniform
  const raw = base * mult * jitter;
  return Math.max(50, Math.round(raw / 10) * 10);    // round to a tidy 10
}

function describe(brand: Brand, color: string, material: string, g: Garment, rarity: string): string {
  const openers = [
    `The ${color} ${g.noun.toLowerCase()} you'll reach for on repeat.`,
    `Cut in ${material} for that ${brand.tagline.toLowerCase().replace(/\.$/, "")} feeling.`,
    `A ${color.toLowerCase()} ${g.noun.toLowerCase()} that does the heavy lifting.`,
    `${brand.name}'s take on the ${g.noun.toLowerCase()}, in ${material}.`,
  ];
  const closers: Record<string, string> = {
    common: "An everyday win for your closet.",
    rare: "A little harder to find. Grab it.",
    epic: "A statement piece. People will ask.",
    legendary: "A one-in-a-hundred drop. Flex accordingly.",
  };
  return `${openers[Math.floor(color.length + material.length) % openers.length]} ${closers[rarity]}`;
}

/** Build one product from a fresh seed. */
export function composeProduct(seed: number, forcedCategory?: Category): NewProduct {
  const rng = mulberry32(seed);
  const brand = pick(rng, BRANDS);
  const category = forcedCategory ?? weighted(rng, CATEGORY_WEIGHTS);
  const g = pick(rng, GARMENTS[category]);
  const material = pick(rng, g.materials);
  const paletteKeys = BRAND_PALETTE[brand.slug];
  const color = pick(rng, COLORWAYS[pick(rng, paletteKeys)]);
  const series = pick(rng, SERIES);
  const rarity = weighted(rng, RARITIES.map((r) => [r, r.weight] as [typeof r, number]));
  const price = priceFor(g.base, rarity.mult, rng);
  const tagPool = STYLE_TAGS_POOL[brand.slug];
  const style_tags = Array.from(new Set([pick(rng, tagPool), pick(rng, tagPool), category]));
  const name = `${series} ${color} ${g.noun}`;

  const image_prompt =
    `professional e-commerce product photograph of a single ${color.toLowerCase()} ${material} ` +
    `${g.visual}, ${brand.aesthetic}, centered on a seamless ${brand.bgWords} studio backdrop, ` +
    `soft even diffused studio lighting, sharp focus, high detail, clean catalog product shot, ` +
    `no people, no mannequin, no text, no words, no logo, no watermark`;

  return {
    brand_slug: brand.slug,
    name,
    category,
    slot: SLOT_FOR[category],
    style_tags,
    color_name: color,
    price,
    rarity: rarity.name,
    description: describe(brand, color, material, g, rarity.name),
    image_seed: fnv1a(name + brand.slug),
    image_prompt,
  };
}

/** Pollinations on-demand URL (keyless). Deterministic per product via seed. */
export function imageURL(prompt: string, seed: number): string {
  const path = encodeURIComponent(prompt).replace(/%2C/g, ",");
  return `https://image.pollinations.ai/prompt/${path}` +
    `?width=800&height=1000&nologo=true&seed=${seed}&model=flux`;
}
