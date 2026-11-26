// Exercises the post-run check path of power.ts (powerProblems, checkPower, replayCheck, verdict recomputation, manifest binding)
// on a reduced panel (N = 4, one edit per family) with a synthetic freeze in a temp dir. Run under Deno; exits non-zero on any failure.
// Not part of the experiment: it writes nothing under docs/. It uses its own draw salt and excludes every edit of the real panel, so it must not assay any edit of the real panel.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verdictFromPayload, type Payload } from "@bl/lineage";
import { REPO, canonical, makeManifest, serialize, sha256 } from "./matrix.ts";
import { EXTRA_SOURCES, checkPower, manifestProblems, generate, planFreeze, powerProblems, readFreeze, replayCheck, sealFreeze } from "./power.ts";

const must = (ok: boolean, what: string): void => { if (!ok) { console.error(`FAILED: ${what}`); process.exit(1); } };
const same = (a: unknown, b: unknown, what: string): void => must(canonical(a) === canonical(b), `${what}: ${canonical(a)} != ${canonical(b)}`);

const dir = mkdtempSync(join(tmpdir(), "locp-red-"));
const fpath = join(dir, "freeze.json"), ev = join(dir, "evidence.json"), mf = join(dir, "manifest.json");
const realFreeze = readFreeze();
// Edits of the real panel are excluded from the reduced draw, so the harness never assays one (a different salt alone can redraw the same genome).
const realChosen: Record<string, string[]> = Object.fromEntries(realFreeze.plans.map((p) => [p.id, p.chosen.map(([, h]) => h)]));
const f = sealFreeze(planFreeze(realFreeze.calibration, 4, undefined, { salt: 0x7e57, seeds: realFreeze.panel.seeds, extraExclude: realChosen }));
writeFileSync(fpath, serialize(f));
const payload = generate(f, undefined, fpath);
const text = serialize(payload);
writeFileSync(ev, text);
writeFileSync(mf, serialize(makeManifest(payload, text, 0, EXTRA_SOURCES, { freezeSha256: sha256(readFileSync(fpath)), n: f.n, workers: { requested: 1, used: 1, note: "serial" } })));

must(f.n === 4, "reduced N is 4");
const realSet = new Set(Object.values(realChosen).flat());
must(f.panel.nb.salt !== realFreeze.panel.nb.salt, "reduced panel uses its own draw salt");
must(payload.rows.filter((r) => r.assay).every((r) => !realSet.has(r.hash)), "no reduced assay is an edit of the real panel");
for (const id of ["m3-c4", "m3-c9"]) must(payload.rows.filter((r) => r.genome === id && r.assay).length === 4, `${id} assays 4 edits (got ${payload.rows.filter((r) => r.genome === id && r.assay).length}; plan ${JSON.stringify(f.plans.find((p) => p.id === id)!.allocation)})`);
same(powerProblems(payload, f, undefined, fpath, realChosen), [], "powerProblems on a fresh reduced payload");
same(checkPower(ev, mf, REPO, fpath, realChosen), [], "checkPower on a fresh reduced payload");
same(verdictFromPayload(payload), payload.verdict, "verdict recomputation");
must(payload.freezeSha256 === sha256(readFileSync(fpath)), "payload binds the freeze");

const edit = (fn: (p: Payload) => void): string[] => { const q: Payload = JSON.parse(JSON.stringify(payload)); fn(q); return powerProblems(q, f, undefined, fpath, realChosen); };
must(edit((q) => { const r = q.rows.find((x) => x.genome === "m3-c4" && x.assay)!; r.assay = null; r.assayed = false; }).some((x) => x.includes("assayed")), "dropping an assayed row is named");
must(edit((q) => { (q.panel as unknown as { seeds: number[] }).seeds = [1, 2]; }).some((x) => x.includes("panel differs")), "changed panel seeds are named");
must(edit((q) => { q.freezeSha256 = "0".repeat(64); }).some((x) => x.includes("freezeSha256")), "freeze binding is checked");
must(edit((q) => { q.panel!.exclude["m3-c4"] = []; }).length > 0, "an emptied exclusion list is caught");
const mfObj = JSON.parse(readFileSync(mf, "utf8"));
must(manifestProblems({ ...mfObj, freezeSha256: undefined }, f, fpath).length > 0, "deleted manifest freezeSha256 is caught");
must(manifestProblems({ ...mfObj, n: 123456 }, f, fpath).length > 0, "wrong manifest n is caught");
must(manifestProblems({ ...mfObj, workers: { requested: 0, used: 2 } }, f, fpath).length > 0, "invalid worker metadata is caught");
must(manifestProblems({ ...mfObj, workers: undefined }, f, fpath).length > 0, "missing worker metadata is caught");
same(checkPower(ev, mf, REPO, join(dir, "nope.json")), ["freeze.json is missing"], "missing freeze");

same(replayCheck(fpath, ev), [], "replay of the reduced payload");
const bad = join(dir, "evidence-bad.json");
writeFileSync(bad, text.replace(/\s*$/, " \n"));
same(replayCheck(fpath, bad), ["regenerated payload differs from evidence.json"], "replay of an altered file");
console.log("--reduced ok");
