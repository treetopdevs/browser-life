#!/usr/bin/env python3 -I
"""Exact bootstrap 95% percentile interval of the median of the in-state inherit ACUTE and SENS values in RESULT.json (odd n, no Monte Carlo).
Written after rederive.py flagged the SENS interval's lower end (its Monte Carlo allowance of 15% of the width was exceeded by 4%): the exact value shows which
implementation sat at a neighbouring order statistic. Usage: python3 -I exact-median-ci.py RESULT.json"""
import json, math, sys
res = json.load(open(sys.argv[1]))
runs = [r for r in res["runs"] if r["arm"] == "inherit" and r["tmL"] >= 10]
def exact_median_ci(x):
    n = len(x); xs = sorted(x); assert n % 2 == 1
    out = []
    for j in range(n):
        if j + 1 < n and xs[j + 1] == xs[j]: continue
        p = (j + 1) / n  # fraction of the sample at or below xs[j]; P(median <= xs[j]) = P(Bin(n, p) >= (n + 1) / 2)
        out.append((xs[j], sum(math.comb(n, k) * p ** k * (1 - p) ** (n - k) for k in range((n + 1) // 2, n + 1))))
    return next(v for v, c in out if c >= 0.025), next(v for v, c in out if c >= 0.975)
ts = {e["id"]: e["ci"] for e in res["decision"]["endpoints"]}
for key, eid in (("acute", "ACUTE"), ("sensAll", "SENS")):
    print(eid, len(runs), "exact bootstrap interval of the median:", exact_median_ci([r[key] for r in runs]), "| TypeScript (10,000 resamples):", ts[eid])
