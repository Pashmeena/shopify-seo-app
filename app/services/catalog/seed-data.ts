/**
 * Demo catalog: 36 wallpaper products with structured, namespaced tags
 * (style:/room:/color:/material:/attribute:/use-case:/audience:) — the
 * faceted source of truth that discovery and matching are built on.
 *
 * The distribution is deliberate:
 * - botanical × living-room, floral × bedroom, peel-and-stick × renters and
 *   kids-room all clear the 6-product threshold, so the happy paths demo well.
 * - Dark/moody designs (Midnight Jungle, Noir Botanica, Night Bloom, Onyx
 *   Deco Nights) are never tagged room:kids-room — a "kids room" query must
 *   not surface them.
 * - use-case:humid-rooms has only 3 products, a below-threshold group that
 *   demonstrates the "held for review, never published" path.
 */
export interface SeedProduct {
  handle: string;
  title: string;
  description: string;
  price: string;
  tags: string[];
}

export const SEED_TAG = "wp-seed";

export const SEED_PRODUCTS: SeedProduct[] = [
  // ── Botanical ──────────────────────────────────────────────────────────
  {
    handle: "emerald-palm-canopy",
    title: "Emerald Palm Canopy",
    description:
      "Layered palm fronds in deep emerald on a soft eggshell ground. Large 64 cm pattern repeat suits generous walls. Non-woven, paste-the-wall, 53 cm × 10.05 m (20.9 in × 33 ft) roll.",
    price: "98.00",
    tags: ["style:botanical", "style:tropical", "room:living-room", "room:dining-room", "color:green", "material:non-woven", "attribute:sustainable"],
  },
  {
    handle: "fern-study",
    title: "Fern Study",
    description:
      "Hand-drawn fern varieties arranged like a botanist's plate, in forest green on warm white. FSC-certified non-woven base with a wipeable finish. 53 cm × 10.05 m roll.",
    price: "89.00",
    tags: ["style:botanical", "room:living-room", "room:home-office", "color:green", "material:non-woven", "attribute:sustainable", "attribute:washable"],
  },
  {
    handle: "wild-meadow",
    title: "Wild Meadow",
    description:
      "Loose meadow grasses and seed heads in sage and straw tones. Quiet, airy and matte — a botanical that reads almost as a neutral. Uncoated paper, 52 cm × 10 m roll.",
    price: "76.00",
    tags: ["style:botanical", "style:floral", "room:living-room", "room:bedroom", "color:sage-green", "material:paper", "attribute:sustainable"],
  },
  {
    handle: "midnight-jungle",
    title: "Midnight Jungle",
    description:
      "Dense rainforest foliage in near-black greens with charcoal shadows. A dramatic, enveloping wall for evening rooms. Scrubbable vinyl, 53 cm × 10.05 m roll.",
    price: "104.00",
    tags: ["style:botanical", "style:tropical", "room:living-room", "room:dining-room", "color:charcoal", "color:dark-green", "material:vinyl", "attribute:washable", "attribute:dramatic"],
  },
  {
    handle: "noir-botanica",
    title: "Noir Botanica",
    description:
      "Engraved botanical etchings reversed out of a matte ink-black ground. Moody and formal; sublime behind candlelight. Non-woven, 53 cm × 10.05 m roll.",
    price: "112.00",
    tags: ["style:botanical", "room:dining-room", "room:hallway", "color:black", "material:non-woven", "attribute:dramatic"],
  },
  {
    handle: "eucalyptus-drift",
    title: "Eucalyptus Drift",
    description:
      "Trailing eucalyptus sprigs in muted grey-green on chalk white. Calm, restorative and easy to pair. Non-woven and removable without residue. 53 cm × 10.05 m roll.",
    price: "85.00",
    tags: ["style:botanical", "room:bedroom", "room:living-room", "color:soft-green", "material:non-woven", "attribute:sustainable", "attribute:removable"],
  },
  {
    handle: "monstera-line-art",
    title: "Monstera Line Art",
    description:
      "Single-line monstera leaves in fine terracotta ink on cream — botanical subject, minimalist delivery. Repositionable peel and stick panel, 61 cm × 5.5 m (24 in × 18 ft).",
    price: "64.00",
    tags: ["style:botanical", "style:minimalist", "room:living-room", "room:home-office", "color:cream", "material:peel-and-stick", "attribute:removable", "use-case:renters"],
  },
  {
    handle: "botanical-sketchbook",
    title: "Botanical Sketchbook",
    description:
      "Faded graphite botanicals with handwritten Latin names on aged ivory — a vintage herbarium brought to the wall. Uncoated paper, 52 cm × 10 m roll.",
    price: "79.00",
    tags: ["style:botanical", "style:vintage", "room:living-room", "room:hallway", "color:ivory", "material:paper", "attribute:sustainable"],
  },
  {
    handle: "olive-grove",
    title: "Olive Grove",
    description:
      "Silvery olive branches in soft olive and stone on a scrubbable vinyl ground built for busy spaces. Wipes clean of splashes and scuffs. 53 cm × 10.05 m roll.",
    price: "92.00",
    tags: ["style:botanical", "room:kitchen", "room:dining-room", "color:olive", "material:vinyl", "attribute:washable", "use-case:high-traffic"],
  },
  {
    handle: "trailing-ivy",
    title: "Trailing Ivy",
    description:
      "Delicate ivy runners climbing a pale linen-look ground. Peel and stick, repositionable and fully removable — commitment-free greenery. 61 cm × 5.5 m panel.",
    price: "58.00",
    tags: ["style:botanical", "room:living-room", "room:bedroom", "color:green", "material:peel-and-stick", "attribute:removable", "use-case:renters"],
  },

  // ── Floral ─────────────────────────────────────────────────────────────
  {
    handle: "peony-blush",
    title: "Peony Blush",
    description:
      "Overblown peonies in blush and rose against warm alabaster. Romantic without being sugary; a soft focal wall. Non-woven, 53 cm × 10.05 m roll.",
    price: "96.00",
    tags: ["style:floral", "room:bedroom", "room:living-room", "color:blush-pink", "material:non-woven"],
  },
  {
    handle: "pressed-wildflowers",
    title: "Pressed Wildflowers",
    description:
      "Pressed lilac, cornflower and daisy specimens scattered on off-white — gentle enough for small and young sleepers. Uncoated paper, 52 cm × 10 m roll.",
    price: "72.00",
    tags: ["style:floral", "style:vintage", "room:bedroom", "room:kids-room", "color:lilac", "material:paper", "attribute:sustainable"],
  },
  {
    handle: "watercolour-roses",
    title: "Watercolour Roses",
    description:
      "Loose watercolour roses in dusty rose bleeding softly into grey-white. Painterly and light. Non-woven, removable without residue, 53 cm × 10.05 m roll.",
    price: "88.00",
    tags: ["style:floral", "room:bedroom", "room:hallway", "color:dusty-rose", "material:non-woven", "attribute:removable"],
  },
  {
    handle: "marigold-field",
    title: "Marigold Field",
    description:
      "Stylised marigolds in ochre and saffron rows on warm cream — folk-inflected and sunny. FSC-certified non-woven, 53 cm × 10.05 m roll.",
    price: "84.00",
    tags: ["style:floral", "room:bedroom", "room:dining-room", "color:ochre", "material:non-woven", "attribute:sustainable"],
  },
  {
    handle: "cherry-blossom-mist",
    title: "Cherry Blossom Mist",
    description:
      "Drifting cherry blossom branches in pale pink over misted white. Peel and stick, repositionable, removes clean from painted walls. 61 cm × 5.5 m panel.",
    price: "62.00",
    tags: ["style:floral", "room:bedroom", "room:living-room", "color:soft-pink", "material:peel-and-stick", "attribute:removable", "use-case:renters"],
  },
  {
    handle: "night-bloom",
    title: "Night Bloom",
    description:
      "Oversized dahlias and moths in moonlit tones on deep navy. Dark, velvety and theatrical. Scrubbable vinyl, 53 cm × 10.05 m roll.",
    price: "106.00",
    tags: ["style:floral", "room:bedroom", "room:dining-room", "color:navy", "material:vinyl", "attribute:dramatic", "attribute:washable"],
  },

  // ── Tropical ───────────────────────────────────────────────────────────
  {
    handle: "flamingo-lagoon",
    title: "Flamingo Lagoon",
    description:
      "Wading flamingos in coral pink across a pale aqua lagoon. Cheerful, steam-tolerant vinyl that wipes dry — happy in bathrooms and playful rooms. 53 cm × 10.05 m roll.",
    price: "86.00",
    tags: ["style:tropical", "room:kids-room", "room:bathroom", "color:coral", "material:vinyl", "attribute:washable", "use-case:kids", "use-case:humid-rooms", "audience:parents"],
  },
  {
    handle: "banana-leaf-breeze",
    title: "Banana Leaf Breeze",
    description:
      "Classic banana leaves in fresh mid-greens, drawn loose and breezy. Moisture-tolerant vinyl suited to bathrooms and steamy spaces. 53 cm × 10.05 m roll.",
    price: "90.00",
    tags: ["style:tropical", "room:living-room", "room:bathroom", "color:green", "material:vinyl", "attribute:washable", "use-case:humid-rooms"],
  },
  {
    handle: "paradise-parrots",
    title: "Paradise Parrots",
    description:
      "Bright parrots and hibiscus in saturated primaries — energetic, joyful and made for small explorers. Peel and stick, removes clean when tastes change. 61 cm × 5.5 m panel.",
    price: "60.00",
    tags: ["style:tropical", "room:kids-room", "color:multi", "material:peel-and-stick", "attribute:removable", "use-case:kids", "use-case:renters", "audience:parents"],
  },
  {
    handle: "palm-springs",
    title: "Palm Springs",
    description:
      "Mid-century palms in mint and blush with a sun-faded 1960s poster feel. Non-woven, paste-the-wall. 53 cm × 10.05 m roll.",
    price: "94.00",
    tags: ["style:tropical", "style:vintage", "room:living-room", "room:hallway", "color:mint", "material:non-woven"],
  },

  // ── Geometric ──────────────────────────────────────────────────────────
  {
    handle: "honeycomb-haze",
    title: "Honeycomb Haze",
    description:
      "Tonal hexagons in soft greys with a faint metallic keyline — quiet structure for focused rooms. Non-woven, 53 cm × 10.05 m roll.",
    price: "82.00",
    tags: ["style:geometric", "style:minimalist", "room:home-office", "room:hallway", "color:grey", "material:non-woven"],
  },
  {
    handle: "scandi-triangles",
    title: "Scandi Triangles",
    description:
      "Scattered triangles in muted pastel multi on white — playful but calm, Scandinavian style. Peel and stick, repositionable for easy nursery updates. 61 cm × 5.5 m panel.",
    price: "56.00",
    tags: ["style:geometric", "room:kids-room", "room:bedroom", "color:pastel-multi", "material:peel-and-stick", "attribute:removable", "use-case:kids", "use-case:renters", "audience:parents"],
  },
  {
    handle: "art-grid",
    title: "Art Grid",
    description:
      "A fine hand-ruled grid in warm beige on off-white, like a sheet of drafting paper at room scale. FSC-certified non-woven, 53 cm × 10.05 m roll.",
    price: "78.00",
    tags: ["style:geometric", "style:minimalist", "room:home-office", "room:living-room", "color:beige", "material:non-woven", "attribute:sustainable"],
  },
  {
    handle: "terrazzo-play",
    title: "Terrazzo Play",
    description:
      "Chunky terrazzo chips in confetti brights on putty — durable, scrubbable vinyl that shrugs off fingerprints and splashes. 53 cm × 10.05 m roll.",
    price: "74.00",
    tags: ["style:geometric", "room:kids-room", "room:bathroom", "color:multi", "material:vinyl", "attribute:washable", "use-case:kids", "use-case:high-traffic", "use-case:humid-rooms", "audience:parents"],
  },
  {
    handle: "deco-fans",
    title: "Deco Fans",
    description:
      "Radiating fan arcs in teal with fine gold detailing — rhythm and glamour in equal measure. Non-woven, 53 cm × 10.05 m roll.",
    price: "102.00",
    tags: ["style:art-deco", "style:geometric", "room:living-room", "room:hallway", "color:teal", "material:non-woven"],
  },

  // ── Art deco ───────────────────────────────────────────────────────────
  {
    handle: "gatsby-arches",
    title: "Gatsby Arches",
    description:
      "Nested arches in emerald and antique gold, a 1920s ballroom in repeat. Non-woven, paste-the-wall, 53 cm × 10.05 m roll.",
    price: "108.00",
    tags: ["style:art-deco", "room:living-room", "room:dining-room", "color:emerald", "material:non-woven"],
  },
  {
    handle: "champagne-deco",
    title: "Champagne Deco",
    description:
      "Sunburst deco motifs in champagne and pearl with a soft sheen that catches evening light. Non-woven, 53 cm × 10.05 m roll.",
    price: "98.00",
    tags: ["style:art-deco", "room:bedroom", "room:hallway", "color:champagne", "material:non-woven"],
  },
  {
    handle: "onyx-deco-nights",
    title: "Onyx Deco Nights",
    description:
      "High-gloss deco geometry in black and burnished gold — unapologetically dramatic after dark. Scrubbable vinyl, 53 cm × 10.05 m roll.",
    price: "116.00",
    tags: ["style:art-deco", "room:dining-room", "room:living-room", "color:black", "material:vinyl", "attribute:dramatic", "attribute:washable"],
  },

  // ── Chinoiserie ────────────────────────────────────────────────────────
  {
    handle: "silk-garden-birds",
    title: "Silk Garden Birds",
    description:
      "Songbirds among flowering branches on duck-egg blue, in the manner of hand-painted silk panels. Non-woven, 53 cm × 10.05 m roll.",
    price: "124.00",
    tags: ["style:chinoiserie", "style:botanical", "room:bedroom", "room:living-room", "color:duck-egg-blue", "material:non-woven"],
  },
  {
    handle: "willow-pavilion",
    title: "Willow Pavilion",
    description:
      "Willow trees, bridges and pavilions in celadon on cream — the classic export porcelain scene, reimagined at wall scale. Uncoated paper, 52 cm × 10 m roll.",
    price: "118.00",
    tags: ["style:chinoiserie", "room:dining-room", "room:hallway", "color:celadon", "material:paper", "attribute:sustainable"],
  },
  {
    handle: "indigo-cranes",
    title: "Indigo Cranes",
    description:
      "Cranes in flight over stylised waves, white on deep indigo. Serene, formal and quietly dramatic. Non-woven, 53 cm × 10.05 m roll.",
    price: "122.00",
    tags: ["style:chinoiserie", "room:bedroom", "room:dining-room", "color:indigo", "material:non-woven", "attribute:dramatic"],
  },

  // ── Kids & nursery ─────────────────────────────────────────────────────
  {
    handle: "sleepy-clouds",
    title: "Sleepy Clouds",
    description:
      "Drowsy clouds and tiny stars in powder blue on white — a nursery classic that won't date. Peel and stick, removes clean from rented walls. 61 cm × 5.5 m panel.",
    price: "54.00",
    tags: ["style:minimalist", "room:kids-room", "room:bedroom", "color:powder-blue", "material:peel-and-stick", "attribute:removable", "use-case:kids", "use-case:renters", "audience:parents", "audience:renters"],
  },
  {
    handle: "safari-parade",
    title: "Safari Parade",
    description:
      "A parade of hand-drawn elephants, giraffes and lions in sandy tones. Peel and stick and repositionable — survives both toddlers and tenancy inspections. 61 cm × 5.5 m panel.",
    price: "58.00",
    tags: ["style:tropical", "room:kids-room", "color:sand", "material:peel-and-stick", "attribute:removable", "use-case:kids", "use-case:renters", "audience:parents"],
  },
  {
    handle: "rainbow-stripes",
    title: "Rainbow Stripes",
    description:
      "Soft-edged rainbow stripes in faded pastels — cheerful colour without the sugar rush. Wipeable peel and stick, kind to walls and deposits. 61 cm × 5.5 m panel.",
    price: "52.00",
    tags: ["style:geometric", "room:kids-room", "color:pastel-multi", "material:peel-and-stick", "attribute:removable", "attribute:washable", "use-case:kids", "use-case:renters", "audience:parents", "audience:renters"],
  },
  {
    handle: "starry-night-sky",
    title: "Starry Night Sky",
    description:
      "A midnight blue sky scattered with fine gold constellations — calm, wonder-filled and printed with water-based inks on FSC-certified non-woven. 53 cm × 10.05 m roll.",
    price: "82.00",
    tags: ["style:minimalist", "room:kids-room", "room:bedroom", "color:midnight-blue", "material:non-woven", "attribute:sustainable", "use-case:kids", "audience:parents"],
  },
  {
    handle: "counting-sheep",
    title: "Counting Sheep",
    description:
      "Woolly sheep hopping fences in soft pencil lines on cream — a storybook wall for small bedrooms. Uncoated paper printed with water-based inks. 52 cm × 10 m roll.",
    price: "68.00",
    tags: ["style:vintage", "room:kids-room", "room:bedroom", "color:cream", "material:paper", "attribute:sustainable", "use-case:kids", "audience:parents"],
  },
];
