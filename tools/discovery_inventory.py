"""Snapshot live discovery records and count admission losses; never run a simulator.

Usage: python3 tools/discovery_inventory.py SOURCE_REPO OUTPUT_DIRECTORY
Outputs are immutable: the output directory must not already exist.
"""
import collections
import hashlib
import json
import pathlib
import sys


def sha(data):
    return hashlib.sha256(data).hexdigest()


def genome_key(g):
    values = [g[k] for k in ('mu', 'sigma', 'motGain')]
    weights = g['weights']
    if len(weights) != 160 or any(type(x) is not int for x in values + weights):
        raise ValueError('Malformed genome')
    if any(x < -128 or x > 255 for x in weights):
        raise ValueError('Invalid weight byte')
    return json.dumps(values + [x % 256 for x in weights], separators=(',', ':'))


def failures(e):
    n = e['reps']
    if type(n) is not int or n <= 0:
        raise ValueError('Invalid replicate count')
    for field in ('survived', 'regenerated', 'lightDependent'):
        if type(e[field]) is not int or not 0 <= e[field] <= n:
            raise ValueError('Invalid evaluation count')
    result = []
    if e['survived'] == 0:
        result.append('survival')
    if 5 * e['regenerated'] <= 4 * n:
        result.append('regeneration')
    if e['lightDependent'] != n:
        result.append('light_dependence')
    return result


def read_bundle(folder):
    # Archive is the commit marker. Read all other records between two reads.
    before = (folder / 'archive.json').read_bytes()
    archive = json.loads(before)
    count = archive['viableCount']
    if type(count) is not int or count < 0:
        raise ValueError('Invalid committed prefix')
    with (folder / 'viable.jsonl').open('rb') as stream:
        lines = [stream.readline() for _ in range(count)]
    if any(not line.endswith(b'\n') for line in lines):
        raise ValueError('Incomplete committed prefix')
    files = {'archive.json': before, 'viable.jsonl': b''.join(lines)}
    for name in ('gate.json', 'confirm.json'):
        path = folder / name
        if path.exists():
            files[name] = path.read_bytes()
    if before != (folder / 'archive.json').read_bytes():
        raise ValueError('Archive changed while reading; retry later')
    rows = [json.loads(line) for line in lines]
    return archive, rows, files


def summarize(archive, rows, files):
    groups = collections.defaultdict(list)
    outcomes = collections.Counter()
    for line, row in enumerate(rows, 1):
        key = genome_key(row['genome'])
        failed = failures(row['eval'])
        outcomes['+'.join(failed) or 'passes_old_gate'] += 1
        groups[key].append((line, row, failed))
    gate = json.loads(files['gate.json']) if 'gate.json' in files else []
    gate_ids = {genome_key(row['genome']) for row in gate}
    confirm = json.loads(files['confirm.json']) if 'confirm.json' in files else None
    confirmed_ids = {genome_key(row['genome']) for row in confirm['rows']} if confirm else set()
    survivors = {k for k, obs in groups.items() if any(r['eval']['survived'] > 0 for _, r, _ in obs)}
    old_eligible = {k for k, obs in groups.items() if any(not f for _, _, f in obs)}
    return {
        'evaluated': archive['evaluated'], 'committed_observations': len(rows),
        'unique_genomes': len(groups), 'unique_recorded_survivors': len(survivors),
        'observation_outcomes_mutually_exclusive': dict(sorted(outcomes.items())),
        'unique_ever_old_gate_eligible': len(old_eligible),
        'unique_survivors_never_old_gate_eligible': len(survivors - old_eligible),
        'recorded_gate_genomes': len(gate_ids),
        'gate_missing_eligible': len(old_eligible - gate_ids),
        'gate_not_supported_by_prefix': len(gate_ids - old_eligible),
        'confirmation_present': confirm is not None,
        'unique_admitted_to_confirmation': len(confirmed_ids) if confirm else None,
        'confirmed_outside_gate': len(confirmed_ids - gate_ids) if confirm else None,
        'search_settings': archive.get('search'), 'resumes': archive.get('resumes'),
        'limitations': [
            'A surviving screen is not evidence of adaptation or organism reproduction.',
            'Only logged offers are counted; the archive is selected by its search score.',
            'Absence of confirmation file is pending or unavailable, not a failed evaluation.',
            'Snapshot may be from an active program; do not overwrite its source records.',
            'Counts do not establish the causal effect of changing a selection criterion.'
        ]
    }


def main():
    source, out = map(pathlib.Path, sys.argv[1:])
    if out.exists():
        raise ValueError('Refusing to overwrite evidence')
    bundles = {}
    for name in ('bootstrap-medium-waste', 'bootstrap-medium-background'):
        bundles[name] = read_bundle(source / 'runs' / name)
    code = {name: (source / name).read_bytes() for name in (
        'tools/bootstrap.ts', 'packages/search/src/evaluate.ts',
        'packages/search/src/mapelites.ts')}
    out.mkdir(parents=True)
    manifest = {'source_root': str(source.resolve()), 'files': {}, 'studies': {}}
    for name, (archive, rows, files) in bundles.items():
        (out / name).mkdir()
        for fn, data in files.items():
            rel = name + '/' + fn
            (out / rel).write_bytes(data)
            manifest['files'][rel] = {'sha256': sha(data), 'bytes': len(data)}
        manifest['studies'][name] = summarize(archive, rows, files)
    for name, data in code.items():
        rel = 'source/' + name
        (out / rel).parent.mkdir(parents=True, exist_ok=True)
        (out / rel).write_bytes(data)
        manifest['files'][rel] = {'sha256': sha(data), 'bytes': len(data)}
    (out / 'inventory.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps(manifest['studies'], indent=2))


if __name__ == '__main__':
    main()
