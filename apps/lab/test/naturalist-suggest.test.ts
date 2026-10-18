// The proposer's suggestions beside Field notes (docs/naturalist-lab-suggestions-v0-2026-10-18.md): the suggestion is the
// proposer's own (tools/lib/propose.ts, by import), its commands map back to its specs and pass the runner's validators, and the
// model applies nothing unless `tryHere` is called, once, for the world on screen. The page is in tests/e2e/lab-naturalist.spec.ts.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { PRESETS, RULE_VERSION, presetConfig } from "@bl/schema";
import { specConfig, type RunSpec, type ScheduledIntervention } from "@bl/runner";
import { fmtValue, fmtZ, group, textOf } from "../../../tools/lib/notebook.ts";
import { HYPOTHESIS, RULES, RULES_V0, canonical, feedAmount, parseNotes, proposeFromNotes, ruleFor, rulesInterventions, validateProposalSpec } from "../../../tools/lib/propose.ts";
import { notesJson, sourceManifest } from "../../../tools/test/propose-fixture.ts";
import { NATURALIST_BASELINES, decodeEnvelope, type EnvelopeHeader, type LiveRing } from "../src/naturalist-score.ts";
import { NaturalistModel, noteKey, suggestionStrings, viewStrings, type Asset, type HandEntry, type NaturalistCensus, type WorldManifest } from "../src/naturalist.ts";
import { NOTEBOOK_STEPS, NOTEBOOK_ZSTAR, labSource, suggestFor, type Suggestion, type SuggestWorld } from "../src/naturalist-suggest.ts";
import { SERIES_FIELDS, type SeriesFields } from "../src/naturalist-series.ts";

const file = (p: string) => new URL(`../../../${p}`, import.meta.url);
const readJson = <T>(p: string): T => JSON.parse(readFileSync(file(p), "utf8")) as T;
const assetOf = (preset: string): { header: EnvelopeHeader; data: Float64Array } => {
  const header = readJson<EnvelopeHeader>(`apps/lab/public/naturalist/${NATURALIST_BASELINES[preset].file}.json`);
  const bin = readFileSync(file(`apps/lab/public/naturalist/${header.bin.file}`));
  return { header, data: decodeEnvelope(new Uint8Array(bin.buffer, bin.byteOffset, bin.byteLength)) };
};
const ready = (preset: string): Asset => ({ kind: "ready", ...assetOf(preset) });

interface Fixture { fields: string[]; censuses: (SeriesFields & { rows: { count: number; cells: number; sha256: string } })[] }
const fixture = readJson<Fixture>("apps/lab/test/fixtures/naturalist-gradient-m3-treatment-seed-1.json");
const recOf = (c: Fixture["censuses"][number]): SeriesFields => Object.fromEntries(SERIES_FIELDS.map((f) => [f, c[f]])) as unknown as SeriesFields;
const fixtureRecs = fixture.censuses.map(recOf);
const rowsFor = (c: SeriesFields): [string, number][] => Array.from({ length: c.lineages }, (_, i) => [`k${i}`, i === 0 ? c.livingCells - (c.lineages - 1) : 1]);
const msg = (world: number, runId: string, c: SeriesFields, over: Partial<NaturalistCensus> = {}): NaturalistCensus => ({ world, runId, step: c.step, rec: c, rows: rowsFor(c), touched: null, dropped: 0, ...over });

const gradient = PRESETS.find((p) => p.id === "gradient-m3")!;
const spots = PRESETS.find((p) => p.id === "spots-m3")!;
const manifest = (over: Partial<WorldManifest> = {}, preset = gradient, seed = 1): WorldManifest => ({
  runId: `${preset.id}-s${seed}-abc`, presetId: preset.id, seed, cfg: presetConfig(preset, seed), init: preset.init, ruleVersion: RULE_VERSION, settings: { censusEvery: 100 }, interventions: [], ...over,
});

/** A gradient-m3 seed 1 world read through the committed excerpt (to step 16,000), with the proposer's rules loaded. */
function readSeed1(opts: { loading?: () => boolean } = {}) {
  const apply = vi.fn<(entries: HandEntry[], world: number) => void>();
  const model = new NaturalistModel(() => {}, { apply, loading: opts.loading });
  const m = manifest();
  model.onLoaded(m, 0, 1);
  model.setAsset("gradient-m3", ready("gradient-m3"));
  for (const c of fixtureRecs) model.onCensus(msg(1, m.runId, c));
  model.setSuggester(suggestFor);
  return { model, m, apply };
}
const readyView = (model: NaturalistModel, signal = "livingCells", side = "low") => {
  const n = model.view().notes.find((x) => x.signal === signal && x.side === side)!;
  expect(n.suggestion?.kind).toBe("ready");
  return { note: n, sv: n.suggestion as Extract<NonNullable<typeof n.suggestion>, { kind: "ready" }> };
};

/**
 * tools/run.ts's mapping from argv to a RunSpec, copied from tools/test/propose.test.ts (its flags as parseArgs reads them; --lesion
 * and --feed merged lesions then feeds and stable-sorted by step), plus --out.
 */
function specFromArgv(argv: string[]): { spec: RunSpec; out?: string; startFrom?: string } {
  expect(argv.slice(0, 4)).toEqual(["deno", "run", "-A", "tools/run.ts"]);
  const flags: Record<string, string> = {};
  const lesions: string[] = [], feeds: string[] = [];
  for (let i = 4; i < argv.length; i += 2) {
    const k = argv[i].replace(/^--/, ""), v = argv[i + 1];
    if (k === "lesion") lesions.push(v);
    else if (k === "feed") feeds.push(v);
    else {
      expect(flags[k], `--${k} given twice`).toBeUndefined();
      flags[k] = v;
    }
  }
  const list: ScheduledIntervention[] = [];
  for (const v of lesions) {
    const m = /^(\d+):(\d+),(\d+),(\d+)$/.exec(v)!;
    list.push({ step: Number(m[1]), kind: "lesion", x: Number(m[2]), y: Number(m[3]), r: Number(m[4]) });
  }
  for (const v of feeds) {
    const m = /^(\d+):(\d+),(\d+),(\d+),([+-]?\d+)$/.exec(v)!;
    list.push({ step: Number(m[1]), kind: "feed", x: Number(m[2]), y: Number(m[3]), r: Number(m[4]), amount: Number(m[5]) });
  }
  list.sort((p, q) => p.step - q.step);
  const spec: RunSpec = {
    experiment: flags.experiment,
    presetId: flags.preset,
    condition: flags.conditions,
    seed: Number(flags.seeds),
    steps: Number(flags.steps),
    censusEvery: Number(flags.census),
    deepEvery: Number(flags.deep),
    checkpointEvery: Number(flags.checkpoint),
    ...(flags.threshold ? { activityThreshold: Number(flags.threshold) } : {}),
    ...(list.length ? { interventions: list } : {}),
  };
  return { spec, out: flags.out, startFrom: flags["start-from"] };
}

/** A synthetic ring on (signal, side), its receipt ending at S. */
const ringAt = (signal: string, side: "high" | "low", S = 14_900): LiveRing => ({
  signal, side, D: 6, spread: 123.4, stretch: { censuses: 60, endStep: S + 1000, ongoing: true },
  receipt: { signal, side, Z: 4, W: 50, startStep: S - 4900, endStep: S, minAbsZ: 5.25, value: 2000, median: 3000 },
});
const worldOf = (preset: string, neutral = false, seed = 3): SuggestWorld => ({ gen: 7, runId: `${preset}-s${seed}-x`, presetId: preset, seed, cfg: presetConfig(PRESETS.find((p) => p.id === preset)!, seed), neutral });

describe("the suggestion is the proposer's", () => {
  it("for the committed seed-1 note: the run spec, argv and prediction proposeFromNotes makes for the same ring", () => {
    const { model, m } = readSeed1();
    const { note, sv } = readyView(model);
    const s = sv.s;
    expect(note.receipt).toMatchObject({ startStep: 10_000, endStep: 14_900, minAbsZ: 5.494653187635131, value: 21452, median: 33684 });
    // The same ring, as tools/notebook.ts would file it (Z* below 5.49, so parseNotes accepts it), on a gradient-m3 treatment
    // source of S + H = 34,900 steps forked from step 0.
    const src = sourceManifest({ presetId: "gradient-m3", condition: "treatment", seed: 1, steps: 34_900 });
    const notes = parseNotes(notesJson(src, [{ signal: "livingCells", side: "low", startStep: 10_000, value: 21452, median: 33684, minAbsZ: note.receipt.minAbsZ, spread: note.receipt.spread, label: textOf("livingCells").label }], { zStar: 5 }));
    const r = proposeFromNotes({ notes, notesRef: { path: "n.json", sha256: "a".repeat(64) }, manifest: src, source: { dir: "/x/source", manifestSha256: "b".repeat(64) }, forkFor: () => ({ step: 0, check: "initHash", hash: src.initHash! }) });
    expect(r.proposals).toHaveLength(1);
    const body = r.proposals[0].body;
    expect(s.fork.spec).toEqual(body.spec);
    expect(s.fork.argv).toEqual(body.argv);
    expect(s.prediction).toEqual(body.prediction);
    expect(s.hypothesis).toBe(HYPOTHESIS.feed);
    expect(body.rule).toEqual({ action: "feed", hypothesis: s.hypothesis });
    expect(s.row).toBe(RULES.livingCells.low);
    expect(s.entries).toEqual([{ step: 14_900, kind: "feed", x: 128, y: 128, r: 127, amount: 32 }]);
    expect(s.prediction.statement).toBe(`If the departure is held by the nutrient supply, then over steps 30,000 to 34,900 the fork's Living cells stays at least one spread (${Number(note.receipt.spread.toPrecision(3))}) above the source's, at the median.`);
    expect(s.key).toBe(noteKey(1, m.runId, { signal: "livingCells", side: "low", receipt: { endStep: 14_900 } }));
    expect(s.refused).toBeNull();
    // The source is the proposer's replay-control spec: the fork without its entries.
    const { interventions: _i, ...bare } = body.spec;
    expect(s.source.spec).toEqual(bare);
    // The proposer's path, on a source as long as the corpus's: the same fork, if the notebook files this ring.
    const long = sourceManifest({ presetId: "gradient-m3", condition: "treatment", seed: 1, steps: NOTEBOOK_STEPS });
    expect(s.proposerSource.spec.steps).toBe(NOTEBOOK_STEPS);
    const r2 = proposeFromNotes({ notes: parseNotes(notesJson(long, [{ signal: "livingCells", side: "low", startStep: 10_000, value: 21452, median: 33684, minAbsZ: note.receipt.minAbsZ, spread: note.receipt.spread, label: "Living cells" }], { zStar: 5 })), notesRef: { path: "n.json", sha256: "a".repeat(64) }, manifest: long, source: { dir: "/x/long", manifestSha256: "b".repeat(64) }, forkFor: () => ({ step: 0, check: "initHash", hash: long.initHash! }) });
    expect(r2.proposals[0].body.spec).toEqual(s.fork.spec);
  });

  it("every (signal, side) either baseline can ring on gets ruleFor's row and rulesInterventions' entries, and both specs validate", () => {
    for (const preset of ["gradient-m3", "spots-m3"]) {
      const { header } = assetOf(preset);
      const sides = ["high", "low"] as const;
      expect(header.signals.length).toBe(preset === "gradient-m3" ? 11 : 13);
      for (const sig of header.signals)
        for (const side of sides) {
          const w = worldOf(preset);
          const s = suggestFor(ringAt(sig.name, side), w, header);
          const row = ruleFor(sig.name, side);
          expect(s.row, `${preset} ${sig.name} ${side}`).toBe(row);
          const cfg = specConfig(s.fork.spec);
          expect(s.entries).toEqual(rulesInterventions(row, cfg, 14_900, feedAmount(preset)));
          expect(s.refused).toBeNull();
          expect(s.tryLabel === null).toBe(row.action === "control");
          expect(s.prediction.kind).toBe(row.action === "control" ? "replay" : "directional");
        }
    }
  });

  it("the source is the lab world: its config is the world's, in either condition", () => {
    for (const preset of [gradient, spots])
      for (const neutral of [false, true]) {
        const cfg = presetConfig(preset, 4);
        const w: SuggestWorld = { gen: 1, runId: "r", presetId: preset.id, seed: 4, cfg: neutral ? { ...cfg, neutral: true } : cfg, neutral };
        const m = labSource(w, 14_900);
        expect(m.spec.condition).toBe(neutral ? "neutral" : "treatment");
        expect(canonical(specConfig(m.spec))).toBe(canonical(w.cfg));
        expect(m.spec).toMatchObject({ experiment: "naturalist-fork", steps: 34_900, censusEvery: 100, deepEvery: 10, checkpointEvery: 0 });
      }
  });

  it("pins bell v0's Z* and its corpus's run length and cadence to the committed record", () => {
    const rec = readJson<{ summary: { secondary: { perPreset: Record<string, { zStar: number }> } }; corpus: { id: string; steps: number; censusEvery: number }[] }>("experiments/naturalist/bell-v0.json");
    for (const p of ["gradient-m3", "spots-m3"]) {
      expect(Object.is(NOTEBOOK_ZSTAR[p], rec.summary.secondary.perPreset[p].zStar)).toBe(true);
      const runs = rec.corpus.filter((c) => c.id.split("/")[1] === p);
      expect(runs.length).toBeGreaterThan(0);
      expect(new Set(runs.map((c) => `${c.steps}/${c.censusEvery}`))).toEqual(new Set([`${NOTEBOOK_STEPS}/100`]));
    }
    expect(assetOf("spots-m3").header.threshold.Z).toBe(NOTEBOOK_ZSTAR["spots-m3"]);
  });
});

describe("the commands", () => {
  const all = (): Suggestion[] => {
    const out: Suggestion[] = [];
    for (const preset of ["gradient-m3", "spots-m3"]) {
      const { header } = assetOf(preset);
      for (const sig of header.signals) for (const side of ["high", "low"] as const) for (const neutral of [false, true]) out.push(suggestFor(ringAt(sig.name, side, 20_000), worldOf(preset, neutral, 2), header));
    }
    return out;
  };

  it("each line maps back, flag by flag, to its spec, and that spec passes validateProposalSpec", () => {
    for (const s of all()) {
      const m = labSource(worldOf(s.fork.spec.presetId, s.fork.spec.condition === "neutral", 2), s.S);
      const long = labSource(worldOf(s.fork.spec.presetId, s.fork.spec.condition === "neutral", 2), s.S, NOTEBOOK_STEPS);
      expect(validateProposalSpec(s.proposerSource.spec, 0, long)).toBeNull();
      expect(canonical(specFromArgv(s.proposerSource.line.split(" ")).spec)).toBe(canonical(long.spec));
      for (const c of [s.source, s.fork]) {
        expect(c.line).toBe([...c.argv, "--out", c.out].join(" "));
        const back = specFromArgv(c.line.split(" "));
        expect(canonical(back.spec)).toBe(canonical(c.spec));
        expect(back.out).toBe(c.out);
        expect(back.startFrom).toBeUndefined();
        expect(validateProposalSpec(c.spec, 0, m)).toBeNull();
        expect(c.line).not.toMatch(/["'`$;&|<>\\]/);
      }
      expect(s.source.spec.interventions).toBeUndefined();
    }
  });

  it("writes nothing under runs/, and the proposer's path names the bundle and notes file the earlier commands make", () => {
    for (const s of all()) {
      const sp = s.source.spec;
      for (const c of [s.source, s.fork, s.proposerSource]) {
        expect(c.out.startsWith("naturalist-lab/")).toBe(true);
        expect(c.out.split("/")).not.toContain("runs");
        expect(c.out).not.toContain("..");
      }
      expect(new Set([s.fork.out, s.source.out, s.proposerSource.out]).size).toBe(3);
      expect(s.source.bundle).toBe(`${s.source.out}/naturalist-fork/${sp.presetId}/${sp.condition}/seed-${sp.seed}`);
      expect(s.proposerSource.bundle).toBe(`${s.proposerSource.out}/naturalist-fork/${sp.presetId}/${sp.condition}/seed-${sp.seed}`);
      expect(s.notesFile).toBe(`naturalist-fork-${sp.presetId}-${sp.condition}-seed-${sp.seed}.notes.json`);
      const [notebook, propose, approve, run] = s.proposerCommands;
      const notesOut = /--out (\S+)$/.exec(notebook)![1];
      expect(notebook).toBe(`deno run -A tools/notebook.ts ${s.proposerSource.bundle} --out ${notesOut}`);
      expect(propose).toContain(`tools/propose.ts propose ${s.proposerSource.bundle} --notes ${notesOut}/${s.notesFile} --out `);
      const proposals = /--out (\S+)$/.exec(propose)![1];
      // propose's --out is outside the source bundle (guardOut refuses it there) and outside runs/.
      expect(proposals.startsWith(`${s.proposerSource.bundle}/`)).toBe(false);
      expect(notesOut.startsWith(`${s.proposerSource.bundle}/`)).toBe(false);
      expect(approve).toBe(`deno run -A tools/propose.ts approve ${proposals}/<id>.proposal.json --by "<your name>"`);
      expect(run).toMatch(new RegExp(`^deno run -A tools/propose\\.ts run ${proposals.replace(/[.]/g, "\\.")}/<id>\\.proposal\\.json --out naturalist-lab/\\S+$`));
      for (const line of s.proposerCommands) expect(line.split(" ")).not.toContain("runs");
    }
  });

  it("says, for gradient-m3, that the notebook may not file the note; for spots-m3, that it rings at this rule", () => {
    const { model } = readSeed1();
    const { sv } = readyView(model);
    expect(sv.s.proposerCaveat).toContain("This path may not file this note");
    // Worded from D (the strongest window so far), not the first window's receipt: the notebook rings on D > Z*.
    const ring = model.rings().find((r) => r.signal === sv.s.signal && r.side === sv.s.side)!;
    expect(ring.D).toBeLessThanOrEqual(7.0429124518134785);
    expect(sv.s.proposerCaveat).toContain(`had gone beyond 7.04 (the strongest's weakest |z| was ${fmtZ(ring.D)}), so unless it goes further later, the notebook may file no note for it`);
    const deeper = suggestFor({ ...ring, D: 9 }, worldOf("gradient-m3"), assetOf("gradient-m3").header);
    expect(deeper.proposerCaveat).toContain("whose weakest |z| was 9.00, beyond 7.04");
    expect(deeper.proposerCaveat).not.toContain("files no note");
    const spotsSug = suggestFor(ringAt("livingCells", "low"), worldOf("spots-m3"), assetOf("spots-m3").header);
    expect(spotsSug.proposerCaveat).toContain("this panel's own rule and baseline");
    expect(spotsSug.caveats[0]).toContain("No lab world of this preset has been compared");
  });
});

describe("the reason", () => {
  it("cites only the receipt, S, the threshold and the dose", () => {
    for (const preset of ["gradient-m3", "spots-m3"]) {
      const { header } = assetOf(preset);
      for (const sig of header.signals)
        for (const side of ["high", "low"] as const)
          for (const neutral of [false, true]) {
            const ring = ringAt(sig.name, side, 17_300);
            const s = suggestFor(ring, worldOf(preset, neutral), header);
            const rc = ring.receipt;
            const e = s.entries[0];
            // The receipt's fields as the panel formats them, S, the threshold, the fork step 0, and the dose (radius, share, quanta).
            const shown = [fmtValue(sig.name, rc.value), fmtValue(sig.name, rc.median), group(rc.startStep), group(rc.endStep), fmtZ(rc.minAbsZ), group(s.S), String(header.threshold.Z), "0", ...(e ? [String(e.r), "77", String(Math.abs(feedAmount(preset)!))] : [])];
            const nums = (t: string) => (t.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((x) => Number(x.replace(/,/g, "")));
            const allowed = new Set(shown.flatMap(nums));
            const numbers = nums(s.reason);
            for (const n of numbers) expect(allowed.has(n), `${preset} ${sig.name} ${side}: ${n} in "${s.reason}"`).toBe(true);
            expect(s.reason.startsWith("This world is neutral")).toBe(neutral);
            expect(s.reason).not.toMatch(/still going|run's end|beyond Z\*/);
          }
    }
  });
});

describe("a late note", () => {
  it("near the horizon (S = 299,900) still gives specs the validators accept, ending at S + H", () => {
    for (const preset of ["gradient-m3", "spots-m3"]) {
      const s = suggestFor(ringAt("livingCells", "low", 299_900), worldOf(preset), assetOf(preset).header);
      expect(s.refused, preset).toBeNull();
      expect(s.S).toBe(299_900);
      expect(s.fork.spec.steps).toBe(299_900 + RULES_V0.horizon);
      expect(s.entries.map((e) => e.step)).toEqual(s.entries.map(() => 299_900));
      expect(validateProposalSpec(s.fork.spec, 0, labSource(worldOf(preset), 299_900))).toBeNull();
    }
  });
});

describe("Try it here", () => {
  it("applies nothing while censuses arrive and views are drawn; one click applies the one entry, once", () => {
    const apply = vi.fn<(entries: HandEntry[], world: number) => void>();
    const model = new NaturalistModel(() => {}, { apply });
    const m = manifest();
    model.onLoaded(m, 0, 1);
    model.setAsset("gradient-m3", ready("gradient-m3"));
    for (const c of fixtureRecs) {
      model.onCensus(msg(1, m.runId, c));
      model.view();
      if (c.step === 15_000) model.setSuggester(suggestFor);
    }
    for (let i = 0; i < 20; i++) model.view();
    expect(apply).not.toHaveBeenCalled();
    const { note, sv } = readyView(model);
    expect(sv.offer.state).toBe("offered");
    expect(sv.offer.button).toBe("Try it here: feed 32 quanta per cell, radius 127, at (128, 128)");
    expect(model.tryHere(note.key)).toEqual({ ok: true, entries: [{ kind: "feed", x: 128, y: 128, r: 127, amount: 32 }] });
    expect(apply).toHaveBeenCalledTimes(1);
    // Named for the world the suggestion was made for (generation 1): the worker refuses it for any other.
    expect(apply).toHaveBeenCalledWith([{ kind: "feed", x: 128, y: 128, r: 127, amount: 32 }], 1);
    expect(readyView(model).sv.offer.state).toBe("sent");
    expect(model.tryHere(note.key).ok).toBe(false);
    // Every other note of this world is not offered once one was tried.
    for (const n of model.view().notes) if (n.key !== note.key && n.suggestion?.kind === "ready") expect(n.suggestion.offer.state).toBe("tried-other");
    expect(model.view().notes.filter((n) => n.key !== note.key).every((n) => !model.tryHere(n.key).ok)).toBe(true);
    // The worker logs it at the step the world is on (here 16,000), and reading stops.
    model.onTouched(1, m.runId, 16_000);
    const after = readyView(model).sv.offer;
    expect(after.state).toBe("tried");
    expect(after.lines[0]).toMatch(/^Tried here at step 16,000, not step 14,900: one feed logged as a change by hand\. The naturalist stopped reading/);
    expect(model.view().state).toBe("touched");
    expect(model.tryHere(note.key).ok).toBe(false);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("is refused for a replay control, a touched world, a failed world and while a world loads", () => {
    // The replay control: seed 1's notes include none, so a world with a control row is made with the suggester on a ring of its own.
    const control = (() => {
      const s = suggestFor(ringAt("patternEntropy", "high"), worldOf("gradient-m3"), assetOf("gradient-m3").header);
      expect(s.action).toBe("control");
      return s;
    })();
    expect(control.tryLabel).toBeNull();
    expect(control.entries).toEqual([]);

    const touched = readSeed1();
    touched.model.onTouched(1, touched.m.runId, 15_200);
    for (const n of touched.model.view().notes) {
      expect(n.suggestion?.kind === "ready" && n.suggestion.offer.state).toBe("touched");
      expect(touched.model.tryHere(n.key).ok).toBe(false);
    }
    // A change by hand arriving in a census (a brush stroke after a restore) does the same.
    const brushed = readSeed1();
    brushed.model.onCensus(msg(1, brushed.m.runId, { ...fixtureRecs[fixtureRecs.length - 1], step: 16_100 }, { touched: 16_000 }));
    expect(brushed.model.view().notes.every((n) => !brushed.model.tryHere(n.key).ok)).toBe(true);

    const failed = readSeed1();
    failed.model.onFailed();
    for (const n of failed.model.view().notes) expect(failed.model.tryHere(n.key)).toEqual({ ok: false, reason: "The world stopped, so nothing can be applied to it." });

    let loading = true;
    const loads = readSeed1({ loading: () => loading });
    const key = readyView(loads.model).note.key;
    expect(readyView(loads.model).sv.offer.state).toBe("loading");
    expect(loads.model.tryHere(key).ok).toBe(false);
    loading = false;
    expect(loads.model.tryHere(key).ok).toBe(true);

    for (const x of [touched, brushed, failed]) expect(x.apply).not.toHaveBeenCalled();
    expect(loads.apply).toHaveBeenCalledTimes(1);
  });

  it("drops suggestions of an older generation or another run", () => {
    const { model, m, apply } = readSeed1();
    const old = readyView(model).note.key;
    // A replant of the same world: a new generation.
    model.onLoaded(m, 0, 2);
    expect(model.tryHere(old).ok).toBe(false);
    for (const c of fixtureRecs) model.onCensus(msg(2, m.runId, c));
    const fresh = readyView(model).note.key;
    expect(fresh).not.toBe(old);
    expect(model.tryHere(old).ok).toBe(false);
    // A jump: the same planting, a forked run id, a new generation; the notes continue, under keys of the new run.
    const jumped = { ...m, runId: `${m.runId}-b1` };
    model.onLoaded(jumped, 16_000, 3);
    expect(model.tryHere(fresh).ok).toBe(false);
    const now = readyView(model).note.key;
    expect(now.startsWith(`3:${jumped.runId}:`)).toBe(true);
    expect(apply).not.toHaveBeenCalled();
    expect(model.tryHere(now).ok).toBe(true);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("offers again after the lab refuses the edit, only while the world is untouched", () => {
    const { model, m, apply } = readSeed1();
    const key = readyView(model).note.key;
    expect(model.tryHere(key).ok).toBe(true);
    model.onApplyRefused("feed amount is too large");
    const v = readyView(model).sv.offer;
    expect(v.state).toBe("offered");
    expect(v.lines).toEqual(["The lab did not apply it: feed amount is too large."]);
    expect(model.tryHere(key).ok).toBe(true);
    expect(apply).toHaveBeenCalledTimes(2);
    model.onTouched(1, m.runId, 16_000);
    expect(readyView(model).sv.offer.state).toBe("tried");
    // A refusal after the change was logged changes nothing.
    model.onApplyRefused("late");
    expect(readyView(model).sv.offer.state).toBe("tried");
  });

  it("a change by hand after a refused Try is a change by hand, not the Try", () => {
    const { model, m, apply } = readSeed1();
    const key = readyView(model).note.key;
    expect(model.tryHere(key).ok).toBe(true);
    model.onApplyRefused("feed amount is too large");
    // The person brushes a wound instead of clicking again.
    model.onTouched(1, m.runId, 15_500);
    const v = readyView(model).sv.offer;
    expect(v.state).toBe("touched");
    expect(v.lines.join(" ")).not.toMatch(/Tried here/);
    expect(v.lines[0]).toBe("The lab did not apply it: feed amount is too large.");
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("a wound and a drain are applied as the suggestion's own lesion and negative feed, named for its world", () => {
    // Seed 1's notes are feeds; these suggesters give the same notes a wound row and a drain row (keys kept), through suggestFor.
    for (const [signal, side, want] of [
      ["lineages", "high", { kind: "lesion", x: 128, y: 128, r: 127 }],
      ["livingCells", "high", { kind: "feed", x: 128, y: 128, r: 127, amount: -32 }],
    ] as const) {
      const { model, apply } = readSeed1();
      model.setSuggester((r, w, h) => ({ ...suggestFor({ ...r, signal, side }, w, h), key: noteKey(w.gen, w.runId, r) }));
      const { note, sv } = readyView(model);
      expect(sv.s.action).toBe(want.kind === "lesion" ? "lesion" : "drain");
      expect(sv.offer.state).toBe("offered");
      expect(sv.s.entries).toEqual([{ step: sv.s.S, ...want }]);
      expect(model.tryHere(note.key)).toEqual({ ok: true, entries: [want] });
      expect(apply).toHaveBeenCalledTimes(1);
      expect(apply).toHaveBeenCalledWith([want], 1);
    }
  });

  it("a suggester that throws for a note says so on that note, and the panel still draws", () => {
    const { model, apply } = readSeed1();
    model.setSuggester(() => {
      throw new Error("no rule for signal x");
    });
    const v = model.view();
    expect(v.notes.length).toBeGreaterThan(0);
    for (const n of v.notes) {
      expect(n.suggestion).toEqual({ kind: "failed", text: "The proposer's rules failed for this note (no rule for signal x), so no suggestion is shown for it and nothing can be tried." });
      expect(model.tryHere(n.key).ok).toBe(false);
    }
    expect(apply).not.toHaveBeenCalled();
  });

  it("an error while a Try waits offers nothing more on that world (the edit may still land)", () => {
    const { model, m, apply } = readSeed1();
    const key = readyView(model).note.key;
    expect(model.tryHere(key).ok).toBe(true);
    model.onApplyRefused("stats: something", false);
    const v = readyView(model).sv.offer;
    expect(v.state).toBe("unknown");
    expect(v.button).toBeNull();
    expect(model.tryHere(key).ok).toBe(false);
    for (const n of model.view().notes) expect(model.tryHere(n.key).ok).toBe(false);
    // The edit lands after all: said as tried.
    model.onTouched(1, m.runId, 16_000);
    expect(readyView(model).sv.offer.state).toBe("tried");
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("a change by hand after reading stopped for another reason still withdraws the offer", () => {
    const { model, m, apply } = readSeed1();
    // A census off the grid stops the reading; the notes stay.
    model.onCensus(msg(1, m.runId, { ...fixtureRecs[fixtureRecs.length - 1], step: 16_050 }));
    expect(model.view().state).toBe("stopped");
    expect(readyView(model).sv.offer.state).toBe("offered");
    model.onTouched(1, m.runId, 16_050);
    for (const n of model.view().notes) {
      expect(n.suggestion?.kind === "ready" && n.suggestion.offer.state).toBe("touched");
      expect(model.tryHere(n.key).ok).toBe(false);
    }
    // And a world loaded with a logged intervention is not offered either.
    const logged = new NaturalistModel(() => {}, { apply });
    logged.onLoaded(manifest({ interventions: [{ step: 0 }] }), 0, 1);
    logged.setAsset("gradient-m3", ready("gradient-m3"));
    logged.setSuggester(suggestFor);
    for (const c of fixtureRecs) logged.onCensus(msg(1, m.runId, c));
    expect(logged.view().notes.length).toBeGreaterThan(0);
    for (const n of logged.view().notes) expect(logged.tryHere(n.key).ok).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });

  it("says pending until the rules load, and why if they do not; nothing is offered then", () => {
    const model = new NaturalistModel(() => {});
    const m = manifest();
    model.onLoaded(m, 0, 1);
    model.setAsset("gradient-m3", ready("gradient-m3"));
    for (const c of fixtureRecs) model.onCensus(msg(1, m.runId, c));
    expect(model.wantsSuggester()).toBe(true);
    const n = model.view().notes[0];
    expect(n.suggestion).toEqual({ kind: "pending", text: "Working out the proposer's suggestion…" });
    expect(model.tryHere(n.key).ok).toBe(false);
    model.setSuggester({ failed: "network" });
    expect(model.wantsSuggester()).toBe(false);
    expect(model.view().notes[0].suggestion).toEqual({ kind: "failed", text: "The proposer's rules did not load (network), so no suggestion is shown and nothing can be tried." });
  });

  it("two notes with one run spec each say so", () => {
    const { model } = readSeed1();
    const ready = model.view().notes.map((n) => n.suggestion).filter((s): s is Extract<NonNullable<typeof s>, { kind: "ready" }> => s?.kind === "ready");
    const byHash = new Map<string, number>();
    for (const s of ready) byHash.set(s.s.specHash, (byHash.get(s.s.specHash) ?? 0) + 1);
    for (const s of ready) expect(s.sameAs !== null).toBe(byHash.get(s.s.specHash)! > 1);
    // Seed 1 files one note, so the same check on two that share a run: living cells low and individuals low, both the jar-disc
    // feed at step 14,900 (the rings are synthetic; everything after them is the model's and suggestFor's own).
    const { model: two } = readSeed1();
    vi.spyOn(two, "rings").mockReturnValue([ringAt("livingCells", "low"), ringAt("individuals", "low")]);
    const shared = two.view().notes.map((n) => n.suggestion).filter((s): s is Extract<NonNullable<typeof s>, { kind: "ready" }> => s?.kind === "ready");
    expect(shared).toHaveLength(2);
    expect(shared[0].s.specHash).toBe(shared[1].s.specHash);
    expect(shared[0].sameAs).toBe("The same run as the suggestion for individuals (low): one fork answers both, each with its own prediction.");
    expect(shared[1].sameAs).toBe("The same run as the suggestion for living cells (low): one fork answers both, each with its own prediction.");
  });
});

describe("words", () => {
  it("never say event, discovery, Confirmed or Seen, nor that the naturalist decides, wants or recommends; Measured is never on a suggestion", () => {
    const { model } = readSeed1();
    const views = [model.view()];
    model.onTouched(1, "gradient-m3-s1-abc", 16_000);
    views.push(model.view());
    const strings = views.flatMap(viewStrings);
    expect(strings.join("\n")).not.toMatch(/\bevents?\b|discover|recommend|\bwants?\b|naturalist decide/i);
    expect(strings.join("\n")).not.toMatch(/Confirmed|\bSeen\b/);
    const sug = views.flatMap((v) => v.notes.flatMap((n) => suggestionStrings(n.suggestion)));
    expect(sug.length).toBeGreaterThan(10);
    expect(sug).not.toContain("Measured");
    // The proposer's own words for every row, as the suggestion shows them.
    for (const [signal, sides] of Object.entries(RULES))
      for (const side of ["high", "low"] as const) {
        const s = suggestFor(ringAt(signal, side), worldOf("spots-m3"), assetOf("spots-m3").header);
        expect(s.action).toBe(sides[side].action);
        const text = [s.facts, s.reason, s.prediction.statement, ...s.caveats, s.proposerCaveat].join("\n");
        expect(text).not.toMatch(/\bevents?\b|discover|recommend/i);
        expect(text).not.toMatch(/Confirmed|\bSeen\b/);
      }
    expect(RULES_V0.horizon).toBe(20_000);
  });
});
