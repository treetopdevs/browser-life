// Colours for the Mycelium page, in one place so the CPU painter, the WebGPU shader (WGSL_COLOUR below) and the
// legend all use the same hash, the same scales and the same ramp. Change a number here and the legend follows;
// the WGSL text is the mirror of the TypeScript functions and must be edited with them.
export type ColourMode = 'family' | 'energy' | 'age' | 'body';
export const MODES: ColourMode[] = ['family', 'energy', 'age', 'body'];
/** Bits of the layers word: three field layers and the particles. */
export const LAYER = { nutrient: 1, trail: 2, waste: 4, particles: 8 } as const;

export type RGB = [number, number, number];

/** Hue (degrees) and lightness (percent) of a family from its genotype id: a stable bright colour per family (hues can repeat between families, so the colour is a hint and the id is the identity). */
export function familyHash(gid: number): { hue: number; light: number } {
  let h = Math.imul(gid ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h >>>= 0;
  return { hue: h % 360, light: 62 + ((h >>> 9) % 14) };
}

function hsl(h: number, s: number, l: number): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) { r = c; g = x; } else if (hp < 2) { r = x; g = c; } else if (hp < 3) { g = c; b = x; } else if (hp < 4) { g = x; b = c; } else if (hp < 5) { r = x; b = c; } else { r = c; b = x; }
  const m = l - c / 2;
  return [r + m, g + m, b + m];
}

export function familyRGB(gid: number): RGB {
  const { hue, light } = familyHash(gid);
  return hsl(hue, 0.8, light / 100);
}

/** The ramp for energy, age and body size: indigo, teal, green, pale yellow (low to high). */
const STOPS: { t: number; c: RGB }[] = [
  { t: 0, c: [0.36, 0.30, 0.80] },
  { t: 0.35, c: [0.16, 0.60, 0.72] },
  { t: 0.7, c: [0.55, 0.86, 0.40] },
  { t: 1, c: [1.0, 0.93, 0.45] },
];

export function rampRGB(t: number): RGB {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  for (let i = 1; i < STOPS.length; i++) {
    if (x <= STOPS[i].t) {
      const a = STOPS[i - 1], b = STOPS[i];
      const f = (x - a.t) / (b.t - a.t);
      return [a.c[0] + (b.c[0] - a.c[0]) * f, a.c[1] + (b.c[1] - a.c[1]) * f, a.c[2] + (b.c[2] - a.c[2]) * f];
    }
  }
  return STOPS[STOPS.length - 1].c;
}

/** Age at which the age ramp tops out: log2(1 + age) / AGE_OCTAVES reaches 1 at 2^12 - 1 = 4,095 steps. */
export const AGE_OCTAVES = 12;

export interface Scales { energyMax: number; bodyMax: number }

/** Position on the ramp (0..1) for a value in a ramp mode. */
export function rampT(mode: Exclude<ColourMode, 'family'>, v: number, sc: Scales): number {
  if (mode === 'energy') return Math.min(1, Math.sqrt(v / sc.energyMax));
  if (mode === 'age') return Math.min(1, Math.log2(1 + v) / AGE_OCTAVES);
  return Math.min(1, v / sc.bodyMax);
}

/** The value at a ramp position: the inverse of rampT, for the legend's tick labels. */
export function rampValue(mode: Exclude<ColourMode, 'family'>, t: number, sc: Scales): number {
  if (mode === 'energy') return t * t * sc.energyMax;
  if (mode === 'age') return 2 ** (t * AGE_OCTAVES) - 1;
  return t * sc.bodyMax;
}

export function particleRGB(mode: ColourMode, gid: number, E: number, age: number, M: number, sc: Scales): RGB {
  if (mode === 'family') return familyRGB(gid);
  return rampRGB(rampT(mode, mode === 'energy' ? E : mode === 'age' ? age : M, sc));
}

export const css = (c: RGB): string => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;

/** Field colour: a dark base plus an additive tint per layer. Saturating counts keep every product inside u32. */
export const FIELD_BASE: RGB = [0.024, 0.071, 0.094];
export function fieldRGB(A: number, C: number, P: number, layers: number, out: RGB = [0, 0, 0]): RGB {
  let r = FIELD_BASE[0], g = FIELD_BASE[1], b = FIELD_BASE[2];
  if (layers & LAYER.nutrient) { const a = Math.min(A, 85) * 3 / 255; g += 0.55 * a; b += 0.2 * a; }
  if (layers & LAYER.trail) { const p = Math.min(P, 42) * 6 / 255; r += 0.75 * p; b += p; }
  if (layers & LAYER.waste) { const w = Math.min(C, 53) * 3 / 255; r += 0.85 * w; g += 0.45 * w; }
  out[0] = r > 1 ? 1 : r; out[1] = g > 1 ? 1 : g; out[2] = b > 1 ? 1 : b;
  return out;
}

/** The layer swatches the legend shows: the colour of a cell with a large amount of just that layer. */
export const LAYER_SWATCH: Record<'nutrient' | 'trail' | 'waste', RGB> = {
  nutrient: fieldRGB(85, 0, 0, LAYER.nutrient),
  trail: fieldRGB(0, 0, 42, LAYER.trail),
  waste: fieldRGB(0, 53, 0, LAYER.waste),
};

/** A float literal for WGSL. */
const f = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(+v.toFixed(6)));

/** WGSL mirror of familyHash/hsl/familyRGB/rampRGB/rampT/particle colour and the field tint. Uniform `u` supplies the scales. */
export const WGSL_COLOUR = /* wgsl */ `
const AGE_OCTAVES: f32 = ${f(AGE_OCTAVES)};
fn hsl(h: f32, s: f32, l: f32) -> vec3<f32> {
  let c = (1.0 - abs(2.0 * l - 1.0)) * s;
  let hp = h / 60.0;
  let x = c * (1.0 - abs((hp % 2.0) - 1.0));
  var rgb = vec3<f32>(0.0);
  if (hp < 1.0) { rgb = vec3<f32>(c, x, 0.0); }
  else if (hp < 2.0) { rgb = vec3<f32>(x, c, 0.0); }
  else if (hp < 3.0) { rgb = vec3<f32>(0.0, c, x); }
  else if (hp < 4.0) { rgb = vec3<f32>(0.0, x, c); }
  else if (hp < 5.0) { rgb = vec3<f32>(x, 0.0, c); }
  else { rgb = vec3<f32>(c, 0.0, x); }
  return rgb + vec3<f32>(l - c / 2.0);
}
fn family_rgb(gid: u32) -> vec3<f32> {
  var h = (gid ^ 0x9e3779b9u) * 0x85ebca6bu;
  h = h ^ (h >> 13u);
  return hsl(f32(h % 360u), 0.8, f32(62u + ((h >> 9u) % 14u)) / 100.0);
}
fn ramp_rgb(t: f32) -> vec3<f32> {
  let x = clamp(t, 0.0, 1.0);
  let c0 = vec3<f32>(${STOPS[0].c.join(', ')});
  let c1 = vec3<f32>(${STOPS[1].c.join(', ')});
  let c2 = vec3<f32>(${STOPS[2].c.join(', ')});
  let c3 = vec3<f32>(${STOPS[3].c.join(', ')});
  if (x <= ${f(STOPS[1].t)}) { return mix(c0, c1, x / ${f(STOPS[1].t)}); }
  if (x <= ${f(STOPS[2].t)}) { return mix(c1, c2, (x - ${f(STOPS[1].t)}) / ${f(STOPS[2].t - STOPS[1].t)}); }
  return mix(c2, c3, (x - ${f(STOPS[2].t)}) / ${f(STOPS[3].t - STOPS[2].t)});
}
fn field_rgb(a: u32, c: u32, p: u32, layers: u32) -> vec3<f32> {
  var col = vec3<f32>(${FIELD_BASE.join(', ')});
  if ((layers & 1u) != 0u) { let v = f32(min(a, 85u) * 3u) / 255.0; col += vec3<f32>(0.0, 0.55 * v, 0.2 * v); }
  if ((layers & 2u) != 0u) { let v = f32(min(p, 42u) * 6u) / 255.0; col += vec3<f32>(0.75 * v, 0.0, v); }
  if ((layers & 4u) != 0u) { let v = f32(min(c, 53u) * 3u) / 255.0; col += vec3<f32>(0.85 * v, 0.45 * v, 0.0); }
  return clamp(col, vec3<f32>(0.0), vec3<f32>(1.0));
}
`;
