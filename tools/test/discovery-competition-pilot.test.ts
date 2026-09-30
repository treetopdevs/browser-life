import { strict as assert } from "node:assert";
import {
  analyzePilotEvidence,
  type PilotDesign,
  type PilotEvidence,
  type PilotMass,
  type PilotReceipt,
  type PilotUnit,
  validatePilotReceipt,
  verifyHashRecords,
} from "../discovery_competition_pilot.ts";
import { sha256 } from "../lib/founder-policy.ts";

const zeros = () => Array(10).fill("0") as string[];
const mass = (
  descendant: number,
  ancestor: number,
  unassociated = 0,
): PilotMass => ({ descendant, ancestor, unassociated, unexpected: 0 });
function design(founderCount = 4): PilotDesign {
  const founders = Array.from(
    { length: founderCount },
    (_, i) => ({
      id: `f${i}`,
      cluster: i,
      hex: "0".repeat(336),
      subjects: [`subject-${i}`],
    }),
  );
  const seeds = [6440001, 6440002, 6440003, 6440004];
  const units: PilotUnit[] = [];
  for (const founder of founders) {
    for (const mode of ["clone", "empty"] as const) {
      for (const [seedIndex, seed] of seeds.entries()) {
        for (let assignment = 0; assignment < 4; assignment++) {
          const cloneGroup = assignment === 0 || assignment === 3 ? 0 : 1;
          const initialStateHash = mode === "clone"
            ? (1 + founder.cluster * 100 + seedIndex * 2 + cloneGroup).toString(
              16,
            ).padStart(16, "0")
            : (10_000 + founder.cluster * 100 + seedIndex * 4 + assignment)
              .toString(16).padStart(16, "0");
          units.push({
            id: `${founder.id}-${mode}-${seed}-a${assignment}`,
            founderId: founder.id,
            founderHex: founder.hex,
            mode,
            seed,
            assignment,
            initialStateHash,
            initialMass: mass(64, mode === "clone" ? 64 : 0),
            initialFlux: zeros(),
          });
        }
      }
    }
  }
  const inputs = { fixture: "a".repeat(64) },
    sources = { "tools/discovery_competition_pilot.ts": "b".repeat(64) };
  return {
    format: "discovery-competition-pilot/v1",
    ruleVersion: 1,
    sourceRoot: "/fixture",
    root: "/fixture/root",
    protocolPath: "/fixture/protocol.md",
    inputs,
    sources,
    sourceManifestHash: "c".repeat(64),
    designHash: "d".repeat(64),
    founders,
    seeds,
    times: [0, 10_000, 20_000],
    configs: {},
    units,
    requiredReplayUnitIds: [
      units.find((u) => u.mode === "clone")!.id,
      units.find((u) => u.mode === "empty")!.id,
    ],
    thresholds: {
      overallUniqueAvailability: 0.9,
      founderUniqueAvailability: 0.75,
      founderUniqueActivity: 0.75,
    },
  };
}

function receiptFor(
  d: PilotDesign,
  unit: PilotUnit,
  extinct = false,
): PilotReceipt {
  const reversed = (unit.assignment & 2) !== 0;
  const group = unit.assignment === 0 || unit.assignment === 3 ? 0 : 1;
  const initial = unit.initialMass;
  const followup = (): PilotMass => {
    if (extinct) return mass(0, 0);
    if (unit.mode === "empty") return mass(64, 0);
    const desc = group === 0 ? 12 : 18, anc = group === 0 ? 18 : 12;
    return reversed ? mass(anc, desc) : mass(desc, anc);
  };
  const sample = (
    step: number,
    m: PilotMass,
    state: string,
    flux: string[],
  ) => ({
    step,
    mass: m,
    score: m.descendant + m.ancestor === 0
      ? null
      : (m.descendant - m.ancestor) / (m.descendant + m.ancestor),
    flux,
    stateHash: state,
  });
  const at10 = followup(), at20 = followup();
  const flux10 = zeros(), flux20 = zeros();
  flux10[0] = "1";
  flux10[3] = "1";
  flux20[0] = "2";
  flux20[3] = "2";
  const physicalId = unit.mode === "clone"
    ? `${unit.founderId}-${unit.seed}-clone-${group}`
    : unit.id;
  const samples = [
    sample(0, initial, unit.initialStateHash, unit.initialFlux),
    sample(10_000, at10, sha256(`${physicalId}/10000`).slice(0, 16), flux10),
    sample(20_000, at20, sha256(`${physicalId}/20000`).slice(0, 16), flux20),
  ];
  return {
    format: "discovery-competition-receipt/v1",
    designHash: d.designHash,
    sourceManifestHash: d.sourceManifestHash,
    inputHashes: d.inputs,
    unit,
    times: d.times,
    samples,
    elapsedSeconds: 1,
  };
}

function evidence(
  d: PilotDesign,
  extinctGroups: ReadonlySet<string> = new Set(),
): Record<string, PilotEvidence> {
  return Object.fromEntries(d.units.map((unit) => {
    const group = `${unit.founderId}/${unit.seed}/${
      unit.assignment === 0 || unit.assignment === 3 ? 0 : 1
    }`;
    const extinct = unit.mode === "clone" && extinctGroups.has(group);
    return [unit.id, {
      value: receiptFor(d, unit, extinct),
      sha256: sha256(unit.id),
    }];
  }));
}

Deno.test("validates receipts and rejects design, initial-state, score, and flux drift", () => {
  const d = design(1), unit = d.units[0], receipt = receiptFor(d, unit);
  assert.equal(validatePilotReceipt(receipt, d, unit), receipt);
  assert.throws(
    () =>
      validatePilotReceipt({ ...receipt, designHash: "e".repeat(64) }, d, unit),
    /design hash mismatch/,
  );
  const initialDrift = structuredClone(receipt);
  initialDrift.samples[0].stateHash = "f".repeat(16);
  assert.throws(
    () => validatePilotReceipt(initialDrift, d, unit),
    /initial state hash mismatch/,
  );
  const scoreDrift = structuredClone(receipt);
  scoreDrift.samples[1].score = 0.5;
  assert.throws(
    () => validatePilotReceipt(scoreDrift, d, unit),
    /score mismatch/,
  );
  const fluxDrift = structuredClone(receipt);
  fluxDrift.samples[2].flux[0] = "0";
  assert.throws(
    () => validatePilotReceipt(fluxDrift, d, unit),
    /decreasing cumulative flux/,
  );
});

Deno.test("reports absent rows without shrinking the frozen roster", () => {
  const d = design(1), rows = evidence(d), missingId = d.units[0].id;
  delete rows[missingId];
  const got = analyzePilotEvidence(d, rows);
  assert.deepEqual(got.missing, [missingId]);
  assert.equal(got.requested, d.units.length);
  assert.equal(got.available, d.units.length - 1);
  assert.equal(got.status, "incomplete");
});

Deno.test("both-extinct is a valid unavailable score and does not count as clone availability", () => {
  const d = design(1),
    extinct = new Set([`f0/6440001/0`]),
    rows = evidence(d, extinct);
  const unit = d.units.find((u) =>
    u.mode === "clone" && u.seed === 6440001 && u.assignment === 0
  )!;
  const receipt = rows[unit.id].value as PilotReceipt;
  assert.equal(receipt.samples[2].score, null);
  const got = analyzePilotEvidence(d, rows);
  assert.equal(got.invalid.length, 0);
  assert.equal(got.perFounder[0].availableStates, 7);
  assert.equal(got.perFounder[0].activityStates, 7);
});

Deno.test("four founders at the 75 percent founder boundary still fail when all-valid survival is only 75 percent overall", () => {
  const d = design(4), lost = new Set<string>();
  for (const founder of d.founders) {
    for (let group = 0; group < 2; group++) {
      lost.add(`${founder.id}/6440001/${group}`);
    }
  }
  const got = analyzePilotEvidence(d, evidence(d, lost));
  assert.equal(got.missing.length, 0);
  assert.equal(got.invalid.length, 0);
  assert.equal(
    got.perFounder.every((f) =>
      f.availability === 0.75 && f.activityFraction === 0.75
    ),
    true,
  );
  assert.equal(got.overallUniqueCloneAvailability.fraction, 0.75);
  assert.equal(got.thresholdsPass, false);
  assert.equal(got.status, "thresholds-failed");
});

Deno.test("passes exact 75 percent per-founder activity when the 90 percent overall bound is met", () => {
  const d = design(4), lost = new Set(["f0/6440001/0", "f0/6440001/1"]);
  const got = analyzePilotEvidence(d, evidence(d, lost));
  assert.equal(got.perFounder[0].availability, 0.75);
  assert.equal(got.perFounder[0].activityFraction, 0.75);
  assert.equal(got.overallUniqueCloneAvailability.fraction, 30 / 32);
  assert.equal(got.thresholdsPass, true);
});

Deno.test("rejects a forged lineage split in a linked identical-clone state", () => {
  const d = design(1), rows = evidence(d);
  const a = d.units.find((u) =>
    u.mode === "clone" && u.seed === 6440001 && u.assignment === 0
  )!;
  const b = d.units.find((u) =>
    u.mode === "clone" && u.seed === 6440001 && u.assignment === 3
  )!;
  const altered = rows[b.id].value as PilotReceipt;
  altered.samples[1].mass = mass(13, 17); // unchanged total and state hash, incompatible with the linked reversed labels
  altered.samples[1].score = (13 - 17) / (13 + 17);
  const got = analyzePilotEvidence(d, rows);
  assert.equal(got.invalid.some((x) => x.id === a.id), true);
  assert.equal(got.invalid.some((x) => x.id === b.id), true);
  assert.equal(
    got.invalid.find((x) => x.id === b.id)?.error.includes("linked clone"),
    true,
  );
});

Deno.test("rejects ancestor attribution in an empty-slot control", () => {
  const d = design(1),
    rows = evidence(d),
    unit = d.units.find((u) => u.mode === "empty")!;
  const receipt = rows[unit.id].value as PilotReceipt;
  receipt.samples[1].mass = mass(40, 1);
  receipt.samples[1].score = 39 / 41;
  const got = analyzePilotEvidence(d, rows);
  assert.equal(
    got.invalid.some((x) =>
      x.id === unit.id && x.error.includes("empty-slot ancestor")
    ),
    true,
  );
  assert.equal(got.emptyControlAccountingPass, false);
});

Deno.test("fails closed on frozen source hash drift", async () => {
  const expected = sha256("frozen bytes");
  await assert.rejects(
    () =>
      verifyHashRecords(
        { "fixture.ts": expected },
        async () => new TextEncoder().encode("changed bytes"),
      ),
    /frozen source drift/,
  );
});
