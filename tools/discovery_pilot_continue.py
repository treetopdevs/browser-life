"""Bounded local execution of the frozen discovery pilot, then replay and analysis."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys


def main():
    root = Path(sys.argv[1]).resolve()
    design_path = root / "pilot-design.json"
    raw = design_path.read_bytes()
    design = json.loads(raw)
    lock = root / "SUPERVISOR"
    with lock.open("x") as out:
        out.write(str(os.getpid()) + "\n")
    result = {
        "started": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "pilotManifestSha256": hashlib.sha256(raw).hexdigest(),
        "supervisorSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "commands": [], "paidUSD": 0, "status": "incomplete",
    }
    def run(args):
        if design_path.read_bytes() != raw:
            raise RuntimeError("Pilot manifest changed during supervision")
        completed = subprocess.run(args, check=False)
        result["commands"].append({"command": args, "exitCode": completed.returncode})
        if completed.returncode:
            raise RuntimeError(f"Pilot command failed with exit {completed.returncode}")
    try:
        for _ in range(8):
            present = sum((root / "receipts" / f"{u['id']}.json").exists() for u in design["units"])
            if present == len(design["units"]):
                break
            run(["deno", "run", "-A", "--unstable-webgpu", "tools/discovery_competition_pilot.ts", "run", str(root), "600"])
        if not all((root / "receipts" / f"{u['id']}.json").exists() for u in design["units"]):
            raise RuntimeError("Eight-tranche local runtime cap reached; diagnose before extending")
        for unit_id in design["requiredReplayUnitIds"]:
            out = root / "replays" / f"{unit_id}.json"
            if not out.exists():
                run(["deno", "run", "-A", "--unstable-webgpu", "tools/discovery_competition_pilot.ts", "replay", str(root), unit_id, str(out)])
        final = root / "final-analysis.json"
        if final.exists():
            raise RuntimeError("Existing final analysis: inspect before reusing this supervisor")
        run(["deno", "run", "-A", "tools/discovery_competition_pilot.ts", "analyze", str(root), str(final)])
        analysis = json.loads(final.read_text())
        result["status"] = analysis["status"]
        result["finalAnalysisSha256"] = hashlib.sha256(final.read_bytes()).hexdigest()
    except BaseException as error:
        result["error"] = str(error)
        raise
    finally:
        result["finished"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        with (root / "continuation.json").open("x") as out:
            json.dump(result, out, indent=2)
            out.write("\n")
        lock.unlink()
        print(json.dumps({"status": result["status"], "commands": len(result["commands"])}), flush=True)


if __name__ == "__main__":
    main()
