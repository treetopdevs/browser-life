#!/usr/bin/env python3
"""Independent Python re-derivation of the continuation analysis (read-only).

Does NOT call or port the TypeScript analyzer. It re-implements, from the protocol text and
the library source only where the protocol defers to it (Mulberry32 sampler, genome hex
layout, checkpoint wire format, lineage rules): the raw result files -> roster mapping,
cache-key recomputation, score recomputation from masses, the type-matched null genomes,
the H (500k ancestor) tracing from the checkpoints and mutation edges, all estimands (exact
Fractions, then floats), the readings in the protocol's fixed order, the pooled block rule,
the whole-block bootstrap (seed 6490300, 10,000 resamples), the technical-completeness
checks, the descriptive roster items and the protocol's pre-run facts.

Read-only: it reads the repository and run directory and writes nothing, unless --out PATH
is given, in which case it writes one JSON file (checks + numbers) at PATH.

Usage: python3 review-rederive.py [--out PATH] [--skip-checkpoints]
Runtime is about 1-3 minutes, single process (numpy is used to read checkpoint buffers).
"""
import argparse
import glob
import hashlib
import itertools
import json
import math
import os
import re
import statistics
import sys
import time
from collections import Counter, defaultdict
from fractions import Fraction

ap = argparse.ArgumentParser()
ap.add_argument('--out', default=None)
ap.add_argument('--skip-checkpoints', action='store_true')
args = ap.parse_args()

REPO = '/Users/nicholas/develop/browser-life-founder-policy'
V1 = REPO + '/experiments/founder-discovery/v1'
CONT = V1 + '/continuation'
DC = V1 + '/divergence-control'
FROZEN = V1 + '/improvement-study'
RUN = REPO + '/runs/founder-discovery-continuation-v1'
RUN_DC = REPO + '/runs/founder-discovery-divergence-control-v1'
CONSOL = REPO + '/runs/founder-discovery-improvement-consolidated-v1'
EVOLVED_RESULTS = CONSOL + '/assays'
HISTORIES = CONSOL + '/histories'

checks = []
numbers = {}


def chk(name, ok, detail=''):
    checks.append({'name': name, 'result': 'pass' if ok else 'fail', 'detail': detail})
    print(('PASS ' if ok else 'FAIL ') + name + (' :: ' + detail if detail else ''))
    return ok


def info(name, detail):
    checks.append({'name': name, 'result': 'info', 'detail': detail})
    print('INFO ' + name + ' :: ' + detail)


def sha_bytes(b):
    return hashlib.sha256(b).hexdigest()


def sha_file(p):
    with open(p, 'rb') as f:
        return sha_bytes(f.read())


def jload(p):
    with open(p) as f:
        return json.load(f)


def jcompact(o):
    # mimics JSON.stringify for strings/ints/bools/None (no floats are hashed this way here)
    return json.dumps(o, separators=(',', ':'), ensure_ascii=False)


# ------------------------------------------------------------------ inputs and pin chain
roster = jload(CONT + '/roster.json')
candidate = jload(CONT + '/candidate.json')
release = jload(CONT + '/release.json')
report = jload(CONT + '/analysis-v1/report.json')
manifest = jload(FROZEN + '/manifest.json')
frozen = jload(FROZEN + '/distribution-v1/analysis-v1/report.json')
dc_candidate = jload(DC + '/candidate.json')

REPORT_SHA = '017d63dc206cefa42419369fac0b1243c04a7e3fca01e54bb4713efaf9f791cc'
chk('report.json sha256 = 017d63dc...', sha_file(CONT + '/analysis-v1/report.json') == REPORT_SHA)
chk('protocol sha256 equals candidate pin', sha_file(V1 + '/continuation-protocol.md') == candidate['protocol']['sha256'])
chk('roster sha256 equals candidate pin', sha_file(CONT + '/roster.json') == candidate['roster']['sha256'])
chk('candidate sha256 equals release pin', sha_file(CONT + '/candidate.json') == release['candidateSha256'])
chk('frozen improvement report sha256 equals candidate pin and 085d55cf...',
    sha_file(FROZEN + '/distribution-v1/analysis-v1/report.json') == candidate['report']['sha256'] ==
    '085d55cf1f7121ece85ff3a5dc9fa5f236c912531e480e3262db99ad205ec68a')
chk('manifest sha256 equals candidate pin', sha_file(FROZEN + '/manifest.json') == candidate['manifest']['sha256'])
chk('forecast sha256 equals candidate pin', sha_file(CONT + '/resource-forecast.json') == candidate['forecast']['sha256'])
SRC = manifest['sourceManifestHash']
chk('roster/candidate sourceManifestHash = manifest', roster['inputs']['sourceManifestHash'] == SRC == candidate['manifest']['sourceManifestHash'])
chk('roster.inputs.reportSha256 = frozen report; manifestHash = manifest',
    roster['inputs']['reportSha256'] == candidate['report']['sha256'] and roster['inputs']['manifestHash'] == manifest['manifestHash'])
SID = candidate['studyIdentitySha256']
REL_SHA = sha_file(CONT + '/release.json')
chk('report.inputs bind this study: identity, candidate, release, roster, frozen report, protocol',
    report['inputs'] == {'studyIdentitySha256': SID, 'candidateSha256': release['candidateSha256'], 'releaseSha256': REL_SHA,
                         'rosterSha256': candidate['roster']['sha256'], 'frozenReportSha256': candidate['report']['sha256'],
                         'protocolSha256': candidate['protocol']['sha256']})
chk('release.json: format RELEASED, candidatePath is this study\'s candidate',
    release['status'] == 'RELEASED' and release['format'] == 'discovery-continuation-release/v1' and
    release['candidatePath'] == 'experiments/founder-discovery/v1/continuation/candidate.json')
chk('candidate output dir is the continuation run dir and differs from the divergence control\'s',
    candidate['host']['outputRel'] == 'runs/founder-discovery-continuation-v1' != dc_candidate['host']['outputRel'] and
    candidate['host']['root'] == REPO)
chk('study identity differs from divergence control\'s; candidate sha differs',
    SID != dc_candidate['studyIdentitySha256'] and release['candidateSha256'] != sha_file(DC + '/candidate.json'))

# study identity recomputation (library: studyIdentity)
ANALYSIS_ONLY = ['tools/discovery_continuation_analyze.ts', 'tools/discovery_continuation.ts', 'tools/lib/discovery-continuation.ts',
                 'tools/discovery_divergence_control_analyze.ts', 'tools/discovery_divergence_control.ts',
                 'tools/lib/discovery-divergence-control.ts']
ident_obj = {'roster': candidate['roster']['sha256'], 'manifest': candidate['manifest']['sha256'], 'report': candidate['report']['sha256'],
             'replayExpected': candidate['replayExpected'],
             'executionSources': {p: h for p, h in candidate['executionSources'].items() if p not in ANALYSIS_ONLY}}
chk('studyIdentitySha256 recomputed from the candidate\'s pins', sha_bytes(jcompact(ident_obj).encode()) == SID)

# execution sources on disk now
drift = [p for p, h in candidate['executionSources'].items() if not os.path.exists(REPO + '/' + p) or sha_file(REPO + '/' + p) != h]
chk('all %d pinned execution sources hash to their pins on the current tree' % len(candidate['executionSources']), not drift, str(drift[:5]))
numbers['executionSourceDrift'] = drift
chk('candidate.executionSources covers every manifest source (54) and 11 runner sources',
    set(manifest['sources']) <= set(candidate['executionSources']) and len(candidate['executionSources']) == 65)
rec_bad = [p for p, h in candidate['midpointReceipts'].items() if sha_file(REPO + '/' + p) != h]
chk('64 pinned 500k/1M receipts hash to their pins on disk', len(candidate['midpointReceipts']) == 64 and not rec_bad, str(rec_bad[:3]))
chk('candidate.rederivedHistories = the 32 roster histories in order; budget 30,000 s / 70 invocations / 600 s',
    candidate['rederivedHistories'] == [h['unitId'] for h in roster['histories']] and len(roster['histories']) == 32 and
    candidate['budget'] == {'capSeconds': 30000, 'maxInvocations': 70, 'maxInvocationSeconds': 600})

# roster payload hash
payload = {k: roster[k] for k in ('histories', 'ancestors', 'pairs', 'genomes', 'assays', 'replay')}
chk('rosterPayloadSha256 recomputed from roster contents = roster field = report field',
    sha_bytes(jcompact(payload).encode()) == roster['rosterPayloadSha256'] == report['rosterPayloadSha256'])
chk('roster counts: 64 pairs, 64 late, 128 null, 1,536 requested = 1,536 new, 0 shared, 0 also in frozen, 0 L=H, 8 replays',
    roster['counts'] == {'pairs': 64, 'lateGenomes': 64, 'nullGenomes': 128, 'requestedConfigurations': 1536, 'newConfigurations': 1536,
                         'sharedConfigurations': 0, 'configurationsAlsoInFrozenStudy': 0, 'pairsWithLateEqualToMidpoint': 0,
                         'pairsWithAncestorDisagreementAcrossCarriers': 0, 'replayConfigurations': 8, 'totalConfigurations': 1544},
    str(roster['counts']))

# ------------------------------------------------------------------ genome utilities
NN = 160
MU, SIGMA, GAIN = 160, 161, 162
SLOT_B2_PHOTO = 152  # B2_OFF (152) + OUT.PHOTO (0)


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
    """Mulberry32 with rejection (semantics of tools/lib/founder-policy.ts)."""
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


def type_matched_mutant(base, desc, seed):
    """Mutant of `base` copying the base->desc change in kind and size (protocol: 'Null')."""
    changed = [s for s in range(163) if desc[s] != base[s]]
    rng = Random(seed)
    out = list(base)
    weights = list(range(NN))
    for s in [c for c in changed if c < NN]:
        place(rng, base, out, weights, abs(desc[s] - base[s]))
    for s in [c for c in changed if c >= NN]:
        mag = abs(desc[s] - base[s])
        v = signed(s, base[s], mag, 1 if rng.int(2) else -1)
        assert v is not None
        out[s] = v
    return out


def cache_key(desc, anc, cfg, seed, assignment, steps=20000, src=SRC):
    obj = {'descendantHex': desc, 'founderHex': anc, 'cfg': cfg, 'seed': seed, 'assignment': assignment,
           'steps': steps, 'sourceManifestHash': src}
    return sha_bytes(jcompact(obj).encode())


# ------------------------------------------------------------------ frozen-study inputs
ASSAY_SEEDS = [6430001, 6430002, 6430003, 6430004]
ASSIGN = [0, 1]
frozen_obs = frozen['observations']
frozen_cfg = {}
for o in frozen_obs:
    if o['cacheKey'] and o['assaySeed'] not in frozen_cfg:
        frozen_cfg[o['assaySeed']] = jload(EVOLVED_RESULTS + '/%s.json' % o['cacheKey'])['cfg']
    if len(frozen_cfg) == 4:
        break
chk('frozen cfg found for all 4 assay seeds', sorted(frozen_cfg) == ASSAY_SEEDS)
chk('roster.design: midpoint 500000, endpoint 1000000, assay seeds, assignments 0/1, 2 mutants/pair, bootstrap seed 6490300, mutant seeds 6490101..6490228',
    roster['design'] == {'midpoint': 500000, 'endpoint': 1000000, 'pairing': 'each 1M draw with its own 500k ancestor genome',
                         'assaySeeds': ASSAY_SEEDS, 'assignments': ASSIGN, 'mutantsPerPair': 2, 'mutantSeeds': [6490101, 6490228],
                         'bootstrapSeed': 6490300})

founder_hex = {f['id']: f['hex'] for f in manifest['founders']}
normal_units = [u for u in manifest['units'] if u['mode'] == 'normal']
chk('manifest has 32 normal-arm units in roster.histories order', [u['id'] for u in normal_units] == [h['unitId'] for h in roster['histories']] and len(normal_units) == 32)
chk('each normal unit\'s founderHex = manifest founder hex', all(u['founderHex'] == founder_hex[u['founderId']] for u in manifest['units']))

bt = [t for t in frozen['byTime'] if t['time'] == 1000000][0]
abund = {a['unitId']: a for a in bt['abundance']}
evolved_order = []
seen = set()
for o in frozen_obs:
    if o['time'] != 1000000 or o['mode'] != 'normal' or o['drawId'] in seen:
        continue
    seen.add(o['drawId'])
    evolved_order.append((o['drawId'], o['unitId'], o['founderId'], o['seed'], o['draw']))
chk('64 normal-arm 1M draws in frozen report order', len(evolved_order) == 64)
L_hex = {did: abund[uid]['sample']['draws']['genomes'][draw] for (did, uid, fid, seed, draw) in evolved_order}

pairs = roster['pairs']
genomes = {g['id']: g for g in roster['genomes']}
chk('192 genomes, unique ids', len(genomes) == 192 == len(roster['genomes']))
chk('roster.pairs follow the frozen report order (lateDrawId, unit, founder, seed, draw)',
    [(p['lateDrawId'], p['unitId'], p['founderId'], p['seed'], p['draw']) for p in pairs] == evolved_order)
chk('every late genome hex = frozen report\'s 1M sample draw genome (L is an existing genome)',
    all(genomes[p['lateGenomeId']]['descendantHex'] == L_hex[p['lateDrawId']] for p in pairs))
anc_by = {(a['unitId'], a['draw']): a for a in roster['ancestors']}
chk('64 ancestor records, one per (unit, draw), lateHex = L, ancestorHex = genome ancestorHex',
    len(roster['ancestors']) == 64 and all(anc_by[(p['unitId'], p['draw'])]['lateHex'] == L_hex[p['lateDrawId']] and
                                          anc_by[(p['unitId'], p['draw'])]['ancestorHex'] == genomes[p['lateGenomeId']]['ancestorHex'] for p in pairs))
chk('no L equals its H; every genome row keeps H as the ancestor of its pair',
    all(genomes[p['lateGenomeId']]['descendantHex'] != genomes[p['lateGenomeId']]['ancestorHex'] for p in pairs) and
    all(genomes[n['genomeId']]['ancestorHex'] == genomes[p['lateGenomeId']]['ancestorHex'] for p in pairs for n in p['nulls']))

# ---- type-matched nulls regenerated from (H, L) with Mulberry32 6490100 + j
mut_ok, mut_bad = True, []
H_slots, L_slots = {}, {}
for k, p in enumerate(pairs, start=1):
    g = genomes[p['lateGenomeId']]
    h = slots_of(g['ancestorHex'])
    l = slots_of(g['descendantHex'])
    H_slots[p['pairId']] = h
    L_slots[p['pairId']] = l
    if g['id'] != 'l%03d' % k:
        mut_ok = False
        mut_bad.append('id:' + g['id'])
    changed = [s for s in range(163) if h[s] != l[s]]
    if p['slotsChanged'] != len(changed):
        mut_ok = False
        mut_bad.append('slotsChanged:' + p['pairId'])
    for i in range(2):
        j = (k - 1) * 2 + i + 1
        m = type_matched_mutant(h, l, 6490100 + j)
        n = p['nulls'][i]
        ng = genomes[n['genomeId']]
        if n['genomeId'] != 'n%03d' % j or n['seed'] != 6490100 + j or ng['descendantHex'] != hex_of(m) or ng['ancestorHex'] != g['ancestorHex']:
            mut_ok = False
            mut_bad.append('n%03d' % j)
        wch = sorted(abs(l[s] - h[s]) for s in range(NN) if l[s] != h[s])
        wm = sorted(abs(m[s] - h[s]) for s in range(NN) if m[s] != h[s])
        pch = [(s, abs(l[s] - h[s])) for s in range(NN, 163) if l[s] != h[s]]
        pm = [(s, abs(m[s] - h[s])) for s in range(NN, 163) if m[s] != h[s]]
        if wch != wm or pch != pm or n['weightMagnitudes'] != [abs(l[s] - h[s]) for s in changed if s < NN] or n['parameterSlots'] != [s for s in changed if s >= NN]:
            mut_ok = False
            mut_bad.append('type:n%03d' % j)
        if not all(bounds(s)[0] <= m[s] <= bounds(s)[1] for s in range(163)):
            mut_ok = False
            mut_bad.append('bounds:n%03d' % j)
        if hex_of(m) in (g['ancestorHex'], g['descendantHex']):
            mut_ok = False
            mut_bad.append('degenerate:n%03d' % j)
chk('all 128 null genomes regenerated bit for bit from (H, L) with Mulberry32 6490100 + j; magnitudes/parameter slots/bounds preserved; slotsChanged recomputed',
    mut_ok, str(mut_bad[:5]))
chk('no duplicate (descendantHex, ancestorHex) among the 192 genomes',
    len({(g['descendantHex'], g['ancestorHex']) for g in roster['genomes']}) == 192)
chk('the two null mutants of every pair are distinct genomes', all(genomes[p['nulls'][0]['genomeId']]['descendantHex'] != genomes[p['nulls'][1]['genomeId']]['descendantHex'] for p in pairs))
H_by_pair = {p['pairId']: genomes[p['lateGenomeId']]['ancestorHex'] for p in pairs}

# ------------------------------------------------------------------ raw files
files = sorted(glob.glob(RUN + '/assays/*.json'))
chk('1,536 raw assay files', len(files) == 1536, str(len(files)))
raw = {}
by_content = {}
bad = []
canon_ok = 0
for f in files:
    with open(f, 'rb') as fh:
        b = fh.read()
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
    if b == (json.dumps(r, separators=(',', ':'), ensure_ascii=False) + '\n').encode():
        canon_ok += 1
    raw[stem] = {'r': r, 'sha': sha_bytes(b)}
chk('every raw file: filename == recomputed cacheKey == stored cacheKey; cfg == frozen cfg; steps/format/sourceManifestHash ok; no duplicate content',
    not bad, str(bad[:5]))
info('raw files byte-identical to compact re-serialization (informational; float formatting may differ between JS and Python)', '%d of %d' % (canon_ok, len(raw)))

score_bad = []
nstat = Counter()
for k, v in raw.items():
    r = v['r']
    d, a = r['descendantMass'], r['ancestorMass']
    assert isinstance(d, int) and isinstance(a, int) and d >= 0 and a >= 0 and r['unassociatedMass'] >= 0
    if d + a == 0:
        exp_status, exp_score, v['frac'] = 'both-extinct', None, None
    else:
        exp_status = 'scored'
        v['frac'] = Fraction(d - a, d + a)
        exp_score = (d - a) / (d + a)
    nstat[exp_status] += 1
    if r['status'] != exp_status or r['score'] != exp_score:
        score_bad.append(k)
chk('score/status in every raw file equals recomputation from masses (bitwise float equality)', not score_bad, str(score_bad[:5]))
chk('no both-extinct outcome among the 1,536 results', nstat.get('both-extinct', 0) == 0, str(dict(nstat)))
chk('sanity: 1,536 distinct initial-state hashes and 1,536 distinct final-state hashes (no result reused or copied between configurations)',
    len({v['r']['initialStateHash'] for v in raw.values()}) == 1536 and len({v['r']['finalStateHash'] for v in raw.values()}) == 1536)
numbers['statusCounts'] = dict(nstat)
numbers['unassociatedMassNonzero'] = sum(1 for v in raw.values() if v['r']['unassociatedMass'] != 0)

# provenance
pf = sorted(glob.glob(RUN + '/provenance/*.json'))
prov_ok = len(pf) == 1536
prov_foreign = 0
for p in pf:
    k = os.path.basename(p)[:-5]
    exp = jcompact({'format': 'discovery-divergence-control-provenance/v2', 'studyIdentitySha256': SID, 'cacheKey': k,
                    'resultSha256': raw[k]['sha']}) + '\n'
    with open(p) as fh:
        txt = fh.read()
    if txt != exp:
        prov_ok = False
        prov_foreign += 1
chk('1,536 provenance files each bind THIS study\'s identity + sha256 of the raw result bytes (format name is the reused divergence-control one, by design)', prov_ok, 'bad=%d' % prov_foreign)
chk('provenance and result file sets are identical', {os.path.basename(p)[:-5] for p in pf} == set(raw))

# ------------------------------------------------------------------ roster configuration mapping
missing_cfg, cfg_map, keys_ok = [], {}, True
for g in roster['genomes']:
    ks = []
    for s in ASSAY_SEEDS:
        for a in ASSIGN:
            stem = by_content.get((g['descendantHex'], g['ancestorHex'], s, a))
            if stem is None:
                missing_cfg.append((g['id'], s, a))
                continue
            cfg_map[(g['id'], s, a)] = stem
            ks.append(stem)
            if cache_key(g['descendantHex'], g['ancestorHex'], frozen_cfg[s], s, a) != stem:
                keys_ok = False
    if ks != g['cacheKeys']:
        keys_ok = False
chk('every roster configuration (192 genomes x 4 seeds x 2 assignments) has exactly one raw result by content; none missing',
    not missing_cfg and len(cfg_map) == 1536, str(missing_cfg[:3]))
chk('cache keys recomputed from roster hexes + frozen cfg equal result filenames and roster genome.cacheKeys (order seed-major)', keys_ok)
chk('roster.assays cacheKeys = the 1,536 files = the 1,536 mapped configurations, 1:1 (no duplicate, no foreign, none unused)',
    {a['cacheKey'] for a in roster['assays']} == set(cfg_map.values()) == set(raw) and len(roster['assays']) == len(set(cfg_map.values())) == 1536 and
    all(cfg_map[(next(g['id'] for g in roster['genomes'] if g['descendantHex'] == a['descendantHex'] and g['ancestorHex'] == a['ancestorHex']), a['assaySeed'], a['assignment'])] == a['cacheKey'] for a in roster['assays']))

# not the frozen study's or the divergence control's configurations
frozen_keys = {o['cacheKey'] for o in frozen_obs if o['cacheKey']}
dc_keys = {os.path.basename(f)[:-5] for f in glob.glob(RUN_DC + '/assays/*.json')}
chk('no continuation configuration is a frozen-study configuration, nor a divergence-control one',
    not (set(raw) & frozen_keys) and not (set(raw) & dc_keys), 'frozenKeys=%d dcKeys=%d' % (len(frozen_keys), len(dc_keys)))
dc_prov_sids = set()
for p in glob.glob(RUN_DC + '/provenance/*.json')[:3]:
    dc_prov_sids.add(jload(p)['studyIdentitySha256'])
chk('divergence control provenance carries a different identity than this study\'s', SID not in dc_prov_sids and len(dc_prov_sids) == 1, str(dc_prov_sids))

# ------------------------------------------------------------------ technical completeness
repdir, audir, invdir = RUN + '/replay', RUN + '/audit', RUN + '/invocations'
exp_replay = {x['cacheKey']: x for x in roster['replay']}
chk('candidate.replayExpected keys == roster replay keys (8)', set(candidate['replayExpected']) == set(exp_replay) and len(exp_replay) == 8)
rep_ok, rep_detail = True, []
for k, x in exp_replay.items():
    with open(EVOLVED_RESULTS + '/%s.json' % k, 'rb') as fh:
        ob = fh.read()
    if sha_bytes(ob) != candidate['replayExpected'][k]:
        rep_ok = False
        rep_detail.append('origsha:' + k[:8])
    orig = json.loads(ob)
    rec = jload(repdir + '/%s.json' % k)
    res, o2 = dict(rec['result']), dict(orig)
    res.pop('elapsedSeconds')
    o2.pop('elapsedSeconds')
    if res != o2 or rec['matches'] is not True or rec['studyIdentitySha256'] != SID:
        rep_ok = False
        rep_detail.append('mismatch:' + k[:8])
    fo = [o for o in frozen_obs if o['cacheKey'] == k and o['id'] == x['observationId']][0]
    if fo['score'] != orig['score']:
        rep_ok = False
        rep_detail.append('reportscore:' + k[:8])
rep_files = glob.glob(repdir + '/*.json')
chk('8 replays: every field except elapsedSeconds equals the frozen original; originals match pinned hashes and frozen report scores; identity is this study\'s',
    rep_ok and len(rep_files) == 8, str(rep_detail))
obs_founder = {o['id']: o['founderId'] for o in frozen_obs}
replay_per_founder = Counter(obs_founder[x['observationId']] for x in roster['replay'])
chk('replays: 2 per founder', sorted(replay_per_founder.values()) == [2, 2, 2, 2], str(dict(replay_per_founder)))
numbers['replayPerFounder'] = dict(replay_per_founder)

inv = []
for f in sorted(glob.glob(invdir + '/*.json')):
    r = jload(f)
    r['_idx'] = int(os.path.basename(f)[:3])
    inv.append(r)
chk('39 invocation records, all settled, none reserved/failed', len(inv) == 39 and all(r['status'] == 'settled' for r in inv), str(Counter(r['status'] for r in inv)))
chk('invocation indices are 1..39 with no gap', [r['_idx'] for r in inv] == list(range(1, 40)))
chg = sum(r['chargedSeconds'] for r in inv)
numbers['chargedSeconds'] = chg
chk('charged %.2f s total over %d invocations (cap 30,000 s, <= 70 invocations)' % (chg, len(inv)), chg < 30000 and len(inv) <= 70 and abs(chg - 21624.25699853897) < 1e-6)
chk('every invocation charged <= 600 s run + 120 s watchdog (max %.1f s)' % max(r['chargedSeconds'] for r in inv), max(r['chargedSeconds'] for r in inv) <= 720)
chk('sum newAssays = 1,536 and sum replayed = 8 across invocations; every invocation did new work (so owes an audit)',
    sum(r['newAssays'] for r in inv) == 1536 and sum(r['replayed'] for r in inv) == 8 and all(r['newAssays'] > 0 for r in inv),
    'new=%d replayed=%d' % (sum(r['newAssays'] for r in inv), sum(r['replayed'] for r in inv)))
chk('invocation records bind this study\'s identity, candidate and release hashes (not the divergence control\'s)',
    all(r['studyIdentitySha256'] == SID and r['candidateSha256'] == release['candidateSha256'] and r['releaseSha256'] == REL_SHA for r in inv) and
    REL_SHA != sha_file(DC + '/release.json'))
chk('only the first invocation replayed (8) and the final one reports complete', inv[0]['replayed'] == 8 and all(r['replayed'] == 0 for r in inv[1:]) and inv[-1]['complete'] is True and not any(r['complete'] for r in inv[:-1]))
chk('no repaired/recovery action recorded (repaired == 0 everywhere)', all(r['repaired'] == 0 for r in inv))
chk('release reviewedAt precedes the first invocation start',
    release['reviewedAt'] < inv[0]['startedAt'].replace('Z', '+00:00') or release['reviewedAt'][:19] < inv[0]['startedAt'][:19],
    '%s < %s' % (release['reviewedAt'], inv[0]['startedAt']))
entries = sorted(e for e in os.listdir(RUN) if e != '.DS_Store')
chk('no RUNNING lock, no STOPPED.json, tmp empty, no foreign entries in the run dir',
    not os.path.exists(RUN + '/RUNNING') and not os.path.exists(RUN + '/STOPPED.json') and
    [e for e in os.listdir(RUN + '/tmp') if e != '.DS_Store'] == [] and entries == ['assays', 'audit', 'invocations', 'provenance', 'replay', 'tmp'], str(entries))
aud, aud_ok = {}, True
for f in sorted(glob.glob(audir + '/*.json')):
    r = jload(f)
    idx = int(os.path.basename(f)[:3])
    k = r['result']['cacheKey']
    with open(EVOLVED_RESULTS + '/%s.json' % k) as fh:
        orig = json.load(fh)
    a, b = dict(r['result']), dict(orig)
    a.pop('elapsedSeconds')
    b.pop('elapsedSeconds')
    ok = (a == b and r['matches'] is True and r['certifies'] == idx and k in exp_replay and r['studyIdentitySha256'] == SID)
    aud_ok &= ok
    aud[idx] = (ok, k)
chk('39 audit records, one per invocation index 1..39, each equal to its frozen original except elapsedSeconds, matches true, this study\'s identity',
    aud_ok and sorted(aud) == sorted(r['_idx'] for r in inv if r['newAssays'] > 0) == list(range(1, 40)), 'audits=%d' % len(aud))
rot = Counter(k[:8] for _, k in aud.values())
numbers['auditsPerReplayConfiguration'] = dict(rot)
chk('audits cover all eight replay configurations', set(k for _, k in aud.values()) == set(exp_replay))
sup = open(REPO + '/runs/founder-discovery-continuation-v1.supervise.log').read().strip().splitlines()
last = json.loads(sup[-1])
chk('supervisor final line: complete, 1536/1536, 8/8 replays, 39/39 audits, no mismatch, no unresolved reservation, not stopped, charged matches',
    last['complete'] is True and last['assays'] == 1536 and last['replayed'] == 8 and last['audits'] == 39 == last['auditsOwed'] and
    last['mismatchRecorded'] is False and last['unresolvedReservations'] == 0 and last['stopped'] is False and abs(last['chargedSeconds'] - chg) < 1e-6)
rep_mt = max(os.path.getmtime(f) for f in rep_files)
ass_mt = min(os.path.getmtime(f) for f in files)
chk('all 8 replay files were written before the first new assay file (mtime order)', rep_mt <= ass_mt, 'last replay %.0f first assay %.0f' % (rep_mt, ass_mt))
chk('protocol file mtime precedes the first new assay file (mtime is only indicative; the sha pin is the real check)', os.path.getmtime(V1 + '/continuation-protocol.md') < ass_mt)
_last_work = max(os.path.getmtime(f) for d_ in ('assays', 'provenance', 'audit', 'invocations', 'replay') for f in glob.glob(RUN + '/' + d_ + '/*.json'))
_ana = [e for e in os.listdir(CONT + '/analysis-v1') if e not in ('.DS_Store', 'review-rederive.py', 'review.json')]
chk('report.json was written after the last run artifact, and is the only analysis output in analysis-v1 (single analyzer run; "no interim analysis" is not otherwise observable)',
    os.path.getmtime(CONT + '/analysis-v1/report.json') > _last_work and _ana == ['report.json'], str(_ana))
numbers['firstInvocationStart'] = inv[0]['startedAt']
numbers['lastInvocationFinish'] = inv[-1]['finishedAt']

# technical completeness from raw evidence only
missing_new = sum(1 for k in cfg_map.values() if raw[k]['frac'] is None)
tech_complete = (len(raw) == 1536 and missing_new == 0 and rep_ok and len(rep_files) == 8 and aud_ok and len(aud) == 39)
chk('technical completeness (independent): 1,536 results, 8/8 replays, matching audits for all 39 working invocations, no mismatch, no reservation, no STOPPED', tech_complete)
chk('report.technicalComplete True, replay 8/8, audits 39/39, missingNewResults 0, stopped False',
    report['technicalComplete'] is True and report['replay'] == {'expected': 8, 'matched': 8} and report['audits'] == {'total': 39, 'matched': 39} and
    report['missingNewResults'] == 0 and report['stopped'] is False)

# ------------------------------------------------------------------ estimands (exact)
Z = Fraction(0)
TH = Fraction(1, 10)


def mean(xs):
    xs = list(xs)
    return sum(xs, Z) / len(xs)


def rng_of(scores):
    n = len(scores)
    lo = sum((x if x is not None else Fraction(-1) for x in scores), Z) / n
    hi = sum((x if x is not None else Fraction(1) for x in scores), Z) / n
    pt = sum(scores, Z) / n if all(x is not None for x in scores) else None
    return (lo, hi, pt)


def avg(rs):
    n = len(rs)
    return (sum((r[0] for r in rs), Z) / n, sum((r[1] for r in rs), Z) / n,
            sum((r[2] for r in rs), Z) / n if all(r[2] is not None for r in rs) else None)


def contrast(a, b):
    return (a[0] - b[1], a[1] - b[0], a[2] - b[2] if a[2] is not None and b[2] is not None else None)


def gsc(gid):
    return [raw[cfg_map[(gid, s, a)]]['frac'] for s in ASSAY_SEEDS for a in ASSIGN]


# self-test of the protocol's missing-score rule ("unavailable scores take their full [-1, 1] range"): not exercised by this
# study's data (nothing is missing), so check the helpers on a synthetic case
_t = rng_of([Fraction(1, 2), None, Fraction(-1, 4), None])
chk('self-test: bounds for two unavailable scores among four take [-1, 1] each: lower = (1/2 - 1/4 - 2)/4, upper = (1/2 - 1/4 + 2)/4, point None',
    _t == ((Fraction(1, 2) + Fraction(-1, 4) - 2) / 4, (Fraction(1, 2) + Fraction(-1, 4) + 2) / 4, None))
G = {gid: rng_of(gsc(gid)) for gid in genomes}
founders = []
for p in pairs:
    if p['founderId'] not in founders:
        founders.append(p['founderId'])
seeds = sorted({p['seed'] for p in pairs})
chk('founders in report order cluster-33, -4, -16, -139; evolution seeds 6410001..6410008',
    founders == ['discovery-cluster-33', 'discovery-cluster-4', 'discovery-cluster-16', 'discovery-cluster-139'] and seeds == list(range(6410001, 6410009)))

P = {}
for p in pairs:
    late = G[p['lateGenomeId']]
    nulls = [G[n['genomeId']] for n in p['nulls']]
    P[p['pairId']] = {'founderId': p['founderId'], 'seed': p['seed'], 'late': late, 'nulls': nulls, 'null': avg(nulls)}
U = {}
for fid in founders:
    for s in seeds:
        d = [v for v in P.values() if v['founderId'] == fid and v['seed'] == s]
        assert len(d) == 2
        late = avg([x['late'] for x in d])
        nul = avg([x['null'] for x in d])
        c = contrast(late, nul)
        U[(fid, s)] = {'late': late, 'null': nul, 'contrast': c, 'cert': c[0] > TH, 'lateCert': late[0] > TH}
chk('no missing/unavailable outcome: every bound collapses to the point value (lower == upper == point) at pair, unit and contrast level',
    missing_new == 0 and all(u['contrast'][0] == u['contrast'][1] == u['contrast'][2] and u['late'][0] == u['late'][2] for u in U.values()))

# founder level and readings (protocol order)
sel = {}
for fid in founders:
    us = [U[(fid, s)] for s in seeds]
    late, nul, con = avg([u['late'] for u in us]), avg([u['null'] for u in us]), avg([u['contrast'] for u in us])
    ncert = sum(u['cert'] for u in us)
    nlate = sum(u['lateCert'] for u in us)
    met = tech_complete and ncert >= 7
    if not tech_complete:
        reading = 'technically incomplete'
    elif not met:
        reading = 'not met'
    elif nlate < 7:
        reading = 'met, not clearly progressing'
    elif nul[0] <= TH:
        reading = 'met, continued beyond divergence'
    else:
        reading = 'met, partly divergence'
    sel[fid] = {'cert': ncert, 'lateCert': nlate, 'met': met, 'late': late, 'null': nul, 'contrast': con, 'reading': reading}


def fl(x):
    return None if x is None else float(x)


print()
for fid in founders:
    s = sel[fid]
    print(fid.split('-')[-1], 'cert', s['cert'], 'lateCert', s['lateCert'], 'L %.4f N %.4f L-N %.4f' % (fl(s['late'][2]), fl(s['null'][2]), fl(s['contrast'][2])), '->', s['reading'])
    print('   per-seed L, N, L-N, cert, lateCert:', [(sd % 100, round(fl(U[(fid, sd)]['late'][2]), 3), round(fl(U[(fid, sd)]['null'][2]), 3),
                                                   round(fl(U[(fid, sd)]['contrast'][2]), 3), U[(fid, sd)]['cert'], U[(fid, sd)]['lateCert']) for sd in seeds])

# ---- compare to report.json
maxd = {'pair': 0.0, 'unit': 0.0, 'founder': 0.0, 'block': 0.0, 'pooled': 0.0, 'bootstrap': 0.0}
flags_ok = True
# pairs
rep_pairs = {x['pairId']: x for x in report['pairs']}
pair_ok = len(rep_pairs) == 64
for pid, v in P.items():
    r = rep_pairs[pid]
    for nm, mine in (('late', v['late']), ('null', v['null'])):
        for i, key in enumerate(('lower', 'upper', 'point')):
            maxd['pair'] = max(maxd['pair'], abs(r[nm][key] - fl(mine[i])))
    for j in range(2):
        for i, key in enumerate(('lower', 'upper', 'point')):
            maxd['pair'] = max(maxd['pair'], abs(r['nulls'][j][key] - fl(v['nulls'][j][i])))
        if (r['nulls'][j]['scored'], r['nulls'][j]['bothExtinct'], r['nulls'][j]['missing']) != (8, 0, 0):
            pair_ok = False
    if (r['late']['scored'], r['late']['bothExtinct'], r['late']['missing']) != (8, 0, 0) or r['founderId'] != v['founderId'] or r['seed'] != v['seed']:
        pair_ok = False
chk('A: all 64 pair-level L, N1, N2 and N (late, two mutants, mean) match report; 8 scored per genome', pair_ok and maxd['pair'] < 1e-12, 'max abs diff %.2e' % maxd['pair'])
rep_units = {(u['founderId'], u['seed']): u for u in report['units']}
unit_ok = len(rep_units) == 32
for k, u in U.items():
    r = rep_units[k]
    for nm, mine in (('late', u['late']), ('null', u['null']), ('contrast', u['contrast'])):
        for i, key in enumerate(('lower', 'upper', 'point')):
            maxd['unit'] = max(maxd['unit'], abs(r[nm][key] - fl(mine[i])))
    if r['certified'] != u['cert'] or r['lateCertified'] != u['lateCert']:
        unit_ok = False
chk('A: all 32 unit values (L, N, L-N), certification flags and late-certification flags match report', unit_ok and maxd['unit'] < 1e-12, 'max abs diff %.2e' % maxd['unit'])
rep_cont = {x['founderId']: x for x in report['continuation']}
cont_ok = len(rep_cont) == 4
for fid in founders:
    r, s = rep_cont[fid], sel[fid]
    for nm, mine in (('late', s['late']), ('null', s['null']), ('contrast', s['contrast'])):
        for i, key in enumerate(('lower', 'upper', 'point')):
            maxd['founder'] = max(maxd['founder'], abs(r[nm][key] - fl(mine[i])))
    if r['certifiedSeeds'] != s['cert'] or r['lateCertifiedSeeds'] != s['lateCert'] or r['criterionMet'] != s['met'] or not r['reading'].startswith(s['reading']):
        cont_ok = False
chk('A: founder-level L, N, contrast; certified-seed and late-certified counts; criterionMet; readings (fixed protocol order) match report',
    cont_ok and maxd['founder'] < 1e-12, 'max abs diff %.2e' % maxd['founder'])
numbers['readings'] = {fid: sel[fid]['reading'] for fid in founders}
numbers['rederived'] = {fid: {'certifiedSeeds': sel[fid]['cert'], 'lateCertifiedSeeds': sel[fid]['lateCert'], 'L': fl(sel[fid]['late'][2]),
                              'N': fl(sel[fid]['null'][2]), 'L_minus_N': fl(sel[fid]['contrast'][2])} for fid in founders}
exact_margin = min((abs(u['contrast'][0] - TH), k) for k, u in U.items())
numbers['closestUnitContrastToThreshold'] = {'margin': fl(exact_margin[0]), 'unit': '%s/%d' % (exact_margin[1][0], exact_margin[1][1])}
numbers['closestUnitLateToThreshold'] = min((fl(abs(u['late'][0] - TH)), '%s/%d' % k) for k, u in U.items())
numbers['unitTable'] = {'%s/%d' % (f.split('-')[-1], s): {'L': round(fl(U[(f, s)]['late'][2]), 4), 'N': round(fl(U[(f, s)]['null'][2]), 4),
                                                           'L-N': round(fl(U[(f, s)]['contrast'][2]), 4), 'cert': U[(f, s)]['cert'],
                                                           'lateCert': U[(f, s)]['lateCert']} for f in founders for s in seeds}

# ---- pooled block rule and bootstrap
blocks = []
for s in seeds:
    c = avg([U[(f, s)]['contrast'] for f in founders])
    blocks.append({'seed': s, 'lower': c[0], 'upper': c[1], 'point': c[2], 'cert': c[0] > TH})
pooled = avg([(b['lower'], b['upper'], b['point']) for b in blocks])
bl, bu, bp = [fl(b['lower']) for b in blocks], [fl(b['upper']) for b in blocks], [fl(b['point']) for b in blocks]


def percentile(sorted_, p):
    at = (len(sorted_) - 1) * p
    lo, hi = math.floor(at), math.ceil(at)
    return sorted_[lo] + (sorted_[hi] - sorted_[lo]) * (at - lo)


rng = Random(6490300)
BL, BU, BP = [], [], []
nb = len(blocks)
for _ in range(10000):
    s = [rng.int(nb) for _ in range(nb)]

    def red(arr):
        acc = 0.0
        for j in s:
            acc = acc + arr[j]
        return acc / nb
    BL.append(red(bl))
    BU.append(red(bu))
    BP.append(red(bp))
BL.sort()
BU.sort()
BP.sort()
boot = {'bounded95': (percentile(BL, 0.025), percentile(BU, 0.975)), 'point95': (percentile(BP, 0.025), percentile(BP, 0.975))}
rd = report['descriptive']
print('\nblocks:', [(b['seed'] % 100, round(fl(b['point']), 4), b['cert']) for b in blocks])
print('pooled', fl(pooled[2]), 'bootstrap', boot)
for i, b in enumerate(blocks):
    for key, mine in (('lower', bl[i]), ('upper', bu[i]), ('point', bp[i])):
        maxd['block'] = max(maxd['block'], abs(rd['pooledBlocks'][i][key] - mine))
chk('descriptive: 8 pooled blocks (values and certification) match report',
    maxd['block'] < 1e-12 and all(rd['pooledBlocks'][i]['certified'] == blocks[i]['cert'] and rd['pooledBlocks'][i]['seed'] == blocks[i]['seed'] for i in range(8)),
    'max abs diff %.2e' % maxd['block'])
for i, key in enumerate(('lower', 'upper', 'point')):
    maxd['pooled'] = max(maxd['pooled'], abs(rd['pooledEffect'][key] - fl(pooled[i])))
chk('descriptive: pooled certified blocks = 7 of 8 and pooled mean 0.17037 match report',
    sum(b['cert'] for b in blocks) == 7 == rd['pooledCertifiedBlocks'] and maxd['pooled'] < 1e-12 and not blocks[0]['cert'], 'mean=%.6f diff %.2e' % (fl(pooled[2]), maxd['pooled']))
bd = max(abs(boot['bounded95'][0] - rd['bootstrap']['bounded95']['lower']), abs(boot['bounded95'][1] - rd['bootstrap']['bounded95']['upper']),
         abs(boot['point95'][0] - rd['bootstrap']['point95']['lower']), abs(boot['point95'][1] - rd['bootstrap']['point95']['upper']))
maxd['bootstrap'] = bd
chk('descriptive: whole-block bootstrap (seed 6490300, 10,000 resamples, my own Mulberry32, JS summation order) reproduces report',
    bd < 1e-12 and rd['bootstrap']['seed'] == 6490300 and rd['bootstrap']['resamples'] == 10000,
    'mine=[%.6f,%.6f] report=[%.6f,%.6f] diff=%.2e' % (boot['point95'][0], boot['point95'][1], rd['bootstrap']['point95']['lower'], rd['bootstrap']['point95']['upper'], bd))
numbers['pooled'] = {'blocks': [round(fl(b['point']), 6) for b in blocks], 'mean': fl(pooled[2]), 'bootstrap95': list(boot['point95'])}
chk('report fixed settings: threshold 0.1, required 7, tail 9/256, 4 confirmatory tests',
    report['threshold'] == 0.1 and report['required'] == 7 and report['exactOneSidedSignTailPerTest'] == 9 / 256 and report['confirmatoryTests'] == 4)
numbers['maxAbsDiffFromReport'] = maxd
numbers['maxAbsDiffOverall'] = max(maxd.values())

# ------------------------------------------------------------------ descriptive roster items (from the roster + genomes, not from report)
swept = {'discovery-cluster-33': ('b2[PHOTO]', SLOT_B2_PHOTO), 'discovery-cluster-139': ('mu', MU)}
desc_mine = {}
hist_by_unit = {h['unitId']: h for h in roster['histories']}
for fid in founders:
    ps = [p for p in pairs if p['founderId'] == fid]
    hs = [hist_by_unit[u] for u in sorted({p['unitId'] for p in ps})]
    gens = [anc_by[(p['unitId'], p['draw'])]['generations'] for p in ps]
    chg_slots = [sum(1 for s in range(163) if H_slots[p['pairId']][s] != L_slots[p['pairId']][s]) for p in ps]
    e = {'pairs': len(ps), 'medianSlotsChanged': statistics.median(chg_slots), 'rangeSlotsChanged': [min(chg_slots), max(chg_slots)],
         'medianGenerations': statistics.median(gens), 'lateEqualsMidpoint': sum(1 for p in ps if H_by_pair[p['pairId']] == L_hex[p['lateDrawId']]),
         'meanFounderMass500k': sum(h['founderMass500k'] for h in hs) / len(hs), 'meanFounderMass1M': sum(h['founderMass1M'] for h in hs) / len(hs),
         'medianGenomes500k': statistics.median(h['genomes500k'] for h in hs)}
    if fid in swept:
        nm, sl = swept[fid]
        fv = slots_of(founder_hex[fid])[sl]
        carries = lambda v: v > fv
        hv = [H_slots[p['pairId']][sl] for p in ps]
        lv = [L_slots[p['pairId']][sl] for p in ps]
        e['sweep'] = {'slotName': nm, 'founderValue': fv, 'midpointCarries': sum(carries(v) for v in hv), 'lateCarries': sum(carries(v) for v in lv),
                      'gainedAfterMidpoint': sum(1 for a, b in zip(hv, lv) if not carries(a) and carries(b)),
                      'lostAfterMidpoint': sum(1 for a, b in zip(hv, lv) if carries(a) and not carries(b))}
        e['sweepPairs'] = [(p['seed'] % 100, p['draw'], a, b) for p, a, b in zip(ps, hv, lv)]
    else:
        e['sweep'] = None
    desc_mine[fid] = e
rep_desc = {x['founderId']: x for x in rd['roster']}
ok = True
for fid in founders:
    r, m = rep_desc[fid], desc_mine[fid]
    for key in ('pairs', 'medianSlotsChanged', 'medianGenerations', 'lateEqualsMidpoint', 'meanFounderMass500k', 'meanFounderMass1M', 'medianGenomes500k'):
        if abs(r[key] - m[key]) > 1e-9:
            ok = False
            print('  descriptive mismatch', fid, key, r[key], m[key])
    if (r['sweep'] is None) != (m['sweep'] is None):
        ok = False
    elif m['sweep'] is not None:
        for key in ('slotName', 'founderValue', 'midpointCarries', 'lateCarries', 'gainedAfterMidpoint', 'lostAfterMidpoint'):
            if r['sweep'][key] != m['sweep'][key]:
                ok = False
                print('  sweep mismatch', fid, key)
chk('descriptive roster items (median H->L slot change and generations, pairs L=H, mean founder-lineage mass 500k/1M, median distinct genomes at 500k, sweep carriers) recomputed from the roster match report',
    ok and rd['lateEqualsMidpointPairs'] == 0)
numbers['descriptiveRoster'] = {fid.split('-')[-1]: {k: v for k, v in e.items() if k != 'sweepPairs'} for fid, e in desc_mine.items()}

# protocol's pre-run facts
f33, f139 = desc_mine['discovery-cluster-33'], desc_mine['discovery-cluster-139']
chk('protocol pre-run facts: median slot change 10/7/17/14; ranges 7-15, 4-16, 5-27, 8-26',
    [desc_mine[f]['medianSlotsChanged'] for f in founders] == [10, 7, 17, 14] and
    [tuple(desc_mine[f]['rangeSlotsChanged']) for f in founders] == [(7, 15), (4, 16), (5, 27), (8, 26)])
chk('protocol pre-run facts: mass 500k->1M cluster-33 0.73M->0.83M, cluster-4 1.01M->1.07M, cluster-16 2.03M->2.04M, cluster-139 2.00M->2.06M',
    [(round(desc_mine[f]['meanFounderMass500k'] / 1e6, 2), round(desc_mine[f]['meanFounderMass1M'] / 1e6, 2)) for f in founders] == [(0.73, 0.83), (1.01, 1.07), (2.03, 2.04), (2.0, 2.06)])
c33pairs = f33['sweepPairs']
chk('protocol pre-run facts, cluster-33: H carries the raised bias in 14 of 16 pairs; neither H nor L carries it in seed 6410002; none gains or loses it; one L raised it further (99 -> 119, seed 6410006)',
    f33['sweep']['midpointCarries'] == 14 and f33['sweep']['lateCarries'] == 14 and f33['sweep']['gainedAfterMidpoint'] == 0 and f33['sweep']['lostAfterMidpoint'] == 0 and
    {x[0] for x in c33pairs if x[2] <= 62 and x[3] <= 62} == {2} and sum(1 for x in c33pairs if x[0] == 2) == 2 and
    [(x[0], x[2], x[3]) for x in c33pairs if x[2] > 62 and x[3] > 62 and x[2] != x[3]] == [(6, 99, 119)], str(c33pairs))
c139pairs = f139['sweepPairs']
chk('protocol pre-run facts, cluster-139: H carries raised mu in 11 of 16 pairs, L in 13; both pairs of seed 6410007 gained it (33 -> 47); neither carries it in seed 6410002 (both pairs) and seed 6410008 (one pair)',
    f139['sweep']['midpointCarries'] == 11 and f139['sweep']['lateCarries'] == 13 and f139['sweep']['gainedAfterMidpoint'] == 2 and
    [x for x in c139pairs if x[0] == 7] and all(x[2] == 33 and x[3] == 47 for x in c139pairs if x[0] == 7) and
    sum(1 for x in c139pairs if x[0] == 2 and x[2] <= 33 and x[3] <= 33) == 2 and sum(1 for x in c139pairs if x[0] == 8 and x[2] <= 33 and x[3] <= 33) == 1, str(c139pairs))
shared = {}
for fid in founders:
    for s in seeds:
        a = [anc_by[(p['unitId'], p['draw'])] for p in pairs if p['founderId'] == fid and p['seed'] == s]
        shared[(fid, s)] = a[0]['ancestorLineage'] == a[1]['ancestorLineage']
sh_by_f = {f.split('-')[-1]: sum(shared[(f, s)] for s in seeds) for f in founders}
chk('protocol pre-run facts: both pairs share one 500k ancestor lineage in 10 of 32 units (cluster-33 5, cluster-4 3, cluster-139 2)',
    sum(shared.values()) == 10 and sh_by_f == {'33': 5, '4': 3, '16': 0, '139': 2}, str(sh_by_f))
chk('shared-ancestor units also share the ancestor genome (same H hex)', all((H_by_pair[pairs[i]['pairId']] == H_by_pair[pairs[i + 1]['pairId']]) == shared[(pairs[i]['founderId'], pairs[i]['seed'])]
                                                                           for i in range(0, 64, 2)))
chk('every L genome carried by a single 1M lineage; carriers agree on the ancestor genome', all(a['carrierLineages'] == 1 and a['carriersShareAncestorGenome'] for a in roster['ancestors']))
numbers['sharedHUnits'] = ['%s/%d' % (f.split('-')[-1], s) for (f, s), v in shared.items() if v]

# ------------------------------------------------------------------ H re-derivation from checkpoints and edges
anc_result = {}
if not args.skip_checkpoints:
    try:
        import numpy as np
    except Exception as e:  # pragma: no cover
        np = None
        info('numpy unavailable; ancestry re-derivation from checkpoints skipped', str(e))
    if np is not None:
        t0 = time.time()
        STEPS = list(range(0, 1100000, 100000))

        def load_state(path):
            with open(path, 'rb') as f:
                b = f.read()
            w = np.frombuffer(b, dtype='<u4')
            assert int(w[0]) == 0x4b434c42
            step = int(w[3])
            p = 8 + 2 * 10
            assert int(w[p]) == 0
            cl = int(w[p + 1])
            p += 2
            nwords = (cl + 3) // 4
            cfg = json.loads(w[p:p + nwords].tobytes()[:cl])
            p += nwords
            n = cfg['tileW'] * cfg['tileH'] * cfg['tilesX'] * cfg['tilesY']
            ncell = int(w[p])
            p += 1
            assert ncell == n * 7
            cells = w[p:p + ncell].reshape(7, n)
            p += ncell
            ng = int(w[p])
            p += 1
            assert ng == n * 44
            genome = w[p:p + ng].reshape(44, n)
            return {'step': step, 'cfg': cfg, 'n': n, 'cells': cells, 'genome': genome, 'sha': sha_bytes(b)}

        def lineage_table(st):
            n = st['n']
            cells, genome = st['cells'], st['genome']
            mass = cells[1].astype(np.int64) + cells[3].astype(np.int64)
            out, unassoc, cache = {}, 0, {}
            for i in np.nonzero(mass)[0]:
                hi, lo = int(genome[0, i]), int(genome[1, i])
                if hi == 0 and lo == 0:
                    unassoc += int(mass[i])
                    continue
                words = tuple(int(x) for x in genome[2:44, i])
                if words not in cache:
                    mu, sigma, gain = words[0] & 0xffff, words[0] >> 16, words[1] & 0xff
                    wts = []
                    for wd in words[2:]:
                        for bb in range(4):
                            u = (wd >> (bb * 8)) & 255
                            wts.append(u - 256 if u > 127 else u)
                    cache[words] = hex_of(wts + [mu, sigma, gain])
                hx = cache[words]
                key = '%d:%d' % (hi, lo)
                prior = out.get(key)
                if prior is not None and prior[0] != hx:
                    raise Exception('conflicting genome words for lineage ' + key)
                out[key] = (hx, (prior[1] if prior else 0) + int(mass[i]))
            return out, unassoc

        def founder_mass(table, parent, root_key):
            memo, total, unknown = {}, 0, 0
            for key, (_, m) in table.items():
                path, cur, seen_ = [], key, set()
                while cur != root_key and cur in parent and cur not in memo:
                    if cur in seen_:
                        raise Exception('ancestry cycle')
                    seen_.add(cur)
                    path.append(cur)
                    cur = parent[cur]
                ok_ = (cur == root_key) or memo.get(cur, False)
                for q in path:
                    memo[q] = ok_
                if ok_:
                    total += m
                else:
                    unknown += m
            return total, unknown

        anc_bad, hist_bad = [], []
        n_checked = 0
        ancestry_mine = {}
        for hrec in roster['histories']:
            uid = hrec['unitId']
            d = HISTORIES + '/' + uid
            unit = next(u for u in normal_units if u['id'] == uid)
            # receipts: chain, hashes
            rcp = {s: jload(d + '/receipt-%d.json' % s) for s in STEPS}
            rsha = {s: sha_file(d + '/receipt-%d.json' % s) for s in STEPS}
            if rsha[500000] != hrec['receipt500kSha256'] or rsha[1000000] != hrec['receipt1MSha256'] or \
                    rsha[500000] != candidate['midpointReceipts']['runs/founder-discovery-improvement-consolidated-v1/histories/%s/receipt-500000.json' % uid]:
                hist_bad.append(('receiptSha', uid))
            for s in STEPS[1:]:
                if rcp[s]['previousReceiptSha256'] != rsha[s - 100000] or rcp[s]['unitId'] != uid or rcp[s]['manifestHash'] != manifest['manifestHash'] or rcp[s]['step'] != s:
                    hist_bad.append(('receiptChain', uid, s))
            # edges
            parent, parent500 = {}, {}
            for s in STEPS[1:]:
                ep = d + '/edges-%d.json' % s
                with open(ep, 'rb') as fh:
                    eb = fh.read()
                if sha_bytes(eb) != rcp[s]['edgeDeltaSha256']:
                    hist_bad.append(('edgeSha', uid, s))
                for e in json.loads(eb):
                    c, pr = e['child'], e['parent']
                    if c in parent and parent[c] != pr:
                        hist_bad.append(('conflictingParent', uid, c))
                    parent[c] = pr
                    if s <= 500000:
                        parent500[c] = pr
                del eb
            st5 = load_state(d + '/checkpoint-500000.blck')
            st1 = load_state(d + '/checkpoint-1000000.blck')
            if st5['sha'] != rcp[500000]['checkpointSha256'] or st1['sha'] != rcp[1000000]['checkpointSha256'] or st5['step'] != 500000 or st1['step'] != 1000000:
                hist_bad.append(('checkpointSha', uid))
            t5, un5 = lineage_table(st5)
            t1, un1 = lineage_table(st1)
            root_key = '0:%d' % 1  # founder lineage 0:1 (cfg has no ringNamespace)
            if 'ringNamespace' in st5['cfg'] or 'ringNamespace' in st1['cfg']:
                hist_bad.append(('ringNamespace', uid))
            fm5, unk5 = founder_mass(t5, parent500, root_key)
            fm1, unk1 = founder_mass(t1, parent, root_key)
            gen5 = len({v[0] for v in t5.values()})
            if (fm5, fm1, gen5) != (hrec['founderMass500k'], hrec['founderMass1M'], hrec['genomes500k']) or unk5 or unk1 or un5 or un1:
                hist_bad.append(('masses', uid, fm5, fm1, gen5, unk5, unk1))
            if rcp[500000]['stateHash'] != hrec['stateHash500k']:
                hist_bad.append(('stateHash500k', uid))
            samp = rcp[1000000]['sample']
            lates = [anc_by[(uid, dr)]['lateHex'] for dr in (0, 1)]
            if samp['draws']['status'] != 'present' or samp['draws']['genomes'] != lates or samp['rootMass'] != fm1 or samp['unknownAncestryMass'] != 0:
                hist_bad.append(('1Msample', uid))
            # the 1M sample's genome abundance is the founder-lineage genome mass by hex
            ab = {x['hex']: x['mass'] for x in samp['byGenomeAbundance']}
            by_hex1 = defaultdict(int)
            for hx, m in t1.values():
                by_hex1[hx] += m
            if dict(by_hex1) != ab:
                hist_bad.append(('abundance1M', uid))
            for dr in (0, 1):
                ar = anc_by[(uid, dr)]
                lateHex = ar['lateHex']
                carriers = sorted([(k, v) for k, v in t1.items() if v[0] == lateHex], key=lambda kv: (-kv[1][1], kv[0]))
                if not carriers:
                    anc_bad.append((uid, dr, 'no carrier'))
                    continue
                lk, lv = carriers[0]
                key, gens = lk, 0
                while key not in t5:
                    key = parent[key]
                    gens += 1
                mine = {'lateLineage': lk, 'lateLineageMass': lv[1], 'carrierLineages': len(carriers), 'ancestorLineage': key, 'ancestorMass': t5[key][1],
                        'generations': gens, 'ancestorHex': t5[key][0]}
                others = []
                for ok_, _ in carriers[1:]:
                    k2 = ok_
                    while k2 not in t5:
                        k2 = parent[k2]
                    others.append(t5[k2][0])
                mine['carriersShare'] = all(h == mine['ancestorHex'] for h in others)
                theirs = {'lateLineage': ar['lateLineage'], 'lateLineageMass': ar['lateLineageMass'], 'carrierLineages': ar['carrierLineages'],
                          'ancestorLineage': ar['ancestorLineage'], 'ancestorMass': ar['ancestorMass'], 'generations': ar['generations'],
                          'ancestorHex': ar['ancestorHex'], 'carriersShare': ar['carriersShareAncestorGenome']}
                if mine != theirs:
                    anc_bad.append((uid, dr, {k: (mine[k], theirs[k]) for k in mine if mine[k] != theirs[k]}))
                # sanity: ancestor birth step <= 500000 and the walked path's previous lineage was born after
                if int(key.split(':')[0]) > 500000 + 1:
                    anc_bad.append((uid, dr, 'ancestor born after 500k'))
                ancestry_mine[(uid, dr)] = mine
                n_checked += 1
            del st5, st1, parent, parent500
        chk('H re-derived independently in Python from the checkpoints and mutation edges for all 32 histories: receipts chain and hash to the pins; edge deltas and checkpoints hash to their receipts; mass tables, state hash, 1M sample draws and genome abundance agree',
            not hist_bad, str(hist_bad[:4]))
        chk('H re-derived for all 64 L draws (heaviest 1M lineage carrying L; first ancestor on the parent path present at 500k): lineage keys, masses, generations walked, H genome and carrier agreement equal the roster',
            not anc_bad and n_checked == 64, 'checked=%d bad=%s' % (n_checked, str(anc_bad[:3])))
        numbers['ancestryRederivation'] = {'draws': n_checked, 'seconds': round(time.time() - t0, 1)}
        print('   ancestry re-derivation took %.1f s' % (time.time() - t0))
else:
    info('H re-derivation from checkpoints skipped (--skip-checkpoints)', '')

# ------------------------------------------------------------------ cross-check of the findings document (outside the protocol)
findings_path = V1 + '/continuation-findings.md'
if os.path.exists(findings_path):
    txt = open(findings_path).read()

    def parse_table(heading):
        i = txt.index(heading)
        rows = {}
        for line in txt[i:].splitlines()[1:]:
            m = re.match(r'\|\s*cluster-(\d+)\s*\|(.*)\|\s*$', line)
            if m:
                cells = [c.strip() for c in m.group(2).split('|')]
                rows[m.group(1)] = cells
            elif rows and not line.startswith('|'):
                break
        return rows
    t_ln = parse_table('**L − N contrast:**')
    t_lh = parse_table('**L vs H:**')
    ok = len(t_ln) == 4 and len(t_lh) == 4
    worst, off = 0.0, []
    for fid in founders:
        fshort = fid.split('-')[-1]
        for idx, s in enumerate(seeds):
            for tabname, tab, key, flag, mark in (('L-N', t_ln, 'contrast', 'cert', '✓'), ('L vs H', t_lh, 'late', 'lateCert', '†')):
                c = tab[fshort][idx]
                val = float(c.replace('✓', '').replace('†', '').replace('−', '-').strip())
                mine = fl(U[(fid, s)][key][2])
                worst = max(worst, abs(val - mine))
                if (mark in c) != U[(fid, s)][flag]:
                    ok = False
                    print('  findings check-mark mismatch', tabname, fshort, s, c)
                if abs(val - mine) > 0.005 + 1e-9:
                    off.append('%s %s %d: table %s vs %.4f' % (tabname, fshort, s % 100, c, mine))
    chk('findings document (continuation-findings.md): both unit tables (L - N, L vs H), all 64 check marks, equal the recomputation (max abs diff %.4f; cells that do not round to the printed 2 decimals: %d)' % (worst, len(off)),
        ok and worst < 0.0075, '; '.join(off))
    numbers['findingsTableCellsNotRoundingExactly'] = off
else:
    info('continuation-findings.md not present; table cross-check skipped', '')

# ------------------------------------------------------------------ protocol/readings cross-checks
chk('protocol reading: no founder is technically incomplete; all four read "not met" (certified seeds below 7)',
    all(sel[f]['reading'] == 'not met' for f in founders) and all(sel[f]['cert'] < 7 for f in founders) and sorted(sel[f]['cert'] for f in founders) == [1, 3, 4, 5])
c16 = sel['discovery-cluster-16']
chk('protocol cluster-16 clause not triggered: cluster-16 does not read "continued beyond divergence" nor "partly divergence" (reads not met; 1/8 certified; 0/8 late-certified)',
    c16['reading'] == 'not met' and c16['cert'] == 1 and c16['lateCert'] == 0)
c33 = sel['discovery-cluster-33']
chk('protocol M4 table row for cluster-33: reading "not met" (5/8 certified, 5/8 late-certified, technically complete) -> inconclusive, not evidence of a stall, cannot support the physics-change pivot',
    c33['reading'] == 'not met' and c33['cert'] == 5 and c33['lateCert'] == 5 and tech_complete)

# ------------------------------------------------------------------ descriptive / post hoc (NOT protocol decision rules)
post = {}
post['unitContrastSD_sample_perFounder'] = {f.split('-')[-1]: round(statistics.stdev([fl(U[(f, s)]['contrast'][2]) for s in seeds]), 3) for f in founders}
post['unitContrastSD_pop_perFounder'] = {f.split('-')[-1]: round(statistics.pstdev([fl(U[(f, s)]['contrast'][2]) for s in seeds]), 3) for f in founders}
post['unitLateSD_sample_perFounder'] = {f.split('-')[-1]: round(statistics.stdev([fl(U[(f, s)]['late'][2]) for s in seeds]), 3) for f in founders}
# binomial arithmetic: P(>=7 of 8) at the observed certified fraction (descriptive illustration of the 7-of-8 rule's stringency)
def p_ge7(p):
    return 8 * p ** 7 * (1 - p) + p ** 8


post['P(>=7 of 8 certified) if every seed certified independently with the observed fraction'] = {f.split('-')[-1]: round(p_ge7(sel[f]['cert'] / 8), 4) for f in founders}
post['exactSignTail_7of8'] = (math.comb(8, 7) + math.comb(8, 8)) / 256


# Illustration only (post hoc, assumes normal unit contrasts with the OBSERVED mean and sample SD, independent units): chance of meeting 7-of-8
def _phi(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


post['P(meet 7-of-8) if unit contrasts were Normal(observed mean, observed SD), independent (illustration)'] = {
    f.split('-')[-1]: round(p_ge7(_phi((fl(sel[f]['contrast'][2]) - 0.10) / statistics.stdev([fl(U[(f, s)]['contrast'][2]) for s in seeds]))), 3) for f in founders}
# shared-H units and their status
post['sharedHUnits_status (unit: cert, lateCert, L-N)'] = {'%s/%d' % (f.split('-')[-1], s): [U[(f, s)]['cert'], U[(f, s)]['lateCert'], round(fl(U[(f, s)]['contrast'][2]), 3)] for (f, s), v in shared.items() if v}
post['certifiedUnits_sharingH'] = sum(1 for (f, s), v in shared.items() if v and U[(f, s)]['cert'])
post['certifiedUnits_total'] = sum(1 for u in U.values() if u['cert'])
# certified-vs-late-certified agreement
post['units_cert_and_lateCert / cert_only / lateCert_only'] = [sum(1 for u in U.values() if u['cert'] and u['lateCert']), sum(1 for u in U.values() if u['cert'] and not u['lateCert']),
                                                               sum(1 for u in U.values() if (not u['cert']) and u['lateCert'])]
post['certified_but_not_lateCert_units'] = ['%s/%d (L %.3f, N %.3f)' % (f.split('-')[-1], s, fl(U[(f, s)]['late'][2]), fl(U[(f, s)]['null'][2])) for f in founders for s in seeds
                                            if U[(f, s)]['cert'] and not U[(f, s)]['lateCert']]
# distance from threshold for failing units in cluster-33
post['cluster33_failing_units (L-N)'] = {'%d' % (s % 100): round(fl(U[('discovery-cluster-33', s)]['contrast'][2]), 3) for s in seeds if not U[('discovery-cluster-33', s)]['cert']}
post['cluster33_failing_units_L'] = {'%d' % (s % 100): round(fl(U[('discovery-cluster-33', s)]['late'][2]), 3) for s in seeds if not U[('discovery-cluster-33', s)]['cert']}
post['cluster33_failing_units_N'] = {'%d' % (s % 100): round(fl(U[('discovery-cluster-33', s)]['null'][2]), 3) for s in seeds if not U[('discovery-cluster-33', s)]['cert']}
post['cluster33_failing_units_sweepStatus (H,L carry b2[PHOTO] raised; values)'] = {
    '%d' % (s % 100): [[(x[2] > 62, x[3] > 62, x[2], x[3]) for x in c33pairs if x[0] == s % 100]] for s in seeds if not U[('discovery-cluster-33', s)]['cert']}
# leave-one-assay-seed-out (descriptive robustness, as in the precedent)
def gmean_sub(gid, seedset):
    sc = [raw[cfg_map[(gid, s, a)]]['frac'] for s in seedset for a in ASSIGN]
    return sum(sc, Z) / len(sc)


loo = {}
for drop in ASSAY_SEEDS:
    keep = [x for x in ASSAY_SEEDS if x != drop]
    row = {}
    for fid in founders:
        cert = lcert = 0
        for s in seeds:
            ps = [p for p in pairs if p['founderId'] == fid and p['seed'] == s]
            Lu = sum((gmean_sub(p['lateGenomeId'], keep) for p in ps), Z) / 2
            Nu = sum((gmean_sub(n['genomeId'], keep) for p in ps for n in p['nulls']), Z) / 4
            cert += (Lu - Nu) > TH
            lcert += Lu > TH
        row[fid.split('-')[-1]] = [cert, lcert]
    loo[drop] = row
post['leave_one_assay_seed_out [certified, lateCertified] per founder'] = loo
# per-pair view: how many of the 16 pairs have L above H / N above H
post['pairs_with_L_gt_H (pair mean > 0) per founder'] = {f.split('-')[-1]: sum(1 for p in P.values() if p['founderId'] == f and p['late'][2] > 0) for f in founders}
post['pairs_with_L_gt_N per founder'] = {f.split('-')[-1]: sum(1 for p in P.values() if p['founderId'] == f and p['late'][2] > p['null'][2]) for f in founders}
# position effect: mean score by assignment per arm
pos = defaultdict(lambda: [[], []])
for (gid, s, a), stem in cfg_map.items():
    pos[(genomes[gid]['arm'], genomes[gid]['founderId'].split('-')[-1])][a].append(raw[stem]['frac'])
post['position_effect_meanScore_assignment0_vs_1'] = {'%s|%s' % k: [round(fl(mean(v[0])), 4), round(fl(mean(v[1])), 4)] for k, v in sorted(pos.items())}
# exactly neutral genomes (antisymmetric a0/a1 in every assay seed)
def exactly_neutral(gid):
    return all(raw[cfg_map[(gid, s, 0)]]['frac'] + raw[cfg_map[(gid, s, 1)]]['frac'] == 0 for s in ASSAY_SEEDS)


neu = defaultdict(lambda: [0, 0])
for gid, g in genomes.items():
    neu[(g['arm'], g['founderId'].split('-')[-1])][1] += 1
    neu[(g['arm'], g['founderId'].split('-')[-1])][0] += exactly_neutral(gid)
post['exactly_neutral_genomes [n_neutral, n_total] (mean score exactly 0)'] = {'%s|%s' % k: v for k, v in sorted(neu.items())}
# cluster-4 L vs H negative seeds, cluster-33 per-seed spread
post['cluster4_units_with_L_lt_H'] = ['%d (%.3f)' % (s % 100, fl(U[('discovery-cluster-4', s)]['late'][2])) for s in seeds if U[('discovery-cluster-4', s)]['late'][2] < 0]
# cluster-139 late-certified units and whether they carry a sweep gained after the midpoint
post['cluster139_lateCertified_units'] = [s % 100 for s in seeds if U[('discovery-cluster-139', s)]['lateCert']]
post['cluster139_pairs_gained_mu_after_500k (seed, draw, H mu, L mu)'] = [x for x in c139pairs if x[2] <= 33 < x[3]]
# power-style spread vs protocol's assumed 0.15-0.4
post['protocol_assumed_unit_contrast_SD_range'] = [0.15, 0.4]
# L vs H score distribution at ceiling for cluster-33
c33_scores = [raw[cfg_map[(p['lateGenomeId'], s, a)]]['frac'] for p in pairs if p['founderId'] == 'discovery-cluster-33' for s in ASSAY_SEEDS for a in ASSIGN]
post['cluster33_L_competitions_abs_gt_0.99 / total'] = [sum(1 for x in c33_scores if abs(x) > Fraction(99, 100)), len(c33_scores)]
nm_ = defaultdict(list)
for n_ in [n for p in pairs for n in p['nulls']]:
    nm_[genomes[n_['genomeId']]['founderId'].split('-')[-1]].append(fl(G[n_['genomeId']][2]))
post['null_genome_mean_SD_per_founder (so a unit N from 4 nulls has SE about SD/2)'] = {k: round(statistics.pstdev(v), 3) for k, v in nm_.items()}
post['null_genomes_with_mean_gt_0 [n, of 32]'] = {k: sum(1 for x in v if x > 0) for k, v in nm_.items()}
post['founder_level_N_vs_H (random change of the same size is not neutral: mean < 0)'] = {f.split('-')[-1]: round(fl(sel[f]['null'][2]), 4) for f in founders}
numbers['postHocDescriptive'] = post
for k, v in post.items():
    print('  post hoc:', k, '=', v)

# ------------------------------------------------------------------ summary
failed = [c['name'] for c in checks if c['result'] == 'fail']
print('\nchecks: %d total, %d pass, %d fail, %d info' % (len(checks), sum(1 for c in checks if c['result'] == 'pass'), len(failed), sum(1 for c in checks if c['result'] == 'info')))
print('checks failed:', failed)
print('max abs diff from report.json anywhere: %.3e' % numbers['maxAbsDiffOverall'])
if args.out:
    with open(args.out, 'w') as f:
        json.dump({'checks': checks, 'numbers': numbers}, f, indent=1, default=str)
    print('wrote', args.out)
sys.exit(1 if failed else 0)
