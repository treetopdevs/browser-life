#!/usr/bin/env python3
"""Verify the copied ecosystem archive without rerunning its long simulation."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "docs/creative-prototypes/ecosystem-archive/provenance.json"
MODEL_SHA256 = "71b8cc9cd77651026430eac3913f9b0ad8ceafa4532c4bfa8703214ebccffed0"
SEEDS = (1101, 1102, 1103)
HORIZON = 20_000
SAMPLE_CADENCE = 100
BIN_COUNT = 125
EXPECTED_RULES = {
    "version": 4, "size": 96, "resourceCap": 8, "renewal": 1.2,
    "uptake": 2.4, "baseCost": 0.45, "attackCost": 0.25,
    "defenseCost": 0.35, "birthThreshold": 10, "maxAge": 160,
    "mutationRate": 0.04, "predationFood": 3, "introductionSize": 24,
}


class VerificationError(Exception):
    pass


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise VerificationError(message)


def validate_raw(data: Any, expected_seed: int | None = None,
                 horizon: int = HORIZON, cadence: int = SAMPLE_CADENCE) -> dict[str, Any]:
    """Validate one run and independently check bin/census derived fields."""
    require(isinstance(data, dict), "raw history must be a JSON object")
    seed = data.get("seed")
    require(type(seed) is int and seed in SEEDS, "raw history has an unexpected seed")
    if expected_seed is not None:
        require(seed == expected_seed, f"expected seed {expected_seed}, found {seed}")
    require(data.get("rules") == EXPECTED_RULES, f"seed {seed}: rules differ from staged v4")
    require(data.get("sourceHash") == MODEL_SHA256, f"seed {seed}: sourceHash mismatch")
    require(data.get("ticks") == horizon, f"seed {seed}: horizon must be {horizon}")
    require(data.get("captureEvery") == 25 and data.get("fps") == 20,
            f"seed {seed}: frame sampling metadata mismatch")
    require(data.get("replay3000") is True, f"seed {seed}: historical replay marker is missing")
    samples = data.get("samples")
    require(isinstance(samples, list) and len(samples) == horizon // cadence + 1,
            f"seed {seed}: expected {horizon // cadence + 1} census samples")
    require(isinstance(data.get("notices"), list), f"seed {seed}: notices must be an array")
    if seed == 1103:
        losses = {(notice.get("tick"), notice.get("text")) for notice in data["notices"]
                  if isinstance(notice, dict)}
        for tick, family in ((640, "Hunter"), (1740, "Jade")):
            require((tick, f"{family} disappeared (census). No automatic rescue.") in losses,
                    f"seed 1103: source loss notice for {family} at tick {tick} is missing")

    seen: set[int] = set()
    last_tick = -1
    previous: dict[str, Any] | None = None
    for index, sample in enumerate(samples):
        require(isinstance(sample, dict), f"seed {seed}: sample {index} must be an object")
        tick = sample.get("tick")
        require(type(tick) is int and tick == index * cadence,
                f"seed {seed}: sample {index} is not at {index * cadence}")
        require(tick > last_tick, f"seed {seed}: sample ticks are not increasing")
        last_tick = tick
        counts, bins = sample.get("counts"), sample.get("bins")
        require(isinstance(counts, list) and len(counts) == 5 and
                all(type(value) is int and value >= 0 for value in counts),
                f"seed {seed} tick {tick}: counts must contain five nonnegative integers")
        require(isinstance(bins, list) and len(bins) == BIN_COUNT and
                all(type(value) is int and value >= 0 for value in bins),
                f"seed {seed} tick {tick}: bins must contain 125 nonnegative integers")
        by_family = [sum(bins[family * 25:(family + 1) * 25]) for family in range(5)]
        require(by_family == counts, f"seed {seed} tick {tick}: family bin sums differ from counts")
        require(sample.get("population") == sum(counts),
                f"seed {seed} tick {tick}: population differs from counts")
        expected_classes = sum(value > 0 for value in bins)
        require(sample.get("classes") == expected_classes,
                f"seed {seed} tick {tick}: classes differs from occupied bins")
        for key in ("births", "deaths", "mutations"):
            require(type(sample.get(key)) is int and sample[key] >= 0,
                    f"seed {seed} tick {tick}: {key} must be a nonnegative integer")
            if previous is not None:
                require(sample[key] >= previous[key],
                        f"seed {seed} tick {tick}: cumulative {key} decreased")
        spatial = sample.get("spatialChangePer25")
        require(isinstance(spatial, (int, float)) and math.isfinite(spatial) and 0 <= spatial <= 1,
                f"seed {seed} tick {tick}: invalid stored spatialChangePer25")
        newly_seen = sample.get("newlySeen")
        require(isinstance(newly_seen, list) and
                all(type(value) is int and 0 <= value < BIN_COUNT for value in newly_seen),
                f"seed {seed} tick {tick}: newlySeen must contain bin indexes")
        actual_new = [bin_index for bin_index, count in enumerate(bins)
                      if count > 0 and bin_index not in seen]
        require(newly_seen == actual_new,
                f"seed {seed} tick {tick}: newlySeen does not match previously unseen occupied bins")
        seen.update(index for index, count in enumerate(bins) if count > 0)
        previous = sample

    require(samples[0]["tick"] == 0 and samples[-1]["tick"] == horizon,
            f"seed {seed}: census endpoints do not cover the full horizon")
    final = samples[-1]
    late_start = next((sample for sample in samples if sample["tick"] == 15_000), None)
    require(late_start is not None, f"seed {seed}: missing tick 15,000 sample")
    late = {key: final[key] - late_start[key] for key in ("births", "deaths", "mutations")}
    return {"seed": seed, "finalCounts": final["counts"], "finalPopulation": final["population"],
            "finalClasses": final["classes"], "late15000To20000": late,
            "newObservedInLateWindow": sum(len(s["newlySeen"]) for s in samples if s["tick"] > 15_000),
            # This is intentionally re-aggregated from stored frame-derived values, not reconstructed.
            "spatialChangePer25StoredMean": sum(s["spatialChangePer25"] for s in samples
                                                  if 15_000 < s["tick"] <= 20_000) / 50}


def ffprobe(path: Path, expected_dimensions: tuple[int, int] | None = None) -> dict[str, Any]:
    executable = shutil.which("ffprobe")
    if not executable:
        raise VerificationError("ffprobe is required for media verification; install ffmpeg/ffprobe and retry")
    result = subprocess.run([executable, "-v", "error",
                             "-show_entries", "stream=codec_type,codec_name,width,height,pix_fmt,r_frame_rate,nb_frames,start_time,duration",
                             "-of", "json", str(path)], capture_output=True, text=True)
    require(result.returncode == 0, f"ffprobe failed for {path}: {result.stderr.strip()}")
    try:
        streams = json.loads(result.stdout).get("streams", [])
    except json.JSONDecodeError as error:
        raise VerificationError(f"ffprobe returned invalid JSON for {path}: {error}") from error
    require(len(streams) == 1 and streams[0].get("codec_type") == "video",
            f"expected one video stream and no audio in {path}")
    stream = streams[0]
    probe = {key: stream.get(key) for key in
             ("codec_name", "width", "height", "pix_fmt", "r_frame_rate", "nb_frames", "start_time", "duration")}
    if expected_dimensions is not None:
        require((probe["width"], probe["height"]) == expected_dimensions,
                f"{path}: expected {expected_dimensions[0]}x{expected_dimensions[1]} video")
    try:
        require(probe["codec_name"] == "h264", f"{path}: expected H.264 video")
        require(probe["pix_fmt"] == "yuv420p", f"{path}: expected yuv420p pixel format")
        require(probe["r_frame_rate"] == "20/1", f"{path}: expected 20 fps")
        require(int(probe["nb_frames"]) == 801, f"{path}: expected exactly 801 frames")
        require(abs(float(probe["start_time"])) <= 0.01, f"{path}: expected start time 0")
        require(abs(float(probe["duration"]) - 40.05) <= 0.01, f"{path}: expected 40.05 seconds")
    except (TypeError, ValueError) as error:
        raise VerificationError(f"{path}: incomplete ffprobe metadata: {error}") from error
    return probe


def close_enough(actual: Any, expected: Any, path: str = "summary") -> None:
    if isinstance(expected, bool) or expected is None or isinstance(expected, str):
        require(actual == expected, f"{path}: value differs")
    elif isinstance(expected, (int, float)):
        require(isinstance(actual, (int, float)) and
                math.isclose(actual, expected, rel_tol=1e-10, abs_tol=1e-10),
                f"{path}: numeric value differs (actual {actual!r}, expected {expected!r})")
    elif isinstance(expected, list):
        require(isinstance(actual, list) and len(actual) == len(expected), f"{path}: array length differs")
        for index, (left, right) in enumerate(zip(actual, expected)):
            close_enough(left, right, f"{path}[{index}]")
    elif isinstance(expected, dict):
        require(isinstance(actual, dict) and actual.keys() == expected.keys(), f"{path}: object keys differ")
        for key, value in expected.items():
            close_enough(actual[key], value, f"{path}.{key}")
    else:
        require(actual == expected, f"{path}: value differs")


def reaggregate_summary(raw_paths: list[Path], script_path: Path) -> Any:
    """Run the copied historical summarizer unchanged, isolated from the checkout."""
    with tempfile.TemporaryDirectory(prefix="ecosystem-archive-check-") as temp:
        base = Path(temp)
        (base / "runs/ecosystem-20k").mkdir(parents=True)
        (base / "docs").mkdir()
        for raw in raw_paths:
            shutil.copyfile(raw, base / "runs/ecosystem-20k" / raw.name)
        result = subprocess.run([sys.executable, str(script_path)], cwd=base,
                                capture_output=True, text=True)
        require(result.returncode == 0,
                f"unchanged summarize-long-run.py failed: {result.stderr.strip()}")
        return json.loads((base / "docs/ecosystem-20k-summary.json").read_text())


def verify(originals: bool = False) -> dict[str, Any]:
    require(MANIFEST.is_file(), f"provenance manifest not found: {MANIFEST}")
    manifest = json.loads(MANIFEST.read_text())
    require(manifest.get("model", {}).get("sha256") == MODEL_SHA256,
            "manifest does not pin the historical model hash")
    require(manifest["model"].get("sourceCommitSha256") == MODEL_SHA256,
            "immutable model source hash differs from the pinned historical model")
    for item in manifest["immutableBase"]["trackedSourceFiles"]:
        path = ROOT / item["path"]
        require(path.is_file() and sha256(path) == item["sha256"],
                f"immutable-base source file differs from commit snapshot: {item['path']}")

    for item in manifest.get("copiedWorkingFiles", []):
        path = ROOT / item["path"]
        require(path.is_file(), f"copied historical working file is missing: {item['path']}")
        actual_hash = sha256(path)
        require(actual_hash == item["sha256"] == item["sourceSha256"],
                f"copied historical working file hash mismatch: {item['path']}")
    model_path = ROOT / manifest["model"]["path"]
    require(model_path.is_file() and sha256(model_path) == MODEL_SHA256,
            "copied model is missing or differs from the immutable historical model")

    staged = json.loads((ROOT / "docs/ecosystem-sandbox-exploration.json").read_text())
    raw_paths = []
    raw_results = []
    for seed in SEEDS:
        item = manifest["rawHistories"][str(seed)]
        path = ROOT / item["path"]
        require(path.is_file(), f"seed {seed}: raw history is missing")
        require(sha256(path) == item["sha256"] == item["sourceSha256"],
                f"seed {seed}: raw history hash mismatch")
        try:
            data = json.loads(path.read_text())
        except (UnicodeError, json.JSONDecodeError) as error:
            raise VerificationError(f"seed {seed}: invalid raw JSON: {error}") from error
        result = validate_raw(data, expected_seed=seed)
        staged_result = next((row for row in staged["results"]
                              if row.get("seed") == seed and row.get("staged")), None)
        require(staged_result is not None, f"seed {seed}: staged v4 exploration record is missing")
        raw_at_3000 = next((sample for sample in data["samples"] if sample["tick"] == 3_000), None)
        require(raw_at_3000 is not None, f"seed {seed}: raw history has no tick 3,000 census")
        census_fields = ("tick", "counts", "population", "attack", "defense", "classes", "diversity",
                         "births", "deaths", "mutations")
        for field in census_fields:
            require(raw_at_3000[field] == staged_result["final"][field],
                    f"seed {seed}: raw tick 3,000 {field} differs from staged v4 exploration")
        result["staged3000Match"] = True
        raw_results.append(result)
        raw_paths.append(path)

    summary_path = ROOT / manifest["summary"]["path"]
    require(summary_path.is_file() and sha256(summary_path) == manifest["summary"]["sha256"] ==
            manifest["summary"]["sourceSha256"],
            "historical summary is missing or its hash differs")
    script_path = ROOT / manifest["summarizer"]["path"]
    require(script_path.is_file() and sha256(script_path) == manifest["summarizer"]["sha256"] ==
            manifest["summarizer"]["sourceSha256"],
            "copied historical summarizer is missing or modified")
    expected_summary = json.loads(summary_path.read_text())
    actual_summary = reaggregate_summary(raw_paths, script_path)
    close_enough(actual_summary, expected_summary)
    for result, summary in zip(raw_results, actual_summary):
        item = result["seed"]
        summarized = next(row for row in actual_summary if row["seed"] == item)
        require(summarized["final"]["counts"] == result["finalCounts"],
                f"seed {item}: reaggregated final counts differ from raw bins")
        for key, delta in result["late15000To20000"].items():
            require(summarized["windows"]["15000-20000"][key] == delta,
                    f"seed {item}: reaggregated late {key} differs from raw records")

    media_results = {}
    total_size = 0
    for seed in SEEDS:
        item = manifest["media"][str(seed)]
        delivered = ROOT / item["delivered"]["path"]
        require(delivered.is_file(), f"seed {seed}: delivered movie is missing")
        require(sha256(delivered) == item["delivered"]["sha256"],
                f"seed {seed}: delivered movie hash mismatch")
        require(delivered.stat().st_size == item["delivered"]["bytes"],
                f"seed {seed}: delivered movie byte count mismatch")
        total_size += delivered.stat().st_size
        probe = ffprobe(delivered, expected_dimensions=(192, 192))
        close_enough(probe, item["delivered"]["probe"], f"seed {seed} delivered probe")
        if originals:
            original = Path(item["original"]["path"])
            require(original.is_file(), f"seed {seed}: original movie is absent: {original}")
            require(sha256(original) == item["original"]["sha256"],
                    f"seed {seed}: original movie hash mismatch")
            original_probe = ffprobe(original, expected_dimensions=(576, 576))
            close_enough(original_probe, item["original"]["probe"], f"seed {seed} original probe")
        media_results[str(seed)] = {"sha256": item["delivered"]["sha256"], "probe": probe}
    require(total_size <= 32 * 1024 * 1024, "delivered movies exceed the 32 MiB combined budget")
    return {"ok": True, "historicalSourceNote": manifest["historicalSourceNote"],
            "raw": raw_results, "summary": "reaggregated by unchanged historical summarizer",
            "media": media_results, "deliveredBytes": total_size,
            "originalsChecked": originals}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--originals", action="store_true",
                        help="also require and verify source-worktree 576px movies")
    parser.add_argument("--validate-raw", action="store_true",
                        help="validate one JSON history read from stdin; useful for unit tests")
    parser.add_argument("--expected-seed", type=int)
    parser.add_argument("--horizon", type=int, default=HORIZON)
    parser.add_argument("--cadence", type=int, default=SAMPLE_CADENCE)
    parser.add_argument("--check-hash", type=Path, help="check one file against --expected-hash")
    parser.add_argument("--expected-hash")
    parser.add_argument("--compare-summary", action="store_true",
                        help="compare {actual, expected} JSON from stdin with numeric tolerance")
    args = parser.parse_args()
    try:
        if args.validate_raw:
            data = json.load(sys.stdin)
            result = validate_raw(data, args.expected_seed, args.horizon, args.cadence)
        elif args.check_hash:
            require(args.expected_hash is not None, "--check-hash requires --expected-hash")
            require(args.check_hash.is_file(), f"file is missing: {args.check_hash}")
            actual_hash = sha256(args.check_hash)
            require(actual_hash == args.expected_hash,
                    f"SHA-256 mismatch for {args.check_hash}: {actual_hash}")
            result = {"ok": True, "sha256": actual_hash}
        elif args.compare_summary:
            comparison = json.load(sys.stdin)
            close_enough(comparison["actual"], comparison["expected"])
            result = {"ok": True}
        else:
            result = verify(args.originals)
        print(json.dumps(result, indent=2))
        return 0
    except (VerificationError, OSError, KeyError, json.JSONDecodeError) as error:
        print(f"ecosystem archive verification failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
