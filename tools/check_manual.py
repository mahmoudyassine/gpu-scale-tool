#!/usr/bin/env python3
"""Re-derive every number the manual asserts from the code and the data files.

The manual quotes library counts, engine constants, tuning defaults, formulas and
a sixteen-line worked example. All of it can go stale silently, so none of it is
trusted: each claim is recomputed here and compared against the page.

    python3 tools/check_manual.py

Exits non-zero on any mismatch. Run it on every release, and after any change to
assets/app.js or data/.
"""
import json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANUAL = open(os.path.join(ROOT, 'manual.html'), encoding='utf-8').read()
APP = open(os.path.join(ROOT, 'assets', 'app.js'), encoding='utf-8').read()

# The engine is JavaScript, so the reference figures come from the engine itself
# rather than from a Python port that could drift away from it.
NODE = r'''
const fs=require('fs');global.window={GPUSCALE_DATA:{}};
const R=process.argv[1];
for(const f of ['models','gpus','quants','usecases','support'])
  new Function('window',fs.readFileSync(R+'/data/'+f+'.js','utf8'))(global.window);
const D=window.GPUSCALE_DATA;
const app=fs.readFileSync(R+'/assets/app.js','utf8');
const compute=new Function(app.slice(app.indexOf('/*ENGINE-START*/'),
                                     app.indexOf('/*ENGINE-END*/'))+'; return compute;')();
const m=D.models.find(x=>x.name==='Llama 3.3 70B Instruct');
const g=D.gpus.find(x=>x.name==='H200 141GB NVL');
const s={params:m.params,active:m.active,hidden:m.hidden,layers:m.layers,kvHeads:m.kvHeads,
 headDim:m.headDim,ctx:m.ctx,bytesW:1,bytesK:1,resident:8192,visibleOut:350,reasonTok:0,
 extend:true,concurrent:50,batch:50,policy:'running',workers:1,perW:8,tp:4,gpus:4,
 gpuVram:g.vram,gpuBw:g.bw,gpuTflops:g.tflops,mfu:0.5,mbu:0.65,ic:0.85,ovh:30,multiGb:15,
 sloTtft:800,sloTps:40,sloP95:50,cachePct:0};
const d=compute(s), d2=compute({...s,cachePct:0.5}),
      d3=compute({...s,reasonTok:1000});
const i=app.indexOf('const RESIL = {'), j=app.indexOf('\n};', i);
const RESIL=eval('('+app.slice(i+14,j+2)+')');
console.log(JSON.stringify({
 models:D.models.length, gpus:D.gpus.length,
 presets:D.cases.filter(c=>!/^Custom/.test(c.name)).length,
 support:D.support.models.length, quants:D.quants.length,
 resil:Object.keys(RESIL).length, lib:D.meta.library,
 gpu:{vram:g.vram,bw:g.bw,tf:g.tflops},
 d:{w:d.weights,kvtok:d.kvTok*1e6,kv:d.kvTotal,act:d.act,ovh:d.fixed+d.multi,tot:d.total,
    avail:d.avail,bw:d.bwEff,tps:d.tps,agg:d.agg,ttft:d.ttft,itl:d.itl,lat:d.latency,p95:d.p95},
 d2:{ttft:d2.ttft,kv:d2.kvTotal},
 d3:{gen:d3.genTok,tps:d3.tps,lat:d3.latency,p95:d3.p95}}));
'''

out = subprocess.run(['node', '-e', NODE, ROOT], capture_output=True, text=True)
if out.returncode:
    sys.stderr.write(out.stderr)
    sys.exit('could not read the engine')
D = json.loads(out.stdout)

ok = bad = 0
def chk(label, cond, detail=''):
    global ok, bad
    if cond:
        ok += 1
    else:
        bad += 1
        print(f'  MISMATCH  {label}  {detail}')

def has(t): return t in MANUAL

eng = re.search(r'ENGINE_VERSION = (\d+)', APP).group(1)
stu = re.search(r"STUDIO_VERSION = '([\d.]+)'", APP).group(1)
short = '.'.join(stu.split('.')[:2])

# ---- versions and library counts -----------------------------------------
chk(f'library {D["lib"]}',    has(f'Library {D["lib"]}'), D['lib'])
chk(f'engine v{eng}',         has(f'Engine v{eng}'))
chk(f'studio {short}',        has('Studio ' + short), stu)
# the chip must carry EXACTLY what the app renders at runtime, which is
# STUDIO_VERSION with a trailing ".0" stripped, not a hand-typed approximation
chip = 'v' + (stu[:-2] if stu.endswith('.0') else stu)
chk('header version chip',    has(f'>{chip}<'), f'expected {chip}')
chk('101 models',             has('101 models') and D['models'] == 101, D['models'])
chk('37 GPUs',                has('37 GPUs') and D['gpus'] == 37, D['gpus'])
chk('24 presets',             has('24 presets') and D['presets'] == 24, D['presets'])
chk('54 supporting models',   has('54 supporting models') and D['support'] == 54, D['support'])
chk('19 weight formats',      has('19 weight formats') and D['quants'] == 19, D['quants'])
chk('12 resilience patterns', has('12 patterns') and D['resil'] == 12, D['resil'])

# ---- constants the prose states ------------------------------------------
chk('MFU 0.50 default',    has('<td>0.50</td>') and 'val:0.5' in APP)
chk('MBU 0.65 default',    has('<td>0.65</td>'))
chk('IC 0.85 / 0.70 cap',  has('0.85') and has('0.70') and 'Math.min(s.ic,0.7)' in APP)
chk('overhead 30 ms',      has('<td>30 ms</td>'))
chk('fixed 5 GB',          has('fixed</span>  = 5') and 'const fixed = 5' in APP)
chk('multi 15 GB / 1.4',   has('15 GB per extra GPU') and has('1.4 for a MIG slice'))
chk('activation cap 8192', has('min(S_eff, 8192)') and 'Math.min(effSeq, 8192)' in APP)
chk('P95 = 1.3x',          has('1.3 × latency') and 'latency * 1.3' in APP)
chk('cache clamp 0.95',    has('clamp(f, 0, 0.95)') and 'Math.min(0.95' in APP)
chk('H200 141/4.8/989',    has('141 GB · 4.8 TB/s · 989 TF')
                           and (D['gpu']['vram'], D['gpu']['bw'], D['gpu']['tf']) == (141, 4.8, 989), D['gpu'])

# ---- formulas quoted against the engine source ---------------------------
chk('kv formula',    '2 * kvL * s.kvHeads * s.headDim * bk / 1e9' in APP
                     and has('2 × L × H_kv × d_head × b_kv / 1e9'))
chk('ttft formula',  '2 * prefillTok * s.active / (s.gpuTflops * s.tp * s.mfu)' in APP
                     and has('2 × prefill × P_act / (F × TP × η_mfu)'))
chk('bwEff formula', 's.gpuBw * s.tp * s.ic * s.mbu * 1000' in APP
                     and has('BW × TP × η_ic × η_mbu × 1000'))
chk('little law',    'users*turns*share*calls*dur/3600*burst' in APP.replace(' ', '')
                     and has('users × turns × share × calls × dur / 3600 × burst'))
chk('rec cap 6',     'out.slice(0,6)' in APP)

# ---- the worked example, line by line ------------------------------------
d = D['d']
for label, text, value, want, tol in [
    ('weights 70.00',   '<b>70.00 GB</b>',            d['w'],     70,      1e-9),
    ('kv/tok 163.84KB', '<b>163.84 KB</b>',           d['kvtok'], 163.84,  0.01),
    ('kv total 67.11',  '<b>67.11 GB</b>',            d['kv'],    67.11,   0.01),
    ('act 0.81',        '<b>0.81 GB</b>',             d['act'],   0.81,    0.01),
    ('overhead 50.00',  '<b>50.00 GB</b>',            d['ovh'],   50,      1e-9),
    ('total 187.91',    '<b>187.91 GB</b>',           d['tot'],   187.91,  0.01),
    ('avail 564',       '<b>564 GB → fits, 33%</b>',  d['avail'], 564,     1e-9),
    ('bw_eff 10,608',   '<b>10,608 GB/s</b>',         d['bw'],    10608,   1),
    ('tps 77.4',        '<b>77.4 tok/s</b>',          d['tps'],   77.4,    0.05),
    ('agg 3,868',       '<b>3,868 tok/s</b>',         d['agg'],   3868,    1),
    ('ttft 580',        '<b>580 ms</b>',              d['ttft'],  580,     0.5),
    ('itl 12.9',        '<b>12.9 ms</b>',             d['itl'],   12.9,    0.05),
    ('latency 5.13',    '<b>5.13 s</b>',              d['lat'],   5.13,    0.01),
    ('p95 6.67',        '<b>6.67 s</b>',              d['p95'],   6.67,    0.01),
    ('cached ttft 290', '<b>290 ms</b>',       D['d2']['ttft'],   290,     1),
    ('cached kv 34.2',  '<b>34.2 GB</b>',      D['d2']['kv'],     34.2,    0.05),
]:
    chk(label, has(text) and abs(value - want) <= tol, f'engine says {value}')

# the reasoning aside, which is easy to get wrong because the extra tokens also
# extend the KV cache and therefore slow decode
chk('reasoning aside 1,350 tok', has('1,350 tokens') and D['d3']['gen'] == 1350, D['d3']['gen'])
chk('reasoning aside 73.0 tok/s', has('73.0 tok/s') and abs(D['d3']['tps'] - 73.0) < 0.05, D['d3']['tps'])
chk('reasoning aside 19.1 s',     has('19.1 s') and abs(D['d3']['lat'] - 19.1) < 0.05, D['d3']['lat'])
chk('reasoning aside 24.8 s',     has('24.8 s') and abs(D['d3']['p95'] - 24.8) < 0.05, D['d3']['p95'])

# ---- figures exist --------------------------------------------------------
missing = [src for src in re.findall(r'<img src="([^"]+)"', MANUAL)
           if not os.path.exists(os.path.join(ROOT, src))]
chk('every figure present', not missing, missing)

print(f'\n{ok} checks passed, {bad} mismatched')
sys.exit(1 if bad else 0)
