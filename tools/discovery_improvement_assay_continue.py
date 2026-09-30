#!/usr/bin/env python3
"""Bounded assays-only supervisor; failed reservations remain charged."""
import argparse, hashlib, json, math, os, signal, subprocess, time
from pathlib import Path


def main():
    p = argparse.ArgumentParser()
    for name in ('release', 'host', 'out'):
        p.add_argument(name)
    args = p.parse_args()
    def terminate(signum, frame):
        raise KeyboardInterrupt("supervisor termination requested")
    signal.signal(signal.SIGTERM, terminate)
    def no_symlinks(path):
        path = Path(os.path.abspath(path))
        for ancestor in [path, *path.parents]:
            if ancestor.is_symlink():
                raise RuntimeError('symlink forbidden')
    no_symlinks(args.out)
    no_symlinks(args.release)
    release_initial = json.loads(Path(args.release).read_text())
    if release_initial.get('format') != 'discovery-improvement-assay-release/v1' or release_initial.get('status') != 'RELEASED':
        raise RuntimeError('explicit RELEASED file required')
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    lock = out / 'ASSAY_SUPERVISOR'
    pinned = [Path(args.release).resolve(), Path(__file__).resolve(), Path('tools/discovery_improvement_assay.ts').resolve()]
    hashes = {str(x): hashlib.sha256(x.read_bytes()).hexdigest() for x in pinned}
    with lock.open('x') as f:
        json.dump({'pid': os.getpid(), 'host': args.host, 'hashes': hashes}, f)
    try:
        while True:
            if any(hashlib.sha256(Path(x).read_bytes()).hexdigest() != h for x,h in hashes.items()):
                raise RuntimeError('supervisor input drift')
            release = json.loads(pinned[0].read_text())
            if release.get('format') != 'discovery-improvement-assay-release/v1' or release.get('status') != 'RELEASED':
                raise RuntimeError('explicit RELEASED file required')
            candidate_path = Path(release['candidatePath'])
            if candidate_path.is_absolute() or '..' in candidate_path.parts:
                raise RuntimeError('candidate path outside frozen root')
            no_symlinks(candidate_path)
            if hashlib.sha256(candidate_path.read_bytes()).hexdigest() != release['candidateSha256']:
                raise RuntimeError('released candidate drift')
            allocation = json.loads(candidate_path.read_text())
            allocation_hash = hashlib.sha256(pinned[0].read_bytes()).hexdigest()
            host = next(h for h in allocation['hosts'] if h['id'] == args.host)
            if str(Path.cwd().resolve()) != host['root'] or out != (Path(host['root']) / host['outputRel']).resolve():
                raise RuntimeError('host root/output mismatch')
            for name in ('RUNNING', 'SUPERVISOR', 'SHARD_RUNNING', 'SHARD_SUPERVISOR', 'ASSAY_RUNNING'):
                if (out / name).exists():
                    raise RuntimeError('existing worker lock; manual recovery required')
            for receipt in out.glob('parent-invocation-*.json'):
                no_symlinks(receipt)
            records = [json.loads(x.read_text()) for x in out.glob('parent-invocation-*.json')]
            if any(r['releaseHash'] != allocation_hash or r['hostId'] != args.host or not isinstance(r['chargedSeconds'], (float,int)) or not math.isfinite(r['chargedSeconds']) or r['chargedSeconds'] < 0 or r.get('status') != 'settled' for r in records):
                raise RuntimeError('parent ledger drift')
            if sum(r['chargedSeconds'] for r in records) + 3600 > host['capSeconds'] or len(records) >= host['maxInvocations']:
                raise RuntimeError('host reservation exhausted')
            reservation = out / f'parent-invocation-{time.time_ns()}-{os.getpid()}.json'
            record = {'releaseHash': allocation_hash, 'hostId': args.host, 'chargedSeconds': 3600, 'status': 'reserved', 'startedAt': time.time(), 'supervisorPid': os.getpid()}
            with reservation.open('x') as f:
                json.dump(record, f)
                f.flush()
                os.fsync(f.fileno())
            env = dict(os.environ, BL_ASSAY_RESERVATION=str(reservation))
            started = time.monotonic()
            command = ['deno' ,'run','--no-lock','-A','--unstable-webgpu','tools/discovery_improvement_assay.ts','run',str(pinned[0]),args.host,str(out),'600']
            with (out / 'assay-supervisor.log').open('a') as log:
                child = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=log, text=True, start_new_session=True, env=env)
                try:
                    stdout, _ = child.communicate(timeout=3500)
                except (subprocess.TimeoutExpired, KeyboardInterrupt):
                    os.killpg(child.pid, signal.SIGTERM)
                    try:
                        child.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        os.killpg(child.pid, signal.SIGKILL)
                        child.wait()
                    raise RuntimeError('watchdog stopped child; reservation remains charged; manual recovery required')
                log.write(stdout)
                log.flush()
                if child.returncode:
                    raise RuntimeError('assay child failed; inspect reserved ledger and lock before recovery')
                record.update(chargedSeconds=time.monotonic() - started + 1, status='settled')
                tmp = reservation.with_suffix('.settlement')
                with tmp.open('x') as f:
                    json.dump(record, f)
                    f.flush()
                    os.fsync(f.fileno())
                tmp.replace(reservation)
                result = json.loads(stdout.strip().splitlines()[-1])
                if result.get('complete'):
                    break
    finally:
        lock.unlink()


if __name__ == '__main__':
    main()
