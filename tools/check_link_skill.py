#!/usr/bin/env python3
"""Run the gpuscale-link encoder over a corpus of deliberately-broken specs.

The audit's whole value is that it refuses what cannot work and flags what is
merely unwise. That is only true while every class stays caught, so each class
has a fixture here and an expected outcome:

    error  no link produced, because no hardware choice fixes it
    warn   a link, plus a warning that a stated target will be missed
    note   a link, plus a note that it is legal but usually a mistake
    clean  a link and nothing else

    python3 tools/check_link_skill.py
"""
import json, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORPUS = os.path.join(ROOT, 'tools', 'fixtures', 'audit-corpus')
ENCODER = os.path.join(ROOT, 'skill-link', 'scripts', 'gpuscale_url.py')
EXPECTED = json.load(open(os.path.join(CORPUS, 'expected.json')))

ok = bad = 0
for name in sorted(EXPECTED):
    want = EXPECTED[name]
    r = subprocess.run([sys.executable, ENCODER, 'encode',
                        os.path.join(CORPUS, name + '.json'), '--quiet'],
                       capture_output=True, text=True, timeout=120, cwd=ROOT)
    err = r.stderr
    got = ('error' if r.returncode == 2 else
           'warn' if 'WARN ' in err else
           'note' if 'note ' in err else 'clean')
    if got == want:
        ok += 1
    else:
        bad += 1
        print(f'  FAIL  {name}: expected {want}, got {got} (exit {r.returncode})')
        print('        ' + (err.strip().splitlines() or [''])[0][:150])

print(f'\n{ok}/{len(EXPECTED)} fixtures behaved as expected')
sys.exit(1 if bad else 0)
