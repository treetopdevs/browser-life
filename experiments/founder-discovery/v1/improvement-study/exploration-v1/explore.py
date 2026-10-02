"""Exploratory, post hoc analysis of the completed improvement study (not confirmatory).

Reads only the committed operation042 report. No checkpoints, simulations or assays.
Usage: PYTHONDONTWRITEBYTECODE=1 python3 explore.py   (writes results.json beside this file)
"""
import hashlib, itertools, json, math, pathlib, random, statistics as st

HERE = pathlib.Path(__file__).resolve().parent
REPORT = HERE.parent / 'distribution-v1/analysis-v1/report.json'
REPORT_SHA = '085d55cf1f7121ece85ff3a5dc9fa5f236c912531e480e3262db99ad205ec68a'
raw = REPORT.read_bytes(); assert hashlib.sha256(raw).hexdigest() == REPORT_SHA
r = json.loads(raw)

IN = ['A', 'B', 'C', 'P', 'EPB', 'LIGHT', 'S', 'SGX', 'SGY', 'U']
OUT = ['PHOTO', 'RESP', 'DECOMP', 'GROW', 'BUILD', 'EMIT', 'MX', 'MY']
NI, NH, NO = 10, 8, 8
def slot_name(s):
    if s < NI * NH: return f'w1[{IN[s // NH]}->h{s % NH}]'
    s -= NI * NH
    if s < NH: return f'b1[h{s}]'
    s -= NH
    if s < NH * NO: return f'w2[h{s // NO}->{OUT[s % NO]}]'
    s -= NH * NO
    if s < NO: return f'b2[{OUT[s]}]'
    return ['mu', 'sigma', 'motGain'][s - NO]

def decode(hexs):
    """163 mutable slots in mutateInPlace order: 160 int8 weights, mu, sigma, motGain."""
    words = [int(hexs[i * 8:i * 8 + 8], 16) for i in range(42)]
    w = []
    for word in words[2:]:
        for b in range(4):
            u = (word >> (b * 8)) & 255; w.append(u - 256 if u > 127 else u)
    return w + [words[0] & 0xffff, words[0] >> 16, words[1] & 0xff]

def diff(a, b): return {i: b[i] - a[i] for i in range(163) if a[i] != b[i]}

founders = {}
for o in r['observations']:
    if o['time'] == 0: founders.setdefault(o['founderId'], None)
times = {t['time']: t for t in r['byTime']}
for a in times[0]['abundance']:
    g = a['sample']['byGenomeAbundance']; assert len(g) == 1
    founders[a['founderId']] = decode(g[0]['hex'])
FIDS = sorted(founders, key=lambda f: int(f.split('-')[-1]))

# Mean score per draw (16 technical observations).
draw_scores = {}
for o in r['observations']:
    draw_scores.setdefault((o['unitId'], o['time'], o['draw']), []).append(o['score'])
draw_scores = {k: st.mean(v) for k, v in draw_scores.items()}

out = {'format': 'founder-improvement-exploration/v1', 'status': 'EXPLORATORY-POST-HOC',
       'reportSha256': REPORT_SHA, 'founders': {}, 'draws': [], 'parallelism': {}}

for t in (100_000, 1_000_000):
    for a in times[t]['abundance']:
        if a['mode'] != 'normal': continue
        f = founders[a['founderId']]; s = a['sample']
        for d, hexs in enumerate(s['draws']['genomes']):
            dd = diff(f, decode(hexs))
            out['draws'].append({'unitId': a['unitId'], 'founderId': a['founderId'], 'seed': a['seed'], 'time': t,
                                 'draw': d, 'slotsChanged': len(dd), 'absDelta': sum(abs(v) for v in dd.values()),
                                 'meanScore': draw_scores[(a['unitId'], t, d)]})

for fid in FIDS:
    f = founders[fid]; rec = {}
    for t in (100_000, 1_000_000):
        units = [a for a in times[t]['abundance'] if a['founderId'] == fid]
        normal = [a for a in units if a['mode'] == 'normal']; off = [a for a in units if a['mode'] == 'off']
        # Mass-weighted population divergence and founder-genome share, normal arm.
        div, share, ngen, top = [], [], [], []
        for a in normal:
            g = a['sample']['byGenomeAbundance']; tot = sum(x['mass'] for x in g)
            dec = [(decode(x['hex']), x['mass']) for x in g]
            div.append(sum(len(diff(f, v)) * m for v, m in dec) / tot)
            share.append(sum(m for v, m in dec if v == f) / tot)
            ngen.append(len(g)); top.append(max(x['mass'] for x in g) / tot)
        dr = [x for x in out['draws'] if x['founderId'] == fid and x['time'] == t]
        rec[str(t)] = {
            'founderLineageMassNormalMedian': st.median(a['sample']['rootMass'] for a in normal),
            'founderLineageMassOffMedian': st.median(a['sample']['rootMass'] for a in off),
            'genomesNormalMedian': st.median(ngen),
            'topGenomeShareNormalMedian': st.median(top),
            'founderGenomeShareNormalMedian': st.median(share),
            'meanSlotsChangedMassWeightedMedian': st.median(div),
            'drawSlotsChangedMedian': st.median(x['slotsChanged'] for x in dr),
            'drawScoreMean': st.mean(x['meanScore'] for x in dr),
            'drawScoreVsSlotsSpearman': None,
        }
        xs = [x['slotsChanged'] for x in dr]; ys = [x['meanScore'] for x in dr]
        if len(set(xs)) > 1:
            def rank(v):
                order = sorted(range(len(v)), key=lambda i: v[i]); rk = [0.0] * len(v); i = 0
                while i < len(v):
                    j = i
                    while j + 1 < len(v) and v[order[j + 1]] == v[order[i]]: j += 1
                    for k in range(i, j + 1): rk[order[k]] = (i + j) / 2
                    i = j + 1
                return rk
            rx, ry = rank(xs), rank(ys); mx, my = st.mean(rx), st.mean(ry)
            num = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
            den = math.sqrt(sum((a - mx) ** 2 for a in rx) * sum((b - my) ** 2 for b in ry))
            rec[str(t)]['drawScoreVsSlotsSpearman'] = num / den if den else None
    out['founders'][fid] = rec

    # Parallelism at 1M: slot/direction changes in each seed's highest-mass genome.
    tops = []
    for a in sorted((a for a in times[1_000_000]['abundance'] if a['founderId'] == fid and a['mode'] == 'normal'), key=lambda a: a['seed']):
        g = max(a['sample']['byGenomeAbundance'], key=lambda x: x['mass'])
        tops.append({(s, v > 0) for s, v in diff(f, decode(g['hex'])).items()})
    counts = {}
    for changes in tops:
        for c in changes: counts[c] = counts.get(c, 0) + 1
    shared = sorted(((n, s, up) for (s, up), n in counts.items() if n >= 3), reverse=True)
    # Null: same number of changed slots per seed, slots uniform over 163, direction a fair coin.
    rng = random.Random(6460001); sims = []
    for _ in range(2000):
        cc = {}
        for changes in tops:
            for s in rng.sample(range(163), len(changes)):
                key = (s, rng.random() < 0.5); cc[key] = cc.get(key, 0) + 1
        sims.append(max(cc.values()) if cc else 0)
    observed_max = max(counts.values()) if counts else 0
    out['parallelism'][fid] = {
        'topGenomeSlotsChangedBySeed': [len(c) for c in tops],
        'sharedInAtLeast3Seeds': [{'seeds': n, 'slot': slot_name(s), 'direction': 'up' if up else 'down'} for n, s, up in shared],
        'maxSeedsSharingOneChange': observed_max,
        'nullMaxSharingP': sum(1 for x in sims if x >= observed_max) / len(sims),
    }

# Trajectory over all saved checkpoints (from trajectory.ts output in ignored runs/).
TRAJ = HERE.parents[4] / 'runs/founder-discovery-improvement-exploration-v1/trajectory.jsonl'
SWEEPS = {  # parallel changes found above: slot name, direction relative to founder
    'discovery-cluster-33': ('b2[PHOTO]', 1), 'discovery-cluster-139': ('mu', 1),
    'discovery-cluster-4': ('mu', 1), 'discovery-cluster-16': ('w2[h0->DECOMP]', 1)}
SLOT = {slot_name(s): s for s in range(163)}
if TRAJ.exists():
    traj_bytes = TRAJ.read_bytes(); rows = [json.loads(l) for l in traj_bytes.splitlines()]
    assert len(rows) == 64 * 11
    # Cross-check against the report's frozen samples at 0, 100k and 1M.
    for row in rows:
        if row['step'] in times:
            s = next(a['sample'] for a in times[row['step']]['abundance'] if a['unitId'] == row['unitId'])
            assert row['rootMass'] == s['rootMass'] and row['byGenome'] == s['byGenomeAbundance'], row['unitId']
    traj = {}
    for row in rows:
        f = founders[row['founderId']]; tot = row['rootMass']
        slot, sign = SWEEPS[row['founderId']]; s = SLOT[slot]
        dec = [(decode(x['hex']), x['mass']) for x in row['byGenome']]
        traj.setdefault((row['founderId'], row['mode'], row['step']), []).append({
            'rootMass': tot, 'genomes': len(dec),
            'divergence': sum(len(diff(f, v)) * m for v, m in dec) / tot,
            'founderShare': sum(m for v, m in dec if v == f) / tot,
            'sweepShare': sum(m for v, m in dec if (v[s] - f[s]) * sign > 0) / tot})
    out['trajectory'] = {'sha256': hashlib.sha256(traj_bytes).hexdigest(), 'sweepSlots': SWEEPS, 'medians': []}
    for (fid, mode, step), v in sorted(traj.items(), key=lambda kv: (FIDS.index(kv[0][0]), kv[0][1], kv[0][2])):
        out['trajectory']['medians'].append({'founderId': fid, 'mode': mode, 'step': step,
            **{k: st.median(x[k] for x in v) for k in v[0]},
            'sweepShareMin': min(x['sweepShare'] for x in v)})

(HERE / 'results.json').write_text(json.dumps(out, indent=2) + '\n')
for fid in FIDS:
    print(fid)
    for t, v in out['founders'][fid].items(): print(' ', t, {k: (round(x, 3) if isinstance(x, float) else x) for k, x in v.items()})
    p = out['parallelism'][fid]
    print('  parallel:', p['topGenomeSlotsChangedBySeed'], 'max', p['maxSeedsSharingOneChange'], 'null p', p['nullMaxSharingP'])
    for x in p['sharedInAtLeast3Seeds'][:8]: print('   ', x)
if 'trajectory' in out:
    print('trajectory medians (normal): step rootMass genomes divergence founderShare sweepShare[min]')
    for m in out['trajectory']['medians']:
        if m['mode'] == 'normal':
            print(f"  {m['founderId']:<22}{m['step']:>8} {m['rootMass']:>9.0f} {m['genomes']:>6.1f} {m['divergence']:>6.2f} {m['founderShare']:.2f} {m['sweepShare']:.2f}[{m['sweepShareMin']:.2f}]")
