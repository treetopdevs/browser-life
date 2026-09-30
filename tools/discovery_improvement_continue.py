"""Continue only the frozen local study; never retry failed jobs or change its roster."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from datetime import datetime, timezone


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def utc():
    return datetime.now(timezone.utc).isoformat()


def last_record(path):
    for line in reversed(Path(path).read_text().splitlines()):
        try:
            value = json.loads(line)
            if isinstance(value, dict) and "status" in value:
                return value
        except json.JSONDecodeError:
            pass
    return None


def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: discovery_improvement_continue.py STUDY_DIR NEW_LABEL")
    study = Path(sys.argv[1]).resolve()
    label = sys.argv[2]
    if not label or any(c not in "abcdefghijklmnopqrstuvwxyz0123456789-" for c in label):
        raise ValueError("label must be lowercase alphanumeric with hyphens")
    manifest_path, release_path = study / "manifest.json", study / "release.json"
    manifest, release = json.loads(manifest_path.read_text()), json.loads(release_path.read_text())
    if Path.cwd().resolve() != Path(manifest["sourceRoot"]).resolve():
        raise ValueError("run from frozen source root")
    if release["localOnly"] is not True or release["paidUSD"] != 0:
        raise ValueError("only the reviewed local release is supported")
    if release["manifestSha256"] != digest(manifest_path) or release["manifestHash"] != manifest["manifestHash"]:
        raise ValueError("release manifest mismatch")
    out = Path(release["outputDir"])
    out.mkdir(parents=True, exist_ok=True)
    if (out / "RUNNING").exists():
        raise RuntimeError("existing run lock: verify its process; never start a competing worker")
    record_path = study / f"{label}.json"
    log_dir = study / f"{label}-logs"
    if record_path.exists() or log_dir.exists():
        raise FileExistsError("continuation label already used")
    lock = out / "SUPERVISOR"
    fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.write(fd, str(os.getpid()).encode())
    os.close(fd)
    record = {"format": "discovery-improvement-supervision/v1", "started": utc(),
              "supervisorSha256": digest(__file__), "manifestSha256": digest(manifest_path),
              "releaseSha256": digest(release_path), "paidUSD": 0, "commands": [], "status": "running"}
    def save():
        temp = record_path.with_suffix(".tmp")
        temp.write_text(json.dumps(record, indent=2) + "\n")
        os.replace(temp, record_path)
    try:
        log_dir.mkdir()
        save()
        prior_count = len(list(out.glob("invocation-*.json")))
        remaining = max(0, release["forecast"]["plannedInvocations"] - prior_count)
        record["priorInvocations"] = prior_count
        for index in range(remaining):
            if digest(manifest_path) != record["manifestSha256"] or digest(release_path) != record["releaseSha256"] or digest(__file__) != record["supervisorSha256"]:
                raise RuntimeError("frozen supervision input or source drift")
            command = ["deno", "run", "--no-lock", "-A", "--unstable-webgpu", "tools/discovery_improvement.ts", "run", str(manifest_path), str(release_path), str(out), "600"]
            log = log_dir / f"run-{index:04d}.log"
            event = {"command": command, "started": utc(), "log": str(log)}
            record["commands"].append(event)
            with log.open("x") as stream:
                child = subprocess.Popen(command, stdout=stream, stderr=subprocess.STDOUT)
                event["pid"] = child.pid
                save()
                try:
                    code = child.wait(timeout=3600)
                except subprocess.TimeoutExpired:
                    child.terminate()
                    try:
                        child.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        child.kill()
                        child.wait()
                    event.update(exitCode=child.returncode, finished=utc())
                    raise RuntimeError("one-hour technical watchdog: worker stopped; retain its lock/evidence for diagnosis")
            event.update(exitCode=code, finished=utc(), result=last_record(log))
            save()
            if code != 0:
                record["status"] = "stopped-on-error"
                break
            result = event["result"]
            if not result or result["status"] not in ("time-limit", "resource-limit", "assay-roster-complete"):
                raise RuntimeError("missing or unexpected runner completion status")
            if result["status"] != "time-limit":
                record["status"] = result["status"]
                break
        else:
            record["status"] = "planned-invocation-limit"
        # Analysis remains an explicit final action after completion is verified.
    except BaseException as error:
        record["status"] = "stopped-on-error"
        record["error"] = str(error)
        raise
    finally:
        record["finished"] = utc()
        save()
        lock.unlink()
    print(json.dumps({"status": record["status"], "record": str(record_path)}))
    if record["status"] == "stopped-on-error":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
