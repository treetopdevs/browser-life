#!/usr/bin/env python3
"""Second screen for linked templates (docs/droplet-genes-linked2-2026-11-21/PLAN.md).

Resumable: sweep.ts skips finished runs, and each mode decides what to run from the files on disk, by the rules
in PLAN.md. At most two simulations run at a time. Seeds 1 to 4 decide; seeds 5 to 8 only in the labelled modes.
Output: runs/dropgenes/linked2/<phase>/ (not in git), one directory per phase and horizon.

  python3 experiments/dropgenes/linked2.py list           # the settings and their exact rates
  python3 experiments/dropgenes/linked2.py step0          # unlinked control, both gated arms, seeds 1 to 4, 50,000 steps
  python3 experiments/dropgenes/linked2.py step0-200      # the same at 200,000 steps, arms with a seed held at 50,000
  python3 experiments/dropgenes/linked2.py step0-more     # seeds 5 to 8 of the control (only on exactly 2 of 4)
  python3 experiments/dropgenes/linked2.py gate50         # clean gate: every setting, GATED_CLEAN, seeds 1 and 2, 50,000 steps
  python3 experiments/dropgenes/linked2.py gate200        # survivors: seeds 1 to 4, 200,000 steps
  python3 experiments/dropgenes/linked2.py par50          # settings that passed the gate: GATED_PAR, 50,000 steps
  python3 experiments/dropgenes/linked2.py par200         # settings held on 3 of 4 at 50,000: seeds 1 to 4, 200,000 steps
  python3 experiments/dropgenes/linked2.py diag           # labelled diagnostics d-g0 (and d-m0): link rules off, never frozen
  python3 experiments/dropgenes/linked2.py diag200        # only if no setting passes the gate: d-g0 and d-m0, GATED_CLEAN, 200,000 steps
  python3 experiments/dropgenes/linked2.py regress        # replay of a first-screen linked run (c01, seed 1, GATED_PAR)
  python3 experiments/dropgenes/linked2.py table          # what is on disk, phase by phase

The number of genes K is 4 unless LINKED2_K says otherwise (6 or 8, only by the step 0 rule in PLAN.md).
LINKED2_ONLY=s03,s04 makes gate200, par50 and par200 run only those settings in this invocation (to keep one
invocation short); what is eligible is still decided from every setting, so it cannot change a decision.
"""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BASE = os.path.join(ROOT, 'runs/dropgenes/linked2')
SWEEP = os.path.join(ROOT, 'experiments/dropgenes/sweep.ts')
LARGE = {'diffT': 0.1, 'diffW': 0.03, 'diffF': 0.6, 'diffA': 0.44}
K = int(os.environ.get('LINKED2_K', '4'))
if K not in (4, 6, 8):
    raise SystemExit('LINKED2_K must be 4, 6 or 8')
M_SITES = 16          # family M: one site per molecule, 16 sites per tile
G_SITES = 16 * K      # family G: one site per gene; also the unlinked control's sites
Q = 65536             # the kernel holds linkBreak and linkLoss as k / 65536
ONLY = {t for t in os.environ.get('LINKED2_ONLY', '').split(',') if t}

# (family, linkJoin, k of linkBreak, k of linkLoss): the list in PLAN.md, fixed before any linked run.
SETTINGS = {
    's01': ('M', 0.05, 1, 1),
    's02': ('M', 0.05, 1, 4),
    's03': ('M', 0.05, 4, 1),
    's04': ('M', 0.05, 4, 4),
    's05': ('G', 0.05, 1, 1),
    's06': ('G', 0.05, 1, 4),
    's07': ('G', 0.05, 4, 1),
    's08': ('G', 0.05, 4, 4),
    's09': ('M', 1, 1, 1),
    's10': ('M', 1, 4, 4),
    's11': ('G', 1, 1, 1),
    's12': ('G', 1, 4, 4),
}
# Labelled diagnostics: join, break and loss all 0, so never admissible and never frozen.
DIAG = {
    'd-g0': ('G', 0, 0, 0),
    'd-m0': ('M', 0, 0, 0),
}
ALL = {**SETTINGS, **DIAG}


def sites_of(tag):
    return M_SITES if ALL[tag][0] == 'M' else G_SITES


def ov(tag):
    family, join, kb, kl = ALL[tag]
    return json.dumps({**LARGE, 'linked': True, 'linkSites': 'molecule' if family == 'M' else 'gene',
                       'linkJoin': join, 'linkBreak': kb / Q, 'linkLoss': kl / Q}, separators=(',', ':'))


def path(phase, tag, arm, seed, genes=None, cap=None):
    genes = K if genes is None else genes
    cap = (sites_of(tag) if tag in ALL else G_SITES) if cap is None else cap
    return os.path.join(BASE, phase, f'{tag}-K{genes}-cap{cap}-{arm}-s{seed}.json')


STEPS = {'step0-50k': 50000, 'step0-200k': 200000, 'gate-50k': 50000, 'gate-200k': 200000, 'par-50k': 50000, 'par-200k': 200000,
         'diag-50k': 50000, 'diag-200k': 200000, 'regress': 50000}
C01 = {**LARGE, 'linked': True, 'linkSites': 'molecule', 'linkJoin': 0.05, 'linkBreak': 0.0001, 'linkLoss': 0.0001}  # the first screen's c01


# The set-up and observation every sweep.ts run uses (its PROTOCOL); a file made otherwise is not one of these runs.
PROTOCOL = {'census': 50, 'report': 2000, 'heredityDelay': 500, 'founders': 'grid', 'spacing': 16, 'seedPerGene': 2}
KERNEL = os.path.join(ROOT, 'apps/lab/src/dropgenes/kernel.ts')
_defaults = None


def defaults():
    """defaultDropGenesConfig() as the kernel gives it, read once per invocation (so nothing is copied by hand)."""
    global _defaults
    if _defaults is None:
        code = f"import {{ defaultDropGenesConfig }} from {json.dumps('file://' + KERNEL)}; console.log(JSON.stringify(defaultDropGenesConfig()));"
        res = subprocess.run(['deno', 'eval', '--no-lock', code], cwd=ROOT, capture_output=True, text=True)
        if res.returncode != 0:
            raise SystemExit(f'could not read the default configuration: {res.stderr[-400:]}')
        _defaults = json.loads(res.stdout)
    return _defaults


def expected(phase, tag, arm, seed, genes=None, cap=None):
    """The whole configuration a file under this name must record, defaults included: what sweep.ts checks when it
    is asked for the run, repeated here for a file the driver only reads to take a decision."""
    if tag == 'unlinked':
        over = dict(LARGE)
        cap = G_SITES if cap is None else cap
    elif tag == 'c01':
        over = dict(C01)
    else:
        over = json.loads(ov(tag))
        cap = sites_of(tag) if cap is None else cap
    return {**defaults(), **over, 'genes': K if genes is None else genes, 'capPerTile': cap, 'seed': seed, 'width': 64, 'height': 64,
            'gated': arm.startswith('GATED'), 'mutPar': 1e-4 if arm.endswith('PAR') else 0}


def summary(phase, tag, arm, seed, **kw):
    """The run's summary, or None when the file is not there. A file that is not the run its name says is an error."""
    file = path(phase, tag, arm, seed, **kw)
    try:
        with open(file) as f:
            s = json.load(f)['summary']
    except FileNotFoundError:
        return None
    want = expected(phase, tag, arm, seed, **kw)
    missing = object()
    wrong = sorted(k for k in set(want) | set(s['config']) if s['config'].get(k, missing) != want.get(k, missing))
    if s.get('protocol') != PROTOCOL:
        wrong.append('protocol')
    if s['steps'] != STEPS[phase]:
        wrong.append('steps')
    if s['residual'] != '0':
        wrong.append('residual')
    if (s.get('linked') or {}).get('founders', 'single') != ('single' if tag == 'unlinked' else 'linked'):
        wrong.append('founders')
    if wrong:
        raise SystemExit(f'{file} is not the run its name says (differs in: {", ".join(wrong)})')
    return s


def sweep(phase, tag, arm, seeds, steps, *, linked=True, genes=None, cap=None, ov_json=None):
    genes = K if genes is None else genes
    cap = (sites_of(tag) if linked else G_SITES) if cap is None else cap
    seeds = list(seeds)
    if max(seeds) > 8:
        raise SystemExit('no seed above 8 in this line')
    if steps != STEPS[phase]:
        raise SystemExit(f'{phase} is a {STEPS[phase]}-step phase')
    # Every seed is passed on, finished or not: sweep.ts skips a finished run only after checking that the file is
    # exactly this request (whole configuration, protocol, steps, founders, residual) and stops if it is not.
    cmd = ['deno', 'run', '-A', '--no-lock', SWEEP, '--dir', os.path.join(BASE, phase), '--genes', str(genes), '--caps', str(cap),
           '--seeds', ','.join(map(str, seeds)), '--steps', str(steps), '--mutPar', '1e-4', '--jobs', '2', '--arms', arm, '--tag', tag,
           '--ov', ov_json if ov_json is not None else (ov(tag) if linked else json.dumps(LARGE, separators=(',', ':')))]
    if linked:
        cmd += ['--templates', 'linked']
    res = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    sys.stdout.write(''.join(f'[{phase} {tag} {arm}] {line}\n' for line in res.stdout.splitlines()))
    sys.stdout.flush()
    if res.returncode != 0:
        sys.stdout.write(f'[{phase} {tag} {arm}] SWEEP FAILED: {res.stderr[-800:]}\n')
        raise SystemExit(1)
    for seed in seeds:  # and the driver's own check of each file it will decide from
        if summary(phase, tag, arm, seed, genes=genes, cap=cap) is None:
            raise SystemExit(f'{path(phase, tag, arm, seed, genes=genes, cap=cap)} was not written')


def held(phase, tag, arm, seeds, **kw):
    """(seeds held, seeds run) among `seeds`."""
    ss = [summary(phase, tag, arm, s, **kw) for s in seeds]
    return sum(1 for s in ss if s is not None and s['held']), sum(1 for s in ss if s is not None)


# ---- step 0: the unlinked control at the matched sites ----

def step0():
    for arm in ('GATED_PAR', 'GATED_CLEAN'):
        sweep('step0-50k', 'unlinked', arm, [1, 2, 3, 4], 50000, linked=False)


def step0_200():
    for arm in ('GATED_PAR', 'GATED_CLEAN'):
        h, n = held('step0-50k', 'unlinked', arm, [1, 2, 3, 4])
        if n < 4:
            raise SystemExit('step0 first')
        if h >= 1:
            sweep('step0-200k', 'unlinked', arm, [1, 2, 3, 4], 200000, linked=False)


def step0_count(arm, seeds):
    """Seeds held at the longest horizon the arm was run at on these seeds (rule 1 of step 0), or None while runs are owed."""
    h50, n50 = held('step0-50k', 'unlinked', arm, seeds)
    if n50 < len(seeds):
        return None
    if h50 == 0:
        return 0
    h200, n200 = held('step0-200k', 'unlinked', arm, seeds)
    return h200 if n200 == len(seeds) else None


def step0_more():
    """Seeds 5 to 8, only when GATED_PAR is held on exactly 2 of 4 at its deciding horizon (PLAN.md, step 0)."""
    first = step0_count('GATED_PAR', [1, 2, 3, 4])
    if first is None:
        raise SystemExit('step0 and step0-200 first')
    if first != 2:
        raise SystemExit(f'GATED_PAR is held on {first} of 4: PLAN.md runs seeds 5 to 8 only on exactly 2 of 4')
    for arm in ('GATED_PAR', 'GATED_CLEAN'):
        sweep('step0-50k', 'unlinked', arm, [5, 6, 7, 8], 50000, linked=False)
        if held('step0-50k', 'unlinked', arm, [5, 6, 7, 8])[0] >= 1:  # rule 1, applied to these four seeds
            sweep('step0-200k', 'unlinked', arm, [5, 6, 7, 8], 200000, linked=False)


# ---- step 2: the clean gate ----

def control_verdict():
    """At the current K: 'go' when the unlinked arm with the parasite is held on at most 1 of 4 (2 of 8, or the unclear
    middle), 'escalate' when capacity suffices here. Stops while step 0 is incomplete."""
    first = step0_count('GATED_PAR', [1, 2, 3, 4])
    if first is None or step0_count('GATED_CLEAN', [1, 2, 3, 4]) is None:
        raise SystemExit(f'step 0 is not complete at K = {K}: step0, then step0-200')
    if first == 2:
        more = step0_count('GATED_PAR', [5, 6, 7, 8])
        if more is None or step0_count('GATED_CLEAN', [5, 6, 7, 8]) is None:
            raise SystemExit(f'step 0 is held on 2 of 4 at K = {K}: step0-more first')
        return ('escalate', first + more) if first + more >= 6 else ('go', first + more)
    return ('escalate', first) if first >= 3 else ('go', first)


def need_step0():
    """The screen is at this K only if every smaller K's control sent it up and this K's control lets it stay
    (PLAN.md, step 0: the smallest K where the unlinked arm with the parasite is held on at most 1 of 4, 2 of 8)."""
    global K, G_SITES
    k0, g0 = K, G_SITES
    try:
        for lower in (4, 6, 8):
            if lower >= k0:
                break
            K, G_SITES = lower, 16 * lower
            verdict, held_n = control_verdict()
            if verdict != 'escalate':
                raise SystemExit(f'step 0 at K = {lower} did not call for a larger K (unlinked GATED_PAR held on {held_n}); the screen is not opened at K = {k0}')
    finally:
        K, G_SITES = k0, g0
    verdict, held_n = control_verdict()
    if verdict == 'escalate':
        raise SystemExit(f'step 0: unlinked GATED_PAR is held on {held_n} at K = {K}; capacity suffices at this K (PLAN.md, step 0)')


def gate_survivors():
    """Settings with seed 1 or 2 held at 50,000 steps. Every listed setting must have both runs."""
    for tag in SETTINGS:
        if held('gate-50k', tag, 'GATED_CLEAN', [1, 2])[1] < 2:
            raise SystemExit(f'gate50 is not complete ({tag})')
    return [t for t in SETTINGS if held('gate-50k', t, 'GATED_CLEAN', [1, 2])[0] >= 1]


def gate_passed():
    """Settings held on at least 3 of 4 at 200,000 steps. Every survivor must have all four runs."""
    survivors = gate_survivors()
    for tag in survivors:
        if held('gate-200k', tag, 'GATED_CLEAN', [1, 2, 3, 4])[1] < 4:
            raise SystemExit(f'gate200 is not complete ({tag})')
    return [t for t in survivors if held('gate-200k', t, 'GATED_CLEAN', [1, 2, 3, 4])[0] >= 3]


def par50_state(tag):
    """'dropped' (seeds 1 and 2 both lost), 'done' (all four run) or 'owed'."""
    h12, n12 = held('par-50k', tag, 'GATED_PAR', [1, 2])
    if n12 < 2:
        return 'owed'
    if h12 == 0:
        return 'dropped'
    return 'done' if held('par-50k', tag, 'GATED_PAR', [3, 4])[1] == 2 else 'owed'


def par_candidates():
    """Settings held on at least 3 of 4 with the parasite at 50,000 steps. Every setting that passed the gate must be settled."""
    passed = gate_passed()
    for tag in passed:
        if par50_state(tag) == 'owed':
            raise SystemExit(f'par50 is not complete ({tag})')
    return [t for t in passed if par50_state(t) == 'done' and held('par-50k', t, 'GATED_PAR', [1, 2, 3, 4])[0] >= 3]


def gate50():
    need_step0()
    for tag in SETTINGS:
        sweep('gate-50k', tag, 'GATED_CLEAN', [1, 2], 50000)


def gate200():
    need_step0()
    for tag in gate_survivors():
        if ONLY and tag not in ONLY:
            continue
        sweep('gate-200k', tag, 'GATED_CLEAN', [1, 2, 3, 4], 200000)


# ---- step 3: the parasite screen ----

def par50():
    need_step0()
    for tag in gate_passed():
        if ONLY and tag not in ONLY:
            continue
        sweep('par-50k', tag, 'GATED_PAR', [1, 2], 50000)
        if held('par-50k', tag, 'GATED_PAR', [1, 2])[0] >= 1:  # two losses on seeds 1 and 2: dropped
            sweep('par-50k', tag, 'GATED_PAR', [3, 4], 50000)


def par200():
    need_step0()
    for tag in par_candidates():
        if ONLY and tag not in ONLY:
            continue
        sweep('par-200k', tag, 'GATED_PAR', [1, 2, 3, 4], 200000)


# ---- labelled runs outside the list ----

def diag():
    """d-g0: the three link rules off under one site per gene at the matched sites. Both gated arms, seeds 1 to 4, 50,000 steps."""
    gate_survivors()  # made after the 50,000-step stage of the gate (PLAN.md)
    for arm in ('GATED_CLEAN', 'GATED_PAR'):
        sweep('diag-50k', 'd-g0', arm, [1, 2, 3, 4], 50000)
    if K != 4:  # at K = 4 the first screen's x00 is this run; at another K it has not been made
        for arm in ('GATED_CLEAN', 'GATED_PAR'):
            sweep('diag-50k', 'd-m0', arm, [1, 2, 3, 4], 50000)


def diag200():
    """Only if no setting passes the clean gate: the link rules off, both families, GATED_CLEAN, seeds 1 to 4, 200,000 steps."""
    if gate_passed():
        raise SystemExit('a setting passed the gate: PLAN.md runs these only when none does')
    for tag in DIAG:
        sweep('diag-200k', tag, 'GATED_CLEAN', [1, 2, 3, 4], 200000)


def regress():
    """Replay of the first screen's c01, seed 1, GATED_PAR (16 sites, K = 4): the edited runner must give the same numbers."""
    c01 = json.dumps(C01, separators=(',', ':'))
    for arm in ('GATED_PAR', 'GATED_CLEAN'):
        sweep('regress', 'c01', arm, [1], 50000, genes=4, cap=16, ov_json=c01)


# ---- tables ----

def cell(phase, tag, arm, seeds, **kw):
    out = []
    for seed in seeds:
        s = summary(phase, tag, arm, seed, **kw)
        if s is None:
            continue
        end = '' if s['extinctAt'] is None else f", none left at {s['extinctAt']}"
        out.append(f"s{seed}: {'held' if s['held'] else 'no'}, {s['lateMeanCompartments']:.1f}, {s['lateCompleteShare']:.2f}{end}")
    return out


def table():
    print(f'K = {K}; family M: molecule, {M_SITES} sites; family G: gene, {G_SITES} sites; unlinked control: {G_SITES} sites\n')
    print('| phase | setting | arm | seeds held | per seed: held, late compartments, complete share |')
    print('|---|---|---|---|---|')
    for phase in ('step0-50k', 'step0-200k'):
        for arm in ('GATED_CLEAN', 'GATED_PAR'):
            rows = cell(phase, 'unlinked', arm, range(1, 9))
            if rows:
                h, n = held(phase, 'unlinked', arm, range(1, 9))
                print(f'| {phase} | unlinked | {arm} | {h} of {n} | {"; ".join(rows)} |')
    for phase, arm, tags in (('gate-50k', 'GATED_CLEAN', SETTINGS), ('gate-200k', 'GATED_CLEAN', SETTINGS), ('par-50k', 'GATED_PAR', SETTINGS),
                             ('par-200k', 'GATED_PAR', SETTINGS), ('diag-50k', 'GATED_CLEAN', DIAG), ('diag-50k', 'GATED_PAR', DIAG), ('diag-200k', 'GATED_CLEAN', DIAG)):
        for tag in tags:
            rows = cell(phase, tag, arm, range(1, 9))
            if rows:
                h, n = held(phase, tag, arm, range(1, 9))
                print(f'| {phase} | {tag} | {arm} | {h} of {n} | {"; ".join(rows)} |')
    for label, fn in (('gate survivors at 50,000 (seed 1 or 2 held)', gate_survivors), ('passed the clean gate (3 of 4 at 200,000)', gate_passed),
                      ('held with the parasite on 3 of 4 at 50,000', par_candidates)):
        try:
            print(f'{label}: {fn()}')
        except SystemExit as e:
            print(f'{label}: not known yet ({e})')


def listing():
    print(f'K = {K}')
    print('| setting | family | site rule | sites per tile | linkJoin | linkBreak (k, rate) | linkLoss (k, rate) |')
    print('|---|---|---|---|---|---|---|')
    for tag, (family, join, kb, kl) in ALL.items():
        print(f"| {tag} | {family} | {'molecule' if family == 'M' else 'gene'} | {sites_of(tag)} | {join} | {kb}, {kb / Q:.3g} | {kl}, {kl / Q:.3g} |")
        print(f'    --ov \'{ov(tag)}\'')


MODES = {'list': listing, 'step0': step0, 'step0-200': step0_200, 'step0-more': step0_more, 'gate50': gate50, 'gate200': gate200,
         'par50': par50, 'par200': par200, 'diag': diag, 'diag200': diag200, 'regress': regress, 'table': table}

if __name__ == '__main__':
    if len(sys.argv) != 2 or sys.argv[1] not in MODES:
        raise SystemExit(__doc__)
    if ONLY - set(SETTINGS):
        raise SystemExit(f'LINKED2_ONLY names no listed setting: {sorted(ONLY - set(SETTINGS))}')
    os.makedirs(BASE, exist_ok=True)
    MODES[sys.argv[1]]()
