#!/usr/bin/env python3
"""Independent re-derivation of the mycelium bootstrap screen (EXPLORATION), Skeptic pass.

Run from anywhere:  python3 -I docs/mycelium-bootstrap-2026-11-14/rederive.py > docs/mycelium-bootstrap-2026-11-14/rederive-report.txt

Reads only: runs/mycelium-bootstrap/{sizing,main,r7}/runs/*.json (snaps, stored series, branch snaps, config), the .claim files,
docs/mycelium-bootstrap-2026-11-14/run-log.jsonl, docs/mycelium-*/run-log.jsonl of earlier lines, SCREEN.md (to compare printed numbers),
sizing-frozen.json. No Deno table code is used: windowSide, rates, noise floor, judge, vote and the F classes are re-written here from DESIGN.md
sections 9 and 10. Pure standard library. Exit code 0 always; discrepancies are collected and printed at the end.
"""
import glob, json, math, os, re, sys, collections

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
RUNS = os.path.join(ROOT, "runs", "mycelium-bootstrap")
DISC = []          # discrepancies (things that do not match SCREEN.md or the design)
WEAK = []          # places the reading is weaker than the headline


def P(*a):
    print(*a)


def disc(s):
    DISC.append(s)
    P("  DISCREPANCY:", s)


def weak(s):
    WEAK.append(s)
    P("  WEAK:", s)


def med(a):
    a = sorted(x for x in a if x is not None)
    if not a:
        return None
    n = len(a)
    return a[n // 2] if n % 2 else (a[n // 2 - 1] + a[n // 2]) / 2


def mean(a):
    a = [x for x in a if x is not None]
    return sum(a) / len(a) if a else None


def pc(v, d=1):
    return "-" if v is None else f"{100 * v:+.{d}f}%"


def fm(v, d=3):
    return "-" if v is None else f"{v:.{d}f}"


# ------------------------------------------------------------------------------------------------ load
def load_all():
    runs = {}
    files = {}
    for d in ("sizing", "main", "r7"):
        for p in sorted(glob.glob(os.path.join(RUNS, d, "runs", "*.json"))):
            with open(p) as f:
                j = json.load(f)
            runs[(d, j["id"])] = j
            files[(d, j["id"])] = p
    return runs, files


RUNS_ALL, FILES = load_all()
LOG = [json.loads(l) for l in open(os.path.join(HERE, "run-log.jsonl")) if l.strip()]

HOFF = {"inherit": 0, "blocked": 200, "physarum": 400, "blind": 600}
BASE = 8209
BLOCKS = [("S", 8), ("T", 16), ("D", 16), ("F", 16), ("O", 16), ("SMOKE", 4)]
SER_START = {}
t = BASE
for name, size in BLOCKS:
    SER_START[name] = (t, size)
    t += size
SCREEN_SLOTS = {k: list(range(v[0], v[0] + (8 if k != "SMOKE" else 4))) for k, v in SER_START.items()}
HELD_SLOTS = {k: list(range(v[0] + 8, v[0] + v[1])) for k, v in SER_START.items() if k not in ("S", "SMOKE")}

main = {k[1]: v for k, v in RUNS_ALL.items() if k[0] == "main"}
sizing = {k[1]: v for k, v in RUNS_ALL.items() if k[0] == "sizing"}
r7 = {k[1]: v for k, v in RUNS_ALL.items() if k[0] == "r7"}


def get(series, arm, her, slot):
    return main.get(f"{series}.{arm}.{her}.{slot}")


# ------------------------------------------------------------------------------------------------ stats helpers (DESIGN 9.1)
THR = 0.03
NFU = 0.10


def intake_between(a, b, eA):
    dl = b["lightIn"] - a["lightIn"]
    assert dl % eA == 0, (a["step"], b["step"], dl)
    return a["sumA"] + dl // eA - b["sumA"]


def window(snaps, lo, hi, eA):
    steps = [s["step"] for s in snaps]
    if lo not in steps or hi not in steps:
        return None
    i0, i1 = steps.index(lo), steps.index(hi)
    if i1 <= i0:
        return None
    nsum = 0.0
    for k in range(i0, i1):
        nsum += (snaps[k]["n"] + snaps[k + 1]["n"]) / 2 * (snaps[k + 1]["step"] - snaps[k]["step"])
    a, b = snaps[i0], snaps[i1]
    w = dict(lo=lo, hi=hi, births=b["births"] - a["births"], deaths=b["deaths"] - a["deaths"], nsum=nsum, intake=intake_between(a, b, eA),
             n0=a["n"], n1=b["n"], light=(b["lightIn"] - a["lightIn"]) // eA)
    if "free" in a and "free" in b:
        w["free"] = b["free"] - a["free"]
        w["paid"] = b["paid"] - a["paid"]
    return w


def rates(w):
    den = max(w["nsum"], 1e-12)
    return dict(b=w["births"] / den, d=w["deaths"] / den, i=w["intake"] / den, N=w["nsum"] / (w["hi"] - w["lo"]))


def rel(a, b):
    if b == 0:
        return 0.0 if a == 0 else None
    return (a - b) / b


def rels(on, comp):
    a, c = rates(on), rates(comp)
    return dict(i=rel(a["i"], c["i"]), N=rel(a["N"], c["N"]), d=rel(a["d"], c["d"]), b=rel(a["b"], c["b"]), bd=rel(a["b"] + a["d"], c["b"] + c["d"]))


def noise_floor(pairs):
    out = {}
    for k in ("i", "N", "d", "b", "bd"):
        m = 0.0
        bad = False
        for p in pairs:
            if p[k] is None:
                bad = True
                break
            m = max(m, abs(p[k]))
        out[k] = None if bad or not pairs else m
    return out


def judge(r, nf):
    nfi = nf["i"]
    thr = None if nfi is None else max(THR, 2 * nfi)
    why = None
    if thr is None:
        why = "nf_i undefined"
    elif thr > NFU:
        why = f"thr_i {thr:.3f} > 0.10"
    else:
        for k in ("N", "d", "b"):
            if nf[k] is None or nf[k] > NFU:
                why = f"safeguard noise {k}"
                break
    if not why and any(r[k] is None for k in ("i", "N", "d", "b", "bd")):
        why = "undefined rel"
    if why:
        return dict(pay=None, damp=None, harm=None, thr=thr, why=why)
    pay = r["i"] >= thr and r["N"] >= -THR and r["d"] <= THR and r["b"] >= -THR
    return dict(pay=pay, damp=(r["bd"] <= -THR and not (r["i"] >= thr)), harm=(r["N"] <= -THR), thr=thr, why=None)


def vote(seeds):
    n = len(seeds)
    k = math.ceil(0.75 * n)
    if sum(1 for x in seeds if x is True) >= k:
        return "Y"
    if sum(1 for x in seeds if x is False) >= k:
        return "N"
    return "I"


def pair_set(on, off, bf, lo, hi):
    """on, off, bf: dict slot -> run. Returns per-slot rels, nf, verdicts (nf from bf vs off, DESIGN 9.1 T)."""
    slots = sorted(s for s in on if s in off)
    rr = []
    for s in slots:
        a = window(on[s]["snaps"], lo, hi, on[s]["config"]["eA"])
        b = window(off[s]["snaps"], lo, hi, off[s]["config"]["eA"])
        rr.append(rels(a, b) if a and b else None)
    nf = None
    if bf:
        bfr = []
        for s in slots:
            if s in bf:
                a = window(bf[s]["snaps"], lo, hi, bf[s]["config"]["eA"])
                b = window(off[s]["snaps"], lo, hi, off[s]["config"]["eA"])
                if a and b:
                    bfr.append(rels(a, b))
        if len(bfr) == len(slots):
            nf = noise_floor(bfr)
    ver = [judge(r, nf) if (r and nf) else None for r in rr]
    return dict(slots=slots, rels=rr, nf=nf, ver=ver)


def arm_map(series, arm, her="inherit"):
    return {r["slot"]: r for r in main.values() if r["series"] == series and r["armId"] == arm and r["heredity"] == her and not r.get("smoke")}


def parse_md_table(lines, header_start):
    out = []
    on = False
    for l in lines:
        if l.startswith(header_start):
            on = True
            continue
        if on:
            if l.startswith("|---"):
                continue
            if not l.startswith("|"):
                break
            out.append([c.strip() for c in l.strip().strip("|").split("|")])
    return out


SCREEN_LINES = open(os.path.join(HERE, "SCREEN.md")).read().split("\n")

# ================================================================================================ 1. INTEGRITY
P("=" * 100)
P("1. FILES, LOG, LEDGERS, LENGTHS, SEEDS, CONFIGS")
P("=" * 100)

# 1.1 counts
cnt = {d: len(glob.glob(os.path.join(RUNS, d, "runs", "*.json"))) for d in ("sizing", "main", "r7")}
cl = {d: len(glob.glob(os.path.join(RUNS, d, "runs", "*.claim"))) for d in ("sizing", "main", "r7")}
P(f"1.1 json files {cnt} (total {sum(cnt.values())}), claim files {cl} (total {sum(cl.values())})   [SCREEN: 582 = sizing 114, main 464, R7 4]")
if (cnt["sizing"], cnt["main"], cnt["r7"]) != (114, 464, 4):
    disc(f"run file counts {cnt} differ from SCREEN (114/464/4)")
for d in cnt:
    js = {os.path.basename(p)[:-5] for p in glob.glob(os.path.join(RUNS, d, "runs", "*.json"))}
    cs = {os.path.basename(p)[:-6] for p in glob.glob(os.path.join(RUNS, d, "runs", "*.claim"))}
    if js != cs:
        disc(f"{d}: json without claim {sorted(js - cs)[:3]}, claim without json {sorted(cs - js)[:3]}")
P(f"1.1 log lines {len(LOG)}")
outs = collections.Counter(x["out"] for x in LOG)
P("    log lines per out dir:", dict(outs))
missing_dirs = sorted(o for o in outs if not os.path.isdir(os.path.join(ROOT, o)))
P(f"    out dirs named in the log that do not exist on disk ({len(missing_dirs)}): {[os.path.basename(m) for m in missing_dirs]}")
P("    -> the 1,738-line log holds 1,156 lines of smoke, stand-in and aborted-sizing runs that have no run file; only main/sizing/r7 lines are matched to files.")

real_outs = {"runs/mycelium-bootstrap/main", "runs/mycelium-bootstrap/sizing", "runs/mycelium-bootstrap/r7"}
real = [x for x in LOG if x["out"] in real_outs]
P(f"1.2 log lines in the three real out dirs: {len(real)} (started {sum(1 for x in real if x['state']=='started')}, finished {sum(1 for x in real if x['state']=='finished')}, other {sum(1 for x in real if x['state'] not in ('started','finished'))})")
c_state = collections.Counter((x["out"], x["id"], x["state"]) for x in real)
dups = [k for k, v in c_state.items() if v > 1]
P(f"    duplicate (out,id,state) lines: {len(dups)}")
if dups:
    disc(f"duplicate log lines {dups[:5]}")
started = {(x["out"], x["id"]) for x in real if x["state"] == "started"}
finished = {(x["out"], x["id"]): x for x in real if x["state"] == "finished"}
P(f"    started without finished: {len(started - set(finished))}; finished without started: {len(set(finished) - started)}")
file_keys = {("runs/mycelium-bootstrap/" + d, i) for (d, i) in RUNS_ALL}
P(f"    run files without a finished line (orphan files): {len(file_keys - set(finished))}; finished lines without a run file: {len(set(finished) - file_keys)}")
if file_keys != set(finished):
    disc("run files and finished log lines do not match one to one")
bad_log = [x for x in finished.values() if x.get("ledgerBadChecks") or x.get("branchErrors") or not str(x.get("intakeIdentity", "")).startswith("exact")]
P(f"    finished lines with ledgerBadChecks, branchErrors or intakeIdentity != exact: {len(bad_log)}")
if bad_log:
    disc(f"{len(bad_log)} finished log lines flag residuals / errors")
nonfin = [x for x in real if x["state"] not in ("started", "finished")]
P(f"    failed/other-state lines: {len(nonfin)}")
smoke_in_real = [x for x in real if x.get("smoke")]
P(f"    smoke-flagged lines inside the real out dirs: {len(smoke_in_real)} (R7 timing: {sum(1 for x in smoke_in_real if x['series']=='R7')})")

# per-series counts (non-smoke, finished) vs SCREEN counts table
sc = collections.Counter(x["series"] for x in finished.values() if not x.get("smoke"))
P("    finished non-smoke per series:", dict(sc), " SCREEN: S1 8, S2 40, S2d 40, S3 10, S4 16; T 208, D0 24, F 152 (88+64), O 80; R7 4")
want = {"S1": 8, "S2": 40, "S2d": 40, "S3": 10, "S4": 16, "T": 208, "D0": 24, "F": 152, "O": 80}
for k, v in want.items():
    if sc.get(k) != v:
        disc(f"series {k}: {sc.get(k)} finished, SCREEN says {v}")
r7n = sum(1 for x in finished.values() if x["series"] == "R7")
P(f"    R7 finished lines in r7/: {r7n}")

# 1.3 log summary fields vs JSON
mm = 0
for (o, i), x in finished.items():
    d = o.split("/")[-1]
    j = RUNS_ALL.get((d, i))
    if not j:
        continue
    nvar = sum(len(b["variants"]) for b in j["branches"])
    chk = dict(ledgerChecks=j["ledgerChecks"], ledgerBadChecks=j["ledgerBadChecks"], minN=j["minN"], steps=j["steps"], branchVariants=nvar)
    for k, v in chk.items():
        if x.get(k) != v:
            mm += 1
            disc(f"{i}: log {k}={x.get(k)} vs json {v}")
    rv = j["late"]["runValues"]
    if rv.get("meanN") is not None and x.get("lateN") is not None and abs(rv["meanN"] - x["lateN"]) > 1e-6:
        mm += 1
        disc(f"{i}: log lateN {x['lateN']} vs json late meanN {rv['meanN']}")
    tmv = j["late"]["boot"].get("tm")
    if tmv is not None and x.get("lateTM") is not None and abs(tmv - x["lateTM"]) > 1e-6:
        # lateTM may be the runValues TM instead
        if rv.get("TM") is None or abs(rv["TM"] - x["lateTM"]) > 1e-6:
            mm += 1
            disc(f"{i}: log lateTM {x['lateTM']} matches neither boot.tm {tmv} nor runValues.TM {rv.get('TM')}")
P(f"1.3 log summary fields (ledgerChecks, bad, minN, steps, branchVariants, lateN, lateTM) vs run files: {mm} mismatches")

# 1.4 ledger totals
tot_checks = sum(j["ledgerChecks"] for j in RUNS_ALL.values())
tot_bad = sum(j["ledgerBadChecks"] for j in RUNS_ALL.values())
nvar_all = sum(len(b["variants"]) for j in RUNS_ALL.values() for b in j["branches"])
relax = sum(1 for j in RUNS_ALL.values() for b in j["branches"] for k in b["variants"] if k.startswith("relax-"))
var_bad = sum(v["ledgerBad"] for j in RUNS_ALL.values() for b in j["branches"] for v in b["variants"].values())
var_err = sum(1 for j in RUNS_ALL.values() for b in j["branches"] for v in b["variants"].values() if v.get("error"))
berr = sum(j.get("branchErrors", 0) for j in RUNS_ALL.values())
P(f"1.4 ledger checks (sum of stored ledgerChecks) {tot_checks} [SCREEN 319,179], bad {tot_bad}; branch variants {nvar_all} [SCREEN 872], of which relax-* {relax}; variant ledgerBad sum {var_bad}; variants with error {var_err}; branchErrors sum {berr}")
if tot_checks != 319179:
    disc(f"ledger check total {tot_checks} != 319,179")
if nvar_all != 872:
    disc(f"branch variant total {nvar_all} != 872")
if relax:
    disc(f"{relax} of the 872 branch variants are relax-* (5,000-step relaxation of on, C-off, both-off at the late checkpoint, DESIGN 8); SCREEN reports no relaxation result and branchPairs() skips them")
# per-series check count: reads vs checks
# 1.5 independent conservation from snaps (what the snaps allow): dn = db - dd, intake integer >= 0, lightIn % eA == 0, free/paid monotone, births/deaths monotone
snap_bad = collections.Counter()
nsn = 0
for key, j in RUNS_ALL.items():
    eA = j["config"]["eA"]
    seqs = [("main", j["snaps"])] + [(f"br{b['at']}.{vn}", v["snaps"]) for b in j["branches"] for vn, v in b["variants"].items()]
    for tag, sn in seqs:
        for a, b in zip(sn, sn[1:]):
            nsn += 1
            if (b["n"] - a["n"]) != (b["births"] - a["births"]) - (b["deaths"] - a["deaths"]):
                snap_bad["dn!=db-dd"] += 1
            dl = b["lightIn"] - a["lightIn"]
            if dl % eA or dl < 0:
                snap_bad["lightIn not whole units"] += 1
            else:
                iv = a["sumA"] + dl // eA - b["sumA"]
                if iv < 0:
                    snap_bad["negative intake"] += 1
            if b["births"] < a["births"] or b["deaths"] < a["deaths"]:
                snap_bad["births/deaths decreased"] += 1
            if "free" in a and "free" in b and (b["free"] < a["free"] or b["paid"] < a["paid"]):
                snap_bad["free/paid decreased"] += 1
P(f"1.5 snap-interval identities over {nsn} consecutive-read pairs (main snaps and every branch variant): dn = births-deaths, light in whole units, intake >= 0 integer, counters monotone ->", dict(snap_bad) or "0 violations")
if snap_bad:
    disc(f"snap identities violated: {dict(snap_bad)}")

# 1.6 run lengths and schedules
EXPECT_STEPS = {"S1": 1000, "S2": 1000, "S2d": 1000, "S3": 20000, "S4": 20000, "T": 3000, "D0": 5000, "F": 100000, "O": 100000}
len_bad = []
for (d, i), j in RUNS_ALL.items():
    ser = j["series"]
    exp = EXPECT_STEPS.get(ser)
    if ser == "F" and "anchor" in j["armId"]:
        exp = 40000
    if ser == "O" and "anchor" in j["armId"]:
        exp = 30000
    if ser == "R7":
        exp = {"keyless": 5000, "F-core": 5000, "O-core": 5000, "perstep": 400}[j["armId"]]
    if j["steps"] != exp or j["snaps"][-1]["step"] != j["steps"] or j["snaps"][0]["step"] != 0:
        len_bad.append((i, j["steps"], j["snaps"][-1]["step"], exp))
    for b in j["branches"]:
        if b["len"] != 2000 or b["at"] not in j["branchAt"]:
            len_bad.append((i, "branch", b["at"], b["len"]))
        for vn, v in b["variants"].items():
            if vn.startswith("relax-"):
                continue
            st = [s["step"] for s in v["snaps"]]
            if st != list(range(0, 2001, 25)):
                len_bad.append((i, "branch grid", b["at"], vn))
    if j["branchAt"] and sorted(b["at"] for b in j["branches"]) != sorted(j["branchAt"]):
        len_bad.append((i, "branchAt plan vs done", j["branchAt"], [b["at"] for b in j["branches"]]))
    if j["minN"] != min(s["n"] for s in j["snaps"]):
        pass  # minN comes from the scalar census (every 100 steps), not from all snaps; checked below on the same grid
P(f"1.6 run length / schedule problems (steps, last snap, branch at, branch length 2000, 81-read grid): {len(len_bad)}", len_bad[:5])
if len_bad:
    disc(f"length problems {len_bad[:5]}")
# minN: independent recomputation over reads
minn_bad = []
for (d, i), j in RUNS_ALL.items():
    m = min(s["n"] for s in j["snaps"])
    if j["minN"] > m:
        minn_bad.append((i, j["minN"], m))
P(f"    runs whose stored minN exceeds the minimum n over all stored reads: {len(minn_bad)} {minn_bad[:3]}")
extinct = [(i, j["minN"]) for (d, i), j in RUNS_ALL.items() if j["minN"] < 100]
P(f"    runs with minN < 100: {len(extinct)} {extinct[:5]}; branch variants ending below 100 particles: " +
  str(sum(1 for j in RUNS_ALL.values() for b in j["branches"] for v in b["variants"].values() if v["nEnd"] < 100)))

# 1.7 seeds
seed_bad = []
for (d, i), j in RUNS_ALL.items():
    if j["worldSeed"] != j["slot"] + HOFF[j["heredity"]] or j["config"]["seed"] != j["worldSeed"]:
        seed_bad.append((i, j["slot"], j["heredity"], j["worldSeed"], j["config"]["seed"]))
P(f"1.7 world seed = slot + heredity offset and config.seed = worldSeed: {len(seed_bad)} violations {seed_bad[:3]}")
if seed_bad:
    disc("seed rule violated")
slot_map = {"S1": "S", "S2": "S", "S2d": "S", "S3": "S", "S4": "S", "T": "T", "D0": "D", "F": "F", "O": "O", "R7": "SMOKE"}
blk_bad = []
for (d, i), j in RUNS_ALL.items():
    blk = slot_map[j["series"]]
    if j["slot"] not in SCREEN_SLOTS[blk]:
        blk_bad.append((i, j["slot"], blk))
P(f"    run slot inside the screen block of its series (S 8209-8216, T 8217-8224, D 8233-8240, F 8249-8256, O 8265-8272, SMOKE 8281-8284): {len(blk_bad)} outside {blk_bad[:3]}")
held_used = [i for (d, i), j in RUNS_ALL.items() if any(j["slot"] in h for h in HELD_SLOTS.values())]
P(f"    runs on held slots: {len(held_used)}")
sizing_slots = {j["slot"] for j in sizing.values()}
screen_slots_used = {j["slot"] for j in main.values()}
P(f"    sizing slots {sorted(sizing_slots)}; main slots {sorted(screen_slots_used)[:3]}..{sorted(screen_slots_used)[-3:]} ; overlap between sizing and main slots: {sorted(sizing_slots & screen_slots_used)}")
# smoke lines of the log: did any smoke run use a screen or held slot or its images?
screen_world = set()
for blk in ("T", "D", "F", "O"):
    for s in range(SER_START[blk][0], SER_START[blk][0] + SER_START[blk][1]):
        for h, o in HOFF.items():
            screen_world.add(s + o)
smoke_hits = collections.defaultdict(list)
for x in LOG:
    if x["state"] == "started" and (x.get("smoke") or x["out"] not in real_outs) and x.get("worldSeed") in screen_world:
        smoke_hits[(x["out"].split("/")[-1], x["series"])].append(x["worldSeed"])
nsm = sum(1 for x in LOG if x["state"] == "started" and (x.get("smoke") or x["out"] not in real_outs))
P(f"1.8 smoke / stand-in / out-of-tree 'started' lines: {nsm}; of those on a T/D/F/O screen or held slot or its heredity images: {sum(len(v) for v in smoke_hits.values())}")
for k, v in smoke_hits.items():
    P(f"    {k}: {len(v)} runs, seeds {sorted(set(v))[:12]}")
smoke_slots = collections.Counter((x["series"], x["slot"]) for x in LOG if x["state"] == "started" and x.get("smoke"))
P("    smoke runs by (series, slot):", dict(sorted(smoke_slots.items(), key=str)))
if sum(len(v) for v in smoke_hits.values()):
    weak("screen seeds were run as smoke before sizing/main (see 1.8): the SCREEN says 'This screen used the first 8 slots of each series block; held 8 not used' and sizing 'none enters a table', but smoke runs with logs but no files touched screen worlds; the outputs are not on disk and cannot be checked")

# 1.9 earlier registered sets, rebuilt in python
def rng(a, b):
    return list(range(a, b + 1))


reg = {}
reg["R2b worlds"] = {s + o for o in (0, 10000, 20000, 30000, 40000, 50000) for s in rng(2001, 2020) + rng(5001, 5016)}
reg["R2 seeds"] = set(rng(101, 105) + rng(9001, 9005))
r3off = [60000, 70000, 80000, 90000, 100000, 110000, 120000]
r3arms = ["inherit", "blocked", "frozen", "inherit-c1", "inherit-c4", "blocked-c1", "blocked-c4"]
r3dev = ["frozen", "inherit-c1", "inherit-c4", "blocked-c1", "blocked-c4"]
reg["R3 worlds"] = {s + r3off[r3arms.index(a)] for a in r3dev for s in rng(2001, 2010)} | {s + r3off[r3arms.index(a)] for a in r3arms for s in rng(6001, 6016)}
reg["NOT_R3 8001-8099"] = set(rng(8001, 8099))
r4off = [130000, 140000, 150000, 160000, 170000]
reg["R4 worlds"] = {s + o for o in r4off for s in rng(8001, 8020) + rng(7001, 7016)}
reg["conduit screen worlds"] = {s + o for o in (0, 200, 400, 600) for s in rng(8101, 8108)}
reg["shaping range 200011-240013"] = set(rng(200011, 240013))
for name in sorted(glob.glob(os.path.join(ROOT, "docs", "mycelium-*", "run-log.jsonl"))):
    dn = os.path.basename(os.path.dirname(name))
    if dn.startswith("mycelium-bootstrap"):
        continue
    ws = {json.loads(l)["worldSeed"] for l in open(name) if l.strip() and "worldSeed" in json.loads(l)}
    reg[f"run-log {dn}"] = ws
# other seed mentions inside earlier docs (not rebuilt from TS): R4's header mentions the conduit/screen seeds 8001-8004 and 108001-108004
reg["comment in r4-seeds: 8001-8004, 108001-108004"] = set(rng(8001, 8004) + rng(108001, 108004))
# the bootstrap's own world and derived seeds (all slots in the table, all four heredities, held included)
own_world = set()
own_derived = set()
for blk, (st_, sz) in SER_START.items():
    for s in range(st_, st_ + sz):
        for h, o in HOFF.items():
            w = s + o
            own_world.add(w)
            own_derived.add((w ^ 0x5A5A5A5A) & 0xFFFFFFFF)
            own_derived.add((w ^ 0x3C3C3C3C) & 0xFFFFFFFF)
used_world = {j["worldSeed"] for j in RUNS_ALL.values()}
used_derived = set()
for j in RUNS_ALL.values():
    if j["branches"]:
        used_derived.add((j["worldSeed"] ^ 0x5A5A5A5A) & 0xFFFFFFFF)
        used_derived.add((j["worldSeed"] ^ 0x3C3C3C3C) & 0xFFFFFFFF)
P(f"1.9 world seeds actually used {len(used_world)} (range {min(used_world)}-{max(used_world)}); derived null seeds actually used {len(used_derived)}; whole table: {len(own_world)} world, {len(own_derived)} derived")
hits = 0
for name, st_ in reg.items():
    hw = used_world & st_
    hd = used_derived & st_
    hwa = own_world & st_
    hda = own_derived & st_
    P(f"    vs {name:55s} ({len(st_):6d} seeds): used world {len(hw)}, used derived {len(hd)}; whole table world {len(hwa)}, derived {len(hda)}")
    hits += len(hw) + len(hd) + len(hwa) + len(hda)
if hits:
    disc("collision with an earlier registered set (see 1.9)")
P(f"    derived seed equal to a used world seed: {len(used_derived & own_world)}; derived seeds shared by two rows: {len(used_derived) - len({x for x in used_derived})} (set size {len(used_derived)} vs 2 x {sum(1 for w in used_world if any(j['worldSeed']==w and j['branches'] for j in RUNS_ALL.values()))} branching worlds)")
P("    NOT rebuilt (cannot be, without the other tools' internals): seeds used by runs that never went into a run-log (the shaping scratch range is covered as the stated range 200011-240013); seeds in earlier lines' smoke runs that have no log. Earlier run-logs read: " +
  ", ".join(os.path.basename(os.path.dirname(n)) for n in glob.glob(os.path.join(ROOT, 'docs', 'mycelium-*', 'run-log.jsonl'))))

# 1.10 config deltas against base, expected from DESIGN section 8 plus sizing-frozen.json (hard-coded here, independent of bootstrap-arms.ts)
DEF = dict(rule="mycelium-r0", width=128, height=128, seed=1, maxParticles=8192, founders=1024, founderMatter=32, founderEnergy=512, weightSpan=48, nutrient0=48, eA=4,
           maxEat=16, bodyMax=256, speed=128, upkeep=6, moveCost=2, massUpkeepShift=6, maxDeposit=4, depositCost=2, excreteShift=6, splitEnergy=384, splitMatter=48,
           energyMax=4096, light=1, lightPattern="uniform", pDecay=655, diffA=40, diffC=40, heredity="inherit", mutRate=16384, mutCount=2, mutStep=16, sensorShift=0,
           energyShift=4, massShift=1)
SZ = json.load(open(os.path.join(RUNS, "sizing-frozen.json")))
v, gR, dA, dAF = SZ["v"], SZ["gR"], SZ["diffA"], SZ["diffAF"]
P(f"1.10 sizing-frozen: v={v} gR={gR} diffA={dA} diffAF={dAF} t0={SZ['t0']} tAlive={SZ['tAlive']} Fstar={SZ['Fstar']} Fg={SZ['Fg']} theta={SZ['theta']}")
HER = {"inherit": dict(heredity="inherit"), "blocked": dict(heredity="blocked"), "physarum": dict(heredity="frozen", controller="physarum", physarumDeposit=256),
       "blind": dict(heredity="frozen", controller="physarum", physarumDeposit=256, blindTrailGradient=True)}


def lay(pattern, vv=v):
    o = dict(trailInit=vv, trailInitPattern=pattern)
    if pattern in ("rows", "cols", "lattice"):
        o["trailInitPitch"] = 8
    if pattern == "patches":
        o["trailInitPitch"] = 16
    return o


def plat(q):
    return dict(trailConduit=255, trailConduitCap=q)


TOLL = dict(moveCost=12, trailMoveDiscount=64, trailDiscountMode="toll")
Fg = SZ["Fg"]
th = SZ["theta"]["mid"]
EC = dict(**TOLL, trailOwner="gid", ownerDefend=th, ownerConduit=16)
EXPECT = {}  # (series, arm) -> (light, delta)
for pat, nm in (("carpet", "carpet-U"), ("carpet", "carpet-G"), ("rows", "rows-G"), ("cols", "cols-G")):
    pass
G = "G"
U = "U"
for nm, light, pat in (("carpet-U", U, "carpet"), ("carpet-G", G, "carpet"), ("cols-G", G, "cols")):
    EXPECT[("T", f"{nm}.on-P2")] = (light, {**lay(pat), **plat(2)})
    EXPECT[("T", f"{nm}.off")] = (light, lay(pat))
    EXPECT[("T", f"{nm}.bf")] = (light, lay(pat))
for q in (1, 2, 3):
    EXPECT[("T", f"rows-G.on-P{q}")] = (G, {**lay("rows"), **plat(q)})
EXPECT[("T", "rows-G.on-R")] = (G, {**lay("rows"), "trailConduit": gR})
EXPECT[("T", "rows-G.off")] = (G, lay("rows"))
EXPECT[("T", "rows-G.bf")] = (G, lay("rows"))
EXPECT[("T", "rows-G.diffA")] = (G, {**lay("rows"), "diffA": dA})
for nm, pat in (("lat-G", "lattice"), ("pat-G", "patches")):
    EXPECT[("T", f"{nm}.on-P2")] = (G, {**lay(pat), **plat(2)})
    EXPECT[("T", f"{nm}.off")] = (G, lay(pat))
EXPECT[("T", "rows-U.on-P2")] = (U, {**lay("rows"), **plat(2)})
EXPECT[("T", "rows-U.off")] = (U, lay("rows"))
EXPECT[("T", "phys-rows-G.on-P2")] = (G, {**lay("rows"), **plat(2)})
EXPECT[("T", "phys-rows-G.off")] = (G, lay("rows"))
EXPECT[("T", "base0-U")] = (U, {})
EXPECT[("T", "base0-G")] = (G, {})
D0o = dict(pDecay=66)
EXPECT[("D0", "rows-G.on-P2")] = (G, {**lay("rows"), **D0o, **plat(2)})
EXPECT[("D0", "rows-G.off")] = (G, {**lay("rows"), **D0o})
EXPECT[("D0", "rows-G.bf")] = (G, {**lay("rows"), **D0o})
Fs = SZ["Fstar"]
lowF = max(1, Fs >> 2)
for nm, d_ in (("base", {}), (f"FREE-{Fs}", dict(trailFreeLayer=Fs)), ("COND", dict(trailConduit=Fg["mid"])), (f"T-{Fs}-mid", dict(trailFreeLayer=Fs, trailConduit=Fg["mid"])),
               ("GHOST", dict(trailFreeLayer=Fs, trailConduit=Fg["mid"], trailConduitGhost=64)), ("GHOST-blocked", dict(trailFreeLayer=Fs, trailConduit=Fg["mid"], trailConduitGhost=64)),
               ("DIFF", dict(trailFreeLayer=Fs, diffA=dAF)), (f"anchor-phys-T-{Fs}-mid", dict(trailFreeLayer=Fs, trailConduit=Fg["mid"])),
               (f"anchor-blind-T-{Fs}-mid", dict(trailFreeLayer=Fs, trailConduit=Fg["mid"])), (f"FREE-{lowF}", dict(trailFreeLayer=lowF)),
               (f"T-{lowF}-mid", dict(trailFreeLayer=lowF, trailConduit=Fg["mid"])), (f"T-{Fs}-lo", dict(trailFreeLayer=Fs, trailConduit=Fg["lo"])),
               (f"T-{Fs}-hi", dict(trailFreeLayer=Fs, trailConduit=Fg["hi"])), ("toll-base", dict(TOLL)), ("toll-C", dict(**TOLL, trailConduit=Fg["mid"])),
               ("toll-FC", dict(**TOLL, trailFreeLayer=Fs, trailConduit=Fg["mid"]))):
    EXPECT[("F", nm)] = (U, d_)
OSTAND = dict(theta=4, gOwner=16, gCpub=8)  # SCREEN deviation 6: stand-ins (theta 4 is the measured R6 mid)
own = lambda **k: dict(**TOLL, trailOwner="gid", **k)
for nm, d_ in (("T-P", own()), ("T-E", own(ownerDefend=4)), ("T-C", own(ownerConduit=16)), ("T-EC", own(ownerDefend=4, ownerConduit=16)),
               ("T-EC-ghost", {**own(ownerDefend=4, ownerConduit=16), "ownerGhost": 64}), ("T-C-pub", own(ownerDefend=4, trailConduit=8)), ("T-base", dict(TOLL)),
               ("N-base", {}), ("anchor-phys-EC", own(ownerDefend=4, ownerConduit=16)), ("anchor-blind-EC", own(ownerDefend=4, ownerConduit=16))):
    EXPECT[("O", nm)] = (U, d_)
mis = []
over_mis = []
cfg_unexpected_keys = collections.Counter()
for (d, i), j in RUNS_ALL.items():
    if d != "main":
        continue
    key = (j["series"], j["armId"])
    if key not in EXPECT:
        mis.append((i, "no expectation"))
        continue
    light, delta = EXPECT[key]
    exp = dict(DEF)
    exp.update(delta)
    if light == "G":
        exp["lightPattern"] = "gradient"
    exp.update(HER[j["heredity"]])
    exp["seed"] = j["worldSeed"]
    if json.dumps(exp, sort_keys=True) != json.dumps(j["config"], sort_keys=True):
        diffk = {k: (exp.get(k), j["config"].get(k)) for k in set(exp) | set(j["config"]) if exp.get(k) != j["config"].get(k)}
        mis.append((i, diffk))
    # the log's own `over` claim vs my delta (+ light + heredity), separately
    st_line = next((x for x in LOG if x["id"] == i and x["out"].endswith("/main") and x["state"] == "started"), None)
    if st_line:
        eo = dict(delta)
        if json.dumps(st_line["over"], sort_keys=True) != json.dumps(eo, sort_keys=True):
            over_mis.append((i, st_line["over"], eo))
P(f"1.10 stored config == default + my expected delta + light + heredity + seed, over {sum(1 for (d,_) in RUNS_ALL if d=='main')} main runs: {len(mis)} mismatches")
for m in mis[:10]:
    P("    ", m)
if mis:
    disc(f"{len(mis)} config mismatches vs expected arm definition")
P(f"     the log's own `over` field vs my expected delta: {len(over_mis)} mismatches")
for m in over_mis[:6]:
    P("    ", m)
# delta keys against the keyless base of the same heredity/slot: only the arm's keys differ
delta_bad = 0
for (d, i), j in RUNS_ALL.items():
    if d != "main" or j["series"] not in ("F", "O"):
        continue
    bs = get(j["series"], "base" if j["series"] == "F" else "N-base", j["heredity"] if j["series"] == "F" else "inherit", j["slot"])
    if bs is None:
        continue
    dk = {k for k in set(j["config"]) | set(bs["config"]) if j["config"].get(k) != bs["config"].get(k)}
    ek = set(EXPECT[(j["series"], j["armId"])][1])
    if j["heredity"] in ("physarum", "blind"):
        continue
    if dk != ek:
        delta_bad += 1
        P(f"    delta keys vs base differ for {i}: {sorted(dk)} vs expected {sorted(ek)}")
P(f"     config keys that differ from the keyless base of the same slot equal the arm's delta keys exactly: {delta_bad} exceptions (inherit/blocked F and O arms)")
# keys that exist in configs but not in defaultConfig, for base arms: none expected
extra_base = [i for (d, i), j in RUNS_ALL.items() if d == "main" and j["armId"] in ("base", "N-base", "rows-G.off", "base0-U", "base0-G") and set(j["config"]) - set(DEF) - {"trailInit", "trailInitPattern", "trailInitPitch"}]
P(f"     keyless / off arms carrying a key outside defaultConfig (besides the road): {len(extra_base)}")

# 1.11 duplicate worlds
def snaps_equal(a, b):
    return a["snaps"] == b["snaps"]


P("1.11 'same world' pairs (identical config up to inert keys) must have byte-equal reads:")
for (s1, a1, h1, s2, a2, h2) in (("F", "T-16-lo", "inherit", "F", "T-16-mid", "inherit"), ("F", "DIFF", "inherit", "F", "FREE-16", "inherit"), ("O", "T-P", "inherit", "O", "T-base", "inherit")):
    eq = 0
    n = 0
    for s in SCREEN_SLOTS["F" if s1 == "F" else "O"]:
        x, y = get(s1, a1, h1, s), get(s2, a2, h2, s)
        if x and y:
            n += 1
            eq += snaps_equal(x, y)
    P(f"     {a1} vs {a2}: {eq} of {n} slots have identical snaps (full read sequence)")
    if eq != n:
        disc(f"{a1} vs {a2}: only {eq}/{n} slots identical: GPU nondeterminism or the arms are not the same world")
# branch variants of the duplicates (FREE-16 inherit has no branches, DIFF none): skip
# 1.12 stored late values vs recomputed from reads
lt = []
for (d, i), j in RUNS_ALL.items():
    if d != "main" or j["series"] not in ("F", "O"):
        continue
    bs = j["bootSeries"]
    half = j["steps"] / 2
    idx = [k for k, s in enumerate(bs["step"]) if half < s <= j["steps"]]
    m = mean([bs["cols"]["tm"][k] for k in idx])
    sv = j["late"]["boot"]["tm"]
    if m is None or sv is None or abs(m - sv) > 1e-6:
        lt.append((i, m, sv))
P(f"1.12 stored late.boot.tm vs mean of bootSeries.tm over (steps/2, steps]: {len(lt)} mismatches {lt[:3]}")
if lt:
    disc("late.boot.tm is not the second-half mean of bootSeries.tm")


# ================================================================================================ 2. SERIES T
P()
P("=" * 100)
P("2. SERIES T (pre-laid trail), recomputed from reads; compared with the SCREEN pair table")
P("=" * 100)
T0 = SZ["t0"]
TALIVE = SZ["tAlive"]
P(f"2.1 primary windows PW(q) = (t0={T0}, min(t_alive(q), 1000)]: t_alive {TALIVE} -> lengths " + ", ".join(f"q{q}: {max(0, min(TALIVE[str(q)], 1000) - T0)}" for q in (1, 2, 3)) + "; threshold 150 steps -> UNREADABLE for every q (label rule 1)")
# what the roadSeries says about t_alive in the *main* runs (median laid-edge x_e per read), on rows-G off runs (keyless road)
road_alive = {}
for q in (1, 2, 3):
    per_seed = []
    for slot, r in arm_map("T", "rows-G.off").items():
        rs = r.get("roadSeries")
        if not rs:
            continue
        last = None
        for k, stp in enumerate(rs["step"]):
            xm = rs["cols"]["xMed"][k]
            if xm is not None and xm >= q:
                last = stp
        per_seed.append(last)
    road_alive[q] = per_seed
    P(f"    rows-G.off main runs, last read with median laid-edge x_e >= {q}, per seed: {per_seed}  median {med([x for x in per_seed if x is not None])}")
xm_at = {}
for st_ in (10, 100, 200, 276, 300, 350, 400):
    vals = []
    for slot, r in arm_map("T", "rows-G.on-P2").items():
        rs = r["roadSeries"]
        if st_ in rs["step"]:
            vals.append(rs["cols"]["xMed"][rs["step"].index(st_)])
    xm_at[st_] = med(vals)
P("    rows-G.on-P2 (conduit on) median laid-edge x_e by step (median over seeds):", xm_at)

W = [(0, 300), (300, 1000), (1000, 3000)]
T_PAIRS = [("rows-G.on-P1 vs rows-G.off", "rows-G.on-P1", "rows-G.off", "rows-G.bf", "inherit"),
           ("rows-G vs rows-G.off", "rows-G.on-P2", "rows-G.off", "rows-G.bf", "inherit"),
           ("rows-G.on-P3 vs rows-G.off", "rows-G.on-P3", "rows-G.off", "rows-G.bf", "inherit"),
           ("rows-G.on-R vs rows-G.off", "rows-G.on-R", "rows-G.off", "rows-G.bf", "inherit"),
           ("rows-G.diffA vs rows-G.off", "rows-G.diffA", "rows-G.off", "rows-G.bf", "inherit"),
           ("carpet-U vs carpet-U.off", "carpet-U.on-P2", "carpet-U.off", "carpet-U.bf", "inherit"),
           ("carpet-G vs carpet-G.off", "carpet-G.on-P2", "carpet-G.off", "carpet-G.bf", "inherit"),
           ("cols-G vs cols-G.off", "cols-G.on-P2", "cols-G.off", "cols-G.bf", "inherit"),
           ("lat-G vs lat-G.off", "lat-G.on-P2", "lat-G.off", None, "inherit"),
           ("pat-G vs pat-G.off", "pat-G.on-P2", "pat-G.off", None, "inherit"),
           ("rows-U vs rows-U.off", "rows-U.on-P2", "rows-U.off", None, "inherit"),
           ("phys-rows-G vs phys-rows-G.off", "phys-rows-G.on-P2", "phys-rows-G.off", None, "physarum")]
SC_T = {(r[0], r[1]): r for r in parse_md_table(SCREEN_LINES, "| pair | window |")}
TRES = {}
mism_T = 0
nrows_T = 0
P(f"2.2 pair table (medians over 8 seeds of on-minus-off relative differences, per-seed PAY/DAMP/HARM counts), recomputed; '=' means the SCREEN row matches to the printed digit")
for label, on_, off_, bf_, her in T_PAIRS:
    on, off = arm_map("T", on_, her), arm_map("T", off_, her)
    bf = arm_map("T", bf_, her) if bf_ else None
    for (lo, hi) in W:
        ps = pair_set(on, off, bf, lo, hi)
        TRES[(label, lo, hi)] = ps
        rr = [r for r in ps["rels"] if r]
        row = [len(ps["slots"]), med([r["i"] for r in rr]), med([r["b"] for r in rr]), med([r["d"] for r in rr]), med([r["N"] for r in rr])]
        f1 = lambda v: "-" if v is None else f"{100 * v:.1f}%"
        nfi = f1(ps["nf"]["i"]) if ps["nf"] else "-"
        if ps["nf"]:
            cnts = [sum(1 for v_ in ps["ver"] if v_ and v_[k]) for k in ("pay", "damp", "harm")]
            unres = sum(1 for v_ in ps["ver"] if v_ is None or v_["pay"] is None)
            mine = [str(row[0]), f1(row[1]), f1(row[2]), f1(row[3]), f1(row[4]), nfi, f"{cnts[0]}/8", f"{cnts[1]}/8", f"{cnts[2]}/8", str(unres)]
        else:
            mine = [str(row[0]), f1(row[1]), f1(row[2]), f1(row[3]), f1(row[4]), "-", "-", "-", "-", "-"]
        sc_row = SC_T.get((label, f"({lo},{hi}]"))
        nrows_T += 1
        if sc_row is None:
            disc(f"T row missing in SCREEN: {label} ({lo},{hi}]")
            continue
        theirs = sc_row[2:]
        ok = mine == theirs
        if not ok:
            mism_T += 1
            disc(f"T row differs: {label} ({lo},{hi}] mine {mine} SCREEN {theirs}")
        P(f"    {'=' if ok else '!'} {label:34s} ({lo:4d},{hi:4d}] {' | '.join(mine)}")
P(f"    T pair rows: {nrows_T}, differing from SCREEN: {mism_T}")

# 2.3 what the T series actually measured: did the conduit operate where it was read? (meanDd2 is the mean Dd over directed edges at plateau q=2)
P("2.3 mechanism check in T: rows-G.on-P2, mean Dd over all directed edges at q=2 vs diffA 40 (conduit adds Dd = min(ext, ...) on laid edges), median over seeds")
for st_ in (10, 100, 200, 300, 400, 1000, 3000):
    vals, xf, onl = [], [], []
    for slot, r in arm_map("T", "rows-G.on-P2").items():
        rs = r["roadSeries"]
        if st_ in rs["step"]:
            k = rs["step"].index(st_)
            vals.append(rs["cols"]["meanDd2"][k])
            xf.append(rs["cols"]["xflux"][k])
            onl.append(rs["cols"]["onLaid"][k])
    P(f"    step {st_:5d}: median meanDd2 {fm(med(vals),2)}  (diffA 40; twin diffA 44), median xflux {fm(med(xf),2)}, median share of particles on laid cells {fm(med(onl),3)} (laid-area share of a pitch-8 rows road: 0.125)")
# W1 is a founder die-off transient: population at 0, 100, 300, 400 for on/off
P("    founder die-off in T rows-G.off: median n by step", {t_: med([r['snaps'][[s['step'] for s in r['snaps']].index(t_)]['n'] for r in arm_map('T', 'rows-G.off').values()]) for t_ in (0, 100, 200, 300, 400, 1000, 3000)})
P("    n over time is not flat until after t0 = 400 (SCREEN deviation 1: R1 found no settle in uniform light by step 400, gradient settles at 300)")

# 2.4 PAY in the unevaluated pairs (no butterfly twin => no noise floor => no verdict): apply the 3 percent floor + safeguards using rows-G's nf as a stand-in
P("2.4 pairs with no butterfly twin (lat-G, pat-G, rows-U, phys-rows-G) have no noise floor and no verdict in the SCREEN table ('-'); re-applying judge() with the rows-G butterfly noise floor of the same window as a stand-in:")
for label in ("lat-G vs lat-G.off", "pat-G vs pat-G.off", "rows-U vs rows-U.off", "phys-rows-G vs phys-rows-G.off"):
    for (lo, hi) in W:
        ps = TRES[(label, lo, hi)]
        nf_rows = TRES[("rows-G vs rows-G.off", lo, hi)]["nf"]
        vv = [judge(r, nf_rows) if r else None for r in ps["rels"]]
        pays = sum(1 for x in vv if x and x["pay"])
        ri = [r["i"] for r in ps["rels"] if r]
        P(f"    {label:32s} ({lo:4d},{hi:4d}] per-seed rel_i max {pc(max(ri))} min {pc(min(ri))}; PAY under rows-G nf: {pays}/8 (thr_i {fm(vv[0]['thr'] if vv[0] else None)})")
        if pays:
            disc(f"{label} ({lo},{hi}] would PAY in {pays} seeds under the rows-G noise floor")
w_cols = TRES[("cols-G vs cols-G.off", 1000, 3000)]
P(f"    cols-G (1000,3000]: nf_i {pc(w_cols['nf']['i'])}, thr_i {fm(max(THR, 2*w_cols['nf']['i']))} > 0.10 -> all 8 seeds unresolved (counted 'not passing'); its per-seed rel_i max is {pc(max(r['i'] for r in w_cols['rels']))}")
weak("SCREEN says 0 of 8 seeds pass PAY 'in any of them' for 208 T runs: for lat-G, pat-G, rows-U, phys-rows-G there is no noise floor so PAY is undefined there (printed '-'), and cols-G (1000,3000] is unresolved in 8 of 8; the 0/8 claim is only a verdict in the rows-G, carpet and cols W1/W2 pairs. The per-seed rel_i of the pairs without a floor are all under the 3 percent floor, so the descriptive reading holds, but it is not a PAY count.")

# 2.5 per-seed rel_i of rows-G P2 at the windows (to show size vs the 3 percent floor)
for (lo, hi) in W:
    ps = TRES[("rows-G vs rows-G.off", lo, hi)]
    P(f"2.5 rows-G P2 ({lo},{hi}]: per-seed rel_i " + " ".join(pc(r["i"]) for r in ps["rels"]) + f"; nf_i {pc(ps['nf']['i'])}; thr_i {fm(max(THR, 2*ps['nf']['i']))}")


def first_diverge(a, b, keys=("n", "births", "deaths", "sumP")):
    sa, sb = a["snaps"], b["snaps"]
    for x, y in zip(sa, sb):
        if x["step"] != y["step"]:
            return None
        if any(x[k] != y[k] for k in keys):
            return x["step"]
    return -1  # identical over all common reads


P()
P("2.6 butterfly twins (the noise floor of T and D0): does bf differ from off, and when?")
for arm_off, arm_bf in (("rows-G.off", "rows-G.bf"), ("carpet-U.off", "carpet-U.bf"), ("carpet-G.off", "carpet-G.bf"), ("cols-G.off", "cols-G.bf")):
    fd = []
    for s in SCREEN_SLOTS["T"]:
        a, b = get("T", arm_off, "inherit", s), get("T", arm_bf, "inherit", s)
        fd.append(first_diverge(a, b))
    P(f"    T {arm_bf} vs {arm_off}: first read where (n, births, deaths, sumP) differ, per slot: {fd} ('-1' = identical on every read)")
for s in SCREEN_SLOTS["D"][:8]:
    pass
fd = [first_diverge(get("D0", "rows-G.off", "inherit", s), get("D0", "rows-G.bf", "inherit", s)) for s in SCREEN_SLOTS["D"][:8]]
P(f"    D0 rows-G.bf vs rows-G.off first differing read per slot: {fd}")
nodiv = {}
for arm_off, arm_bf in (("rows-G.off", "rows-G.bf"), ("carpet-U.off", "carpet-U.bf"), ("carpet-G.off", "carpet-G.bf"), ("cols-G.off", "cols-G.bf")):
    nodiv[arm_bf] = sum(1 for s in SCREEN_SLOTS["T"] if first_diverge(get("T", arm_off, "inherit", s), get("T", arm_bf, "inherit", s)) == -1)
nodiv["D0 rows-G.bf"] = sum(1 for x in fd if x == -1)
P("    butterfly twins that never differ from off in n, births, deaths or trail over the whole run (so contribute exactly 0 to the noise floor):", nodiv)
weak("The butterfly noise floor is soft: of the 8 twins per arm, %s never depart from their off run in n, births, deaths or trail (whole 3,000 or 5,000 steps), carpet-U's floor is exactly 0 (a 3 percent floor only), and the D0 births/deaths/population floors (5.0 / 4.6 / 2.4 percent) come from the 5 twins that did diverge. The T and D0 noise floors are maxima over few, partly degenerate pairs." % nodiv)
P("    the butterfly moves one nutrient unit A->C at the lowest-index cell with A > 0 at step 0 (bootstrap-screen.ts butterfly(): read from the runner source to learn the perturbation only).")
for label, lo, hi in (("carpet-U", 0, 300), ("carpet-U", 300, 1000), ("carpet-U", 1000, 3000), ("carpet-G", 0, 300), ("carpet-G", 300, 1000), ("carpet-G", 1000, 3000)):
    on, off, bf = arm_map("T", f"{label}.on-P2"), arm_map("T", f"{label}.off"), arm_map("T", f"{label}.bf")
    ps = pair_set(on, off, bf, lo, hi)
    P(f"    {label} ({lo},{hi}] noise floor nf (max over 8 butterfly pairs of |rel|): i {pc(ps['nf']['i'],3)} b {pc(ps['nf']['b'],3)} d {pc(ps['nf']['d'],3)} N {pc(ps['nf']['N'],3)}")

# ================================================================================================ 3. D0
P()
P("=" * 100)
P("3. D0 (durable road, rows-G P2, window (400, 2400])")
P("=" * 100)
d0on, d0off, d0bf = arm_map("D0", "rows-G.on-P2"), arm_map("D0", "rows-G.off"), arm_map("D0", "rows-G.bf")
ps = pair_set(d0on, d0off, d0bf, 400, 2400)
rr = ps["rels"]
P("3.1 per-seed rel_i " + " ".join(pc(r["i"]) for r in rr), "| thr_i", fm(max(THR, 2 * ps["nf"]["i"])), "(SCREEN: -0.3% 1.8% -0.8% 0.2% 0.6% 0.6% -1.5% 0.2%, thr_i 0.030)")
P("    per-seed PAY", [v_["pay"] for v_ in ps["ver"]], "DAMP", [v_["damp"] for v_ in ps["ver"]], "HARM", [v_["harm"] for v_ in ps["ver"]])
P("    vote PAY", vote([v_["pay"] for v_ in ps["ver"]]), "; DAMP count", sum(1 for v_ in ps["ver"] if v_["damp"]), "/ 8")
P("    medians on-minus-off: intake %s births %s deaths %s pop %s ; SCREEN +0.2 / -10.7 / -9.4 / +3.1" % tuple(pc(med([r[k] for r in rr])) for k in ("i", "b", "d", "N")))
P("    per-seed births " + " ".join(pc(r["b"]) for r in rr))
P("    per-seed deaths " + " ".join(pc(r["d"]) for r in rr))
P("    per-seed pop    " + " ".join(pc(r["N"]) for r in rr))
nf = ps["nf"]
P(f"3.2 D0 noise floors from the 8 butterfly twins (max |rel|): intake {pc(nf['i'],2)}, births {pc(nf['b'],2)}, deaths {pc(nf['d'],2)}, population {pc(nf['N'],2)}, turnover {pc(nf['bd'],2)}; effect sizes b/d/N: {pc(med([r['b'] for r in rr]))} {pc(med([r['d'] for r in rr]))} {pc(med([r['N'] for r in rr]))}")
# butterfly pairs per seed in D0 for the three safeguards
bfr = []
for s in ps["slots"]:
    a = window(d0bf[s]["snaps"], 400, 2400, 4)
    b = window(d0off[s]["snaps"], 400, 2400, 4)
    bfr.append(rels(a, b))
P("    per-seed butterfly-vs-off |rel| births " + " ".join(pc(r["b"]) for r in bfr) + " | deaths " + " ".join(pc(r["d"]) for r in bfr) + " | pop " + " ".join(pc(r["N"]) for r in bfr))
sd_b = [abs(r["b"]) for r in bfr]
P(f"    median |butterfly-vs-off| births {pc(med(sd_b))}, deaths {pc(med([abs(r['d']) for r in bfr]))}, pop {pc(med([abs(r['N']) for r in bfr]))}; the DAMP rule's fixed 3 percent is {'inside' if nf['b'] > 0.03 or nf['d'] > 0.03 else 'outside'} the births/deaths butterfly noise ({pc(nf['b'])}, {pc(nf['d'])})")
# on-vs-bf: is the treated on really different from a butterfly copy of off? on vs bf
rr2 = []
for s in ps["slots"]:
    a = window(d0on[s]["snaps"], 400, 2400, 4)
    b = window(d0bf[s]["snaps"], 400, 2400, 4)
    rr2.append(rels(a, b))
P("    on vs bf (a second control per seed) births " + " ".join(pc(r["b"]) for r in rr2) + " | deaths " + " ".join(pc(r["d"]) for r in rr2))
# total intake, per-capita vs total
P("3.3 per capita vs total (the PAY rule reads intake per particle-step):")
tot = []
for s in ps["slots"]:
    a = window(d0on[s]["snaps"], 400, 2400, 4)
    b = window(d0off[s]["snaps"], 400, 2400, 4)
    tot.append((a["intake"] / b["intake"] - 1, a["nsum"] / b["nsum"] - 1, a["light"] / b["light"] - 1, a["intake"] / a["light"], b["intake"] / b["light"], a["n0"], b["n0"], a["n1"], b["n1"]))
P("    per seed total-intake on/off-1: " + " ".join(pc(t_[0]) for t_ in tot) + f" ; median {pc(med([t_[0] for t_ in tot]))}")
P("    per seed mean-pop on/off-1:     " + " ".join(pc(t_[1]) for t_ in tot) + f" ; median {pc(med([t_[1] for t_ in tot]))}")
P("    intake / light-supply (units) on:  " + " ".join(f"{t_[3]:.3f}" for t_ in tot) + " ; off: " + " ".join(f"{t_[4]:.3f}" for t_ in tot))
P(f"    -> over the window the world eats about {fm(med([t_[3] for t_ in tot]),3)} of the light supply; total intake is {pc(med([t_[0] for t_ in tot]))} higher with the conduit on, population {pc(med([t_[1] for t_ in tot]))} higher; per capita {pc(med([r['i'] for r in rr]))}")
P("    window-start population n(400) on vs off per seed: " + " ".join(f"{t_[5]}/{t_[6]}" for t_ in tot) + "; end n(2400) " + " ".join(f"{t_[7]}/{t_[8]}" for t_ in tot))
# did the mechanism operate in D0: meanDd2 over window (conduit adds), onLaid, xflux
for st_ in (400, 1000, 2000, 2400):
    v1, v2, v3 = [], [], []
    for s, r in d0on.items():
        rs = r["roadSeries"]
        if st_ in rs["step"]:
            k = rs["step"].index(st_)
            v1.append(rs["cols"]["meanDd2"][k]); v2.append(rs["cols"]["xMed"][k]); v3.append(rs["cols"]["xGe2"][k])
    offv = []
    P(f"3.4 D0 on, step {st_}: median meanDd2 {fm(med(v1),1)} (diffA 40), median laid-edge x_e {med(v2)}, share of ALL edges with x_e >= 2 {fm(med(v3),3)}")
xg_off = []
for s, r in d0off.items():
    rs = r["roadSeries"]
    k = rs["step"].index(1000)
    xg_off.append(rs["cols"]["xGe2"][k])
P(f"    D0 off at 1000: share of all edges with x_e >= 2: {fm(med(xg_off),3)} (trail is present nearly everywhere at pDecay 66: the 'road' is a trail carpet, so conduit-on raises Dd over almost every edge, not only on the laid rows)")
weak("D0 'durable road': at pDecay 66 the whole world fills with trail (share of edges with x_e >= 2 is ~0.98 at step 2000), so D0 tests a conduit on a trail carpet, not on a road versus off-road; 'onLaid' stays at the laid-area share 0.12 (particles do not follow the road), so a road/off-road contrast the T design wanted was never present in D0.")

P("3.5 when does the D0 population advantage appear? n(on)/n(off)-1 per seed at selected reads (the window starts at 400):")
for st_ in (100, 200, 300, 400, 1000, 2400, 5000):
    vals = []
    for s in ps["slots"]:
        a = d0on[s]["snaps"][[x["step"] for x in d0on[s]["snaps"]].index(st_)]["n"]
        b = d0off[s]["snaps"][[x["step"] for x in d0off[s]["snaps"]].index(st_)]["n"]
        vals.append(a / b - 1)
    P(f"    step {st_:5d}: " + " ".join(pc(x) for x in vals) + f"   median {pc(med(vals))}")
lr = []
for s in ps["slots"]:
    a = window(d0on[s]["snaps"], 400, 2400, 4)
    b = window(d0off[s]["snaps"], 400, 2400, 4)
    lr.append(a["light"] / b["light"] - 1)
P("    light supply (lightIn/eA) in the window, on/off-1 per seed: " + " ".join(pc(x) for x in lr) + f" ; median {pc(med(lr))}")
P("    -> part of the +3.8% total intake is carried in at the window start (a larger population at step 400), which the window cannot separate from a rate effect.")
weak("D0 'same food intake' is per particle-step. Total intake over the window is +3.8% (median; 5 of 8 seeds above +3%) with the conduit on and the light supply drawn +3.6%, population +3.1% (butterfly noise on population is up to 2.4%, and 3 of the 8 D0 butterfly twins never diverge from off at all, so that floor is itself soft), births and deaths -10.7 / -9.4% (butterfly noise up to 5.0 / 4.6%, fixed DAMP threshold 3%). The DESIGN's PAY is per capita, so V(PAY-D0) = N holds as defined, but the one-line summary 'intake +0.2 percent ... the same food intake' is the per-capita number; the total and the population shift are of the size of the butterfly noise and cannot be called either way, while the turnover drop (5 of 8 seeds beyond the largest butterfly difference) is the clearest effect.")


# ================================================================================================ 4. SERIES F
P()
P("=" * 100)
P("4. SERIES F (free first layer) and the F label, recomputed")
P("=" * 100)


def md_tables(lines, header_start):
    tabs, cur, on = [], None, False
    for l in lines:
        if l.startswith(header_start):
            cur = []
            on = True
            continue
        if on:
            if l.startswith("|---"):
                continue
            if l.startswith("|"):
                cur.append([c.strip() for c in l.strip().strip("|").split("|")])
            else:
                tabs.append(cur)
                cur, on = None, False
    if cur is not None:
        tabs.append(cur)
    return tabs


def late_mean(j, col, store="bootSeries"):
    bs = j[store]
    half = j["steps"] / 2
    return mean([bs["cols"][col][k] for k, st_ in enumerate(bs["step"]) if half < st_ <= j["steps"]])


FSL = SCREEN_SLOTS["F"]
HF = {"inherit": 0, "blocked": 200, "physarum": 400, "blind": 600}


def row_stats(j):
    half = j["steps"] // 2
    w = window(j["snaps"], half, j["steps"], j["config"]["eA"])
    r = rates(w)
    return dict(N=r["N"], b=1000 * r["b"], d=1000 * r["d"], i=r["i"], tm=late_mean(j, "tm"), ta=late_mean(j, "tmAbove"), tas=late_mean(j, "tmAboveStar"),
                free=(w["free"] / max(w["nsum"], 1e-12) if "free" in w else None), paid=(w["paid"] / max(w["nsum"], 1e-12) if "paid" in w else None))


def arm_rows(series):
    out = {}
    for (d, i), j in RUNS_ALL.items():
        if d == "main" and j["series"] == series:
            out.setdefault((j["armId"], j["heredity"]), []).append(j)
    return out


def check_arm_table(series, tab_idx, name):
    tabs = md_tables(SCREEN_LINES, "| arm | heredity | runs | steps | window |")
    tab = tabs[tab_idx]
    sc = {(r[0], r[1]): r for r in tab}
    ar = arm_rows(series)
    bad = 0
    for key, js in sorted(ar.items()):
        st_ = [row_stats(j) for j in js]
        m = {k: med([x[k] for x in st_]) for k in ("N", "b", "d", "i", "tm", "tas")}
        fr = [x["free"] for x in st_ if x["free"] is not None]
        fp = f"{med(fr):.3f} / {med([x['paid'] for x in st_ if x['paid'] is not None]):.3f}" if fr else "-"
        mine = [str(len(js)), str(js[0]["steps"]), f"({js[0]['steps']//2},{js[0]['steps']}]", f"{m['N']:.0f}", f"{m['b']:.3f}", f"{m['d']:.3f}", f"{m['i']:.4f}", f"{m['tm']:.2f}", f"{m['tas']:.3f}", fp]
        sr = sc.get(key)
        if not sr:
            disc(f"{name}: arm {key} missing from SCREEN table")
            bad += 1
            continue
        if sr[2:] != mine:
            bad += 1
            disc(f"{name} table row differs {key}: mine {mine} SCREEN {sr[2:]}")
    P(f"4.x {name} per-arm table ({len(ar)} arm x heredity rows): {bad} rows differ from SCREEN")


check_arm_table("F", 0, "F")
check_arm_table("O", 1, "O")

# 4.2 K classes per slot
T16 = {s: get("F", "T-16-mid", "inherit", s) for s in FSL}
FREE16 = {s: get("F", "FREE-16", "inherit", s) for s in FSL}
BASEF = {s: get("F", "base", "inherit", s) for s in FSL}
COND = {s: get("F", "COND", "inherit", s) for s in FSL}


def kclass(tr, fo):
    ta, tt = late_mean(tr, "tmAbove"), late_mean(tr, "tm")
    fa, ft = late_mean(fo, "tmAbove"), late_mean(fo, "tm")
    if ta >= 0.1 and fa <= ta / 2:
        return "K"
    if tt >= 0.1:
        return "S"
    return "NB" if ft < 0.1 else "L"


# stored late.boot.tmAbove == recomputed?
chk = [(i, late_mean(j, "tmAbove"), j["late"]["boot"]["tmAbove"]) for (d, i), j in RUNS_ALL.items() if d == "main" and j["series"] in ("F", "O") and abs((late_mean(j, "tmAbove") or 0) - (j["late"]["boot"]["tmAbove"] or 0)) > 1e-6]
P(f"4.1 stored late.boot.tmAbove vs second-half mean of bootSeries.tmAbove: {len(chk)} mismatches")
classes = [kclass(T16[s], FREE16[s]) for s in FSL]
P("4.2 K/S/NB/L per slot (T-16-mid vs FREE-16, late = (50000,100000]):", " ".join(classes), "  [SCREEN: S S S S L S S L]")
if classes != ["S", "S", "S", "S", "L", "S", "S", "L"]:
    disc(f"K classes {classes} differ from SCREEN S S S S L S S L")
P("    per-slot treated TM / TMabove, FREE-ONLY TM / TMabove (late mean per particle):")
for s in FSL:
    t_, f_ = T16[s], FREE16[s]
    P(f"      slot {s}: T-16-mid TM {fm(late_mean(t_,'tm'),2)} above {fm(late_mean(t_,'tmAbove'),3)} | FREE-16 TM {fm(late_mean(f_,'tm'),2)} above {fm(late_mean(f_,'tmAbove'),3)} | class {kclass(t_, f_)} | K needs treated above >= 0.1 AND FREE-ONLY above <= half of it")
# margin of the label
ta = [late_mean(T16[s], "tmAbove") for s in FSL]
fa = [late_mean(FREE16[s], "tmAbove") for s in FSL]
P(f"4.3 label margin: S in {classes.count('S')} of 8 (rule: S >= 6); L in {classes.count('L')}. K needs treated TMabove >= 2 x FREE-ONLY's: ratio treated/FREE-ONLY above-layer per slot: " + " ".join(fm(a / b, 2) if b else "inf" for a, b in zip(ta, fa)))
P(f"    median above-layer: treated {fm(med(ta),3)} FREE-ONLY {fm(med(fa),3)} ; seeds with treated above-layer > FREE-ONLY: {sum(1 for a,b in zip(ta,fa) if a>b)} of 8; ratios >= 2: {sum(1 for a,b in zip(ta,fa) if b and a>=2*b)}")
tt_ = [late_mean(T16[s], "tm") for s in FSL]
ft_ = [late_mean(FREE16[s], "tm") for s in FSL]
P(f"    total trail per particle, treated {' '.join(fm(x,1) for x in tt_)} ; FREE-ONLY {' '.join(fm(x,1) for x in ft_)} ; treated higher in {sum(1 for a,b in zip(tt_,ft_) if a>b)} of 8 seeds")
P("    -> FREE-ONLY itself is class S in every seed that kept trail, so K (needs treated above-layer >= 2 x FREE-ONLY's) and the S label are decided by the free layer alone: " +
  f"FREE-ONLY TM >= 0.1 in {sum(1 for x in ft_ if x>=0.1)} of 8 seeds and above-layer >= 0.1 in {sum(1 for x in fa if x>=0.1)} of 8")
weak("F label SUBSIDY-ONLY is decided by the free layer, not by the conduit: the conduit contributes a few units of trail at most, FREE-ONLY already holds above-layer trail (median %s per particle), so K (treated >= 2 x FREE-ONLY) cannot be reached by an inert conduit and S (total trail >= 0.1) is satisfied by the layer itself. The label is therefore not evidence about the conduit; the SCREEN says so for the strength, not for the label." % fm(med(fa), 2))
# 4.4 the L seeds: when was trail lost
for s, c in zip(FSL, classes):
    if c == "L":
        bs = T16[s]["bootSeries"]
        tm_ = bs["cols"]["tm"]
        P(f"    L slot {s}: treated TM at 500,5000,10000,25000,50000,75000,100000 = " + " ".join(fm(tm_[bs['step'].index(t_)], 2) for t_ in (500, 5000, 10000, 25000, 50000, 75000, 100000)) + " ; FREE-16 same slot " +
          " ".join(fm(FREE16[s]['bootSeries']['cols']['tm'][FREE16[s]['bootSeries']['step'].index(t_)], 2) for t_ in (500, 5000, 10000, 25000, 50000, 75000, 100000)))
# stationarity: two halves of the late window per seed
P("4.5 stationarity of TM in the late window (50k-100k): mean over (50k,75k] and (75k,100k] per seed, treated and FREE-ONLY")
for nm, mp in (("T-16-mid", T16), ("FREE-16", FREE16), ("base", BASEF)):
    rows_ = []
    for s in FSL:
        bs = mp[s]["bootSeries"]
        a = mean([bs["cols"]["tm"][k] for k, st_ in enumerate(bs["step"]) if 50000 < st_ <= 75000])
        b = mean([bs["cols"]["tm"][k] for k, st_ in enumerate(bs["step"]) if 75000 < st_ <= 100000])
        rows_.append((a, b))
    P(f"    {nm:9s} " + " ".join(f"{a:.1f}->{b:.1f}" for a, b in rows_) + f" ; median drift {fm(med([b-a for a,b in rows_]),2)}")
# 4.6 paired noise: T-16-mid vs FREE-16, same slot, sign counts and the 'identical config' spread
P("4.6 treated minus FREE-ONLY, paired by slot (late window), sign counts and spread; FREE-ONLY itself across seeds:")
for k_, lab in (("tm", "TM per particle"), ("ta", "TM above layer"), ("N", "mean population"), ("b", "births per 1000 p-s"), ("i", "intake per p-s")):
    tv = [row_stats(T16[s])[k_] for s in FSL]
    fv = [row_stats(FREE16[s])[k_] for s in FSL]
    P(f"    {lab:22s} treated-FREE per slot: " + " ".join(f"{a-b:+.3g}" for a, b in zip(tv, fv)) + f" ; positive in {sum(1 for a,b in zip(tv,fv) if a>b)}/8 ; FREE-ONLY across seeds: min {min(fv):.3g} median {med(fv):.3g} max {max(fv):.3g}")
# paired noise for F: no 100k-step null twin exists; the only paired floor is the 2,000-step null branches
P("    (there is no 100,000-step twin of an F run: seed-to-seed spread of FREE-ONLY TM is the only noise at that horizon, min %s max %s per particle)" % (fm(min(ft_), 1), fm(max(ft_), 1)))
# first divergence between arms that should differ only by an inert conduit
P("4.7 first read at which T-16-mid departs from FREE-16 (same slot): conduit g=1 inert would give none")
for lab, A_, B_ in (("T-16-mid vs FREE-16", "T-16-mid", "FREE-16"), ("GHOST vs T-16-mid", "GHOST", "T-16-mid"), ("COND vs base", "COND", "base"), ("T-16-hi vs T-16-mid", "T-16-hi", "T-16-mid"),
                    ("T-4-mid vs FREE-4", "T-4-mid", "FREE-4"), ("toll-C vs toll-base", "toll-C", "toll-base"), ("toll-FC vs toll-C", "toll-FC", "toll-C")):
    fd = []
    for s in FSL:
        a, b = get("F", A_, "inherit", s), get("F", B_, "inherit", s)
        fd.append(first_diverge(a, b))
    P(f"    {lab:24s}: {fd}")
for lab, A_, B_ in (("T-16-mid vs FREE-16 (blocked)", "T-16-mid", "FREE-16"),):
    fd = [first_diverge(get("F", A_, "blocked", s), get("F", B_, "blocked", s)) for s in FSL]
    P(f"    {lab}: {fd}")
# conduit operation in F: effP50/effP90/csat/xP50 late-window medians for treated and anchors
P("4.8 did the F conduit operate? (conduitSeries, late window median over reads then over seeds; eff = realised extra Dd in units, headroom 88)")
for nm, her, slots in (("T-16-mid", "inherit", FSL), ("T-16-mid", "blocked", FSL), ("T-16-hi", "inherit", FSL), ("anchor-phys-T-16-mid", "physarum", FSL), ("anchor-blind-T-16-mid", "blind", FSL),
                       ("COND", "inherit", FSL)):
    vals = collections.defaultdict(list)
    for s in slots:
        j = get("F", nm, her, s)
        for c in ("effP10", "effP50", "effP90", "csat", "xP50", "xP90", "pcP50", "pcP90", "occx", "occxShift", "nLayer"):
            v_ = late_mean(j, c, "conduitSeries") if "conduitSeries" in j and j["conduitSeries"] else None
            vals[c].append(v_)
    P(f"    {nm:22s}/{her:8s}: " + ", ".join(f"{c} {fm(med(vals[c]),2)}" for c in ("effP10", "effP50", "effP90", "csat", "xP50", "xP90", "pcP50")))
    mx = max(late_mean(get("F", nm, her, s), "effP90", "conduitSeries") for s in slots)
    P(f"        max over seeds of late-mean effP90: {mx:.2f} units of Dd (diffA 40, headroom 88)")
weak("F conduit at g = 1 is a floor result: eff p90 in the late window is about <= 1 unit of Dd (of 88 headroom) in the treated arms; every F conduit row (T-16-mid, GHOST, T-16-lo/hi, anchors, branches 'noconduit/ghost') compares an essentially inert conduit with none, so 'on-minus-off 0.0% / 0 of 8 PAY / 0 DAMP' at F, including the physarum and blind anchors, is a floor result (anchors: eff p50 0 to 1, p90 7 for physarum and 2 for blind) and does not belong beside D0 (mean Dd +11 to +26 units on every edge) or the O anchors as evidence about a working conduit. The SCREEN says the F conduit never operated, but still lists the F anchor row in the 'Does it pay on existing trail' table next to rows where it did.")

from math import comb


def sign_p(k, n):
    """two-sided exact sign test p for k positives of n (ties dropped by the caller)."""
    lo = min(k, n - k)
    return min(1.0, 2 * sum(comb(n, i) for i in range(lo + 1)) / 2 ** n)


def rank_sum_p(xs, ys):
    """exact two-sided permutation p for the difference of means (small n)."""
    from itertools import combinations
    allv = xs + ys
    n, k = len(allv), len(xs)
    obs = abs(mean(xs) - mean(ys))
    tot = hit = 0
    for idx in combinations(range(n), k):
        a = [allv[i] for i in idx]
        b = [allv[i] for i in range(n) if i not in idx]
        tot += 1
        if abs(mean(a) - mean(b)) >= obs - 1e-12:
            hit += 1
    return hit / tot


P("4.9 paired late-window TM per particle across F arms that differ only by a tiny conduit (g = 1 or 2), same slot, and exact sign / permutation tests:")
cmp_list = [("T-16-mid", "inherit", "FREE-16", "inherit"), ("T-16-mid", "blocked", "FREE-16", "blocked"), ("GHOST", "inherit", "FREE-16", "inherit"), ("T-16-hi", "inherit", "FREE-16", "inherit"),
            ("T-4-mid", "inherit", "FREE-4", "inherit"), ("COND", "inherit", "base", "inherit"), ("toll-C", "inherit", "toll-base", "inherit"), ("toll-FC", "inherit", "toll-base", "inherit"),
            ("GHOST", "inherit", "T-16-mid", "inherit")]
for a_, ha, b_, hb in cmp_list:
    av = [late_mean(get("F", a_, ha, s), "tm") for s in FSL]
    bv = [late_mean(get("F", b_, hb, s), "tm") for s in FSL]
    pos = sum(1 for x, y in zip(av, bv) if x > y)
    neg = sum(1 for x, y in zip(av, bv) if x < y)
    P(f"    {a_:9s}/{ha:8s} vs {b_:9s}/{hb:8s}: median TM {fm(med(av),1)} vs {fm(med(bv),1)}; per-slot higher in {pos}, lower in {neg}; sign p {sign_p(pos, pos+neg):.3f}; permutation p (unpaired means) {rank_sum_p(av, bv):.4f}")
P("    -> SCREEN: 'Trail count differences between T-16-mid and FREE-16 (16.6 against 39.7) are within the seed-to-seed spread of identical-configuration worlds (0 to 59)'. The spread of FREE-ONLY alone is %s to %s per particle (blocked %s to %s); the '0' comes from the treated arm itself, so the sentence compares the treated arm's range with its own difference. Paired, the treated arm is lower in every seed." %
  (fm(min(ft_), 1), fm(max(ft_), 1), fm(min(late_mean(get('F', 'FREE-16', 'blocked', s), 'tm') for s in FSL), 1), fm(max(late_mean(get('F', 'FREE-16', 'blocked', s), 'tm') for s in FSL), 1)))
weak("SCREEN dismisses the T-16-mid vs FREE-16 trail difference (16.6 vs 39.7 per particle) as 'within the seed-to-seed spread of identical-configuration worlds (0 to 59)', but FREE-ONLY alone spans 31 to 59 (blocked 28 to 29) and the 0 belongs to the treated arm. Paired by slot the treated arm (g = 1, effective rate about 0) has less trail in 8 of 8 seeds (two-sided exact sign p = 0.008; GHOST, same g, also 8 of 8) and loses it entirely in 2, but the unpaired permutation test is only p = 0.056 and no multiplicity is controlled; blocked T-16-mid equals FREE-16 blocked (28.77 vs 28.76) and g = 2 (T-16-hi) is not lower, so it is suggestive, not shown. The point for the reading: 'an inert conduit changes nothing' is not what the data say (every F treated arm departs from its FREE-ONLY twin by the first read, step 100), the L count (2 of 8) and the 'S 6 of 8' margin come from exactly these two seeds, and the sentence in SCREEN does not support 'not a conduit effect'.")


# ================================================================================================ 5. BRANCH PAIRS
P()
P("=" * 100)
P("5. BRANCH PAIRS (2,000-step continuations from identical state), recomputed from the stored branch reads")
P("=" * 100)


def side(v, win, eA):
    if v is None or v["ledgerBad"] > 0 or v.get("error"):
        return None
    return window(v["snaps"], win[0], win[1], eA)


def branch_pair(b, eA):
    on = b["variants"].get("on")
    out = {}
    if not on:
        return out
    L = b["len"]
    wins = {"whole": (0, L), "last": (L // 2, L)}

    def nf_of(win):
        o, a, c = side(on, win, eA), side(b["variants"].get("nullA"), win, eA), side(b["variants"].get("nullB"), win, eA)
        if not (o and a and c):
            return None
        return noise_floor([rels(o, a), rels(a, c), rels(o, c)])

    for name, v in b["variants"].items():
        if name == "on" or name.startswith("relax-"):
            continue
        res = {}
        for wn, win in wins.items():
            void = None
            if name in ("ghost", "oghost"):
                c = v.get("ghostCorr")
                if c is None or (isinstance(c, float) and math.isnan(c)):
                    void = "ghost control void: no correlation"
                elif c > 0.5:
                    void = "ghost control void: corr above 0.5"
            o, x, nf = side(on, win, eA), side(v, win, eA), nf_of(win)
            if void or not (o and x and nf):
                res[wn] = (dict(pay=None, damp=None, harm=None, thr=None, why=void or "missing"), None, nf)
            else:
                r = rels(o, x)
                res[wn] = (judge(r, nf), r, nf)
        out[name] = res
    return out


bagg = collections.defaultdict(list)  # (arm, heredity, at, variant) -> list of (slot, res)
for (d, i), j in RUNS_ALL.items():
    if d != "main":
        continue
    for b in j["branches"]:
        bp = branch_pair(b, j["config"]["eA"])
        for vn, res in bp.items():
            bagg[(j["armId"], j["heredity"], b["at"], vn)].append((j["slot"], res))
sc_br = {(r[0], r[1], r[2], r[3]): r for r in parse_md_table(SCREEN_LINES, "| run set | heredity |")}
bad_b = 0
med_round = 0
rows_b = {}
for key in sorted(bagg, key=lambda k: (k[0], k[1], str(k[2]).zfill(7), k[3])):
    lst = bagg[key]
    pay_w = sum(1 for s, r in lst if r["whole"][0]["pay"])
    pay_wl = sum(1 for s, r in lst if r["whole"][0]["pay"] and r["last"][0]["pay"])
    damp = sum(1 for s, r in lst if r["whole"][0]["damp"])
    harm = sum(1 for s, r in lst if r["whole"][0]["harm"])
    unres = sum(1 for s, r in lst if r["whole"][0]["pay"] is None)
    mm_ = {k: med([r["whole"][1][k] for s, r in lst if r["whole"][1]]) for k in ("i", "N", "d", "b")}
    sg = lambda v: "-" if v is None else f"{100*v:+.1f}%"
    mine = [str(len(lst)), str(pay_w), str(pay_wl), str(damp), str(harm), str(unres), sg(mm_["i"]), sg(mm_["N"]), sg(mm_["d"]), sg(mm_["b"])]
    rows_b[key] = dict(pay=pay_w, damp=damp, harm=harm, unres=unres, med=mm_, n=len(lst))
    sr = sc_br.get((key[0], key[1], str(key[2]), key[3]))
    if sr is None:
        bad_b += 1
        disc(f"branch row {key} missing in SCREEN")
    else:
        theirs = sr[4:]
        if theirs[:6] != mine[:6]:
            bad_b += 1
            disc(f"branch COUNTS differ {key}: mine {mine[:6]} SCREEN {theirs[:6]}")
        for a_, b_ in zip(mine[6:], theirs[6:]):
            if a_ == "-" or b_ == "-":
                if a_ != b_:
                    bad_b += 1
                    disc(f"branch median missing mismatch {key}")
                continue
            dd_ = abs(float(a_.strip("%")) - float(b_.strip("%")))
            if dd_ > 0.1001:
                bad_b += 1
                disc(f"branch median differs by {dd_:.2f} points {key}: mine {a_} SCREEN {b_}")
            elif dd_ > 0.0001:
                med_round += 1
P(f"5.1 branch rows recomputed: {len(bagg)} (arm, heredity, checkpoint, variant) cells; SCREEN prints {len(sc_br)}; cells whose counts (pairs, PAY, PAY whole+last, DAMP, HARM, unresolved) differ, or a median differs by more than 0.1 point: {bad_b}; median entries that differ by one printed digit (<= 0.1 point) from my recomputation: {med_round} of {4*len(sc_br)} (rounding-level, the scratch script that made them is not in the repo, so the cause is not known; no reading depends on it)")
# any variant that exists in the files but is not in SCREEN's table
miss = [k for k in sc_br if (k[0], k[1], int(k[2]), k[3]) not in bagg]
P(f"    SCREEN rows with no matching cell in the files: {len(miss)}")

# 5.2 total pays: per run, both checkpoints
tot_pay = sum(v["pay"] for v in rows_b.values())
tot_harm = sum(v["harm"] for v in rows_b.values())
tot_unres = sum(v["unres"] for v in rows_b.values())
tot_pairs = sum(v["n"] for v in rows_b.values())
P(f"5.2 over all {tot_pairs} per-seed branch pairs (all variants incl. null and nofree): PAY {tot_pay}, HARM {tot_harm}, unresolved {tot_unres}")
# noise floors in branches: size relative to the effects
nfs = []
for key, lst in bagg.items():
    if key[3] == "nullA":
        for s, r in lst:
            nf_ = r["whole"][2]
            if nf_:
                nfs.append((key[0], key[1], key[2], nf_["i"], nf_["b"], nf_["d"], nf_["N"]))
P("5.3 branch noise floors (max |on-nullA|, |nullA-nullB|, |on-nullB| over the whole 2,000-step window), median over seeds, per run set (a few):")
agg = collections.defaultdict(list)
for a_, h_, at_, ni, nb, nd, nN in nfs:
    agg[(a_, h_, at_)].append((ni, nb, nd, nN))
for k_ in sorted(agg, key=str)[:60]:
    v_ = agg[k_]
    if k_[0] in ("T-16-mid", "anchor-phys-T-16-mid", "anchor-blind-T-16-mid", "T-EC", "anchor-phys-EC", "anchor-blind-EC", "GHOST"):
        P(f"    {k_[0]:24s} {k_[1]:8s} @{k_[2]:6d}: nf_i {pc(med([x[0] for x in v_]),2)}  nf_b {pc(med([x[1] for x in v_]),2)}  nf_d {pc(med([x[2] for x in v_]),2)}  nf_N {pc(med([x[3] for x in v_]),2)}")
# 5.4 O direction check on raw counts (the SCREEN prose says 'switching enclosure off raises births and deaths by 18 to 24 percent (enclosure lowers turnover)')
P("5.4 direction check from raw counts, T-EC inherit, checkpoint 100000, 2,000-step branch: births and deaths in the whole window")
for vn in ("on", "eoff", "coff", "both", "cpub", "oghost"):
    bth, dth, nn = [], [], []
    for s in SCREEN_SLOTS["O"]:
        j = get("O", "T-EC", "inherit", s)
        b = next(x for x in j["branches"] if x["at"] == 100000)
        w = window(b["variants"][vn]["snaps"], 0, 2000, 4)
        bth.append(w["births"]); dth.append(w["deaths"]); nn.append(w["nsum"] / 2000)
    P(f"    {vn:7s}: median births {med(bth):7.0f} deaths {med(dth):7.0f} mean pop {med(nn):7.0f}")
on_b = med([window(next(x for x in get('O','T-EC','inherit',s)['branches'] if x['at']==100000)['variants']['on']['snaps'],0,2000,4)['births'] for s in SCREEN_SLOTS['O']])
eo_b = med([window(next(x for x in get('O','T-EC','inherit',s)['branches'] if x['at']==100000)['variants']['eoff']['snaps'],0,2000,4)['births'] for s in SCREEN_SLOTS['O']])
P(f"    births with enclosure on {on_b:.0f} vs enclosure off {eo_b:.0f}: the table's on-minus-eoff is positive because the world WITH enclosure has MORE births (the rule E raises turnover); SCREEN's prose 'switching enclosure off raises births and deaths ... (enclosure lowers turnover)' states the opposite.")
if on_b > eo_b:
    disc("SCREEN prose (O section): 'switching enclosure off raises births and deaths by 18 to 24 percent (enclosure lowers turnover ...)' is reversed: raw branch counts show births and deaths are HIGHER with enclosure on (table values on-minus-eoff are +18 to +24%), so enclosure raises turnover; the same sign convention makes 'conduit off lowers deaths and births by 6 to 7 percent' (anchors) reversed too: on-minus-coff is -6 to -7%, i.e. switching the conduit off raises turnover")
# coff check
on_b = med([window(next(x for x in get('O','anchor-phys-EC','physarum',s)['branches'] if x['at']==30000)['variants']['on']['snaps'],0,2000,4)['births'] for s in SCREEN_SLOTS['O']])
co_b = med([window(next(x for x in get('O','anchor-phys-EC','physarum',s)['branches'] if x['at']==30000)['variants']['coff']['snaps'],0,2000,4)['births'] for s in SCREEN_SLOTS['O']])
P(f"    physarum anchor @30000: births on {on_b:.0f}, conduit-off {co_b:.0f} -> switching the conduit off RAISES births by {100*(co_b/on_b-1):.1f}% (SCREEN prose: 'conduit off lowers deaths and births by 6 to 7 percent')")


# ================================================================================================ 6. FURTHER CHECKS
P()
P("=" * 100)
P("6. PER-CAPITA VERSUS TOTAL INTAKE IN BRANCH PAIRS, CROSS-FLUX, DOSE ROWS, ANCHOR VERDICT, CONTROLS INSIDE THE RANGE")
P("=" * 100)


def branch_of(j, at):
    return next(x for x in j["branches"] if x["at"] == at)


P("6.1 per-capita intake (the PAY quantity) versus total intake and population, on minus variant, whole 2,000-step window, per seed (counts of seeds with total intake >= +3%):")
for (arm, her, at, var) in (("T-EC", "inherit", 60000, "coff"), ("T-EC", "inherit", 100000, "coff"), ("T-EC", "inherit", 100000, "cpub"), ("anchor-blind-EC", "blind", 30000, "coff"), ("anchor-phys-EC", "physarum", 30000, "coff"),
                            ("anchor-phys-T-16-mid", "physarum", 40000, "noconduit"), ("anchor-blind-T-16-mid", "blind", 40000, "noconduit"), ("T-16-mid", "inherit", 100000, "noconduit"), ("T-16-mid", "inherit", 100000, "nofree")):
    ti, ni, pi_, nulls = [], [], [], []
    for s in SCREEN_SLOTS["O" if arm.endswith("EC") else "F"]:
        j = get("O" if arm.endswith("EC") else "F", arm, her, s)
        b = branch_of(j, at)
        o, x = window(b["variants"]["on"]["snaps"], 0, 2000, 4), window(b["variants"][var]["snaps"], 0, 2000, 4)
        na, nb = window(b["variants"]["nullA"]["snaps"], 0, 2000, 4), window(b["variants"]["nullB"]["snaps"], 0, 2000, 4)
        ti.append(o["intake"] / x["intake"] - 1)
        ni.append(o["nsum"] / x["nsum"] - 1)
        pi_.append(rates(o)["i"] / rates(x)["i"] - 1)
        nulls.append(max(abs(o["intake"] / na["intake"] - 1), abs(o["intake"] / nb["intake"] - 1), abs(na["intake"] / nb["intake"] - 1)))
    P(f"    {arm:22s} {her:8s} @{at:6d} on-{var:9s}: per-capita {pc(med(pi_),2)} | total intake {pc(med(ti),2)} (seeds >= +3%: {sum(1 for x in ti if x>=0.03)}/8; per seed {' '.join(pc(x,1) for x in ti)}) | mean pop {pc(med(ni),2)} (>= +3%: {sum(1 for x in ni if x>=0.03)}/8) | total-intake null-branch floor {pc(med(nulls),2)}")
weak("PAY is per particle-step. In the O evolving runs the owner conduit (on versus coff) leaves per-capita intake at +0.1% but raises mean population by +3.0% (null-branch floor on population 0.15 to 0.2%) and total intake by about +3%; the SCREEN reports the population number but reads the row as 'no payment'. On the blind O anchor the same shift is +2.2% in total intake and +2.1% in population in 8 of 8 seeds against a null floor of 0.07% (6.1), and the physarum anchor shows none. A conduit that helps by feeding more bodies at the same per-body intake fails the per-capita rule by construction; it is a real effect of a different kind (O is unlabelled, so no label changes, but 'intake never rises' is a per-capita statement).")

P("6.2 cross-flux, the MECH readout: SCREEN says 'the road conducts (cross-flux and meanDd rise)'. xflux is the expected extra flux across the mid-column in the direction of the gradient; mean over the window, median over seeds:")
for lab, series, arm_on, arm_off, lo, hi in (("T rows-G P2, (0,300]", "T", "rows-G.on-P2", "rows-G.off", 0, 300), ("T rows-G P2, (300,1000]", "T", "rows-G.on-P2", "rows-G.off", 300, 1000), ("D0 rows-G P2, (400,2400]", "D0", "rows-G.on-P2", "rows-G.off", 400, 2400),
                                           ("T cols-G P2, (0,300]", "T", "cols-G.on-P2", "cols-G.off", 0, 300)):
    def xf(m):
        vals = []
        for s, r in m.items():
            rs = r["roadSeries"]
            ks = [k for k, st_ in enumerate(rs["step"]) if lo < st_ <= hi]
            vals.append(mean([rs["cols"]["xflux"][k] for k in ks]))
        return vals
    on_v, off_v = xf(arm_map(series, arm_on)), xf(arm_map(series, arm_off))
    P(f"    {lab:26s}: xflux on {' '.join(fm(x,2) for x in on_v)} (median {fm(med(on_v),2)}) ; off median {fm(med(off_v),2)}")
weak("The SCREEN's D0 reading 'the road conducts (cross-flux and meanDd rise)': meanDd rises (the conduit raises the mean diffusion constant by +11 to +26 units of 40), but the stored cross-flux readout xflux is about zero or negative in T and D0 (see 6.2), so the MECH predicate would not hold and 'cross-flux rises' is not what the stored series shows.")

P("6.3 dose rows K counts: FREE-4, T-4-mid, T-16-lo (= T-16-mid), T-16-hi against their FREE-ONLY partner (SCREEN: K 0, 1, 0, 0 of 8; FREE-4 keeps 2.2, T-4-mid 1.3):")
for nm, partner in (("FREE-4", "FREE-4"), ("T-4-mid", "FREE-4"), ("T-16-lo", "FREE-16"), ("T-16-mid", "FREE-16"), ("T-16-hi", "FREE-16")):
    cl_ = [kclass(get("F", nm, "inherit", s), get("F", partner, "inherit", s)) for s in FSL]
    P(f"    {nm:9s} vs {partner:8s}: {collections.Counter(cl_).most_common()}  K={cl_.count('K')}  median TM {fm(med([late_mean(get('F', nm, 'inherit', s), 'tm') for s in FSL]),2)}, TMabove {fm(med([late_mean(get('F', nm, 'inherit', s), 'tmAbove') for s in FSL]),3)}; max TMabove {fm(max(late_mean(get('F', nm, 'inherit', s), 'tmAbove') for s in FSL),3)}")

P("6.4 anchor verdict (a) re-applied: for each anchor run PAY(on vs noconduit) and PAY(on vs ghost) at both checkpoints, whole and last:")
for nm, her in (("anchor-phys-T-16-mid", "physarum"), ("anchor-blind-T-16-mid", "blind")):
    n_pay = n_damp = n_unres = 0
    for s in FSL:
        j = get("F", nm, her, s)
        ok, dmp, unres = True, True, False
        for at in j["branchAt"]:
            bp = branch_pair(branch_of(j, at), 4)
            for v_ in ("noconduit", "ghost"):
                for wn in ("whole", "last"):
                    vd = bp[v_][wn][0]
                    if vd["pay"] is None:
                        unres = True
                    elif not vd["pay"]:
                        ok = False
            for wn in ("whole", "last"):
                vd = bp["noconduit"][wn][0]
                if vd["damp"] is None:
                    unres = True
                elif not vd["damp"]:
                    dmp = False
        n_pay += ok and not unres
        n_damp += dmp and not unres
        n_unres += unres
    P(f"    {nm:24s}: (a) PAY in {n_pay}/8, (a-damp) in {n_damp}/8, unresolved {n_unres}  -> verdict {'YES' if n_pay>=6 else ('NO-DAMPS' if n_damp>=6 else 'MIXED')} (SCREEN: MIXED, 0 pay 0 damp)")
P("    F anchor 2,000-step pairs: conduit eff p50 0-1, p90 2-7 of 88 headroom (see 4.8); the branch nf_i is 0.03-0.06%, so the pair can see a change of about 0.1% in intake: a floor result for 'does an effective conduit pay', a sharp result for 'does a g=1 conduit change anything' (it changes births/deaths by up to 1%).")

P("6.5 controls inside the treatment range: DAMP counts of the null branches (nullA, nullB) against real variants, per run set:")
null_damp = [(k, v["damp"]) for k, v in rows_b.items() if k[3] in ("nullA", "nullB")]
real_damp = [(k, v["damp"]) for k, v in rows_b.items() if k[3] in ("noconduit", "coff", "cpub", "ghost", "oghost")]
P(f"    null branches: {len(null_damp)} cells, DAMP count distribution {sorted(collections.Counter(v for k,v in null_damp).items())} (max {max(v for k,v in null_damp)} of 8)")
P(f"    real conduit-off style variants: {len(real_damp)} cells, DAMP distribution {sorted(collections.Counter(v for k,v in real_damp).items())}")
for k, v in sorted(rows_b.items(), key=lambda kv: str(kv[0])):
    if k[3] in ("coff",) and k[0] == "T-EC":
        P(f"    T-EC coff @{k[2]}: DAMP {v['damp']}/8; same cell's nullA DAMP {rows_b[(k[0],k[1],k[2],'nullA')]['damp']}/8, nullB {rows_b[(k[0],k[1],k[2],'nullB')]['damp']}/8 -> the 'DAMP 1 to 2 of 8' for the owner conduit in evolving worlds is the null-branch level")
weak("DAMP counts of 1 to 2 of 8 (owner conduit off in the evolving T-EC runs; GHOST and T-16-mid branches) are the same size as the null branches' own DAMP counts (0 to 2 of 8 for nullA and nullB with no change at all), because the DAMP threshold is a fixed 3 percent on turnover while the branch births/deaths noise is 1 to 3.6 percent; only the anchors' conduit-off rows (turnover -6 to -7% against null floors of about 1%, 8 of 8) rise clearly out of that floor.")

# survivor conditioning: trail present at the F branch checkpoints
P("6.6 survivor conditioning in the F branch tests: trail per particle at the checkpoint of each T-16-mid inherit run (a branch where no trail exists tests a conduit on nothing):")
for at in (50000, 100000):
    tms = []
    for s in FSL:
        bs = T16[s]["bootSeries"]
        tms.append(bs["cols"]["tm"][bs["step"].index(at)])
    P(f"    @{at}: TM per particle per seed " + " ".join(fm(x, 1) for x in tms) + f" ; seeds with TM < 1: {sum(1 for x in tms if x<1)}, < 10: {sum(1 for x in tms if x<10)}")
gv = []
for s in FSL:
    j = get("F", "T-16-mid", "inherit", s)
    for b in j["branches"]:
        v_ = b["variants"].get("ghost")
        gv.append((s, b["at"], v_.get("ghostCorr") if v_ else None))
P("    ghostCorr per slot and checkpoint (T-16-mid inherit): " + " ".join(f"{s}@{a}:{'None' if c is None else round(c,2)}" for s, a, c in gv))


# ================================================================================================ 7. PROSE AGAINST THE TABLE, SCOPE
P()
P("=" * 100)
P("7. SCREEN PROSE CHECKED AGAINST ITS OWN TABLE AND THE RAW RUNS; SCOPE")
P("=" * 100)
meds = {k: {"i": med([r["i"] for r in v["rels"] if r]), "b": med([r["b"] for r in v["rels"] if r]), "d": med([r["d"] for r in v["rels"] if r]), "N": med([r["N"] for r in v["rels"] if r])} for k, v in TRES.items()}
allI = [v["i"] for v in meds.values()]
P(f"7.1 'median rel_i on-minus-off is between -0.9 and +0.8 percent ... at every strength and window': recomputed range of the 36 medians {pc(min(allI))} to {pc(max(allI))}")
bd = [(k, v["b"], v["d"]) for k, v in meds.items()]
P(f"7.2 'Births and deaths both fall 1 to 5 percent': births medians range {pc(min(x[1] for x in bd))} to {pc(max(x[1] for x in bd))}, deaths {pc(min(x[2] for x in bd))} to {pc(max(x[2] for x in bd))}; rows where either median does not fall by at least 1 point: {sum(1 for k,b,d in bd if b>-0.01 or d>-0.01)} of {len(bd)}; rows where either rises: {[(k[0], k[1], k[2], pc(b), pc(d)) for k,b,d in bd if b>0 or d>0]}; rows beyond 5 points: {[(k[0], k[1], k[2], pc(b), pc(d)) for k,b,d in bd if b<-0.05 or d<-0.05]}")
Gn = [(k, v["N"]) for k, v in meds.items() if ("-G" in k[0] or k[0].startswith("rows-G")) and not k[0].startswith("carpet")]
out_n = [(k[0], k[1], k[2], pc(n)) for k, n in Gn if abs(n) > 0.02]
P(f"7.3 'population stays within +/- 2 percent in G' (gradient rows other than the carpet): rows outside: {out_n}")
disc("SCREEN prose 'Births and deaths both fall 1 to 5 percent' (T section) does not describe its own table: medians run from %s to %s (births) and %s to %s (deaths), rows-U W3 rises (+2.2%% / +3.0%%), cols-G W3 and phys-rows-G W3 pass 5 points, and several rows are near 0" % (pc(min(x[1] for x in bd)), pc(max(x[1] for x in bd)), pc(min(x[2] for x in bd)), pc(max(x[2] for x in bd))))
disc("SCREEN prose 'population stays within +/- 2 percent in G' is violated by its own table: " + "; ".join(f"{a} {b} {c} {d}" for a, b, c, d in out_n))
# per-seed extremes of rel_i over all T pairs
ext = []
for k, v in TRES.items():
    for s, r in zip(v["slots"], v["rels"]):
        if r:
            ext.append((r["i"], k[0], k[1], k[2], s))
ext.sort()
P(f"7.4 per-seed extremes of rel_i over the 36 pair-windows x 8 seeds: lowest {pc(ext[0][0])} ({ext[0][1]} ({ext[0][2]},{ext[0][3]}] seed {ext[0][4]}), highest {pc(ext[-1][0])} ({ext[-1][1]} ({ext[-1][2]},{ext[-1][3]}] seed {ext[-1][4]}); seed-pairs with rel_i >= +3%: {sum(1 for x in ext if x[0]>=0.03)}; <= -3%: {sum(1 for x in ext if x[0]<=-0.03)}")
P("    -> 'within 0.9 percent of conduit-off on intake in every pair and window' is a statement about the 8-seed medians, not about runs")
P("    the 6 seed-pairs at or above +3% intake (they fail a safeguard, so none is a PAY, but 'intake never rises by the 3 percent floor in any pair' is true of medians only):")
for x in [e for e in ext if e[0] >= 0.03]:
    ps_ = TRES[(x[1], x[2], x[3])]
    k_ = ps_["slots"].index(x[4])
    r_ = ps_["rels"][k_]
    P(f"      {x[1]} ({x[2]},{x[3]}] seed {x[4]}: rel_i {pc(r_['i'])} births {pc(r_['b'])} deaths {pc(r_['d'])} pop {pc(r_['N'])}")
# F predicates (b), (c) re-applied to STORED aggregates (not rederived: the heavy censuses were not kept)
P("7.4b F label predicates re-applied to stored late aggregates (conduit and r4 census values are stored, the per-particle readouts are not): (b) import, H and G of (c), (f) controls")
bpred, hpred, gpred = [], [], []
for s_ in FSL:
    tr, bl = get("F", "T-16-mid", "inherit", s_), get("F", "T-16-mid", "blocked", s_)
    c, cb = tr["late"]["conduit"], bl["late"]["conduit"]
    cs = tr["conduitSeries"]
    ks = [k for k, st_ in enumerate(cs["step"]) if tr["steps"] / 2 < st_ <= tr["steps"]]
    cov = sum(1 for k in ks if cs["cols"]["impLayer"][k] is not None and cs["cols"]["impNon"][k] is not None) / len(ks)
    if c["impLayer"] is None or c["impNon"] is None or cov < 0.5:
        bpred.append(None)
    else:
        bpred.append(c["impLayer"] > 0 and c["impLayer"] > c["impNon"])
    i_ = None if None in (c["occx"], c["occxShift"], cb["occx"], cb["occxShift"]) else (c["occx"] - c["occxShift"]) - (cb["occx"] - cb["occxShift"]) > 0.25
    sens = lambda x_, y_: None if x_ is None or y_ is None else (x_ >= 0.005 and x_ >= 2 * y_)
    lv, nu = sens(c["sensLevel"], cb["sensLevel"]), sens(c["sensNut"], cb["sensNut"])
    ii = True if (lv is True or nu is True) else (None if (lv is None and nu is None) else False)
    physacute = med([get("F", "anchor-phys-T-16-mid", "physarum", q)["late"]["r4"]["acute"] for q in FSL])
    ac, on_ = bl["late"]["r4"]["acute"], tr["late"]["r4"]["acute"]
    iii = physacute > 0 and on_ - ac >= 0.5 * physacute
    hpred.append(True if any(x_ is True for x_ in (i_, ii, iii)) else (None if any(x_ is None for x_ in (i_, ii, iii)) else False))
    gpred.append(tr["late"]["r4"]["speed"] >= 0.05 and tr["late"]["r4"]["speed"] >= 0.5 * bl["late"]["r4"]["speed"])
P(f"    (b) import true in {sum(1 for x_ in bpred if x_)}/8 (None {sum(1 for x_ in bpred if x_ is None)}), H true in {sum(1 for x_ in hpred if x_)}/8, G true in {sum(1 for x_ in gpred if x_)}/8   [SCREEN: (b) 4/8, H 1/8, G 8/8]")
if (sum(1 for x_ in bpred if x_), sum(1 for x_ in hpred if x_), sum(1 for x_ in gpred if x_)) != (4, 1, 8):
    disc(f"F predicates re-applied to stored values give (b) {sum(1 for x_ in bpred if x_)}, H {sum(1 for x_ in hpred if x_)}, G {sum(1 for x_ in gpred if x_)}; SCREEN prints 4, 1, 8")
gk = sum(1 for s_ in FSL if (get("F", "GHOST", "inherit", s_)["late"]["boot"]["tmAbove"] or 1e9) >= 0.1 or get("F", "GHOST", "inherit", s_)["late"]["boot"]["ghostCorr"] is None or get("F", "GHOST", "inherit", s_)["late"]["boot"]["ghostCorr"] > 0.5)
dk = sum(1 for s_ in FSL if (get("F", "DIFF", "inherit", s_)["late"]["boot"]["tmAbove"] or 1e9) >= 0.1)
P(f"    (f) GHOST kept {gk}/8, DIFF kept {dk}/8  [SCREEN: 7/8 and 8/8]; (b)(c)(f) are not used by the label (S in 6 of 8 matches rule 2 before they are reached)")
# log distinct seeds
log_seeds = {x["worldSeed"] for x in LOG if "worldSeed" in x}
P(f"7.5 distinct world seeds in the whole run-log: {len(log_seeds)} (SCREEN: '101 distinct world seeds logged after the screen, 0 not in the table'); in the real out dirs: {len({x['worldSeed'] for x in real if 'worldSeed' in x})}")
# scope items
P("7.6 scope: D0 is one pattern (rows), one strength (plateau q = 2, ext 31), one decay (pDecay 66), one light (gradient), inherit only, 8 seeds, 2,000 steps: ", dict(pattern=sorted({r['config'].get('trailInitPattern') for r in d0on.values()}), pDecay=sorted({r['config']['pDecay'] for r in d0on.values()}), cap=sorted({r['config'].get('trailConduitCap') for r in d0on.values()}), light=sorted({r['config']['lightPattern'] for r in d0on.values()})))
weak("D0 is the only place where the conduit is both operating (mean Dd +11 to +26 units over every edge) and the window is long (2,000 steps): one trail pattern (rows), one plateau strength (q 2), one decay (pDecay 66), gradient light, inherit heredity. A flat per-capita intake there says that this conduit on this carpet does not raise per-body intake; it does not extend to other patterns, strengths, decays or the unlit-uniform world where F and O live.")
weak("T windows: the road is alive (median laid-edge x_e >= 1 with the conduit on) only up to about step 300 (rows-G P2 on: median x_e 28 at step 10, 4 at 200, 1 at 300, 0 at 400), so W2 (300,1000] and W3 (1000,3000] read a dead road with the conduit having nothing to act on; those two windows carry no information on whether a road pays (the SCREEN does say T is unreadable, but its descriptive table and paragraph still present all three windows as evidence). Only W1 (0,300], inside the founder die-off/growth transient (n 1024 to 2022), reads a live road, and it shows +0.1% intake with a butterfly floor of 0.1%.")
weak("F evolving rows are survivor-conditioned in two seeds (L: no trail at all) and a third seed (TM 5 to 13) in the T-16-mid inherit branches (6.6): in 2 to 3 of 8 pairs the conduit-off branch compares nothing with nothing. The SCREEN says anchors carry the 'pays' reading, but the anchors carry the weakest conduit (eff p90 2 to 7 units).")

# ================================================================================================ 8. SIZING RE-DERIVATION (R1, R2, R3)
P()
P("=" * 100)
P("8. SIZING RULES R1, R2, R3 re-derived from the sizing run files (the frozen sizing is what every main command used)")
P("=" * 100)


def blockmeans(snaps, upto=400):
    out = {}
    for t in range(50, upto + 1, 50):
        v_ = [x["n"] for x in snaps if t - 50 < x["step"] <= t]
        out[t] = mean(v_)
    return out


for lab in ("base0-U", "base0-G"):
    runs_ = [j for j in sizing.values() if j["armId"] == lab]
    rows_ = []
    for t in range(150, 401, 50):
        ch = []
        for j in runs_:
            bm = blockmeans(j["snaps"])
            ch.append(abs(bm[t] - bm[t - 100]) / bm[t - 100])
        rows_.append((t, med(ch)))
    first = next((t for t, m_ in rows_ if m_ < 0.05), None)
    P(f"8.1 R1 {lab} ({len(runs_)} seeds): median |n(t)-n(t-100)|/n(t-100) on 50-step block means: " + ", ".join(f"t{t}: {m_:.3f}" for t, m_ in rows_) + f" -> first multiple of 50 under 5%: {first}  [SCREEN: U none by 400 (fallback 400), G 300]")
P("8.2 R2: share of laid cells with A >= 8 at step 10, median over the 2 seeds, S2 runs (default decay, gradient light):")
chosen = {}
for pat in ("rows", "cols", "lattice", "patches", "carpet"):
    row_ = []
    for v_ in (16, 24, 32, 48):
        js = [j for j in sizing.values() if j["series"] == "S2" and j["armId"] == f"{pat}-v{v_}"]
        sh = med([j["roadSeries"]["cols"]["laidA8"][j["roadSeries"]["step"].index(10)] for j in js])
        row_.append((v_, sh))
    ok = [v_ for v_, sh in row_ if sh is not None and sh >= 0.5]
    chosen[pat] = max(ok) if ok else None
    P(f"    {pat:8s}: " + ", ".join(f"v{v_}: {sh:.2f}" for v_, sh in row_) + f" -> v_p {chosen[pat]}")
P(f"    v = min over patterns = {min(x for x in chosen.values() if x)} [frozen v = {SZ['v']}]")
P("8.3 R3: last read with median laid-edge x_e >= q, S2 rows-v32 (2 seeds, default decay), reads every 50 plus 10: ")
for q in (1, 2, 3):
    per = []
    for j in [j for j in sizing.values() if j["series"] == "S2" and j["armId"] == "rows-v32"]:
        rs = j["roadSeries"]
        last = None
        for k, stp in enumerate(rs["step"]):
            if rs["cols"]["xMed"][k] is not None and rs["cols"]["xMed"][k] >= q:
                last = stp
        per.append(last)
    P(f"    q = {q}: per seed {per} (frozen {TALIVE[str(q)]}; main-run per-step reads give {road_alive[q]})")
weak("Sizing t_alive for q = 3 is 200 in the frozen sizing (reads on a 50-step grid, 2 seeds) while the 8 main rows-G.off runs read every step to 400 and give 227 to 234; for q = 1 and 2 the two agree (350 vs 345-377, 276 vs 270-282). It does not change any label (PW empty either way) but the frozen t_alive is a coarse, 2-seed number.")


# ================================================================================================ SUMMARY
P()
P("=" * 100)
P("SUMMARY")
P("=" * 100)
P(f"discrepancies collected: {len(DISC)}")
for k, s in enumerate(DISC, 1):
    P(f"  D{k}. {s}")
P(f"places the reading is weaker than the headline: {len(WEAK)}")
for k, s in enumerate(WEAK, 1):
    P(f"  W{k}. {s}")
