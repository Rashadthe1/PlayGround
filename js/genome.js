// Genome model: anatomy, physiology, personality, mutation, inheritance and 2D silhouettes.
import { clamp, lerp, pick, chance, randRange, makeSpeciesName, makeCommonName, mulberry32, hashString } from './util.js';

export const PATTERNS = ['solid', 'stripes', 'spots', 'gradient', 'dorsal'];
export const TEXTURES = ['smooth', 'scales', 'fur', 'chitin'];
export const DIETS = ['herbivore', 'carnivore', 'omnivore', 'scavenger'];

const GENE_RANGES = {
  size: [0.55, 2.6], bodyLength: [0.6, 2.1], bodyWidth: [0.55, 1.8], bodyHeight: [0.55, 1.9],
  neckLength: [0, 1.6], headSize: [0.45, 1.7], snoutLength: [0.2, 1.9], eyeSize: [0.4, 1.8],
  legCount: [2, 6], legLength: [0.35, 1.9], legThickness: [0.4, 1.8], armLength: [0, 1.5],
  tailLength: [0, 2.1], wingSpan: [0, 2.1], hornSize: [0, 1.6], spikeSize: [0, 1.5],
  armor: [0, 1.4], clawSize: [0, 1.5], teethSize: [0.2, 1.8], jawSize: [0.4, 1.6],
  hue1: [0, 360], hue2: [0, 360], saturation: [20, 95], lightness: [24, 72],
  speed: [0.2, 1], strength: [0.15, 1], agility: [0.15, 1], intelligence: [0.1, 1],
  metabolism: [0.2, 1], fertility: [0.2, 1], lifespan: [0.25, 1], senseRange: [0.2, 1],
  fearfulness: [0.05, 1], boldness: [0.05, 1], aggression: [0.05, 1], sociability: [0.05, 1],
  pattern: [0, 4], texture: [0, 3]
};

export const GENE_LABELS = {
  size: 'Body Mass', bodyLength: 'Torso Length', bodyWidth: 'Torso Width', bodyHeight: 'Torso Depth',
  neckLength: 'Neck Length', headSize: 'Head Size', snoutLength: 'Snout', eyeSize: 'Eyes',
  legCount: 'Legs', legLength: 'Leg Length', legThickness: 'Leg Build', armLength: 'Arms',
  tailLength: 'Tail', wingSpan: 'Wingspan', hornSize: 'Horns', spikeSize: 'Spines',
  armor: 'Armor', clawSize: 'Claws', teethSize: 'Teeth', jawSize: 'Jaw',
  hue1: 'Primary Hue', hue2: 'Secondary Hue', saturation: 'Saturation', lightness: 'Brightness',
  speed: 'Speed', strength: 'Strength', agility: 'Agility', intelligence: 'Intelligence',
  metabolism: 'Metabolism', fertility: 'Fertility', lifespan: 'Longevity', senseRange: 'Senses',
  fearfulness: 'Fearfulness', boldness: 'Boldness', aggression: 'Aggression', sociability: 'Sociability'
};

export function defaultGenome(seed = Date.now()) {
  const rng = mulberry32(seed);
  return normalizeGenome({
    size: 1, bodyLength: 1.05, bodyWidth: 0.85, bodyHeight: 0.82, neckLength: 0.35,
    headSize: 0.86, snoutLength: 0.62, eyeSize: 1, legCount: 4, legLength: 1.02,
    legThickness: 0.9, armLength: 0, tailLength: 1.05, wingSpan: 0, hornSize: 0.15,
    spikeSize: 0.12, armor: 0.18, clawSize: 0.35, teethSize: 0.55, jawSize: 0.8,
    hue1: 155 + rng() * 40, hue2: 44, saturation: 62, lightness: 48,
    speed: 0.55, strength: 0.5, agility: 0.62, intelligence: 0.7, metabolism: 0.5,
    fertility: 0.55, lifespan: 0.62, senseRange: 0.55,
    fearfulness: 0.42, boldness: 0.58, aggression: 0.32, sociability: 0.62,
    pattern: 2, texture: 1, diet: 'omnivore',
    ...{ seed }
  });
}

export function normalizeGenome(g) {
  const out = { ...g };
  for (const [key, [min, max]] of Object.entries(GENE_RANGES)) {
    let v = Number(out[key]);
    if (!Number.isFinite(v)) v = min;
    if (key === 'legCount') v = [2, 4, 6].reduce((best, n) => Math.abs(n - v) < Math.abs(best - v) ? n : best, 4);
    out[key] = clamp(v, min, max);
  }
  if (!DIETS.includes(out.diet)) out.diet = 'omnivore';
  out.pattern = Math.round(out.pattern);
  out.texture = Math.round(out.texture);
  out.wings = out.wingSpan > 0.72 ? 2 : 0;
  out.id = out.id || 'g' + Math.floor(Math.random() * 1e9).toString(36);
  return out;
}

export function presetGenome(kind, rng = mulberry32(7)) {
  const base = defaultGenome(Math.floor(rng() * 1e9));
  const variants = {
    grazer: { size: 1.35, bodyLength: 1.25, bodyWidth: 1.02, bodyHeight: 0.98, neckLength: 0.95, headSize: 0.66, snoutLength: 0.7, legLength: 1.3, legThickness: 1.0, tailLength: 1.0, hue1: 96, hue2: 58, pattern: 1, texture: 2, teethSize: 0.3, jawSize: 0.72, armor: 0.22, speed: 0.52, strength: 0.52, agility: 0.45, intelligence: 0.55, sociability: 0.9, fearfulness: 0.55, aggression: 0.12, diet: 'herbivore' },
    strider: { size: 1.02, bodyLength: 1.0, bodyWidth: 0.74, bodyHeight: 0.8, neckLength: 0.6, headSize: 0.72, snoutLength: 0.6, legCount: 2, legLength: 1.65, legThickness: 0.72, armLength: 0.55, tailLength: 1.3, hue1: 38, hue2: 24, pattern: 0, texture: 1, speed: 0.86, agility: 0.82, strength: 0.34, intelligence: 0.65, sociability: 0.58, diet: 'herbivore', fearfulness: 0.7 },
    stalker: { size: 1.28, bodyLength: 1.35, bodyWidth: 0.92, bodyHeight: 0.85, neckLength: 0.45, headSize: 0.9, snoutLength: 1.12, legCount: 4, legLength: 1.1, legThickness: 1.02, tailLength: 1.45, hue1: 4, hue2: 26, pattern: 4, texture: 1, clawSize: 1.2, teethSize: 1.4, jawSize: 1.25, hornSize: 0.55, speed: 0.78, strength: 0.82, agility: 0.68, aggression: 0.9, fearfulness: 0.25, boldness: 0.8, sociability: 0.7, diet: 'carnivore' },
    hopper: { size: 0.82, bodyLength: 0.88, bodyWidth: 0.82, bodyHeight: 0.9, neckLength: 0.25, headSize: 1.05, snoutLength: 0.5, eyeSize: 1.55, legCount: 2, legLength: 1.45, legThickness: 0.82, armLength: 0.8, tailLength: 0.8, hue1: 192, hue2: 312, pattern: 2, texture: 0, speed: 0.72, agility: 0.92, intelligence: 0.88, sociability: 0.78, fearfulness: 0.6, diet: 'omnivore', wingSpan: 0 },
    scavenger: { size: 0.78, bodyLength: 1.0, bodyWidth: 0.95, bodyHeight: 0.64, neckLength: 0.3, headSize: 0.72, snoutLength: 0.85, legCount: 6, legLength: 0.72, legThickness: 0.68, tailLength: 0.55, hue1: 220, hue2: 46, pattern: 2, texture: 3, armor: 1.05, spikeSize: 0.6, speed: 0.62, agility: 0.7, strength: 0.4, intelligence: 0.8, sociability: 0.7, fearfulness: 0.45, diet: 'scavenger' },
    glider: { size: 1.0, bodyLength: 1.0, bodyWidth: 0.7, bodyHeight: 0.74, neckLength: 0.55, headSize: 0.82, snoutLength: 0.9, legCount: 2, legLength: 1.15, legThickness: 0.62, armLength: 0.6, tailLength: 1.3, wingSpan: 1.85, hue1: 278, hue2: 188, pattern: 3, texture: 2, clawSize: 0.9, teethSize: 0.9, speed: 0.72, agility: 0.95, strength: 0.42, intelligence: 0.8, sociability: 0.5, fearfulness: 0.35, diet: 'carnivore', wingSpanFlying: true },
    titan: { size: 2.3, bodyLength: 1.75, bodyWidth: 1.5, bodyHeight: 1.45, neckLength: 0.9, headSize: 0.95, snoutLength: 0.72, legCount: 4, legLength: 0.95, legThickness: 1.65, tailLength: 1.1, hornSize: 1.2, spikeSize: 0.8, armor: 0.72, hue1: 18, hue2: 8, pattern: 4, texture: 1, teethSize: 0.3, danger: 0.4, speed: 0.38, strength: 0.95, agility: 0.25, intelligence: 0.45, sociability: 0.72, fearfulness: 0.2, aggression: 0.35, diet: 'herbivore', lifespan: 0.9 },
    lurker: { size: 1.55, bodyLength: 1.5, bodyWidth: 1.2, bodyHeight: 0.74, neckLength: 0.2, headSize: 1.2, snoutLength: 1.35, legCount: 4, legLength: 0.48, legThickness: 1.25, tailLength: 1.8, hue1: 148, hue2: 76, pattern: 2, texture: 3, armor: 0.95, spikeSize: 0.75, clawSize: 1.1, teethSize: 1.28, jawSize: 1.35, speed: 0.5, strength: 0.86, agility: 0.35, intelligence: 0.6, fearfulness: 0.18, aggression: 0.75, sociability: 0.35, diet: 'carnivore' }
  };
  return normalizeGenome({ ...base, ...(variants[kind] || {}) });
}

const MUTATION_SCALE = {
  size: 0.09, bodyLength: 0.11, bodyWidth: 0.1, bodyHeight: 0.1, neckLength: 0.12, headSize: 0.1,
  snoutLength: 0.12, eyeSize: 0.1, legLength: 0.11, legThickness: 0.1, armLength: 0.12,
  tailLength: 0.12, wingSpan: 0.1, hornSize: 0.12, spikeSize: 0.12, armor: 0.1,
  clawSize: 0.12, teethSize: 0.1, jawSize: 0.1, hue1: 6, hue2: 7, saturation: 4, lightness: 4,
  speed: 0.055, strength: 0.055, agility: 0.055, intelligence: 0.045, metabolism: 0.05,
  fertility: 0.05, lifespan: 0.05, senseRange: 0.05, fearfulness: 0.06, boldness: 0.06,
  aggression: 0.06, sociability: 0.06
};

function gauss(rng) { return (rng() + rng() + rng() - 1.5) / 1.5; }

export function mutateGenome(parent, rng = Math.random, intensity = 1, pressures = {}) {
  const g = { ...parent };
  const pressureKeys = Object.keys(pressures);
  for (const [key, [min, max]] of Object.entries(GENE_RANGES)) {
    if (key === 'pattern' || key === 'texture') continue;
    let amount = MUTATION_SCALE[key] || 0.05;
    let bias = 0;
    if (pressures.cold) {
      if (key === 'size' || key === 'bodyHeight') bias += 0.12;
      if (key === 'metabolism') bias -= 0.05;
    }
    if (pressures.predators) {
      if (key === 'armor' || key === 'speed' || key === 'legLength' || key === 'senseRange') bias += 0.12;
      if (key === 'size') bias += 0.04;
    }
    if (pressures.scarcity) {
      if (key === 'metabolism') bias -= 0.14;
      if (key === 'size') bias -= 0.06;
      if (key === 'fertility') bias += 0.05;
    }
    if (pressures.arid) {
      if (key === 'bodyHeight') bias -= 0.04;
      if (key === 'legLength') bias += 0.08;
      if (key === 'metabolism') bias -= 0.05;
    }
    if (pressures.competition) {
      if (key === 'strength' || key === 'aggression' || key === 'teethSize') bias += 0.1;
      if (key === 'size') bias += 0.05;
    }
    g[key] = clamp(g[key] + gauss(rng) * amount * intensity + bias * intensity * (max - min) * 0.35, min, max);
  }
  if (chance(rng, 0.06 * intensity)) g.pattern = pick(rng, [0, 1, 2, 3, 4]);
  if (chance(rng, 0.045 * intensity)) g.texture = pick(rng, [0, 1, 2, 3]);
  if (chance(rng, 0.07 * intensity)) g.diet = mutateDiet(g.diet, rng);
  if (chance(rng, 0.035 * intensity) && pressureKeys.length) {
    if (pressures.predators && chance(rng, 0.5)) g.diet = 'carnivore';
    if (pressures.scarcity && chance(rng, 0.45)) g.diet = 'omnivore';
  }
  g.id = 'g' + Math.floor(rng() * 1e9).toString(36);
  return normalizeGenome(g);
}

function mutateDiet(diet, rng) {
  const near = { herbivore: ['herbivore', 'omnivore'], carnivore: ['carnivore', 'omnivore', 'scavenger'], omnivore: ['omnivore', 'herbivore', 'carnivore', 'scavenger'], scavenger: ['scavenger', 'carnivore', 'omnivore'] };
  return pick(rng, near[diet] || DIETS);
}

export function crossoverGenome(a, b, rng = Math.random, mutation = 0.45) {
  const child = {};
  for (const key of Object.keys(GENE_RANGES)) {
    const va = a[key], vb = b[key];
    child[key] = chance(rng, 0.5) ? va : vb;
    if (typeof va === 'number' && key !== 'pattern' && key !== 'texture' && key !== 'legCount') {
      child[key] = lerp(va, vb, rng());
    }
  }
  child.diet = chance(rng, 0.5) ? a.diet : b.diet;
  child.seed = Math.floor(rng() * 1e9);
  child.id = 'g' + Math.floor(rng() * 1e9).toString(36);
  return mutation > 0 ? mutateGenome(child, rng, mutation) : normalizeGenome(child);
}

export function geneticDistance(a, b) {
  let sum = 0;
  const keys = ['size', 'bodyLength', 'bodyWidth', 'bodyHeight', 'neckLength', 'headSize', 'snoutLength', 'legLength', 'legThickness', 'tailLength', 'wingSpan', 'hornSize', 'armor', 'clawSize', 'teethSize', 'speed', 'strength', 'intelligence', 'sociability', 'fearfulness'];
  for (const key of keys) {
    const [min, max] = GENE_RANGES[key];
    sum += Math.abs(a[key] - b[key]) / (max - min);
  }
  if (a.diet !== b.diet) sum += 1.5;
  return sum / keys.length;
}

export function deriveStats(g) {
  const size = g.size;
  const legFactor = g.legLength * (g.legCount / 4) * (1.15 - g.legThickness * 0.15);
  const maxHealth = 48 + size * 46 + g.armor * 28 + g.legThickness * 14;
  const maxStamina = 32 + g.agility * 34 + size * 8;
  const walk = (1.9 + g.speed * 3.6 + legFactor * 1.3 - size * 0.55) * (g.legCount === 2 ? 1.12 : 1);
  const sprint = walk * (1.55 + g.agility * 0.35);
  const swim = 1.5 + g.agility * 2.2 + g.tailLength * 0.8;
  const fly = g.wings ? 3.6 + g.wingSpan * 3.6 + g.agility * 1.5 - size * 0.6 : 0;
  const bite = 4 + g.teethSize * 12 + g.jawSize * 7 + g.strength * 8;
  const claw = 2 + g.clawSize * 10 + g.strength * 5;
  const armorRating = g.armor * 0.62 + size * 0.1;
  const senses = 11 + g.eyeSize * 7 + g.senseRange * 10 + g.intelligence * 4;
  const metabolismRate = 0.45 + g.metabolism * 1.3 + size * 0.22 - (g.diet === 'carnivore' ? 0.2 : 0);
  const fearBias = g.fearfulness * 1.25 - g.boldness * 0.55 + g.intelligence * 0.15;
  const jump = (3.2 + g.legLength * 3.2 + g.agility * 2.2) * (size > 1.8 ? 0.7 : 1);
  const bodyRadius = size * 0.92;
  const reach = 0.8 + g.snoutLength * 1.2 + size * 0.55;
  const adultAge = 1.2 + size * 1.4;
  const lifeSpan = 7 + g.lifespan * 30 + size * 4;
  const attackCooldown = clamp(1.35 - g.agility * 0.45, 0.6, 1.4);
  const fearDecay = 0.34 - g.intelligence * 0.12;
  const memory = 0.3 + g.intelligence * 0.7;
  return {
    maxHealth, maxStamina, walk, sprint, swim, fly, bite, claw, armorRating, senses,
    metabolismRate, fearBias, jump, bodyRadius, reach, adultAge, lifeSpan, attackCooldown,
    fearDecay, memory, size, vision: 24 + senses * 1.8,
    herdRadius: 7 + g.sociability * 14,
    fleeRadius: 16 + g.fearfulness * 28,
    huntRadius: 20 + senses * 1.8
  };
}

export function genomeColor(g, secondary = false) {
  const h = secondary ? g.hue2 : g.hue1;
  const l = secondary ? clamp(g.lightness * 0.8, 18, 62) : g.lightness;
  return `hsl(${h}, ${g.saturation}%, ${l}%)`;
}

export function genomeAccent(g) {
  return `hsl(${(g.hue2 + 180) % 360}, ${Math.min(95, g.saturation + 15)}%, 62%)`;
}

export function topTraits(g, n = 3) {
  const s = deriveStats(g);
  const traits = [
    { name: 'Devastating jaws', value: s.bite, icon: 'jaw' },
    { name: 'Rending claws', value: s.claw, icon: 'claw' },
    { name: 'Burst speed', value: s.sprint, icon: 'speed' },
    { name: 'Heavy armor', value: s.armorRating * 10, icon: 'armor' },
    { name: 'Keen senses', value: s.senses, icon: 'eye' },
    { name: 'Endurance', value: s.maxStamina, icon: 'stamina' },
    { name: 'Aerial mastery', value: s.fly * 8, icon: 'wing' },
    { name: 'Deep intellect', value: g.intelligence * 100, icon: 'mind' }
  ];
  traits.sort((a, b) => b.value - a.value);
  return traits.slice(0, n);
}

export function speciesDescription(g) {
  const s = deriveStats(g);
  const dietText = g.diet === 'carnivore' ? 'obligate carnivore' : g.diet === 'herbivore' ? 'specialised herbivore' : g.diet === 'scavenger' ? 'opportunistic scavenger' : 'adaptable omnivore';
  const limbs = g.legCount === 2 ? 'bipedal' : g.legCount === 6 ? 'hexapodal' : 'quadrupedal';
  const cover = TEXTURES[g.texture];
  const wings = g.wings ? ' It bears membranous wings and can take to the air.' : '';
  const tail = g.tailLength > 1.2 ? ' A long counterbalancing tail trails behind it.' : '';
  const armor = g.armor > 0.8 ? ' Bony armor plates shield its back.' : '';
  const social = g.sociability > 0.7 ? ' Highly social, moving in coordinated herds or packs.' : g.sociability < 0.3 ? ' Solitary and territorial.' : ' Loosely gregarious.';
  const fear = g.fearfulness > 0.7 ? ' It is easily startled.' : g.boldness > 0.7 ? ' It shows little fear of larger animals.' : '';
  return `A ${g.size > 1.7 ? 'massive' : g.size < 0.9 ? 'diminutive' : 'medium-sized'} ${limbs} ${dietText} with ${cover} skin. ${wings}${tail}${armor}${social}${fear} Bite force measured at ${s.bite.toFixed(0)} N, sprinting near ${(s.sprint * 2.4).toFixed(0)} km/h.`;
}

export function makeSpecies(rng, genome, opts = {}) {
  const g = normalizeGenome(genome);
  return {
    id: opts.id || 'sp_' + Math.floor(rng() * 1e9).toString(36),
    name: opts.name || makeSpeciesName(rng),
    common: opts.common || makeCommonName(rng, g.diet),
    genome: g,
    diet: g.diet,
    habitat: opts.habitat || pick(rng, ['forest', 'grassland', 'marsh', 'desert', 'mountain']),
    population: opts.population ?? Math.floor(randRange(rng, 26, 90)),
    generation: opts.generation || 1,
    originYear: opts.originYear || 0,
    ancestorId: opts.ancestorId || null,
    playerLineage: !!opts.playerLineage,
    extinct: false,
    discovered: !!opts.discovered,
    behavior: opts.behavior || 'wander',
    color: genomeColor(g),
    notes: opts.notes || ''
  };
}

export function buildStartingSpecies(rng) {
  const defs = [
    ['grazer', 'grassland'], ['strider', 'desert'], ['stalker', 'forest'], ['hopper', 'marsh'],
    ['scavenger', 'grassland'], ['glider', 'mountain'], ['titan', 'grassland'], ['lurker', 'marsh']
  ];
  return defs.map(([kind, habitat], i) => makeSpecies(rng, presetGenome(kind, rng), {
    habitat, population: [54, 42, 31, 38, 27, 22, 14, 17][i],
    name: ['Verdant Thalara', 'Dunestrider Vex', 'Crimson Korrath', 'Marsh Yssil', 'Bonecarrier Oth', 'Cloud Nyra', 'Old Titan Galum', 'Mire Lurker Uul'][i],
    common: ['Dawn Grazer', 'Dune Strider', 'Ember Stalker', 'Marsh Hopper', 'Bone Scavenger', 'Sky Glider', 'Titan Grazer', 'Mire Lurker'][i],
    behavior: ['herd', 'herd', 'pack', 'wander', 'scavenge', 'territory', 'herd', 'ambush'][i],
    discovered: i < 4
  }));
}

// Draw a side-profile silhouette from a genome. Used by codex, family tree and HUD portrait.
export function drawSilhouette(ctx, g, w, h, opts = {}) {
  const s = deriveStats(g);
  const scale = Math.min(w / 5.4, h / 3.6) * (opts.zoom || 1);
  const cx = w * 0.47, baseY = h * 0.7;
  const bl = g.bodyLength * scale * 1.15;
  const bh = g.bodyHeight * scale * 0.72;
  const bodyY = baseY - g.legLength * scale * 0.72 - bh * 0.5;
  const primary = opts.monochrome ? '#d8f5ea' : `hsl(${g.hue1}, ${g.saturation}%, ${Math.max(30, g.lightness)}%)`;
  const secondary = opts.monochrome ? '#7aa99a' : `hsl(${g.hue2}, ${g.saturation}%, ${Math.max(24, g.lightness * 0.72)}%)`;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // tail
  if (g.tailLength > 0.05) {
    ctx.strokeStyle = secondary;
    ctx.lineWidth = Math.max(2, g.tailLength * scale * 0.1);
    ctx.beginPath();
    ctx.moveTo(cx - bl * 0.85, bodyY + bh * 0.15);
    ctx.quadraticCurveTo(cx - bl * (1.1 + g.tailLength * 0.35), bodyY - bh * (0.2 + g.tailLength * 0.3), cx - bl * (1.25 + g.tailLength * 0.55), bodyY - bh * (0.5 + g.tailLength * 0.4));
    ctx.stroke();
  }
  // far legs
  ctx.strokeStyle = secondary;
  ctx.lineWidth = Math.max(2, g.legThickness * scale * 0.075);
  const legPairs = g.legCount / 2;
  for (let i = 0; i < legPairs; i++) {
    const lx = cx - bl * 0.52 + (bl * 1.04) * (i / Math.max(1, legPairs - 1 || 0.5));
    ctx.beginPath();
    ctx.moveTo(lx - 5, bodyY + bh * 0.3);
    ctx.lineTo(lx - 9, baseY);
    ctx.stroke();
  }
  // body
  ctx.fillStyle = primary;
  ctx.beginPath();
  ctx.ellipse(cx, bodyY, bl, bh, -0.03, 0, Math.PI * 2);
  ctx.fill();
  // dorsal pattern
  if (g.pattern === 1 || g.pattern === 4) {
    ctx.save();
    ctx.clip();
    ctx.fillStyle = secondary;
    for (let i = -2; i <= 2; i++) {
      if (g.pattern === 4) ctx.fillRect(cx + i * bl * 0.32, bodyY - bh * 1.1, bl * 0.12, bh * 0.55);
      else ctx.fillRect(cx + i * bl * 0.35, bodyY - bh, bl * 0.075, bh * 2);
    }
    ctx.restore();
  }
  if (g.pattern === 2) {
    ctx.save(); ctx.clip();
    ctx.fillStyle = secondary;
    for (let i = 0; i < 6; i++) {
      ctx.beginPath(); ctx.arc(cx + ((i * 37) % 60 - 30) * scale * 0.035, bodyY + ((i * 23) % 24 - 12) * scale * 0.03, scale * 0.045, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  // armor plates
  if (g.armor > 0.25) {
    ctx.fillStyle = secondary;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.ellipse(cx + (i - 1.5) * bl * 0.34, bodyY - bh * 0.72, bl * 0.13, bh * 0.28 * g.armor, -0.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // spikes
  if (g.spikeSize > 0.1) {
    ctx.fillStyle = secondary;
    const n = Math.round(3 + g.spikeSize * 4);
    for (let i = 0; i < n; i++) {
      const sx = cx + (i - (n - 1) / 2) * bl * 0.24;
      const sh = (0.18 + g.spikeSize * 0.3) * scale * (0.5 + (i % 2) * 0.3);
      ctx.beginPath(); ctx.moveTo(sx - bl * 0.06, bodyY - bh * 0.75); ctx.lineTo(sx, bodyY - bh * 0.75 - sh); ctx.lineTo(sx + bl * 0.06, bodyY - bh * 0.75); ctx.fill();
    }
  }
  // neck + head
  const neckX = cx + bl * 0.85;
  const headX = neckX + g.neckLength * scale * 0.48 + g.headSize * scale * 0.18;
  const headY = bodyY - bh * 0.6 - g.neckLength * scale * 0.5;
  ctx.strokeStyle = primary;
  ctx.lineWidth = Math.max(4, g.headSize * scale * 0.2);
  ctx.beginPath();
  ctx.moveTo(neckX, bodyY - bh * 0.15);
  ctx.quadraticCurveTo(neckX + g.neckLength * scale * 0.2, headY + bh * 0.2, headX, headY);
  ctx.stroke();
  const hw = g.headSize * scale * (0.34 + g.snoutLength * 0.2);
  const hh = g.headSize * scale * 0.26;
  ctx.fillStyle = primary;
  ctx.beginPath();
  ctx.ellipse(headX + hw * 0.45, headY, hw, hh, -0.05, 0, Math.PI * 2);
  ctx.fill();
  // jaw
  if (g.teethSize > 0.35) {
    ctx.strokeStyle = secondary;
    ctx.lineWidth = Math.max(2, hh * 0.18);
    ctx.beginPath(); ctx.moveTo(headX + hw * 0.15, headY + hh * 0.45); ctx.lineTo(headX + hw * 1.25, headY + hh * 0.28); ctx.stroke();
  }
  // horns
  if (g.hornSize > 0.08) {
    ctx.strokeStyle = secondary;
    ctx.lineWidth = Math.max(2, g.hornSize * scale * 0.1);
    ctx.beginPath();
    ctx.moveTo(headX + hw * 0.45, headY - hh * 0.5);
    ctx.quadraticCurveTo(headX + hw * 0.65, headY - hh * 1.1, headX + hw * 1.05, headY - hh * (1.15 + g.hornSize * 0.8));
    ctx.stroke();
  }
  // eye
  ctx.fillStyle = '#f5f8e8';
  ctx.beginPath(); ctx.arc(headX + hw * 0.7, headY - hh * 0.2, Math.max(1.6, g.eyeSize * scale * 0.055), 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#101612';
  ctx.beginPath(); ctx.arc(headX + hw * 0.73, headY - hh * 0.2, Math.max(0.8, g.eyeSize * scale * 0.027), 0, Math.PI * 2); ctx.fill();
  // near legs
  ctx.strokeStyle = primary;
  ctx.lineWidth = Math.max(2.5, g.legThickness * scale * 0.09);
  for (let i = 0; i < legPairs; i++) {
    const lx = cx - bl * 0.45 + (bl * 0.92) * (i / Math.max(1, legPairs - 1 || 0.5));
    ctx.beginPath();
    ctx.moveTo(lx, bodyY + bh * 0.25);
    ctx.lineTo(lx + 6, bodyY + bh * 0.45 + g.legLength * scale * 0.32);
    ctx.lineTo(lx + 12, baseY);
    ctx.stroke();
  }
  // wings
  if (g.wings) {
    ctx.fillStyle = primary;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(cx - bl * 0.25, bodyY - bh * 0.4);
    ctx.quadraticCurveTo(cx - bl * 0.4, bodyY - bh * 1.9 * g.wingSpan, cx + bl * 0.25, bodyY - bh * 1.7 * g.wingSpan);
    ctx.quadraticCurveTo(cx + bl * 0.42, bodyY - bh * 0.9, cx - bl * 0.05, bodyY - bh * 0.3);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  return s;
}
