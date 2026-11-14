// Stage 0 run 1 figures for the regime meters companion page (docs/3d-regime-meters-map.html).
//
// Two committed TSVs, drawn exactly as recorded (no smoothing, no interpolation, no fitted line):
//   experiments/3d-slab/regime-stage0-run1-damage.tsv   damaged blocks at steps 30, 100 and 1000 (S, F) and step 30 (U), 36 rows
//   experiments/3d-slab/m4-results.tsv                  rung 1b M4 calibration: living fraction at 50,000 steps, 180 seed runs
// Both are pilot / calibration numbers; candidate 8 closed at Stage 0 (STAGE0-CLOSED, 2026-10-24) and the rule was never frozen. Nothing
// here is a result, and nothing here changes pageLabel() or any refusal of regime-html.ts.
import { readFileSync } from "node:fs";
import { ReaderError } from "./regime-readout.ts";

export type Rung = "P1" | "P2";
export interface DamageRow {
  job: string; rung: Rung; living_fraction: number; liveblk_T: number;
  S_30: number; S_100: number; S_1000: number; F_30: number; F_100: number; F_1000: number; U_30: number;
}
export interface DamageFile { note: string; rows: DamageRow[] }
export interface CalRow {
  id: string; mu: number; sigma: number; lightK: number; seed: number; steps: number; extinctAt: number | null; living: number;
  livingFrac: number; lightRatio7to0: number; livingFracEvery5k: string; stepsPerSec: number; matterOk: string; energyResidual: number; device: string;
}

export const DAMAGE_COLUMNS = ["job", "rung", "living_fraction", "liveblk_T", "S_30", "S_100", "S_1000", "F_30", "F_100", "F_1000", "U_30"] as const;
export const CAL_COLUMNS = ["id", "mu", "sigma", "lightK", "seed", "steps", "extinctAt", "living", "livingFrac", "lightRatio7to0", "livingFracEvery5k", "stepsPerSec", "matterOk", "energyResidual", "device"] as const;

const lines = (text: string): string[] => text.split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l !== "");
function int(v: string, what: string, where: string): number {
  if (!/^-?\d+$/.test(v)) throw new ReaderError(`${where}: ${what} is not an integer: ${JSON.stringify(v)}`);
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new ReaderError(`${where}: ${what} is not a safe integer: ${JSON.stringify(v)}`);
  return n;
}
/** A count (damaged blocks, mu, sigma, lightK, seed, steps, living): a safe integer that is not negative. */
function count(v: string, what: string, where: string): number {
  const n = int(v, what, where);
  if (n < 0) throw new ReaderError(`${where}: ${what} cannot be negative: ${JSON.stringify(v)}`);
  return n;
}
function dec(v: string, what: string, where: string): number {
  if (!/^-?\d+(\.\d+)?$/.test(v)) throw new ReaderError(`${where}: ${what} is not a number: ${JSON.stringify(v)}`);
  const n = Number(v);
  if (!Number.isFinite(n)) throw new ReaderError(`${where}: ${what} is not finite: ${JSON.stringify(v)}`);
  return n;
}
/** A fraction in [0, 1]. */
function frac(v: string, what: string, where: string): number {
  const n = dec(v, what, where);
  if (n < 0 || n > 1) throw new ReaderError(`${where}: ${what} must lie in [0, 1]: ${JSON.stringify(v)}`);
  return n;
}

export function parseDamageTsv(text: string): DamageFile {
  const ls = lines(text);
  if (ls.length < 2 || !ls[0].startsWith("#")) throw new ReaderError("damage TSV: the first line must be the # provenance comment");
  if (ls[1] !== DAMAGE_COLUMNS.join("\t")) throw new ReaderError(`damage TSV: the column line must be exactly ${DAMAGE_COLUMNS.join(" ")}`);
  const rows: DamageRow[] = ls.slice(2).map((l, i) => {
    const f = l.split("\t");
    const where = `damage TSV row ${i + 1}`;
    if (f.length !== DAMAGE_COLUMNS.length) throw new ReaderError(`${where}: ${f.length} fields, expected ${DAMAGE_COLUMNS.length}`);
    if (f[1] !== "P1" && f[1] !== "P2") throw new ReaderError(`${where}: unknown rung ${JSON.stringify(f[1])}`);
    if (f[0] === "") throw new ReaderError(`${where}: empty job`);
    const n = (k: number) => count(f[k], DAMAGE_COLUMNS[k], where);
    return { job: f[0], rung: f[1] as Rung, living_fraction: frac(f[2], "living_fraction", where), liveblk_T: n(3), S_30: n(4), S_100: n(5), S_1000: n(6), F_30: n(7), F_100: n(8), F_1000: n(9), U_30: n(10) };
  });
  if (rows.length === 0) throw new ReaderError("damage TSV: no rows");
  return { note: ls[0].replace(/^#\s*/, ""), rows };
}

export function parseCalibrationTsv(text: string): CalRow[] {
  const ls = lines(text);
  if (ls.length < 2 || ls[0] !== CAL_COLUMNS.join("\t")) throw new ReaderError(`calibration TSV: the first line must be exactly ${CAL_COLUMNS.join(" ")}`);
  const rows = ls.slice(1).map((l, i) => {
    const f = l.split("\t");
    const where = `calibration TSV row ${i + 1}`;
    if (f.length !== CAL_COLUMNS.length) throw new ReaderError(`${where}: ${f.length} fields, expected ${CAL_COLUMNS.length}`);
    return {
      id: f[0], mu: count(f[1], "mu", where), sigma: count(f[2], "sigma", where), lightK: count(f[3], "lightK", where), seed: count(f[4], "seed", where),
      steps: count(f[5], "steps", where), extinctAt: f[6] === "" ? null : count(f[6], "extinctAt", where), living: count(f[7], "living", where),
      livingFrac: frac(f[8], "livingFrac", where), lightRatio7to0: dec(f[9], "lightRatio7to0", where), livingFracEvery5k: f[10],
      stepsPerSec: dec(f[11], "stepsPerSec", where), matterOk: f[12], energyResidual: int(f[13], "energyResidual", where), device: f[14],
    };
  });
  if (rows.length === 0) throw new ReaderError("calibration TSV: no rows");
  return rows;
}

export function readDamageTsv(path: string): DamageFile {
  try { return parseDamageTsv(readFileSync(path, "utf8")); } catch (e) { if (e instanceof ReaderError) throw e; throw new ReaderError(`cannot read ${path}: ${(e as Error).message}`); }
}
export function readCalibrationTsv(path: string): CalRow[] {
  try { return parseCalibrationTsv(readFileSync(path, "utf8")); } catch (e) { if (e instanceof ReaderError) throw e; throw new ReaderError(`cannot read ${path}: ${(e as Error).message}`); }
}

// ---------------------------------------------------------------------------------------------------------------------
// The M4 pick rule, as written in m4-pick.ts (same thresholds, not new logic).

export type CalClass = "extinct" | "under1" | "band" | "mid" | "carpet";
export const CAL_CLASS_LABEL: Record<CalClass, string> = {
  extinct: "extinct (no living cell)", under1: "under 1% living", band: "1 to 50% living (the pick rule's band)", mid: "50 to 85% living", carpet: "85% and over (carpet)",
};
export function calClass(r: CalRow): CalClass {
  if (r.extinctAt !== null) return "extinct";
  if (r.livingFrac < 0.01) return "under1";
  if (r.livingFrac <= 0.5) return "band";
  if (r.livingFrac < 0.85) return "mid";
  return "carpet";
}
export const inBand = (r: CalRow): boolean => r.livingFrac >= 0.01 && r.livingFrac <= 0.5;
export const lightOk = (r: CalRow): boolean => r.lightRatio7to0 >= 0.05 && r.lightRatio7to0 <= 0.8;

export interface CalSummary { runs: number; settings: number; completeSettings: number; qualifying: number; inBandRuns: number; inBandAndLightRuns: number; extinctRuns: number }
export function calibrationSummary(rows: readonly CalRow[]): CalSummary {
  const g = new Map<string, CalRow[]>();
  for (const r of rows) { const k = `${r.mu}/${r.sigma}/${r.lightK}`; g.set(k, [...(g.get(k) ?? []), r]); }
  const sets = [...g.values()];
  const complete = sets.filter((s) => s.length === 3);
  return {
    runs: rows.length, settings: sets.length, completeSettings: complete.length,
    qualifying: complete.filter((s) => s.every((r) => inBand(r) && lightOk(r))).length,
    inBandRuns: rows.filter(inBand).length, inBandAndLightRuns: rows.filter((r) => inBand(r) && lightOk(r)).length,
    extinctRuns: rows.filter((r) => r.extinctAt !== null).length,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Small helpers

const esc = (s: string | number): string => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const f1 = (n: number): string => (Math.round(n * 10) / 10).toString();
const group = (n: number): string => n.toLocaleString("en-US");

export const WORLDS: readonly { prefix: string; name: string }[] = [
  { prefix: "dev-2d-spots-m3", name: "2D spots-m3" },
  { prefix: "dev-2d-gradient-m3", name: "2D gradient-m3" },
  { prefix: "dev-slab-mu30-s8-k256", name: "slab mu30 / sigma8 / k256" },
  { prefix: "dev-slab-mu60-s8-k1024", name: "slab mu60 / sigma8 / k1024" },
];
const STEPS = [30, 100, 1000] as const;
type Series = "S" | "F" | "U";

// ---------------------------------------------------------------------------------------------------------------------
// Figure 1: damage spread, eight small panels

function damagePanel(world: { prefix: string; name: string }, rung: Rung, rows: DamageRow[], pid: string): string {
  const W = 300, H = 250, L = 46, R = 74, T = 14, B = 52;
  const pw = W - L - R, zeroY = H - B + 18, plotB = H - B - 4; // zero strip under the axis
  const maxV = Math.max(1000, ...rows.flatMap((r) => [r.S_30, r.S_100, r.S_1000, r.F_30, r.F_100, r.F_1000, r.U_30]));
  const decades = Math.ceil(Math.log10(maxV));
  const x = (s: number) => L + (Math.log(s / 30) / Math.log(1000 / 30)) * pw;
  const y = (v: number) => (v <= 0 ? zeroY : plotB - (Math.log10(v) / decades) * (plotB - T));
  const o: string[] = [];
  const nJobs = rows.length;
  o.push(`<svg class="dpanel" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="${pid}-t ${pid}-d" data-panel="${esc(world.prefix)}|${rung}">`);
  o.push(`<title id="${pid}-t">${esc(world.name)}, rung ${rung}: damaged blocks at 30, 100 and 1,000 steps after the kick</title>`);
  o.push(`<desc id="${pid}-d">${nJobs} jobs, development seeds 9001 to 9003, pilot numbers, not results. Series S, F and U; U was recorded at step 30 only. The numbers are in the table below the figure.</desc>`);
  // grid and ticks
  for (let d = 0; d <= decades; d++) {
    const yy = y(10 ** d);
    o.push(`<line class="grid" x1="${L}" x2="${L + pw}" y1="${f1(yy)}" y2="${f1(yy)}"/><text class="tick" x="${L - 5}" y="${f1(yy + 3.5)}" text-anchor="end">${group(10 ** d)}</text>`);
  }
  o.push(`<line class="grid zero" x1="${L}" x2="${L + pw}" y1="${zeroY}" y2="${zeroY}"/><text class="tick" x="${L - 5}" y="${zeroY + 3.5}" text-anchor="end">0</text>`);
  for (const s of STEPS) o.push(`<line class="grid v" x1="${f1(x(s))}" x2="${f1(x(s))}" y1="${T}" y2="${plotB}"/><text class="tick" x="${f1(x(s))}" y="${plotB + 13}" text-anchor="middle">${group(s)}</text>`);
  o.push(`<text class="axis" x="${L + pw / 2}" y="${H - 6}" text-anchor="middle">steps after the kick, log scale</text>`);
  o.push(`<text class="axis" transform="translate(11 ${(T + plotB) / 2}) rotate(-90)" text-anchor="middle">damaged blocks, log scale</text>`);
  o.push(`<text class="zl" x="${L + pw + 4}" y="${zeroY + 3.5}">zero strip</text>`);
  // lines: exactly the recorded vertices
  for (const key of ["S", "F"] as const) {
    for (const r of rows) {
      const v = STEPS.map((s) => r[`${key}_${s}` as keyof DamageRow] as number);
      o.push(`<polyline class="ln ${key}" points="${STEPS.map((s, i) => `${f1(x(s))},${f1(y(v[i]))}`).join(" ")}"/>`);
    }
  }
  // marks: one per recorded value
  const mark = (key: Series, cx: number, cy: number, step: number, v: number, job: string): string => {
    const t = `<title>${esc(job)} ${key} at step ${step}: ${v} damaged blocks</title>`;
    const at = `data-pt="${key}" data-step="${step}" data-v="${v}"`;
    if (key === "S") return `<circle class="pt S" ${at} cx="${f1(cx)}" cy="${f1(cy)}" r="2.6">${t}</circle>`;
    if (key === "F") return `<rect class="pt F" ${at} x="${f1(cx - 2.4)}" y="${f1(cy - 2.4)}" width="4.8" height="4.8">${t}</rect>`;
    return `<path class="pt U" ${at} d="M${f1(cx)} ${f1(cy - 3.6)}L${f1(cx + 3.6)} ${f1(cy)}L${f1(cx)} ${f1(cy + 3.6)}L${f1(cx - 3.6)} ${f1(cy)}Z">${t}</path>`;
  };
  for (const key of ["S", "F"] as const) for (const r of rows) for (const s of STEPS) { const v = r[`${key}_${s}` as keyof DamageRow] as number; o.push(mark(key, x(s), y(v), s, v, r.job)); }
  for (const r of rows) o.push(mark("U", x(30), y(r.U_30), 30, r.U_30, r.job));
  // direct labels at the series' mean end value (S, F at step 1000; U at step 30), nudged apart
  const mean = (a: number[]) => a.reduce((p, c) => p + c, 0) / a.length;
  const lab: { t: string; cls: string; yy: number; xx: number }[] = [
    { t: "S", cls: "S", yy: y(mean(rows.map((r) => r.S_1000))), xx: x(1000) + 8 },
    { t: "F", cls: "F", yy: y(mean(rows.map((r) => r.F_1000))), xx: x(1000) + 8 },
  ];
  if (Math.abs(lab[0].yy - lab[1].yy) < 11) { const up = lab[0].yy <= lab[1].yy; lab[0].yy += up ? -6 : 6; lab[1].yy += up ? 6 : -6; }
  for (const l of lab) o.push(`<text class="dl ${l.cls}" x="${f1(l.xx)}" y="${f1(l.yy + 3.5)}">${l.t}</text>`);
  const uy = Math.min(plotB - 2, y(mean(rows.map((r) => r.U_30))));
  o.push(`<text class="dl U" x="${f1(x(30) + 7)}" y="${f1(uy + 3.5)}">U (step 30 only)</text>`);
  o.push(`</svg>`);
  return o.join("");
}

export function damageFigureHtml(file: DamageFile): string {
  const panels: string[] = [];
  let n = 0;
  for (const w of WORLDS) for (const rung of ["P1", "P2"] as const) {
    const rows = file.rows.filter((r) => r.job.startsWith(`${w.prefix}-seed`) && r.rung === rung);
    if (rows.length === 0) throw new ReaderError(`damage TSV: no rows for ${w.prefix} ${rung}`);
    panels.push(`<figure class="pcell"><figcaption><strong>${esc(w.name)}</strong> · rung ${rung} · ${rows.length} jobs</figcaption>${damagePanel(w, rung, rows, `dp${n++}`)}</figure>`);
  }
  const covered = WORLDS.reduce((p, w) => p + file.rows.filter((r) => r.job.startsWith(`${w.prefix}-seed`)).length, 0);
  if (covered !== file.rows.length) throw new ReaderError(`damage TSV: ${file.rows.length - covered} rows belong to no known world`);
  const legend = `<ul class="slegend" aria-label="series"><li><svg viewBox="0 0 30 12" aria-hidden="true"><line class="ln S" x1="1" x2="29" y1="6" y2="6"/><circle class="pt S" cx="15" cy="6" r="2.6"/></svg><b>S</b> the twin whose kick is the rule's kick: solid line, one per job</li>`
    + `<li><svg viewBox="0 0 30 12" aria-hidden="true"><line class="ln F" x1="1" x2="29" y1="6" y2="6"/><rect class="pt F" x="12.6" y="3.6" width="4.8" height="4.8"/></svg><b>F</b> the frozen control pair (should stay ordered): dashed line, one per job</li>`
    + `<li><svg viewBox="0 0 30 12" aria-hidden="true"><path class="pt U" d="M15 2.4L18.6 6L15 9.6L11.4 6Z"/></svg><b>U</b> the unit-kick twin: a single marker at step 30, because no later step was recorded</li></ul>`;
  return `<div class="howto"><p><strong>How to read this.</strong> Each panel is one world and one rung. Horizontal axis: steps after the kick (30, 100, 1,000), log scale. Vertical axis: damaged blocks, the net decider counter <code>n_blk</code>, log scale; a value of 0 cannot sit on a log axis, so it is drawn on the strip marked 0 under the axis and still counts as a point. Lines join the three recorded steps of one job and nothing else: there is no fit and no value between the steps. Every mark is one number from the table below.</p></div>${legend}<div class="pgrid">${panels.join("")}</div>`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Figure 2: calibration heat grid

const MUS = [20, 30, 40, 50, 60], SIGMAS = [8, 12, 16, 20], KS = [256, 1024, 4096], SEEDS = [101, 102, 103];

/** Refuses unless the rows are exactly the 5 x 4 x 3 settings times seeds 101-103, each once: the figure draws that grid and nothing else. */
export function assertCalibrationGrid(rows: readonly CalRow[]): void {
  const want = MUS.length * SIGMAS.length * KS.length * SEEDS.length;
  const seen = new Set<string>();
  for (const r of rows) {
    if (!MUS.includes(r.mu) || !SIGMAS.includes(r.sigma) || !KS.includes(r.lightK) || !SEEDS.includes(r.seed))
      throw new ReaderError(`calibration TSV: row ${r.id} (mu ${r.mu}, sigma ${r.sigma}, lightK ${r.lightK}, seed ${r.seed}) is off the drawn grid; the outcome is not final`);
    const k = `${r.mu}/${r.sigma}/${r.lightK}/${r.seed}`;
    if (seen.has(k)) throw new ReaderError(`calibration TSV: duplicate seed run ${k}`);
    seen.add(k);
  }
  if (seen.size !== want) throw new ReaderError(`calibration TSV: ${seen.size} of ${want} seed runs; the grid is incomplete and no outcome is final`);
}

function calPanel(k: number, rows: readonly CalRow[], pid: string): string {
  const cw = 46, ch = 30, L = 40, T = 10, B = 40, sw = cw / 3 - 1;
  const W = L + MUS.length * cw + 8, H = T + SIGMAS.length * ch + B;
  const panelQ = SIGMAS.flatMap((sg) => MUS.map((mu) => rows.filter((q) => q.lightK === k && q.sigma === sg && q.mu === mu))).filter((g) => g.length === 3 && g.every((q) => inBand(q) && lightOk(q))).length;
  const o: string[] = [];
  o.push(`<svg class="cpanel" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="${pid}-t ${pid}-d" data-lightk="${k}">`);
  o.push(`<title id="${pid}-t">Living fraction at 50,000 steps, lightK ${k}, by mu and sigma, three seeds per cell</title>`);
  o.push(`<desc id="${pid}-d">Twenty cells, each split into the three seeds 101, 102, 103 (left to right). ${panelQ === 0 ? "No cell meets the pick rule" : `${panelQ} of 20 cells meet the pick rule`}. The numbers are in the table below the figure.</desc>`);
  SIGMAS.forEach((sg, ri) => {
    const yy = T + (SIGMAS.length - 1 - ri) * ch;
    o.push(`<text class="tick" x="${L - 5}" y="${yy + ch / 2 + 3.5}" text-anchor="end">${sg}</text>`);
    MUS.forEach((mu, ci) => {
      const xx = L + ci * cw;
      SEEDS.forEach((sd, si) => {
        const r = rows.find((q) => q.lightK === k && q.sigma === sg && q.mu === mu && q.seed === sd);
        if (!r) { o.push(`<rect class="cell none" x="${f1(xx + si * (cw / 3))}" y="${yy + 1}" width="${f1(sw)}" height="${ch - 2}"/>`); return; }
        const c = calClass(r);
        const sx = xx + si * (cw / 3) + 0.5;
        const tt = `<title>mu ${mu}, sigma ${sg}, lightK ${k}, seed ${sd}: ${r.extinctAt !== null ? `extinct at step ${r.extinctAt}` : `${(r.livingFrac * 100).toFixed(2)}% living`}, light ratio ${r.lightRatio7to0.toFixed(3)}, class: ${CAL_CLASS_LABEL[c]}</title>`;
        o.push(`<g data-seed-run="${esc(r.id)}" data-class="${c}"><rect class="cell ${c}" x="${f1(sx)}" y="${yy + 1}" width="${f1(sw)}" height="${ch - 2}">${tt}</rect>`
          + (c === "extinct" ? `<line class="xmark" x1="${f1(sx + 1.5)}" y1="${yy + 4}" x2="${f1(sx + sw - 1.5)}" y2="${yy + ch - 5}"/><line class="xmark" x1="${f1(sx + sw - 1.5)}" y1="${yy + 4}" x2="${f1(sx + 1.5)}" y2="${yy + ch - 5}"/>` : "")
          + (c === "band" ? `<rect class="bandbox" x="${f1(sx + 1)}" y="${yy + 2.5}" width="${f1(sw - 2)}" height="${ch - 5}"/>` : "")
          + `</g>`);
      });
    });
  });
  MUS.forEach((mu, ci) => o.push(`<text class="tick" x="${L + ci * cw + cw / 2}" y="${T + SIGMAS.length * ch + 13}" text-anchor="middle">${mu}</text>`));
  o.push(`<text class="axis" x="${L + (MUS.length * cw) / 2}" y="${H - 6}" text-anchor="middle">mu (each cell: seeds 101, 102, 103)</text>`);
  o.push(`<text class="axis" transform="translate(9 ${T + (SIGMAS.length * ch) / 2}) rotate(-90)" text-anchor="middle">sigma</text>`);
  o.push(`</svg>`);
  return o.join("");
}

export function calibrationFigureHtml(rows: readonly CalRow[]): string {
  assertCalibrationGrid(rows);
  const sum = calibrationSummary(rows);
  const panels = KS.map((k, i) => `<figure class="pcell"><figcaption><strong>lightK ${k}</strong></figcaption>${calPanel(k, rows, `cp${i}`)}</figure>`);
  const classes = (Object.keys(CAL_CLASS_LABEL) as CalClass[]).map((c) => {
    const n = rows.filter((r) => calClass(r) === c).length;
    return `<li><svg viewBox="0 0 22 16" aria-hidden="true"><rect class="cell ${c}" x="1" y="1" width="20" height="14"/>${c === "extinct" ? `<line class="xmark" x1="5" y1="4" x2="17" y2="12"/><line class="xmark" x1="17" y1="4" x2="5" y2="12"/>` : ""}${c === "band" ? `<rect class="bandbox" x="3" y="3" width="16" height="10"/>` : ""}</svg>${esc(CAL_CLASS_LABEL[c])}: ${n} seed runs</li>`;
  }).join("");
  const outcome = sum.qualifying === 0
    ? `<strong>none qualifies.</strong> 0 of ${sum.settings} settings qualify.`
    : `<strong>${sum.qualifying} of ${sum.settings} settings qualify</strong>, which differs from the committed <code>m4-pick-output.md</code> (<code>PICK: none qualifies</code>).`;
  return `<div class="howto"><p><strong>How to read this.</strong> One panel per light constant <code>lightK</code>. Each small rectangle of a panel is one setting (mu across, sigma up), split into its three seeds, 101, 102 and 103 from left to right. Colour is the share of cells living at step 50,000 (<code>livingFrac</code>), in five classes. A cross marks a seed that went extinct, and a box inside the stripe marks a seed inside the rule's living band (1 to 50%). Seeds are shown one by one, not averaged.</p></div>`
    + `<ul class="slegend cl" aria-label="classes">${classes}</ul><div class="pgrid c3">${panels.join("")}</div>`
    + `<p class="outcome" role="status"><b>Rung 1b M4 pick rule.</b> A setting qualifies only if all three seeds end with 1% to 50% of cells living <em>and</em> light(layer 7) / light(layer 0) between 5% and 80%. The colours show the first condition only; the light ratio is the <code>lightRatio7to0</code> column of the table. Outcome, recomputed here from the ${sum.runs} rows (the committed <code>m4-pick-output.md</code> says <code>PICK: none qualifies</code>): ${outcome} ${sum.inBandRuns} of ${sum.runs} seed runs are inside the living band, and ${sum.inBandAndLightRuns} of those also meet the light condition. ${sum.extinctRuns} seed runs went extinct.</p>`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Tables, section, CSS

function table(cols: readonly string[], rows: (string | number)[][], cap: string): string {
  return `<div class="tablewrap"><table class="s0t"><caption>${esc(cap)}</caption><thead><tr>${cols.map((c) => `<th scope="col">${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

export function damageTableHtml(file: DamageFile): string {
  return table(DAMAGE_COLUMNS, file.rows.map((r) => DAMAGE_COLUMNS.map((c) => r[c])), `All ${file.rows.length} rows of regime-stage0-run1-damage.tsv (damaged blocks; living_fraction and liveblk_T are per job, repeated on both rung rows)`);
}
export function calibrationTableHtml(rows: readonly CalRow[]): string {
  const cols = [...CAL_COLUMNS, "class", "in living band", "light ratio in 5-80%"];
  return table(cols, rows.map((r) => [...CAL_COLUMNS.map((c) => (c === "extinctAt" ? (r.extinctAt ?? "") : r[c])), calClass(r), inBand(r) ? "yes" : "no", lightOk(r) ? "yes" : "no"]), `All ${rows.length} rows of m4-results.tsv, plus the class and the two pick-rule conditions per seed run`);
}

export const STAGE0_BANNER = "Pilot numbers on development seeds 9001-9003, not results. Candidate 8 closed at Stage 0 (STAGE0-CLOSED, 2026-10-24); the rule was never frozen.";

function deviceText(rows: readonly CalRow[]): string {
  const n = new Map<string, number>();
  for (const r of rows) n.set(r.device, (n.get(r.device) ?? 0) + 1);
  const parts = [...n.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([d, c]) => `${esc(d)}, ${c} runs`);
  return parts.length === 1 ? `one machine (${parts[0]})` : `${parts.length} machines (${parts.join("; ")})`;
}

export function stage0SectionHtml(damageText: string, m4Text: string): string {
  const dmg = parseDamageTsv(damageText);
  const cal = parseCalibrationTsv(m4Text);
  return `<section id="stage0" class="stage0" aria-labelledby="stage0-h"><h2 id="stage0-h"><span class="idx">2b</span>Stage 0 run 1 (pilot, candidate closed)</h2>
<div class="banner stage0b" role="note"><p class="big">pilot numbers, not results</p><p>${esc(STAGE0_BANNER)} Nothing in this section is a finding about the slab's regime; it shows what the two committed data files contain, as recorded. Stage 0 run 1 read a rule draft with SHA-256 0bed3086bae784d7cc5ef27fad07285435894cb3ee657b4c874c4147182a3d24; <code>regime-rule-closed.md</code> is that draft plus development-log items 5 and 6, and was never frozen. This section is drawn from the files named below and is not part of the synthetic data used elsewhere on the page.</p></div>
<h3>Damage spread after the kick</h3>
<p class="sub">Source: <code>experiments/3d-slab/regime-stage0-run1-damage.tsv</code> (${dmg.rows.length} rows: ${dmg.rows.length / 2} jobs, two rungs). ${esc(dmg.note)}</p>
<p class="sub">What to look at: the frozen control F is meant to stay ordered, yet in rung P1 it still reaches hundreds of damaged blocks by step 1,000 in several panels. The Stage 0 readout (<code>regime-stage0-run1-readout.md</code>) flagged FROZEN-NOT-ORDERED for these jobs.</p>
${damageFigureHtml(dmg)}
<details class="tdetails"><summary>The ${dmg.rows.length} rows behind the damage figure, as a table</summary>${damageTableHtml(dmg)}</details>
<h3>Rung 1b calibration: living fraction at 50,000 steps</h3>
<p class="sub">Source: <code>experiments/3d-slab/m4-results.tsv</code> (${cal.length} seed runs: 60 settings, seeds 101-103, evolving arm of the slab-spots preset, calibration run on ${deviceText(cal)}). These are calibration seeds, not the development seeds of the damage figure above, and they are also not results.</p>
${calibrationFigureHtml(cal)}
<details class="tdetails"><summary>The ${cal.length} rows behind the calibration figure, as a table</summary>${calibrationTableHtml(cal)}</details>
</section>`;
}

export const STAGE0_CSS = String.raw`
.stage0 { --s-S: oklch(48% 0.16 255); --s-F: oklch(52% 0.17 45); --s-U: oklch(42% 0.15 320);
  --c-extinct: oklch(88% 0.008 80); --c-under1: oklch(84% 0.07 250); --c-band: oklch(78% 0.15 150); --c-mid: oklch(76% 0.13 80); --c-carpet: oklch(55% 0.13 40); --c-line: oklch(40% 0.02 80); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .stage0 { --s-S: oklch(76% 0.12 250); --s-F: oklch(78% 0.14 55); --s-U: oklch(76% 0.13 320);
  --c-extinct: oklch(30% 0.01 80); --c-under1: oklch(48% 0.09 250); --c-band: oklch(68% 0.16 150); --c-mid: oklch(70% 0.13 85); --c-carpet: oklch(62% 0.14 40); --c-line: oklch(88% 0.02 80); } }
:root[data-theme="dark"] .stage0 { --s-S: oklch(76% 0.12 250); --s-F: oklch(78% 0.14 55); --s-U: oklch(76% 0.13 320);
  --c-extinct: oklch(30% 0.01 80); --c-under1: oklch(48% 0.09 250); --c-band: oklch(68% 0.16 150); --c-mid: oklch(70% 0.13 85); --c-carpet: oklch(62% 0.14 40); --c-line: oklch(88% 0.02 80); }
.stage0 code, .stage0 p { overflow-wrap: anywhere; min-width: 0; }
.stage0 h3 { font-size: 17px; margin: 26px 0 4px; }
.stage0 .sub { max-width: 72ch; }
.stage0 .howto { max-width: 72ch; font-size: 14px; color: var(--muted); }
.stage0 .pgrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; margin: 12px 0; }
.stage0 .pcell { margin: 0; background: var(--surface); border: 1px solid var(--line-soft); border-radius: var(--radius); padding: 8px; }
.stage0 figcaption { font-size: 13px; margin-bottom: 4px; }
.stage0 svg { width: 100%; height: auto; display: block; overflow: hidden; font-family: var(--sans); }
.stage0 .tick { font-size: 9.5px; fill: var(--muted); }
.stage0 .axis { font-size: 10px; fill: var(--muted); }
.stage0 .zl { font-size: 8.5px; fill: var(--muted); }
.stage0 .grid { stroke: var(--line-soft); stroke-width: 1; }
.stage0 .grid.zero { stroke-dasharray: 2 3; stroke: var(--control-line); }
.stage0 .ln { fill: none; stroke-width: 1.1; opacity: .55; }
.stage0 .ln.S { stroke: var(--s-S); } .stage0 .ln.F { stroke: var(--s-F); stroke-dasharray: 4 3; }
.stage0 .pt.S { fill: var(--s-S); } .stage0 .pt.F { fill: var(--s-F); } .stage0 .pt.U { fill: var(--s-U); }
.stage0 .dl { font-size: 11px; font-weight: 700; paint-order: stroke; stroke: var(--surface); stroke-width: 3px; }
.stage0 .dl.S { fill: var(--s-S); } .stage0 .dl.F { fill: var(--s-F); } .stage0 .dl.U { fill: var(--s-U); font-size: 9.5px; }
.stage0 .slegend { list-style: none; padding: 0; margin: 10px 0; display: grid; gap: 6px; font-size: 13px; }
.stage0 .slegend li { display: flex; align-items: center; gap: 8px; }
.stage0 .slegend svg { width: 32px; flex: none; }
.stage0 .slegend.cl { grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); }
.stage0 .slegend.cl svg { width: 24px; }
.stage0 .cell.extinct { fill: var(--c-extinct); } .stage0 .cell.under1 { fill: var(--c-under1); } .stage0 .cell.band { fill: var(--c-band); }
.stage0 .cell.mid { fill: var(--c-mid); } .stage0 .cell.carpet { fill: var(--c-carpet); } .stage0 .cell.none { fill: none; stroke: var(--line); }
.stage0 .xmark { stroke: var(--c-line); stroke-width: 1.2; }
.stage0 .bandbox { fill: none; stroke: var(--c-line); stroke-width: 1.4; }
.stage0 .outcome { margin: 10px 0 0; padding: 10px 12px; border-left: 4px solid var(--sun-ink); background: var(--raised); border-radius: 0 var(--radius) var(--radius) 0; font-size: 14px; max-width: 80ch; }
.stage0 .tdetails { margin: 10px 0 0; }
.stage0 .tdetails summary { cursor: pointer; font-size: 14px; padding: 4px 0; }
.stage0 .tablewrap { overflow-x: auto; max-width: 100%; }
.stage0 table.s0t { font-size: 12px; font-family: var(--mono); }
.stage0 table.s0t caption { text-align: left; font-family: var(--sans); color: var(--muted); padding: 4px 0; }
.stage0 table.s0t th, .stage0 table.s0t td { padding: 2px 8px; border-bottom: 1px solid var(--line-soft); text-align: left; white-space: nowrap; }
`;
