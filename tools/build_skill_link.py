#!/usr/bin/env python3
"""Rebuild the gpuscale-link Claude skill from the live libraries.

Regenerates skill-link/data/libraries.json and skill-link/references/libraries.md
from data/*.js and assets/app.js (so the skill can never drift from the app),
then zips skill-link/ into gpuscale-link.skill at the repo root, which the
site footer links for download. Run after any library or version change:

    python3 tools/build_skill_link.py
"""
import json, os, re, subprocess, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKILL = os.path.join(ROOT, 'skill-link')
APP = open(os.path.join(ROOT, 'assets', 'app.js'), encoding='utf-8').read()

def node_eval(script):
    r = subprocess.run(['node', '-e', script], capture_output=True, text=True, cwd=ROOT)
    if r.returncode != 0:
        raise SystemExit('node eval failed: ' + r.stderr[:2000])
    return json.loads(r.stdout)

def slice_const(name):
    i = APP.index('const ' + name + ' = ')
    start = APP.index('=', i) + 1
    first_line = APP[i:APP.index('\n', i)]
    if first_line.rstrip().endswith('{'):          # multiline literal, ends at column-0 '};'
        return APP[start:APP.index('\n};', i) + 2]
    return APP[start:APP.index(';\n', i)]          # single-line literal

# GPUSCALE_DATA from the data files, verbatim
data = node_eval("""
  global.window = {};
  const fs=require('fs');
  for (const f of ['models','gpus','quants','usecases','support'])
    eval(fs.readFileSync('data/'+f+'.js','utf8'));
  console.log(JSON.stringify(window.GPUSCALE_DATA));
""")

# app.js constants (functions dropped by JSON.stringify)
consts = node_eval(f"""
  const fmtTok=x=>x, fmt=x=>x;
  const KV_QUANTS = {slice_const('KV_QUANTS')};
  const REASON_TOK = {slice_const('REASON_TOK')};
  const RESIL = {slice_const('RESIL')};
  const FIELDS = {slice_const('FIELDS')};
  console.log(JSON.stringify({{KV_QUANTS, REASON_TOK, RESIL, FIELDS}}));
""")

studio = re.search(r"STUDIO_VERSION = '([^']+)'", APP).group(1)
engine = int(re.search(r"ENGINE_VERSION = (\d+)", APP).group(1))

FIELD_MAP = {  # friendly spec key -> FIELDS id
    'residentSeq': 'inSeq', 'visibleOut': 'inOut', 'reasoningTokens': 'inReasonTok',
    'concurrentCalls': 'inConc', 'maxBatchPerReplica': 'inBatch', 'workers': 'inWorkers',
    'gpusPerWorker': 'inPerW', 'tensorParallel': 'inTp', 'prefillMFU': 'inMfu',
    'decodeMBU': 'inMbu', 'interconnectEff': 'inIc', 'frameworkOverheadMs': 'inOvh',
}
field_ranges = {}
for friendly, fid in FIELD_MAP.items():
    f = consts['FIELDS'][fid]
    field_ranges[friendly] = {'min': f['min'], 'max': f['max'], 'default': f['val']}

resilience = [{'key': k, 'code': v['code'], 'label': v['label'], 'long': v['long']}
              for k, v in consts['RESIL'].items()]

lib = {
    'models': data['models'], 'gpus': data['gpus'], 'quants': data['quants'],
    'cases': [c for c in data['cases'] if not c['name'].startswith('Custom')],
    'support': data['support'], 'meta': data['meta'],
    'kv_quants': consts['KV_QUANTS'], 'resilience': resilience,
    'reason_tokens': consts['REASON_TOK'], 'field_ranges': field_ranges,
    'versions': {'schema': 'gpuscale.net/5', 'engine': engine, 'studio': studio},
    'kv_policies': ['running', 'all'],
}
out = os.path.join(SKILL, 'data', 'libraries.json')
json.dump(lib, open(out, 'w'), indent=1, ensure_ascii=False)

# human-browsable reference tables
md = ['# GPUscale libraries (generated · library %s · engine v%s · studio %s)\n'
      % (data['meta']['library'], engine, studio)]
md.append('## Models (%d)\n' % len(lib['models']))
md += ['- %s · %sB total / %sB active · ctx %s · %s · %s' %
       (m['name'], m['params'], m['active'], m['ctx'], m.get('arch', ''), m.get('dev', ''))
       for m in lib['models']]
md.append('\n## GPUs (%d)\n' % len(lib['gpus']))
md += ['- %s · %s GB · %s TB/s · %s TFLOPS · %s W · %s' %
       (g['name'], g['vram'], g['bw'], g['tflops'], g['watts'], g.get('cls', ''))
       for g in lib['gpus']]
md.append('\n## Weight quants (%d)\n' % len(lib['quants']))
md += ['- %s · %s B/param · %s · %s' % (q['name'], q['bytes'], q['quality'], q['use'])
       for q in lib['quants']]
md.append('\n## KV quants\n')
md += ['- %s · %s B/element' % (q['name'], q['bytes']) for q in lib['kv_quants']]
md.append('\n## Workload presets (%d)\n' % len(lib['cases']))
for c in lib['cases']:
    extras = []
    if c.get('reasonTok'): extras.append('reasonTok %s' % c['reasonTok'])
    if c.get('policy') == 'all': extras.append('KV pinned per session')
    md.append('- %s · seq %s · out %s · reasoning %s · SLO %sms / %stps / %ss · supports %s%s'
              % (c['name'], c['resident'], c['visibleOut'], c['reasoning'],
                 c['ttftTarget'], c['tpsTarget'], c['p95Target'],
                 ','.join(c.get('supports', [])) or '-',
                 (' · ' + ' · '.join(extras)) if extras else ''))
md.append('\n## Resilience modes (%d)\n' % len(resilience))
md += ['- %s · %s · %s' % (r['key'], r['label'], r['long']) for r in resilience]
md.append('\n## Supporting models\n')
md += ['- %s · %s · %s GB/instance · cap %s%s' %
       (m['kind'], m['name'], m['vram'], m['cap'], ' · default' if m.get('default') else '')
       for m in lib['support']['models']]
open(os.path.join(SKILL, 'references', 'libraries.md'), 'w').write('\n'.join(md) + '\n')

# package: zip skill-link/ as gpuscale-link/ into gpuscale-link.skill
dest = os.path.join(ROOT, 'gpuscale-link.skill')
with zipfile.ZipFile(dest, 'w', zipfile.ZIP_DEFLATED) as z:
    for base, _, files in os.walk(SKILL):
        for fn in sorted(files):
            p = os.path.join(base, fn)
            arc = 'gpuscale-link/' + os.path.relpath(p, SKILL)
            z.write(p, arc)
print('wrote %s (%d models, %d gpus, %d presets, studio %s)'
      % (dest, len(lib['models']), len(lib['gpus']), len(lib['cases']), studio))
