"""Compare a rerun with the recorded first-rung file: whole summary except wall-clock fields, and every row."""
import json
import sys

rec = json.load(open(sys.argv[1]))
new = json.load(open(sys.argv[2]))
WALL = {"seconds", "stepsPerSecond"}
diffs = []
keys = sorted(set(rec["summary"]) | set(new["summary"]))
for k in keys:
    if k in WALL:
        continue
    if rec["summary"].get(k, "<absent>") != new["summary"].get(k, "<absent>"):
        diffs.append(k)
print("summary keys compared:", len([k for k in keys if k not in WALL]), "excluded:", sorted(WALL))
print("summary keys that differ:", diffs)
print("rows recorded / rerun:", len(rec["rows"]), len(new["rows"]))
rowdiff = [i for i, (a, b) in enumerate(zip(rec["rows"], new["rows"])) if a != b]
print("rows that differ:", rowdiff)
print("first row equal:", rec["rows"][0] == new["rows"][0], "last row equal:", rec["rows"][-1] == new["rows"][-1])
print("recorded seconds / steps per second:", rec["summary"]["seconds"], rec["summary"]["stepsPerSecond"])
print("rerun seconds / steps per second:", new["summary"]["seconds"], new["summary"]["stepsPerSecond"])
ok = not diffs and not rowdiff and len(rec["rows"]) == len(new["rows"])
print("MATCH" if ok else "MISMATCH")
sys.exit(0 if ok else 1)
