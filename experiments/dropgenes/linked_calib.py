#!/usr/bin/env python3
"""Calibration screen for linked templates (docs/droplet-genes-linked-2026-11-21/PLAN.md, "Calibration protocol").

Resumable: sweep.ts skips finished runs, and this driver decides what to run next from the files on disk.
At most two simulations run at a time. Seeds 1 to 4 only. Output: runs/dropgenes/linked/ (not in git).

  python3 experiments/dropgenes/linked_calib.py screen   # the 12 settings, linked K = 4 GATED_PAR, 50,000 steps
  python3 experiments/dropgenes/linked_calib.py table    # print what the screen left on disk
  python3 experiments/dropgenes/linked_calib.py x00par   # diagnostic: the three link rules off, GATED_PAR, seeds 1 and 2
  python3 experiments/dropgenes/linked_calib.py clean    # diagnostic: x00 and the 12 settings, GATED_CLEAN, seeds 1 and 2
"""
import json
import os
import subprocess
import sys
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DIR = os.path.join(ROOT, 'runs/dropgenes/linked/calib')
SWEEP = os.path.join(ROOT, 'experiments/dropgenes/sweep.ts')
LARGE = {'diffT': 0.1, 'diffW': 0.03, 'diffF': 0.6, 'diffA': 0.44}
STEPS = 50000
ARM = 'GATED_PAR'

# (site rule, founders, linkJoin, linkBreak, linkLoss): the list in CALIBRATION.md, fixed before any run.
SETTINGS = {
    'c01': ('molecule', 'linked', 0.05, 1e-4, 1e-4),
    'c02': ('molecule', 'linked', 0.05, 1e-4, 1e-3),
    'c03': ('molecule', 'linked', 0.05, 1e-3, 1e-4),
    'c04': ('molecule', 'linked', 0.05, 1e-3, 1e-3),
    'c05': ('molecule', 'linked', 1, 1e-4, 1e-4),
    'c06': ('molecule', 'linked', 1, 1e-4, 1e-3),
    'c07': ('molecule', 'linked', 1, 1e-3, 1e-4),
    'c08': ('molecule', 'linked', 1, 1e-3, 1e-3),
    'c09': ('molecule', 'single', 1, 1e-4, 1e-4),
    'c10': ('gene', 'linked', 0.05, 1e-4, 1e-4),
    'c11': ('gene', 'single', 1, 1e-4, 1e-4),
    'c12': ('gene', 'single', 0.05, 1e-3, 1e-3),
}
# Diagnostic only, made after the stop rule fired; not a calibration setting (the three link rules are off).
DIAG = {'x00': ('molecule', 'linked', 0, 0, 0)}


def ov(tag):
    sites, _founders, join, brk, loss = SETTINGS[tag]
    return json.dumps({**LARGE, 'linked': True, 'linkSites': sites, 'linkJoin': join, 'linkBreak': brk, 'linkLoss': loss}, separators=(',', ':'))


def path(tag, seed):
    return os.path.join(DIR, f'{tag}-K4-cap16-{ARM}-s{seed}.json')


def summary(tag, seed):
    try:
        with open(path(tag, seed)) as f:
            return json.load(f)['summary']
    except FileNotFoundError:
        return None


def sweep(tag, seeds, jobs):
    founders = SETTINGS[tag][1]
    cmd = ['deno', 'run', '-A', '--no-lock', SWEEP, '--dir', DIR, '--genes', '4', '--caps', '16', '--seeds', ','.join(map(str, seeds)),
           '--steps', str(STEPS), '--mutPar', '1e-4', '--jobs', str(jobs), '--arms', ARM, '--tag', tag, '--ov', ov(tag), '--templates', founders]
    res = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    sys.stdout.write(''.join(f'[{tag}] {line}\n' for line in res.stdout.splitlines()))
    sys.stdout.flush()
    if res.returncode != 0:
        sys.stdout.write(f'[{tag}] SWEEP FAILED: {res.stderr[-800:]}\n')
        raise SystemExit(1)


def held_count(tag):
    held = lost = 0
    for seed in (1, 2, 3, 4):
        s = summary(tag, seed)
        if s is None:
            continue
        if s['held']:
            held += 1
        else:
            lost += 1
    return held, lost


def finish(tag):
    """Seeds 3 and 4 by the protocol: stop as soon as two seeds are lost."""
    for seed in (3, 4):
        _held, lost = held_count(tag)
        if lost >= 2:
            return
        if summary(tag, seed) is None:
            sweep(tag, [seed], 1)


def screen():
    os.makedirs(DIR, exist_ok=True)
    for tag in SETTINGS:  # seeds 1 and 2, both at once
        if summary(tag, 1) is None or summary(tag, 2) is None:
            sweep(tag, [1, 2], 2)
    todo = [tag for tag in SETTINGS if held_count(tag)[1] < 2]
    lock = threading.Lock()

    def worker():
        while True:
            with lock:
                if not todo:
                    return
                tag = todo.pop(0)
            finish(tag)

    threads = [threading.Thread(target=worker) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    table()


def table():
    print('| setting | site rule | founders | join | break | loss | seeds held | per seed: held, late compartments, complete share, steps run |')
    print('|---|---|---|---|---|---|---|---|')
    for tag, (sites, founders, join, brk, loss) in SETTINGS.items():
        cells = []
        for seed in (1, 2, 3, 4):
            s = summary(tag, seed)
            if s is None:
                cells.append(f's{seed}: not run')
            else:
                cells.append(f"s{seed}: {'held' if s['held'] else 'no'}, {s['lateMeanCompartments']:.1f}, {s['lateCompleteShare']:.2f}, {s['stepsRun']}")
        held, lost = held_count(tag)
        print(f'| {tag} | {sites} | {founders} | {join} | {brk} | {loss} | {held} of {held + lost} | {"; ".join(cells)} |')


def diag(arm, settings):
    """After the stop rule: seeds 1 and 2 only, the given arm, into its own directory."""
    global DIR, ARM, SETTINGS
    ARM = arm
    DIR = os.path.join(ROOT, 'runs/dropgenes/linked', 'diag-' + arm.lower())
    SETTINGS = settings
    os.makedirs(DIR, exist_ok=True)
    for tag in SETTINGS:
        if summary(tag, 1) is None or summary(tag, 2) is None:
            sweep(tag, [1, 2], 2)
    table()


if __name__ == '__main__':
    mode = sys.argv[1]
    if mode == 'screen':
        screen()
    elif mode == 'table':
        table()
    elif mode == 'clean':
        diag('GATED_CLEAN', {**DIAG, **SETTINGS})
    elif mode == 'x00par':
        diag('GATED_PAR', DIAG)
