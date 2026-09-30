# Plan 002: Re-garden founder-set and cloud candidates beside their own ancestor, reproducibly

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
>
> ```bash
> shasum -a 256 tools/founders-x.ts tools/foundations.ts tools/assay.ts tools/lib/recurrence.ts | cut -c1-12
> ```
>
> Expected, in order: `940a21abf01f`, `d40ee1e12157`, `c944856e7bdc`,
> `e37c10baf513`. For any file that differs, compare the "Current state"
> excerpts below against the live code; on a mismatch, treat it as a STOP
> condition.

## Status

- **Priority**: P1
- **Effort**: M (about a day of code, then about 2–4 Mac GPU-hours of gardens)
- **Risk**: MED (it changes recorded readouts, so it gets a dated note before any result)
- **Depends on**: none (plan 003 depends on this one)
- **Category**: bug
- **Planned at**: git `f08e1e6` plus the uncommitted jj working copy (change `smzqotqt`), 2026-09-30

## Why this matters

The ecology-first founder program (`docs/plan.md`, "Ecology-first founder discovery") asks whether drifted clouds (B) or assembled founder sets (C: S1, S2, S4, S5) originate new trophic roles under mutation. A role "originates" when it qualifies in a mutation run but not in the set's no-mutation runs. In addition, the descendant genome holding it, grown in a common garden beside its founder, must keep a different dominant role.

`tools/founders-x.ts` grows every candidate beside the set's **first** genome (`founderSet[0]`), not beside the founder it descends from. That makes several recorded counts suspect:

- **S1** is two chemotrophs and two "mixed" genomes. Its first genome (diagnostic subject 0) is a chemotroph. S1's recorded 3 of 5 depends on run 4,740,002, which counts only through descendants whose garden role is "mixed", compared with that chemotroph.
- **S5** interleaves S1 with nine phototroph founders. Its originating roles are phototroph and decomposer. A phototroph descended from a phototroph founder reads as "different role" when compared with a chemotroph.
- These counts (S1 3/5, S5 5/5) decide the recurrence readout's primary pool and the plan's reading "non-producer genomes matter".
- In S1's counting runs, the originating roles' first windows already begin at step 100, the founding census, before mutation can have acted.

Separately, the counts are not reproducible from the repo:

- No committed code writes `fx.json`'s per-set counts.
- Subject numbers come from sorted set keys, so adding S5 renumbered S4: both have `subject: 14` in `fx.json`.
- The on-disk garden plan `runs/foundations/results/fx-plan-uniform.json` (118 plantings, 30 batch units) was regenerated after S5 was added, but `runs/found-fx-uniform/` holds 27 units from the earlier plan. Re-running the garden would silently pair old outputs with renumbered candidates.

This plan plants each candidate beside its clade root's genome, keys subjects by set or cloud id, stamps garden outputs with a plan id, re-runs both gardens on fresh seeds, and writes a reproducible `experiments/foundations/fx-root.json`. The old `fx.json` stays as the record of the old comparator.

## Current state

- `tools/founders-x.ts` — B/C planning and reading (Deno CLI, subcommands `cloud | plan | read`).
  - Subject ids come from sorted set keys (lines 287–291):

    ```ts
    // tools/founders-x.ts:287-291
    const keys = [...new Set(rows.map((r) => r.setKey))].sort();
    const subj = new Map(keys.map((k, i) => [k, i]));
    return rows
      .map(({ setKey, ...r }) => ({ ...r, subject: subj.get(setKey)! }))
      .sort((x, y) => x.subject - y.subject || x.seed - y.seed);
    ```

  - The comparator is the set's first hex (lines 303–312):

    ```ts
    // tools/founders-x.ts:303-312
    // Garden plantings: each candidate beside its founding set's first hex (standing variation's "founder").
    const setHex = new Map<number, string>();
    for (const r of runs) {
      if (!setHex.has(r.subject) && r.founderSet?.length) setHex.set(r.subject, r.founderSet[0]);
    }
    const plantings = [
      ...candidates.map((c: any, i: number) => ({ id: `c${i}`, hex: [c.hex, setHex.get(c.subject)] })),
      ...[...setHex.entries()].map(([subject, hex]) => ({ id: `m${subject}`, hex: [hex] })),
    ];
    ```

  - `GARDEN_SEED0 = 4_760_001` is hard-coded (line 26). `fxRuns` (lines 259–293) never checks that all 128 runs exist and finished at 10⁶ steps.
- `tools/foundations.ts` — exports `originationCandidates(runs)` (lines 649–676; returns `{ qual, candidates }`, each candidate `{ subject, seed, role, window: [start, end], descendant, atStep, hex }`), `gardenOutcome(p, mono)` (lines 681–695; slot 0 = descendant, slot 1 = founder, `mono` = founder monoculture), `GRADIENT_GARDEN` (line 698) and `tsv(path)` (line 48). The founder diagnostic's completeness rule is in `fd()` (lines ~880–884):

  ```ts
  // tools/foundations.ts (inside fd): a planting counts only with all 16 replicate tiles, each holding every lineage slot
  const whole = (id: string, slots: number) => {
    const p = res.get(id);
    return !!p && new Set(p.tiles.map((t: any) => t.tile)).size === 16 && p.tiles.every((t: any) => t.lineages.length === slots);
  };
  ```

- `tools/assay.ts` — GPU assays. `garden()` (lines 125–131) splits a plan's plantings into units of `floor(64 / reps)` = 4 plantings. It writes each unit to `<out>/g<j>.json` with seed `plan.seed0 + j`, and skips units whose file exists (`forUnits`, lines 69–84). It does not check that existing outputs came from the same plan. `gardenBatch` returns `{ seed, plantings: [{ id, tiles: [...] }] }`.
- `tools/lib/recurrence.ts` — exports `groupOf({ experiment, seed, soloFounder })`. For `founders-x-b` it returns group `founder-<k>`; for `founders-x-c`, `S1 | S2 | S4 | S5`; plus `mutation: j < 5`.
- Run bundles: `runs/founders-x-b/gradient-m3/{treatment,no-mutation}/seed-*`, `runs/founders-x-c/{gradient-m3,gradient-m3-waste}/{treatment,no-mutation}/seed-*`. Each has `manifest.json` (`spec.seed`, `spec.experiment`, `spec.founderSet`, `summary.steps`, `summary.extinct`), `profiles.tsv`, `mutations.tsv` (header `childHi childLo parentHi parentLo`) and `genomes.tsv` (header `lineage firstStep words`; `words` is the genome hex). Lineage keys are `"<hi>:<lo>"`. Founder-disc lineages have `hi` 0 and no parent row.
- Old counts (uniform garden, `experiments/foundations/fx.json` → `.uniform.perCloudOrSet`): founder-2 4/5 counts; S1 3/5 counts; S5 5/5 counts; every other cloud/set does not count. Gradient garden (`.gradient.perCloudOrSet`): founder-2, founder-3, founder-9, S1 and S5 count.
- Seeds: the ecology-first program reserves gardens from 4,760,001 (`docs/plan.md`). Used so far: uniform 4,760,001–4,760,030 and gradient 4,770,001–4,770,030. This plan uses **4,761,001+ (uniform)** and **4,771,001+ (gradient)**.

**Conventions.** Pure, testable logic goes in `tools/lib/*.ts` (no Deno APIs); see `tools/lib/recurrence.ts` and its test `tools/test/recurrence.test.ts`. CLIs stream large TSVs (`tsv()` / `lines()` generators), and never `Deno.readTextFile` a whole `profiles.tsv`, `mutations.tsv` or `genomes.tsv`. Exploratory results go to `experiments/foundations/*.json`; intermediate plans go to `runs/foundations/results/`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Unit tests | `pnpm test` | all pass |
| New tests only | `pnpm vitest run tools/test/clade.test.ts tools/test/fx-root.test.ts` | all pass |
| Plan the re-garden (CPU) | `deno run -A tools/founders-x.ts read-root --garden-seed 4761001 --garden-seed-gradient 4771001` | prints counts; writes 3 files under `runs/foundations/results/` |
| Uniform garden (GPU) | `deno run -A tools/assay.ts garden --out runs/found-fxr-uniform --plan runs/foundations/results/fxr-plan-uniform.json` | one `g<j> (k/N, s)` line per unit |
| Gradient garden (GPU) | `deno run -A tools/assay.ts garden --out runs/found-fxr-gradient --plan runs/foundations/results/fxr-plan-gradient.json` | as above |
| Summary (CPU) | `deno run -A tools/founders-x.ts summary-root` | writes `experiments/foundations/fx-root.json` |
| Other GPU jobs | `ps aux \| grep -E "deno run" \| grep -v grep` | lists running jobs (sharing the GPU is allowed but slower) |

## Scope

**In scope:**
- `tools/lib/clade.ts` (create): parent map and root walker
- `tools/lib/fx-root.ts` (create): subject ids, counting and completeness
- `tools/test/clade.test.ts`, `tools/test/fx-root.test.ts` (create)
- `tools/founders-x.ts`: add subcommands `read-root` and `summary-root`; add a comment on `read`
- `tools/assay.ts`: a plan id stamped into garden outputs, and a refusal to mix plans
- `docs/plan.md`: two dated paragraphs, exact text in steps 6 and 9
- New outputs: `runs/foundations/results/fxr-*.json`, `runs/found-fxr-uniform/`, `runs/found-fxr-gradient/`, `experiments/foundations/fx-root.json`

**Out of scope** (do NOT touch):
- `experiments/foundations/fx.json`, `runs/foundations/results/fx-*.json`, `runs/found-fx-*` — historical records of the old comparator; never overwrite them.
- The behaviour of `founders-x.ts read` (add a comment only), `tools/foundations.ts` (import from it, do not edit it), and test 3 / founder-diagnostic code paths.
- `tools/recurrence-x.ts` — plan 003 switches it to `fx-root.json`.
- Physics, presets, `packages/**`.

## Git workflow

- jj-colocated repo, and other sessions may share the working copy. **Do not commit, bookmark or push.** Leave changes in place and list the changed files at the end.

## Steps

### Step 1: Clade helpers in `tools/lib/clade.ts`, with tests

Create `tools/lib/clade.ts`:

```ts
// Clade roots from mutations.tsv (columns childHi childLo parentHi parentLo, header first).
// Keys are "hi:lo" strings: a numeric hi * 2^32 + lo loses precision once hi > 2^21 (runs past
// ~2.1e6 steps). Pure: takes lines, so vitest can load it.

/** child -> parent; the first row for a child wins (as in tools/recurrence-x.ts). */
export async function parentMap(lines: AsyncIterable<string>): Promise<Map<string, string>> {
  const parents = new Map<string, string>();
  let first = true;
  for await (const l of lines) {
    if (first) {
      first = false;
      continue;
    }
    if (!l) continue;
    const f = l.split("\t");
    const child = `${f[0]}:${f[1]}`;
    if (!parents.has(child)) parents.set(child, `${f[2]}:${f[3]}`);
  }
  return parents;
}

/** Memoised walk to the lineage that is nobody's child. Throws on a cycle. */
export function rootWalker(parents: Map<string, string>): (key: string) => string {
  const memo = new Map<string, string>();
  return (key: string) => {
    const path: string[] = [];
    const seen = new Set<string>();
    let x = key, root: string;
    for (;;) {
      const m = memo.get(x);
      if (m !== undefined) {
        root = m;
        break;
      }
      if (seen.has(x)) throw new Error(`mutations.tsv parent links form a cycle at ${x}`);
      seen.add(x);
      path.push(x);
      const p = parents.get(x);
      if (p === undefined) {
        root = x;
        break;
      }
      x = p;
    }
    for (const y of path) memo.set(y, root);
    return root;
  };
}
```

Create `tools/test/clade.test.ts`. Feed `parentMap` from an async generator over string arrays:

- header plus rows `2\t10\t0\t11` and `5\t3\t2\t10` → `rootWalker(map)("5:3") === "0:11"`, `("2:10") === "0:11"`, `("0:11") === "0:11"`, and an unknown key returns itself;
- a duplicate child row keeps the first parent;
- a cycle (`1:1 → 2:2 → 1:1`) throws `/cycle/`.

**Verify**: `pnpm vitest run tools/test/clade.test.ts` → all pass.

### Step 2: Counting and completeness in `tools/lib/fx-root.ts`, with tests

Create `tools/lib/fx-root.ts` with:

```ts
// Founder-set / cloud origination counts against each candidate's own clade root (plan 002).
// Pure functions; I/O stays in tools/founders-x.ts.

/** Fixed subject ids: the 12 B clouds, then the C sets. Index = numeric subject for originationCandidates. */
export const SUBJECT_IDS = [...Array.from({ length: 12 }, (_, k) => `founder-${k}`), "S1", "S2", "S4", "S5"] as const;
export const subjectIndex = (id: string) => {
  const i = (SUBJECT_IDS as readonly string[]).indexOf(id);
  if (i < 0) throw new Error(`unknown subject id ${id}`);
  return i;
};
/** Runs each subject must have: 5 mutation + 3 no-mutation, each finished at 1e6 steps. */
export const RUNS_PER_SUBJECT = { mutation: 5, noMutation: 3 } as const;

/** A planting is whole when it has `reps` distinct tiles and every tile holds `slots` lineage slots. */
export function wholePlanting(p: { tiles: { tile: number; lineages: unknown[] }[] } | undefined, slots: number, reps = 16): boolean {
  return !!p && new Set(p.tiles.map((t) => t.tile)).size === reps && p.tiles.every((t) => t.lineages.length === slots);
}

/** Per subject: distinct mutation-run seeds with at least one originating candidate; counts when >= 3. */
export function countSubjects(rows: { subjectId: string; seed: number; originates: boolean }[]) {
  return SUBJECT_IDS.map((id) => {
    const seeds = new Set(rows.filter((r) => r.subjectId === id && r.originates).map((r) => r.seed));
    return { id, runsOriginating: seeds.size, counts: seeds.size >= 3 };
  });
}
```

Create `tools/test/fx-root.test.ts`, testing:
- `subjectIndex("founder-0") === 0`, `subjectIndex("S5") === 15`, and an unknown id throws;
- `countSubjects`: three originating rows on distinct seeds count; three on the same seed give `runsOriginating 1`; non-originating rows are ignored; every one of the 16 ids appears in the output;
- `wholePlanting`: 16 tiles × 2 slots is true; 15 tiles is false; a tile with 1 slot when 2 are expected is false; `undefined` is false.

**Verify**: `pnpm vitest run tools/test/fx-root.test.ts` → all pass.

### Step 3: Stamp garden outputs with a plan id in `tools/assay.ts`

1. Add `id?: string;` to `interface GardenPlan` (lines 111–123), with the doc comment `/** Plan identity; written into every unit so readers can refuse outputs from another plan. */`.
2. In `garden()` (lines 125–131), before `forUnits`, refuse an output directory that holds units from another plan:

   ```ts
   await Deno.mkdir(OUT, { recursive: true });
   for await (const e of Deno.readDir(OUT)) {
     if (!/^g\d+\.json$/.test(e.name)) continue;
     const prev = JSON.parse(await Deno.readTextFile(`${OUT}/${e.name}`));
     if ((prev.planId ?? null) !== (plan.id ?? null)) throw new Error(`${OUT}/${e.name} was written by plan ${prev.planId ?? "(none)"}, not ${plan.id ?? "(none)"}; use another --out`);
   }
   ```

   (`OUT` is the `--out` directory already used by `forUnits`; check how `tools/assay.ts` names it near the top of the file, then use that name.)
3. Wrap the unit work so the id is stored:

   ```ts
   await forUnits(units, (u) => `g${u.j}`, async ({ j, ps }) => ({ ...(await gardenBatch(ps, plan, plan.seed0 + j)), ...(plan.id ? { planId: plan.id } : {}) }));
   ```

Plans without `id` (all historical ones) behave exactly as before.

**Verify**: `pnpm typecheck` → exit 0. `grep -n "planId" tools/assay.ts` → at least 2 matches.

### Step 4: `read-root` subcommand in `tools/founders-x.ts`

Add `async function readRootCmd()` and a `case "read-root"` in the `switch`. Add `"garden-seed"` and `"garden-seed-gradient"` to the `parseArgs` `string` list. Imports: `groupOf` from `./lib/recurrence.ts`; `parentMap`, `rootWalker` from `./lib/clade.ts`; `SUBJECT_IDS`, `subjectIndex`, `RUNS_PER_SUBJECT` from `./lib/fx-root.ts`; and `lines` from `./foundations.ts` (it is exported).

Behaviour, in order:

1. **Seeds are required.** Throw unless `--garden-seed` and `--garden-seed-gradient` are given as integers.
2. **Discover runs.** Read every `manifest.json` under `<--dir>/founders-x-b/gradient-m3/{treatment,no-mutation}/*` and `<--dir>/founders-x-c/{gradient-m3,gradient-m3-waste}/{treatment,no-mutation}/*`. Map each run with `groupOf({ experiment: m.spec.experiment, seed: m.spec.seed })` to `{ dir, subjectId: g.group, subject: subjectIndex(g.group), seed, mutation: g.mutation, extinct: !!m.summary?.extinct, steps: m.summary?.steps, founderSet: m.spec.founderSet }`. Throw if `groupOf` returns null, or if `g.mutation` disagrees with the condition directory.
3. **Completeness.** Every id in `SUBJECT_IDS` must have exactly 5 mutation and 3 no-mutation runs, all with `steps === 1_000_000`. If not, write `runs/foundations/results/fxr-read.json` as `{ complete: false, missing: [...] }`, print it, and stop. Expected: 128 runs.
4. **Candidates.** `const { qual, candidates } = await originationCandidates(runs)` (it uses the numeric `subject`). For each candidate:
   - find its run (unique by `seed`);
   - build `parentMap(lines(\`${dir}/mutations.tsv\`))` once per run and take `root = rootWalker(map)(candidate.descendant)`;
   - stream that run's `genomes.tsv` with `tsv()` and take the `words` of the row whose `lineage === root`. Throw `root genome missing` if it is absent.
   - record `{ ...candidate, subjectId, rootKey: root, rootHex, oldComparatorHex: founderSet[0], sameAsOldComparator: rootHex === founderSet[0], windowAtFounding: candidate.window[0] === 100 }`.
5. **Plantings.** `c<i>` = `[candidate.hex, rootHex]` for each candidate i. `r<k>` = `[rootHex_k]` for each distinct root hex k, in first-seen order. Store the map from root hex to `r<k>` in the candidates file.
6. **Plans.** Uniform: `{ seed0: <--garden-seed>, reps: 16, growSteps: 20_000, plantings }`. Gradient: the same with `seed0: <--garden-seed-gradient>` and `gradient: GRADIENT_GARDEN`. Give each an `id`: the first 16 hex characters of the SHA-256 of `JSON.stringify(planWithoutId)`, using `crypto.subtle.digest` as `sha256File` does in `tools/foundations.ts:75-78`.
7. **Write** `runs/foundations/results/fxr-candidates.json` (`{ complete: true, runs: 128, qualifying: qual, candidates, rootMonocultures }`), `fxr-plan-uniform.json` and `fxr-plan-gradient.json`. **Refuse to overwrite** any of the three if it already exists with different content; print a message and stop instead.
8. **Print** the candidate count, the distinct-root count, how many candidates have `sameAsOldComparator === false`, how many have `windowAtFounding === true`, and the number of garden units per plan (`ceil(plantings / 4)`).

Also add one comment line above the old `readCmd`: `// Superseded by read-root (plan 002): read compares every candidate with founderSet[0], and its fx-plan-*.json no longer match runs/found-fx-* outputs.`

**Verify**:
- `pnpm typecheck` → exit 0.
- `deno run -A tools/founders-x.ts read-root --garden-seed 4761001 --garden-seed-gradient 4771001` → exits 0, reports 128 runs, a candidate count near 102 (the old `fx-candidates.json` has 102), and writes the three files.
- `python3 -c "import json;p=json.load(open('runs/foundations/results/fxr-plan-uniform.json'));print(p['id'],p['seed0'],len(p['plantings']))"` → an id, `4761001`, and a planting count equal to candidates + distinct roots.

### Step 5: `summary-root` subcommand in `tools/founders-x.ts`

Add `async function summaryRootCmd()` and a `case "summary-root"`. Add string options `uniform-dir` (default `runs/found-fxr-uniform`) and `gradient-dir` (default `runs/found-fxr-gradient`).

Behaviour, in order:

1. Read `fxr-candidates.json` and both plan files.
2. For each garden directory, read every `g<j>.json` and throw if any unit's `planId` differs from its plan's `id`. Build a map from planting id to planting.
3. For each candidate i, take `p = map.get("c" + i)` and `mono = map.get(rootMonocultureIdFor(candidate.rootHex))`, and compute `gardenOutcome(p, mono)` (import it from `./foundations.ts`). Each row is `{ subjectId, seed, role, window, windowAtFounding, sameAsOldComparator, ...outcome }`.
4. **Completeness per garden.** Every candidate planting must be `wholePlanting(p, 2)` and every root monoculture `wholePlanting(mono, 1)`. If not, `complete: false` and no counts are reported as readings.
5. `countSubjects(rows)` per garden.
6. Old counts for comparison come from `experiments/foundations/fx.json`: `.uniform.perCloudOrSet` and `.gradient.perCloudOrSet` (fields `id`, `runsOriginating`, `counts`).
7. Write `experiments/foundations/fx-root.json`:

   ```jsonc
   {
     "note": "exploratory; plan 002: each candidate gardened beside its own clade root (mutations.tsv walk, genome from genomes.tsv) instead of founderSet[0]; test 3's rules otherwise unchanged; uniform garden primary",
     "seeds": { "uniform": <seed0>, "gradient": <seed0> },
     "planIds": { "uniform": "<id>", "gradient": "<id>" },
     "runs": 128,
     "candidates": <n>,
     "candidatesWithNewComparator": <n>,
     "candidatesWindowAtFounding": <n>,
     "uniform": { "complete": <bool>, "perSubject": [{ "id", "runsOriginating", "counts", "old": { "runsOriginating", "counts" } }], "outcomes": { "<outcome>": <n> }, "rows": [...] },
     "gradient": { ...same shape... },
     "changed": { "uniform": ["<ids whose counts flag differs from old>"], "gradient": [...] }
   }
   ```

**Verify**: `pnpm typecheck` → exit 0. Running `deno run -A tools/founders-x.ts summary-root` before the gardens exist should write `complete: false` for both gardens and not throw.

### Step 6: Fix the re-garden in `docs/plan.md` before any garden runs

Append at the end of `docs/plan.md` (blank line first; replace `YYYY-MM-DD` with today):

```markdown
**Founder-set gardens re-run beside each descendant's own ancestor (fixed YYYY-MM-DD, before any re-garden result).** The B/C gardens compared every candidate descendant with its set's first genome (`founderSet[0]`), not with the founder lineage it descends from. In S1 (two chemotrophs, two mixed genomes) a mixed descendant read as "different role" against the chemotroph comparator, and in S5 a phototroph descendant of a producer founder could read the same way. The re-garden plants each candidate beside its clade root's genome (walked through `mutations.tsv`, genome from `genomes.tsv`), with each root's monoculture as the inactive-founder fallback. Everything else follows test 3's rules unchanged: 16 replicates, 20,000 steps, the uniform garden primary and the gradient garden secondary, and a cloud or set counts when at least 3 of its 5 mutation runs originate a role. Seeds: uniform from 4,761,001, gradient from 4,771,001. Output: `experiments/foundations/fx-root.json`; `fx.json` stays as the record of the old comparator. Also reported: candidates whose qualifying window starts at step 100, the founding census. Exploratory, like the rest of this section.
```

**Verify**: `tail -1 docs/plan.md` starts with `**Founder-set gardens re-run`.

### Step 7: Run the uniform garden (GPU), with a time check

1. `mkdir -p runs/found-fxr-uniform`.
2. Run `deno run -A tools/assay.ts garden --out runs/found-fxr-uniform --plan runs/foundations/results/fxr-plan-uniform.json` in the background, sending output to `runs/found-fxr-uniform.log`.
3. After the first 2 unit lines appear (`g0 (1/N, Xs)`, `g1 (2/N, Ys)`), project the total as `N × (X + Y) / 2`.
   - If the projection is over **3 hours**, stop the process (it resumes later from the files already written), and STOP and report the projection.
   - Otherwise let it finish.

**Verify**: `ls runs/found-fxr-uniform/g*.json | wc -l` equals `ceil(plantings / 4)` from step 4. `grep -c planId runs/found-fxr-uniform/g0.json` → 1.

### Step 8: Run the gradient garden (GPU)

Same as step 7 with `--out runs/found-fxr-gradient --plan runs/foundations/results/fxr-plan-gradient.json`, logging to `runs/found-fxr-gradient.log`, and the same 3-hour projection rule.

**Verify**: the unit count matches, as in step 7.

### Step 9: Summarise and record the result

1. `deno run -A tools/founders-x.ts summary-root` → writes `experiments/foundations/fx-root.json` with `uniform.complete === true` and `gradient.complete === true`.
2. Append this factual line to `docs/plan.md` (blank line first). Fill it **only** from `fx-root.json`, and add no interpretation:

```markdown
*Re-garden result (YYYY-MM-DD; `experiments/foundations/fx-root.json`).* Uniform garden: S1 <a>/5 (was 3/5), S2 <b>/5 (was 0/5), S4 <c>/5 (was 0/5), S5 <d>/5 (was 5/5); clouds counting <k>/12 (was 1/12: founder-2). Gradient garden: S1 <…>, S2 <…>, S4 <…>, S5 <…>; clouds <…>/12 (was 3/12). <n> of <N> candidates had a different comparator from before; <m> candidates' windows start at step 100.
```

**Verify**: `python3 -c "import json;d=json.load(open('experiments/foundations/fx-root.json'));print(d['uniform']['complete'],d['gradient']['complete'],[(x['id'],x['runsOriginating'],x['counts']) for x in d['uniform']['perSubject'] if x['id'].startswith('S')])"` → `True True [...]`.

## Test plan

- `tools/test/clade.test.ts` (new): chain to root, root is self, unknown key is self, first parent wins, cycle throws.
- `tools/test/fx-root.test.ts` (new): `subjectIndex` (known and unknown), `countSubjects` (distinct seeds, same-seed collapse, non-originating ignored, all 16 ids present), `wholePlanting` (whole, missing tile, missing slot, undefined).
- Pattern: `tools/test/recurrence.test.ts` (vitest, pure-function imports from `../lib/...`).
- `pnpm test` → all pass.

## Done criteria

- [ ] `pnpm typecheck` exits 0; `pnpm test` exits 0, including the new test files
- [ ] `runs/foundations/results/fxr-candidates.json` has `complete: true` and `runs: 128`
- [ ] Every `runs/found-fxr-*/g*.json` carries the `planId` of its plan
- [ ] `experiments/foundations/fx-root.json` exists, with `uniform.complete` and `gradient.complete` both `true`
- [ ] `experiments/foundations/fx.json` and `runs/found-fx-*` are unchanged (`git diff --stat experiments/foundations/fx.json` is empty)
- [ ] `docs/plan.md` ends with the fixed-note paragraph followed by the result line
- [ ] No files outside the in-scope list are modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Fewer or more than 128 B/C runs are found, or any run did not finish at 10⁶ steps.
- A candidate's root lineage has no row in its run's `genomes.tsv`.
- A root walk hits a cycle.
- The candidate count from `originationCandidates` differs from 102 by more than a few. It should reproduce the old candidates, since only the comparator changes. Report both numbers.
- Any of the seeds 4,761,001–4,761,999 or 4,771,001–4,771,999 appears as a seed in `docs/plan.md` (`grep -nE "4,?761,?[0-9]{3}|4,?771,?[0-9]{3}" docs/plan.md`) other than in your own step-6 note.
- A garden's projected time is over 3 hours (step 7 or 8).
- `tools/assay.ts garden` refuses an output directory because of a plan-id mismatch: someone else used it. Do not delete it.
- Typecheck or tests fail twice after a reasonable fix.

## Maintenance notes

- Plan 003 switches `tools/recurrence-x.ts`'s counting strata from `fx.json` to `fx-root.json`. Until then, the recurrence readout's "primary pool" is defined by the old comparator.
- `windowAtFounding` candidates are reported, not excluded. Whether a role that qualifies from the founding census can count as "originating" is a separate rule decision for the operator.
- `tools/lib/clade.ts` is the shared root walker; prefer it over the numeric-key walk in `tools/recurrence-x.ts`, which collides beyond about 2.1×10⁶ steps.
- Reviewer focus: that `read-root` reproduces the old candidate list, so only the comparator changed, and that no historical file was overwritten.
