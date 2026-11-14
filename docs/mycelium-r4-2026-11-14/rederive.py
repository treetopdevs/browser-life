#!/usr/bin/env python3 -I
"""Independent re-derivation of the R4 readouts, gates, endpoints and label from the raw series.json files (no TypeScript code used).

Usage: python3 -I rederive.py <root: runs/mycelium-r4> <phase: confirm|dev> [RESULT.json]  (the margins are read from CALIBRATION.json beside this file; the seed log and FROZEN beside it give the file hashes and the frozen code hash)

Recomputes, for every run file, the late-window readouts (trail per particle, the means of the R4 census columns, d, mean n, turnover, median age, guard)
by sequential accumulation in the same order as the TypeScript, then the toll-state split, the two gates, the anchor spans and margins, U1 and U2
(Cliff's delta exactly, Mann-Whitney p by numpy-RNG permutations, Holm), the Hodges-Lehmann shifts and numpy-RNG bootstrap intervals, the acute-effect
interval, the floor, the Fisher retention test, the endpoint statuses and the label with the population-guard rule. With RESULT.json it prints the
differences: readouts bit-equal, shifts and deltas equal to 1e-12, intervals and p within Monte Carlo error, statuses, gates and label equal.
"""
import hashlib, json, math, os, sys
import numpy as np

root, phase = sys.argv[1], sys.argv[2]
FAIL = []
def fail(msg): FAIL.append(msg); print("MISMATCH:", msg)
HERE = os.path.dirname(os.path.abspath(__file__))
MARGINS = json.load(open(os.path.join(HERE, "CALIBRATION.json")))["margins"] if os.path.exists(os.path.join(HERE, "CALIBRATION.json")) else None
res = json.load(open(sys.argv[3])) if len(sys.argv) > 3 else None
ARMS = ["inherit", "blocked", "physarum", "blind", "keyless"]
SLOTS = list(range(7001, 7017)) if phase == "confirm" else list(range(8001, 8021))
STEPS, LLO, MLO, MHI = 100_000, 50_000, 10_000, 20_000
ALPHA, DELTA_FLOOR, THETA, DETECT = 0.05, 0.5, 0.15, 0.25
ANCHOR_DELTA, MIN_SPAN_A, MIN_SPAN_O, MIN_ACUTE = 0.9, 0.5, 1.0, 0.5
FLOOR_REQ1, FLOOR_REQ2P, FLOOR_SAT, IN_STATE, MIN_IN_STATE, MATCH_BAND = 0.8, 0.1, 0.9, 10.0, 8, 0.10
BOOTS, MW_PERMS = 10_000, 200_000
KEYS = ["align", "alignBlind", "acute", "speed", "speedBlind", "gradFrac", "qualFrac", "occ", "occShift", "req0", "req1", "req2p", "sat", "sensDep", "sensMove", "sensAll"]

def seq_mean(a):
    t = 0.0
    for v in a: t += v
    return t / len(a)

def window_readouts(ser):
    sc, hv, r4 = ser["scalar"], ser["heavy"], ser["r4"]
    def scal(lo, hi):
        idx = [k for k, st in enumerate(sc["step"]) if lo < st <= hi]
        return idx
    def heavy(lo, hi):
        return [k for k, st in enumerate(hv["step"]) if lo < st <= hi]
    L, M = scal(LLO, STEPS), scal(MLO, MHI)
    tm = lambda idx: seq_mean([(sc["sumP"][k] / sc["n"][k] if sc["n"][k] else 0.0) for k in idx])
    hl = heavy(LLO, STEPS)
    out = {key: seq_mean([r4[key][k] for k in hl]) for key in KEYS}
    meanN = seq_mean([sc["n"][k] for k in L])
    k0, k1 = sc["step"].index(LLO), sc["step"].index(STEPS)
    births = sc["births"][k1] - sc["births"][k0]
    ages = [hv["medianAge"][k] for k in hl if hv["medianAge"][k] is not None]
    out.update(tmL=tm(L), tmM=tm(M), d=seq_mean([hv["d"][k] for k in hl]), n=meanN, turn=(1000 * births / ((STEPS - LLO) * meanN) if meanN > 0 else 0.0), age=(seq_mean(ages) if ages else 0.0), guard=min(sc["n"][k] for k in L) < 200)
    return out

OFFSET = dict(inherit=130_000, blocked=140_000, physarum=150_000, blind=160_000, keyless=170_000)
LOG = [json.loads(l) for l in open(os.path.join(HERE, "seed-log.jsonl")) if l.strip()]
FROZEN_CODE = next((l.split(":")[1].strip() for l in open(os.path.join(HERE, "FROZEN")) if l.startswith("code_hash:")), None)

def provenance(arm, slot, sha, f):
    """Provenance of a run file, independent of the TypeScript checks: the logged hash, identity, engine, ledger, frozen code and the arm's config."""
    at = f"{phase} {arm} {slot}"
    fin = [e for e in LOG if e["phase"] == phase and e["arm"] == arm and e["seed"] == slot and e["state"] == "finished"]
    if len(fin) != 1 or fin[0].get("fileSha256") != sha: fail(f"{at}: the seed log does not hold exactly one finished entry with this file's SHA-256")
    elif fin[0].get("digest") != f["digest"]: fail(f"{at}: the logged digest differs from the file's")
    if (f["format"], f["protocol"], f["phase"], f["arm"], f["seed"], f["steps"], f["engine"]) != ("mycelium-r4-run-1", "mycelium-r4", phase, arm, slot, STEPS, "gpu"): fail(f"{at}: identity, protocol, engine or length")
    if f["ledgerResidual"] != 0 or f["ledgerChecks"] != 1000: fail(f"{at}: ledger")
    if f["codeHash"] != FROZEN_CODE: fail(f"{at}: run under code {f['codeHash']}, FROZEN has {FROZEN_CODE}")
    c = f["config"]
    want = dict(inherit=dict(moveCost=12, trailMoveDiscount=64, trailDiscountMode="toll", heredity="inherit"), blocked=dict(moveCost=12, trailMoveDiscount=64, trailDiscountMode="toll", heredity="blocked"),
                physarum=dict(moveCost=12, trailMoveDiscount=64, trailDiscountMode="toll", heredity="frozen", controller="physarum", physarumDeposit=256),
                blind=dict(moveCost=12, trailMoveDiscount=64, trailDiscountMode="toll", heredity="inherit", blindTrailGradient=True), keyless=dict(moveCost=12, heredity="inherit"))[arm]
    if c.get("seed") != slot + OFFSET[arm]: fail(f"{at}: config seed {c.get('seed')} is not {slot + OFFSET[arm]}")
    for k, v in want.items():
        if c.get(k) != v: fail(f"{at}: config {k} is {c.get(k)!r}, expected {v!r}")
    for k in ("controller", "physarumDeposit", "blindTrailGradient", "trailMoveDiscount", "trailDiscountMode"):
        if k not in want and k in c: fail(f"{at}: config holds {k}, which this arm must not have")
    if (c.get("width"), c.get("height"), c.get("founders"), c.get("maxParticles")) != (128, 128, 1024, 8192): fail(f"{at}: config is not the default world")

runs = []
for arm in ARMS:
    for slot in SLOTS:
        raw = open(f"{root}/{phase}/{arm}/seed-{slot}/series.json", "rb").read()
        f = json.loads(raw)
        provenance(arm, slot, hashlib.sha256(raw).hexdigest(), f)
        r = window_readouts(f["series"])
        runs.append(dict(arm=arm, slot=slot, stored=f["readout"], sha=hashlib.sha256(raw).hexdigest(), **r))

def arm_of(rs, a): return sorted((r for r in rs if r["arm"] == a), key=lambda r: r["slot"])
def col(rs, k): return [r[k] for r in rs]

def cliff(x, y):
    x = np.asarray(x, dtype=float)[:, None]; y = np.asarray(y, dtype=float)[None, :]
    return float((np.sum(x > y) - np.sum(x < y)) / (x.size * y.size))

def exact_p(x, y):
    """Two-sided exact Mann-Whitney p without ties: P(|2U* - n1 n2| >= |2U - n1 n2|) from the Gaussian-binomial counts (own dynamic programme)."""
    n1, n2 = len(x), len(y)
    T = [[None] * (n2 + 1) for _ in range(n1 + 1)]
    for i in range(n1 + 1):
        for j in range(n2 + 1):
            if i == 0 or j == 0: T[i][j] = [1]; continue
            a, b = T[i - 1][j], T[i][j - 1]
            out = [0] * (i * j + 1)
            for u, v in enumerate(a): out[u + j] += v
            for u, v in enumerate(b): out[u] += v
            T[i][j] = out
    counts = T[n1][n2]; total = sum(counts)
    u2 = int(round((cliff(x, y) + 1) * n1 * n2))  # 2U = #(x>y)*2 + #ties, with no ties 2U = 2 * (#(x>y)); cliff = (g - l) / (n1 n2), g + l = n1 n2
    g = int(round((cliff(x, y) * n1 * n2 + n1 * n2) / 2))
    dev = abs(2 * g - n1 * n2)
    return sum(c for u, c in enumerate(counts) if abs(2 * u - n1 * n2) >= dev) / total

TIES = [False]
def mw_p(x, y):
    xs = list(x) + list(y)
    if len(set(xs)) == len(xs): return exact_p(x, y)
    TIES[0] = True  # a tie anywhere: both implementations use a permutation Monte Carlo (TypeScript 1,000,000, here MW_PERMS); the comparison then allows their sampling error
    return perm_p(x, y)

def perm_p(x, y, B=MW_PERMS, seed=20261114):
    rng = np.random.default_rng(seed)
    pooled = np.array(list(x) + list(y), dtype=float); n1 = len(x)
    obs = abs(cliff(x, y)); hits = 0
    for _ in range(B):
        rng.shuffle(pooled)
        if abs(cliff(pooled[:n1], pooled[n1:])) >= obs - 1e-12: hits += 1
    return (1 + hits) / (1 + B)

def hl_shift(x, y):
    d = np.subtract.outer(np.asarray(x, dtype=float), np.asarray(y, dtype=float)).ravel()
    return float(np.median(d))

def boot_hl_ci(x, y, B=BOOTS, seed=20261115):
    rng = np.random.default_rng(seed); x = np.asarray(x, dtype=float); y = np.asarray(y, dtype=float)
    hs = np.empty(B)
    for b in range(B):
        hs[b] = np.median(np.subtract.outer(x[rng.integers(0, len(x), len(x))], y[rng.integers(0, len(y), len(y))]))
    hs.sort()
    return float(hs[int(math.floor(0.025 * B))]), float(hs[min(B - 1, int(math.ceil(0.975 * B)) - 1)])

def boot_median_ci(x, B=BOOTS, seed=20261116):
    rng = np.random.default_rng(seed); x = np.asarray(x, dtype=float)
    ms = np.sort([np.median(x[rng.integers(0, len(x), len(x))]) for _ in range(B)])
    return float(ms[int(math.floor(0.025 * B))]), float(ms[min(B - 1, int(math.ceil(0.975 * B)) - 1)])

def holm(ps):
    order = sorted(range(len(ps)), key=lambda i: ps[i]); adj = [0.0] * len(ps); run = 0.0; stop = False; rej = [False] * len(ps)
    for k, i in enumerate(order):
        run = max(run, min(1.0, (len(ps) - k) * ps[i])); adj[i] = run
        if not stop and ps[i] <= ALPHA / (len(ps) - k): rej[i] = True
        else: stop = True
    return adj, rej

def fisher_two_sided(a, b, c, d):
    from math import lgamma, exp
    lf = lambda n: lgamma(n + 1)
    r1, r2, c1, n = a + b, c + d, a + c, a + b + c + d
    lp = lambda x: lf(r1) + lf(r2) + lf(c1) + lf(n - c1) - lf(n) - lf(x) - lf(r1 - x) - lf(c1 - x) - lf(r2 - c1 + x)
    obs = lp(a); p = 0.0
    for x in range(max(0, c1 - r2), min(r1, c1) + 1):
        if lp(x) <= obs + 1e-9: p += exp(lp(x))
    return min(1.0, p)

def status_two(reject, delta, hl, ci, m):
    if reject and delta >= DELTA_FLOOR and ci[0] > m: return "USE"
    if reject and delta >= DELTA_FLOOR and ci[0] > DETECT * m and ci[1] < m: return "SMALL"
    if reject and delta <= -DELTA_FLOOR and ci[1] < -DETECT * m: return "WRONG"
    return "EQUIV" if ci[0] > -m and ci[1] < m else "UNRESOLVED"

def core(rs):
    I, IB, PH = arm_of(rs, "inherit"), arm_of(rs, "blind"), arm_of(rs, "physarum")
    kept = lambda r: r["tmL"] >= IN_STATE
    Ik, IBk, PHk = [r for r in I if kept(r)], [r for r in IB if kept(r)], [r for r in PH if kept(r)]
    out = dict(counts={a: (sum(kept(r) for r in arm_of(rs, a)), len(arm_of(rs, a))) for a in ARMS}, label="INCONCLUSIVE", gateS=False, gateG=False, endpoints=[])
    if I and IB:
        ki, kb = out["counts"]["inherit"], out["counts"]["blind"]
        out["fisher"] = fisher_two_sided(ki[0], ki[1] - ki[0], kb[0], kb[1] - kb[0])
    if Ik and PHk:
        di, dp = float(np.median(col(Ik, "d"))), float(np.median(col(PHk, "d")))
        out["match"] = dict(inheritD=di, physarumD=dp, inBand=bool(di > 0 and abs(dp / di - 1) <= MATCH_BAND))
    out["gateS"] = len(Ik) >= MIN_IN_STATE and len(IBk) >= MIN_IN_STATE and len(PHk) >= MIN_IN_STATE
    if not out["gateS"]: return out
    spanA = float(np.median(col(PHk, "align")) - np.median(col(IBk, "align"))); spanO = float(np.median(col(PHk, "occ")) - np.median(col(IBk, "occ")))
    dA, dO = cliff(col(PHk, "align"), col(IBk, "align")), cliff(col(PHk, "occ"), col(IBk, "occ")); acPH = float(np.median(col(PHk, "acute")))
    out["anchor"] = dict(spanAlign=spanA, spanOcc=spanO, acute=acPH, sens=float(np.median(col(PHk, "sensAll"))), deltaAlign=dA, deltaOcc=dO)
    out["gateG"] = dA >= ANCHOR_DELTA and dO >= ANCHOR_DELTA and spanA >= MIN_SPAN_A and spanO >= MIN_SPAN_O and acPH >= MIN_ACUTE
    if not out["gateG"]: return out
    margins = dict(ALIGN=MARGINS["align"], OCC=MARGINS["occ"], ACUTE=MARGINS["acute"], SENS=MARGINS["sens"])
    ps = [mw_p(col(Ik, "align"), col(IBk, "align")), mw_p(col(Ik, "occ"), col(IBk, "occ"))]
    adj, rej = holm(ps)
    eps = []
    for i, (eid, key) in enumerate((("ALIGN", "align"), ("OCC", "occ"))):
        x, y = col(Ik, key), col(IBk, key); delta = cliff(x, y); hl = hl_shift(x, y); ci = boot_hl_ci(x, y)
        eps.append(dict(id=eid, shift=hl, ci=ci, delta=delta, p=ps[i], adj=adj[i], reject=rej[i], margin=margins[eid], status=status_two(rej[i], delta, hl, ci, margins[eid])))
    ac = col(Ik, "acute"); am = float(np.median(ac)); aci = boot_median_ci(ac); m = margins["ACUTE"]
    ast = "USE" if aci[0] > m else ("WRONG" if aci[1] < -DETECT * m else (("SMALL" if aci[0] > DETECT * m else "EQUIV") if aci[0] > -m and aci[1] < m else "UNRESOLVED"))
    eps.append(dict(id="ACUTE", shift=am, ci=aci, delta=None, p=None, adj=None, reject=False, margin=m, status=ast))
    se = col(Ik, "sensAll"); sm = float(np.median(se)); sci = boot_median_ci(se, seed=20261117); ms = margins["SENS"]
    eps.append(dict(id="SENS", shift=sm, ci=sci, delta=None, p=None, adj=None, reject=False, margin=ms, status="USE" if sci[0] > ms else ("EQUIV" if sci[1] < ms else "UNRESOLVED")))
    out["endpoints"] = eps
    fl = dict(req1=float(np.median(col(Ik, "req1"))), req2p=float(np.median(col(Ik, "req2p"))), sat=float(np.median(col(Ik, "sat"))))
    fl["ok"] = fl["req1"] >= FLOOR_REQ1 and fl["req2p"] <= FLOOR_REQ2P and fl["sat"] >= FLOOR_SAT
    out["floor"] = fl
    differs = out["fisher"] < ALPHA
    st = [e["status"] for e in eps]
    if all(s == "USE" for s in st): out["label"] = "FUNCTIONAL"
    elif all(s == "EQUIV" for s in st) and fl["ok"] and not differs: out["label"] = "TOLL-ONLY"
    elif all(s in ("EQUIV", "SMALL") for s in st) and fl["ok"] and not differs: out["label"] = "MINOR-USE"
    return out

def decide(rs):
    main = core(rs); label = main["label"]
    flagged = [r for r in rs if r["guard"]]; without = None
    if flagged:
        without = core([r for r in rs if not r["guard"]])["label"]
        if without != label: label = "INCONCLUSIVE"
    return main, label, flagged, without

bad = 0
NUM = ["tmL", "tmM", "align", "alignBlind", "acute", "occ", "occShift", "req1", "req2p", "sat", "speed", "speedBlind", "sensMove", "sensAll", "d", "n", "turn", "age"]
for r in runs:
    for k in NUM:
        if r["stored"][k] != r[k]:
            bad += 1; print("READOUT MISMATCH", r["arm"], r["slot"], k, r["stored"][k], r[k])
    if r["stored"]["guard"] != r["guard"]: bad += 1; print("GUARD MISMATCH", r["arm"], r["slot"])
print(f"readout mismatches against the stored values (bit equality): {bad} of {(len(NUM) + 1) * len(runs)}")
if bad: fail(f"{bad} stored readout(s) differ from the recomputation")
for a in ARMS:
    rs = arm_of(runs, a); k = [r for r in rs if r["tmL"] >= IN_STATE]
    med = lambda key, s: f"{np.median(col(s, key)):.5g}" if s else "-"
    print(f"{a:9s} n {len(rs)} kept {len(k)}  median tmL {np.median(col(rs, 'tmL')):.5g}  in-state: n {med('n', k)} d {med('d', k)} align {med('align', k)} acute {med('acute', k)} occ {med('occ', k)} req1 {med('req1', k)} sat {med('sat', k)}")

def dev_margins():
    """The fixed margins re-derived from the dev runs: THETA x the in-state physarum-minus-blind spans (and the physarum ACUTE and SENS medians)."""
    devroot = f"{root}/dev"
    if not os.path.isdir(devroot): return None
    rs = []
    for arm in ("blind", "physarum"):
        for slot in range(8001, 8021):
            f = json.loads(open(f"{devroot}/{arm}/seed-{slot}/series.json", "rb").read())
            rs.append(dict(arm=arm, slot=slot, **window_readouts(f["series"])))
    IBk = [r for r in rs if r["arm"] == "blind" and r["tmL"] >= IN_STATE]; PHk = [r for r in rs if r["arm"] == "physarum" and r["tmL"] >= IN_STATE]
    return dict(align=THETA * float(np.median(col(PHk, "align")) - np.median(col(IBk, "align"))), occ=THETA * float(np.median(col(PHk, "occ")) - np.median(col(IBk, "occ"))),
                acute=THETA * float(np.median(col(PHk, "acute"))), sens=THETA * float(np.median(col(PHk, "sensAll"))))
dm = dev_margins()
if MARGINS is None:
    if phase != "dev" or dm is None: sys.exit("CALIBRATION.json (with margins) is missing beside rederive.py")
    MARGINS = dm  # before calibration: the dev decision uses the margins it would fix
if dm is None: print("no dev runs under the root: margins not re-derived (taken from CALIBRATION.json)")
else:
    for k in ("align", "occ", "acute", "sens"):
        if abs(dm[k] - MARGINS[k]) > 1e-12: fail(f"margin {k}: re-derived from dev {dm[k]!r}, CALIBRATION.json {MARGINS[k]!r}")
    print("margins re-derived from the dev runs:", {k: round(v, 8) for k, v in dm.items()}, "match CALIBRATION.json" if not FAIL else "DIFFER")
main, label, flagged, without = decide(runs)
print(f"counts (kept/n): {main['counts']}; gate S {main['gateS']}; gate G {main['gateG']}; Fisher p {main.get('fisher')}; match {main.get('match')}")
if main.get("anchor"): print("anchor:", {k: round(v, 6) for k, v in main["anchor"].items()})
for e in main["endpoints"]: print(f"{e['id']:5s} shift {e['shift']:+.5f} CI [{e['ci'][0]:+.5f}, {e['ci'][1]:+.5f}] margin {e['margin']:.5f} delta {e['delta']} p {e['p']} Holm {e['adj']} {e['status']}")
if main.get("floor"): print("floor:", main["floor"])
print(f"guard-flagged runs: {len(flagged)}; label without them: {without}")
print(f"LABEL {label}")
if res and phase == "confirm":
    D = res["decision"]
    def check(name, cond):
        if not cond: fail(name)
        return "OK" if cond else "DIFFERS"
    close = lambda a, b, tol=1e-12: (a is None and b is None) or (a is not None and b is not None and abs(a - b) <= tol)
    print(f"gate S TS {D['gates']['S']['ok']} PY {main['gateS']} {check('gate S', D['gates']['S']['ok'] == main['gateS'])}; gate G TS {D['gates']['G']['ok']} PY {main['gateG']} {check('gate G', D['gates']['G']['ok'] == main['gateG'])}")
    for a in ARMS:
        same = (D["counts"][a]["kept"], D["counts"][a]["n"]) == tuple(main["counts"][a])
        print(f"counts {a}: TS {D['counts'][a]} PY {main['counts'][a]} {check('counts ' + a, same)}")
    if "fisher" in main: print(f"Fisher p TS {D['retention']['fisherP']:.6g} PY {main['fisher']:.6g} {check('fisher', abs(D['retention']['fisherP'] - main['fisher']) < 1e-9)}")
    if "match" in main:
        m, t = main["match"], D["match"]
        check("match ratio", close(t["ratio"], (m["physarumD"] / m["inheritD"]) if m["inheritD"] > 0 else None))
        print(f"match: inherit d TS {t['inheritD']:.6g} PY {m['inheritD']:.6g}; physarum d TS {t['physarumD']:.6g} PY {m['physarumD']:.6g}; in band TS {t['inBand']} PY {m['inBand']} {check('match', close(t['inheritD'], m['inheritD']) and close(t['physarumD'], m['physarumD']) and t['inBand'] == m['inBand'])}")
    if main.get("anchor"):
        an, ta = main["anchor"], D["anchor"]
        ok_a = all(close(an[k], ta[{'spanAlign': 'spanAlign', 'spanOcc': 'spanOcc', 'acute': 'acute', 'sens': 'sens', 'deltaAlign': 'deltaAlign', 'deltaOcc': 'deltaOcc'}[k]]) for k in an)
        print(f"anchor: TS {{{', '.join(f'{k}: {ta[k]:.6g}' for k in an)}}} {check('anchor', ok_a)}")
    for k, kk in (("align", "ALIGN"), ("occ", "OCC"), ("acute", "ACUTE"), ("sens", "SENS")): check("margin " + k + " used", close(D["margins"][k], MARGINS[k]))
    check("endpoint count", len(D["endpoints"]) == len(main["endpoints"]))
    for e, t in zip(main["endpoints"], D["endpoints"]):
        check("endpoint id " + e["id"], e["id"] == t["id"])
        dsh = abs(e["shift"] - t["shift"]); dd = 0.0 if e["delta"] is None else abs(e["delta"] - t["delta"])
        ciw = max(abs(e["ci"][0] - t["ci"][0]), abs(e["ci"][1] - t["ci"][1]))
        width = max(e["ci"][1] - e["ci"][0], 1e-12)
        pdiff = 0.0 if e["p"] is None else abs(e["p"] - t["p"]); adiff = 0.0 if e["adj"] is None else abs(e["adj"] - t["adjusted"])
        # exact p-values (no ties) must agree to 1e-9; with ties both are Monte Carlo: allow 4 standard errors of the difference (and twice that after Holm's factor of up to 2)
        ptol = 1e-9 if not TIES[0] or e["p"] is None else 4 * math.sqrt(max(e["p"] * (1 - e["p"]), 1e-12) * (1 / 1_000_000 + 1 / MW_PERMS)) + 1e-9
        # two-sample shifts, deltas and exact p-values are deterministic (no ties in real data); the bootstrap endpoints are Monte Carlo with a different RNG: allowed 15% of the interval width
        same = dsh < 1e-12 and dd < 1e-12 and e["status"] == t["status"] and abs(e["margin"] - t["margin"]) < 1e-12 and e["reject"] == t["reject"] and ciw <= 0.15 * width and pdiff <= ptol and adiff <= 2 * ptol
        print(f"{e['id']}: shift diff {dsh:.1e}, delta diff {dd:.1e}, CI end diff {ciw:.4g} (allowed {0.15 * width:.3g}), p diff {pdiff:.1e}, Holm diff {adiff:.1e}, reject TS {t['reject']} PY {e['reject']}, status TS {t['status']} PY {e['status']} {check(e['id'], same)}")
    if "floor" in main:
        f, tf = main["floor"], D["floor"]
        print(f"floor: TS req1 {tf['req1']:.6g} req2p {tf['req2p']:.6g} sat {tf['sat']:.6g} ok {tf['ok']}; PY req1 {f['req1']:.6g} req2p {f['req2p']:.6g} sat {f['sat']:.6g} ok {f['ok']} {check('floor', close(f['req1'], tf['req1']) and close(f['req2p'], tf['req2p']) and close(f['sat'], tf['sat']) and f['ok'] == tf['ok'])}")
    ident = sorted((r["arm"], r["slot"]) for r in flagged); tident = sorted((g["arm"], g["slot"]) for g in D["guard"]["tripped"])
    sens = without is not None and without != main["label"]
    print(f"guard: flagged TS {len(tident)} PY {len(ident)}, identities {'equal' if ident == tident else 'DIFFER'}; label without TS {D['guard']['labelWithout']} PY {without}; sensitive TS {D['guard']['sensitive']} PY {sens} {check('guard', ident == tident and D['guard']['labelWithout'] == without and D['guard']['sensitive'] == sens)}")
    print(f"label TS {res['label']} PY {label}  {check('label', res['label'] == label)}")
print("ALL AGREE" if not FAIL else f"DISAGREEMENT ({len(FAIL)}): " + "; ".join(FAIL))
sys.exit(0 if not FAIL else 1)
