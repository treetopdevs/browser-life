// Imported evidence (DESIGN section 7): artifacts produced under another
// frozen protocol enter the workbench by exact identity. The record carries
// that protocol's own audit and replay coverage and every artifact digest. An
// imported case is never counted or labelled as replayed under the discovery
// policy ("every-case-cross-host"), and every listing names its class.
//
// The first source is the construction workstream's renewal-v1 experiment
// (runs/construction/renewal-v1 in the construction workspace).

import { join } from "node:path";
import { canonicalJSON, digestOf, RENEWAL_PIN, sha256Hex } from "@bl/schema";

export const IMPORT_SCHEMA = "discovery-import-v1";
export const IMPORTED_CLASS = "imported-evidence" as const;

// deno-lint-ignore no-explicit-any
type Any = any;

const fileSha = async (p: string) => sha256Hex(await Deno.readFile(p));
const readJson = async (p: string): Promise<Any> => JSON.parse(await Deno.readTextFile(p));

/** The latest passing audit attempt the renewal pilot readout is bound to. */
async function boundAudit(root: string, readout: Any): Promise<{ path: string; sha256: string; audit: Any }> {
  const path = join(root, readout.auditPath);
  const sha256 = await fileSha(path);
  if (sha256 !== readout.auditSha256) throw new Error("import: the renewal readout's audit changed after the readout");
  const audit = await readJson(path);
  if (audit.status !== "pass") throw new Error("import: the renewal audit did not pass");
  return { path: readout.auditPath, sha256, audit };
}

/**
 * Builds the imported-evidence record from a renewal-v1 run root. Every
 * listed digest is recomputed from the bytes on disk; any mismatch throws.
 */
export async function importRenewal(renewalRoot: string): Promise<Any> {
  const frozen = await readJson(join(renewalRoot, "FROZEN.json"));
  const manifestSha256 = await fileSha(join(renewalRoot, "manifest.json"));
  if (frozen.manifestSha256 !== manifestSha256) throw new Error("import: manifest.json differs from FROZEN.json");
  if (frozen.sourceDigest !== RENEWAL_PIN.sourceDigest) throw new Error(`import: the renewal root ran source ${frozen.sourceDigest}, not this build's pin ${RENEWAL_PIN.sourceDigest}`);
  // The frozen source tree itself: sources.json bound by FROZEN, every copied file, the tree digest,
  // and the protocol and plan the run was frozen under.
  if (await fileSha(join(renewalRoot, "sources.json")) !== frozen.sourcesSha256) throw new Error("import: sources.json differs from FROZEN.json");
  const sources = await readJson(join(renewalRoot, "sources.json"));
  for (const [path, hash] of Object.entries(sources.files as Record<string, string>)) {
    if (await fileSha(join(renewalRoot, "source", path)) !== hash) throw new Error(`import: frozen source ${path} changed`);
  }
  const treeDigest = await sha256Hex(new TextEncoder().encode(JSON.stringify(Object.keys(sources.files).sort().map((p) => [p, sources.files[p]]))));
  if (treeDigest !== sources.digest || sources.digest !== frozen.sourceDigest) throw new Error("import: the frozen source tree digest does not reproduce");
  const manifest = await readJson(join(renewalRoot, "manifest.json"));
  const protocolPath = "experiments/construction/renewal-v1/protocol.json";
  if (await fileSha(join(renewalRoot, "source", protocolPath)) !== frozen.protocolSha256 || manifest.protocolSha256 !== frozen.protocolSha256) throw new Error("import: the frozen protocol does not match FROZEN.json");
  if (await fileSha(join(renewalRoot, "source", manifest.plan.path)) !== manifest.plan.sha256 || frozen.planSha256 !== manifest.plan.sha256) throw new Error("import: the frozen plan does not match its pin");
  if (await fileSha(join(renewalRoot, "freeze-context.json")) !== manifest.freezeContextSha256) throw new Error("import: freeze-context.json changed");
  const sourceProtocol = await readJson(join(renewalRoot, "source", protocolPath));
  const readoutPath = join(renewalRoot, "readout", "pilot-readout.json");
  const readout = await readJson(readoutPath);
  if (readout.manifestSha256 !== manifestSha256) throw new Error("import: the readout belongs to another manifest");
  const { path: auditPath, sha256: auditSha256, audit } = await boundAudit(renewalRoot, readout);
  if (audit.manifestSha256 !== manifestSha256) throw new Error("import: the audit belongs to another manifest");
  const confirmationFrozen = await Deno.stat(join(renewalRoot, "confirmation", "freeze.json")).then(() => true, () => false);
  // The source protocol's designated replay coverage, complete, matched, with each replay artifact hashed.
  const auditDir = auditPath.slice(0, auditPath.lastIndexOf("/"));
  const replayed = new Map<string, string[]>();
  const replayArtifacts: Any[] = [];
  for (const id of sourceProtocol.verification.replayCases as string[]) {
    for (const backend of sourceProtocol.verification.backends as string[]) {
      const r = (audit.replays as Any[]).find((x) => x.case === id && x.backend === backend);
      if (!r || r.status !== "match") throw new Error(`import: designated replay ${id}/${backend} is missing or did not match`);
      const file = `${auditDir}/${backend}-replay-${id}.json`;
      const rep = await readJson(join(renewalRoot, file));
      if (rep.case !== id || rep.backend !== backend || rep.status !== "match" || rep.censusesCompared !== r.censusesCompared) throw new Error(`import: replay artifact ${file} disagrees with the audit`);
      replayArtifacts.push({ case: id, backend, path: file, sha256: await fileSha(join(renewalRoot, file)), censusesCompared: r.censusesCompared, claim: rep.claim ?? "every census: hashes, ledgers, cumulative observer values and checkpoint digests" });
      replayed.set(id, [...(replayed.get(id) ?? []), `${backend} (${r.censusesCompared} censuses)`]);
    }
  }
  if (audit.replays.length !== replayArtifacts.length) throw new Error("import: the audit lists replays outside the designated coverage");
  const cases = [];
  for (const c of manifest.cases) {
    const a = audit.cases[c.id];
    if (!a || a.status !== "complete") throw new Error(`import: ${c.id} is not a complete audited case`);
    if (await fileSha(join(renewalRoot, c.initialFile)) !== c.initialFileSha256) throw new Error(`import: ${c.id} initial state differs from the manifest`);
    const dir = join(renewalRoot, "cases", c.id, `attempt-${a.attempt}`);
    const resultSha256 = await fileSha(join(dir, "result.json"));
    if (resultSha256 !== a.resultSha256) throw new Error(`import: ${c.id} result.json is not the audited one`);
    const result = await readJson(join(dir, "result.json"));
    if (await fileSha(join(dir, "census.jsonl")) !== result.censusSha256) throw new Error(`import: ${c.id} census differs from its result`);
    for (const k of result.checkpoints) if (await fileSha(join(dir, k.file)) !== k.sha256) throw new Error(`import: ${c.id} checkpoint ${k.step} differs`);
    const ro = readout.cases.find((x: Any) => x.id === c.id);
    cases.push({
      class: IMPORTED_CLASS,
      id: c.id,
      phase: c.phase,
      kind: c.kind,
      arm: c.arm,
      seed: c.seed,
      reservoir: c.reservoir,
      spread: c.spread,
      horizon: c.horizon,
      initialStateHash: c.initialStateHash,
      initialFileSha256: c.initialFileSha256,
      attempt: a.attempt,
      resultSha256,
      censusSha256: result.censusSha256,
      finalStateHash: result.finalStateHash,
      checkpoints: result.checkpoints.map((k: Any) => ({ step: k.step, sha256: k.sha256, artifactDigest: k.artifactDigest })),
      outcome: {
        extinct: a.extinct,
        renew: a.renew ?? null,
        qualifyingSites: a.qualifyingSites ?? null,
        bothSitesPersist: a.bothSitesPersist ?? null,
        anySiteMaintained: a.anySiteMaintained ?? null,
        maintainedSites: a.maintainedSites ?? null,
        readoutAgrees: !!ro && ro.status === "complete" && (ro.renew ?? null) === (a.renew ?? null) && (ro.bothSitesPersist ?? null) === (a.bothSitesPersist ?? null) && (ro.anySiteMaintained ?? null) === (a.anySiteMaintained ?? null),
      },
      coverage: {
        sourceAudit: "independent audit of every case (its own code, not the production readout): identities at every census, checkpoints, result hashes",
        sourceReplays: replayed.get(c.id) ?? [],
        discoveryReplayed: false,
      },
    });
  }
  if (cases.some((c) => !c.outcome.readoutAgrees)) throw new Error("import: the renewal readout and its audit disagree on a case");
  const body = {
    schemaVersion: IMPORT_SCHEMA,
    class: IMPORTED_CLASS,
    source: {
      protocol: manifest.protocolId,
      plan: manifest.plan,
      protocolSha256: frozen.protocolSha256,
      manifestSha256,
      sourceDigest: frozen.sourceDigest,
      constructionRevision: manifest.provenance.jjRevision,
      pin: { name: RENEWAL_PIN.name, sourceDigest: RENEWAL_PIN.sourceDigest },
      sourcesSha256: frozen.sourcesSha256,
      freezeContextSha256: manifest.freezeContextSha256,
    },
    replayCoverage: { designated: sourceProtocol.verification, artifacts: replayArtifacts },
    audit: { path: auditPath, sha256: auditSha256, version: audit.auditVersion, status: audit.status },
    readout: { path: "readout/pilot-readout.json", sha256: await fileSha(readoutPath), version: readout.readoutVersion, selection: readout.selection },
    confirmation: confirmationFrozen ? "frozen in the source root" : readout.selection.status === "none-eligible" ? "absent: not earned under the source protocol" : "absent",
    policy: "Imported evidence: accepted by exact identity under its own frozen protocol and audit. Never counted or labelled as replayed under the discovery policy (every-case-cross-host).",
    cases,
  };
  return { ...body, importDigest: await digestOf(body) };
}

/** Re-derives the record from the renewal root and requires byte equality with the stored one. */
export async function verifyImport(record: Any, renewalRoot: string): Promise<string[]> {
  const errs: string[] = [];
  let fresh: Any;
  try {
    fresh = await importRenewal(renewalRoot);
  } catch (e) {
    return [(e as Error).message];
  }
  if (canonicalJSON(fresh) !== canonicalJSON(record)) errs.push("the stored import differs from the renewal root's artifacts");
  const { importDigest, ...body } = record;
  if ((await digestOf(body)) !== importDigest) errs.push("the import digest does not match its body");
  if (record.cases?.some((c: Any) => c.class !== IMPORTED_CLASS || c.coverage?.discoveryReplayed !== false)) errs.push("an imported case is labelled as discovery-replayed or with another class");
  return errs;
}

export function importMarkdown(rec: Any): string {
  const lines = [
    `# Imported evidence: ${rec.source.protocol}`,
    "",
    `Class **${rec.class}**: accepted by exact identity under its own frozen protocol (protocol \`${rec.source.protocolSha256}\`, manifest \`${rec.source.manifestSha256}\`, source \`${rec.source.sourceDigest}\`, the workbench's pin). Audit \`${rec.audit.sha256}\` (${rec.audit.status}); readout \`${rec.readout.sha256}\`, selection **${rec.readout.selection.status}**; confirmation ${rec.confirmation}. Import digest \`${rec.importDigest}\`.`,
    "",
    "No case below was replayed under the discovery policy. Source replays are the renewal protocol's own predesignated CPU and native GPU replays.",
    "",
    "| Case | Class | Outcome | Extinct | Source replays |",
    "|---|---|---|---|---|",
    ...rec.cases.map((c: Any) => {
      const o = c.outcome;
      const outcome = o.renew !== null ? `RENEW ${o.renew}` : o.bothSitesPersist !== null ? `both sites persist ${o.bothSitesPersist}` : `a site maintained ${o.anySiteMaintained}`;
      return `| ${c.id} | ${c.class} | ${outcome} | ${o.extinct} | ${c.coverage.sourceReplays.join(", ") || "none (audit only)"} |`;
    }),
    "",
  ];
  return lines.join("\n");
}
