#!/usr/bin/env python3
"""Rebuild the gpu-sizing Claude skill (skill/sizing.mjs) from the live app.

The CLI previously drifted three libraries and one engine version behind the
studio and over-stated KV by up to 6x for sliding-window models, because it was
generated once and nothing rebuilt it. This generator embeds the ENGINE block
and solvePool VERBATIM from assets/app.js and the data listings verbatim from
data/*.js, so the skill's numbers are the studio's numbers by construction.

    python3 tools/build_skill.py        # run on every release

Also patches the version/count lines in skill/SKILL.md and skill/reference.md.
"""
import json, os, re, subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
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
    if first_line.rstrip().endswith('{'):
        return APP[start:APP.index('\n};', i) + 2]
    return APP[start:APP.index(';\n', i)]

def slice_function(name):
    """The function's full text via brace matching (template ${} braces balance)."""
    i = APP.index('function %s(' % name)
    j = APP.index('{', i)
    depth = 0
    for k in range(j, len(APP)):
        if APP[k] == '{': depth += 1
        elif APP[k] == '}':
            depth -= 1
            if depth == 0:
                return APP[i:k+1]
    raise SystemExit('unbalanced braces in ' + name)

data = node_eval("""
  global.window = {};
  const fs=require('fs');
  for (const f of ['models','gpus','quants','usecases'])
    eval(fs.readFileSync('data/'+f+'.js','utf8'));
  console.log(JSON.stringify(window.GPUSCALE_DATA));
""")
consts = node_eval(f"""
  const fmtTok=x=>x, fmt=x=>x;
  const FIELDS = {slice_const('FIELDS')};
  console.log(JSON.stringify({{FIELDS}}));
""")
F = consts['FIELDS']
studio = re.search(r"STUDIO_VERSION = '([^']+)'", APP).group(1)
engine = int(re.search(r"ENGINE_VERSION = (\d+)", APP).group(1))
library = data['meta']['library']
updated = data['meta'].get('updated', '')

ENGINE = APP[APP.index('/*ENGINE-START*/'):APP.index('/*ENGINE-END*/') + len('/*ENGINE-END*/')]
SOLVE = slice_function('solvePool')

jline = lambda arr: ',\n'.join(json.dumps(x, ensure_ascii=False) for x in arr)
defaults = {k: F['in'+k.capitalize()]['val'] for k in ('mfu', 'mbu', 'ic', 'ovh')}
batch_max = F['inBatch']['max']

cli = r'''
/* ---- helpers ---- */
const fmt = x => !isFinite(x) ? '-' : Math.abs(x)>=1000 ? Math.round(x).toLocaleString('en-US') : Math.abs(x)>=100 ? x.toFixed(0) : Math.abs(x)>=10 ? x.toFixed(1) : x.toFixed(2).replace(/\.00$/,'');
const fmtTok = x => x>=1048576 ? (x/1048576)+'M' : x>=1024 ? Math.round(x/1024)+'K' : String(x);
const findBy = (arr, q) => arr.find(x=>x.name.toLowerCase()===q.toLowerCase()) || arr.find(x=>x.name.toLowerCase().includes(q.toLowerCase()));

/* ---- shims so the studio's solvePool runs verbatim outside the page ----
   UC.length 1 keeps the MIG-sliced branch off (the CLI sizes one dedicated
   pool); $('autoUtil') carries the --target value; the slice helpers are only
   reachable from that gated branch. */
let __target = 80;
const $ = id => id==='autoUtil' ? {value:__target} : null;
const UC = {length:1};
const sliceProfiles = () => [];
const allocSupports = () => ({layout:[]});
const binCap = () => 8;
const sliceCost = (p,u) => u;

function makeState(o){
  const m = o.model, g = o.gpu;
  return {
    model:m, gpu:g, wq:o.wq, kq:o.kq,
    params:m.params, active:m.active, hidden:m.hidden, layers:m.layers,
    kvHeads:m.kvHeads, headDim:m.headDim, ctx:m.ctx,
    kvGlobal:m.kvGlobal, kvWin:m.kvWin, kvgHeads:m.kvgHeads, kvgDim:m.kvgDim,
    kvgKeyOnly:m.kvgKeyOnly, kvLayers:m.kvLayers,
    bytesW:o.wq.bytes, bytesK:o.kq.bytes,
    resident:o.resident, visibleOut:o.visibleOut, reasonTok:o.reasonTok, extend:o.extend!==false,
    cachePct:o.cachePct??0,
    concurrent:o.concurrent, batch:o.batch, policy:o.policy||'running',
    workers:o.workers, perW:o.perW, gpus:o.gpus??(o.workers*o.perW), tp:Math.min(o.tp, o.gpus??(o.workers*o.perW)),
    gpuVram:g.vram, gpuBw:g.bw, gpuTflops:g.tflops,
    mfu:o.mfu??DEFAULTS.mfu, mbu:o.mbu??DEFAULTS.mbu,
    ic:o.ic??((o.tp||1)>o.perW? Math.min(DEFAULTS.ic,0.7) : DEFAULTS.ic), ovh:o.ovh??DEFAULTS.ovh,
    sloTtft:o.sloTtft??0, sloTps:o.sloTps??0, sloP95:o.sloP95??0,
  };
}

/* the studio auto-sizer, not a port of it: solvePool above IS the studio's */
function autoSolve(o){
  __target = Math.min(95, Math.max(50, o.target??80));
  const s0 = makeState({...o, workers:1, tp:1, batch:o.batch??64});
  const r = solvePool(s0);
  if(!r.ok) return {error:r.reason};
  const ic = r.tp>o.perW ? Math.min(s0.ic,0.7) : s0.ic;
  const s = makeState({...o, workers:r.workers, tp:r.tp, batch:r.batch, gpus:r.cards, ic});
  return {tp:r.tp, workers:r.workers, cards:r.cards, batch:r.batch,
    widened:!!r.widened, sloStuck:r.sloStuck||null, d:compute(s), s};
}

function story(s,d){
  const m=s.model, g=s.gpu, L=[];
  const minGpus=Math.ceil((d.weights+d.act)/s.gpuVram);
  L.push(`One copy of ${m.name} at ${s.wq.name} weighs ${fmt(d.weights)} GB (${fmt(s.params)}B params x ${s.bytesW} B). A ${g.name} holds ${fmt(s.gpuVram)} GB, so one copy needs at least ${minGpus} GPU(s); it is sliced across TP${s.tp} (${fmt(s.tp*s.gpuVram)} GB per group).`);
  if(d.replicas>1) L.push(`Serving ${s.concurrent} concurrent calls at batch ${s.batch} takes ${d.replicas} full copies: ${d.replicas} x TP${s.tp} = ${d.servingGpus} serving GPUs${d.queued>0?` (${d.queued} calls queue at peak)`:''}. The model alone needed ${minGpus}; the rest serve concurrency.`);
  else L.push(`One copy serves everything: batch ${s.batch} admits ${d.active} of ${s.concurrent} calls${d.queued>0?`, ${d.queued} queue`:''}.`);
  const hyb=(s.kvGlobal>0&&s.kvWin>0);
  L.push(`KV cache: ${(d.kvTok*1e6).toFixed(1)} KB/token at ${s.kq.name}${hyb?` (hybrid attention: ${s.kvGlobal} of ${s.kvLayers||s.layers} layers hold the full context, the rest a ${fmtTok(s.kvWin)}-token window, so the per-token cost falls as context grows)`:''}; ${fmt(d.effSeq*d.kvTok)} GB per admitted ${fmtTok(d.effSeq)}-token conversation; ${fmt(d.kvTotal)} GB total across ${d.active} admitted.`);
  L.push(`Envelope: TTFT ~${fmt(d.ttft)} ms, ~${fmt(d.tps)} tok/s per user, aggregate ~${fmt(d.agg)} tok/s, mean latency ${fmt(d.latency)} s (P95 ~${fmt(d.p95)} s).`);
  return L;
}

function report(s,d,resil,sol,o0){
  o0 = o0 || {};
  const info=RESIL[resil||'n']||RESIL.n;
  const servW=Math.max(1,Math.ceil(d.servingGpus/s.perW));
  const resilW=info.mult(servW)+info.add;
  const procW=servW+resilW, procG=procW*s.perW;
  const out={
    fits:d.fits, utilizationPct:+(d.total/d.avail*100).toFixed(1),
    memory:{ totalGB:+d.total.toFixed(1), availGB:d.avail, weightsPerReplicaGB:+d.weights.toFixed(1),
      weightsAllGB:+d.weightsAll.toFixed(1), kvTotalGB:+d.kvTotal.toFixed(1), replicas:d.replicas,
      kvPerTokenKB:+(d.kvTok*1e6).toFixed(2), headroomGB:+d.headroom.toFixed(1),
      sharedPrefixPct:+(Math.min(0.95,Math.max(0,s.cachePct||0))*100).toFixed(0),
      residentFromCall: o0.session? `${o0.session.mins} min x ${o0.session.tokMin||o0.session.rate} tok/min + ${o0.session.base} base (${o0.session.basis})` : undefined,
      cachedPrefixTok:d.cachedTok, uniqueSeqTok:d.uniqueSeq,
      kvSharedPerReplicaGB:+d.kvShared.toFixed(2) },
    fleet:{ servingCards:d.servingGpus, nodes:servW, gpusPerNode:s.perW, tp:s.tp,
      batchPerReplica:s.batch, admitted:d.active, queued:d.queued },
    performance:{ ttftMs:+d.ttft.toFixed(1), prefilledTok:d.prefillTok, perUserTps:+d.tps.toFixed(1), aggregateTps:+d.agg.toFixed(0),
      meanLatencyS:+d.latency.toFixed(2), p95S:+d.p95.toFixed(2) },
    slo:{ ttft:s.sloTtft? (d.slo.ttft.pass?'PASS':'FAIL'):'off', tps:s.sloTps? (d.slo.tps.pass?'PASS':'FAIL'):'off',
      p95:s.sloP95? (d.slo.p95.pass?'PASS':'FAIL'):'off' },
    resilience:{ model:info.long, procuredNodes:procW, procuredGpus:procG, powerKwTdp:+(procG*s.gpu.watts/1000).toFixed(1),
      degradedOnSiteLoss:!!info.degraded },
    story: story(s,d),
    caveat:'Peak estimates; production typically achieves 70-90%. Validate with vLLM bench / GenAI-Perf. Interactive studio: https://gpuscale.net',
  };
  if(sol&&sol.sloStuck) out.sloStuck=sol.sloStuck+' target not achievable at this concurrency on this hardware';
  return out;
}

/* ---- CLI ---- */
const args={}; const argv=process.argv.slice(2);
for(let i=0;i<argv.length;i++){ const a=argv[i];
  if(a.startsWith('--')){ const k=a.slice(2); const v=(argv[i+1]&&!argv[i+1].startsWith('--'))?argv[++i]:true; args[k]=v; } }

if(args['list-models']){ MODELS.forEach(m=>console.log(`${m.name}  · ${m.params}B total / ${m.active}B active · ctx ${fmtTok(m.ctx)} · ${m.arch}`)); process.exit(0); }
if(args['list-gpus']){ GPUS.forEach(g=>console.log(`${g.name}  · ${g.vram} GB · ${g.bw} TB/s · ${g.tflops} dense FP16 TF · ${g.watts} W`)); process.exit(0); }
if(args['list-workloads']){ CASES.forEach(c=>console.log(`${c.name}  · ctx ${fmtTok(c.resident||0)} · out ${c.visibleOut} · reasoning ${c.reasoning}${c.reasonTok?' ('+c.reasonTok+' tok)':''} · SLO ${c.ttftTarget}ms/${c.tpsTarget}tps/${c.p95Target}s${c.policy==='all'?' · KV pinned per session':''}`)); process.exit(0); }
if(args.help||Object.keys(args).length===0){
  console.log(`GPUscale sizing CLI (engine v${META.engine}, library ${META.library}, studio ${META.studio})
Usage:
  sizing.mjs --model "DeepSeek-V3" --gpu B300 --quant FP8 [--kv FP8]
             (--workload "Internal GPT" | --resident 16384 --out 800 --reasoning 0)
             --concurrent 377 [--auto [--target 80] | --workers 3 --tp 4 --batch 63]
             [--ttft ms --tps tokps --p95 s] [--policy running|all] [--cache pct]
             [--call-minutes m [--tok-min r --prompt-tok t --basis peak|mean]]
             [--perw 8] [--resilience n|n1|n2|nn|dr|drh|aa|aas|aas1|aass|aan1|nndr] [--json]
  sizing.mjs --list-models | --list-gpus | --list-workloads`);
  process.exit(0);
}

const model=findBy(MODELS, String(args.model||''));
if(!model){ console.error('Unknown model. Try --list-models'); process.exit(1); }
const gpu=findBy(GPUS, String(args.gpu||'H100 80GB SXM'));
if(!gpu){ console.error('Unknown GPU. Try --list-gpus'); process.exit(1); }
const wq=QUANTS.find(q=>q.name.toLowerCase()===String(args.quant||'FP8').toLowerCase())||QUANTS.find(q=>q.name==='FP8');
const kq=KV_QUANTS.find(q=>q.name.toLowerCase()===String(args.kv||'FP8').toLowerCase())||KV_QUANTS.find(q=>q.name==='FP8');

let wl={resident:4096, visibleOut:400, reasonTok:0, sloTtft:0, sloTps:0, sloP95:0, policy:'running', cachePct:0};
if(args.workload){
  const c=CASES.find(x=>x.name.toLowerCase().includes(String(args.workload).toLowerCase()));
  if(c) wl={resident:c.resident||4096, visibleOut:c.visibleOut||400,
            reasonTok:c.reasonTok!=null? c.reasonTok : (REASON_TOK[c.reasoning]||0),
            sloTtft:c.ttftTarget||0, sloTps:c.tpsTarget||0, sloP95:c.p95Target||0,
            policy:c.policy==='all'?'all':'running', cachePct:(c.cachePct||0)/100};
}
if(args.resident) wl.resident=+args.resident;
if(args.out) wl.visibleOut=+args.out;
if(args.reasoning) wl.reasonTok=+args.reasoning;
if(args.ttft) wl.sloTtft=+args.ttft;
if(args.tps) wl.sloTps=+args.tps;
if(args.p95) wl.sloP95=+args.p95;
if(args.policy) wl.policy=String(args.policy)==='all'?'all':'running';
// share of the resident sequence that is byte-identical on every call and so is
// prefilled once and held once per replica. Default 0: size for a full prefill
// unless the caller states a measured hit rate.
if(args.cache!=null&&args.cache!==true) wl.cachePct=Math.min(0.95,Math.max(0,+args.cache/100||0));
/* --call-minutes: a conversation holds its transcript, so the resident sequence
   grows with the length of the call. Presets that describe a session carry the
   shape their own resident figure was built from, so stating the length alone is
   enough. Matters most when KV is pinned per session. */
if(args['call-minutes']!=null&&args['call-minutes']!==true){
  const mins=Math.min(240,Math.max(0,+args['call-minutes']||0));
  const sh=(args.workload&&CASES.find(x=>x.name.toLowerCase().includes(String(args.workload).toLowerCase()))||{}).session;
  const rate=args['tok-min']!=null? Math.max(0,+args['tok-min']||0) : (sh? sh.tokMin : 200);
  const base=args['prompt-tok']!=null? Math.max(0,+args['prompt-tok']||0) : (sh? sh.base : Math.max(0,wl.resident-1000));
  const half=/^(mean|avg)/i.test(String(args.basis||''));
  if(mins>0&&rate>0){ wl.resident=Math.round(base+rate*mins/(half?2:1)); wl.session={mins,rate,base,basis:half?'mean':'peak'}; }
}

const base={ model, gpu, wq, kq, ...wl, concurrent:+(args.concurrent||64), perW:+(args.perw||8), extend:true };

let s,d,sol=null;
if(args.auto || !(args.workers&&args.tp)){
  sol=autoSolve({...base, target:+(args.target||80)});
  if(sol.error){ console.error(sol.error); process.exit(2); }
  s=sol.s; d=sol.d;
} else {
  s=makeState({...base, workers:+args.workers, tp:+args.tp, batch:+(args.batch||4)});
  d=compute(s);
}
const rep=report(s,d,String(args.resilience||'n'),sol,wl);
if(args.json){ console.log(JSON.stringify(rep,null,2)); }
else {
  console.log(`\n=== ${model.name} · ${wq.name} weights / ${kq.name} KV · ${gpu.name} ===`);
  console.log(`${rep.fits?'FITS':'DOES NOT FIT'} · ${rep.utilizationPct}% of serving memory · ${rep.fleet.servingCards} serving GPUs on ${rep.fleet.nodes} node(s) · ${rep.memory.replicas} replicas x TP${rep.fleet.tp} · batch ${rep.fleet.batchPerReplica}`);
  console.log(`admitted ${rep.fleet.admitted}/${s.concurrent}${rep.fleet.queued?` (queued ${rep.fleet.queued})`:''} · TTFT ${rep.performance.ttftMs} ms · ${rep.performance.perUserTps} tok/s/user · P95 ${rep.performance.p95S} s`);
  console.log(`SLO: TTFT ${rep.slo.ttft} · TPS ${rep.slo.tps} · P95 ${rep.slo.p95}${rep.sloStuck?` · NOTE: ${rep.sloStuck}`:''}`);
  console.log(`resilience ${rep.resilience.model}: ${rep.resilience.procuredNodes} nodes · ${rep.resilience.procuredGpus} GPUs · ~${rep.resilience.powerKwTdp} kW TDP`);
  console.log('');
  rep.story.forEach(p=>console.log('· '+p));
  console.log('\n'+rep.caveat);
}
'''

out = []
out.append('#!/usr/bin/env node')
out.append('// GPUscale sizing CLI · GENERATED by tools/build_skill.py — do not edit by hand')
out.append('// engine v%d · library %s · studio %s · same math and libraries as https://gpuscale.net · MIT'
           % (engine, library, studio))
out.append("'use strict';\n")
out.append('const META = ' + json.dumps({'library': library, 'engine': engine,
           'studio': studio, 'updated': updated}) + ';')
out.append('const MODELS = [\n' + jline(data['models']) + '\n];')
out.append('const GPUS = [\n' + jline(data['gpus']) + '\n];')
out.append('const QUANTS = [\n' + jline(data['quants']) + '\n];')
out.append('const CASES = [\n' + jline([c for c in data['cases'] if not c['name'].startswith('Custom')]) + '\n];')
out.append('const KV_QUANTS = ' + slice_const('KV_QUANTS').strip() + ';')
out.append('const REASON_TOK = ' + slice_const('REASON_TOK').strip() + ';')
out.append('const RESIL = ' + slice_const('RESIL').strip().rstrip(';') + ';')
out.append('const DEFAULTS = ' + json.dumps(defaults) + ';')
out.append('const FIELDS = {inBatch:{max:%d}};   // the one field solvePool reads' % batch_max)
out.append('')
out.append(ENGINE)
out.append('')
out.append('/* ---- the studio solver, verbatim ---- */')
out.append(SOLVE)
out.append(cli)

dest = os.path.join(ROOT, 'skill', 'sizing.mjs')
open(dest, 'w', encoding='utf-8').write('\n'.join(out) + '\n')

# parse check + a smoke invocation
subprocess.run(['node', '--check', dest], check=True)
r = subprocess.run(['node', dest, '--list-models'], capture_output=True, text=True)
n_models = len([l for l in r.stdout.splitlines() if l.strip()])
assert n_models == len(data['models']), (n_models, len(data['models']))

# keep the docs' version/count lines true
skill_md = os.path.join(ROOT, 'skill', 'SKILL.md')
sm = open(skill_md, encoding='utf-8').read()
sm = re.sub(r'\(engine v\d+, library v\d+: \d+\s*\nmodels, \d+ GPUs\)',
            '(engine v%d, library %s: %d\nmodels, %d GPUs)' % (engine, library, len(data['models']), len(data['gpus'])), sm)
sm = re.sub(r'\(engine v\d+, library v\d+: \d+ models, \d+ GPUs\)',
            '(engine v%d, library %s: %d models, %d GPUs)' % (engine, library, len(data['models']), len(data['gpus'])), sm)
open(skill_md, 'w', encoding='utf-8').write(sm)
ref_md = os.path.join(ROOT, 'skill', 'reference.md')
rm = open(ref_md, encoding='utf-8').read()
rm = re.sub(r'## Closed forms \(engine v\d+\)', '## Closed forms (engine v%d)' % engine, rm)
# idempotent: this ran unconditionally on every build and stacked one more copy
# of the note each release (twelve of them by 5.26.0)
_kv = '- KV_per_token = 2 x layers x kv_heads_eff x head_dim_eff x bytes_KV'
_note = ('  (sliding-window hybrids: kvGlobal layers pay the full context, the other\n'
         '  layers only a kvWin-token window, so the per-token cost falls with context)')
if _note not in rm:
    rm = rm.replace(_kv, _kv + '\n' + _note)
rm = re.sub(r'MFU 0\.\d+, MBU 0\.\d+', 'MFU %s, MBU %s' % (defaults['mfu'], defaults['mbu']), rm)
open(ref_md, 'w', encoding='utf-8').write(rm)

print('wrote %s (engine v%d, library %s, %d models, %d gpus, studio %s)'
      % (dest, engine, library, len(data['models']), len(data['gpus']), studio))
