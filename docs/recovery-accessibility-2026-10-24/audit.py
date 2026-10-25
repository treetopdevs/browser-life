"""Post-hoc test-2 candidate locator. Reads existing records; runs no simulations.
From the repo root: python3 docs/recovery-accessibility-2026-10-24/audit.py
Redirect stdout to audit.json to save the report. Python standard library only.
"""
import collections
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
inputs = []

def read(path):
    raw = path.read_bytes()
    inputs.append({'path': str(path.relative_to(ROOT)), 'sha256': hashlib.sha256(raw).hexdigest()})
    return json.loads(raw)

def validate(e, n):
    assert e['reps'] == n and len(e['perRep']) == n
    for field, per in [('regenerated', 'regenerated'), ('survived', 'alive'), ('lightDependent', 'lightDependent')]:
        assert e[field] == sum(bool(r[per]) for r in e['perRep']), field

def viable(e, p):
    n, pn = e['reps'], p['reps']
    return all(10 * (e[k] * pn - p[k] * n) >= -n * pn for k in ['survived', 'lightDependent'])

screen = {}
counts = collections.defaultdict(collections.Counter)
for path in sorted((ROOT / 'runs/found-t2/screen').glob('*.json')):
    u = read(path)
    assert len(u['mutants']) == len(u['parent'])
    for k, m in enumerate(u['mutants']):
        key = (u['f'], u['s'], m['m'])
        assert key not in screen
        e, p = m['eval'], u['parent'][k]
        validate(e, 4); validate(p, 4)
        screen[key] = (m, p, str(path.relative_to(ROOT)))
        c = counts[u['s']]
        c['mutants'] += 1
        c['unchanged'] += bool(m['unchanged'])
        c['positive_regeneration_difference'] += e['regenerated'] > p['regenerated']
        c['parent_regenerated'] += p['regenerated']; c['parent_trials'] += p['reps']
assert set(screen) == {(f, s, m) for f in range(12) for s in [24, 8, 4] for m in range(200)}
expected = read(ROOT / 'runs/foundations/results/t2-candidates.json')
expected_keys = {(c['f'], c['s'], c['m']) for c in expected}
assert len(expected_keys) == len(expected)
seen = set()
summary = collections.Counter()
ranked = []
for path in sorted((ROOT / 'runs/found-t2/confirm').glob('*.json')):
    u = read(path)
    for c in u['candidates']:
        key = (c['f'], c['s'], c['m'])
        assert key not in seen and key in expected_keys
        seen.add(key)
        m, sp, source = screen[key]
        e, p = c['eval'], c['parent']
        validate(e, 32); validate(p, 32)
        gain = e['regenerated'] - p['regenerated']
        screen_gain = m['eval']['regenerated'] - sp['regenerated']
        ok = viable(e, p) and viable(m['eval'], sp) and not m['unchanged']
        summary['candidates'] += 1
        summary['positive_regeneration_difference'] += gain > 0
        summary['viable_gain_at_least_10_points'] += ok and 10 * gain >= 32
        summary['viable_gain_at_least_20_points'] += ok and 5 * gain >= 32
        if ok and gain > 0 and screen_gain > 0:
            wins = sum(a['regenerated'] and not b['regenerated'] for a,b in zip(e['perRep'], p['perRep']))
            losses = sum(b['regenerated'] and not a['regenerated'] for a,b in zip(e['perRep'], p['perRep']))
            n = wins + losses
            nominal = sum(math.comb(n, k) for k in range(wins, n + 1)) / 2**n
            ranked.append(dict(f=key[0], s=key[1], m=key[2], gain_count=gain,
                screen_gain_count=screen_gain, mutant_regenerated=e['regenerated'],
                parent_regenerated=p['regenerated'], reps=32, wins=wins, losses=losses,
                nominal_p_not_selection_adjusted=nominal, slot=m['slot'], delta=m['delta'],
                mutant_hex=m['hex'], screen_file=source, confirmation_file=str(path.relative_to(ROOT))))
assert seen == expected_keys
ranked.sort(key=lambda x: (-x['gain_count'], -x['screen_gain_count'], x['f'], x['m']))
summary['positive_in_both_with_viability'] = len(ranked)
print(json.dumps(dict(status='POST-HOC / CANDIDATE LOCATOR ONLY',
    caveats=['Historical confirmation selected other traits/role; this is not the full mutation panel.',
             'The tracked runner uses equal seeds and tile slots in separate parent and mutant calls.',
             'No nominal p-value here establishes improvement after inspecting many candidates.',
             'Input hashes identify files read now, not missing historical executable provenance.'],
    screen_by_scale=dict(counts), confirmation=dict(summary),
    ranking_rule='positive in both, viable in both, changed genome; descending confirmation gain, screen gain, ascending f,m',
    selected=ranked[0] if ranked else None, ranked=ranked, inputs=inputs), indent=2))
