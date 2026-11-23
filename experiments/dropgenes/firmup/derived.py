"""Figures in FIRMUP-RESULTS.md that summarize.ts does not print directly.

Usage, from the worktree root:
  python3 -I runs/dropgenes/firmup/derived.py runs/dropgenes/firmup/a-gate                      # seeds 9 to 16
  python3 -I runs/dropgenes/firmup/derived.py ../browser-life-dropgenes/runs/dropgenes/confirm-v3  # seeds 5 to 8

Reads the LARGE two-gene files (large-K2-cap16-<ARM>-s<seed>.json) of the directory.
"""
import glob
import json
import statistics
import sys

d = sys.argv[1]
runs = {}
for f in sorted(glob.glob(d + "/large-K2-cap16-*.json")):
    doc = json.load(open(f))
    s = doc["summary"]
    arm = ("GATED" if s["gated"] else "UNGATED") + ("_PAR" if s["mutPar"] > 0 else "_CLEAN")
    runs.setdefault(arm, {})[s["seed"]] = doc


def rng(xs, digits=2):
    return f"{min(xs):.{digits}f} to {max(xs):.{digits}f}"


print("runs per arm:", {a: sorted(v) for a, v in runs.items()})
print("held per arm:", {a: f"{sum(1 for x in v.values() if x['summary']['held'])} of {len(v)}" for a, v in runs.items()})
print("residuals:", sorted({x["summary"]["residual"] for v in runs.values() for x in v.values()}))

gp, gc, uc = runs["GATED_PAR"], runs["GATED_CLEAN"], runs["UNGATED_CLEAN"]
print("late compartments, GATED_PAR / GATED_CLEAN, same seed:",
      rng([gp[k]["summary"]["lateMeanCompartments"] / gc[k]["summary"]["lateMeanCompartments"] for k in gp]))
print("gene-0 parent r, GATED_CLEAN minus UNGATED_CLEAN, same seed:",
      rng([gc[k]["summary"]["heredityGene0Delayed"]["parentR"] - uc[k]["summary"]["heredityGene0Delayed"]["parentR"] for k in gc]))
for arm, v in runs.items():
    hs = [x["summary"]["heredityGene0Delayed"] for x in v.values()]
    share = [h["read"] / (h["read"] + h["gone"] + h["fused"]) for h in hs]
    tot = {k: sum(h[k] for h in hs) for k in ("read", "gone", "fused", "pending")}
    print(f"{arm}: share of daughters read at 500 steps (read / (read + gone + fused)), per seed: {rng(share)}; totals {tot}")

full = [x["summary"] for v in runs.values() for x in v.values() if x["summary"]["stepsRun"] == x["summary"]["steps"]]
short = [x["summary"] for v in runs.values() for x in v.values() if x["summary"]["stepsRun"] < x["summary"]["steps"]]
sps = [s["stepsPerSecond"] for s in full]
print(f"runs that reached the end: {len(full)}; steps per second {min(sps):.0f} to {max(sps):.0f}, median {statistics.median(sps):.0f}; "
      f"seconds per run {min(s['seconds'] for s in full):.0f} to {max(s['seconds'] for s in full):.0f}")
if short:
    print(f"runs that ended early: {len(short)}; seconds per run {min(s['seconds'] for s in short):.0f} to {max(s['seconds'] for s in short):.0f}")
print(f"seconds summed over all runs: {sum(s['seconds'] for s in full + short):.0f}")
