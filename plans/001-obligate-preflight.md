# Plan 001: Stop genomes losing their weights in JSON round-trips, and harden the obligate readout

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: several in-scope files are uncommitted work in
> the jj working copy, so compare content fingerprints instead of git history:
>
> ```bash
> shasum -a 256 packages/schema/src/genome.ts packages/search/src/evaluate.ts tools/bootstrap.ts tools/obligates-x.ts tools/lib/obligates-x.ts tools/test/obligates-x.test.ts | cut -c1-12
> ```
>
> Expected, in order: `77a1a3cc32bd`, `4aca59470e3f`, `6cf1c0cb0a2d`,
> `14272ca09678`, `a1fd80268dae`, `3e35c5478d9e`. For any file that differs,
> compare the "Current state" excerpts below against the live code; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1 (land before the obligate characterisation is read)
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: git `f08e1e6` plus the uncommitted jj working copy (change `smzqotqt`), 2026-09-30

## Why this matters

The project screened genomes for "obligate" dependence on a producer: a genome is obligate if it lives beside a producer ring but dies alone. The 16-replicate confirmation of that screen did not actually run beside a living producer. `tools/bootstrap.ts` read the evaluation config back from `archive.json`, where `JSON.stringify` had written the producer genome's `Int8Array` weights as a plain object (`{"0": -10, "1": -33, …}`). `encodeGenome` then encoded every controller weight as 0. So the 1,476 confirmations, and the 209 "obligates" defined on them, ran beside a ring with the producer's growth parameters but no controller (a dead ring). This was reproduced: founder 0 encodes to 40 non-zero weight words, and to 0 after a JSON round-trip.

This plan makes that failure impossible in future (the encoder reads weights by index and refuses bad values), fixes the bootstrap path, records a dated correction, and hardens `tools/obligates-x.ts`. That tool is the obligate characterisation now running on the Mac GPU, and its `bg0` medium (live founder 0) is the first real test against a living producer. Its read stage must not be able to produce a complete-looking result from mismatched or stray inputs.

## Current state

Files and roles:

- `packages/schema/src/genome.ts` — genome encode/decode. `encodeGenome` (lines 21–31) reads weights through `g.weights.buffer`, which a JSON-parsed object does not have:

  ```ts
  // packages/schema/src/genome.ts:21-31
  /** Pack into GENOME_CHANNELS words (lineage words left to the caller). */
  export function encodeGenome(g: Genome, linHi: number, linLo: number): Uint32Array {
    const out = new Uint32Array(GENOME_CHANNELS);
    out[G.LIN_HI] = linHi >>> 0;
    out[G.LIN_LO] = linLo >>> 0;
    out[G.PARAM0] = ((g.mu & 0xffff) | ((g.sigma & 0xffff) << 16)) >>> 0;
    out[G.PARAM1] = g.motGain & 0xff;
    const bytes = new Uint8Array(g.weights.buffer, g.weights.byteOffset, NN_BYTES);
    for (let b = 0; b < NN_BYTES; b++) out[G.W0 + (b >> 2)] |= bytes[b] << ((b & 3) * 8);
    return out;
  }
  ```

  `new Uint8Array(undefined, undefined, 160)` has length 0, so `bytes[b]` is `undefined` and every weight word becomes 0.

- `tools/bootstrap.ts` — M3 bootstrap search, confirmation and dependence re-screen. Two places reuse a JSON-parsed eval config without reviving the genome:

  ```ts
  // tools/bootstrap.ts:231-232
  const [s0, s1]: [number, number] = a["confirm-only"] ? searchSeedsOf(saved!) : [ec.seed, ec.seed + Math.max(done, batches) - 1];
  const evalRef = a["confirm-only"] ? saved!.eval : ec;
  ```

  ```ts
  // tools/bootstrap.ts:296-299
  if (reps > 0) {
    const allScreened: { cell: [number, number]; genome: EncGenome }[] = JSON.parse(await Deno.readTextFile(gatePath));
    const arch: SavedArchive = JSON.parse(await Deno.readTextFile(archivePath));
    const cec = { ...arch.eval, reps, seed: confirmSeed };
  ```

  The search phase is fine: its `ec` comes from `parseMedium` (line 87, `genomeFromHex(hex)`), which yields a real `Int8Array`.

- `packages/search/src/evaluate.ts` — the batched evaluator. `EvalConfig.medium.background` is a `Genome` (line 62). The comment at line 251 is wrong about mass:

  ```ts
  // packages/search/src/evaluate.ts:251
        // Background first as a larger disc; the candidate overwrites the centre → a producer ring.
  ```

  `buildWorld` (`packages/schema/src/world.ts:99-101`) does `s.cells[CH.B * n + i] += noise` and `s.cells[CH.E * n + i] += …`. It overwrites only the genome words, so the candidate disc keeps the ring's biomass and energy on top of its own.

- `packages/search/src/index.ts` re-exports `./evaluate.ts`, `./mapelites.ts` and `./retest.ts` (`export *`), so a new export in `evaluate.ts` is available as `@bl/search`.

- `tools/obligates-x.ts` — obligate characterisation (plan → run → read). **A run of it was started at 21:18 on 2026-09-30 and may still be running** (`deno run -A tools/obligates-x.ts --stage all`). Its producers are built correctly with `founderGenome(...)` (lines 40–45, 58–59). Weak points:

  ```ts
  // tools/obligates-x.ts:37-39 (unmatched dependence rows silently become non-obligate)
  const obligateByKey = new Map(dep.map((d) => [key(toG(d.genome)), d.obligate]));
  const confirmed: { genome: Enc; cluster: number }[] = confirm.rows.filter((r: { pass: boolean }) => r.pass);
  const pool = confirmed.map((r) => ({ genome: toG(r.genome), cluster: r.cluster, obligate: obligateByKey.get(key(toG(r.genome))) ?? false }));
  ```

  ```ts
  // tools/obligates-x.ts:98 (resume key ignores seed and subject ids)
    const done = new Set((await readLines()).map((l) => `${l.medium}:${l.batch}`));
  ```

  ```ts
  // tools/obligates-x.ts:113-116 (read stage trusts every line)
    const lines = await readLines();
    const cells: Cells = {};
    for (const l of lines)
      l.ids.forEach((id, k) => {
  ```

- `tools/lib/obligates-x.ts` — pure reading logic (`readOut`). Reading 5 computes `nullValid` (line 203) but still emits producer effects when it is false (lines 208–226). There is also no explicit "consumes" verdict. The fixed prose (`docs/plan.md`, "Obligate characterisation", reading 5) says: *"consumes" is read only as decomposer-type with a producer response that is not neutral; anything weaker is reported as unknown*, and *this contrast is valid only if the null candidate is not viable in either background.*

- `tools/test/obligates-x.test.ts` — vitest tests for the lib. Use its helpers (`g`, `cell`, `sub`, `mk`) as the pattern for new cases.

**Conventions.** TypeScript, 2-space indent, double quotes, long single-line expressions are normal in this repo. Pure logic goes in `tools/lib/*.ts` (no Deno APIs, so vitest can import it); CLIs in `tools/*.ts` use Deno APIs. Tests are vitest (`describe`/`it`/`expect`), placed in `packages/*/test/` or `tools/test/`. Never change simulation dynamics: `packages/sim-ref/test/golden-hashes.test.ts` must stay green with no pin changes.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0, no output |
| All unit tests | `pnpm test` | all pass (695 before this plan; more after), ~2–3 min |
| One test file | `pnpm vitest run <path>` | all pass |
| Golden pins | `pnpm vitest run packages/sim-ref/test/golden-hashes.test.ts` | all pass |
| GPU vs CPU golden | `deno run -A tests/deno/gpu_golden.ts` | every case prints PASS (needs the Mac GPU; it may run slowly while other GPU jobs run) |
| Is the obligate run alive? | `ps aux \| grep "obligates-x" \| grep -v grep` | a line means it is still running |
| Obligate batches written | `wc -l runs/obligates-x/batches.jsonl` | 60 when complete (5 media × 12 batches) |

## Scope

**In scope** (the only files you should modify or create):
- `packages/schema/src/genome.ts`
- `packages/schema/test/genome.test.ts` (create)
- `packages/search/src/evaluate.ts` (new `reviveEvalConfig` export; the line-251 comment)
- `packages/search/test/medium.test.ts` (add tests)
- `tools/bootstrap.ts` (two call sites)
- `tools/obligates-x.ts`
- `tools/lib/obligates-x.ts`
- `tools/test/obligates-x.test.ts`
- `docs/plan.md` (append one dated paragraph, exact text given in step 8)

**Out of scope** (do NOT touch):
- Subject choice, media, seeds or thresholds in `tools/obligates-x.ts` / `tools/lib/obligates-x.ts` (`pickSubjects`, `farthest`, `interleave`, `MEDIA`, `seedOf`, `VIABLE`/`DEAD`/…). A run using them is in progress, and the prose fixed them before any result. Note: `pickSubjects`'s "farthest" extra breaks distance ties toward the highest pool index, while the plan's other tie-breaks go to the lowest. Do **not** change it now; it is listed in the maintenance notes.
- `experiments/foundations/fa-background.json`, `experiments/foundations/fa-waste.json`, `docs/founder-program-summary-2026-09-30.html` — historical records; the correction goes in `docs/plan.md` only.
- `runs/` contents — never edit or delete run outputs. Do not start, stop or restart the obligate GPU run.
- `packages/sim-ref/**`, `packages/sim-gpu/**`, golden pins.

## Git workflow

- The repo is jj-colocated with git, and other Claude sessions may share this working copy. **Do not commit, create bookmarks, or push.** Leave your changes in the working copy; the operator reviews and commits.
- At the end, list every file you changed (`jj diff --stat` or `git status --short` limited to the in-scope paths).

## Steps

### Step 1: Pin today's encoding with a characterization test, plus failing round-trip tests

Create `packages/schema/test/genome.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { G, GENOME_CHANNELS, NN_BYTES, encodeGenome, founderGenome, M3_FOUNDERS, type Genome } from "@bl/schema";

/** The encoder as it was before this change, kept to prove the new one is byte-identical on valid input. */
function encodeGenomeRef(g: Genome, linHi: number, linLo: number): Uint32Array {
  const out = new Uint32Array(GENOME_CHANNELS);
  out[G.LIN_HI] = linHi >>> 0;
  out[G.LIN_LO] = linLo >>> 0;
  out[G.PARAM0] = ((g.mu & 0xffff) | ((g.sigma & 0xffff) << 16)) >>> 0;
  out[G.PARAM1] = g.motGain & 0xff;
  const bytes = new Uint8Array(g.weights.buffer, g.weights.byteOffset, NN_BYTES);
  for (let b = 0; b < NN_BYTES; b++) out[G.W0 + (b >> 2)] |= bytes[b] << ((b & 3) * 8);
  return out;
}

/** Deterministic pseudo-random genomes covering the full int8 range. */
function genomes(n: number): Genome[] {
  let s = 12345;
  const next = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) >>> 8) & 0xff;
  return Array.from({ length: n }, (_, k) => ({ mu: 16 + k, sigma: 2 + k, motGain: k % 256, weights: Int8Array.from({ length: NN_BYTES }, () => (next() << 24) >> 24) }));
}

describe("encodeGenome", () => {
  it("is byte-identical to the previous encoder on valid Int8Array genomes", () => {
    for (const g of [...genomes(50), ...M3_FOUNDERS.map(founderGenome)]) expect(Array.from(encodeGenome(g, 3, 7))).toEqual(Array.from(encodeGenomeRef(g, 3, 7)));
  });
  it("encodes a genome that went through JSON (weights become {\"0\": …}) like the original", () => {
    const g = founderGenome(M3_FOUNDERS[0]);
    const rt = JSON.parse(JSON.stringify(g));
    expect(Array.from(encodeGenome(rt, 0, 0))).toEqual(Array.from(encodeGenome(g, 0, 0)));
  });
  it("encodes plain-array weights like the original", () => {
    const g = founderGenome(M3_FOUNDERS[0]);
    expect(Array.from(encodeGenome({ ...g, weights: Array.from(g.weights) as unknown as Int8Array }, 0, 0))).toEqual(Array.from(encodeGenome(g, 0, 0)));
  });
  it("refuses missing or out-of-range weights instead of encoding zeros", () => {
    const g = founderGenome(M3_FOUNDERS[0]);
    const missing = JSON.parse(JSON.stringify(g));
    delete missing.weights["5"];
    expect(() => encodeGenome(missing, 0, 0)).toThrow(/weight 5/);
    const big = { ...g, weights: Array.from(g.weights, (v, i) => (i === 7 ? 200 : v)) as unknown as Int8Array };
    expect(() => encodeGenome(big, 0, 0)).toThrow(/weight 7/);
  });
});
```

If `G`, `GENOME_CHANNELS`, `NN_BYTES`, `founderGenome` or `M3_FOUNDERS` is not exported from `@bl/schema`, check with `grep -n "export" packages/schema/src/index.ts` and import from the right module path. Do not change exports to make the test compile.

**Verify**: `pnpm vitest run packages/schema/test/genome.test.ts` → the byte-identity test **passes**, and the other three tests **fail** (the JSON one returns zeros; the missing/out-of-range one does not throw). If the byte-identity test fails, STOP.

### Step 2: Make `encodeGenome` read weights by index and validate them

Replace the two weight lines in `encodeGenome` (`packages/schema/src/genome.ts:28-29`) with:

```ts
  // Index access works for an Int8Array, a plain array, and the {"0": …} object JSON.stringify
  // makes of an Int8Array; anything missing or outside int8 is refused rather than encoded as 0.
  const w = g.weights as unknown as ArrayLike<number>;
  for (let b = 0; b < NN_BYTES; b++) {
    const v = w[b];
    if (!Number.isInteger(v) || v < -128 || v > 127) throw new Error(`encodeGenome: weight ${b} is ${v}; expected an int8 (did a genome lose its Int8Array in a JSON round-trip?)`);
    out[G.W0 + (b >> 2)] |= (v & 0xff) << ((b & 3) * 8);
  }
```

Leave the rest of the function as it is.

**Verify**:
- `pnpm vitest run packages/schema/test/genome.test.ts` → 4 passed.
- `pnpm vitest run packages/sim-ref/test/golden-hashes.test.ts` → all pass (no pin changes).
- `pnpm typecheck` → exit 0.

### Step 3: Add `reviveEvalConfig` to the evaluator module

In `packages/search/src/evaluate.ts`, add `NN_BYTES` to the existing `@bl/schema` import list, and add this export right after `DEFAULT_EVAL` (after line 78):

```ts
/**
 * An EvalConfig read back from JSON (archive.json, confirm.json). JSON.stringify writes an
 * Int8Array as {"0": …}, so a background genome's weights are rebuilt as an Int8Array here;
 * a missing or out-of-range weight throws. Configs without a background are returned as is.
 */
export function reviveEvalConfig(raw: EvalConfig): EvalConfig {
  const bg = raw.medium?.background;
  if (!bg) return raw;
  const w = bg.weights as unknown as ArrayLike<number>;
  const weights = Int8Array.from({ length: NN_BYTES }, (_, i) => {
    const v = w[i];
    if (!Number.isInteger(v) || v < -128 || v > 127) throw new Error(`reviveEvalConfig: background weight ${i} is ${v}`);
    return v;
  });
  return { ...raw, medium: { ...raw.medium, background: { mu: bg.mu, sigma: bg.sigma, motGain: bg.motGain, weights } } };
}
```

Add tests to `packages/search/test/medium.test.ts` (add `reviveEvalConfig` and `type EvalConfig` to its `@bl/search` import, and `founderGenome, M3_FOUNDERS` to its `@bl/schema` import):

```ts
describe("reviveEvalConfig", () => {
  it("rebuilds a background genome that went through JSON as an Int8Array with the same values", () => {
    const g = founderGenome(M3_FOUNDERS[0]);
    const ec: EvalConfig = { ...DEFAULT_EVAL, medium: { background: g }, darkSteps: 4000 };
    const back = reviveEvalConfig(JSON.parse(JSON.stringify(ec)));
    expect(back.medium!.background!.weights).toBeInstanceOf(Int8Array);
    expect(Array.from(back.medium!.background!.weights)).toEqual(Array.from(g.weights));
    expect(JSON.stringify(back)).toBe(JSON.stringify(ec));
  });
  it("returns a config without a background unchanged", () => {
    const ec = JSON.parse(JSON.stringify({ ...DEFAULT_EVAL, nutrient: 8, medium: { waste: 24 } }));
    expect(reviveEvalConfig(ec)).toEqual(ec);
  });
  it("throws on a missing weight", () => {
    const ec = JSON.parse(JSON.stringify({ ...DEFAULT_EVAL, medium: { background: founderGenome(M3_FOUNDERS[0]) } }));
    delete ec.medium.background.weights["3"];
    expect(() => reviveEvalConfig(ec)).toThrow(/weight 3/);
  });
});
```

**Verify**: `pnpm vitest run packages/search/test/medium.test.ts` → all pass, including 3 new tests. `pnpm typecheck` → exit 0.

### Step 4: Use it in `tools/bootstrap.ts`

1. Add `reviveEvalConfig` to the `@bl/search` import list (lines 40–58).
2. Line 232: `const evalRef = a["confirm-only"] ? reviveEvalConfig(saved!.eval) : ec;`
3. Line 299: `const cec = { ...reviveEvalConfig(arch.eval), reps, seed: confirmSeed };`

Do not change anything else. The resume checks that compare `JSON.stringify(...)` still match, because a revived `Int8Array` stringifies to the same `{"0": …}` text as the stored object.

**Verify**: `pnpm typecheck` → exit 0. `grep -n "reviveEvalConfig" tools/bootstrap.ts` → 3 lines (import, line ~232, line ~299). Do **not** run `tools/bootstrap.ts` (it needs the GPU and spends seeds).

### Step 5: Correct the comment in `evaluate.ts`

Replace the comment at `packages/search/src/evaluate.ts:251` with:

```ts
      // Background first as a larger disc. The candidate disc then overwrites the genome words at the
      // centre but ADDS its biomass and energy to the background's (buildWorld uses +=), so in a
      // background medium a candidate starts with roughly twice its own seeded mass.
```

**Verify**: `pnpm typecheck` → exit 0.

### Step 6: Harden `tools/obligates-x.ts` (no change to subjects, media or seeds)

Make these edits only:

1. **Unmatched dependence rows throw.** Replace the `pool` line (39) with a version that throws when a confirmed genome has no dependence row, then assert the obligate count:

   ```ts
   const pool = confirmed.map((r) => {
     const ob = obligateByKey.get(key(toG(r.genome)));
     if (ob === undefined) throw new Error("a confirmed genome has no dependence row in confirm.json");
     return { genome: toG(r.genome), cluster: r.cluster, obligate: ob };
   });
   if (pool.filter((p) => p.obligate).length !== confirm.dependence.obligate) throw new Error(`pool holds ${pool.filter((p) => p.obligate).length} obligates, confirm.json records ${confirm.dependence.obligate}`);
   ```

2. **The plan on disk must equal the recomputed plan.** After the `plan` object is built (after line 77) and the work directory exists (after line 78), add:

   ```ts
   const planPath = `${a.work}/plan.json`;
   const planOnDisk = await Deno.readTextFile(planPath).catch(() => undefined);
   if (planOnDisk !== undefined && a.stage !== "plan" && planOnDisk !== json(plan)) throw new Error(`${planPath} differs from the plan recomputed from ${a.dir}/confirm.json; refusing to run or read against a different subject list`);
   ```

   Then change the plan-stage write (line 91) to use `planPath`.

3. **Every batches.jsonl line must match the plan.** Add a checker after `readLines`:

   ```ts
   /** Throws unless each line's seed, subject ids and replicate counts are the ones this plan assigns, and no batch repeats. */
   function checkLines(ls: Awaited<ReturnType<typeof readLines>>) {
     const seen = new Set<string>();
     for (const l of ls) {
       const k = `${l.medium}:${l.batch}`;
       if (seen.has(k)) throw new Error(`batches.jsonl repeats ${k}`);
       seen.add(k);
       if (!MEDIA.includes(l.medium)) throw new Error(`batches.jsonl has unknown medium ${l.medium}`);
       if (l.seed !== seedOf(l.medium, l.batch)) throw new Error(`batches.jsonl ${k}: seed ${l.seed}, plan says ${seedOf(l.medium, l.batch)}`);
       if (JSON.stringify(l.ids) !== JSON.stringify(batches[l.batch]?.map((s) => s.id))) throw new Error(`batches.jsonl ${k}: subject ids differ from the plan`);
       if (l.evals.some((e) => e.reps !== reps)) throw new Error(`batches.jsonl ${k}: an evaluation has reps other than ${reps}`);
     }
   }
   ```

   In the run stage, call `checkLines` on the lines before building `done`, and keep `done` keyed by `${medium}:${batch}` (the check guarantees seed and ids match). In the read stage, call `checkLines(lines)` right after `const lines = await readLines();`.

4. **Dead-ring confirmation as a read-out.** In the read stage, after `cells` is built, add a descriptive map from the 16-replicate confirmation, which ran beside a zero-weight ring (see Why):

   ```ts
   const confirmByKey = new Map(confirm.rows.map((r: { genome: Enc; eval: Evaluation }) => [key(toG(r.genome)), r.eval]));
   const deadRingConfirmation = Object.fromEntries(subjects.map((s) => {
     const e = confirmByKey.get(key(s.genome)) as Evaluation | undefined;
     return [s.id, e ? { survived: e.survived, regenerated: e.regenerated, lightDependent: e.lightDependent, reps: e.reps } : null];
   }));
   ```

   Add `deadRingConfirmation` and this note to the `out` object: `deadRingNote: "The background-medium confirmation (confirm.json) ran beside a ring with founder 0's mu/sigma/motGain and all controller weights zero (JSON round-trip bug fixed later); these counts are that dead-ring condition, not a live producer."`

**Verify**: `pnpm typecheck` → exit 0. Then, **only if no obligate run is alive** (`ps aux | grep obligates-x | grep -v grep` prints nothing), run `deno run -A tools/obligates-x.ts --stage read --out /tmp/fo-check.json` and expect `read: <N> batches, complete=<true|false>, wrote /tmp/fo-check.json` with no thrown error. If a run is alive, skip this run and say so in your report.

### Step 7: Gate reading 5 on the null control and add the "consumes" verdict

In `tools/lib/obligates-x.ts`, inside `readOut`, section 5:

1. Change `effect` so an invalid null control is reported as such:

   ```ts
   const effect = (r: number) => (!nullValid ? "invalid (null control viable)" : Number.isNaN(r) ? "n/a" : r <= PRODUCER_DOWN ? "draws-down" : r >= PRODUCER_UP ? "benefits" : "neutral");
   ```

2. In each `consumption` entry, after `producerEffect`, add the fixed rule's verdict:

   ```ts
         consumes: nullValid && (roleIn(s, "bg0") === "decomposer" || sh.decomp >= DECOMP_SHARE) && ["draws-down", "benefits"].includes(effect(ratio(s, "bg0"))) ? "yes" : "unknown",
   ```

3. Add `consumes: count(consumption, (x) => x.consumes)` to `consumptionSummary`.

4. In section 3 (`dependence`), add a descriptive count of subjects that the confirmed-obligate rule cannot see because they live in the second producer's background only. Add this to the returned object, next to `dependenceCounts`:

   ```ts
   bg2OnlyUnconfirmed: obl.filter((s) => st(s, "standard") === "dead" && st(s, "bg0") !== "viable" && st(s, "bg2") === "viable").map((s) => s.cluster),
   ```

Add tests to `tools/test/obligates-x.test.ts`, inside `describe("readOut", …)`. Reuse the existing `subjects`/`cells` construction from the test at lines 76–107; copy it into a helper or into the new test:

- **null control viable** → every `consumption[i].producerEffect` equals `"invalid (null control viable)"`, every `consumes` equals `"unknown"`, and `consumptionSummary.nullControlValid` is `false`. Build it by replacing `cells.null.bg0` with `cell(16, { otherMass: 100 })`.
- **consumes yes** → with the existing cells (null dead, o1 decomposer with `otherMass` 50 against null 100, ratio 0.5), `consumption[0].consumes === "yes"` and `consumptionSummary.consumes.yes >= 1`.
- **bg2-only** → a subject `o3` (group obligate, cluster 9) with standard 0, bg0 2, bg2 16 appears in `bg2OnlyUnconfirmed` as `[9]`.

**Verify**: `pnpm vitest run tools/test/obligates-x.test.ts` → all pass (existing + 3 new). `pnpm typecheck` → exit 0.

### Step 8: Record the correction in `docs/plan.md`

Append this paragraph at the very end of `docs/plan.md`. Put it after a blank line, and replace `YYYY-MM-DD` with today's date:

```markdown
**Correction: the background-medium confirmation ran beside a dead ring (YYYY-MM-DD).** The 16-replicate confirmation and the obligate definition in "A, background medium result" did not run against a living producer. `tools/bootstrap.ts` rebuilt the confirmation's evaluation config from `archive.json`, where `JSON.stringify` had written the background genome's `Int8Array` weights as a plain object; `encodeGenome` then encoded every controller weight as 0. The ring therefore had founder 0's μ, σ and motility gain but no controller. The 4-replicate search screen did use the real producer. `buildWorld` also adds the ring's seeded biomass and energy to the candidate disc, so candidates started with roughly twice their own seeded mass. The 209 "obligate" genomes are therefore genomes that die alone under `DEFAULT_EVAL` but survive beside a zero-weight ring with extra starting matter; the confirmation is in effect a dead-ring control. The obligate characterisation above ran its own evaluations against live producers (`bg0`, `bg2`) and at 4× biomass (`x4`), so its readings are not affected by this bug; its output now also carries each subject's dead-ring confirmation counts beside them. `backgroundGenomeIsFounder0: true` in `experiments/foundations/fa-background.json` describes the recorded config, not what the GPU ran. Fixed in code: `encodeGenome` reads weights by index and refuses missing or out-of-range values, and `tools/bootstrap.ts` revives the stored config (`reviveEvalConfig`). Nothing else in this section is re-read.
```

**Verify**: `tail -3 docs/plan.md` shows the paragraph. `git diff --stat docs/plan.md` shows only additions.

### Step 9: Full verification

**Verify**:
- `pnpm typecheck` → exit 0.
- `pnpm test` → all pass, with at least 705 tests (695 + 4 + 3 + 3).
- `pnpm vitest run packages/sim-ref/test/golden-hashes.test.ts` → all pass.
- `deno run -A tests/deno/gpu_golden.ts` → all PASS. If the GPU is busy it is slower; if it cannot get a device at all, say so in your report instead of retrying in a loop.

### Step 10: Re-read the obligate run if it has finished

Run `ps aux | grep obligates-x | grep -v grep` and `wc -l runs/obligates-x/batches.jsonl`.
- If no process is alive **and** the file has 60 lines: run `deno run -A tools/obligates-x.ts --stage read`. Expect `read: 60 batches, complete=true, wrote experiments/foundations/fo.json`. Report `reading.replication`, `reading.dominantCluster.verdict`, `reading.consumptionSummary`, and how many obligate representatives have `deadRingConfirmation.survived === 16`.
- Otherwise: do not read and do not touch the run. Report the line count and that the read is pending.

## Test plan

- `packages/schema/test/genome.test.ts` (new, 4 tests): byte-identity against the previous encoder on 50 random genomes plus the 12 founders; JSON round-trip; plain-array weights; refusal of missing and out-of-range weights. Structural pattern: `packages/schema/test/genetics.test.ts`.
- `packages/search/test/medium.test.ts` (+3): revive after JSON, no-background passthrough, missing-weight throw. Pattern: the existing `describe("qualityMaintenance")` block.
- `tools/test/obligates-x.test.ts` (+3): invalid null control, consumes yes, bg2-only list. Pattern: the existing `describe("readOut")` test.
- Verification: `pnpm test` → all pass, at least 705 tests.

## Done criteria

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0, with at least 705 tests passing
- [ ] `pnpm vitest run packages/sim-ref/test/golden-hashes.test.ts` passes, and `git diff --stat packages/sim-ref` is empty
- [ ] `grep -n "g.weights.buffer" packages/schema/src/genome.ts` returns no matches
- [ ] `grep -c "reviveEvalConfig" tools/bootstrap.ts` prints 3
- [ ] `grep -n "invalid (null control viable)" tools/lib/obligates-x.ts` returns a match
- [ ] `tail -1 docs/plan.md` starts with `**Correction: the background-medium confirmation ran beside a dead ring`
- [ ] No files outside the in-scope list are modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The drift check shows a changed file whose "Current state" excerpt no longer matches.
- The byte-identity test fails in step 1 or step 2, or `golden-hashes.test.ts` fails at any point: the encoding would change simulation state.
- `deno run -A tests/deno/gpu_golden.ts` reports any FAIL.
- In step 6, the plan-on-disk check throws against the **existing** `runs/obligates-x/plan.json`. That means the subjects of the in-progress run differ from what the current code computes; report it and do not delete or rewrite `plan.json`.
- `checkLines` throws on the existing `runs/obligates-x/batches.jsonl`: report the message. Never edit `batches.jsonl`.
- Any existing test in `tools/test/obligates-x.test.ts` fails after step 7.
- A fix appears to need changes to subject choice, media, seeds or thresholds.

## Maintenance notes

- `encodeGenome` now accepts anything indexable, which covers arrays and JSON objects. Any other code that rebuilds a `Genome` from JSON with `Int8Array.from(obj)` still breaks silently on the `{"0": …}` form: `Int8Array.from` of a plain object with no `length` yields an empty array. `tools/bootstrap.ts`'s `dec` is safe only because rows are stored with `Array.from`. Prefer `genomeHex`/`genomeFromHex` for storing genomes in new JSON.
- The 1,476 background confirmations are not re-run here (about 5 GPU-hours). If the obligate characterisation shows dependence on the live producer, a re-confirmation against the real producer (`--confirm-only` now revives the genome) is the clean follow-up. Use fresh seeds and record them before running.
- Known, deliberately unchanged: `pickSubjects`'s "farthest" extra breaks ties toward the highest index; "producer-2-only" can never occur among confirmed obligates, because confirmation requires bg0 viability (now visible through `bg2OnlyUnconfirmed`).
- Reviewer focus: step 2's byte-identity, and that step 6 changes no seed, subject or medium.
