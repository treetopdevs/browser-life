#!/usr/bin/env python3
"""TRAIT-CONFIRM: independent recomputation of PLAN.md's pass rule from the raw run files.

Written without reference to trait-summarize.ts's code paths: it reads each run's JSON, recomputes held from the
two late figures, the "between" mean from the 50 report rows, U from the last-census record, then the per-seed
conditions, block counts and the reading, and (with --against) compares all of it with the summariser's JSON.
It also prints the descriptive tables RESULTS.md uses beyond the summariser's own.

Usage: python3 experiments/dropgenes/trait-confirm-check.py <run dir> --seeds 25,26,27,28[,29,30,31,32]
         [--against <the summariser's JSON line, saved to a file>] [--calib <directory of the calibration runs, seeds 1 and 2>]
Exits 1 if anything disagrees with the summariser.
"""
import json, math, sys, os

ARMS = ['GATED_SEL', 'GATED_NEU', 'UNGATED_SEL', 'UNGATED_NEU']
STARTS = [0, 3]
STEPS = 200000
ENDS = list(range(102000, 200001, 2000))
assert len(ENDS) == 50

def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default

def load(d, seeds, steps_by_arm=None):
    runs = {}
    for name in sorted(os.listdir(d)):
        if not name.endswith('.json'):
            continue
        with open(os.path.join(d, name)) as fh:
            f = json.load(fh)
        s = f['summary']
        c = s['config']
        if c['seed'] not in seeds:
            continue
        arm = ('GATED' if c['gated'] else 'UNGATED') + '_' + ('NEU' if c['ladderNeutral'] else 'SEL')
        key = (arm, s['ladder']['startLevel'], c['seed'])
        assert key not in runs, key
        assert name == f"L{key[1]}-K2-cap16-{arm}-s{c['seed']}.json", name
        assert s['seed'] == c['seed']
        assert s['residual'] == '0', (name, s['residual'])
        runs[key] = f
    return runs

def held_of(s):
    return s['lateMeanCompartments'] >= 10 and s['lateCompleteShare'] >= 0.5

def level_of(f):
    s = f['summary']
    return s['ladder']['lateLevelMean'] if held_of(s) else None

def between_of(f):
    by = {}
    for r in f['rows']:
        resp = (r.get('ladder') or {}).get('resp')
        by[r['step']] = None if resp is None else resp.get('between')
    vals = []
    for e in ENDS:
        v = by.get(e)
        if v is None or not math.isfinite(v):
            return None
        vals.append(v)
    return math.fsum(vals) / 50

def within_of(f):
    vals = [(r.get('ladder') or {}).get('resp', {}).get('within') for r in f['rows'] if r['step'] in set(ENDS)]
    vals = [v for v in vals if v is not None]
    return math.fsum(vals) / len(vals) if vals else None

def neg_windows(f):
    covs = [(r.get('ladder') or {}).get('resp', {}).get('cov') for r in f['rows'] if r['step'] in set(ENDS)]
    covs = [v for v in covs if v is not None]
    return sum(1 for v in covs if v < 0), len(covs)

def ran_away(f):
    s = f['summary']
    lw = s['ladder']['lastWithCopies']
    return (not held_of(s)) and lw is not None and lw['copies'] >= 50 and lw['allLevelMean'] >= 3.5

def seed_verdict(runs, seed):
    g = [runs[('GATED_SEL', st, seed)] for st in STARTS]
    n = [runs[('GATED_NEU', st, seed)] for st in STARTS]
    u = [runs[('UNGATED_SEL', st, seed)] for st in STARTS]
    t = [runs[('UNGATED_NEU', st, seed)] for st in STARTS]
    gl, nl, ul = [level_of(x) for x in g], [level_of(x) for x in n], [level_of(x) for x in u]
    held = all(held_of(x['summary']) for x in g)
    apart = abs(gl[0] - gl[1]) if held else None
    converged = held and apart <= 0.25
    off = False
    off_margin = None
    if held and all(v is not None for v in nl):
        above = min(gl) - max(nl)   # how far the lower selected level is above the higher neutral level
        below = min(nl) - max(gl)   # how far the higher selected level is below the lower neutral level
        # The verdict compares against the shifted neutral bounds, as the summariser does: a subtraction can land one
        # ulp under 0.4 where 2.4 >= 2.0 + 0.4 holds. The subtractions stay for the displayed margin.
        off = min(gl) >= max(nl) + 0.4 or max(gl) <= min(nl) - 0.4
        off_margin = max(above, below)
    bg, bn, bu, bt = [between_of(x) for x in g], [between_of(x) for x in n], [between_of(x) for x in u], [between_of(x) for x in t]
    def resp(sel, neu):
        if any(v is None for v in sel + neu):
            return False
        return all(v < 0 for v in sel) and all(a < b for a in sel for b in neu)
    response = resp(bg, bn)
    G = held and converged and off and response
    U = all(ran_away(x) for x in u)
    T = all(held_of(x['summary']) for x in t)
    matches = all(ul[i] is not None and gl[i] is not None and abs(ul[i] - gl[i]) <= 0.25 for i in range(2))
    ures = resp(bu, bt)
    # distance of every compared quantity from its threshold or tie (for the boundary statement)
    dists = []
    if apart is not None: dists.append(('converged', abs(apart - 0.25)))
    if off_margin is not None: dists.append(('off neutral', abs(off_margin - 0.4)))
    for lab, sel, neu in (('response', bg, bn), ('ungated response', bu, bt)):
        if all(v is not None for v in sel + neu):
            dists.append((lab + ' sign', min(abs(v) for v in sel)))
            dists.append((lab + ' vs neutral', min(abs(a - b) for a in sel for b in neu)))
    for i in range(2):
        if ul[i] is not None and gl[i] is not None: dists.append(('matches', abs(abs(ul[i] - gl[i]) - 0.25)))
        lw = u[i]['summary']['ladder']['lastWithCopies']
        if lw is not None and not held_of(u[i]['summary']): dists.append(('runaway', abs(lw['allLevelMean'] - 3.5)))
    for x in g + n + u + t:
        s = x['summary']
        dists.append(('held: compartments', abs(s['lateMeanCompartments'] - 10)))
        dists.append(('held: complete share', abs(s['lateCompleteShare'] - 0.5)))
    return dict(seed=seed, gatedLow=gl[0], gatedHigh=gl[1], apart=apart, neutralLow=nl[0], neutralHigh=nl[1], betweenSelected=bg, betweenNeutral=bn,
                held=held, converged=converged, offNeutral=off, response=response, G=G, U=U, ungatedMatchesGated=matches, ungatedResponse=ures, T=T,
                _ungated=ul, _bu=bu, _bt=bt, _offMargin=off_margin, _dists=dists)

READINGS = {
    'notG': 'Not confirmed: G fails. The per-seed table shows which of the four conditions failed.',
    'GUT': 'Both halves of the question: the gated level is set between compartments, and without the gate it runs away.',
    'GUnotT': 'The gated half holds; the ungated comparison is confounded with dilution (T fails) and says nothing about the gate.',
    'both': 'The level is held by selection between compartments with or without the gate; at this setting the gate is not what sets it.',
    'match': 'The gated half holds, and the ungated level matches the gated one; what holds it there without the gate is not shown (the ungated response condition is not met).',
    'neither': 'The gated half holds; the ungated world neither ran away nor matched the gated level.',
}

def reading(p):
    # PLAN.md's table, row by row
    if p['G'] and p['U'] and p['T']: return READINGS['GUT']
    if p['G'] and not p['U'] and p['ungatedMatchesGated'] and p['ungatedResponse']: return READINGS['both']
    if p['G'] and not p['U'] and p['ungatedMatchesGated'] and not p['ungatedResponse']: return READINGS['match']
    if p['G'] and not p['U']: return READINGS['neither']
    if p['G'] and p['U'] and not p['T']: return READINGS['GUnotT']
    return READINGS['notG']

def close(a, b):
    if a is None or b is None: return a is None and b is None
    return abs(a - b) <= 1e-12

def f(v, d=3):
    return 'n/a' if v is None or not math.isfinite(v) else f'{v:.{d}f}'

def main():
    d = sys.argv[1]
    seeds = [int(x) for x in arg('--seeds').split(',')]
    runs = load(d, set(seeds))
    for seed in seeds:
        for a in ARMS:
            for st in STARTS:
                assert (a, st, seed) in runs, ('missing', a, st, seed)
                s = runs[(a, st, seed)]['summary']
                assert s['steps'] == STEPS and (s['stepsRun'] == STEPS or s['extinctAt'] is not None)
                assert held_of(s) == s['held'], ('held mismatch', a, st, seed)
    V = [seed_verdict(runs, s) for s in seeds]
    parts = ['G', 'U', 'T', 'ungatedMatchesGated', 'ungatedResponse']
    blocks = [V[i:i + 4] for i in range(0, len(V), 4)]
    per_block = [{k: sum(1 for v in b if v[k]) for k in parts} for b in blocks]
    passes = {k: all(c[k] >= 3 for c in per_block) for k in parts}
    rd = ('Half the confirmation (one block of four seeds). ' if len(blocks) == 1 else '') + reading(passes)

    print(f'Independent recomputation from {d}, seeds {seeds}: {len(runs)} run files, residual 0 in all.\n')
    print('| seed | held | converged (apart) | off neutral (margin beyond the neutral range) | response | G | U | T | ungated matches gated | ungated response |')
    print('|---|---|---|---|---|---|---|---|---|---|')
    yn = lambda b: 'yes' if b else 'no'
    for v in V:
        print(f"| {v['seed']} | {yn(v['held'])} | {yn(v['converged'])} ({f(v['apart'])}) | {yn(v['offNeutral'])} ({f(v['_offMargin'])}) | {yn(v['response'])} | {yn(v['G'])} | {yn(v['U'])} | {yn(v['T'])} | {yn(v['ungatedMatchesGated'])} | {yn(v['ungatedResponse'])} |")
    print()
    for i, c in enumerate(per_block):
        print(f"block {i + 1} (seeds {[v['seed'] for v in blocks[i]]}): " + ', '.join(f'{k} {c[k]} of 4' for k in parts))
    print('parts: ' + ', '.join(f"{k} {'passes' if passes[k] else 'fails'}" for k in parts))
    print(f'reading: {rd}\n')

    # closest approach of any compared quantity to its threshold or tie
    allD = sorted(((dist, lab, v['seed']) for v in V for lab, dist in v['_dists']), key=lambda x: x[0])
    print('Closest approaches to a threshold or tie (smallest five): ' + '; '.join(f'{lab}, seed {seed}: {dist:.4g}' for dist, lab, seed in allD[:5]))
    print(f'Any within 1e-9: {"YES" if allD[0][0] < 1e-9 else "no"}\n')

    # held figures and census counts
    print('| arm | start | seed | late compartments | late complete share | late censuses with a level (of 400) | steps run | extinct at |')
    print('|---|---|---|---|---|---|---|---|')
    for a in ARMS:
        for st in STARTS:
            for seed in seeds:
                s = runs[(a, st, seed)]['summary']
                print(f"| {a} | {st} | {seed} | {s['lateMeanCompartments']:.2f} | {s['lateCompleteShare']:.3f} | {s['ladder']['lateLevelCensuses']} | {s['stepsRun']} | {s['extinctAt']} |")
    print()

    # Level through time from the 500-step series: arrival of the low start, and the spread of 20,000-step stretch means.
    print('Level through time, from the 500-step series (mean level of copies in compartments). "First within 0.25": the first point of the series within 0.25 of the late level. "Outside after": points of the series after that which are more than 0.25 from the late level (count; first and last step; furthest value). Stretch means: the range of the means of consecutive 20,000-step stretches after the first 40,000 steps.\n')
    print('| arm | start | seed | late level | level from the 500-step series, last tenth | first within 0.25 at step | outside after | lowest and highest 20,000-step stretch mean after step 40,000 |')
    print('|---|---|---|---|---|---|---|---|')
    for a in ARMS:
        for st in STARTS:
            for seed in seeds:
                fl = runs[(a, st, seed)]
                ser = [(r[0], r[4]) for r in fl['levelSeries'] if r[4] is not None]
                late = fl['summary']['ladder']['lateLevelMean']
                lateS = [v for s_, v in ser if s_ > 180000]
                approx = sum(lateS) / len(lateS) if lateS else None
                arrived = None
                outside = 'n/a'
                if late is not None:
                    arrived = next((s_ for s_, v in ser if abs(v - late) <= 0.25), None)
                    out = [(s_, v) for s_, v in ser if arrived is not None and s_ > arrived and abs(v - late) > 0.25]
                    outside = 'none' if not out else f"{len(out)} (steps {out[0][0]} to {out[-1][0]}; furthest {max(out, key=lambda x: abs(x[1] - late))[1]:.3f})"
                st_means = []
                for lo in range(40000, STEPS, 20000):
                    vs = [v for s_, v in ser if lo < s_ <= lo + 20000]
                    if vs: st_means.append(sum(vs) / len(vs))
                rng = f'{min(st_means):.3f} to {max(st_means):.3f}' if st_means else 'n/a'
                print(f"| {a} | {st} | {seed} | {f(late)} | {f(approx)} | {arrived if arrived is not None else 'n/a'} | {outside} | {rng} |")
    print()

    # Response terms over the 50 second-half windows
    print('Response over the 50 windows ending at steps 102,000 to 200,000: mean "between", mean "within", windows with negative covariance.\n')
    print('| arm | start | seed | between | within | negative windows |')
    print('|---|---|---|---|---|---|')
    for a in ARMS:
        for st in STARTS:
            for seed in seeds:
                fl = runs[(a, st, seed)]
                ng, nw = neg_windows(fl)
                print(f"| {a} | {st} | {seed} | {f(between_of(fl), 4)} | {f(within_of(fl), 4)} | {ng} of {nw} |")
    print()

    # Ranges by arm, for the write-up
    print('Ranges by arm and start over these seeds (late level; late compartments; top-level share; between; within):\n')
    print('| arm | start | runs held | late level | late compartments | late top-level share | sd of level among compartments | between | within | negative windows |')
    print('|---|---|---|---|---|---|---|---|---|---|')
    def rng(vs, d=3):
        vs = [v for v in vs if v is not None]
        return f'{min(vs):.{d}f} to {max(vs):.{d}f}' if vs else 'n/a'
    for a in ARMS:
        for st in STARTS:
            fs = [runs[(a, st, seed)] for seed in seeds]
            negs = [neg_windows(x)[0] for x in fs]
            print(f"| {a} | {st} | {sum(1 for x in fs if held_of(x['summary']))} of {len(fs)} | {rng([level_of(x) for x in fs])} | {rng([x['summary']['lateMeanCompartments'] for x in fs], 1)} | "
                  f"{rng([x['summary']['ladder']['lateTopShare'] for x in fs])} | {rng([x['summary']['ladder']['lateCompLevelSd'] for x in fs], 2)} | {rng([between_of(x) for x in fs], 4)} | {rng([within_of(x) for x in fs], 4)} | {min(negs)} to {max(negs)} of 50 |")
    print()

    # Heredity, second half, ranges by arm
    print('Heredity of level over the splits of the second half, ranges over these seeds and both starts (parent r / nearest-neighbour r / unrelated r):\n')
    print('| arm | at the split | 500 steps later, survivors only | last seen | share of daughters gone by 500 steps | share merged | level at the split: lasted, gone | last level of the gone |')
    print('|---|---|---|---|---|---|---|---|')
    for a in ARMS:
        fs = [runs[(a, st, seed)]['summary']['ladder'] for st in STARTS for seed in seeds]
        def tri(key):
            hs = [x[key] for x in fs]
            return f"{rng([h['parentR'] for h in hs], 2)} / {rng([h['neighbourR'] for h in hs], 2)} / {rng([h['unrelatedR'] for h in hs], 2)}"
        dl = [x['heredityLevelDelayedSecondHalf'] for x in fs]
        ls = [x['heredityLevelLastSeenSecondHalf'] for x in fs]
        gone = [h['gone'] / (h['read'] + h['gone'] + h['fused'] + h['pending']) for h in dl if (h['read'] + h['gone'] + h['fused'] + h['pending']) > 0]
        mer = [h['merged'] / (h['read'] + h['gone'] + h['leftOut']) for h in ls if (h['read'] + h['gone'] + h['leftOut']) > 0]
        print(f"| {a} | {tri('heredityLevelSecondHalf')} | {tri('heredityLevelDelayedSecondHalf')} | {tri('heredityLevelLastSeenSecondHalf')} | {rng(gone, 2)} | {rng(mer, 3)} | "
              f"{rng([h['splitTraitRead'] for h in ls], 2)}, {rng([h['splitTraitGone'] for h in ls], 2)} | {rng([h['lastTraitGone'] for h in ls], 2)} |")
    print()

    # Compare with the summariser's JSON
    against = arg('--against')
    if against:
        with open(against) as fh:
            j = json.load(fh)
        bad = []
        if len(V) != len(j['verdicts']): bad.append(('verdict count', len(V), len(j['verdicts'])))
        for v, w in zip(V, j['verdicts']):
            for k in ['seed', 'held', 'converged', 'offNeutral', 'response', 'G', 'U', 'ungatedMatchesGated', 'ungatedResponse', 'T']:
                if v[k] != w[k]: bad.append((v['seed'], k, v[k], w[k]))
            for k in ['gatedLow', 'gatedHigh', 'apart', 'neutralLow', 'neutralHigh']:
                if not close(v[k], w[k]): bad.append((v['seed'], k, v[k], w[k]))
            for k in ['betweenSelected', 'betweenNeutral']:
                if len(v[k]) != len(w[k]): bad.append((v['seed'], k + ' length', len(v[k]), len(w[k])))
                for a_, b_ in zip(v[k], w[k]):
                    if not close(a_, b_): bad.append((v['seed'], k, a_, b_))
        c = j['confirmation']
        if c['blocks'] != [[v['seed'] for v in b] for b in blocks]: bad.append(('blocks', c['blocks']))
        if c['perBlock'] != per_block: bad.append(('perBlock', c['perBlock'], per_block))
        if c['passes'] != passes: bad.append(('passes', c['passes'], passes))
        if c['reading'] != rd: bad.append(('reading', c['reading'], rd))
        if j['rule'] != {'dist': 0.25, 'margin': 0.4, 'runaway': 3.5}: bad.append(('rule', j['rule']))
        print(f"Against the summariser ({against}): " + ('every per-seed condition, level, between term, block count, part and the reading AGREE.' if not bad else f'DISAGREEMENTS: {bad}'))
        if bad: sys.exit(1)

    calib = arg('--calib')
    if calib:
        cr = load(calib, {1, 2})
        print('\nCalibration seeds 1 and 2 (final kernel, v3-cand-c01; UNGATED_NEU there ran 50,000 steps), the same figures:\n')
        print('| arm | start | seed | steps | held | late compartments | late level | late top-level share | between over the second half | negative windows |')
        print('|---|---|---|---|---|---|---|---|---|---|')
        for a in ARMS:
            for st in STARTS:
                for seed in (1, 2):
                    fl = cr[(a, st, seed)]
                    s = fl['summary']
                    full = s['steps'] == STEPS
                    ng, nw = neg_windows(fl) if full else (None, None)
                    print(f"| {a} | {st} | {seed} | {s['steps']} | {yn(s['held'])} | {s['lateMeanCompartments']:.1f} | {f(s['ladder']['lateLevelMean'])} | {f(s['ladder']['lateTopShare'])} | {f(between_of(fl), 4) if full else 'n/a (50,000 steps)'} | {f'{ng} of {nw}' if full else 'n/a'} |")

main()
