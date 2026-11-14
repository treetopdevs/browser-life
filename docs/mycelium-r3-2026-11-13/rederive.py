#!/usr/bin/env python3 -I
"""Independent re-derivation of the R3 readouts, tests and label from the raw series.json files (no TypeScript code used).

Usage: python3 -I rederive.py <root: runs/mycelium-r3> <phase: confirm|dev> [RESULT.json]

Recomputes, for every run file, dE, dL, tmE, tmL by sequential accumulation (the same order as the TypeScript, so equality is exact), then
D1, D2, D3 (Cliff's delta exactly; Mann-Whitney p and the trend p by numpy-RNG permutations, not the TypeScript PRNG), Holm, C1, the label with
the population-guard rule (the whole decision is recomputed without the flagged runs) and the five-way frozen reading. With RESULT.json it prints the
differences against the TypeScript analysis: readouts must be bit-equal, effects equal to 1e-12, p within Monte Carlo error, label and readings equal.
"""
import hashlib, itertools, json, sys
import numpy as np

root, phase = sys.argv[1], sys.argv[2]
res = json.load(open(sys.argv[3])) if len(sys.argv) > 3 else None
ARMS = ["inherit", "blocked", "frozen", "inherit-c1", "inherit-c4", "blocked-c1", "blocked-c4"]
SLOTS = list(range(6001, 6017)) if phase == "confirm" else list(range(2001, 2011))
if phase == "dev":
    ARMS = ["frozen", "inherit-c1", "inherit-c4", "blocked-c1", "blocked-c4"]
E, L = (0, 5000), (50000, 100000)
ALPHA, FLOOR_D, FLOOR_T, TM_C, MIN_GROUP = 0.05, 0.5, 0.25, 0.33, 3
MW_B, JT_B = 200_000, 50_000

def seq_sum(a):
    t = 0.0
    for v in a: t += v
    return t

def window(series, lo, hi):
    sc, hv = series["scalar"], series["heavy"]
    tm = [(sp / n if n else 0.0) for st, n, sp in zip(sc["step"], sc["n"], sc["sumP"]) if lo < st <= hi]
    ns = [n for st, n in zip(sc["step"], sc["n"]) if lo < st <= hi]
    d = [x for st, x in zip(hv["step"], hv["d"]) if lo < st <= hi]
    return seq_sum(tm) / len(tm), seq_sum(d) / len(d), min(ns)

runs = []  # one dict per run
for arm in ARMS:
    for slot in SLOTS:
        raw = open(f"{root}/{phase}/{arm}/seed-{slot}/series.json", "rb").read()
        f = json.loads(raw)
        assert f["ledgerResidual"] == 0 and f["ledgerChecks"] == 1000
        tmE, dE, nE = window(f["series"], *E)
        tmL, dL, nL = window(f["series"], *L)
        runs.append(dict(arm=arm, slot=slot, dE=dE, dL=dL, tmE=tmE, tmL=tmL, guard=min(nE, nL) < 200, stored=f["readout"], sha=hashlib.sha256(raw).hexdigest()))

def cliff(x, y):
    x = np.asarray(x, dtype=float)[:, None]; y = np.asarray(y, dtype=float)[None, :]
    return float((np.sum(x > y) - np.sum(x < y)) / (x.size * y.size))

def perm_p(x, y, B=MW_B, seed=20261113):
    rng = np.random.default_rng(seed)
    pooled = np.array(list(x) + list(y), dtype=float); n1 = len(x)
    obs = abs(cliff(x, y)); hits = 0
    for _ in range(B):
        rng.shuffle(pooled)
        if abs(cliff(pooled[:n1], pooled[n1:])) >= obs - 1e-12: hits += 1
    return (1 + hits) / (1 + B)

def jt(groups):
    pairs = list(itertools.combinations(groups, 2))
    return sum(cliff(a, b) for a, b in pairs) / len(pairs)

def jt_p(groups, B=JT_B, seed=20261114):
    rng = np.random.default_rng(seed)
    sizes = [len(g) for g in groups]; pooled = np.array([v for g in groups for v in g], dtype=float)
    obs = abs(jt(groups)); hits = 0
    for _ in range(B):
        rng.shuffle(pooled)
        if abs(jt(np.split(pooled, np.cumsum(sizes)[:-1]))) >= obs - 1e-12: hits += 1
    return (1 + hits) / (1 + B)

def holm(ps):
    order = sorted(range(len(ps)), key=lambda i: ps[i]); adj = [0.0] * len(ps); run = 0.0; stop = False; rej = [False] * len(ps)
    for k, i in enumerate(order):
        run = max(run, min(1.0, (len(ps) - k) * ps[i])); adj[i] = run
        if not stop and ps[i] <= ALPHA / (len(ps) - k): rej[i] = True
        else: stop = True
    return adj, rej

def g(dE, dL):
    return -1.0 if dE + dL == 0 else (dL - dE) / (dL + dE)

def arm_of(rs, a): return sorted((r for r in rs if r["arm"] == a), key=lambda r: r["slot"])

def decide(rs, quick=False):
    """The registered decision on a set of runs. Returns the tests, C1, the label (without the guard rule) and the frozen reading."""
    B1, B2 = (4000, 4000) if quick else (MW_B, JT_B)
    inh, blk, fz = arm_of(rs, "inherit"), arm_of(rs, "blocked"), arm_of(rs, "frozen")
    tests = []
    def two(name, x, y):
        if len(x) < MIN_GROUP or len(y) < MIN_GROUP: tests.append(dict(id=name, effect=0.0, p=1.0, valid=False)); return
        tests.append(dict(id=name, effect=-cliff(x, y), p=perm_p(x, y, B1), valid=True))
    two("D1", [r["dL"] for r in inh], [r["dL"] for r in blk])
    two("D2", [g(r["dE"], r["dL"]) for r in inh], [g(r["dE"], r["dL"]) for r in blk])
    groups, undefined = [], False
    for ia, ba in (("inherit-c1", "blocked-c1"), ("inherit", "blocked"), ("inherit-c4", "blocked-c4")):
        bs = {r["slot"]: r["dE"] for r in arm_of(rs, ba)}; zs = []
        for r in arm_of(rs, ia):
            if r["slot"] not in bs: continue
            if not bs[r["slot"]] > 0: undefined = True; continue
            zs.append(r["dE"] / bs[r["slot"]])
        groups.append(zs)
    if undefined or any(len(z) < MIN_GROUP for z in groups): tests.append(dict(id="D3", effect=0.0, p=1.0, valid=False))
    else: tests.append(dict(id="D3", effect=jt(groups), p=jt_p(groups, B2), valid=True))
    adj, rej = holm([t["p"] for t in tests])
    for t, a, r_, fl in zip(tests, adj, rej, (FLOOR_D, FLOOR_D, FLOOR_T)):
        t["adj"], t["reject"] = a, r_
        t["verdict"] = "NULL" if not t["valid"] else "SUPPORT" if r_ and t["effect"] >= fl else "CONTRADICT" if r_ and t["effect"] <= -fl else "NULL"
    c1 = cliff([r["tmL"] for r in inh], [r["tmL"] for r in blk]) if len(inh) >= MIN_GROUP and len(blk) >= MIN_GROUP else None
    c1ok = c1 is not None and c1 <= -TM_C
    label = "FAIL" if any(t["verdict"] == "CONTRADICT" for t in tests) else "PASS" if all(t["verdict"] == "SUPPORT" for t in tests) and c1ok else "INCONCLUSIVE"
    frozen = None
    if len(fz) >= MIN_GROUP and len(blk) >= MIN_GROUP:
        fb = (cliff([r["dL"] for r in fz], [r["dL"] for r in blk]), perm_p([r["dL"] for r in fz], [r["dL"] for r in blk], B1))
        fi = (cliff([r["dL"] for r in inh], [r["dL"] for r in fz]), perm_p([r["dL"] for r in inh], [r["dL"] for r in fz], B1)) if len(inh) >= MIN_GROUP else None
        ib = (cliff([r["dL"] for r in inh], [r["dL"] for r in blk]), perm_p([r["dL"] for r in inh], [r["dL"] for r in blk], B1)) if len(inh) >= MIN_GROUP else None
        low = fb[0] <= -FLOOR_D and fb[1] < ALPHA
        below = None if fi is None else fi[0] <= -FLOOR_D and fi[1] < ALPHA
        purge = None if ib is None else ib[0] <= -FLOOR_D and ib[1] < ALPHA
        interp = None if purge is None or below is None else "NO-PURGE" if not purge else ("FROZEN-PLUS-MUTATION" if below else "FROZEN-SUFFICES") if low else ("MUTATION-NEEDED" if below else "UNRESOLVED")
        frozen = dict(vsBlocked=fb, inheritVsFrozen=fi, inheritVsBlocked=ib, reading="FROZEN-LOW" if low else "FROZEN-NOT-LOW", interpretation=interp)
    return dict(tests=tests, c1=c1, label=label, frozen=frozen)

bad = 0
for r in runs:
    for k in ("dE", "dL", "tmE", "tmL"):
        if r["stored"][k] != r[k]:
            bad += 1; print("READOUT MISMATCH", r["arm"], r["slot"], k, r["stored"][k], r[k])
    if r["stored"]["guard"] != r["guard"]: bad += 1; print("GUARD MISMATCH", r["arm"], r["slot"])
print(f"readout mismatches against the stored values (bit equality): {bad} of {5*len(runs)}")
for a in ARMS:
    rs = arm_of(runs, a)
    print(f"{a:12s} n {len(rs)} median dE {np.median([r['dE'] for r in rs]):.5g} dL {np.median([r['dL'] for r in rs]):.5g} tmE {np.median([r['tmE'] for r in rs]):.5g} tmL {np.median([r['tmL'] for r in rs]):.5g}")

if phase == "confirm":
    main = decide(runs)
    label = main["label"]
    flagged = [r for r in runs if r["guard"]]
    without = None
    if flagged:
        without = decide([r for r in runs if not r["guard"]])["label"]
        if without != label: label = "INCONCLUSIVE"
    for t in main["tests"]: print(f"{t['id']}: effect {t['effect']:+.4f}  p {t['p']:.6g}  Holm {t['adj']:.6g}  {t['verdict']}")
    print(f"C1 delta {main['c1']}")
    f = main["frozen"]
    if f: print(f"frozen: vs blocked {f['vsBlocked']}, inherit vs frozen {f['inheritVsFrozen']}, inherit vs blocked {f['inheritVsBlocked']}: {f['reading']} -> {f['interpretation']}")
    print(f"guard-flagged runs: {len(flagged)}; label without them: {without}")
    print(f"LABEL {label}")
    if res:
        ts = {t["id"]: t for t in res["decision"]["tests"]}
        ok = True
        for t in main["tests"]:
            T = ts[t["id"]]
            d = abs(T["effect"] - t["effect"]); pdiff = abs(T["p"] - t["p"])
            flag = d < 1e-12 and T["verdict"] == t["verdict"]
            ok &= flag
            print(f"{t['id']}: TS effect {T['effect']:+.6f} PY {t['effect']:+.6f} (diff {d:.2e}); TS p {T['p']:.6g} PY {t['p']:.6g}; verdict TS {T['verdict']} PY {t['verdict']}  {'OK' if flag else 'DIFFERS'}")
        tf = res["decision"]["frozen"]
        fl = f["interpretation"] == tf["interpretation"] if f else None
        print(f"frozen interpretation TS {tf['interpretation']} PY {f['interpretation'] if f else None}  {'OK' if fl else 'DIFFERS'}")
        print(f"label TS {res['label']} PY {label}  {'OK' if res['label'] == label else 'DIFFERS'}")
        print("ALL AGREE" if ok and fl and res["label"] == label and bad == 0 else "DISAGREEMENT")
