"""Part B of the droplet-genes firm-up: per-run rows, cell counts and the figures in FIRMUP-B-RESULTS.md that
summarize.ts does not print (unrounded ranges for the B3 property reading, B4 per-area figures, speeds).

Usage, from the worktree root (kept with the raw runs, not in git):
  python3 -I runs/dropgenes/firmup/derived_b.py runs/dropgenes/firmup

Reads the run files directly (not the summariser's output): a-gate-s9-12 (copies of Part A's seeds 9 to 12),
b1-k3, b2-dose, b3-unbundle, b4-128, whichever exist. It prints counts and figures; the labels in the write-up
are applied by hand from FIRMUP-PLAN.md and this script prints the same decision trees as a cross-check.
"""
import glob
import json
import os
import re
import statistics
import sys

root = sys.argv[1]
NAME = re.compile(r"^(?:(.+)-)?K(\d+)-cap(\d+)-([A-Z_]+)-s(\d+)\.json$")


def load(d):
    """{(tag, K, arm): {seed: doc}} for one directory."""
    cells = {}
    for f in sorted(glob.glob(os.path.join(root, d, "*.json"))):
        m = NAME.match(os.path.basename(f))
        doc = json.load(open(f))
        s = doc["summary"]
        arm = ("GATED" if s["gated"] else "UNGATED") + ("_PAR" if s["mutPar"] > 0 else "_CLEAN")
        assert arm == m.group(4) and s["genes"] == int(m.group(2)) and s["seed"] == int(m.group(5)), f
        assert s["residual"] == "0", f"{f}: residual {s['residual']}"
        # "held" recomputed from the two late figures, and checked against the flag the runner wrote
        held = s["lateMeanCompartments"] >= 10 and s["lateCompleteShare"] >= 0.5
        assert held == s["held"], f
        cells.setdefault((m.group(1) or "default", s["genes"], arm), {})[s["seed"]] = doc
    return cells


def state(cell):
    n = sum(1 for d in cell.values() if d["summary"]["held"])
    assert sorted(cell) == [9, 10, 11, 12], sorted(cell)
    return n, ("held" if n >= 3 else "not held" if n <= 1 else "unclear (2 of 4)")


def late_rows(doc):
    s = doc["summary"]
    frm = s["steps"] - s["steps"] // 10
    return [r for r in doc["rows"] if r["step"] > frm]


def late_mean(doc, key):
    vs = [r[key] for r in late_rows(doc) if r.get(key) is not None]
    return sum(vs) / len(vs) if vs else None


def turnover(doc):
    s, rows = doc["summary"], doc["rows"]
    if not rows or s["deaths"] <= 0 or s["stepsRun"] < s["steps"]:
        return None
    return sum(r["compartments"] for r in rows) / len(rows) * s["stepsRun"] / s["deaths"]


PROPS = {
    "compartment count": lambda d: d["summary"]["lateMeanCompartments"],
    "mean area, tiles": lambda d: late_mean(d, "meanArea"),
    "copies per compartment": lambda d: late_mean(d, "meanCopies"),
    "median age at death, steps": lambda d: d["summary"]["ages"]["observedDeaths"]["median"],
    "turnover time, steps": turnover,
    "median age of those alive at the end, steps": lambda d: d["summary"]["ages"]["aliveAtEnd"]["median"],
}


def show(d, cells):
    print(f"\n## {d}")
    for key in sorted(cells):
        cell = cells[key]
        n, st = state(cell)
        print(f"{key[0]} K{key[1]} {key[2]}: held {n} of 4 -> {st}")
        for seed in sorted(cell):
            s = cell[seed]["summary"]
            ps = late_mean(cell[seed], "parasiteShare")
            after = [r["compartments"] for r in cell[seed]["rows"] if r["step"] >= 10000]
            low = f" lowestRowFrom10k={min(after)}" if after else ""
            pr = [r["parasiteShare"] for r in cell[seed]["rows"] if r.get("parasiteShare") is not None]
            if pr and s["mutPar"] > 0:
                low += f" parasiteRowMax={max(pr):.3f} rowsWithParasite={sum(1 for v in pr if v > 0)}/{len(pr)}"
            print(f"    s{seed}: held={s['held']} comps={s['lateMeanCompartments']:.2f} complete={s['lateCompleteShare']:.3f}{low} "
                  f"stepsRun={s['stepsRun']} parasite={'n/a' if ps is None else format(ps, '.3f')} "
                  f"size={s['config']['width']} {s['seconds']:.0f}s {s['stepsPerSecond']:.0f}/s")
    ss = [d2["summary"] for c in cells.values() for d2 in c.values()]
    full = [s for s in ss if s["stepsRun"] == s["steps"]]
    if full:
        sps = [s["stepsPerSecond"] for s in full]
        print(f"runs: {len(ss)}; reached the end: {len(full)}; steps/s {min(sps):.0f} to {max(sps):.0f} (median {statistics.median(sps):.0f}); "
              f"seconds per full run {min(s['seconds'] for s in full):.0f} to {max(s['seconds'] for s in full):.0f}")
    print(f"seconds summed over runs: {sum(s['seconds'] for s in ss):.0f} ({sum(s['seconds'] for s in ss) / 3600:.2f} h)")


dirs = {d: load(d) for d in ("a-gate-s9-12", "b1-k3", "b2-dose", "b3-unbundle", "b4-128") if os.path.isdir(os.path.join(root, d))}
for d, cells in dirs.items():
    show(d, cells)

ref = dirs.get("a-gate-s9-12", {})


def ratios(label, num, den):
    """Late compartments of one cell over another, same seed, for seeds where both runs reached the end."""
    vs = [num[k]["summary"]["lateMeanCompartments"] / den[k]["summary"]["lateMeanCompartments"]
          for k in sorted(num) if k in den and num[k]["summary"]["stepsRun"] == num[k]["summary"]["steps"] and den[k]["summary"]["lateMeanCompartments"] > 0]
    if vs:
        print(f"  {label}: " + ", ".join(f"{v:.4f}" for v in vs) + f"  (range {min(vs):.2f} to {max(vs):.2f}, {len(vs)} seeds)")


print("\n## Same-seed ratios of late compartments")
PAIRS = [
    ("a-gate-s9-12", "large", 2, "LARGE K2, GATED_PAR / GATED_CLEAN"),
    ("b1-k3", "large", 3, "LARGE K3, GATED_PAR / GATED_CLEAN"),
    ("b3-unbundle", "fuel", 2, "fuel only, GATED_PAR / GATED_CLEAN"),
    ("b4-128", "large128", 2, "LARGE 128 x 128, GATED_PAR / GATED_CLEAN"),
]
for d, tag, k, label in PAIRS:
    c = dirs.get(d, {})
    if (tag, k, "GATED_PAR") in c and (tag, k, "GATED_CLEAN") in c:
        ratios(label, c[(tag, k, "GATED_PAR")], c[(tag, k, "GATED_CLEAN")])
c = dirs.get("b2-dose", {})
if ("large-m1e6", 2, "UNGATED_PAR") in c:
    ratios("mutPar 1e-6, UNGATED_PAR / GATED_PAR", c[("large-m1e6", 2, "UNGATED_PAR")], c[("large-m1e6", 2, "GATED_PAR")])

if "b1-k3" in dirs:
    c = dirs["b1-k3"]
    st = {arm: state(c[("large", 3, arm)]) for arm in ("GATED_CLEAN", "GATED_PAR", "UNGATED_CLEAN", "UNGATED_PAR") if ("large", 3, arm) in c}
    print("\n## B1 reading:", st)
    for arm in ("GATED_CLEAN", "GATED_PAR", "UNGATED_CLEAN", "UNGATED_PAR"):
        if ("large", 3, arm) in c:
            near = [seed for seed, d2 in c[("large", 3, arm)].items()
                    if d2["summary"]["lateCompleteShare"] >= 0.5 and d2["summary"]["lateMeanCompartments"] < 10]
            print(f"  {arm}: seeds missing 'held' on the compartment count alone: {near or 'none'}")

if "b3-unbundle" in dirs:
    c = dict(dirs["b3-unbundle"])
    for k, v in ref.items():
        c[k] = v
    print("\n## B3 properties, GATED_CLEAN, unrounded min and max over seeds 9 to 12")
    settings = [t for t in ("default", "wall", "fuel", "large") if (t, 2, "GATED_CLEAN") in c]
    gp_state = {t: state(c[(t, 2, "GATED_PAR")])[1] for t in settings if (t, 2, "GATED_PAR") in c}
    gc_state = {t: state(c[(t, 2, "GATED_CLEAN")])[1] for t in settings}
    print("GATED_CLEAN:", gc_state, "GATED_PAR:", gp_state)
    qualifies = len(settings) == 4 and all(gc_state[t] == "held" for t in settings) and all(gp_state.get(t) in ("held", "not held") for t in settings)
    print("all four settings qualify:", qualifies)
    for arm in ("GATED_CLEAN", "GATED_PAR"):
        print(f"-- {arm}")
        for name, fn in PROPS.items():
            line = []
            rngs = {}
            for t in settings:
                if (t, 2, arm) not in c:
                    continue
                vs = [fn(c[(t, 2, arm)][seed]) for seed in (9, 10, 11, 12)]
                ok = [v for v in vs if v is not None]
                rngs[t] = (min(ok), max(ok), len(ok)) if ok else None
                line.append(f"{t}: " + ("n/a" if not ok else f"{min(ok):.3f} to {max(ok):.3f}" + ("" if len(ok) == 4 else f" ({len(ok)} of 4)")))
            verdict = ""
            if arm == "GATED_CLEAN" and qualifies:
                held = [rngs[t] for t in settings if gp_state[t] == "held"]
                lost = [rngs[t] for t in settings if gp_state[t] == "not held"]
                if not held or not lost:
                    verdict = " => not read (all settings on one side)"
                elif any(r is None or r[2] < 4 for r in held + lost):
                    verdict = " => not read (a value is missing)"
                else:
                    above = min(r[0] for r in held) > max(r[1] for r in lost)
                    below = max(r[1] for r in held) < min(r[0] for r in lost)
                    verdict = " => lines up with holding" if above or below else " => does not line up with holding"
            print(f"  {name}: " + "; ".join(line) + verdict)

if "b4-128" in dirs:
    c = dirs["b4-128"]
    print("\n## B4 per-area figures (128 x 128 = 4 x 4,096 tiles)")
    for arm in ("GATED_PAR", "GATED_CLEAN", "UNGATED_CLEAN", "UNGATED_PAR"):
        if ("large128", 2, arm) not in c:
            continue
        for seed in sorted(c[("large128", 2, arm)]):
            s = c[("large128", 2, arm)][seed]["summary"]
            r = ref.get(("large", 2, arm), {}).get(seed)
            rs = r["summary"] if r else None
            print(f"  {arm} s{seed}: late comps {s['lateMeanCompartments']:.2f} (at least 40: {s['lateMeanCompartments'] >= 40}), "
                  f"per 4,096 tiles {s['lateMeanCompartments'] / 4:.2f}, 64 x 64 same seed {rs['lateMeanCompartments'] if rs else 'n/a'}; "
                  f"stepsRun {s['stepsRun']} (64 x 64: {rs['stepsRun'] if rs else 'n/a'})")
