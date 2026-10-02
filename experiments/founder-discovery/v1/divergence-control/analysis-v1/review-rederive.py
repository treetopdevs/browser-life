#!/usr/bin/env python3
"""Independent Python re-derivation of the divergence-control analysis (read-only).

Does NOT call or port the TypeScript analyzer. It re-implements, from the protocol text and
the library source for the pieces the protocol defers to (Mulberry32 sampler, genome hex
layout, bootstrap): genome regeneration, cache-key recomputation, raw-file -> roster mapping,
score recomputation from masses, all estimands (exact Fractions, then floats), technical
completeness checks, bootstrap, and post hoc splits. Writes only to its own folder.
"""
import json, hashlib, glob, os, sys, math
from fractions import Fraction
from collections import defaultdict, Counter

REPO = '/Users/nicholas/develop/browser-life-founder-policy'
RUN = REPO + '/runs/founder-discovery-divergence-control-v1'
DC = REPO + '/experiments/founder-discovery/v1/divergence-control'
FROZEN = REPO + '/experiments/founder-discovery/v1/improvement-study'
EVOLVED_RESULTS = REPO + '/runs/founder-discovery-improvement-consolidated-v1/assays'
OUTDIR = os.path.dirname(os.path.abspath(__file__))

checks = []      # (name, ok, detail)
extra = {}       # extra numbers for the review


def chk(name, ok, detail=''):
    checks.append({'name': name, 'result': 'pass' if ok else 'fail', 'detail': detail})
    print(('PASS ' if ok else 'FAIL ') + name + (' :: ' + detail if detail else ''))
    return ok


def sha_bytes(b):
    return hashlib.sha256(b).hexdigest()


def sha_file(p):
    return sha_bytes(open(p, 'rb').read())


def jload(p):
    return json.load(open(p))


# ------------------------------------------------------------------ inputs
roster = jload(DC + '/roster.json')
candidate = jload(DC + '/candidate.json')
release = jload(DC + '/release.json')
report_new = jload(DC + '/analysis-v1/report.json')
posthoc = jload(DC + '/analysis-v1/post-hoc.json')
frozen = jload(FROZEN + '/distribution-v1/analysis-v1/report.json')
manifest = jload(FROZEN + '/manifest.json')

# --- pin chain
chk('report sha256 = e72d4792...', sha_file(DC + '/analysis-v1/report.json') ==
    'e72d47922ca0f95b221d78174fab537b69ef0a9d892c2f44773217d80b78638e')
chk('protocol sha256 equals candidate pin', sha_file(REPO + '/experiments/founder-discovery/v1/divergence-control-protocol.md') == candidate['protocol']['sha256'])
chk('roster sha256 equals candidate pin', sha_file(DC + '/roster.json') == candidate['roster']['sha256'])
chk('candidate sha256 equals release pin', sha_file(DC + '/candidate.json') == release['candidateSha256'])
chk('frozen report sha256 equals candidate pin and task statement',
    sha_file(FROZEN + '/distribution-v1/analysis-v1/report.json') == candidate['report']['sha256'] ==
    '085d55cf1f7121ece85ff3a5dc9fa5f236c912531e480e3262db99ad205ec68a')
chk('manifest sha256 equals candidate pin', sha_file(FROZEN + '/manifest.json') == candidate['manifest']['sha256'])
SRC = manifest['sourceManifestHash']
chk('roster/candidate sourceManifestHash = manifest', roster['inputs']['sourceManifestHash'] == SRC == candidate['manifest']['sourceManifestHash'])

# ------------------------------------------------------------------ genome utilities
NN = 160
MU, SIGMA, GAIN = 160, 161, 162


def slots_of(h):
    assert len(h) == 336 and h == h.lower()
    words = [int(h[i * 8:i * 8 + 8], 16) for i in range(42)]
    mu = words[0] & 0xffff
    sigma = words[0] >> 16
    gain = words[1] & 0xff
    assert words[1] >> 8 == 0
    w = []
    for word in words[2:]:
        for b in range(4):
            u = (word >> (b * 8)) & 255
            w.append(u - 256 if u > 127 else u)
    return w + [mu, sigma, gain]


def hex_of(s):
    assert len(s) == 163
    words = [((s[SIGMA] << 16) | s[MU]) & 0xffffffff, s[GAIN]]
    for i in range(0, 160, 4):
        words.append((s[i] & 255) | ((s[i + 1] & 255) << 8) | ((s[i + 2] & 255) << 16) | ((s[i + 3] & 255) << 24))
    return ''.join('%08x' % w for w in words)


def bounds(slot):
    if slot < NN:
        return (-127, 127)
    return {MU: (16, 4095), SIGMA: (2, 1023), GAIN: (0, 255)}[slot]


class Random:
    """Mulberry32 with rejection (re-implemented from tools/lib/founder-policy.ts semantics)."""
    M = 0xffffffff

    def __init__(self, seed):
        assert 0 <= seed <= 0xffffffff
        self.state = seed

    @staticmethod
    def imul(a, b):
        return (a * b) & 0xffffffff

    def u32(self):
        M = self.M
        self.state = (self.state + 0x6d2b79f5) & M
        t = self.state
        t = self.imul(t ^ (t >> 15), t | 1)
        t ^= (t + self.imul(t ^ (t >> 7), t | 61)) & M
        return (t ^ (t >> 14)) & M

    def int(self, bound):
        limit = (0x100000000 // bound) * bound
        while True:
            n = self.u32()
            if n < limit:
                return n % bound


def signed(slot, base, mag, sign):
    lo, hi = bounds(slot)
    for v in (base + sign * mag, base - sign * mag):
        if lo <= v <= hi:
            return v
    return None


def place(rng, base, out, pool, mag):
    excluded = set()
    while True:
        cands = [s for s in pool if s not in excluded]
        if not cands:
            raise Exception('no slot')
        slot = cands[rng.int(len(cands))]
        sgn = 1 if rng.int(2) else -1
        v = signed(slot, base[slot], mag, sgn)
        if v is None:
            excluded.add(slot)
            continue
        out[slot] = v
        pool.remove(slot)
        return slot


def type_matched_mutant(founder, desc, seed):
    changed = [s for s in range(163) if desc[s] != founder[s]]
    rng = Random(seed)
    out = list(founder)
    weights = list(range(NN))
    for s in [c for c in changed if c < NN]:
        place(rng, founder, out, weights, abs(desc[s] - founder[s]))
    for s in [c for c in changed if c >= NN]:
        mag = abs(desc[s] - founder[s])
        v = signed(s, founder[s], mag, 1 if rng.int(2) else -1)
        assert v is not None
        out[s] = v
    return out


def carrier_median(founder, abundance, slot):
    car = sorted([(slots_of(g['hex'])[slot], g['mass']) for g in abundance if slots_of(g['hex'])[slot] > founder[slot]], key=lambda x: x[0])
    total = sum(m for _, m in car)
    acc = 0
    for v, m in car:
        acc += m
        if acc * 2 >= total:
            return v
    return None


# ------------------------------------------------------------------ cache key + raw results
def cache_key(desc, fnd, cfg, seed, assignment, steps=20000, src=SRC):
    # key order and compact separators mimic JSON.stringify of the generator's object
    obj = {'descendantHex': desc, 'founderHex': fnd, 'cfg': cfg, 'seed': seed, 'assignment': assignment,
           'steps': steps, 'sourceManifestHash': src}
    return sha_bytes(json.dumps(obj, separators=(',', ':'), ensure_ascii=False).encode())


# assay seed -> cfg, taken from the FROZEN study's own raw files (not from the new results)
frozen_cfg = {}
frozen_obs = frozen['observations']
for o in frozen_obs:
    if o['cacheKey'] and o['assaySeed'] not in frozen_cfg:
        r = jload(EVOLVED_RESULTS + '/%s.json' % o['cacheKey'])
        frozen_cfg[o['assaySeed']] = r['cfg']
    if len(frozen_cfg) == 4:
        break
ASSAY_SEEDS = [6430001, 6430002, 6430003, 6430004]
ASSIGN = [0, 1]
chk('frozen cfg found for all 4 assay seeds', sorted(frozen_cfg) == ASSAY_SEEDS)

# roster basic structure
chk('roster counts 64/128/14/8/1200/8', roster['counts'] == {'evolvedDraws': 64, 'mutantGenomes': 128, 'reconstructionGenomes': 14,
    'specificityGenomes': 8, 'newConfigurations': 1200, 'replayConfigurations': 8, 'totalConfigurations': 1208}, str(roster['counts']))
genomes = {g['id']: g for g in roster['genomes']}
chk('150 genomes, unique ids', len(genomes) == 150 == len(roster['genomes']))
chk('no duplicate (descendantHex,founderHex) genome pairs', len({(g['descendantHex'], g['founderHex']) for g in roster['genomes']}) == 150)

# ---- raw file scan (independent index by content, not by roster)
files = sorted(glob.glob(RUN + '/assays/*.json'))
chk('1,200 raw assay files', len(files) == 1200, str(len(files)))
raw = {}
by_content = {}
bad = []
for f in files:
    b = open(f, 'rb').read()
    r = json.loads(b)
    stem = os.path.basename(f)[:-5]
    k = cache_key(r['descendantHex'], r['founderHex'], r['cfg'], r['seed'], r['assignment'], r['steps'], r['sourceManifestHash'])
    if k != stem or r['cacheKey'] != stem or r['sourceManifestHash'] != SRC or r['steps'] != 20000 or r['format'] != 'discovery-improvement-assay/v1':
        bad.append(stem)
    if r['cfg'] != frozen_cfg.get(r['seed']):
        bad.append('cfg:' + stem)
    ck = (r['descendantHex'], r['founderHex'], r['seed'], r['assignment'])
    if ck in by_content:
        bad.append('dupcontent:' + stem)
    by_content[ck] = stem
    raw[stem] = {'r': r, 'sha': sha_bytes(b)}
chk('every raw file: filename == recomputed cacheKey == stored cacheKey; cfg == frozen cfg; steps/format/sourceManifestHash ok',
    not bad, str(bad[:5]))
chk('no two raw files with identical (desc,founder,seed,assignment)', True if 'dupcontent' not in ''.join(map(str, bad)) else False)

# score recomputation
score_bad = []
nstat = Counter()
for k, v in raw.items():
    r = v['r']
    d, a = r['descendantMass'], r['ancestorMass']
    assert isinstance(d, int) and isinstance(a, int) and d >= 0 and a >= 0 and r['unassociatedMass'] >= 0
    if d + a == 0:
        exp_status, exp_score = 'both-extinct', None
        v['frac'] = None
    else:
        exp_status = 'scored'
        v['frac'] = Fraction(d - a, d + a)
        exp_score = (d - a) / (d + a)
    nstat[exp_status] += 1
    if r['status'] != exp_status or r['score'] != exp_score:
        score_bad.append(k)
chk('score/status in every raw file equals recomputation from masses (bitwise float equality)', not score_bad, str(score_bad[:5]))
extra['statusCounts'] = dict(nstat)
chk('no both-extinct outcome among 1,200 new results', nstat.get('both-extinct', 0) == 0, str(dict(nstat)))
extra['unassociatedMassNonzero'] = sum(1 for v in raw.values() if v['r']['unassociatedMass'] != 0)

# provenance
prov_dir = RUN + '/provenance'
prov_ok = True
pf = sorted(glob.glob(prov_dir + '/*.json'))
if len(pf) != 1200:
    prov_ok = False
sid = candidate['studyIdentitySha256']
for p in pf:
    k = os.path.basename(p)[:-5]
    exp = json.dumps({'format': 'discovery-divergence-control-provenance/v2', 'studyIdentitySha256': sid, 'cacheKey': k,
                      'resultSha256': raw[k]['sha']}, separators=(',', ':')) + '\n'
    if open(p).read() != exp:
        prov_ok = False
chk('1,200 provenance files each bind study identity + sha256 of the raw result bytes', prov_ok)

# ------------------------------------------------------------------ re-derive roster genomes
founder_hex_by_founder = {}
units = {u['id']: u for u in manifest['units']}
for u in manifest['units']:
    founder_hex_by_founder.setdefault(u['founderId'], set()).add(u['founderHex'])
chk('one founder hex per founder in manifest', all(len(v) == 1 for v in founder_hex_by_founder.values()))
FOUNDER_HEX = {k: next(iter(v)) for k, v in founder_hex_by_founder.items()}

bt = [t for t in frozen['byTime'] if t['time'] == 1000000][0]
abund = {a['unitId']: a for a in bt['abundance']}
evolved_order = []
for o in frozen_obs:
    if o['time'] != 1000000 or o['mode'] != 'normal':
        continue
    if o['drawId'] not in [e[0] for e in evolved_order]:
        evolved_order.append((o['drawId'], o['unitId'], o['founderId'], o['seed'], o['draw']))
chk('64 evolved draws in report order', len(evolved_order) == 64)
chk('roster.evolved order/ids match report order', [e['drawId'] for e in roster['evolved']] == [e[0] for e in evolved_order])
E_hex = {}
for (did, uid, fid, seed, draw) in evolved_order:
    E_hex[did] = abund[uid]['sample']['draws']['genomes'][draw]
chk('roster evolved descendantHex == frozen report sample draw genomes',
    all(e['descendantHex'] == E_hex[e['drawId']] for e in roster['evolved']))

# mutants
mut_ok = True
mut_detail = []
for k, (did, uid, fid, seed, draw) in enumerate(evolved_order, start=1):
    f = slots_of(FOUNDER_HEX[fid])
    e = slots_of(E_hex[did])
    for i in range(2):
        j = (k - 1) * 2 + i + 1
        m = type_matched_mutant(f, e, 6480000 + j)
        gid = 'm%03d' % j
        g = genomes[gid]
        if hex_of(m) != g['descendantHex'] or g['founderHex'] != FOUNDER_HEX[fid] or g['arm'] != 'mutant' or g['founderId'] != fid:
            mut_ok = False
            mut_detail.append(gid)
        # type-match properties
        wch = sorted(abs(e[s] - f[s]) for s in range(NN) if e[s] != f[s])
        wm = sorted(abs(m[s] - f[s]) for s in range(NN) if m[s] != f[s])
        pch = [(s, abs(e[s] - f[s])) for s in range(NN, 163) if e[s] != f[s]]
        pm = [(s, abs(m[s] - f[s])) for s in range(NN, 163) if m[s] != f[s]]
        if wch != wm or pch != pm:
            mut_ok = False
            mut_detail.append('type:' + gid)
        if not all(bounds(s)[0] <= m[s] <= bounds(s)[1] for s in range(163)):
            mut_ok = False
            mut_detail.append('bounds:' + gid)
chk('all 128 mutants regenerated bit-for-bit from the protocol sampler (Mulberry32 6480000+j); magnitude/type multiset & bounds preserved',
    mut_ok, str(mut_detail[:5]))
chk('roster.mutants evolvedDrawId/seed fields consistent',
    all(m['evolvedDrawId'] == evolved_order[(int(m['genomeId'][1:]) - 1) // 2][0] and m['seed'] == 6480000 + int(m['genomeId'][1:]) for m in roster['mutants']))

# reconstructions + specificity
def short(fid): return fid.split('-')[-1]

rec_ok = True
rec_vals = {}
spec_rows = []
for rc in roster['reconstructions']:
    fid = rc['founderId']
    slot = rc['slot']
    f = slots_of(FOUNDER_HEX[fid])
    us = sorted([u for u in manifest['units'] if u['founderId'] == fid and u['mode'] == 'normal'], key=lambda u: u['seed'])
    name = 'b2PHOTO' if slot == 152 else 'mu'
    vals = []
    for idx, u in enumerate(us):
        v = carrier_median(f, abund[u['id']]['sample']['byGenomeAbundance'], slot)
        vals.append(v)
        gid = 'r-%s-%s-%d' % (short(fid), name, v)
        s2 = list(f); s2[slot] = v
        if gid not in genomes or genomes[gid]['descendantHex'] != hex_of(s2):
            rec_ok = False
        if rc['perSeed'][idx] != {'seed': u['seed'], 'value': v, 'genomeId': gid}:
            rec_ok = False
        if rc['specificity']:
            cseed = 6480200 + idx + 1
            out = list(f)
            pool = [s for s in range(NN) if s != slot]
            cs = place(Random(cseed), f, out, pool, abs(v - f[slot]))
            cid = 'c-%s-s%d' % (short(fid), u['seed'])
            sp = [x for x in roster['specificity'] if x['genomeId'] == cid][0]
            if genomes[cid]['descendantHex'] != hex_of(out) or sp['slot'] != cs or sp['value'] != out[cs] or sp['controlSeed'] != cseed:
                rec_ok = False
            spec_rows.append({'seed': u['seed'], 'rValue': v, 'magnitude': abs(v - f[slot]), 'ctrlSlot': cs, 'ctrlFrom': f[cs], 'ctrlTo': out[cs], 'genomeId': cid})
    rec_vals[fid] = vals
    if rc['founderValue'] != f[slot]:
        rec_ok = False
chk('14 reconstruction genomes + 8 specificity controls regenerated bit-for-bit (carrier lower-median; Mulberry32 6480200+i)', rec_ok)
extra['reconstructionValues'] = rec_vals
extra['specificityControls'] = spec_rows

# ------------------------------------------------------------------ map every roster configuration to exactly one raw result
missing_cfg = []
cfg_map = {}   # (genomeId, seed, assignment) -> stem
roster_keys_ok = True
for g in roster['genomes']:
    for s in ASSAY_SEEDS:
        for a in ASSIGN:
            stem = by_content.get((g['descendantHex'], g['founderHex'], s, a))
            if stem is None:
                missing_cfg.append((g['id'], s, a))
                continue
            cfg_map[(g['id'], s, a)] = stem
            # independent cache key from genome hexes and frozen cfg
            if cache_key(g['descendantHex'], g['founderHex'], frozen_cfg[s], s, a) != stem:
                roster_keys_ok = False
chk('every roster configuration (150 genomes x 4 seeds x 2 assignments) has exactly one raw result by content', not missing_cfg and len(cfg_map) == 1200, str(missing_cfg[:3]))
chk('cache keys recomputed from roster hexes + frozen cfg equal result filenames', roster_keys_ok)
chk('roster.assays cacheKeys == those files, 1:1', {a['cacheKey'] for a in roster['assays']} == set(cfg_map.values()) == set(raw) and
    all(cfg_map[(a['genomeId'], a['assaySeed'], a['assignment'])] == a['cacheKey'] for a in roster['assays']))
extra['allResultsUsedOnce'] = len(set(cfg_map.values())) == 1200

# ------------------------------------------------------------------ E raw recomputation
E_obs = {}
E_raw_bad = []
obs_by_id = {o['id']: o for o in frozen_obs}
used_obs = [oid for e in roster['evolved'] for oid in e['observationIds']]
chk('512 evolved observations used (64 draws x 8)', len(used_obs) == 512 == len(set(used_obs)))
for e in roster['evolved']:
    for oid in e['observationIds']:
        o = obs_by_id[oid]
        r = jload(EVOLVED_RESULTS + '/%s.json' % o['cacheKey'])
        d, a = r['descendantMass'], r['ancestorMass']
        fr = Fraction(d - a, d + a) if d + a else None
        if (o['assaySeed'], o['assignment']) not in {(s, x) for s in ASSAY_SEEDS for x in ASSIGN}:
            E_raw_bad.append(oid)
        if r['descendantHex'] != e['descendantHex'] or r['founderHex'] != FOUNDER_HEX[e['founderId']] or r['seed'] != o['assaySeed'] or r['assignment'] != o['assignment'] or r['cfg'] != frozen_cfg[o['assaySeed']]:
            E_raw_bad.append(oid)
        if cache_key(r['descendantHex'], r['founderHex'], r['cfg'], r['seed'], r['assignment']) != o['cacheKey']:
            E_raw_bad.append('key:' + oid)
        if fr is None or float(fr) != o['score'] or o['status'] != 'scored':
            E_raw_bad.append('score:' + oid)
        E_obs[oid] = fr
chk('E: 512 observations re-read from the frozen raw result files, masses -> scores equal report scores; cfg/hex/seed/assignment/cache key consistent', not E_raw_bad, str(E_raw_bad[:5]))

# invariance of assignment pairs (justifies reduced design) re-checked from the frozen report, ALL modes
pair_bad = 0
pair_n = 0
sc = {}
for o in frozen_obs:
    sc[(o['drawId'], o['assaySeed'], o['assignment'])] = o['score']
for (did, s, a), v in list(sc.items()):
    if a in (0, 1):
        pair_n += 1
        if sc[(did, s, a + 2)] != v:
            pair_bad += 1
chk('frozen report: assignments 2,3 score exactly as 0,1 for every (draw, assay seed) in all arms/times', pair_bad == 0, 'pairs=%d bad=%d' % (pair_n, pair_bad))

# ------------------------------------------------------------------ estimands (exact)
def mean(xs):
    xs = list(xs)
    return sum(xs, Fraction(0)) / len(xs)

# genome mean with missing handling
def gsum(gid):
    sc = []
    for s in ASSAY_SEEDS:
        for a in ASSIGN:
            sc.append(raw[cfg_map[(gid, s, a)]]['frac'])
    return sc

def rng_of(scores):
    n = len(scores)
    lo = sum((x if x is not None else Fraction(-1) for x in scores), Fraction(0)) / n
    hi = sum((x if x is not None else Fraction(1) for x in scores), Fraction(0)) / n
    pt = sum(scores, Fraction(0)) / n if all(x is not None for x in scores) else None
    return (lo, hi, pt)

def avg(rs):
    n = len(rs)
    return (sum((r[0] for r in rs), Fraction(0)) / n, sum((r[1] for r in rs), Fraction(0)) / n,
            sum((r[2] for r in rs), Fraction(0)) / n if all(r[2] is not None for r in rs) else None)

def contrast(a, b):
    return (a[0] - b[1], a[1] - b[0], a[2] - b[2] if a[2] is not None and b[2] is not None else None)

TH = Fraction(1, 10)
G = {gid: rng_of(gsum(gid)) for gid in genomes}
founders = []
for e in roster['evolved']:
    if e['founderId'] not in founders:
        founders.append(e['founderId'])
seeds = sorted({e['seed'] for e in roster['evolved']})
mut_of = defaultdict(list)
for m in roster['mutants']:
    mut_of[m['evolvedDrawId']].append(m['genomeId'])

draws = {}
for e in roster['evolved']:
    ev = rng_of([E_obs[o] for o in e['observationIds']])
    ms = [G[g] for g in mut_of[e['drawId']]]
    assert len(ms) == 2
    draws[e['drawId']] = {'founderId': e['founderId'], 'seed': e['seed'], 'E': ev, 'Mi': ms, 'M': avg(ms)}
U = {}
for fid in founders:
    for s in seeds:
        d = [v for v in draws.values() if v['founderId'] == fid and v['seed'] == s]
        assert len(d) == 2
        E = avg([x['E'] for x in d]); M = avg([x['M'] for x in d]); C = contrast(E, M)
        U[(fid, s)] = {'E': E, 'M': M, 'C': C, 'cert': C[0] > TH}

missing_new = sum(1 for k in cfg_map.values() if raw[k]['frac'] is None)
chk('no missing / unavailable outcome in any of 1,200 results -> all bounds collapse (lower==upper==point)',
    missing_new == 0 and all(u['C'][0] == u['C'][1] == u['C'][2] for u in U.values()))

fl = float
sel = {}
for fid in founders:
    us = [U[(fid, s)] for s in seeds]
    E = avg([u['E'] for u in us]); M = avg([u['M'] for u in us]); C = avg([u['C'] for u in us])
    ncert = sum(u['cert'] for u in us)
    met = ncert >= 7
    if not met:
        reading = 'not met'
    elif E[0] <= TH:
        reading = 'purifying selection only'
    elif M[0] <= TH:
        reading = 'beyond divergence'
    else:
        reading = 'partly divergence'
    sel[fid] = {'certified': ncert, 'met': met, 'E': E, 'M': M, 'C': C, 'reading': reading}

def f3(x): return None if x is None else float(x)

print()
for fid in founders:
    s = sel[fid]
    print(fid, 'cert', s['certified'], 'met', s['met'], 'E %.4f M %.4f E-M %.4f' % (fl(s['E'][2]), fl(s['M'][2]), fl(s['C'][2])), s['reading'])
    print('   per-seed E,M,E-M:', [(sd % 100, round(fl(U[(fid, sd)]['E'][2]), 3), round(fl(U[(fid, sd)]['M'][2]), 3), round(fl(U[(fid, sd)]['C'][2]), 3), U[(fid, sd)]['cert']) for sd in seeds])

# compare with report
rep_sel = {x['founderId']: x for x in report_new['selection']}
maxdiff = 0
sel_match = True
for fid in founders:
    r = rep_sel[fid]; s = sel[fid]
    for key, mine in (('evolved', s['E']), ('mutant', s['M']), ('contrast', s['C'])):
        for i, nm in enumerate(('lower', 'upper', 'point')):
            maxdiff = max(maxdiff, abs(r[key][nm] - fl(mine[i])))
    if r['certifiedSeeds'] != s['certified'] or r['criterionMet'] != s['met'] or (r['reading'].split(':')[0] not in {
            'met, beyond divergence': 'x'} and False):
        sel_match = False
reading_map = {'beyond divergence': 'met, beyond divergence', 'partly divergence': 'met, partly divergence',
               'purifying selection only': 'met, purifying selection only', 'not met': 'not met'}
sel_match = sel_match and all(rep_sel[f]['reading'].startswith(reading_map[sel[f]['reading']]) for f in founders)
chk('A: founder-level E/M/contrast bounds, certified seed counts, criteria and readings match report', sel_match and maxdiff < 1e-12, 'max abs diff %.2e' % maxdiff)

units_diff = 0
unit_match = True
rep_units = {(u['founderId'], u['seed']): u for u in report_new['units']}
for k, u in U.items():
    r = rep_units[k]
    for key, mine in (('evolved', u['E']), ('mutant', u['M']), ('contrast', u['C'])):
        for i, nm in enumerate(('lower', 'upper', 'point')):
            units_diff = max(units_diff, abs(r[key][nm] - fl(mine[i])))
    if r['certified'] != u['cert']:
        unit_match = False
chk('A: all 32 unit values (E, M, E-M) and certification flags match report', unit_match and units_diff < 1e-12, 'max abs diff %.2e' % units_diff)
dd = 0
for r in report_new['draws']:
    d = draws[r['drawId']]
    dd = max(dd, abs(r['evolved']['point'] - fl(d['E'][2])), abs(r['mutant']['point'] - fl(d['M'][2])),
             *(abs(r['mutants'][i]['point'] - fl(d['Mi'][i][2])) for i in range(2)))
chk('A: 64 draw-level E, mutant-pair values match report', dd < 1e-12, 'max abs diff %.2e' % dd)

# exact margin diagnostics: smallest |contrast - 0.10| among units, and E lower vs 0.10, M lower vs 0.10
margins = sorted((abs(fl(u['C'][0] - TH)), k) for k, u in U.items())[:6]
extra['closestUnitMarginsTo0.10'] = [(m, k[0], k[1]) for m, k in margins]
extra['cluster4_M_minus_0.10'] = fl(sel['discovery-cluster-4']['M'][0] - TH)
extra['cluster4_M_exact'] = str(sel['discovery-cluster-4']['M'][0])

# ------------------------------------------------------------------ pooled block rule + bootstrap
blocks = []
for s in seeds:
    c = avg([U[(f, s)]['C'] for f in founders])
    blocks.append({'seed': s, 'lower': c[0], 'upper': c[1], 'point': c[2], 'cert': c[0] > TH})
pooled_effect = avg([(b['lower'], b['upper'], b['point']) for b in blocks])
bl = [fl(b['lower']) for b in blocks]; bu = [fl(b['upper']) for b in blocks]; bp = [fl(b['point']) for b in blocks]

def percentile(sorted_, p):
    at = (len(sorted_) - 1) * p; lo = math.floor(at); hi = math.ceil(at)
    return sorted_[lo] + (sorted_[hi] - sorted_[lo]) * (at - lo)

rng = Random(6480300)
BL, BU, BP = [], [], []
n = len(blocks)
for i in range(10000):
    s = [rng.int(n) for _ in range(n)]
    # JS reduce order: ((0 + x[s0]) + x[s1]) ... / n
    def red(arr):
        acc = 0.0
        for j in s:
            acc = acc + arr[j]
        return acc / n
    BL.append(red(bl)); BU.append(red(bu)); BP.append(red(bp))
BL.sort(); BU.sort(); BP.sort()
boot = {'bounded95': (percentile(BL, 0.025), percentile(BU, 0.975)), 'point95': (percentile(BP, 0.025), percentile(BP, 0.975))}
rd = report_new['descriptive']
print('\nblocks:', [(b['seed'] % 100, round(fl(b['point']), 4), b['cert']) for b in blocks])
print('pooled', fl(pooled_effect[2]), 'bootstrap', boot)
chk('descriptive: 8 pooled blocks match report (values and certification)', all(abs(rd['pooledBlocks'][i]['point'] - bp[i]) < 1e-12 and rd['pooledBlocks'][i]['certified'] == blocks[i]['cert'] for i in range(8)))
chk('descriptive: 7/8 pooled blocks certified; block 6410008 = -0.0526; mean 0.4566',
    sum(b['cert'] for b in blocks) == 7 == rd['pooledCertifiedBlocks'] and abs(bp[7] + 0.052582764387629544) < 1e-12 and abs(fl(pooled_effect[2]) - 0.45660785226371814) < 1e-12,
    'block8=%.6f mean=%.6f' % (bp[7], fl(pooled_effect[2])))
bd = max(abs(boot['bounded95'][0] - rd['bootstrap']['bounded95']['lower']), abs(boot['bounded95'][1] - rd['bootstrap']['bounded95']['upper']),
         abs(boot['point95'][0] - rd['bootstrap']['point95']['lower']), abs(boot['point95'][1] - rd['bootstrap']['point95']['upper']))
chk('descriptive: whole-block bootstrap (seed 6480300, 10,000 resamples, Mulberry32 reimplemented) reproduces report [0.2736, 0.6145] exactly', bd < 1e-12,
    'mine=[%.6f,%.6f] report=[%.6f,%.6f] diff=%.2e' % (boot['point95'][0], boot['point95'][1], rd['bootstrap']['point95']['lower'], rd['bootstrap']['point95']['upper'], bd))
extra['bootstrap'] = boot

# ------------------------------------------------------------------ Test B
recon = {}
for rc in roster['reconstructions']:
    fid = rc['founderId']
    per = []
    for p in rc['perSeed']:
        g = G[p['genomeId']]
        per.append({'seed': p['seed'], 'value': p['value'], 'gid': p['genomeId'], 'rng': g, 'cert': g[0] > TH})
    ncert = sum(p['cert'] for p in per)
    mean_r = avg([p['rng'] for p in per])
    Epoint = sel[fid]['E'][2]
    share = mean_r[2] / Epoint if Epoint > 0 else None
    entry = {'per': per, 'certified': ncert, 'met': ncert >= 7, 'mean': mean_r, 'share': share,
             'distinct': len({p['gid'] for p in per})}
    if rc['specificity']:
        rows = []
        for sp in roster['specificity']:
            if sp['founderId'] != fid:
                continue
            R = [p for p in per if p['seed'] == sp['seed']][0]['rng']
            Cg = G[sp['genomeId']]
            d = contrast(R, Cg)
            rows.append({'seed': sp['seed'], 'slot': sp['slot'], 'R': R, 'C': Cg, 'RmC': d, 'Rgt': d[0] > 0})
        entry['spec'] = rows
        entry['specMean'] = avg([r['RmC'] for r in rows])
        entry['specCount'] = sum(r['Rgt'] for r in rows)
    recon[fid] = entry
rep_rec = {x['founderId']: x for x in report_new['reconstruction']}
bm = True; bdiff = 0
for fid, en in recon.items():
    r = rep_rec[fid]
    if r['certifiedSeeds'] != en['certified'] or r['criterionMet'] != en['met'] or r['distinctGenomes'] != en['distinct']:
        bm = False
    for i, p in enumerate(en['per']):
        bdiff = max(bdiff, abs(r['perSeed'][i]['point'] - fl(p['rng'][2])), abs(r['perSeed'][i]['lower'] - fl(p['rng'][0])))
        if r['perSeed'][i]['certified'] != p['cert']:
            bm = False
    bdiff = max(bdiff, abs(r['mean']['point'] - fl(en['mean'][2])), abs(r['recoveredShareOfEvolved'] - fl(en['share'])))
    if 'spec' in en:
        sp = r['specificity']
        if sp['seedsReconstructionAboveControl'] != en['specCount']:
            bm = False
        bdiff = max(bdiff, abs(sp['meanReconstructionMinusControl']['point'] - fl(en['specMean'][2])))
        for i, row in enumerate(en['spec']):
            bdiff = max(bdiff, abs(sp['controls'][i]['reconstructionMinusControl']['point'] - fl(row['RmC'][2])),
                        abs(sp['controls'][i]['control']['point'] - fl(row['C'][2])))
chk('B: per-seed R values, certification, means, recovered share, distinct genomes, cluster-33 specificity (R-C per seed, count) match report', bm and bdiff < 1e-12, 'max abs diff %.2e' % bdiff)
print()
for fid, en in recon.items():
    print(fid, 'B cert', en['certified'], 'met', en['met'], 'distinct', en['distinct'], 'mean R %.4f' % fl(en['mean'][2]), 'E %.4f' % fl(sel[fid]['E'][2]), 'share %.4f' % fl(en['share']))
    print('   R per seed:', [(p['value'], round(fl(p['rng'][2]), 3)) for p in en['per']])
    if 'spec' in en:
        print('   C per seed:', [(r['slot'], round(fl(r['C'][2]), 3)) for r in en['spec']])
        print('   R-C per seed:', [round(fl(r['RmC'][2]), 3) for r in en['spec']], 'mean %.4f' % fl(en['specMean'][2]), 'count', en['specCount'])

# ------------------------------------------------------------------ technical completeness
repdir = RUN + '/replay'
audir = RUN + '/audit'
invdir = RUN + '/invocations'
exp_replay = {x['cacheKey']: x for x in roster['replay']}
chk('candidate.replayExpected keys == roster replay keys', set(candidate['replayExpected']) == set(exp_replay) and len(exp_replay) == 8)
rep_ok = True; rep_detail = []
for k in exp_replay:
    ob = open(EVOLVED_RESULTS + '/%s.json' % k, 'rb').read()
    if sha_bytes(ob) != candidate['replayExpected'][k]:
        rep_ok = False; rep_detail.append('origsha:' + k[:8])
    orig = json.loads(ob)
    rec = jload(repdir + '/%s.json' % k)
    res = dict(rec['result']); o2 = dict(orig)
    el1, el2 = res.pop('elapsedSeconds'), o2.pop('elapsedSeconds')
    if res != o2 or rec['matches'] is not True or rec['studyIdentitySha256'] != sid:
        rep_ok = False; rep_detail.append('mismatch:' + k[:8])
    # frozen report score == original score
    fo = [o for o in frozen_obs if o['cacheKey'] == k and o['id'] == exp_replay[k]['observationId']][0]
    if fo['score'] != orig['score']:
        rep_ok = False; rep_detail.append('reportscore:' + k[:8])
    print('   replay', k[:8], 'elapsed new %.2f orig %.2f' % (el1, el2), 'score', orig['score'])
chk('8 replays: every field except elapsedSeconds equal to frozen originals; originals match pinned hashes and frozen report scores', rep_ok and len(glob.glob(repdir + '/*.json')) == 8, str(rep_detail))
founders_replayed = Counter(next(e['founderId'] for e in roster['evolved'] if x['observationId'] in e['observationIds']) for x in roster['replay'])
extra['replayPerFounder'] = dict(founders_replayed)

inv = []
for f in sorted(glob.glob(invdir + '/*.json')):
    r = jload(f); r['_idx'] = int(os.path.basename(f)[:3]); inv.append(r)
chk('28 invocation records, all settled', len(inv) == 28 and all(r['status'] in ('settled',) for r in inv), Counter(r['status'] for r in inv).__repr__())
chg = sum(r['chargedSeconds'] for r in inv)
chk('charged seconds total 15,307.34 s over 28 invocations (<25,000 cap, <=60 invocations)', abs(chg - 15307.339000463486) < 1e-6 and chg < 25000 and len(inv) <= 60, '%.3f' % chg)
chk('every invocation <= 600 s run + watchdog (max charged %.1f)' % max(r['chargedSeconds'] for r in inv), max(r['chargedSeconds'] for r in inv) <= 720)
chk('sum of newAssays across invocations = 1,200; replayed total = 8', sum(r['newAssays'] for r in inv) == 1200 and sum(r['replayed'] for r in inv) == 8,
    'new=%d replayed=%d' % (sum(r['newAssays'] for r in inv), sum(r['replayed'] for r in inv)))
chk('invocation records bind the pinned study identity, candidate and release hashes',
    all(r['studyIdentitySha256'] == sid and r['candidateSha256'] == release['candidateSha256'] and r['releaseSha256'] == sha_file(DC + '/release.json') for r in inv))
chk('no RUNNING lock, no STOPPED.json, tmp dir empty, no foreign entries', not os.path.exists(RUN + '/RUNNING') and not os.path.exists(RUN + '/STOPPED.json')
    and os.listdir(RUN + '/tmp') == [] and sorted(os.listdir(RUN)) == ['assays', 'audit', 'invocations', 'provenance', 'replay', 'tmp'])
aud = {}
aud_ok = True; rot = []
rep_keys_sorted = [x['cacheKey'] for x in roster['replay']]
for f in sorted(glob.glob(audir + '/*.json')):
    r = jload(f); idx = int(os.path.basename(f)[:3])
    k = r['result']['cacheKey']
    orig = json.load(open(EVOLVED_RESULTS + '/%s.json' % k))
    a = dict(r['result']); b = dict(orig); a.pop('elapsedSeconds'); b.pop('elapsedSeconds')
    ok = (a == b and r['matches'] is True and r['certifies'] == idx and k in exp_replay and r['studyIdentitySha256'] == sid)
    aud_ok &= ok
    aud[idx] = ok
    rot.append(rep_keys_sorted.index(k))
chk('28 audit records: one per invocation (indices 1..28 = invocation indices that did work), each equal to its frozen original except elapsedSeconds',
    aud_ok and sorted(aud) == sorted(r['_idx'] for r in inv if r['newAssays'] > 0) and len(aud) == 28, 'audits=%d' % len(aud))
extra['auditRotation'] = rot
chk('audits rotate through all eight replay configurations (index sequence is i mod 8 over roster replay order)', rot == [i % 8 for i in range(28)] or sorted(Counter(rot).values()) in ([3, 3, 3, 3, 4, 4, 4, 4],), str(rot))
log = open(RUN + '/../founder-discovery-divergence-control-v1.supervise.log').read().strip().splitlines()
last = json.loads(log[-1])
chk('supervisor log final line: complete, 1200/1200, 8/8 replays, 28/28 audits, charged 15307.339', last['complete'] and last['assays'] == 1200 and last['replayed'] == 8 and last['audits'] == 28 == last['auditsOwed'] and abs(last['chargedSeconds'] - chg) < 1e-6 and last['mismatchRecorded'] is False)

tech_complete = (len(raw) == 1200 and missing_new == 0 and rep_ok and aud_ok)
chk('technical completeness (independent): 1,200 results, 8/8 replays, matching audits for all 28 working invocations', tech_complete)
chk('report.technicalComplete True, replay 8/8, audits 28/28, missingNewResults 0', report_new['technicalComplete'] is True and report_new['replay'] == {'expected': 8, 'matched': 8} and report_new['audits'] == {'total': 28, 'matched': 28} and report_new['missingNewResults'] == 0)

# ------------------------------------------------------------------ frozen-study founder effects from E
bf = {x['founderId']: x for x in bt['byFounder']}
fe_ok = True; fe_diff = 0
for fid in founders:
    fe = bf[fid]['conditionalEffect']
    mine = fl(sel[fid]['E'][2])
    fe_diff = max(fe_diff, abs(fe - mine))
    for p in bf[fid]['pairs']:
        fe_diff = max(fe_diff, abs(p['point'] - fl(U[(fid, p['seed'])]['E'][2])))
chk('E reproduces frozen-study founder effects (0.9911, 0.5647, -0.0031, 0.5592) and per-seed pairs', fe_diff < 1e-12, 'max abs diff %.2e; E=%s' % (fe_diff, [round(fl(sel[f]['E'][2]), 4) for f in founders]))

# ------------------------------------------------------------------ post hoc
ph = {x['founderId']: x for x in posthoc['founders']}
mu_swept = {'discovery-cluster-33': 152, 'discovery-cluster-139': 160}
ph_ok = True
ph_out = {}
for fid in founders:
    f = slots_of(FOUNDER_HEX[fid])
    rows = []
    for e in roster['evolved']:
        if e['founderId'] != fid:
            continue
        ev = slots_of(e['descendantHex'])
        for gid in mut_of[e['drawId']]:
            m = slots_of(genomes[gid]['descendantHex'])
            rows.append({'gid': gid, 'seed': e['seed'], 'draw': e['drawId'], 'score': G[gid][2], 'e': ev, 'm': m})
    slot = mu_swept.get(fid)
    entry = {'meanMutant': mean([r['score'] for r in rows])}
    if slot is not None:
        sgn = lambda x: (x > 0) - (x < 0)
        same = [r for r in rows if r['e'][slot] != f[slot] and sgn(r['m'][slot] - f[slot]) == sgn(r['e'][slot] - f[slot])]
        other = [r for r in rows if r not in same]
        anyup = [r for r in rows if r['m'][slot] > f[slot]]
        anydown = [r for r in rows if r['m'][slot] < f[slot]]
        entry.update({
            'nRows': len(rows),
            'same_n': len(same), 'same_mean': mean([r['score'] for r in same]) if same else None,
            'other_n': len(other), 'other_mean': mean([r['score'] for r in other]) if other else None,
            'mutants_with_slot_increase_n': len(anyup), 'mutants_with_slot_increase_mean': mean([r['score'] for r in anyup]) if anyup else None,
            'mutants_with_slot_decrease_n': len(anydown), 'mutants_with_slot_decrease_mean': mean([r['score'] for r in anydown]) if anydown else None,
            'mutants_with_slot_change_n': len(anyup) + len(anydown),
            'evolved_draws_changing_slot': sum(1 for e in roster['evolved'] if e['founderId'] == fid and slots_of(e['descendantHex'])[slot] != f[slot]),
            'evolved_slot_deltas': sorted(slots_of(e['descendantHex'])[slot] - f[slot] for e in roster['evolved'] if e['founderId'] == fid),
            'mutant_slot_deltas_sorted': sorted(r['m'][slot] - f[slot] for r in rows),
            'same_but_unequal_signs_check': sum(1 for r in rows if r['e'][slot] != f[slot] and sgn(r['m'][slot] - f[slot]) != sgn(r['e'][slot] - f[slot])),
        })
        p = ph[fid]['sweptSlotSplit']
        okf = (p['slot'] == slot and p['mutantsSameDirection']['n'] == len(same) and p['mutantsOtherwise']['n'] == len(other) and
               abs(p['mutantsSameDirection']['meanScore'] - fl(entry['same_mean'])) < 1e-12 and abs(p['mutantsOtherwise']['meanScore'] - fl(entry['other_mean'])) < 1e-12 and
               p['evolvedDrawsChangingSweptSlot'] == entry['evolved_draws_changing_slot'])
        ph_ok &= okf
    if abs(ph[fid]['meanMutantScore'] - fl(entry['meanMutant'])) > 1e-12:
        ph_ok = False
    # parameter changes counts
    pc = {'mu': 0, 'sigma': 0, 'motGain': 0}
    for e in roster['evolved']:
        if e['founderId'] != fid:
            continue
        ev = slots_of(e['descendantHex'])
        for nm, s in (('mu', MU), ('sigma', SIGMA), ('motGain', GAIN)):
            if ev[s] != f[s]:
                pc[nm] += 1
    if pc != ph[fid]['evolvedDrawsWithParameterChange']:
        ph_ok = False
    entry['paramChanges'] = pc
    ph_out[fid] = entry
chk('post-hoc.json: swept-slot split counts/means, mean mutant scores and parameter-change counts reproduced', ph_ok)
for fid in ('discovery-cluster-139', 'discovery-cluster-33'):
    e = ph_out[fid]
    print(fid, {k: (round(fl(v), 4) if isinstance(v, Fraction) else v) for k, v in e.items() if not k.endswith('sorted') and k != 'evolved_slot_deltas'})
    print('   evolved deltas', e['evolved_slot_deltas'])
    print('   mutant deltas ', e['mutant_slot_deltas_sorted'])
extra['postHoc'] = {fid: {k: (fl(v) if isinstance(v, Fraction) else v) for k, v in e.items()} for fid, e in ph_out.items()}

# cluster-139: how many E mu magnitudes force 'up' (mu 33, lower bound 16 -> magnitude >= 18)
f139 = slots_of(FOUNDER_HEX['discovery-cluster-139'])
mags = [abs(slots_of(e['descendantHex'])[MU] - f139[MU]) for e in roster['evolved'] if e['founderId'] == 'discovery-cluster-139']
extra['cluster139_mu_founder'] = f139[MU]
extra['cluster139_E_mu_magnitudes'] = sorted(mags)
extra['cluster139_forced_up_draws(mag>=18)'] = sum(1 for m in mags if m >= f139[MU] - 16 + 1)

# ------------------------------------------------------------------ extra diagnostics for write-up
# per-genome & per-unit duplicates among E draws
dups = []
for fid in founders:
    for s in seeds:
        d = [e for e in roster['evolved'] if e['founderId'] == fid and e['seed'] == s]
        if d[0]['descendantHex'] == d[1]['descendantHex']:
            dups.append((fid, s))
extra['unitsWhoseTwoEvolvedDrawsAreTheSameGenome'] = dups
alle = Counter(e['descendantHex'] for e in roster['evolved'])
extra['evolvedGenomesRepeatedAcrossDraws'] = sum(1 for v in alle.values() if v > 1)
extra['evolvedEqualsReconstructionOrMutant'] = sum(1 for e in roster['evolved'] if any(g['descendantHex'] == e['descendantHex'] and g['founderHex'] == FOUNDER_HEX[e['founderId']] for g in roster['genomes']))
# evolved genome change census
census = defaultdict(list)
for e in roster['evolved']:
    f = slots_of(FOUNDER_HEX[e['founderId']]); ev = slots_of(e['descendantHex'])
    census[e['founderId']].append((sum(1 for s in range(NN) if ev[s] != f[s]), sum(1 for s in range(NN, 163) if ev[s] != f[s])))
extra['evolvedChangedWeightsAndParams_per_founder'] = {k: {'weights_min': min(w for w, _ in v), 'weights_max': max(w for w, _ in v), 'weights_mean': sum(w for w, _ in v) / len(v), 'param_changes_mean': sum(p for _, p in v) / len(v)} for k, v in census.items()}

# position effect: mean score by assignment (descendant left a1? see library: assignment&1==0 -> descendant left)
def arm_of(gid):
    return genomes[gid]['arm']
pos = defaultdict(lambda: [[], []])
for (gid, s, a), stem in cfg_map.items():
    fid = genomes[gid]['founderId']
    pos[(arm_of(gid), fid)][a].append(raw[stem]['frac'])
extra['positionEffect_meanScore_a0_a1'] = {'%s|%s' % k: [round(fl(mean(v[0])), 4), round(fl(mean(v[1])), 4)] for k, v in sorted(pos.items())}
posE = defaultdict(lambda: [[], []])
for e in roster['evolved']:
    for oid in e['observationIds']:
        o = obs_by_id[oid]
        posE[e['founderId']][o['assignment']].append(E_obs[oid])
extra['positionEffect_E_a0_a1'] = {k: [round(fl(mean(v[0])), 4), round(fl(mean(v[1])), 4)] for k, v in posE.items()}
# identity control: off arm, same assay (frozen report)
offs = defaultdict(lambda: defaultdict(list))
for o in frozen_obs:
    if o['mode'] == 'off' and o['time'] == 1000000 and o['status'] == 'scored':
        offs[o['founderId']][o['assignment']].append(o['score'])
extra['frozenOffArm_identity_control_mean_score_by_assignment'] = {k: {a: round(sum(v) / len(v), 4) for a, v in d.items()} for k, d in offs.items()}

# score distribution per arm
def dist(scores):
    sc = [fl(x) for x in scores]
    return {'n': len(sc), 'mean': round(sum(sc) / len(sc), 4), 'abs>0.99': sum(1 for x in sc if abs(x) > 0.99), 'neg': sum(1 for x in sc if x < 0), 'min': round(min(sc), 3), 'max': round(max(sc), 3)}
by_arm = defaultdict(list)
for (gid, s, a), stem in cfg_map.items():
    by_arm[(genomes[gid]['arm'], genomes[gid]['founderId'])].append(raw[stem]['frac'])
extra['rawScoreDistribution_new'] = {'%s|%s' % k: dist(v) for k, v in sorted(by_arm.items())}
E_by = defaultdict(list)
for e in roster['evolved']:
    for oid in e['observationIds']:
        E_by[e['founderId']].append(E_obs[oid])
extra['rawScoreDistribution_E'] = {k: dist(v) for k, v in E_by.items()}
# per-mutant mean distribution per founder
mm = defaultdict(list)
for m in roster['mutants']:
    mm[genomes[m['genomeId']]['founderId']].append(fl(G[m['genomeId']][2]))
extra['mutantMeansSortedPerFounder'] = {k: [round(x, 2) for x in sorted(v)] for k, v in mm.items()}

# sensitivity of certification: leave-one-unit; bootstrap SE for founder-level E, M, E-M and cluster-4 M vs 0.10
import random as pyrandom
pr = pyrandom.Random(12345)
sens = {}
for fid in founders:
    us = [U[(fid, s)] for s in seeds]
    Ev = [fl(u['E'][2]) for u in us]; Mv = [fl(u['M'][2]) for u in us]; Cv = [fl(u['C'][2]) for u in us]
    def bs(v):
        stats = []
        for _ in range(20000):
            stats.append(sum(v[pr.randrange(8)] for _ in range(8)) / 8)
        stats.sort()
        return [round(stats[int(0.025 * len(stats))], 3), round(stats[int(0.975 * len(stats))], 3)]
    pM = sum(1 for _ in range(1) )
    # probability that unit-bootstrap M mean > 0.10
    cnt = 0
    for _ in range(20000):
        if sum(Mv[pr.randrange(8)] for _ in range(8)) / 8 > 0.10:
            cnt += 1
    sens[fid] = {'E_ci': bs(Ev), 'M_ci': bs(Mv), 'EmM_ci': bs(Cv), 'P(boot M mean>0.10)': cnt / 20000, 'unitM_sd': round(float(__import__('statistics').stdev(Mv)), 3), 'unitE_sd': round(float(__import__('statistics').stdev(Ev)), 3)}
extra['unitBootstrapSensitivity (descriptive, not part of protocol)'] = sens

# cluster-139 failing seeds & cluster-4 failing seed detail
extra['failingUnits'] = {}
for fid in founders:
    for s in seeds:
        u = U[(fid, s)]
        if not u['cert']:
            extra['failingUnits']['%s/%d' % (fid, s)] = {'E': round(fl(u['E'][2]), 4), 'M': round(fl(u['M'][2]), 4), 'E-M': round(fl(u['C'][2]), 4)}
extra['allUnits'] = {'%s/%d' % (f, s): {'E': round(fl(U[(f, s)]['E'][2]), 4), 'M': round(fl(U[(f, s)]['M'][2]), 4), 'EmM': round(fl(U[(f, s)]['C'][2]), 4), 'cert': U[(f, s)]['cert']} for f in founders for s in seeds}

# block 6410008 composition
extra['block6410008'] = {f: round(fl(U[(f, 6410008)]['C'][2]), 4) for f in founders}

# R ceiling-effect diagnostics: mean log10 mass ratio for E vs R (cluster-33, cluster-139)
def logratio(d, a):
    return math.log10((d + 1) / (a + 1))
lr = {}
for fid in ('discovery-cluster-33', 'discovery-cluster-139'):
    ev = []
    for e in roster['evolved']:
        if e['founderId'] != fid:
            continue
        for oid in e['observationIds']:
            o = obs_by_id[oid]
            r = jload(EVOLVED_RESULTS + '/%s.json' % o['cacheKey'])
            ev.append(logratio(r['descendantMass'], r['ancestorMass']))
    rv = []
    for p in recon[fid]['per']:
        for s in ASSAY_SEEDS:
            for a in ASSIGN:
                r = raw[cfg_map[(p['gid'], s, a)]]['r']
                rv.append(logratio(r['descendantMass'], r['ancestorMass']))
    mv = []
    for m in roster['mutants']:
        if genomes[m['genomeId']]['founderId'] != fid:
            continue
        for s in ASSAY_SEEDS:
            for a in ASSIGN:
                r = raw[cfg_map[(m['genomeId'], s, a)]]['r']
                mv.append(logratio(r['descendantMass'], r['ancestorMass']))
    lr[fid] = {'E_meanLog10Ratio': round(sum(ev) / len(ev), 3), 'R_meanLog10Ratio': round(sum(rv) / len(rv), 3), 'M_meanLog10Ratio': round(sum(mv) / len(mv), 3)}
extra['meanLog10MassRatio (descendant+1)/(ancestor+1)'] = lr

# ceiling: count of R / E competitions with score > 0.99
extra['ceiling'] = {fid: {'E_gt0.99': sum(1 for x in E_by[fid] if x > Fraction(99, 100)), 'E_n': len(E_by[fid]),
                         'R_gt0.99': sum(1 for p in recon[fid]['per'] for s in ASSAY_SEEDS for a in ASSIGN if raw[cfg_map[(p['gid'], s, a)]]['frac'] > Fraction(99, 100)), 'R_n': 64}
                    for fid in ('discovery-cluster-33', 'discovery-cluster-139')}

# sign-test arithmetic
from math import comb
extra['signTail_7of8'] = (comb(8, 7) + comb(8, 8)) / 256
# B139 false pass rate with 6 distinct genomes at per-genome pass rate 0.4 (protocol claim ~0.03)
p = 0.4
# seeds 49 and 47 duplicated (2 each): pass if sum of passes weights >=7 of 8 seeds
import itertools
dup_w = [1, 1, 1, 1, 2, 2]  # distinct genomes: 46,54,55,57 appear once; 47,49 appear twice
dup_w = [1, 1, 1, 1, 2, 2]
tot = 0.0
for bits in itertools.product([0, 1], repeat=6):
    w = sum(b * x for b, x in zip(bits, dup_w))
    if w >= 7:
        pr_ = 1.0
        for b in bits:
            pr_ *= p if b else (1 - p)
        tot += pr_
extra['B139_false_pass_prob_at_p0.4_with_duplicates'] = round(tot, 4)
p5 = 0.5
tot5 = 0.0
for bits in itertools.product([0, 1], repeat=6):
    w = sum(b * x for b, x in zip(bits, dup_w))
    if w >= 7:
        pr_ = 1.0
        for b in bits:
            pr_ *= p5 if b else (1 - p5)
        tot5 += pr_
extra['B139_false_pass_prob_at_p0.5_with_duplicates'] = round(tot5, 4)


# ------------------------------------------------------------------ second-round diagnostics
# (a) host provenance of replay originals (cross-host determinism)
HP = REPO + '/runs/founder-discovery-improvement-consolidated-v1/assay-host-provenance'
hosts = {}
for k in exp_replay:
    hosts[k[:8]] = [h for h in ('local', 'work-mac') if os.path.exists('%s/%s/%s.json' % (HP, h, k))]
extra['replayOriginalHosts'] = hosts
chk('replay originals include results produced on both hosts (3 work-mac, 5 local), all reproduced locally', sorted(sum(hosts.values(), [])) == ['local'] * 5 + ['work-mac'] * 3 and rep_ok, str(hosts))

# (b) ordering: replays done before any new assay was written
rep_mt = max(os.path.getmtime(f) for f in glob.glob(repdir + '/*.json'))
ass_mt = min(os.path.getmtime(f) for f in files)
chk('all 8 replay files were written before the first new assay result file (mtime order)', rep_mt <= ass_mt, 'last replay %.0f, first assay %.0f' % (rep_mt, ass_mt))
prot_mt = os.path.getmtime(REPO + '/experiments/founder-discovery/v1/divergence-control-protocol.md')
chk('protocol file mtime precedes first new assay result file', prot_mt < ass_mt)

# (c) exactly-neutral genomes (per-genome mean exactly 0 => antisymmetric a0/a1 in every assay seed)
def exactly_neutral(gid):
    return all(raw[cfg_map[(gid, s, 0)]]['frac'] + raw[cfg_map[(gid, s, 1)]]['frac'] == 0 for s in ASSAY_SEEDS)
neu = defaultdict(list)
for gid, g in genomes.items():
    neu[(g['arm'], g['founderId'])].append(exactly_neutral(gid))
extra['exactlyNeutralGenomes (all 4 assay seeds antisymmetric)'] = {'%s|%s' % k: [sum(v), len(v)] for k, v in sorted(neu.items())}
extra['controlGenomeMeansExact'] = {sp['genomeId']: [str(G[sp['genomeId']][2]) if G[sp['genomeId']][2] in (0,) else round(fl(G[sp['genomeId']][2]), 4), 'slot', sp['slot'], 'exactNeutral', exactly_neutral(sp['genomeId'])] for sp in roster['specificity']}
# also at the per-seed-per-competition level: how many individual genomes have per-genome mean exactly 0
extra['mutantsWithMeanExactlyZero'] = {fid: sum(1 for m in roster['mutants'] if genomes[m['genomeId']]['founderId'] == fid and G[m['genomeId']][2] == 0) for fid in founders}

# (d) cluster-139: mu groups, per-unit mu-up counts, E draws without mu change
fid = 'discovery-cluster-139'
f = slots_of(FOUNDER_HEX[fid])
grp = {'up': [], 'down': [], 'none': []}
unit_up = defaultdict(int)
for e in roster['evolved']:
    if e['founderId'] != fid: continue
    ev = slots_of(e['descendantHex'])
    for gid in mut_of[e['drawId']]:
        m = slots_of(genomes[gid]['descendantHex'])
        d = m[MU] - f[MU]
        k = 'up' if d > 0 else 'down' if d < 0 else 'none'
        grp[k].append(G[gid][2])
        if k == 'up': unit_up[e['seed']] += 1
extra['cluster139_mutants_by_mu_direction'] = {k: [len(v), round(fl(mean(v)), 4) if v else None] for k, v in grp.items()}
extra['cluster139_mutants_with_mu_up_per_seed (of 4)'] = dict(sorted(unit_up.items()))
extra['cluster139_expected_up_if_signs_unconstrained'] = 13.0
extra['cluster139_forced_up_mutants (E magnitude>=18)'] = sum(1 for e in roster['evolved'] if e['founderId'] == fid and abs(slots_of(e['descendantHex'])[MU] - f[MU]) >= 18) * 2
extra['cluster139_free_sign_mutants_up/total'] = [sum(1 for e in roster['evolved'] if e['founderId'] == fid and 0 < abs(slots_of(e['descendantHex'])[MU] - f[MU]) < 18 for gid in mut_of[e['drawId']] if slots_of(genomes[gid]['descendantHex'])[MU] > f[MU]),
                                                   sum(1 for e in roster['evolved'] if e['founderId'] == fid and 0 < abs(slots_of(e['descendantHex'])[MU] - f[MU]) < 18) * 2]
# E per draw with delta mu
drows = []
for e in roster['evolved']:
    if e['founderId'] != fid: continue
    ev = slots_of(e['descendantHex'])
    drows.append((e['seed'] % 100, e['draw'], ev[MU] - f[MU], round(fl(draws[e['drawId']]['E'][2]), 3), [round(fl(x[2]), 3) for x in draws[e['drawId']]['Mi']],
                  [slots_of(genomes[g]['descendantHex'])[MU] - f[MU] for g in mut_of[e['drawId']]]))
extra['cluster139_draws (seed,draw,E dMu,E,[M1,M2],[M dMu])'] = drows
# what-if: unit contrasts using only mutants that do NOT carry a mu increase (post hoc, descriptive)
whatif = {}
for s in seeds:
    ms = []
    for e in roster['evolved']:
        if e['founderId'] == fid and e['seed'] == s:
            for gid in mut_of[e['drawId']]:
                if slots_of(genomes[gid]['descendantHex'])[MU] <= f[MU]:
                    ms.append(G[gid][2])
    Eu = U[(fid, s)]['E'][2]
    whatif[s] = {'nMutantsWithoutMuIncrease': len(ms), 'M_without': round(fl(mean(ms)), 3) if ms else None, 'E-M_without': round(fl(Eu - mean(ms)), 3) if ms else None}
extra['cluster139_whatif_units_excluding_mu_up_mutants'] = whatif

# (e) cluster-33: draws w/o b2[PHOTO] increase
fid = 'discovery-cluster-33'
f = slots_of(FOUNDER_HEX[fid])
extra['cluster33_draws (seed,draw,E dB2PHOTO,E)'] = [(e['seed'] % 100, e['draw'], slots_of(e['descendantHex'])[152] - f[152], round(fl(draws[e['drawId']]['E'][2]), 4)) for e in roster['evolved'] if e['founderId'] == fid]

# (f) cluster-4 seed 8 draws
fid = 'discovery-cluster-4'
extra['cluster4_seed6410008_draws'] = [(e['draw'], round(fl(draws[e['drawId']]['E'][2]), 3), [round(fl(x[2]), 3) for x in draws[e['drawId']]['Mi']]) for e in roster['evolved'] if e['founderId'] == fid and e['seed'] == 6410008]
extra['cluster4_all_draws_E'] = [(e['seed'] % 100, e['draw'], round(fl(draws[e['drawId']]['E'][2]), 3)) for e in roster['evolved'] if e['founderId'] == fid]

# (g) the closest certified unit margins for A33/A4/A139 (units certified by < 0.05)
extra['certifiedUnitsWithin0.05OfThreshold'] = [(k[0], k[1], round(fl(u['C'][0]), 4)) for k, u in U.items() if u['cert'] and fl(u['C'][0]) - 0.10 < 0.05]

# (h) one-unit-flip sensitivity of the criterion per founder
extra['criterion_if_closest_certified_unit_failed'] = {fid: (sum(U[(fid, s)]['cert'] for s in seeds) - 1) >= 7 for fid in founders}

# (i) R vs E by seed for 139 and 33
extra['R_minus_E_per_seed'] = {fid: [round(fl(p['rng'][2] - U[(fid, p['seed'])]['E'][2]), 3) for p in recon[fid]['per']] for fid in recon}
extra['R_range'] = {fid: [round(fl(min(p['rng'][2] for p in recon[fid]['per'])), 3), round(fl(max(p['rng'][2] for p in recon[fid]['per'])), 3)] for fid in recon}
extra['R_individual_competition_min'] = {fid: round(min(fl(raw[cfg_map[(p['gid'], s, a)]]['frac']) for p in recon[fid]['per'] for s in ASSAY_SEEDS for a in ASSIGN), 3) for fid in recon}

# (j) number of simultaneous 'beyond' margin facts for A33
extra['A33_min_unit_contrast'] = round(min(fl(U[('discovery-cluster-33', s)]['C'][2]) for s in seeds), 3)

# (k) 4-of-6 pass family-wise arithmetic
extra['P(>=1 false pass among 6 independent tests at 9/256)'] = round(1 - (1 - 9 / 256) ** 6, 4)

# (l) M per-competition sd at unit level (4 mutants) : within-founder sd of mutant genome means
import statistics
extra['mutantGenomeMean_sd_per_founder'] = {fid: round(statistics.pstdev(mm[fid]), 3) for fid in founders}


# (m) within-unit similarity of the two evolved draws (not independent samples of the population?)
pair_info = {}
for fid in founders:
    f = slots_of(FOUNDER_HEX[fid]); rows = []
    for s in seeds:
        d = [e for e in roster['evolved'] if e['founderId'] == fid and e['seed'] == s]
        a, b = slots_of(d[0]['descendantHex']), slots_of(d[1]['descendantHex'])
        ca = {i for i in range(163) if a[i] != f[i]}; cb = {i for i in range(163) if b[i] != f[i]}
        hd = sum(1 for i in range(163) if a[i] != b[i])
        rows.append((s % 100, len(ca), len(cb), len(ca & cb), hd))
    pair_info[fid] = rows
extra['E_draw_pairs_within_unit (seed, changed_a, changed_b, shared_changed_slots, hamming_a_b)'] = pair_info
# between-unit overlap of changed slots (E) for cluster-33 b2[PHOTO] etc. not needed
# (n) SE of unit-level M implied by genome-level sd and 4 mutants/unit
extra['approx_SE_unit_M (sd_genome/2)'] = {fid: round(statistics.pstdev(mm[fid]) / 2, 3) for fid in founders}
# (o) off-arm identity noise: max/mean |score| at 1M for identical genomes (frozen report)
offabs = defaultdict(list)
for o in frozen_obs:
    if o['mode'] == 'off' and o['time'] == 1000000:
        offabs[o['founderId']].append(abs(o['score']))
extra['frozenOffArm_identity_pairs_abs_score (max, mean)'] = {k: [round(max(v), 3), round(sum(v) / len(v), 3)] for k, v in offabs.items()}
# (p) cluster-139 expected mu-up counts: unconstrained vs clamped
extra['cluster139_expected_up_unconstrained_vs_clamped (of 26 mu-changing mutants)'] = [13.0, 6 + 10.0, 19]
from math import comb as _c
extra['P(>=13 of 20 free-sign mutants up | fair coin)'] = round(sum(_c(20, k) for k in range(13, 21)) / 2 ** 20, 4)
# (q) symmetric-sign counterfactual M for cluster-139 (post hoc arithmetic)
up_m, dn_m, nn_m = fl(mean(grp['up'])), fl(mean(grp['down'])), fl(mean(grp['none']))
extra['cluster139_M_if_mu_up_and_down_equally_represented (post hoc arithmetic)'] = round((26 * 0.5 * (up_m + dn_m) + 6 * nn_m) / 32, 3)


# (r) descriptive robustness: leave-one-assay-seed-out and leave-one-assay-seed assignment (not protocol)
def gmean_sub(gid, seedset):
    sc = [raw[cfg_map[(gid, s, a)]]['frac'] for s in seedset for a in ASSIGN]
    return sum(sc, Fraction(0)) / len(sc)
def emean_sub(e, seedset):
    sc = [E_obs[oid] for oid in e['observationIds'] if obs_by_id[oid]['assaySeed'] in seedset]
    return sum(sc, Fraction(0)) / len(sc)
loo = {}
for drop in ASSAY_SEEDS:
    keep = [x for x in ASSAY_SEEDS if x != drop]
    row = {}
    for fid in founders:
        cert = 0
        for s in seeds:
            ds = [e for e in roster['evolved'] if e['founderId'] == fid and e['seed'] == s]
            Eu = sum((emean_sub(e, keep) for e in ds), Fraction(0)) / 2
            Mu = sum((gmean_sub(g, keep) for e in ds for g in mut_of[e['drawId']]), Fraction(0)) / 4
            cert += (Eu - Mu) > TH
        row[fid.split('-')[-1]] = cert
    loo[drop] = row
extra['leave_one_assay_seed_out_certified_units (descriptive)'] = loo

# ------------------------------------------------------------------ dump
out = {'checks': checks, 'extra': extra,
       'selection': {f: {'certified': s['certified'], 'met': s['met'], 'E': fl(s['E'][2]), 'M': fl(s['M'][2]), 'EmM': fl(s['C'][2]), 'reading': s['reading']} for f, s in sel.items()},
       'blocks': [{'seed': b['seed'], 'value': fl(b['point']), 'cert': b['cert']} for b in blocks],
       'pooled': fl(pooled_effect[2]),
       'recon': {f: {'certified': e['certified'], 'met': e['met'], 'mean': fl(e['mean'][2]), 'share': fl(e['share']), 'distinct': e['distinct'],
                     'per': [(p['value'], fl(p['rng'][2]), p['cert']) for p in e['per']],
                     **({'specMean': fl(e['specMean'][2]), 'specCount': e['specCount'], 'C': [(r['slot'], fl(r['C'][2])) for r in e['spec']], 'RmC': [fl(r['RmC'][2]) for r in e['spec']]} if 'spec' in e else {})}
                 for f, e in recon.items()}}
json.dump(out, open(OUTDIR + '/rederive_output.json', 'w'), indent=1, default=str)
print('\nchecks failed:', [c['name'] for c in checks if c['result'] != 'pass'])
print('wrote', OUTDIR + '/rederive_output.json')
