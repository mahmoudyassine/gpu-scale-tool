#!/usr/bin/env python3
"""Every check, in one command. Run before tagging a release.

    python3 tools/check_all.py

Rebuilds nothing: run the four tools/build_*.py generators first, or a check
here will compare the docs against a stale artifact and pass when it should not.
"""
import os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHECKS = [
    ('workload presets', 'check_presets.py'),
    ('manual claims', 'check_manual.py'),
    ('link-skill audit', 'check_link_skill.py'),
    ('MCP protocol + parity', 'check_mcp.py'),
]
fails = []
for label, script in CHECKS:
    print(f'== {label}')
    r = subprocess.run([sys.executable, os.path.join(ROOT, 'tools', script)],
                       capture_output=True, text=True, cwd=ROOT)
    tail = [l for l in r.stdout.strip().splitlines() if l.strip()][-1:] or ['(no output)']
    print('   ' + tail[0])
    if r.returncode:
        fails.append(label)
        sys.stdout.write(r.stdout[-2500:])
        sys.stderr.write(r.stderr[-1500:])
print()
print('ALL CHECKS PASSED' if not fails else 'FAILED: ' + ', '.join(fails))
sys.exit(1 if fails else 0)
