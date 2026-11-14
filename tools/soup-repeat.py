#!/usr/bin/env python3
"""Prepare/run seeds 2,1,3,4 sequentially against the preserved issue-129 archive.
python3 tools/soup-repeat.py ARCHIVE.zip NEW_OUTPUT [--run]
No historical mismatch stops another independent seed. Execution failures and
missing endpoints remain failures. Requires cwd at the pinned source checkout.
"""
import csv
import datetime
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import zipfile

CHILD_TIMEOUT_SECONDS = 6 * 60 * 60
RECEIPT_TIMEOUT_SECONDS = 10 * 60

ARCHIVE_SHA256 = 'f69d4c6084931ef7c37ed0deeee85238f45ceb51ece268926bbdd34b200e3603'


def sha(path):
    with Path(path).open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def write(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)


CSV_FIELDS = ['epoch', 'brotli_size', 'soup_size', 'higher_entropy', 'distinct', 'top_share', 'ops_per_run', 'seconds']


def rows(path, validate=False):
    previous = -1
    with path.open() as f:
        reader = csv.DictReader(f)
        if validate and reader.fieldnames != CSV_FIELDS:
            raise ValueError('invalid census header')
        for row in reader:
            if validate:
                if set(row) != set(CSV_FIELDS) or any(v is None for v in row.values()):
                    raise ValueError('incomplete census fields')
                if any(not math.isfinite(float(v)) for v in row.values()):
                    raise ValueError('non-finite census field')
                if (int(row['soup_size']) != 131072 or int(row['brotli_size']) < 0
                        or not 1 <= int(row['distinct']) <= 131072
                        or not 0 < float(row['top_share']) <= 1
                        or float(row['ops_per_run']) < 0 or float(row['seconds']) < 0):
                    raise ValueError('invalid census measurement')
            epoch = int(row['epoch'])
            if epoch <= previous:
                raise ValueError(f'duplicate census or unordered epoch {epoch}: {path}')
            previous = epoch
            yield epoch, {k: v for k, v in row.items() if k != 'seconds'}


def compare(dest, historical, final_epoch):
    checkpoints = []
    for p in sorted(dest.glob('soup-*.bin')):
        original = historical / p.name
        checkpoints.append({'snapshot': p.name, 'sha256': sha(p),
            'historicalSha256': sha(original) if original.exists() else None,
            'matchesHistorical': sha(p) == sha(original) if original.exists() else None})
    missing = []
    for p in sorted(historical.glob('soup-*.bin')):
        epoch = int(re.search(r'soup-(\d+)', p.name)[1])
        if epoch <= final_epoch and not (dest / p.name).exists():
            missing.append({'snapshot': p.name, 'sha256': sha(p)})
    old_iter, new_iter = iter(rows(historical / 'log.csv')), iter(rows(dest / 'log.csv'))
    old, new = next(old_iter, None), next(new_iter, None)
    differences, missing_historical, missing_repeat = [], [], []
    compared, beyond = 0, 0
    while old is not None or new is not None:
        if old is not None and (new is None or old[0] < new[0]):
            if old[0] > final_epoch:
                beyond += 1
            else:
                missing_repeat.append(old[0])
            old = next(old_iter, None)
        elif new is not None and (old is None or new[0] < old[0]):
            missing_historical.append(new[0])
            new = next(new_iter, None)
        else:
            compared += 1
            if old[1] != new[1]:
                differences.append({'epoch': old[0], 'historical': old[1], 'repeat': new[1]})
            old, new = next(old_iter, None), next(new_iter, None)
    return {'checkpoints': checkpoints, 'missingHistoricalCheckpointsWithinRun': missing,
        'series': {'comparedRows': compared, 'differences': differences,
            'missingHistoricalRows': missing_historical,
            'missingRepeatRowsWithinRun': missing_repeat,
            'historicalRowsBeyondRun': beyond},
        'caveat': 'Elapsed seconds excluded. Missing historical endpoint rows are not fabricated. Snapshot/series equality does not establish population replication.'}



def validate_protocol(dest, seed, completion):
    """Require this protocol's evidence independently of holes in history."""
    final = completion['finalEpoch']
    if type(final) is not int or not 1 <= final <= 16384:
        raise ValueError('invalid final epoch')
    if seed != 2 and final != 16384:
        raise ValueError('independent seed did not reach epoch cap 16384')
    expected_rows = sorted(set(range(1, final + 1, 64)) | {final})
    measured_rows = list(rows(dest / 'log.csv', validate=True))
    actual_rows = [epoch for epoch, _ in measured_rows]
    if actual_rows != expected_rows:
        raise ValueError('repeat census schedule is incomplete or unexpected')
    required = {f'soup-{e}.bin' for e in range(4096, final + 1, 4096)} | {f'soup-{final}.bin'}
    crossing = completion['thresholdCrossingEpoch']
    # CSV H+ is rounded to six decimals. Exactly 1.000000 is ambiguous;
    # anything greater is definitely above threshold, anything less is below.
    definite = [e for e, r in measured_rows if float(r['higher_entropy']) > 1]
    if crossing is None and definite:
        raise ValueError('census crossing is missing from completion evidence')
    if crossing is not None:
        h = next((float(r['higher_entropy']) for e, r in measured_rows if e == crossing), None)
        if h is None or h < 1 or any(e < crossing for e in definite):
            raise ValueError('crossing claim contradicts census')
    if crossing is not None:
        if seed == 2 and final != min(16384, crossing + 1024):
            raise ValueError('seed 2 did not complete its post-crossing window')
        if crossing not in actual_rows:
            raise ValueError('crossing is not a sampled epoch')
        required.add(f'soup-{crossing}-transition.bin')
        previous = [e for e in actual_rows if e < crossing]
        if previous:
            required.add(f'soup-{previous[-1]}-pre-transition.bin')
        transition = json.loads((dest / 'transition.json').read_text())
        if transition['epoch'] != crossing or transition.get('observedInInvocation') is not True:
            raise ValueError('crossing receipt is inconsistent')
    elif seed == 2 and final != 16384:
        raise ValueError('seed 2 stopped before cap without a crossing')
    for name in sorted(required):
        if (dest / name).stat().st_size != 131072 * 64:
            raise ValueError(f'invalid snapshot size: {name}')


def validate_receipt(snapshot, stdout, compressor):
    receipt = json.loads(stdout)
    if (receipt['sha256'] != sha(snapshot) or receipt['bytes'] != snapshot.stat().st_size
            or receipt['num'] * 64 != receipt['bytes'] or receipt['lang'] != 'noheads'
            or receipt['compressor'] != compressor):
        raise ValueError(f'invalid assay receipt: {snapshot.name}')


def main(archive, output, execute=False):
    root = Path.cwd()
    output = Path(output).resolve()
    with Path(archive).open('rb') as archive_file:
        if hashlib.file_digest(archive_file, 'sha256').hexdigest() != ARCHIVE_SHA256:
            raise ValueError('archive checksum mismatch')
        archive_file.seek(0)
        output.mkdir()  # never reuse a previous run, including an interrupted one
        historical = output / 'historical'
        historical.mkdir()
        initial_hashes = {}
        with zipfile.ZipFile(archive_file) as z:
            inventory = json.loads(z.read('manifest.json'))
            for entry in inventory:
                source = Path(entry['source'])
                if source.name == 'initial-state-hashes.json':
                    data = z.read(entry['member'])
                    if hashlib.sha256(data).hexdigest() != entry['sha256']:
                        raise ValueError('initial hash receipt checksum mismatch')
                    initial_hashes = {r['seed']: r['sha256'] for r in json.loads(data)}
                if '/runs/soup/noheads/' not in str(source) or source.parent.name not in ['seed-1', 'seed-2', 'seed-3', 'seed-4']:
                    continue
                data = z.read(entry['member'])
                if hashlib.sha256(data).hexdigest() != entry['sha256']:
                    raise ValueError('archived member checksum mismatch')
                dest = historical / source.parent.name / source.name
                dest.parent.mkdir(exist_ok=True)
                with dest.open('xb') as f:
                    f.write(data)
                dest.chmod(0o444)
    source_paths = [Path('tools/soup.ts'), Path('tools/soup-receipt.ts'), Path('deno.json'), Path('deno.lock'), Path(__file__).resolve(), *sorted(Path('tools/soup').glob('*.ts'))]
    sources = {str(p): sha(p) for p in source_paths}
    manifest = {'schema': 1, 'created': now(), 'archiveSha256': ARCHIVE_SHA256,
        'cwd': str(root), 'sources': sources, 'status': 'prepared', 'runs': [],
        'caveat': 'Candidate source repeats; historical producing source/dirty state unknown. Completion counters detect missing pair completions, not all possible GPU errors.'}
    for seed in [2, 1, 3, 4]:
        dest = output / f'seed-{seed}'
        command = ['deno', 'run', '--frozen', '-A', 'tools/soup.ts', '--evidence', '--seed', str(seed),
            '--num-log2', '17', '--lang', 'noheads', '--mutation', '0.000244140625', '--epochs', '16384',
            '--every', '64', '--transition', '1', '--after', str(1024 if seed == 2 else 16384), '--save', '4096', '--out', str(dest)]
        manifest['runs'].append({'seed': seed, 'command': command, 'status': 'prepared'})
    write(output / 'manifest.json', manifest)
    if not execute:
        return 0
    for entry in manifest['runs']:
        try:
            source_changed = any(sha(p) != expected for p, expected in sources.items())
        except OSError:
            source_changed = True
        if source_changed:
            manifest.update(status='aborted-source-change', finished=now())
            write(output / 'manifest.json', manifest)
            return 1
        seed = entry['seed']
        dest = output / f'seed-{seed}'
        entry.update(status='running', started=now())
        manifest['status'] = 'running'
        write(output / 'manifest.json', manifest)
        entry['status'] = 'failed'
        try:
            with (output / f'seed-{seed}.stdout.log').open('x') as log:
                entry['exitCode'] = subprocess.run(entry['command'], stdout=log, stderr=subprocess.STDOUT, timeout=CHILD_TIMEOUT_SECONDS).returncode
            entry['finished'] = now()
            entry['sourceUnchanged'] = all(sha(p) == expected for p, expected in sources.items())
            entry['status'] = 'failed'
            if entry['exitCode'] == 0 and (dest / 'completion.json').exists() and entry['sourceUnchanged']:
                completion = json.loads((dest / 'completion.json').read_text())
                entry['completion'] = completion
                validate_protocol(dest, seed, completion)
                final_epoch = completion['finalEpoch']
                invocation = json.loads((dest / 'invocation.json').read_text())
                entry['initialStateMatchesPriorRepeat'] = invocation['startingStateSha256'] == initial_hashes.get(seed)
                entry['finalSnapshotMatchesReceipt'] = sha(dest / f'soup-{final_epoch}.bin') == completion['finalStateSha256']
                comparison = compare(dest, historical / f'seed-{seed}', final_epoch)
                write(dest / 'comparison.json', comparison)
                entry['finalEpochMatchesHistorical'] = final_epoch == (12609 if seed == 2 else 16384)
                entry['completionCountsValid'] = completion['gpuIntegrity']['checkedEpochs'] == final_epoch and completion['gpuIntegrity']['completedPairs'] == final_epoch * 65536
                mismatch = (not entry['finalEpochMatchesHistorical'] or not entry['initialStateMatchesPriorRepeat'] or any(r['matchesHistorical'] is False for r in comparison['checkpoints'])
                    or bool(comparison['series']['differences']) or bool(comparison['missingHistoricalCheckpointsWithinRun'])
                    or bool(comparison['series']['missingRepeatRowsWithinRun']))
                entry['status'] = ('completed-with-mismatches' if mismatch else 'completed-matching-available-history') if entry['completionCountsValid'] and entry['finalSnapshotMatchesReceipt'] else 'invalid-completion-evidence'
                entry['receiptErrors'] = []
                for snapshot in sorted(dest.glob('soup-*.bin')):
                    receipt = subprocess.run(['deno', 'run', '--frozen', '-A', 'tools/soup-receipt.ts', str(snapshot)], capture_output=True, text=True, timeout=RECEIPT_TIMEOUT_SECONDS)
                    (dest / (snapshot.name + '.receipt.json')).write_text(receipt.stdout)
                    if receipt.returncode:
                        entry['status'] = 'failed'
                        entry['receiptErrors'].append({'snapshot': snapshot.name, 'stderr': receipt.stderr})
                    else:
                        validate_receipt(snapshot, receipt.stdout, invocation['compressor'])
        except Exception as error:
            entry.update(status='failed', error=f'{type(error).__name__}: {error}')
        finally:
            entry['finished'] = now()
            try:
                entry['sourceUnchanged'] = all(sha(p) == expected for p, expected in sources.items())
            except OSError:
                entry['sourceUnchanged'] = False
            if not entry['sourceUnchanged']:
                entry['status'] = 'failed'
                entry['error'] = 'source changed during run or receipt generation'
        write(output / 'manifest.json', manifest)
        print(f'seed {seed}: {entry["status"]}', flush=True)
    failed = any(r['status'] in ['failed', 'invalid-completion-evidence'] or r.get('receiptErrors') for r in manifest['runs'])
    mismatched = any(r['status'] == 'completed-with-mismatches' for r in manifest['runs'])
    manifest['status'] = 'finished-with-failures' if failed else 'finished-with-mismatches' if mismatched else 'finished-matching-available-history'
    manifest['finished'] = now()
    write(output / 'manifest.json', manifest)
    return 1 if failed else 2 if mismatched else 0


if __name__ == '__main__':
    if len(sys.argv) not in [3, 4] or (len(sys.argv) == 4 and sys.argv[3] != '--run'):
        raise SystemExit(__doc__)
    raise SystemExit(main(sys.argv[1], sys.argv[2], len(sys.argv) == 4))
