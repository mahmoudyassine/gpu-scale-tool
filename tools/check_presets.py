#!/usr/bin/env python3
"""Check every workload preset against the rules in docs/PRACTICES.md.

    python3 tools/check_presets.py        # exits non-zero on any violation

Rule 1 (hard): p95Target >= 1.3 x (ttft/1000 + (reasonTok + visibleOut)/tps).
               A preset may not demand a P95 its own targets make impossible.
Rule 2 (hard): resident + reasoning must fit some model's context; targets and
               token counts must be non-negative and within the field ranges.
Rule 3 (soft): the tok/s target should sit in the band its class implies.
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def load(name):
    rows = []
    for line in open(os.path.join(ROOT, 'data', name), encoding='utf-8'):
        line = line.strip().rstrip(',')
        if line.startswith('{'):
            rows.append(json.loads(line))
    return rows

REASON_TOK = {'None': 0, 'Light reasoning': 2000, 'Heavy reasoning': 8000, 'Custom': 2000}
cases = load('usecases.js')
fail, warn = [], []

MODELS_BY_NAME = {}
REF_GPU = {'name': 'H200 141GB NVL', 'tflops': 989, 'bw': 4.8}
try:
    import re as _re
    _src = open(os.path.join(ROOT, 'data', 'models.js'), encoding='utf-8').read() \
        if 'ROOT' in dir() else open('data/models.js', encoding='utf-8').read()
    for _line in _src.splitlines():
        _line = _line.strip().rstrip(',')
        if _line.startswith('{') and '"name"' in _line:
            try:
                _m = json.loads(_line)
                MODELS_BY_NAME[_m['name']] = _m
            except Exception:
                pass
except Exception:
    pass

def ttft_target_or_inf(c):
    return c['ttftTarget'] if c.get('ttftTarget') else float('inf')

for c in cases:
    n = c['name']
    if n.startswith('Custom'):
        continue
    out = c.get('visibleOut', 0)
    rt = c.get('reasonTok')
    if rt is None:
        rt = REASON_TOK.get(c.get('reasoning', 'None'), 0)
    ttft, tps, p95 = c['ttftTarget'], c['tpsTarget'], c['p95Target']

    # rule 1
    if tps > 0 and p95 > 0:
        need = 1.3 * (ttft / 1000 + (rt + out) / tps)
        if need > p95 + 1e-9:
            fail.append(f'{n}: p95 {p95}s is impossible; its own targets need {need:.1f}s')

    # rule 2
    for field, v in (('resident', c['resident']), ('visibleOut', out),
                     ('reasonTok', rt), ('ttftTarget', ttft),
                     ('tpsTarget', tps), ('p95Target', p95)):
        if v < 0:
            fail.append(f'{n}: {field} is negative ({v})')
    if c['resident'] + rt > 1048576:
        fail.append(f'{n}: resident + reasoning exceeds the largest context in the library')
    # a hit rate is a fact about the serving stack, not about the workload class
    cache = c.get('cachePct', 0)
    if not isinstance(cache, (int, float)) or cache < 0 or cache > 95:
        fail.append(f'{n}: cachePct {cache!r} is outside 0-95 (the engine clamps at 95)')
    elif cache > 0:
        warn.append(f'{n}: ships a {cache}% shared-prefix default, so it sizes for '
                    'prefix caching being enabled; every stock preset leaves this at 0')
    # A suggested model is a recommendation the tool makes, so it has to be one
    # that can actually keep the preset's own promises. Checked on a reference
    # H200 at TP8: if the pick cannot hit the preset's TTFT or tok/s target even
    # at batch 1 there, selecting the preset would immediately show red.
    mdl = c.get('model')
    if mdl is not None:
        m = MODELS_BY_NAME.get(mdl)
        if m is None:
            fail.append(f'{n}: suggested model "{mdl}" is not in the library')
        else:
            eff = c['resident'] + (rt if c.get('extend', True) else 0)
            if eff > m['ctx']:
                fail.append(f'{n}: suggested model {mdl} has a {m["ctx"]:,}-token context, '
                            f'below the preset\'s {eff:,}-token working set')
            TP, MFU, MBU, IC = 8, 0.5, 0.65, 0.85
            ttft = 2 * c['resident'] * m['active'] / (REF_GPU['tflops'] * TP * MFU)
            if ttft > ttft_target_or_inf(c):
                fail.append(f'{n}: suggested model {mdl} needs {ttft:.0f} ms to prefill '
                            f'{c["resident"]:,} tokens at TP8 on {REF_GPU["name"]}, above the '
                            f'preset\'s own {c["ttftTarget"]} ms target')
            kv_layers = max(1, m.get('kvLayers') or m['layers'])
            kv_tok = 2 * kv_layers * m['kvHeads'] * m['headDim'] * 1 / 1e9   # FP8 KV
            bw_eff = REF_GPU['bw'] * TP * IC * MBU * 1000
            best = bw_eff / (m['active'] * 1 + eff * kv_tok)                 # FP8 weights, batch 1
            if tps and best < tps:
                fail.append(f'{n}: suggested model {mdl} tops out at {best:.0f} tok/s at TP8 on '
                            f'{REF_GPU["name"]}, below the preset\'s own {tps} tok/s target')

    # a declared session shape must reproduce the preset's own resident figure,
    # or one of the two numbers is wrong and the tool would contradict itself
    sess = c.get('session')
    if sess is not None:
        miss = [k for k in ('min', 'tokMin', 'base') if k not in sess]
        if miss:
            fail.append(f'{n}: session is missing {", ".join(miss)}')
        else:
            for k in ('min', 'tokMin', 'base'):
                if not isinstance(sess[k], (int, float)) or sess[k] < 0:
                    fail.append(f'{n}: session.{k} is {sess[k]!r}, must be a non-negative number')
            if sess.get('min', 0) > 240:
                fail.append(f'{n}: session.min {sess["min"]} exceeds the 240-minute cap')
            implied = sess.get('base', 0) + sess.get('tokMin', 0) * sess.get('min', 0)
            if c['resident'] and abs(implied - c['resident']) > 0.02 * c['resident']:
                fail.append(f'{n}: session shape implies {implied:,.0f} resident tokens '
                            f'but the preset says {c["resident"]:,} '
                            f'({(implied / c["resident"] - 1) * 100:+.1f}%)')
        if c.get('policy') != 'all':
            warn.append(f'{n}: declares a session shape but frees KV between turns, '
                        'so the call length matters much less than it would if KV were pinned')
    elif c.get('policy') == 'all':
        warn.append(f'{n}: pins KV for the whole session but declares no session shape, '
                    'so its resident figure cannot be traced to a call length')
    for k in c.get('supports', []):
        if k not in {'embed', 'rerank', 'asr', 'tts', 'ocr', 'guard'}:
            fail.append(f'{n}: unknown support kind "{k}"')
    tr = c.get('traffic')
    if tr and not tr.get('direct'):
        for k in ('turns', 'calls', 'burst'):
            if k not in tr:
                fail.append(f'{n}: traffic missing "{k}"')

    # rule 3 (advisory bands from docs/PRACTICES.md)
    if c.get('policy') == 'all' or (tr or {}).get('direct') and p95 and p95 <= 6:
        if tps and tps < 30:
            warn.append(f'{n}: live path at {tps} tok/s, convention is >= 30')
    elif rt > 0 and p95 >= 55:
        pass                      # machine-paced, any speed defensible
    elif tps and tps < 12:
        warn.append(f'{n}: {tps} tok/s is below the 12.5 tok/s RAG-chat floor')

print(f'{len(cases)-1} presets checked')
for w in warn:
    print('  WARN', w)
for f in fail:
    print('  FAIL', f)
print('OK' if not fail else f'{len(fail)} FAILURES')
sys.exit(1 if fail else 0)
