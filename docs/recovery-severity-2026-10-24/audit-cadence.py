"""Audit retained v1 cadence identities without changing scores or advancing physics.

Usage: python3 docs/recovery-severity-2026-10-24/audit-cadence.py V1_RUN
Only stdout is written. All input paths are opened read-only.
"""
import hashlib
import json
import pathlib
import sys

FROZEN_MANIFEST = "8c68136f8e68f551a8ec5f34a93349c729ef0268ad7e2182c6fd2431877dc1f7"


def read(path):
    data = path.read_bytes()
    return json.loads(data), hashlib.sha256(data).hexdigest()


def differences(observation):
    normal, fast = (observation["tracks"][name] for name in ("normal", "fast"))
    assert len(normal["history"]) == 40 and len(fast["history"]) == 80
    rows = []
    if normal["initialLabel"] != fast["initialLabel"]:
        rows.append({"step": 3000, "normal": normal["initialLabel"], "fast": fast["initialLabel"]})
    for j, row in enumerate(fast["history"]):
        assert row["step"] == 3025 + 25 * j, "missing/misordered fast observation"
    for j, row in enumerate(normal["history"]):
        other = fast["history"][2 * j + 1]
        assert row["step"] == 3050 + 50 * j == other["step"], "missing/misordered shared observation"
        if row["label"] != other["label"]:
            rows.append({"step": row["step"], "normal": row["label"], "fast": other["label"]})
    return rows


def main():
    root = pathlib.Path(sys.argv[1])
    manifest, manifest_file_hash = read(root / "manifest.json")
    canonical = json.dumps(manifest, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    assert hashlib.sha256(canonical).hexdigest() == FROZEN_MANIFEST, "wrong frozen manifest"
    assert read(root / "manifest-digest.json")[0]["sha256"] == FROZEN_MANIFEST
    prior, _ = read(pathlib.Path(__file__).with_name("audit.json"))
    scientific_hashes = {r["id"]: r["source_sha256"] for r in prior["cases"]}
    expected = {f"science-{subject}-{seed}" for subject in ("parent", "mutant") for seed in manifest["scienceSeeds"][:32]}
    assert len(prior["cases"]) == len(scientific_hashes) == 64 and set(scientific_hashes) == expected, "incomplete scientific hash pins"
    expected |= {f"cal-{subject}-{seed}" for subject in ("parent", "generalist") for seed in manifest["engineeringSeeds"]}
    expected |= {f"cal-replay-parent-{seed}" for seed in manifest["engineeringSeeds"][:2]}
    expected |= {f"replay-{subject}-{seed}" for subject in ("parent", "mutant") for seed in (manifest["scienceSeeds"][0], manifest["scienceSeeds"][31])}
    paths = {p.parent.name: p for p in (root / "cases").glob("*/case.json")}
    assert set(paths) == expected and len(expected) == 78, "incomplete or expanded campaign"
    cases, artifact_count = [], 0
    for case_id, path in sorted(paths.items()):
        case, file_hash = read(path)
        assert case["id"] == case_id and case["manifestHash"] == FROZEN_MANIFEST
        if case_id in scientific_hashes:
            assert file_hash == scientific_hashes[case_id], "scientific record changed since proposal audit"
        phases = {"initial", "grown", "tile-lesion-end", "regen-start", "regen-end", "dark-end", "light-end"}
        assert len(case["artifacts"]) == 7 and {a["path"] for a in case["artifacts"]} == {f"{p}.blck" for p in phases}, "incomplete checkpoints"
        for artifact in case["artifacts"]:
            assert pathlib.Path(artifact["path"]).name == artifact["path"]
            data = (path.parent / artifact["path"]).read_bytes()
            assert len(data) == artifact["bytes"] and hashlib.sha256(data).hexdigest() == artifact["sha256"]
            artifact_count += 1
        observation = case["observation"]
        mismatch = differences(observation)
        cases.append({"id": case_id, "source_sha256": file_hash,
                      "R": observation["R"], "R_clean": observation["R_clean"],
                      "normal_recovered": observation["tracks"]["normal"]["recovered"],
                      "fast_recovered": observation["tracks"]["fast"]["recovered"],
                      "shared_label_disagreements": mismatch,
                      "would_disqualify_v1_clean_success": observation["R_clean"] and bool(mismatch)})
    summary, summary_hash = read(root / "summary-32.json")
    assert summary["manifestHash"] == FROZEN_MANIFEST and summary["status"] == "NO-LEAD-IN-FIRST-32"
    effects = {}
    for subject in ("parent", "mutant"):
        rows = [r for r in cases if r["id"].startswith(f"science-{subject}-")]
        recorded = sum(r["R_clean"] for r in rows)
        guarded = sum(r["R_clean"] and not r["shared_label_disagreements"] for r in rows)
        assert recorded == summary[subject]["clean"]
        effects[subject] = {"recorded_R_clean": recorded, "with_additional_shared_label_guard": guarded}
    report = {"scope": "All 78 frozen v1 saved cases; initialization and 40 shared 50-step labels per case. No simulation or endpoint rewrite.",
              "frozen_manifest_digest": FROZEN_MANIFEST, "manifest_file_sha256": manifest_file_hash,
              "summary_file_sha256": summary_hash, "verified_checkpoint_files": artifact_count,
              "case_count": len(cases), "cases_with_disagreement": sum(bool(r["shared_label_disagreements"]) for r in cases),
              "recorded_clean_successes_disqualified": sum(r["would_disqualify_v1_clean_success"] for r in cases),
              "scientific_score_sensitivity": effects, "frozen_status": summary["status"], "cases": cases}
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
