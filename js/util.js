// Shared math, deterministic randomness and naming helpers.
export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const randRange = (rng, a, b) => a + rng() * (b - a);
export const randInt = (rng, a, b) => Math.floor(randRange(rng, a, b + 1));
export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];
export const chance = (rng, p) => rng() < p;

export function hash2(x, y, seed = 0) {
  let h = x * 374761393 + y * 668265263 + seed * 1442695040888963407;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export function valueNoise(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

export function fbm(x, y, seed = 0, octaves = 4) {
  let value = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    value += valueNoise(x * freq, y * freq, seed + i * 77) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return value / norm;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const NAME_A = ['Ae', 'Vor', 'Kry', 'Zel', 'Mor', 'Thal', 'Nyr', 'Sil', 'Dro', 'Umb', 'Quel', 'Rha', 'Oth', 'Yss', 'Fen', 'Gal', 'Lum', 'Pyr', 'Cyn', 'Xen'];
const NAME_B = ['ther', 'ath', 'ora', 'ith', 'ux', 'ael', 'ion', 'ara', 'os', 'ea', 'yn', 'ul', 'ash', 'emi', 'oth', 'iri', 'ox', 'yne'];
const NAME_C = ['', 'us', 'ix', 'a', 'um', 'is', 'or', 'en', 'ya', 'eth'];
export function makeSpeciesName(rng) {
  return pick(rng, NAME_A) + pick(rng, NAME_B) + pick(rng, NAME_C);
}

const TITLE_A = ['Dust', 'Moss', 'Ember', 'Tide', 'Thorn', 'Gloom', 'Sun', 'Frost', 'Bone', 'Mire', 'Storm', 'Reed', 'Amber', 'Ash', 'Coral', 'Ridge'];
const TITLE_B = ['grazer', 'stalker', 'runner', 'hopper', 'crawler', 'warden', 'drifter', 'hunter', 'weaver', 'borer', 'singer', 'render', 'maw', 'back', 'crest'];
export function makeCommonName(rng, diet) {
  const prefixes = diet === 'carnivore' ? ['Ember', 'Thorn', 'Gloom', 'Bone', 'Ash', 'Storm'] :
    diet === 'scavenger' ? ['Bone', 'Mire', 'Dust', 'Gloom', 'Ash'] :
    ['Moss', 'Sun', 'Reed', 'Amber', 'Ridge', 'Coral', 'Tide'];
  return pick(rng, prefixes) + pick(rng, TITLE_B);
}

const SYL = ['ka', 'zu', 'mi', 'ro', 'ta', 'ne', 'vi', 'lo', 'sha', 'thu', 'gre', 'po', 'xa', 'el', 'ur', 'dai', 'fen', 'ny', 'sol', 'bri'];
export function alienWord(rng, syllables = 3) {
  let out = '';
  for (let i = 0; i < syllables; i++) out += pick(rng, SYL);
  return out.charAt(0).toUpperCase() + out.slice(1);
}

export function fmt(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e4) return (n / 1e3).toFixed(1) + 'k';
  return Math.round(n).toString();
}

export function fmtYears(y) {
  if (y >= 1e9) return (y / 1e9).toFixed(2) + ' billion yrs';
  if (y >= 1e6) return (y / 1e6).toFixed(2) + ' million yrs';
  if (y >= 1e3) return (y / 1e3).toFixed(1) + 'k yrs';
  return Math.round(y) + ' yrs';
}

export function timeString(d) {
  const h = Math.floor(d * 24);
  const m = Math.floor((d * 24 - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function compass(heading) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const i = Math.round(((heading % TAU + TAU) % TAU) / TAU * 8) % 8;
  return dirs[i];
}

export function hueColor(h, s = 60, l = 50) { return `hsl(${h}, ${s}%, ${l}%)`; }

export function shortId(rng) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += chars[Math.floor(rng() * chars.length)];
  return s;
}

export function avg(arr) { return arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length); }

export function pointInCircle(x, z, cx, cz, r) { return (x - cx) ** 2 + (z - cz) ** 2 < r * r; }
