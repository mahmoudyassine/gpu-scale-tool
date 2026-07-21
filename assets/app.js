'use strict';
/* ================= DATA ================= */
const DATA = window.GPUSCALE_DATA || {};
const MODELS = DATA.models||[], GPUS = DATA.gpus||[], QUANTS = DATA.quants||[], CASES = DATA.cases||[];
const SUPPORT = DATA.support||{kinds:[],models:[]};
if(!MODELS.length || !GPUS.length || !QUANTS.length || !CASES.length){
  document.body.innerHTML = '<div style="font-family:system-ui,sans-serif;max-width:560px;margin:80px auto;padding:0 20px;line-height:1.65;color:#1A2536"><h2 style="margin-bottom:10px">Data files not loaded</h2><p>GPUscale.net could not find its library. Keep <code>index.html</code> together with the <code>data/</code> and <code>assets/</code> folders: the four files <code>data/models.js</code>, <code>data/gpus.js</code>, <code>data/quants.js</code> and <code>data/usecases.js</code> must sit next to this page.</p><p>If you need one portable file instead, use <code>dist/gpuscale_standalone.html</code> or rebuild it with <code>python3 tools/build_single_file.py</code>.</p></div>';
  throw new Error('GPUscale.net data missing');
}
const STUDIO_VERSION = '5.4.0', ENGINE_VERSION = 23;
const PROJ_ID = (()=>{ const L='abcdefghjkmnpqrstuvwxyz', D='0123456789';
  const pick=s=>s[Math.floor(Math.random()*s.length)];
  return 'Project_'+pick(L)+pick(L)+pick(D)+pick(D)+pick(D); })();
function projName(){ const v=($('scenarioName')&&$('scenarioName').value||'').trim(); return v||PROJ_ID; }
const scenName=projName; // legacy alias
/* UX mode: normal (curated minimum) vs advanced (everything). Persisted locally only. */
function setUxMode(m){
  document.documentElement.dataset.uxMode = m==='normal'?'normal':'advanced';
  try{ localStorage.setItem('gpuscale-mode', document.documentElement.dataset.uxMode); }catch(e){}
  const seg=document.getElementById('modeSeg');
  if(seg) seg.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed', b.dataset.mode===document.documentElement.dataset.uxMode?'true':'false'));
}
const KV_QUANTS = [{name:'BF16',bytes:2},{name:'FP16',bytes:2},{name:'FP8',bytes:1},{name:'INT8',bytes:1},{name:'INT4',bytes:0.5}];
const REASON_TOK = {'None':0,'Light reasoning':2000,'Heavy reasoning':8000,'Custom':2000};
/* extraW = mult(n) + add. mult scales per pool (mirrors and DR sites must hold
   every pool's own model copies); add is a fixed count of idle spare nodes,
   procured ONCE per project: hardware is uniform, so one spare covers a node
   failure in any pool. */
const RESIL = {
  n:   {code:0, label:'N',       long:'N · capacity only',                              mult:n=>0,              add:0, live:n=>n},
  n1:  {code:1, label:'N+1',     long:'N+1 · one standby worker',                       mult:n=>0,              add:1, live:n=>n},
  n2:  {code:7, label:'N+2',     long:'N+2 · two standby workers',                      mult:n=>0,              add:2, live:n=>n},
  nn:  {code:2, label:'N+N',     long:'N+N · in-site mirror (2N)',                      mult:n=>n,              add:0, live:n=>n},
  dr:  {code:3, label:'DR',      long:'DR · full standby site (active/passive)',        mult:n=>n,              add:0, live:n=>n},
  drh: {code:8, label:'DR ½',    long:'DR · half-size standby site (1.5N)',             mult:n=>Math.ceil(n/2), add:0, live:n=>n, degraded:true},
  aas: {code:9, label:'A/A ½+½', long:'Active/Active split · N across two sites (1x)',  mult:n=>0,              add:0, live:n=>n, degraded:true},
  aas1:{code:11,label:'A/A ½+½ +1',long:'Active/Active split · N across two sites + one spare (N+1)', mult:n=>0, add:1, live:n=>n, degraded:true},
  aass:{code:10,label:'A/A ½+½ +1/site',long:'Active/Active split · N across two sites + spare per site (N+2)', mult:n=>0, add:2, live:n=>n, degraded:true},
  aa:  {code:5, label:'A/A',     long:'Active/Active · two live sites (2N)',            mult:n=>n,              add:0, live:n=>2*n},
  aan1:{code:6, label:'A/A N+1', long:'Active/Active · N+1 in each of two sites (2N+2)',mult:n=>n,              add:2, live:n=>2*n},
  nndr:{code:4, label:'N+N+DR',  long:'N+N + DR · active/active twin sites (4N)',       mult:n=>3*n,            add:0, live:n=>2*n},
};
Object.values(RESIL).forEach(r=>{ r.extraW = n => r.mult(n)+r.add; });

/* ================= ENGINE (pure · v23: workbook v22 + per-replica weight/activation accounting) ================= */
/*ENGINE-START*/
function compute(s){
  const bw = s.bytesW, bk = s.bytesK;
  const weights = s.params * bw;
  const kvTok  = 2 * s.layers * s.kvHeads * s.headDim * bk / 1e9;
  const effSeq = s.resident + (s.extend ? s.reasonTok : 0);
  const replicas = Math.max(1, Math.floor(s.gpus / Math.max(s.tp,1)));
  const active = s.policy === 'all' ? s.concurrent
               : Math.min(s.concurrent, s.batch * replicas);
  const kvTotal = active * effSeq * kvTok;
  const act = Math.min(effSeq, 8192) * s.hidden * 12 * bw / 1e9;
  const fixed = 5, multi = Math.max(0, s.gpus - 1) * 15;
  const weightsAll = replicas * weights, actAll = replicas * act;
  const total = weightsAll + kvTotal + actAll + fixed + multi;
  const servingGpus = replicas * Math.max(s.tp,1), idleGpus = s.gpus - servingGpus;
  const avail = servingGpus * s.gpuVram;
  const bwEff = s.gpuBw * s.tp * s.ic * s.mbu * 1000;
  const batchPerRep = Math.max(1, active / replicas);
  const tps = bwEff / (s.active * bw + batchPerRep * effSeq * kvTok);
  const agg = tps * active;
  const ttft = 2 * s.resident * s.active / (s.gpuTflops * s.tp * s.mfu);
  const itl = 1000 / tps;
  const genTok = s.reasonTok + s.visibleOut;
  const latency = (ttft + s.ovh) / 1000 + genTok / tps;
  const p95 = latency * 1.3;
  const maxBatchMem = Math.max(0, Math.floor((avail - weightsAll - actAll - fixed - multi) / (effSeq * kvTok) / replicas)) || 0;
  const kvDelta = effSeq * kvTok;
  const allActiveVram = weightsAll + s.concurrent * effSeq * kvTok + actAll + fixed + multi;
  const queued = Math.max(0, s.concurrent - active);
  const fits = total <= avail;
  const slo = {
    ttft: s.sloTtft > 0 ? {on:true, pass: ttft <= s.sloTtft} : {on:false, pass:true},
    tps:  s.sloTps  > 0 ? {on:true, pass: tps  >= s.sloTps } : {on:false, pass:true},
    p95:  s.sloP95  > 0 ? {on:true, pass: p95  <= s.sloP95 } : {on:false, pass:true},
  };
  const sloAll = slo.ttft.pass && slo.tps.pass && slo.p95.pass;
  return {weights,weightsAll,kvTok,effSeq,replicas,active,kvTotal,act,actAll,fixed,multi,total,avail,
          servingGpus,idleGpus,bwEff,batchPerRep,tps,agg,ttft,itl,latency,p95,genTok,maxBatchMem,kvDelta,
          allActiveVram,queued,fits,slo,sloAll,headroom:avail-total};
}
/*ENGINE-END*/

/* ================= HELPERS ================= */
const $ = id => document.getElementById(id);
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const pal = () => ({teal:cssVar('--teal-strong'), violet:cssVar('--violet'), red:cssVar('--red'),
  amber:cssVar('--amber-border'), grid:cssVar('--grid'), axis:cssVar('--axis'), bg:cssVar('--panel'),
  line:cssVar('--line'), lineSoft:cssVar('--line-soft'), inset:cssVar('--inset'), panel2:cssVar('--panel-2'),
  text:cssVar('--text'), muted:cssVar('--muted'), faint:cssVar('--faint'), segkv:cssVar('--seg-kv')});
function fmt(x){ if(!isFinite(x)) return '—';
  const a=Math.abs(x);
  return a>=1000 ? Math.round(x).toLocaleString('en-US')
       : a>=100 ? x.toFixed(0) : a>=10 ? x.toFixed(1) : x.toFixed(2);
}
function fmtTok(x){ return x>=1048576? (x/1048576).toFixed(x%1048576?1:0)+'M' : x>=1024? (x/1024).toFixed(x%1024?1:0).replace(/\.0$/,'')+'K' : String(Math.round(x)); }
function tween(el, to){
  const from = parseFloat(el.dataset.cur||'0')||0;
  el.dataset.cur = to;
  if (RM || !isFinite(to)) { el.textContent = fmt(to); return; }
  const t0 = performance.now(), D = 320;
  function step(t){ const k = Math.min(1,(t-t0)/D), e = 1-Math.pow(1-k,3);
    el.textContent = fmt(from+(to-from)*e);
    if(k<1) requestAnimationFrame(step); }
  requestAnimationFrame(step);
}
function niceCeil(x){ const p = Math.pow(10, Math.floor(Math.log10(x||1))); const m = x/p;
  return (m<=1?1:m<=2?2:m<=2.5?2.5:m<=5?5:10)*p; }
const SVG_ICO = {
  building:'<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M9 7h.01M15 7h.01M9 11h.01M15 11h.01M9 15h.01M15 15h.01M10 21v-3h4v3"/>',
  shield:'<path d="M12 3l7 3v5c0 4.6-3 8.2-7 10-4-1.8-7-5.4-7-10V6l7-3z"/>',
  globe:'<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.9 2.8 2.9 14.2 0 17-2.9-2.8-2.9-14.2 0-17z"/>',
  sync:'<path d="M20 6v5h-5M4 18v-5h5"/><path d="M19.3 11a7.6 7.6 0 0 0-13.5-3.2M4.7 13a7.6 7.6 0 0 0 13.5 3.2"/>',
  zap:'<path d="M13 2 4.5 14H11l-1 8 8.5-12H12l1-8z"/>',
};
function svgIco(name,x,y,size,color){
  return `<g transform="translate(${x},${y}) scale(${(size/24).toFixed(3)})" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${SVG_ICO[name]}</g>`;
}
function toast(msg, err, action){
  const t=document.createElement('div'); t.className='toast'+(err?' err':''); t.textContent=msg;
  if(action){ const b=document.createElement('button'); b.className='t-act'; b.type='button';
    b.textContent=action.label;
    b.addEventListener('click',()=>{ action.fn(); t.classList.remove('show'); setTimeout(()=>t.remove(),250); });
    t.appendChild(b); }
  $('toast').appendChild(t); requestAnimationFrame(()=>t.classList.add('show'));
  setTimeout(()=>{ t.classList.remove('show'); setTimeout(()=>t.remove(),250); }, action?5200:2400);
}

/* ================= FIELD FACTORY ================= */
const FIELDS = {
  inSeq:{mount:'m_inSeq',label:'Resident sequence',unit:'tokens',scale:'log',min:128,max:1048576,snap:64,val:4096,
    band:[2048,65536],marks:[[4096,'4K'],[32768,'32K'],[262144,'256K']],disp:fmtTok,
    help:'Prompt + retained history + tool traces + expected output actually held per request, not the model\'s max context. Drives KV size and prefill time.',
    typ:'Chat 4–8K · RAG 16–64K · long-doc 64–128K · agents 32–256K'},
  inOut:{mount:'m_inOut',label:'Visible output',unit:'tokens',scale:'log',min:16,max:16384,snap:8,val:200,
    band:[200,3000],marks:[[200,'200'],[2500,'2.5K']],disp:fmtTok,
    help:'Tokens the user actually sees per response. Together with reasoning tokens it sets decode time and perceived latency.',
    typ:'Voice 100–300 · chat 500–1,500 · reports 2,000–4,000'},
  inReasonTok:{mount:'m_inReasonTok',label:'Reasoning tokens',unit:'tokens',scale:'lin',min:0,max:32768,snap:256,val:0,
    band:[2000,8000],marks:[[2000,'2K'],[8000,'8K']],disp:fmtTok,
    help:'Hidden thinking tokens per call. Editable when mode is Custom; otherwise set by the mode.',
    typ:'Light ≈ 2K · Heavy ≈ 8K · deep agents 8–16K'},
  inConc:{mount:'m_inConc',label:'Concurrent LLM calls',unit:'peak',scale:'log',min:1,max:10000,snap:1,val:250,
    band:[10,500],marks:[[50,'50'],[500,'500']],disp:v=>fmt(v),
    help:'Simultaneous in-flight requests at peak, not total users. Use the Little\'s-law estimator below to derive it from headcount.',
    typ:'Dozens of users → single digits · thousands of users → 50–500'},
  inBatch:{mount:'m_inBatch',label:'Max batch per replica',unit:'seqs',scale:'log',min:1,max:512,snap:1,val:4,
    band:[4,64],marks:[[4,'4'],[16,'16'],[64,'64']],disp:v=>fmt(v),
    help:'Admission cap per replica. Small batches favor per-user speed (voice); large batches favor aggregate throughput (batch jobs). Watch the throughput chart as you move it.',
    typ:'Voice 2–8 · chat 8–32 · offline 32–256'},
  inWorkers:{mount:'m_inWorkers',label:'GPU workers (nodes)',unit:'N · load-bearing',scale:'log',min:1,max:64,snap:1,val:1,
    band:[1,8],marks:[[1,'1'],[4,'4'],[8,'8'],[16,'16']],disp:v=>fmt(v),
    help:'Servers carrying the load: the N in N+1 / N+N / DR. Performance and fit are computed on these; the resilience model below adds standby units on top.',
    typ:'One HGX node handles most pilots · scale out for concurrency'},
  inPerW:{mount:'m_inPerW',label:'GPUs per worker',unit:'devices',scale:'lin',min:1,max:72,snap:1,val:8,
    band:[8,16],marks:[[8,'8'],[16,'16'],[72,'72 rack']],disp:v=>fmt(v),
    help:'Accelerators in one scale-up (NVLink-class) domain. 8 is the HGX/DGX standard; 72 models a rack-scale system (GB200/GB300 NVL72, AMD Helios) where the whole rack is one island. TP beyond this count crosses nodes and pays an interconnect penalty.',
    typ:'PCIe boxes 2–4 · HGX/DGX 8 · NVL72 / Helios rack 72'},
  inTp:{mount:'m_inTp',label:'Tensor parallel size',unit:'GPUs/replica',scale:'log',min:1,max:72,snap:1,val:8,
    band:[1,8],marks:[[2,'2'],[4,'4'],[8,'8'],[72,'72']],disp:v=>fmt(v),
    help:'The control that distributes the model: one copy of the weights is sliced across TP GPUs. GPUs beyond TP never add room for that copy; they form additional replicas, each loading the full model again, to serve more users. Raise TP until one copy fits. Keep TP ≤ GPUs per worker to stay inside NVLink; larger TP crosses nodes (set interconnect efficiency 0.6 to 0.7 to model it).',
    typ:'Fit-driven: smallest TP whose replica holds weights + cache'},
  inMfu:{mount:'m_inMfu',label:'Prefill MFU',unit:'',scale:'lin',min:0.1,max:0.9,snap:0.01,val:0.5,
    band:[0.3,0.7],marks:[[0.5,'0.5']],disp:v=>(+v).toFixed(2),
    help:'Model FLOPs utilization during prefill: the fraction of theoretical peak actually achieved. FlashAttention lands 0.3–0.7; chunked prefill trends lower.',
    typ:'Conservative 0.4 · typical 0.5 · well-tuned 0.6–0.7'},
  inMbu:{mount:'m_inMbu',label:'Decode MBU',unit:'',scale:'lin',min:0.2,max:0.95,snap:0.01,val:0.65,
    band:[0.5,0.75],marks:[[0.65,'0.65']],disp:v=>(+v).toFixed(2),
    help:'Memory-bandwidth utilization during decode. Engine efficiency only; batch effects are modeled explicitly, so don\'t lower this for big batches.',
    typ:'vLLM / TRT-LLM on H100–B200: 0.5–0.75'},
  inIc:{mount:'m_inIc',label:'Interconnect efficiency',unit:'',scale:'lin',min:0.4,max:1,snap:0.01,val:0.85,
    band:[0.6,0.9],marks:[[0.85,'0.85']],disp:v=>(+v).toFixed(2),
    help:'Multi-GPU scaling efficiency for tensor-parallel decode. NVLink within a node scales well; crossing nodes costs real bandwidth.',
    typ:'NVLink 8× ≈ 0.85 · PCIe ≈ 0.7 · cross-node 0.6–0.7'},
  inOvh:{mount:'m_inOvh',label:'Framework overhead',unit:'ms',scale:'lin',min:0,max:200,snap:5,val:30,
    band:[20,50],marks:[[30,'30']],disp:v=>fmt(v),
    help:'Queueing, tokenization, scheduling and network time added to every call. Disproportionately hurts voice agents with 300 ms TTFT budgets.',
    typ:'Tight serving 20–40 · gateway + guardrails 50–120'},
};
function toS(cfg,v){ v=Math.min(cfg.max,Math.max(cfg.min,v));
  return cfg.scale==='log' ? Math.round(1000*Math.log(v/cfg.min)/Math.log(cfg.max/cfg.min))
                           : Math.round(1000*(v-cfg.min)/(cfg.max-cfg.min)); }
function fromS(cfg,s){ const raw = cfg.scale==='log' ? cfg.min*Math.pow(cfg.max/cfg.min,s/1000)
                                                     : cfg.min+(cfg.max-cfg.min)*s/1000;
  const sn = cfg.snap>=1 ? Math.max(cfg.min, Math.round(raw/cfg.snap)*cfg.snap)
                         : Math.round(raw/cfg.snap)*cfg.snap;
  return +sn.toFixed(4); }
function pctOf(cfg,v){ return toS(cfg,v)/10; }
function buildField(id){
  const cfg=FIELDS[id], root=$(cfg.mount);
  const marks=cfg.marks.map(([v,l])=>`<span class="mark" style="left:${pctOf(cfg,v)}%"></span>`+
    (l?`<span class="mark-lab" style="left:${pctOf(cfg,v)}%">${l}</span>`:'')).join('');
  root.innerHTML=`<div class="field ctl">
    <div class="f-head"><label for="${id}">${cfg.label}</label>${cfg.unit?`<span class="unit">${cfg.unit}</span>`:''}
      <button class="info" data-help="h_${id}" aria-expanded="false" type="button">i</button>
      <span class="spacer"></span><span class="cur" id="${id}_cur"></span></div>
    <div class="ctl-row">
      <div class="slider"><div class="track"></div>
        <div class="band" style="left:${pctOf(cfg,cfg.band[0])}%;width:${pctOf(cfg,cfg.band[1])-pctOf(cfg,cfg.band[0])}%"></div>
        ${marks}
        <input type="range" id="${id}_r" min="0" max="1000" step="1" value="${toS(cfg,cfg.val)}" aria-label="${cfg.label} slider">
      </div>
      <input type="number" id="${id}" value="${cfg.val}" min="${cfg.min}" max="${cfg.max}" step="${cfg.snap}">
    </div>
    <div class="f-help" id="h_${id}">${cfg.help}<span class="typ">${cfg.typ}</span></div>
  </div>`;
  const num=$(id), rng=$(id+'_r'), cur=$(id+'_cur');
  cur.textContent=cfg.disp(cfg.val);
  rng.addEventListener('input',()=>{ const v=fromS(cfg,+rng.value); num.value=v; cur.textContent=cfg.disp(v); });
  num.addEventListener('input',()=>{ const v=Math.min(cfg.max,Math.max(cfg.min,+num.value||cfg.min));
    rng.value=toS(cfg,v); cur.textContent=cfg.disp(v); });
}
function refreshCtl(id){ const cfg=FIELDS[id]; if(!cfg) return;
  const v=+$(id).value||cfg.min; $(id+'_r').value=toS(cfg,v); $(id+'_cur').textContent=cfg.disp(v); }
Object.keys(FIELDS).forEach(buildField);

document.addEventListener('click',e=>{
  const b=e.target.closest('.info'); if(!b) return;
  const h=$(b.dataset.help); const open=h.classList.toggle('open');
  b.setAttribute('aria-expanded', open?'true':'false');
});

/* ================= POPULATE SELECTS ================= */
function groupOptions(sel, items, keyFn, labelFn){
  sel.innerHTML=''; const groups=new Map();
  items.forEach((it,i)=>{ const k=keyFn(it); if(!groups.has(k)) groups.set(k,[]); groups.get(k).push([it,i]); });
  for(const [k,arr] of groups){ const og=document.createElement('optgroup'); og.label=k;
    arr.forEach(([it,i])=>{ const o=document.createElement('option'); o.value=i; o.textContent=labelFn(it); og.appendChild(o); });
    sel.appendChild(og); }
}
groupOptions($('selModel'), MODELS, m=>m.dev, m=>m.name);
groupOptions($('selGpu'),   GPUS,   g=>g.cls, g=>g.name);
$('modelCount').textContent = MODELS.length+' loaded';
$('gpuCount').textContent = GPUS.length+' loaded';
QUANTS.forEach((q,i)=>{ const o=document.createElement('option'); o.value=i; o.textContent=q.name; $('selWQuant').appendChild(o); });
KV_QUANTS.forEach((q,i)=>{ const o=document.createElement('option'); o.value=i; o.textContent=q.name; $('selKQuant').appendChild(o); });
{ const o=document.createElement('option'); o.value=-1; o.textContent='Custom (manual)'; $('selCase').appendChild(o); }
CASES.forEach((c,i)=>{ const o=document.createElement('option'); o.value=i; o.textContent=c.name; $('selCase').appendChild(o); });

const GCC_RE = /UAE|KSA|Qatar|G42|TII|SDAIA|QCRI|MBZUAI/i;
function modelBadges(m){
  const b=[]; const a=m.arch||'';
  if(/MoE/i.test(a)) b.push(['MoE','moe']);
  if(/MLA|CSA|DSA|MSA/i.test(a)) b.push(['compressed KV','mla']);
  if(/SSM|Mamba/i.test(a)) b.push(['hybrid SSM','ssm']);
  if(/MHA/i.test(a)) b.push(['heavy KV · MHA','warn']);
  if(/est\. cfg|cfg approx/i.test(a)) b.push(['est. config','est']);
  if(GCC_RE.test(m.dev)) b.push(['GCC sovereign','gcc']);
  return b;
}

/* ================= STATE ================= */
function currentModel(){
  if($('chkCustom').checked) return {name:'Custom', params:+$('cusParams').value||0.1, active:+$('cusActive').value||0.1,
    hidden:+$('cusHidden').value||64, layers:+$('cusLayers').value||1, kvHeads:+$('cusKvh').value||1,
    headDim:+$('cusHdim').value||8, ctx:+$('cusCtx').value||1024, arch:'Custom', dev:'—', url:''};
  return MODELS[+$('selModel').value||0];
}
function readState(){
  const m = currentModel();
  const g = GPUS[+$('selGpu').value||0];
  const wq = QUANTS[+$('selWQuant').value||0];
  const kq = KV_QUANTS[+$('selKQuant').value||0];
  // clamp every slider-backed field through its config so the engine, the readout
  // and the visible input can never disagree (typed out-of-range or cleared values)
  const fv = id => { const c=FIELDS[id]; const raw = $(id).value===''? c.val : +$(id).value;
    const v = isFinite(raw)? raw : c.val; return Math.min(c.max, Math.max(c.min, v)); };
  const workers = Math.round(fv('inWorkers'));
  const perW = Math.round(fv('inPerW'));
  const gpus = workers*perW;
  let tp = Math.round(fv('inTp'));
  if(tp>gpus){ tp=gpus; $('inTp').value=tp; refreshCtl('inTp'); }
  return {
    model:m, gpu:g, wq, kq,
    params:m.params, active:m.active, hidden:m.hidden, layers:m.layers,
    kvHeads:m.kvHeads, headDim:m.headDim, ctx:m.ctx,
    bytesW:wq.bytes, bytesK:kq.bytes,
    resident:Math.round(fv('inSeq')),
    visibleOut:Math.round(fv('inOut')),
    reasonMode:$('selReason').value,
    reasonTok:Math.round(fv('inReasonTok')),
    extend:$('chkExtend').checked,
    concurrent:Math.round(fv('inConc')),
    batch:Math.round(fv('inBatch')),
    policy:$('selPolicy').value,
    workers, perW, gpus, tp, resil:$('selResil').value,
    gpuVram:g.vram, gpuBw:g.bw, gpuTflops:g.tflops,
    mfu:fv('inMfu'), mbu:fv('inMbu'), ic:fv('inIc'),
    ovh:fv('inOvh'),
    sloTtft:+$('sloTtft').value||0, sloTps:+$('sloTps').value||0, sloP95:+$('sloP95').value||0,
  };
}

/* ================= SVG CHARTS ================= */
function axisTicks(max){ const t=niceCeil(max); return [0,t/4,t/2,3*t/4,t]; }
function chartSVG(opts){
  const P=pal();
  const W=560,H=248,L=48,R=opts.rightAxis?52:14,T=18,B=42, iw=W-L-R, ih=H-T-B;
  const X=v=>L+opts.xScale(v)*iw;
  let s=`<svg viewBox="0 0 ${W} ${H}" style="aspect-ratio:${W}/${H};width:100%;height:auto" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${opts.aria}">`;
  axisTicks(opts.maxL).forEach(v=>{ const y=T+ih-(v/niceCeil(opts.maxL))*ih;
    s+=`<line x1="${L}" y1="${y}" x2="${W-R}" y2="${y}" stroke="${P.grid}" stroke-width="1"/>`;
    s+=`<text x="${L-7}" y="${y+3.5}" fill="${P.axis}" font-size="9.5" text-anchor="end" font-family="IBM Plex Mono,monospace">${fmt(v)}</text>`; });
  if(opts.rightAxis) axisTicks(opts.maxR).forEach(v=>{ const y=T+ih-(v/niceCeil(opts.maxR))*ih;
    s+=`<text x="${W-R+7}" y="${y+3.5}" fill="${P.axis}" font-size="9.5" text-anchor="start" font-family="IBM Plex Mono,monospace">${fmt(v)}</text>`; });
  if(opts.yLabelL) s+=`<text x="${L}" y="10" fill="${P.faint}" font-size="8.5" font-family="Inter,sans-serif">${opts.yLabelL}</text>`;
  if(opts.rightAxis&&opts.yLabelR) s+=`<text x="${W-4}" y="10" fill="${P.faint}" font-size="8.5" text-anchor="end" font-family="Inter,sans-serif">${opts.yLabelR}</text>`;
  opts.xTicks.forEach(([v,lab])=>{ const x=X(v);
    s+=`<line x1="${x}" y1="${T+ih}" x2="${x}" y2="${T+ih+4}" stroke="${P.axis}"/>`;
    s+=`<text x="${x}" y="${T+ih+16}" fill="${P.axis}" font-size="9.5" text-anchor="middle" font-family="IBM Plex Mono,monospace">${lab}</text>`; });
  if(opts.xLabel) s+=`<text x="${L+iw/2}" y="${H-7}" fill="${P.faint}" font-size="8.5" text-anchor="middle" font-family="Inter,sans-serif">${opts.xLabel}</text>`;
  if(opts.guideX!=null && opts.guideX<=opts.xMax){ const x=X(opts.guideX);
    s+=`<line x1="${x}" y1="${T}" x2="${x}" y2="${T+ih}" stroke="${P.red}" stroke-width="1.4" stroke-dasharray="4 4" opacity=".85"/>`;
    if(opts.guideLabel) s+=`<text x="${Math.min(x+5,W-R-70)}" y="${T+11}" fill="${P.red}" font-size="8.5" font-family="IBM Plex Mono,monospace">${opts.guideLabel}</text>`; }
  const norm=m=>niceCeil(m);
  const YFOR=sr=>sr.axis==='R'?(v=>T+ih-(v/norm(opts.maxR))*ih):(v=>T+ih-(v/norm(opts.maxL))*ih);
  opts.series.forEach(sr=>{ const Y=YFOR(sr);
    const d=sr.pts.map((p,i)=>(i?'L':'M')+X(p[0]).toFixed(1)+' '+Y(p[1]).toFixed(1)).join(' ');
    s+=`<path d="${d}" fill="none" stroke="${sr.color}" stroke-width="2.2" stroke-linejoin="round"/>`; });
  function drawMarker(mk){
    const sr=opts.series[mk.series||0]; const Y=YFOR(sr);
    const x=X(mk.x), y=Y(mk.y);
    s+=`<circle cx="${x}" cy="${y}" r="4.5" fill="${P.amber}" stroke="${P.bg}" stroke-width="1.6"/>`;
    if(mk.align==='left')
      s+=`<text x="${Math.max(x-8,L+4)}" y="${Math.max(y-8,T+10)}" fill="${P.amber}" font-size="10" text-anchor="end" font-family="IBM Plex Mono,monospace">${mk.label}</text>`;
    else
      s+=`<text x="${Math.min(x+8,W-R-4)}" y="${Math.max(y-8,T+10)}" fill="${P.amber}" font-size="10" font-family="IBM Plex Mono,monospace">${mk.label}</text>`;
  }
  if(opts.marker) drawMarker(opts.marker);
  if(opts.marker2) drawMarker(opts.marker2);
  s+='</svg>'; return s;
}
function renderBatchChart(s,d){
  const P=pal();
  const Smax = Math.max(Math.ceil(s.concurrent*1.4), s.batch*d.replicas*2, 16);
  const memCapTotal = d.maxBatchMem>0 ? d.maxBatchMem*d.replicas : null;
  const pts=[],ptsA=[]; const N=56; let maxL=0,maxR=0;
  for(let i=0;i<=N;i++){ const S=Math.max(1,Math.round(1+(Smax-1)*i/N));
    const bpr=Math.max(1,S/d.replicas);
    const t=d.bwEff/(s.active*s.bytesW+bpr*d.effSeq*d.kvTok); const a=t*S;
    pts.push([S,t]); ptsA.push([S,a]); maxL=Math.max(maxL,t); maxR=Math.max(maxR,a); }
  $('chartBatch').innerHTML = chartSVG({
    aria:'Per-user and aggregate throughput versus admitted sequences',
    xScale:v=>(v-1)/(Smax-1||1), xMax:Smax, maxL, maxR, rightAxis:true,
    xTicks:[1,Math.round(Smax/4),Math.round(Smax/2),Math.round(3*Smax/4),Smax].map(v=>[v,fmt(v)]),
    guideX:memCapTotal, guideLabel:memCapTotal? 'mem limit '+fmt(memCapTotal):null,
    xLabel:'admitted sequences', yLabelL:'tok/s per user', yLabelR:'aggregate tok/s',
    series:[{pts,color:P.teal,axis:'L'},{pts:ptsA,color:P.violet,axis:'R'}],
    marker:{x:Math.min(d.active,Smax), y:d.tps, label:fmt(d.tps)+' @ '+d.active, series:0},
    marker2:{x:Math.min(d.active,Smax), y:d.agg, label:'Σ '+fmt(d.agg), series:1, align:'left'}
  });
}
function renderCtxChart(s,d){
  const P=pal();
  const lo=1024, hi=Math.max(s.ctx,4096); const lgLo=Math.log2(lo), lgHi=Math.log2(hi);
  const pts=[]; let maxL=0; const N=48;
  for(let i=0;i<=N;i++){ const x=Math.pow(2,lgLo+(lgHi-lgLo)*i/N);
    const eff=x+(s.extend?s.reasonTok:0); const bpr=Math.max(1,d.active/d.replicas);
    const t=d.bwEff/(s.active*s.bytesW+bpr*eff*d.kvTok);
    pts.push([x,t]); maxL=Math.max(maxL,t); }
  const ticks=[]; for(let p=10;p<=Math.log2(hi);p+=2){ const v=Math.pow(2,p); if(v>=lo&&v<=hi) ticks.push([v,fmtTok(v)]); }
  if(ticks.length===0||ticks[ticks.length-1][0]!==hi) ticks.push([hi,fmtTok(hi)]);
  const cur=Math.min(Math.max(d.effSeq,lo),hi);
  const bpr=Math.max(1,d.active/d.replicas);
  const curT=d.bwEff/(s.active*s.bytesW+bpr*cur*d.kvTok);
  $('chartCtx').innerHTML = chartSVG({
    aria:'Per-user decode speed versus context length',
    xScale:v=>(Math.log2(v)-lgLo)/(lgHi-lgLo||1), xMax:hi, maxL, rightAxis:false,
    xTicks:ticks, guideX:null,
    xLabel:'resident context (tokens, log scale)', yLabelL:'tok/s per user',
    series:[{pts,color:P.teal,axis:'L'}],
    marker:{x:cur,y:curT,label:fmtTok(Math.round(d.effSeq))+' · '+fmt(curT)+' t/s',series:0}
  });
}

/* ================= TOPOLOGY · server cards with per-GPU utilization ================= */
/* ================= PLAIN-WORDS STORY ================= */
let __storyText=[];
function buildStory(s,d,m,g){
  const P=[];
  const minGpus=Math.ceil((d.weights+d.act)/s.gpuVram);
  P.push(`One copy of <b>${m.name}</b> at <b>${s.wq.name}</b> weighs <b>${fmt(d.weights)} GB</b>: ${fmt(s.params)} billion parameters × ${s.bytesW} byte${s.bytesW===1?'':'s'} each. A single ${g.name} holds ${fmt(s.gpuVram)} GB, so one copy needs at least <b>${minGpus} GPU${minGpus>1?'s':''}</b>; here it is sliced across <b>TP${s.tp}</b>, a group with ${fmt(s.tp*s.gpuVram)} GB of memory.`);
  if(d.replicas>1)
    P.push(`Serving <b>${s.concurrent} concurrent calls</b> is what multiplies the fleet: at batch ${s.batch} per copy, admitting ${d.active} calls takes <b>${d.replicas} full copies</b> of the model. The serving fleet is ${d.replicas} × TP${s.tp} = <b>${d.servingGpus||s.gpus} GPUs</b> on ${s.workers} workers${d.queued>0?`, and ${d.queued} calls still queue at peak`:''}. The model itself only ever needed ${minGpus}; the other ${(d.servingGpus||s.gpus)-s.tp} GPUs are for your users.`+(window.__prj&&UC.length>1&&(s.gpus>d.replicas*s.tp)? ` The pool's nodes hold ${s.gpus} GPUs; the ${s.gpus-d.replicas*s.tp} beyond the needed replicas stay spare (headroom and supporting models).`:''));
  else
    P.push(`One copy serves everything: at batch ${s.batch} it admits ${d.active} of your ${s.concurrent} concurrent calls${d.queued>0?` while ${d.queued} queue at peak`:''}. Fleet = the single TP${s.tp} group${s.workers>1?` spread over ${s.workers} workers`:''}.`);
  const kvSeq=d.effSeq*d.kvTok;
  P.push(`${d.kvTotal>d.weightsAll?'The cache, not the weights, dominates here: each':'Each'} admitted conversation holds <b>${kvSeq<1? (kvSeq*1000).toFixed(0)+' MB':fmt(kvSeq)+' GB'}</b> of KV cache (${(d.kvTok*1e6).toFixed(1)} KB per token at ${s.kq.name} across ${fmtTok(d.effSeq)} tokens); all ${d.active} together add <b>${fmt(d.kvTotal)} GB</b>${d.kvTotal>d.weightsAll?', more than the weights themselves':`, next to ${fmt(d.weightsAll)} GB of weights`}.`);
  P.push(`The envelope: prefill reads ${fmtTok(s.resident)} tokens and lands the first token in ≈<b>${fmt(d.ttft)} ms</b>; decode streams ≈<b>${fmt(d.tps)} tok/s</b> per user at batch ${fmt(d.batchPerRep)}. ${d.sloAll?'Every enabled SLO passes.':'At least one SLO target fails; see Recommendations.'}`);
  const info=RESIL[s.resil];
  {
    const F=window.__prj&&window.__prj.fleet;
    const nPools=window.__prj? window.__prj.pools.length : 1;
    const mult=info.mult(s.workers);
    const secondSite=info.live(1)>1;
    const multTxt = mult>0
      ? (secondSite
        ? `${mult} worker${mult>1?'s':''} at a second live site${nPools>1?' for this pool':''} (they serve traffic; the guarantee is surviving a site loss)`
        : `${mult} idle worker${mult>1?'s':''}${nPools>1?' for this pool':''}`)
      : '';
    const perSite=(s.resil==='aass'||s.resil==='aan1');
    const addTxt = info.add
      ? (perSite
        ? `one idle spare node per site (each covers a node failure in its own site${nPools>1?', any pool':''})`
        : `${info.add} idle spare node${info.add>1?'s':''}${nPools>1?` shared across all ${nPools} pools (hardware is uniform, so one spare covers any pool)`:''}`)
      : '';
    const what = (multTxt||addTxt)? 'adds '+[multTxt,addTxt].filter(Boolean).join(' plus ') : 'adds nothing: a failure removes capacity';
    const procW=F? F.procW : s.workers+info.extraW(s.workers);
    const procG=F? F.procG : procW*s.perW;
    const kW=F? F.kW : procG*g.watts/1000;
    const supTail=F&&F.supNodes? `, including ${F.supNodes} supporting node${F.supNodes>1?'s':''}` : '';
    P.push(`Resilience (<b>${info.long}</b>) ${what}; ${nPools>1?'project ':''}procurement totals <b>${procW} nodes · ${procG} GPUs · ≈${fmt(kW)} kW</b> GPU TDP${supTail}.`);
  }
  if(!d.fits)
    P.push(`<b>It does not fit:</b> the fleet needs ${fmt(d.total)} GB against ${fmt(d.avail)} GB of serving memory. The Recommendations panel lists the levers in order of effect.`);
  __storyText=P.map(p=>p.replace(/<[^>]+>/g,''));
  return P.map(p=>`<p>${p}</p>`).join('');
}

/* ================= RECOMMENDATIONS ================= */
function buildRecs(s,d,m,g,prelaunch){
  const recs=[]; const util=d.avail>0? d.total/d.avail : 1;
  const push=(lv,t,b)=>recs.push({lv,t,b});
  let bottleneck='none';
  if(!d.fits) bottleneck='VRAM capacity';
  else if(d.slo.ttft.on&&!d.slo.ttft.pass) bottleneck='prefill compute (TTFT)';
  else if(d.slo.tps.on&&!d.slo.tps.pass) bottleneck='decode bandwidth';
  else if(d.slo.p95.on&&!d.slo.p95.pass) bottleneck='generation length vs P95 target';
  else if(d.queued>0) bottleneck='admission (batch × replicas)';
  else if(util>0.92) bottleneck='VRAM headroom';

  const perRepCap=s.tp*s.gpuVram, perRepNeed=d.weights+d.act;
  if(perRepNeed>perRepCap){
    const minTp=Math.ceil(perRepNeed/s.gpuVram);
    const fitQ=QUANTS.filter(q=>q.bytes<s.bytesW && (s.params*q.bytes+d.act)<perRepCap).sort((a,b)=>b.bytes-a.bytes)[0];
    push('crit','One replica cannot hold the model',
      `The model is distributed over TP GPUs, and GPUs beyond TP hold extra copies, not extra room. Each TP${s.tp} slice group spans ${fmt(perRepCap)} GB of VRAM but one copy of ${m.name} needs ${fmt(perRepNeed)} GB, so every group overflows identically and adding workers cannot help. Fix it with the Tensor parallel slider: TP ${minTp} or more fits one copy${minTp>s.perW?` (beyond the ${s.perW}-GPU NVLink island: raise GPUs per worker to model rack-scale parts, or set interconnect efficiency 0.6 to 0.7 for the cross-node hop; real systems use pipeline parallelism here, which this tool does not model)`:''}; TP ${s.gpus} distributes a single copy across the whole fleet. Alternatives: ${fitQ?`${fitQ.name} weights (${fmt(s.params*fitQ.bytes)} GB fits at TP${s.tp}), `:''}a higher-VRAM GPU, or a smaller model.`);
  }
  if(!d.fits){
    const overBy=d.total-d.avail, addW=Math.max(1,Math.ceil(overBy/(s.perW*s.gpuVram)));
    let opts=[];
    if(perRepNeed<=perRepCap) opts.push(`add ≈${addW} worker${addW>1?'s':''}`);
    if(s.bytesW>1) opts.push(`FP8 weights (saves ${fmt(d.weightsAll/2)} GB)`);
    if(s.bytesK>1) opts.push(`FP8 KV cache (saves ${fmt(d.kvTotal/2)} GB)`);
    opts.push('trim resident context or batch');
    push('crit','Configuration does not fit',`Needs ${fmt(d.total)} GB against ${fmt(d.avail)} GB of serving VRAM, over by ${fmt(overBy)} GB${d.replicas>1?` (${d.replicas} replicas × ${fmt(d.weights)} GB weights each)`:''}. Options: ${opts.join(', ')}.`);
  }
  if(d.effSeq>m.ctx)
    push('crit','Context exceeds the model',`Resident + reasoning is ${fmtTok(d.effSeq)} but ${m.name} tops out at ${fmtTok(m.ctx)}. Reduce resident tokens${s.extend&&s.reasonTok?', disable KV extension,':''} or pick a longer-context model.`);
  if(s.tp>s.perW){
    if(s.ic>0.75)
      push('crit','Tensor parallel crosses node boundaries',`TP${s.tp} with ${s.perW} GPU per worker forces TP traffic over the network. Lower TP to ${s.perW} or less, raise GPUs per worker, or model the penalty with interconnect efficiency 0.6 to 0.7.`);
    else
      push('ok','TP crosses nodes (penalty modeled)',`TP${s.tp} spans ${Math.ceil(s.tp/s.perW)} workers and interconnect efficiency ${s.ic} models the cross-node cost on decode. Prefill is still estimated optimistically; production systems usually run TP${s.perW} inside the node with pipeline parallelism across nodes, or rack-scale NVLink parts.`);
  }
  if(d.fits&&d.slo.ttft.on&&!d.slo.ttft.pass){
    const tp2=Math.min(s.tp*2,s.gpus), t2=d.ttft*s.tp/tp2;
    push('warn','TTFT misses its target',`Prefill takes ${fmt(d.ttft)} ms against a ${fmt(s.sloTtft)} ms target. TP ${s.tp} to ${tp2} lands ≈${fmt(t2)} ms${tp2>s.perW?' (but crosses nodes)':''}; prefix caching, chunked prefill or a disaggregated prefill pool attack the same problem without more GPUs.`);
  }
  if(d.fits&&d.slo.tps.on&&!d.slo.tps.pass){
    const halfB=Math.max(1,Math.floor(d.batchPerRep/2));
    const t2=d.bwEff/(s.active*s.bytesW+halfB*d.effSeq*d.kvTok);
    push('warn','Per-user speed misses its target',`${fmt(d.tps)} tok/s against a ${fmt(s.sloTps)} tok/s target. Halving batch per replica to ${halfB} gives ≈${fmt(t2)} tok/s at lower aggregate; FP8 KV, a higher-bandwidth GPU, or speculative decoding (1.5 to 3x) are the structural fixes.`);
  }
  if(d.fits&&d.slo.p95.on&&!d.slo.p95.pass){
    const tpsMax=d.bwEff/(s.active*s.bytesW+d.effSeq*d.kvTok);
    const minLat=((d.ttft+s.ovh)/1000+d.genTok/tpsMax)*1.3;
    if(minLat>s.sloP95)
      push('crit','P95 target is unachievable for this workload',`Each call generates ${fmtTok(d.genTok)} tokens (${fmtTok(s.reasonTok)} reasoning + ${fmtTok(s.visibleOut)} visible). Even alone on this hardware at batch 1, that takes ≈${fmt(minLat)} s at P95 against a ${fmt(s.sloP95)} s target. No amount of GPUs fixes this: cut reasoning or visible tokens, turn reasoning off for this use case, or relax the P95 target.`);
    else {
      const tpsNeeded=d.genTok/(s.sloP95/1.3-(d.ttft+s.ovh)/1000);
      const bNeeded=Math.max(1,Math.floor((d.bwEff/tpsNeeded-s.active*s.bytesW)/(d.effSeq*d.kvTok)));
      push('warn','P95 latency misses its target',`P95 is ${fmt(d.p95)} s against ${fmt(s.sloP95)} s. Reaching ≈${fmt(tpsNeeded)} tok/s per user would meet it: lower max batch per replica to ≈${bNeeded} (fewer calls admitted per copy), or add speculative decoding (1.5 to 3x decode speed).`);
    }
  }
  if(d.queued>0&&d.fits){
    const batchNeeded=Math.ceil(s.concurrent/d.replicas);
    const canBatch=batchNeeded<=Math.min(d.maxBatchMem||0,512);
    const needW=Math.ceil(Math.max(1,Math.ceil(s.concurrent/s.batch))*s.tp/s.perW);
    push('warn','Calls queue at peak',`${d.queued} of ${s.concurrent} concurrent calls wait; only ${d.active} are admitted. ${canBatch
      ? `Raising max batch per replica from ${s.batch} to ${batchNeeded} admits everyone (memory allows up to ${fmt(Math.min(d.maxBatchMem,512))}).`
      : `At batch ${s.batch}, admitting everyone needs ≈${needW} workers (currently ${s.workers}); or raise the batch and accept slower per-user speed.`}`);
  }
  if(d.fits&&util>0.92)
    push('warn','Headroom is thin',`${(util*100).toFixed(0)}% of serving VRAM is committed. Growth, longer contexts or a library update can tip this over; one more worker or FP8 KV restores margin.`);
  if(d.kvTotal>d.weightsAll)
    push('warn','KV-dominated deployment',`Cache (${fmt(d.kvTotal)} GB) outweighs weights (${fmt(d.weightsAll)} GB). FP8 or INT4 KV, compressed-KV models (MLA), or shorter resident sequences pay off most here.`);
  if(s.resil==='n'&&s.workers>1)
    push('warn','No redundancy configured',`A single worker failure removes ${fmt(100/s.workers)}% of capacity with nothing to absorb it. N+1 costs one worker (${s.perW} GPUs, ${fmt(s.perW*g.watts/1000)} kW) and removes that cliff.`);
  if(prelaunch)
    push('warn','Pre-launch GPU selected',`${g.name} is announced but not shipping; specs are estimates. Re-validate against datasheets before committing a proposal.`);
  const arch=g.arch||'';
  if(s.wq.name==='NV FP4' && !/Blackwell|Rubin/i.test(arch))
    push('warn','NVFP4 needs Blackwell-class hardware',`${g.name} (${arch}) has no native FP4 tensor path. NVFP4 weights would run through software dequantization: the memory savings hold, most of the speed benefit does not. Pick FP8 here, or a Blackwell/Rubin part for FP4.`);
  if(s.wq.name==='FP8' && /Ampere|Apple|Gaudi 2/i.test(arch))
    push('warn','FP8 is not native on this GPU',`${arch} predates hardware FP8 tensor cores. FP8 weights run via software paths (weight-only W8A16 at best): capacity math holds, the compute and bandwidth gains largely do not. Budget with BF16 speeds on ${g.name}, or choose a Hopper-class or newer part.`);
  if(s.wq.name==='MXFP4' && !/Blackwell|Rubin/i.test(arch))
    push('ok','MXFP4 runs in software here',`MXFP4 is native on Blackwell-class parts; on ${arch} it executes via software kernels (as GPT-OSS does on Hopper). Memory savings are real; expect less of the throughput gain.`);
  if(/Unified/i.test(g.mem))
    push('warn','Unified-memory hardware',`Capacity is generous but ${fmt(g.bw)} TB/s of bandwidth caps decode speed. Fine for development or single-user work, not for concurrent serving.`);
  if(d.fits&&util<0.35&&d.queued===0&&s.gpus>1)
    push('ok','Likely over-provisioned',`Only ${(util*100).toFixed(0)}% of serving VRAM is used and every call is admitted. Fewer workers, a smaller TP, or a cheaper part could carry this load; alternatively raise batch and serve more traffic on the same metal.`);
  if(!recs.some(r=>r.lv!=='ok')&&d.fits&&d.sloAll)
    push('ok','Balanced configuration',`Fits with ${fmt(d.headroom)} GB headroom (${(util*100).toFixed(0)}% used), all enabled SLOs pass, and every call is admitted at peak. No action needed.`);
  const rank={crit:0,warn:1,ok:2};
  recs.sort((a,b)=>rank[a.lv]-rank[b.lv]);
  return {bottleneck, recs:recs.slice(0,7)};
}

/* ================= RENDER ================= */
function render(){
  captureUc();
  // multi-usecase: every detail section below the project panel describes the
  // ACTIVE card's pool (combined load), not the card alone; the per-card SLO
  // envelopes live in the project panel's use-case cards.
  window.__prj = computeProject();
  let s, d;
  if(UC.length>1){
    // pool 1 feeds the (mostly hidden) single-pool scaffolding so the rendered
    // report is byte-stable regardless of which card is selected for editing
    const p = window.__prj.pools[0];
    s = p.state; d = p.d;
  } else { s = readState(); d = compute(s); }
  const m=s.model, g=s.gpu;
  const prelaunch=/2026/.test(g.cls);

  $('modelMeta').innerHTML =
    `<div class="mrow"><span>Params · active</span><b>${fmt(m.params)}B · ${fmt(m.active)}B</b></div>`+
    `<div class="mrow"><span>Geometry</span><b>${m.layers}L · h${m.hidden} · KV ${m.kvHeads}×${m.headDim}</b></div>`+
    `<div class="mrow"><span>Max context</span><b>${fmtTok(m.ctx)}</b></div>`+
    ((m.experts?`<div class="mrow"><span>Experts</span><b>${m.experts}E / ${m.activeExperts||'?'}A</b></div>`:''))+
    `<div class="mrow"><span>Developer</span><b>${m.dev}${m.url?` · <a href="${m.url}" target="_blank" rel="noopener">card ↗</a>`:''}</b></div>`+
    `<div class="badges">${modelBadges(m).map(([t,c])=>`<span class="badge ${c}">${t}</span>`).join('')}</div>`;
  $('gpuMeta').innerHTML =
    `<div class="mrow"><span>VRAM · bandwidth</span><b>${fmt(g.vram)} GB · ${fmt(g.bw)} TB/s</b></div>`+
    `<div class="mrow"><span>Dense FP16 TC</span><b>${fmt(g.tflops)} TFLOPS</b></div>`+
    `<div class="mrow"><span>${g.arch}</span><b>${g.mem} · ${g.watts} W · ${g.link}</b></div>`+
    `<div class="mrow"><span>Fleet</span><b>${s.workers}× worker · ${s.perW} GPU = ${s.gpus} GPU</b></div>`+
    `<div class="mrow"><span>Replicas</span><b>${d.replicas} × TP${s.tp}${s.gpus%s.tp? ' · '+(s.gpus%s.tp)+' idle':''}</b></div>`+
    `<div style="margin-top:4px">${d.replicas>1
      ? `${d.replicas} replicas: each is a full ${fmt(d.weights)} GB copy of the model on ${s.tp} GPUs, serving up to ${s.batch} calls. More TP distributes one copy wider; more workers add copies for more users.`
      : `One copy of the model, distributed across ${s.tp} GPU${s.tp>1?'s':''}, serving up to ${s.batch} calls at once. Add workers to create more copies for more users.`}</div>`+
    (prelaunch?`<div class="badges"><span class="badge est">pre-launch estimates</span></div>`:'');
  $('quantMeta').innerHTML =
    `<div class="mrow"><span>Weights ${s.wq.name}</span><b>${s.wq.bytes} B/param</b></div>`+
    `<div class="mrow"><span>KV ${s.kq.name}</span><b>${s.kq.bytes} B/elem</b></div>`+
    (s.wq.use?`<div style="margin-top:4px">${s.wq.use}</div>`:'');

  const v=$('verdict'); v.classList.remove('ok','warn','fail');
  let main,sub;
  if(!d.fits){ v.classList.add('fail'); main='Exceeds VRAM';
    const repNeed=d.weights+d.act, repCap=s.tp*s.gpuVram;
    sub= repNeed>repCap
      ? `Each TP${s.tp} replica must hold a full ${fmt(d.weights)} GB copy of the weights but spans only ${fmt(repCap)} GB of VRAM. More workers only add more copies: raise TP, quantize further, or pick a smaller model. See Recommendations below.`
      : `Needs ${fmt(d.total)} GB but only ${fmt(d.avail)} GB available: quantize further, cut context or batch, or add workers.`; }
  else if(!d.sloAll){ v.classList.add('warn'); main='Fits, but SLO targets missed';
    sub='Memory fits with headroom, but at least one latency/throughput target fails. See SLO compliance below.'; }
  else { v.classList.add('ok'); main='Fits & SLO targets met';
    sub=`Ready to deploy: ${fmt(d.headroom)} GB headroom, ${d.active} of ${s.concurrent} calls resident in KV.`; }
  $('vMain').textContent=main; $('vSub').textContent=sub;
  $('vKv').innerHTML=`<b>${fmt(d.total)} GB</b> required<br><b>${fmt(d.avail)} GB</b> across ${s.gpus}× GPU`;

  const maxScale=niceCeil(Math.max(d.total,d.avail)*1.04);
  const pct=x=>Math.max(0,Math.min(100,x/maxScale*100));
  let acc=0;
  [['segW',d.weightsAll],['segK',d.kvTotal],['segA',d.actAll],['segO',d.fixed+d.multi]].forEach(([id,val])=>{
    const el=$(id); el.style.left=pct(acc)+'%'; el.style.width=Math.max(0,pct(acc+val)-pct(acc))+'%'; acc+=val; });
  $('lgNeedle').style.left=pct(d.avail)+'%';
  const sx=$('segX');
  if(!d.fits){ sx.style.display='block'; sx.style.zIndex=2; sx.style.left=pct(d.avail)+'%'; sx.style.width=(pct(d.total)-pct(d.avail))+'%'; }
  else sx.style.display='none';
  const hd=$('lgHead');
  const hp = d.fits? pct(d.total) : Math.min(pct(d.total),72);
  hd.innerHTML = d.fits? `headroom <b>${fmt(d.headroom)} GB</b>` : `over by <b style="color:var(--red)">${fmt(-d.headroom)} GB</b>`;
  // flip the label to the left of the fill edge when it would clip the right border
  if(hp>78){ hd.classList.add('flip'); hd.style.left='auto'; hd.style.right=(100-hp)+'%'; hd.style.paddingLeft='0'; hd.style.paddingRight='8px'; }
  else { hd.classList.remove('flip'); hd.style.right='auto'; hd.style.left=hp+'%'; hd.style.paddingRight='0'; hd.style.paddingLeft='10px'; }
  const sc=$('lgScale'); sc.innerHTML='';
  const step=niceCeil(maxScale/8+0.0001);
  for(let i=0;i*step/2<=maxScale*1.001;i++){ const x2=i*step/2, major=i%2===0;
    const t=document.createElement('div');
    t.className='lg-tick'+(major?' major':''); t.style.left=pct(x2)+'%'; sc.appendChild(t);
    if(major){ const l=document.createElement('div'); l.className='lg-ticklab'; l.style.left=pct(x2)+'%';
      l.textContent=fmt(x2); sc.appendChild(l); } }
  $('ledgerNote').textContent=`scale 0–${fmt(maxScale)} GB · ${s.gpus}× ${g.name}`;
  const SEG={weights:cssVar('--seg-w'),kv:cssVar('--seg-kv'),act:cssVar('--seg-act'),ovh:cssVar('--seg-ovh')};
  $('lgLegend').innerHTML =
    [['Weights'+(d.replicas>1?' · '+d.replicas+' replicas':''),d.weightsAll,'weights'],['KV cache · '+d.active+' seq',d.kvTotal,'kv'],
     ['Activations',d.actAll,'act'],['Overhead · fixed+multi-GPU',d.fixed+d.multi,'ovh']]
    .map(([k,val,c])=>`<span class="lg-li"><span class="lg-sw" style="background:${SEG[c]}"></span><span class="k">${k}</span><span class="v">${fmt(val)} GB</span><span class="pct">${(val/d.total*100).toFixed(0)}%</span></span>`).join('')
    +`<span class="lg-li"><span class="lg-sw" style="background:${d.fits?'transparent':cssVar('--red')};border:1px solid var(--line)"></span><span class="k">Utilization</span><span class="v" style="color:${d.fits?'var(--teal-strong)':'var(--red)'}">${(d.total/d.avail*100).toFixed(1)}%</span></span>`;

  tween($('kpiTtft').querySelector('[data-v]'), d.ttft);
  tween($('kpiTps').querySelector('[data-v]'), d.tps);
  tween($('kpiAgg').querySelector('[data-v]'), d.agg);
  tween($('kpiLat').querySelector('[data-v]'), d.latency);
  $('kpiTtft').classList.toggle('miss', d.slo.ttft.on && !d.slo.ttft.pass);
  $('kpiTps').classList.toggle('miss', d.slo.tps.on && !d.slo.tps.pass);
  $('kpiLat').classList.toggle('miss', d.slo.p95.on && !d.slo.p95.pass);
  $('subTtft').textContent = `prefill ${fmtTok(s.resident)} tok on TP${s.tp} · MFU ${s.mfu}`;
  $('subTps').textContent = `ITL ${fmt(d.itl)} ms/tok · batch/replica ${fmt(d.batchPerRep)}`;
  $('subAgg').textContent = `${d.active} admitted × per-user · ${d.queued} queued`;
  $('subLat').textContent = `P95 ≈ ${fmt(d.p95)} s · generates ${fmt(d.genTok)} tok`;

  const rows=[['TTFT', d.slo.ttft, fmt(d.ttft)+' ms', s.sloTtft? '≤ '+fmt(s.sloTtft)+' ms':'off'],
              ['Per-user TPS', d.slo.tps, fmt(d.tps)+' tok/s', s.sloTps? '≥ '+fmt(s.sloTps):'off'],
              ['P95 latency', d.slo.p95, fmt(d.p95)+' s', s.sloP95? '≤ '+fmt(s.sloP95)+' s':'off']];
  $('sloRow').innerHTML = rows.map(([n,st,val,tgt])=>
    `<div class="slo ${st.on?(st.pass?'pass':'fail'):'off'}"><span class="dot"></span><span class="s-name">${n}</span><span class="s-val">${val} <span>· ${tgt}</span></span></div>`).join('');
  const ci=+$('selCase').value;
  $('sloNote').textContent = ci>=0? `targets from “${CASES[ci].name}”` : 'manual targets';

  renderBatchChart(s,d); renderCtxChart(s,d);

  const segs=[['TTFT',d.ttft,'ttft'],['Overhead',s.ovh,'ovh'],
              ['Reasoning',s.reasonTok? s.reasonTok/d.tps*1000:0,'reason'],
              ['Visible output',s.visibleOut/d.tps*1000,'out']].filter(x=>x[1]>0.01);
  const tot=segs.reduce((a,x)=>a+x[1],0);
  $('wfBar').innerHTML=segs.map(([n,ms,c])=>`<div class="wf-seg ${c}" style="width:${(ms/tot*100)}%" title="${n}: ${fmt(ms)} ms"></div>`).join('');
  $('wfLegend').innerHTML=segs.map(([n,ms,c])=>`<span class="lg-li"><span class="lg-sw wf-seg ${c}" style="width:10px;height:10px"></span><span class="k">${n}</span><span class="v">${ms>=1000? fmt(ms/1000)+' s': fmt(ms)+' ms'}</span></span>`).join('');
  $('wfTotal').textContent=`mean ${fmt(d.latency)} s · p95 ${fmt(d.p95)} s`;

  renderFleet(window.__prj);
  const topoInfo={procW:window.__prj.fleet.procW};
  window.__lastLat=d.latency;
  const nd=$('nrmDerived');
  if(nd){ const users=Math.max(1,+$('nrmUsers').value||1);
    const turns=+$('ccTurns').value||8, burst=+$('ccBurst').value||1.5;
    const dur=+$('ccDur').value>0? +$('ccDur').value : Math.min(120,Math.max(5,d.latency));
    const cc0=Math.max(1,+$('inConc').value||1);
    const pct=users>0? (100*cc0/users) : 0;
    const cs0=CASES[+$('selCase').value];
    nd.textContent = cs0&&cs0.traffic&&cs0.traffic.direct
      ? `→ ${fmt(cc0)} concurrent LLM calls (${esc(cs0.traffic.pct||'1:1 with users')})${UC[activeUc]&&UC[activeUc].concManual?' · set manually':''}`
      : `→ ${fmt(cc0)} concurrent LLM calls ≈ ${pct<1? pct.toFixed(1) : fmt(pct)}% of ${fmt(users)} active users in flight (${fmt(turns)} interactions/h · ${fmt(burst)}× burst · ${fmt(dur)} s/call)${UC[activeUc]&&UC[activeUc].concManual?' · set manually, users ignored':''}`; }
  const mb=$('miniBar');
  if(mb){ const F=window.__prj.fleet;
    const fits=F.fits, sloOk=F.sloAll;
    const gpus=F.procG, kw=F.kW;
    mb.className='mini-bar '+(fits? (sloOk?'':'warn'):'bad');
    $('mbLamp').title=fits? (sloOk?'Fits, SLOs met':'An SLO fails'):'Exceeds VRAM';
    $('mbText').textContent=`${gpus} GPUs · ≈${fmt(kw)} kW · ${fits? (sloOk?'fits · SLOs met':'SLO fails'):'over VRAM'}`; }

  const ins=[];
  if(!d.fits) ins.push(['bad',`Memory is the binding constraint: ${(d.total/d.avail*100).toFixed(0)}% of serving VRAM would be needed${d.replicas>1?`, dominated by ${d.replicas} replica copies of the weights (${fmt(d.weightsAll)} GB)`:''}. The Recommendations panel below lists the viable fixes.`]);
  if(d.effSeq>m.ctx) ins.push(['bad',`Resident sequence + reasoning (${fmtTok(d.effSeq)}) exceeds ${m.name}'s max context (${fmtTok(m.ctx)}): an unservable configuration. Trim resident tokens or pick a longer-context model.`]);
  if(s.tp>s.perW) ins.push(s.ic>0.75
    ? ['bad',`TP${s.tp} spans workers (${s.perW} GPU/worker): tensor-parallel traffic leaves the NVLink domain. Either raise GPUs per worker, lower TP, or set interconnect efficiency to 0.6–0.7 to model the cross-node penalty.`]
    : ['warn',`TP${s.tp} spans workers; the cross-node penalty is modeled via interconnect efficiency ${s.ic}. Prefill (TTFT) is still estimated optimistically across nodes; real systems typically use TP${s.perW} inside the node plus pipeline parallelism across nodes.`]);
  if(d.queued>0&&d.fits){ const bn=Math.ceil(s.concurrent/d.replicas);
    ins.push(['warn',`${d.queued} of ${s.concurrent} calls queue at peak (only ${d.active} admitted). ${bn<=Math.min(d.maxBatchMem||0,512)? `Raise max batch per replica to ${bn} to admit everyone.`:'Add workers or trim context to admit more.'}`]); }
  const admitCap=s.batch*d.replicas;
  if(d.replicas>1 && admitCap>=4*s.concurrent) ins.push(['warn',`Structural overprovision: ${d.replicas} replicas × batch ${s.batch} can admit ${fmt(admitCap)} calls, but peak demand is ${fmt(s.concurrent)}. Run Auto-size, or lower workers/TP, unless the extra copies are deliberate burst headroom.`]);
  if(d.kvTotal>d.weightsAll) ins.push(['warn',`KV-dominated deployment: cache (${fmt(d.kvTotal)} GB) outweighs weights (${fmt(d.weightsAll)} GB). FP8/INT8 KV, compressed-KV models, or shorter resident sequences pay off most here.`]);
  if(d.slo.ttft.on&&!d.slo.ttft.pass) ins.push(['bad',`Prefill misses the TTFT target. Options: prefix caching for repeated prompts, chunked prefill, TP ${s.tp}→${Math.min(s.tp*2,s.gpus)}, or a higher-TFLOPS part; disaggregated prefill serving (NVIDIA Dynamo, Mooncake-style) exists for exactly this.`]);
  if(/MHA/.test(m.arch||'')) ins.push(['warn',`${m.name.split(' ')[0]} uses full multi-head attention: KV is ${fmt(d.kvTok*1e3)} MB per token, an order beyond GQA peers. Budget context tightly.`]);
  if(/Unified/i.test(g.mem)) ins.push(['warn','Unified-memory hardware: capacity is generous but bandwidth caps decode speed: fine for single-user or development, not for concurrent serving.']);
  if(prelaunch) ins.push(['warn','Selected GPU is announced but not shipping: specs are pre-launch estimates; re-validate against datasheets before committing a proposal.']);
  if(s.policy==='all'&&d.allActiveVram>d.avail&&d.fits) ins.push(['warn',`Keeping every session in KV would need ${fmt(d.allActiveVram)} GB: the running-batch policy is what makes this configuration fit.`]);
  if(ins.length===0&&d.fits) ins.push(['ok',`Balanced configuration: ${(d.total/d.avail*100).toFixed(0)}% memory utilization, ${fmt(d.tps)} tok/s per user at batch ${fmt(d.batchPerRep)}, ${fmt(d.headroom)} GB headroom for growth.`]);
  ins.push(['ok',`Marginal cost of one more admitted call: ${fmt(d.kvDelta)} GB of KV. Speculative decoding (EAGLE-3 / MTP) would add 1.5–3× on top of the decode figures.`]);
  $('insights').innerHTML=ins.slice(0,5).map(([c,t])=>`<div class="ins ${c==='ok'?'':c}">${t}</div>`).join('');

  const rb=buildRecs(s,d,m,g,prelaunch);
  $('recBottleneck').textContent = rb.bottleneck==='none'? 'no active bottleneck' : 'primary bottleneck: '+rb.bottleneck;
  $('recs').innerHTML = rb.recs.map(r=>`<div class="rec ${r.lv}"><div class="r-t">${r.t}</div><div class="r-b">${r.b}</div></div>`).join('');

  const dur = +$('ccDur').value>0? +$('ccDur').value : d.latency;
  const cc = Math.ceil((+$('ccSessions').value||0)*(+$('ccTurns').value||0)*((+$('ccShare').value||0)/100)*(+$('ccCalls').value||0)*dur/3600*(+$('ccBurst').value||1));
  $('ccDerived').textContent=`→ ${cc} concurrent calls (call ≈ ${fmt(dur)} s${+$('ccDur').value>0?'':' · model-derived'})`;
  $('ccDerived').dataset.cc=cc;

  renderUcCards();
  const prj=renderProject();
  if(prj){
    const F=prj.fleet;
    $('verdict').className='panel verdict '+(F.fits? (F.sloAll?'ok':'warn') : 'bad');
    $('vMain').textContent = F.fits? (F.sloAll? 'Project fits & SLO targets met' : 'Project fits · an SLO target fails') : 'Project exceeds GPU memory';
    $('vKv').innerHTML = `<b>${fmt(F.vramNeed)} GB</b> required · <b>${fmt(F.vramAvail)} GB</b> across ${F.activeG+F.supG} active GPUs${F.spare?` · ${F.spare} spare`:''}`;
    $('vSub').textContent = `${prj.pools.length} pool${prj.pools.length>1?'s':''} · ${F.procG} GPUs procured · ≈${fmt(F.kW)} kW`;
  }
  $('story').innerHTML = (window.__prj && UC.length>1)? buildProjectSummary(window.__prj) : buildStory(s,d,m,g);
  $('printInputs').innerHTML = '<div class="pi-title">'+(window.__prj&&UC.length>1? 'Inputs · pool '+m.name+' '+s.wq.name+' ('+UC.length+' use cases; project panel below lists all)' : 'Inputs · complete configuration')+'</div><div class="pi-grid">'+[
    ['Model', m.name],['Total params', fmt(s.params)+' B'],['Active params', fmt(s.active)+' B'],
    ['Geometry', s.layers+'L · h'+s.hidden+' · KV '+s.kvHeads+'×'+s.headDim],['Max context', fmtTok(m.ctx)],
    ['Weights quant', s.wq.name+' ('+s.bytesW+' B/param)'],['KV quant', s.kq.name+' ('+s.bytesK+' B/elem)'],
    ['Resident sequence', fmtTok(s.resident)],['Visible output', fmtTok(s.visibleOut)],
    ['Reasoning', s.reasonMode+' ('+fmtTok(s.reasonTok)+(s.extend?', extends KV':'')+')'],
    ['Concurrent calls', s.concurrent],['Max batch / replica', s.batch],
    ['KV policy', s.policy==='all'?'all sessions resident':'running batch only'],
    ['GPU', g.name],['GPU memory', fmt(s.gpuVram)+' GB · '+fmt(s.gpuBw)+' TB/s'],['Dense FP16 TC', fmt(s.gpuTflops)+' TFLOPS'],
    ['Workers (N)', s.workers],['GPUs per worker', s.perW],['Tensor parallel', 'TP'+s.tp],
    ['Resilience', RESIL[s.resil].long],['Prefill MFU', s.mfu],['Decode MBU', s.mbu],
    ['Interconnect eff.', s.ic],['Framework overhead', fmt(s.ovh)+' ms'],
    ['SLO targets', (s.sloTtft||'off')+' ms · '+(s.sloTps||'off')+' tok/s · '+(s.sloP95||'off')+' s'],
  ].map(([k,v])=>'<div class="pi-row"><span class="k">'+k+'</span><span class="v">'+v+'</span></div>').join('')+'</div>';
  $('printConfig').textContent = window.__prj&&UC.length>1
    ? `GPUscale.net · ${projName()} · ${UC.length} use cases in ${window.__prj.pools.length} pool(s) on ${g.name} · `+
      window.__prj.pools.map(p=>`${p.state.model.name} ${p.state.wq.name} TP${p.state.tp}×${p.state.workers}w`).join(' + ')+
      ` · ${window.__prj.fleet.procG} GPUs procured (${RESIL[s.resil].label}) · ≈${fmt(window.__prj.fleet.kW)} kW · ${new Date().toLocaleDateString()}`
    : `GPUscale.net · ${projName()} · ${m.name} · weights ${s.wq.name} / KV ${s.kq.name} · seq ${fmtTok(s.resident)} (+${fmtTok(s.reasonTok)} reasoning) · `+
      `${s.concurrent} concurrent, batch ${s.batch}/replica · ${s.workers}× worker (${s.perW} GPU) ${g.name} · TP${s.tp} · ${RESIL[s.resil].long} → ${topoInfo.procW} workers procured · ${new Date().toLocaleDateString()}`;
  if(window.__prj && UC.length>1) renderProjectReport(window.__prj); else restoreSingleReport();
}

/* ================= PRESETS ================= */
function applyCase(i){
  if(i<0) return;
  const c=CASES[i];
  const u=UC[activeUc];
  if(u){ u.supports=defaultSupports(i);
    if(u.supports.length) announce('Attached to '+(c.name)+': '+u.supports.map(sp=>(SUP_KIND(sp.kind)||{label:sp.kind}).label+' ('+sp.model+')').join(', ')); }
  const tr=c.traffic;
  if(tr){ $('ccTurns').value=tr.turns; $('ccCalls').value=tr.calls; $('ccBurst').value=tr.burst;
    $('ccDur').value=tr.durS||0; $('ccShare').value=100; }
  if(c.resident) $('inSeq').value=c.resident;
  if(c.visibleOut) $('inOut').value=c.visibleOut;
  $('selReason').value=REASON_TOK.hasOwnProperty(c.reasoning)?c.reasoning:'None';
  syncReason();
  $('sloTtft').value=c.ttftTarget; $('sloTps').value=c.tpsTarget; $('sloP95').value=c.p95Target;
  refreshCtl('inSeq'); refreshCtl('inOut');
  if(UC[activeUc]) applyNrmUsers();
}
function syncReason(){
  const mode=$('selReason').value, el=$('inReasonTok'), rng=$('inReasonTok_r');
  if(mode==='Custom'){ el.disabled=false; rng.disabled=false; if(+el.value===0) el.value=REASON_TOK.Custom; }
  else { el.disabled=true; rng.disabled=true; el.value=REASON_TOK[mode]||0; }
  refreshCtl('inReasonTok');
}

/* ================= PROJECT USE-CASE STATE ================= */
/* The Model/Precision/Workload stations are one editor bound to the active card.
   captureUc pulls the editor DOM into the active use case; loadUc pushes a card
   back into the editor. Hardware, resilience and tuning stay project-global. */
const UC_KEYS=['chkCustom','selModel','cusParams','cusActive','cusHidden','cusLayers','cusKvh','cusHdim','cusCtx',
  'selWQuant','selKQuant','selCase','inSeq','inOut','selReason','inReasonTok','chkExtend',
  'inConc','inBatch','selPolicy','sloTtft','sloTps','sloP95',
  'ccSessions','ccTurns','ccShare','ccCalls','ccBurst','ccDur','inWorkers','inTp','nrmUsers'];
const UC_CHECKS={chkCustom:1,chkExtend:1};
let UC=[], activeUc=0, ucSeq=0;
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const UCCOL=i=>'var(--pool'+(i%6)+')';
function captureUc(){ const u=UC[activeUc]; if(!u) return;
  UC_KEYS.forEach(id=>{ const el=$(id); if(el) u.f[id]=UC_CHECKS[id]? el.checked : el.value; }); }
function loadUc(i){ activeUc=Math.max(0,Math.min(UC.length-1,i)); const u=UC[activeUc]; if(!u) return;
  UC_KEYS.forEach(id=>{ const el=$(id); if(el&&u.f[id]!==undefined){ if(UC_CHECKS[id]) el.checked=!!u.f[id]; else el.value=u.f[id]; } });
  $('customBox').style.display=$('chkCustom').checked?'block':'none';
  $('selModel').disabled=$('chkCustom').checked;
  syncReason(); Object.keys(FIELDS).forEach(refreshCtl); }
function ucName(u){ if(u.name) return u.name;
  const ci=+u.f.selCase; if(ci>=0&&CASES[ci]) return CASES[ci].name;
  return ucModelName(u); }
function ucModelName(u){ return u.f.chkCustom? 'Custom model' : ((MODELS[+u.f.selModel||0]||{}).name||'?'); }
const SUP_KIND=k=>SUPPORT.kinds.find(x=>x.key===k);
const SUP_DEFAULT=k=>SUPPORT.models.find(m=>m.kind===k&&m.default)||SUPPORT.models.find(m=>m.kind===k);
const SUP_MODEL=(k,name)=>SUPPORT.models.find(m=>m.kind===k&&m.name===name)||SUP_DEFAULT(k);
function defaultSupports(ci){ const c=CASES[ci]; if(!c||!c.supports) return [];
  return c.supports.map(k=>{ const d=SUP_DEFAULT(k); return d? {kind:k, model:d.name, on:true} : null; }).filter(Boolean); }
function announce(msg){ const el=$('live'); if(el){ el.textContent=''; setTimeout(()=>{ el.textContent=msg; },30); } }
function poolKey(u){ const f=u.f;
  const mk=f.chkCustom? 'custom:'+[f.cusParams,f.cusActive,f.cusHidden,f.cusLayers,f.cusKvh,f.cusHdim].join(',') : 'm'+(+f.selModel||0);
  return mk+'|q'+(+f.selWQuant||0)+'|k'+(+f.selKQuant||0)+'|p'+(f.selPolicy||''); }
let renamingUc=null, chipEdit=null;
function renderUcCards(){ const box=$('ucCards'); if(!box||!UC.length) return; captureUc();
  const keys=UC.map(poolKey), pooled=k=>keys.filter(x=>x===k).length>1;
  box.innerHTML=UC.map((u,i)=>{ const f=u.f, wq=QUANTS[+f.selWQuant||0]||{};
    const name = renamingUc===i
      ? `<input class="uc-rename" data-ren-input="${i}" type="text" maxlength="40" value="${esc(ucName(u))}" aria-label="Use case name">`
      : `<span class="uc-name">${esc(ucName(u))}</span>`;
    const pool = pooled(keys[i])? `<span class="uc-pool" title="Same model, precision and KV policy as another use case: served by one shared pooled deployment">pooled</span>` : '';
    const defs = (CASES[+f.selCase]&&CASES[+f.selCase].supports)||[];
    const chips = (u.supports||[]).map((sp,ci2)=>{ const kd=SUP_KIND(sp.kind)||{label:sp.kind};
      return `<span class="chip${chipEdit&&chipEdit.uc===i&&chipEdit.kind===sp.kind?' open':''}" data-chip="${i}:${sp.kind}" role="button" tabindex="0" title="${esc(sp.model||'')} · click to inspect">${esc(kd.label)}<button class="chip-x" data-chipx="${i}:${sp.kind}" type="button" aria-label="Remove ${esc(kd.label)} from ${esc(ucName(u))}">×</button></span>`; }).join('');
    const ghosts = defs.filter(k=>!(u.supports||[]).some(sp=>sp.kind===k)).map(k=>{ const kd=SUP_KIND(k)||{label:k};
      return `<span class="chip ghost" data-chipadd="${i}:${k}" role="button" tabindex="0" title="Re-attach ${esc(kd.label)}">+ ${esc(kd.label)}</span>`; }).join('');
    let editor='';
    if(chipEdit&&chipEdit.uc===i){ const sp=(u.supports||[]).find(x=>x.kind===chipEdit.kind);
      if(sp){ const sm=SUP_MODEL(sp.kind,sp.model)||{}; const kd=SUP_KIND(sp.kind)||{label:sp.kind};
        const opts=SUPPORT.models.filter(m=>m.kind===sp.kind).map(m=>`<option${m.name===sp.model?' selected':''}>${esc(m.name)}</option>`).join('');
        editor=`<div class="chip-editor"><div class="ce-row adv"><label>${esc(kd.label)} model</label><select data-chipsel="${i}:${sp.kind}">${opts}</select></div><div class="ce-note">${esc(sm.note||'')} · ~${sm.vram} GB per instance, one instance per ~${sm.cap} concurrent</div></div>`; } }
    return `<div class="uc-card${i===activeUc?' active':''}" data-i="${i}" style="--uccol:${UCCOL(i)}" role="listitem" tabindex="0" aria-label="Use case ${esc(ucName(u))}${i===activeUc?', being edited':''}">
      <div class="uc-line">${name}${pool}
        <button class="uc-tool" data-ren="${i}" type="button" title="Rename" aria-label="Rename ${esc(ucName(u))}"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/></svg></button>
        <button class="uc-tool" data-dup="${i}" type="button" title="Duplicate" aria-label="Duplicate ${esc(ucName(u))}"><svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg></button>
        ${UC.length>1?`<button class="uc-x" data-x="${i}" type="button" title="Remove this use case" aria-label="Remove ${esc(ucName(u))}">×</button>`:''}</div>
      <div class="uc-meta">${esc(ucModelName(u))} · ${esc(wq.name||'')} · ${f.inConc||0} concurrent</div>
      ${chips||ghosts?`<div class="uc-chips">${chips}${ghosts}</div>`:''}${editor}</div>`; }).join('');
  if(renamingUc!=null){ const inp=box.querySelector('[data-ren-input]'); if(inp){ inp.focus(); inp.select(); } }
  const tag=ucName(UC[activeUc]);
  ['ctxModel','ctxPrec','ctxWork'].forEach(id=>{ const el=$(id); if(el) el.textContent = UC.length>1? tag : ''; });
  ['stWork','stModel','stPrec'].forEach(id=>{ const el=$(id);
    if(el) el.style.setProperty('--uccol', UC.length>1? UCCOL(activeUc) : 'var(--line-soft)'); });
  const hwc=$('ctxHw'); if(hwc) hwc.textContent = UC.length>1? 'project-wide · all use cases' : ''; }
function selectUc(i){ if(i===activeUc){ return; } captureUc(); loadUc(i); renderUcCards(); render(); }
function addUc(){ captureUc(); const base=UC[activeUc];
  const u={id:'uc'+(++ucSeq), name:'', f:Object.assign({},base?base.f:{}), supports:[], isolate:false};
  UC.push(u); loadUc(UC.length-1);
  const ci=CASES.findIndex(c=>/Simple chatbot/.test(c.name));
  if(ci>=0){ $('selCase').value=ci; applyCase(ci); }
  captureUc();
  const prj=computeProject();
  const p=prj.pools.find(p2=>p2.members.includes(UC.length-1));
  if(p && p.members.length===1){ const r=solvePool(p.state);
    if(r.ok){ u.f.inTp=r.tp; u.f.inWorkers=r.workers; u.f.inBatch=r.batch; loadUc(UC.length-1); } }
  renderUcCards(); render();
  toast('Use case added: pick its type and model below'); }
function duplicateUc(i){ captureUc(); const base=UC[i]; if(!base) return;
  const u={id:'uc'+(++ucSeq), name:(ucName(base)+' copy').slice(0,40),
    f:Object.assign({},base.f), supports:(base.supports||[]).map(sp=>Object.assign({},sp)), isolate:!!base.isolate};
  UC.splice(i+1,0,u); loadUc(i+1); renderUcCards(); render();
  toast('Duplicated: '+ucName(base)); }
let __removedUc=null;
function removeUc(i){ if(UC.length<=1) return; const gone=ucName(UC[i]);
  __removedUc={uc:UC[i], at:i};
  UC.splice(i,1);
  if(activeUc>=UC.length) activeUc=UC.length-1; else if(i<activeUc) activeUc--;
  loadUc(activeUc); renderUcCards(); render();
  toast('Removed: '+gone, false, {label:'Undo', fn:()=>{ if(!__removedUc) return;
    UC.splice(Math.min(__removedUc.at,UC.length),0,__removedUc.uc); __removedUc=null;
    loadUc(activeUc); renderUcCards(); render(); }}); }
function commitRename(inp){ const i=+inp.dataset.renInput, v=inp.value.trim();
  if(UC[i]) UC[i].name=v; renamingUc=null; renderUcCards(); }
function chipAct(e){
  const cx=e.target.closest('[data-chipx]'); if(cx){ const [i,k]=cx.dataset.chipx.split(':'); const u=UC[+i];
    u.supports=(u.supports||[]).filter(sp=>sp.kind!==k);
    if(chipEdit&&chipEdit.uc===+i&&chipEdit.kind===k) chipEdit=null;
    announce((SUP_KIND(k)||{label:k}).label+' removed from '+ucName(u)); renderUcCards(); render(); return true; }
  const ca=e.target.closest('[data-chipadd]'); if(ca){ const [i,k]=ca.dataset.chipadd.split(':'); const u=UC[+i];
    const d=SUP_DEFAULT(k); if(d){ (u.supports=u.supports||[]).push({kind:k, model:d.name, on:true});
    announce((SUP_KIND(k)||{label:k}).label+' ('+d.name+') attached to '+ucName(u)); }
    renderUcCards(); render(); return true; }
  const ch=e.target.closest('[data-chip]'); if(ch){ const [i,k]=ch.dataset.chip.split(':');
    chipEdit = chipEdit&&chipEdit.uc===+i&&chipEdit.kind===k? null : {uc:+i, kind:k};
    renderUcCards(); return true; }
  return false;
}
$('ucCards').addEventListener('click',e=>{
  const ri=e.target.closest('[data-ren-input]'); if(ri) return;
  const rn=e.target.closest('[data-ren]'); if(rn){ captureUc(); renamingUc=+rn.dataset.ren; renderUcCards(); return; }
  const dp=e.target.closest('[data-dup]'); if(dp){ duplicateUc(+dp.dataset.dup); return; }
  const x=e.target.closest('.uc-x'); if(x){ removeUc(+x.dataset.x); return; }
  if(chipAct(e)) return;
  const card=e.target.closest('.uc-card'); if(card) selectUc(+card.dataset.i); });
$('ucCards').addEventListener('keydown',e=>{
  const ri=e.target.closest('[data-ren-input]');
  if(ri){ if(e.key==='Enter'){ e.preventDefault(); commitRename(ri); } if(e.key==='Escape'){ renamingUc=null; renderUcCards(); } return; }
  if(e.key!=='Enter'&&e.key!==' ') return;
  if(e.target.closest('[data-chip],[data-chipadd],[data-chipx]')){ e.preventDefault(); chipAct(e); return; }
  const card=e.target.closest('.uc-card'); if(card){ e.preventDefault(); selectUc(+card.dataset.i); } });
$('ucCards').addEventListener('focusout',e=>{
  const ri=e.target.closest&&e.target.closest('[data-ren-input]'); if(ri&&renamingUc!=null) commitRename(ri); });
$('ucCards').addEventListener('change',e=>{
  const cs=e.target.closest('[data-chipsel]'); if(!cs) return;
  const [i,k]=cs.dataset.chipsel.split(':'); const u=UC[+i];
  const sp=(u.supports||[]).find(x=>x.kind===k); if(sp){ sp.model=cs.value;
    announce((SUP_KIND(k)||{label:k}).label+' model set to '+cs.value); renderUcCards(); render(); } });
$('btnAddUc').addEventListener('click',addUc);
function ucToConfig(u){ const f=u.f;
  const wq=QUANTS[+f.selWQuant||0]||QUANTS[0], kq=KV_QUANTS[+f.selKQuant||0]||KV_QUANTS[0];
  const ci=+f.selCase;
  return {
    model: f.chkCustom? {custom:true, params:+f.cusParams, active:+f.cusActive, hidden:+f.cusHidden,
      layers:+f.cusLayers, kvHeads:+f.cusKvh, headDim:+f.cusHdim, ctx:+f.cusCtx}
      : {custom:false, name:((MODELS[+f.selModel||0]||{}).name||'')},
    weightQuant:wq.name, kvQuant:kq.name,
    preset: ci>=0&&CASES[ci]? CASES[ci].name : null,
    residentSeq:+f.inSeq, visibleOut:+f.inOut,
    reasoning:{mode:f.selReason, tokens:+f.inReasonTok, extendsKV:!!f.chkExtend},
    concurrentCalls:+f.inConc, maxBatchPerReplica:+f.inBatch, kvPolicy:f.selPolicy,
    hardware:{workers:+f.inWorkers, tensorParallel:+f.inTp},
    sloTargets:{ttftMs:+f.sloTtft||0, tps:+f.sloTps||0, p95s:+f.sloP95||0},
    estimator:{sessions:+f.ccSessions||0, turnsPerHour:+f.ccTurns||0, pctTurnsLLM:+f.ccShare||0,
      callsPerTurn:+f.ccCalls||0, burst:+f.ccBurst||1, callDurS:+f.ccDur||0},
  };
}
function ucSnapshot(u){ const f=u.f;
  const m=f.chkCustom? {name:'Custom', params:+f.cusParams, active:+f.cusActive, hidden:+f.cusHidden,
      layers:+f.cusLayers, kvHeads:+f.cusKvh, headDim:+f.cusHdim, ctx:+f.cusCtx, arch:'Custom', dev:'—'}
    : (MODELS[+f.selModel||0]||MODELS[0]);
  const wq=QUANTS[+f.selWQuant||0]||QUANTS[0], kq=KV_QUANTS[+f.selKQuant||0]||KV_QUANTS[0];
  return {model:{name:m.name, params:m.params, active:m.active, hidden:m.hidden, layers:m.layers,
      kvHeads:m.kvHeads, headDim:m.headDim, ctx:m.ctx, arch:m.arch||'', dev:m.dev||''},
    weightBytes:wq.bytes, kvBytes:kq.bytes};
}

/* ================= PROJECT ENGINE (multi-pool) ================= */
/* Pools group use cases that share model+precision+KV policy (unless isolated):
   one pooled deployment is sized for the combined load. Support models are
   aggregated per kind+model and packed onto GPU partitions. */
const uv=(f,id)=>{ const c=FIELDS[id]; const raw=(f[id]===''||f[id]==null)? c.val : +f[id];
  const v=isFinite(raw)? raw : c.val; return Math.min(c.max, Math.max(c.min, v)); };
function readHw(){
  const g=GPUS[+$('selGpu').value||0];
  const fv=id=>{ const c=FIELDS[id]; const raw=$(id).value===''? c.val : +$(id).value;
    const v=isFinite(raw)? raw : c.val; return Math.min(c.max, Math.max(c.min, v)); };
  return {g, perW:Math.round(fv('inPerW')), resil:$('selResil').value,
    mfu:fv('inMfu'), mbu:fv('inMbu'), ic:fv('inIc'), ovh:fv('inOvh')};
}
function ucState(u, hw){
  hw=hw||readHw(); const f=u.f;
  const m=f.chkCustom? {name:'Custom', params:+f.cusParams||0.1, active:+f.cusActive||0.1,
      hidden:+f.cusHidden||64, layers:+f.cusLayers||1, kvHeads:+f.cusKvh||1,
      headDim:+f.cusHdim||8, ctx:+f.cusCtx||1024, arch:'Custom', dev:'—', url:''}
    : (MODELS[+f.selModel||0]||MODELS[0]);
  const wq=QUANTS[+f.selWQuant||0]||QUANTS[0], kq=KV_QUANTS[+f.selKQuant||0]||KV_QUANTS[0];
  const workers=Math.round(uv(f,'inWorkers')), gpus=workers*hw.perW;
  const tp=Math.min(Math.round(uv(f,'inTp')), gpus);
  return {model:m, gpu:hw.g, wq, kq,
    params:m.params, active:m.active, hidden:m.hidden, layers:m.layers,
    kvHeads:m.kvHeads, headDim:m.headDim, ctx:m.ctx,
    bytesW:wq.bytes, bytesK:kq.bytes,
    resident:Math.round(uv(f,'inSeq')), visibleOut:Math.round(uv(f,'inOut')),
    reasonMode:f.selReason||'None', reasonTok:Math.round(uv(f,'inReasonTok')),
    extend:!!f.chkExtend,
    concurrent:Math.round(uv(f,'inConc')), batch:Math.round(uv(f,'inBatch')),
    policy:f.selPolicy||'run',
    workers, perW:hw.perW, gpus, tp, resil:hw.resil,
    gpuVram:hw.g.vram, gpuBw:hw.g.bw, gpuTflops:hw.g.tflops,
    mfu:hw.mfu, mbu:hw.mbu, ic:hw.ic, ovh:hw.ovh,
    sloTtft:+f.sloTtft||0, sloTps:+f.sloTps||0, sloP95:+f.sloP95||0};
}
function poolState(pool, hw){
  const states=pool.members.map(i=>ucState(UC[i], hw));
  const base=states[0];
  const conc=states.reduce((t,s)=>t+s.concurrent,0)||1;
  const wavg=get=>states.reduce((t,s)=>t+get(s)*s.concurrent,0)/conc;
  return Object.assign({}, base, {
    concurrent:conc,
    resident:Math.round(wavg(s=>s.resident)),
    visibleOut:Math.round(wavg(s=>s.visibleOut)),
    reasonTok:Math.round(wavg(s=>s.extend||s.reasonTok>0? s.reasonTok:0)),
    extend:states.some(s=>s.extend&&s.reasonTok>0),
    batch:Math.max.apply(null, states.map(s=>s.batch)),
    sloTtft:0,
    sloTps:Math.max.apply(null, states.map(s=>s.sloTps).concat([0])),
    sloP95:0,
  });
}
function computeProject(){
  const hw=readHw();
  const pools=[];
  UC.forEach((u,i)=>{ const k=u.isolate? 'iso:'+u.id : poolKey(u);
    let p=pools.find(x=>x.key===k); if(!p){ p={key:k, members:[]}; pools.push(p); }
    p.members.push(i); });
  pools.forEach(p=>{
    p.state=poolState(p, hw);
    const nzmin=(vals)=>{ const n=vals.filter(v=>v>0); return n.length? Math.min.apply(null,n) : 0; };
    p.state.sloTtft=nzmin(p.members.map(i=>+UC[i].f.sloTtft||0));
    p.state.sloP95=nzmin(p.members.map(i=>+UC[i].f.sloP95||0));
    p.d=compute(p.state);
    // demand cap: keep only the replicas the peak load needs; the rest of the
    // pool's GPUs become spares (shown dashed, reused for supporting models)
    // instead of extra model copies nobody asked for.
    const needReps=Math.max(1, Math.ceil(p.state.concurrent/Math.max(1,p.state.batch)));
    if(UC.length>1 && p.d.replicas>needReps){
      p.capped=p.d.replicas;
      p.d=compute(Object.assign({}, p.state, {gpus:needReps*p.state.tp}));
    }
    p.perUc=p.members.map(i=>{
      const s=ucState(UC[i], hw);
      s.tp=p.state.tp; s.workers=p.state.workers; s.gpus=p.d.replicas*p.state.tp; s.batch=p.state.batch;
      const d=compute(s);
      const share=Math.min(s.concurrent, Math.round(p.d.active*s.concurrent/Math.max(1,p.state.concurrent)));
      return {i, uc:UC[i], s, d, share};
    });
  });
  const sup=allocSupports(hw);
  const fleet=fleetTotals(pools, sup, hw);
  return {pools, sup, fleet, hw};
}
function allocSupports(hw){
  const g=hw.g, part=g.part||{kind:'frac'};
  const agg={};
  UC.forEach((u,idx)=>{ const conc=Math.round(uv(u.f,'inConc'));
    (u.supports||[]).forEach(sp=>{ const m=SUP_MODEL(sp.kind, sp.model); if(!m) return;
      const key=sp.kind+'|'+m.name;
      const a=agg[key]=agg[key]||{kind:sp.kind, model:m, demand:0, ucIdx:[]};
      a.demand+=conc; a.ucIdx.push(idx); }); });
  const items=Object.values(agg).map(a=>Object.assign({}, a,
    {instances:Math.max(1, Math.ceil(a.demand/a.model.cap))}));
  const totalVram=items.reduce((t,it)=>t+it.instances*it.model.vram,0);
  if(!items.length) return {items, gpus:0, mode:part.kind, layout:[], totalVram:0, note:''};
  const layout=[]; let note='';
  const sliceable = part.kind==='mig'||part.kind==='cpx';
  if(sliceable){
    // one slice unit = the part's smallest partition. A model larger than one unit
    // takes a wider profile (ceil units); smaller models co-host several instances
    // inside one unit (they are VRAM-bound at this scale, so instances pack by memory).
    items.forEach(it=>{
      if(it.model.vram>part.min){
        it.units=Math.min(part.max, Math.ceil(it.model.vram/part.min));
        it.perSlice=1; it.sliceCount=it.instances;
      } else {
        it.units=1; it.perSlice=Math.max(1, Math.floor(part.min/it.model.vram));
        it.sliceCount=Math.ceil(it.instances/it.perSlice);
      } });
    items.slice().sort((x,y)=>y.units-x.units).forEach(it=>{
      for(let n=0;n<it.sliceCount;n++){
        const inst=Math.min(it.perSlice, it.instances-n*it.perSlice);
        let bin=layout.find(b=>b.used+it.units<=part.max);
        if(!bin){ bin={used:0, slices:[]}; layout.push(bin); }
        bin.used+=it.units;
        bin.slices.push({kind:it.kind, model:it.model.name, gb:Math.min(g.vram, it.units*part.min), n:it.units, inst});
      } });
    note = part.kind==='mig'
      ? `isolated MIG slices (${part.max} per GPU, ${part.min} GB granularity)`
      : `isolated compute partitions (${part.max} per GPU, ${part.min} GB each)`;
  } else {
    const cap = part.kind==='whole'? g.vram : 0.9*g.vram;
    items.slice().sort((x,y)=>y.model.vram-x.model.vram).forEach(it=>{
      for(let n=0;n<it.instances;n++){
        let bin=layout.find(b=>b.used+it.model.vram<=cap);
        if(!bin){ bin={used:0, slices:[]}; layout.push(bin); }
        bin.used+=it.model.vram;
        bin.slices.push({kind:it.kind, model:it.model.name, gb:it.model.vram, n:0});
      } });
    note = part.kind==='whole'
      ? `whole-card granularity: ${g.name} has no partitioning; co-residency within one card only via one serving container`
      : `fractional sharing (time-slice / MPS): no memory or fault isolation on ${g.name}`;
  }
  return {items, gpus:layout.length, mode:part.kind, layout, totalVram, note};
}
function fleetTotals(pools, sup, hw){
  const info=RESIL[hw.resil]||RESIL.n;
  const servW=pools.reduce((t,p)=>t+p.state.workers,0);
  const servG=pools.reduce((t,p)=>t+p.state.gpus,0);
  const spare=pools.reduce((t,p)=>t+Math.max(0, p.state.gpus - p.d.replicas*p.state.tp),0);
  const supG=sup.gpus||0;
  const supExtraG=Math.max(0, supG-spare);
  const supNodes=Math.ceil(supExtraG/hw.perW);
  const resilW=pools.reduce((t,p)=>t+info.mult(p.state.workers),0)+info.add;
  const procW=servW+resilW+supNodes;
  const procG=procW*hw.perW;
  const activeG=pools.reduce((t,p)=>t+p.d.replicas*p.state.tp,0);
  return {servW, servG, activeG, spare, supG, supExtraG, supNodes, resilW, procW, procG,
    kW:procG*hw.g.watts/1000,
    fits:pools.every(p=>p.d.fits),
    sloAll:pools.every(p=>p.perUc.every(x=>x.d.sloAll)),
    agg:pools.reduce((t,p)=>t+p.d.agg,0),
    vramNeed:pools.reduce((t,p)=>t+p.d.total,0)+sup.totalVram,
    vramAvail:pools.reduce((t,p)=>t+p.d.avail,0)+supG*hw.g.vram};
}

/* ================= PROJECT RESULTS (fleet map + per-usecase cards) ================= */
const KIND_LABEL={embed:'Embeddings',rerank:'Reranker',asr:'ASR',tts:'TTS',ocr:'OCR',guard:'Guard'};
/* small stroked icons for result surfaces */
const RICO={
  users:'<path d="M8 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 8 11zM2.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><path d="M15.5 11a2.8 2.8 0 1 0-.01-5.6M16.5 15.2c2.6.3 5 2.1 5 4.8"/>',
  chip:'<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  layers:'<path d="M12 3 3 8l9 5 9-5-9-5z"/><path d="M3 12.5l9 5 9-5"/>',
  puzzle:'<path d="M9 4h4a1 1 0 0 1 1 1v2h2a2 2 0 1 1 0 4h-2v3h3a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4v-2a2 2 0 1 0-4 0v2H5a1 1 0 0 1-1-1v-4h2a2 2 0 1 0 0-4H4V5a1 1 0 0 1 1-1h4z"/>',
  shield:'<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z"/>',
  flag:'<path d="M5 21V4M5 4h12l-2.5 3.5L17 11H5"/>',
  chat:'<path d="M4 5h16v11H9l-5 4V5z"/>',
  gauge:'<path d="M4.5 16.5a8.5 8.5 0 1 1 15 0"/><path d="M12 13.5l3.6-3.6"/>',
  zap:'<path d="M13 2 4.5 14H11l-1 8 8.5-12H12l1-8z"/>',
};
const rico=(k,cls)=>`<svg class="${cls||'ri'}" viewBox="0 0 24 24" aria-hidden="true">${RICO[k]||RICO.flag}</svg>`;
function buildProjectSummary(prj){
  const {pools, sup, fleet, hw}=prj;
  const info=RESIL[hw.resil]||RESIL.n;
  const li=(icon,html,cls)=>`<li class="${cls||''}">${rico(icon)}<span>${html}</span></li>`;
  let h='';
  h+=`<div class="sum-head">${UC.length} use case${UC.length>1?'s':''} in ${pools.length} pool${pools.length>1?'s':''} on <b>${esc(hw.g.name)}</b> · <b>${fleet.procW} nodes · ${fleet.procG} GPUs · ≈${fmt(fleet.kW)} kW</b> procured (${esc(info.label)})</div>`;
  h+='<div class="sum-cap">Use cases · demand</div><ul class="sum">';
  pools.forEach((p,pi)=>p.perUc.forEach(x=>{
    const f=x.uc.f; const users=Math.max(1,+f.nrmUsers||1);
    const pct=100*x.s.concurrent/users;
    const fails=[];
    if(x.s.sloTtft>0&&!x.d.slo.ttft.pass) fails.push(`TTFT ${fmt(x.d.ttft)} ms > ${fmt(x.s.sloTtft)}`);
    if(x.s.sloTps>0&&!x.d.slo.tps.pass) fails.push(`speed ${fmt(x.d.tps)} < ${fmt(x.s.sloTps)} tok/s`);
    if(x.s.sloP95>0&&!x.d.slo.p95.pass) fails.push(`P95 ${fmt(x.d.p95)} s > ${fmt(x.s.sloP95)}`);
    h+=li('users',`<b>${esc(ucName(x.uc))}</b> · ${fmt(users)} active users → <b>${fmt(x.s.concurrent)} concurrent calls</b> (${pct<1?pct.toFixed(1):fmt(pct)}% in flight${x.uc.concManual?', set manually':''}) · ${esc(x.s.model.name)}${fails.length?` · <span class="bad">${fails.join(' · ')}</span>`:' · <span class="ok">SLOs met</span>'}`);
  }));
  h+='</ul><div class="sum-cap">Deployments</div><ul class="sum">';
  pools.forEach((p,pi)=>{
    const st=p.state, wPer=st.model.params*st.wq.bytes;
    const spareG=st.gpus-p.d.replicas*st.tp;
    h+=li('layers',`<b>${esc(st.model.name)} ${esc(st.wq.name)}</b>: one ${fmt(wPer)} GB copy needs TP${st.tp} (smallest slice that fits it in the memory target); ${p.d.replicas} replica${p.d.replicas>1?'s':''} at batch ${st.batch} admit ${p.d.active} of ${st.concurrent} pooled calls on ${st.workers} node${st.workers>1?'s':''}${spareG>0?`, ${spareG} GPUs spare`:''} · ${(p.d.total/p.d.avail*100).toFixed(0)}% memory used`);
  });
  if(sup.items.length)
    h+=li('puzzle',`<b>Supporting models</b>: ${sup.items.map(it=>`${KIND_LABEL[it.kind]||it.kind} ×${it.instances}`).join(', ')} on ${sup.gpus} shared GPU${sup.gpus>1?'s':''} (${esc(sup.note)})`);
  h+=li('shield',`<b>Resilience</b>: ${esc(info.long)}${fleet.resilW?` adds ${fleet.resilW} idle node${fleet.resilW>1?'s':''}`:' adds nothing'}${fleet.supNodes?`; ${fleet.supNodes} supporting node${fleet.supNodes>1?'s':''} added`:''}.`);
  const finds=[];
  if(!fleet.fits) finds.push(['bad','The project exceeds GPU memory: see Recommendations.']);
  const failing=pools.flatMap(p=>p.perUc.filter(x=>!x.d.sloAll));
  if(failing.length) finds.push(['bad',`${failing.length} use case${failing.length>1?'s miss':' misses'} an SLO target (marked above): widen TP for faster first token, raise replicas for speed at batch, or relax the target.`]);
  pools.forEach(p=>{ if(p.capped) finds.push(['warn',`${esc(p.state.model.name)}: ${p.capped-p.d.replicas} replica${p.capped-p.d.replicas>1?'s':''} beyond demand turned into spare GPUs.`]); });
  pools.forEach(p=>{ if(p.d.kvTotal>p.d.weightsAll) finds.push(['warn',`${esc(p.state.model.name)}: KV cache outweighs the weights; FP8 KV or shorter context pays off most.`]); });
  if(finds.length){ h+='</ul><div class="sum-cap">Findings</div><ul class="sum">';
    finds.forEach(([cls,txt])=>{ h+=li('flag',txt,cls); }); }
  h+='</ul>';
  return h;
}
const ROLE_LABEL={serve:'serving',support:'supporting',standby:'standby',mirror:'mirror',drs:'DR standby'};
function buildFleetSites(prj){
  const {pools, sup, hw}=prj;
  const r=hw.resil, info=RESIL[r]||RESIL.n;
  const N=pools.reduce((x,p)=>x+p.state.workers,0);
  let nn=0, sp=0, idl=0;
  const supBins=sup.layout.slice();
  // serving nodes for pool pi, worker indices [w0, w0+count)
  function serveNodes(p, pi, w0, count, copy){
    const st=p.state, reps=p.d.replicas, out=[];
    for(let w=w0; w<w0+count; w++){
      const node={label:(copy?'B-':'ND-')+String(++nn).padStart(2,'0'), cls:'serve', pool:pi,
        poolName:st.model.name, util:Math.min(1,p.d.total/p.d.avail),
        gpus:[], active:p.members.includes(activeUc)};
      for(let k=0;k<st.perW;k++){
        const gi=w*st.perW+k, rep=Math.floor(gi/st.tp);
        if(rep<reps) node.gpus.push({type:'pool', pool:pi, rep, util:node.util,
          tip:`${node.label} · GPU ${k+1} · ${st.model.name} · replica ${rep+1} of ${reps} (TP${st.tp} shard) · ${(node.util*100).toFixed(0)}% memory`});
        else if(supBins.length){ const bin=supBins.shift();
          node.gpus.push({type:'sup', bin, tip:`${node.label} · GPU ${k+1} · supporting models on spare GPU`}); }
        else node.gpus.push({type:'spare', tip:`${node.label} · GPU ${k+1} · unassigned headroom`});
      }
      out.push(node);
    }
    return out;
  }
  function idleNodes(pi, count, mode, tag){
    const out=[];
    for(let w=0; w<count; w++){
      const node={label:tag+String(++idl).padStart(2,'0'), cls:mode, pool:pi, gpus:[]};
      const tip = pi==null
        ? `${node.label} · shared spare: idle node that covers a failure in any pool (hardware is uniform)`
        : `${node.label} · ${mode==='mirror'?'mirror of':'DR standby for'} the ${pools[pi].state.model.name} pool`;
      for(let k=0;k<hw.perW;k++) node.gpus.push({type:'idle', mode, pool:pi, tip:tip+` · GPU ${k+1}`});
      out.push(node);
    }
    return out;
  }
  function supNodes(){
    const out=[];
    while(supBins.length){
      const node={label:'SP-'+String(++sp).padStart(2,'0'), cls:'support', gpus:[]};
      for(let k=0;k<hw.perW;k++){
        if(supBins.length) node.gpus.push({type:'sup', bin:supBins.shift(), tip:`${node.label} · GPU ${k+1} · supporting models`});
        else node.gpus.push({type:'spare', tip:`${node.label} · GPU ${k+1} · unassigned headroom`});
      }
      out.push(node);
    }
    return out;
  }
  const allServe=(copy)=>pools.flatMap((p,pi)=>serveNodes(p,pi,0,p.state.workers,copy));
  const shared=(k)=>idleNodes(null,k,'standby','RS-');
  const sites=[];
  const site=(title,icon,nodes)=>{ sites.push({title, icon, nodes}); };
  if(r==='n'||r==='n1'||r==='n2'){
    site(`Production site · N=${N}${info.add?'+'+info.add:''}`,'building',
      [...allServe(), ...supNodes(), ...shared(info.add)]);
  } else if(r==='nn'){
    site(`System A · active · N=${N}`,'building',[...allServe(), ...supNodes()]);
    sites[sites.length-1].link='in-site failover';
    site(`System B · mirror · N=${N}`,'shield',
      pools.flatMap((p,pi)=>idleNodes(pi,p.state.workers,'mirror','MR-')));
  } else if(r==='dr'||r==='drh'){
    site(`Primary site · active · N=${N}`,'building',[...allServe(), ...supNodes()]);
    sites[sites.length-1].link='async replication';
    const cnt=p=> r==='dr'? p.state.workers : Math.ceil(p.state.workers/2);
    const drNodes=pools.flatMap((p,pi)=>idleNodes(pi,cnt(p),'drs','DR-'));
    site(r==='dr'? `DR site · standby · N=${N}` : `DR site · half-size standby · ${drNodes.length} node${drNodes.length>1?'s':''}`,'globe',drNodes);
  } else if(r==='aas'||r==='aas1'||r==='aass'){
    const aServe=[], bServe=[];
    pools.forEach((p,pi)=>{ const w=p.state.workers, nA=Math.max(1,Math.ceil(w/2));
      aServe.push(...serveNodes(p,pi,0,nA));
      if(w-nA>0) bServe.push(...serveNodes(p,pi,nA,w-nA)); });
    const aSpare=(r==='aas1'||r==='aass')?1:0, bSpare=r==='aass'?1:0;
    site(`Site A · active · ${aServe.length} of N=${N}${aSpare?' + spare':''}`,'building',
      [...aServe, ...supNodes(), ...shared(aSpare)]);
    if(bServe.length||bSpare){
      sites[sites.length-1].link='active / active · geo load balancing';
      site(`Site B · active · ${bServe.length} of N=${N}${bSpare?' + spare':''}`,'building',
        [...bServe, ...shared(bSpare)]);
    }
  } else if(r==='aa'||r==='aan1'){
    const spareEach=r==='aan1'?1:0;
    site(`Site A · active · N=${N}${spareEach?'+1':''}`,'building',
      [...allServe(), ...supNodes(), ...shared(spareEach)]);
    sites[sites.length-1].link='active / active · geo load balancing';
    site(`Site B · active · N=${N}${spareEach?'+1':''}`,'building',
      [...allServe(true), ...shared(spareEach)]);
  } else { /* nndr */
    site(`Site A · active · N+N`,'building',
      [...allServe(), ...supNodes(), ...pools.flatMap((p,pi)=>idleNodes(pi,p.state.workers,'mirror','MR-'))]);
    sites[sites.length-1].link='active / active · geo-replication';
    site(`Site B · active · N+N`,'building',
      [...allServe(true), ...pools.flatMap((p,pi)=>idleNodes(pi,p.state.workers,'mirror','MR-'))]);
  }
  sites.forEach(s2=>{ s2.workers=s2.nodes.length;
    s2.gpus=s2.nodes.reduce((x,n2)=>x+n2.gpus.length,0);
    s2.kW=s2.gpus*hw.g.watts/1000; });
  return {sites, info, N};
}
function renderProject(){
  const panel=$('projPanel'), cap=$('ucDetailCap');
  const multi = UC.length>1;
  if(!panel) return null;
  if(!multi){ panel.style.display='none'; if(cap) cap.style.display='none'; return null; }
  const prj=window.__prj||computeProject();
  const {pools, sup, fleet, hw}=prj;
  const PC=pools.map(p=>p.members[0]%6);
  panel.style.display='';
  if(cap) cap.style.display='none';
  $('projNote').textContent = pools.length+' pool'+(pools.length>1?'s':'')+' · '+UC.length+' use case'+(UC.length>1?'s':'')+(sup.items.length? ' · '+sup.items.length+' supporting model'+(sup.items.length>1?'s':''):'');
  const short=n=>n.length>26? n.slice(0,24)+'…':n;
  // strip: one chip per pool + supports + procurement
  $('projStrip').innerHTML =
    pools.map((p,pi)=>`<span class="ps-chip">${rico('layers','ri')}<span class="dot" style="background:var(--pool${PC[pi]})"></span><b>${esc(short(p.state.model.name))}</b><span class="mono">${esc(p.state.wq.name)} · TP${p.state.tp} · ${p.state.workers}×${p.state.perW} GPU · ${p.d.replicas} repl · ${p.state.concurrent} calls${p.capped?' · '+(p.capped-p.d.replicas)+' idle repl → spare':''}</span><span class="dot" style="background:${p.d.fits&&p.perUc.every(x=>x.d.sloAll)?'var(--teal-strong)':'var(--red)'};border-radius:50%"></span></span>`).join('')+
    (sup.gpus? `<span class="ps-chip"><span class="dot" style="background:var(--amber-border)"></span><b>Supporting</b><span class="mono">${sup.items.reduce((t,i2)=>t+i2.instances,0)} instances · ${sup.gpus} shared GPU${sup.gpus>1?'s':''}</span></span>`:'')+
    `<span class="ps-chip"><b>Procured</b><span class="mono">${fleet.procW} nodes · ${fleet.procG} GPUs · ≈${fmt(fleet.kW)} kW</span></span>`;
  // per-usecase result cards
  let cards='';
  pools.forEach((p,pi)=>p.perUc.forEach(x=>{
    const f=x.uc.f;
    const slo=(on,pass,val,tgt)=>on? `<span class="${pass?'ok':'miss'}">${val}</span> <span>· ${tgt}</span>` : `<span>${val}</span>`;
    cards+=`<div class="ucr" data-ucr="${x.i}" style="border-left-color:${UCCOL(x.i)}">
      <div class="u-name">${rico('users','ri')}${esc(ucName(x.uc))}${x.uc.isolate?' <span class="mono" style="font-size:9px">isolated</span>':''}</div>
      <div class="u-sub">${esc(short(x.s.model.name))} · ${esc(x.s.wq.name)} · pool batch ${p.state.batch}</div>
      <div class="u-row"><span>Admitted at peak</span><span class="v">${x.share} of ${x.s.concurrent}</span></div>
      <div class="u-row"><span>First token</span><span class="v">${slo(x.s.sloTtft>0, x.d.slo.ttft.pass, fmt(x.d.ttft)+' ms', '≤ '+fmt(x.s.sloTtft)+' ms')}</span></div>
      <div class="u-row"><span>Per-user speed</span><span class="v">${slo(x.s.sloTps>0, x.d.slo.tps.pass, fmt(x.d.tps)+' tok/s', '≥ '+fmt(x.s.sloTps)+' tok/s')}</span></div>
      <div class="u-row"><span>P95 latency</span><span class="v">${slo(x.s.sloP95>0, x.d.slo.p95.pass, fmt(x.d.p95)+' s', '≤ '+fmt(x.s.sloP95)+' s')}</span></div>
      <div class="u-row"><span>KV per call</span><span class="v">${fmt(x.d.kvCall||x.d.kvTotal/Math.max(1,x.d.active))} GB</span></div>
      ${(x.uc.supports||[]).length?`<div class="u-row"><span>Supporting</span><span class="v">${x.uc.supports.map(sp=>KIND_LABEL[sp.kind]||sp.kind).join(', ')}</span></div>`:''}
    </div>`; }));
  $('ucResults').innerHTML=cards;
  return prj;
}
/* One visualization for topology AND placement: site frames from the resilience
   pattern, every GPU drawn with its pool's memory fill, support slices as
   mosaics, idle nodes dashed. Economics computed at project level. */
function renderFleet(prj){
  const box=$('fleetMap'); if(!box) return;
  const {pools, sup, fleet, hw}=prj;
  const {sites, info, N}=buildFleetSites(prj);
  const PC=pools.map(p=>p.members[0]%6);
  // first word that tells this pool apart from its rivals (Kimi K2.5 vs Kimi K3 -> K2.5 / K3)
  const poolTag=(()=>{ const words=pools.map(p=>p.state.model.name.split(/\s+/));
    return pi=>{ const w=words[pi]; let s=0;
      while(s<w.length-1 && words.some((o,oi)=>oi!==pi && o[s]===w[s])) s++;
      return w[s]||w[0]; }; })();
  const partMax=(hw.g.part&&hw.g.part.max)||1;
  const short=n=>n.length>26? n.slice(0,24)+'…':n;
  const MAXN=18;
  const gpuHtml=g2=>{
    if(g2.type==='pool'){ const h=Math.max(6, Math.round(g2.util*100));
      return `<div class="fm-gpu assigned" title="${esc(g2.tip)}"><div class="fill" style="height:${h}%;background:var(--pool${PC[g2.pool]});opacity:${g2.rep%2?0.72:1}"></div></div>`; }
    if(g2.type==='idle'){ const col=g2.pool==null? 'var(--amber-border)' : (g2.mode==='drs'? 'var(--violet)' : `var(--pool${PC[g2.pool]})`);
      return `<div class="fm-gpu spare" title="${esc(g2.tip)}" style="border-color:${col}"></div>`; }
    if(g2.type==='sup'){ let y=0;
      const bands=g2.bin.slices.map(sl=>{ const h=Math.max(10, sl.n/partMax*100);
        const b=`<div class="band" style="top:${y}%;height:${h}%;background:var(--sup${sl.kind})"></div>`; y+=h; return b; }).join('');
      const tip=g2.tip+': '+g2.bin.slices.map(sl=>`${KIND_LABEL[sl.kind]||sl.kind} ${sl.model}${sl.inst>1?' ×'+sl.inst:''} (${fmt(sl.gb)} GB slice)`).join(' · ');
      return `<div class="fm-gpu assigned" title="${esc(tip)}">${bands}</div>`; }
    return `<div class="fm-gpu spare" title="${esc(g2.tip)}"></div>`;
  };
  const nodeHtml=n2=>{
    const role = n2.cls==='serve'? esc(poolTag(n2.pool))
      : n2.cls==='support'? 'supporting'
      : n2.cls==='mirror'? 'mirror' : n2.cls==='drs'? 'DR standby' : 'standby';
    const right = n2.cls==='serve'? `<span class="pct">${(n2.util*100).toFixed(0)}%</span>` : `<span class="pct idle">idle</span>`;
    return `<div class="fm-node ${n2.cls==='drs'?'standby':n2.cls}${n2.active?' fm-active':''}"${n2.active?` style="--acol:var(--pool${PC[n2.pool]})"`:''} title="${esc(n2.label+' · '+(ROLE_LABEL[n2.cls]||n2.cls)+(n2.poolName?' · '+n2.poolName:''))}">
      <div class="fm-nlab">${n2.label}<span class="role">${role}</span><span class="sp"></span>${n2.cls==='support'?'':right}</div>
      <div class="fm-gpus">${n2.gpus.map(gpuHtml).join('')}</div></div>`;
  };
  const dense=sites.reduce((x,s2)=>x+s2.nodes.length,0)>14;
  box.className='fleet-map'+(dense?' dense':'');
  box.innerHTML=sites.map(s2=>{
    let list=s2.nodes, moreN=0;
    if(list.length>MAXN){ const idlers=list.filter(n2=>n2.cls!=='serve');
      const servers=list.filter(n2=>n2.cls==='serve');
      const room=Math.max(1, MAXN-1-idlers.length);
      moreN=servers.length-room;
      list=[...servers.slice(0,room), ...idlers]; }
    const sico=s2.icon==='globe'?'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9s1.3-6.3 3.8-9z"/>':s2.icon==='shield'?RICO.shield:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"/>';
    return `<div class="fm-site">
      <div class="fm-site-head"><span class="t"><svg class="ri" viewBox="0 0 24 24" aria-hidden="true">${sico}</svg>${esc(s2.title)}</span><span class="schip">${s2.workers} node${s2.workers>1?'s':''} · ${s2.gpus} GPU · ≈${fmt(s2.kW)} kW</span></div>
      <div class="fm-nodes">${list.map(nodeHtml).join('')}${moreN>0?`<div class="fm-node fm-more">+${moreN} more ${esc(short(pools.length===1?pools[0].state.model.name:'serving'))} node${moreN>1?'s':''}</div>`:''}</div>
    </div>`+(s2.link?`<div class="fm-link" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 4v16M7 20l-3-3.5M7 20l3-3.5M17 20V4M17 4l-3 3.5M17 4l3 3.5"/></svg>${esc(s2.link)}</div>`:'');
  }).join('');
  // legend
  $('fmLegend').innerHTML =
    pools.map((p,pi)=>`<span class="lg-li"><span class="sw" style="background:var(--pool${PC[pi]})"></span>${esc(short(p.state.model.name))} · ${esc(p.state.wq.name)}${p.members.length>1?' · shared by '+p.members.length+' use cases':''}</span>`).join('')+
    sup.items.map(it=>`<span class="lg-li"><span class="sw hatch" style="background:var(--sup${it.kind})"></span>${KIND_LABEL[it.kind]||it.kind} · ${esc(it.model.name)} (hatched slice)</span>`).join('')+
    (info.add?`<span class="lg-li"><span class="sw dashed" style="border-color:var(--amber-border)"></span>${(hw.resil==='aass'||hw.resil==='aan1')?'spare · one per site':'shared spare · covers any pool'}</span>`:'')+
    (sites.some(s2=>s2.nodes.some(n2=>n2.cls==='mirror'))?`<span class="lg-li"><span class="sw dashed"></span>mirror · idle copy</span>`:'')+
    (sites.some(s2=>s2.nodes.some(n2=>n2.cls==='drs'))?`<span class="lg-li"><span class="sw dashed" style="border-color:var(--violet)"></span>DR standby</span>`:'')+
    `<span class="lg-li"><span class="sw dashed"></span>unassigned headroom</span>`+
    (UC.length>1?`<span class="lg-li no-print"><span class="sw" style="background:transparent;border:2px solid var(--text)"></span>outlined nodes = pool of the selected use case (screen only)</span>`:'')+
    `<span class="lg-li"><span class="sw duo"></span>same pool, adjacent replicas alternate shade</span>`+
    `<span class="lg-li">fill height = share of GPU memory used</span>`;
  $('fmTotals').textContent=`${fleet.procW} nodes · ${fleet.procG} GPUs · ≈${fmt(fleet.kW)} kW TDP`;
  // semantic text form
  $('fleetList').innerHTML='<h3>Deployment, text form</h3>'+sites.map(s2=>`<h4>${esc(s2.title)}</h4><ul>`+s2.nodes.map(n2=>{
    const role=ROLE_LABEL[n2.cls]||n2.cls;
    const parts=n2.gpus.map((g2,k)=>{
      if(g2.type==='pool') return `GPU ${k+1}: ${pools[g2.pool].state.model.name} replica ${g2.rep+1}`;
      if(g2.type==='sup') return `GPU ${k+1}: `+g2.bin.slices.map(sl=>`${KIND_LABEL[sl.kind]||sl.kind} ${sl.model}${sl.inst>1?' ×'+sl.inst:''}`).join(', ');
      if(g2.type==='idle') return `GPU ${k+1}: ${role}`;
      return `GPU ${k+1}: spare`; });
    return `<li>${n2.label} (${role}): ${parts.join('; ')}</li>`; }).join('')+'</ul>').join('');
  // note
  const notes=[];
  if(sup.gpus) notes.push(`Supporting models are placed as ${sup.note}; spare pool GPUs are used before adding hardware`+(sites.length>1?', shown in the first site (replicate them per site operationally)':'')+'.');
  if(info.add) notes.push((hw.resil==='aass'||hw.resil==='aan1')
    ? `Each site keeps one idle spare: it covers a node failure in its own site, for any pool (hardware is uniform).`
    : `The ${info.add} spare node${info.add>1?'s are':' is'} shared${pools.length>1?` across all ${pools.length} pools`:''}: hardware is uniform, so any spare can take over any failed node.`);
  $('fmNote').innerHTML=notes.map(esc).join(' ')+` GPU fill height shows each pool's memory use.<span class="no-print"> Hover any GPU for its exact assignment.</span>`;
  // economics, project level
  const agg=pools.reduce((x,p)=>x+p.d.agg,0), active=pools.reduce((x,p)=>x+p.d.active,0);
  const procW=fleet.procW, procG=fleet.procG, kW=fleet.kW;
  $('topoNote').textContent=`${info.label} · ${pools.length} pool${pools.length>1?'s':''} · ${pools.map(p=>'TP'+p.state.tp).join(' + ')}`;
  const liveW=(info.live||(n=>n))(N), idleW=Math.max(0, procW-liveW-fleet.supNodes);
  const burst=liveW>N? agg*liveW/N : null;
  $('resilStats').innerHTML=
    `<div class="rs"><div class="k">Guaranteed at peak</div><div class="v">${fmt(agg)} tok/s · ${active} calls</div><div class="n">${hw.resil==='n'?'assumes no failures: any node loss removes capacity':info.degraded?'≈ half of this during a site loss':'held even through the covered failure'}</div></div>`+
    `<div class="rs"><div class="k">Normal-day capacity</div><div class="v">${burst?`≈ ${fmt(burst)} tok/s`:`${fmt(agg)} tok/s`}</div><div class="n">${burst?'both sites serving: burst headroom, not a guarantee': idleW>0?'spare hardware idles until a failure':'every worker serves; no reserve beyond N'}</div></div>`+
    `<div class="rs"><div class="k">Idle hardware</div><div class="v">${idleW>0?`${idleW} node${idleW>1?'s':''}`:'none'}</div><div class="n">${idleW>0?'standing by in normal operation':'every node serves traffic'}</div></div>`+
    `<div class="rs"><div class="k">Cost vs bare N</div><div class="v">${fmt((procW-fleet.supNodes)/Math.max(1,N))}×</div><div class="n">${procW-fleet.supNodes} procured for N=${N}${fleet.supNodes?' · support nodes excluded':''}</div></div>`;
  const r=hw.resil;
  const resLine = r==='n'? 'No redundancy: a node failure removes its replicas from service.'
    : r==='n1'? 'One idle standby absorbs a single node failure with no capacity loss after failover.'
    : r==='n2'? 'Two idle standbys absorb two node failures (or one failure during a maintenance window): the usual step up from N+1 for larger fleets.'
    : r==='nn'? 'A full second system in the same site: survives node and system-level failures; can also cover maintenance windows.'
    : r==='dr'? 'A standby remote site behind asynchronous replication: survives full site loss; the standby idles during normal operation.'
    : r==='drh'? 'A half-size standby site: the cost-conscious DR pattern. Survives a site loss but runs degraded at roughly half capacity until the primary returns; guaranteed capacity during a site loss is about half the normal figure.'
    : r==='aas'? 'The N load-bearing nodes are split across two live sites with no extra procurement: the cheapest geographic pattern. A site loss halves capacity until repair, and the SLA must say so. If the full number must survive a site loss, each site has to carry N alone: that is the Active/Active (2N) pattern.'
    : r==='aas1'? 'N split across two live sites plus one idle spare: a single server failure anywhere is absorbed at full capacity (traffic rebalances across sites), while a site loss still roughly halves capacity. The pragmatic budget middle between bare split and per-site spares.'
    : r==='aass'? 'N split across two live sites with an idle spare in each: any single server failure is absorbed locally, and after a site loss the surviving half still has its own spare. A site loss still roughly halves capacity; state it in the SLA.'
    : r==='aa'? 'Two active sites share traffic behind global load balancing. Each site alone can carry the full load, so losing a site degrades nothing; in normal operation each runs at roughly half load.'
    : r==='aan1'? 'Two active sites, each with its own local standby: survives the loss of an entire site plus a node failure in the surviving site. A pragmatic middle ground between plain active/active and N+N+DR.'
    : 'Two active/active sites, each carrying N+N: traffic is shared across sites in normal operation, and the deployment survives any worker failure or the loss of an entire site without dropping below N. The most resilient, and most procurement-heavy, enterprise pattern.';
  $('topoSum').innerHTML=
    `Load: <b>N = ${N} node${N>1?'s':''} · ${fleet.servG} GPUs</b> (${hw.perW}/node${pools.length>1?', across '+pools.length+' pools':''}): performance and fit are computed on these. `+
    `Procured for ${info.long}: <b>${procW} nodes · ${procG} GPUs · ≈ ${fmt(kW)} kW</b> GPU TDP${fleet.supNodes?`, including ${fleet.supNodes} supporting node${fleet.supNodes>1?'s':''}`:''}. ${resLine}`;
  return {procW};
}

/* ================= PROJECT REPORT (selection-independent) ================= */
/* In a multi-use-case project every results panel describes the WHOLE project:
   averages plus per-item breakdown, never the selected card alone, so the
   exported report reads the same no matter which card was being edited. */
const POOL_HEX=['#2563EB','#7C3AED','#DB2777','#4D7C0F','#EA580C','#64748B'];
const POOL_HEX_D=['#82AAFF','#C4A5FF','#FF8FC1','#B5D96B','#FF9E66','#94A3B8'];
function poolHex(i){ return (document.documentElement.dataset.theme==='dark'? POOL_HEX_D:POOL_HEX)[i%6]; }
function shortPoolTag(pools, pi){
  const words=pools.map(p=>p.state.model.name.split(/\s+/));
  const w=words[pi]; let s=0;
  while(s<w.length-1 && words.some((o,oi)=>oi!==pi && o[s]===w[s])) s++;
  return w[s]||w[0];
}
function renderProjectReport(prj){
  const {pools, sup, fleet, hw}=prj;
  const PC=pools.map(p=>p.members[0]%6);
  const tag=pi=>shortPoolTag(pools, pi)+' '+pools[pi].state.wq.name;
  const wsum=pools.reduce((x,p)=>x+p.state.concurrent,0)||1;
  // --- memory ledger: one bar per pool ---
  const panel=$('lgScale').parentElement;
  let box=$('projLedger');
  if(!box){ box=document.createElement('div'); box.id='projLedger'; $('lgLegend').before(box); }
  ['lgScale'].forEach(id=>$(id).style.display='none');
  panel.querySelector('.lg-wrap').style.display='none';
  $('lgLegend').style.display='none';
  $('ledgerNote').textContent=`${fmt(fleet.vramNeed)} of ${fmt(fleet.vramAvail)} GB across ${pools.length} pools + supports`;
  box.innerHTML=pools.map((p,pi)=>{
    const d=p.d, cap=d.avail;
    const seg=(v,cls)=>`<div class="seg ${cls}" style="width:${Math.min(100,v/cap*100)}%"></div>`;
    return `<div class="pl-row">
      <div class="pl-lab"><span class="dot" style="background:var(--pool${PC[pi]})"></span>${esc(tag(pi))}<span class="pl-note">${p.d.replicas}×TP${p.state.tp}</span></div>
      <div class="pl-bar">${seg(d.weightsAll,'weights')}${seg(d.kvTotal,'kv')}${seg(d.act*d.replicas,'act')}${seg(d.fixed+d.multi,'ovh')}</div>
      <div class="pl-val mono">${fmt(d.total)} / ${fmt(cap)} GB · ${(d.total/cap*100).toFixed(0)}%</div></div>`;
  }).join('')+`<div class="pl-key"><span class="lg-li"><span class="sw seg weights"></span>weights</span><span class="lg-li"><span class="sw seg kv"></span>KV cache</span><span class="lg-li"><span class="sw seg act"></span>activations</span><span class="lg-li"><span class="sw seg ovh"></span>overhead</span></div>`;
  box.style.display='';
  // --- KPI tiles: project totals + demand-weighted averages ---
  const wavg=get=>pools.reduce((x,p)=>x+get(p)*p.state.concurrent,0)/wsum;
  const agg=pools.reduce((x,p)=>x+p.d.agg,0);
  const admitted=pools.reduce((x,p)=>x+p.d.active,0), queued=pools.reduce((x,p)=>x+p.d.queued,0);
  const setTile=(id,lab,val,unit,sub)=>{ const el=$(id); if(!el) return;
    el.querySelector('.k-lab').lastChild.textContent=lab;
    el.querySelector('[data-v]').textContent=val;
    el.querySelector('.unit').textContent=unit;
    el.querySelector('.k-sub').textContent=sub; };
  setTile('kpiTtft','Avg first token', fmt(wavg(p=>p.d.ttft)),'ms','demand-weighted · per pool in Summary');
  setTile('kpiTps','Avg per-user speed', fmt(wavg(p=>p.d.tps)),'tok/s','demand-weighted across pools');
  setTile('kpiAgg','Aggregate throughput', fmt(agg),'tok/s',`${admitted} admitted · ${queued} queued`);
  setTile('kpiLat','Avg user latency', fmt(wavg(p=>p.d.latency)),'s',`P95 up to ${fmt(Math.max.apply(null,pools.map(p=>p.d.p95)))} s`);
  // --- SLO roll-up: one chip per use case ---
  let chips='';
  pools.forEach((p,pi)=>p.perUc.forEach(x=>{
    const on=x.s.sloTtft>0||x.s.sloTps>0||x.s.sloP95>0;
    chips+=`<div class="slo ${on?(x.d.sloAll?'pass':'fail'):'off'}"><span class="dot"></span><span class="s-name">${esc(ucName(x.uc))}</span><span class="s-val">${on?(x.d.sloAll?'all targets met':'target missed'):'no targets'}</span></div>`; }));
  $('sloRow').innerHTML=chips;
  $('sloNote').textContent='per use case; details in the cards above';
  // --- charts: one line per pool ---
  const P=pal();
  const Smax=Math.max.apply(null, pools.map(p=>Math.max(Math.ceil(p.state.concurrent*1.4), p.state.batch*p.d.replicas*1.3, 16)));
  let maxL=0;
  const series=pools.map((p,pi)=>{ const pts=[];
    for(let i2=0;i2<=56;i2++){ const S=Math.max(1,Math.round(1+(Smax-1)*i2/56));
      const bpr=Math.max(1,S/p.d.replicas);
      const v=p.d.bwEff/(p.state.active*p.state.bytesW+bpr*p.d.effSeq*p.d.kvTok);
      pts.push([S,v]); maxL=Math.max(maxL,v); }
    return {pts, color:poolHex(PC[pi]), axis:'L'}; });
  const m0=pools[0];
  $('chartBatch').innerHTML=chartSVG({
    aria:'Per-user throughput versus admitted sequences, one line per pool',
    xScale:v=>(v-1)/(Smax-1||1), xMax:Smax, maxL, maxR:0, rightAxis:false,
    xTicks:[1,Math.round(Smax/4),Math.round(Smax/2),Math.round(3*Smax/4),Smax].map(v=>[v,fmt(v)]),
    xLabel:'admitted sequences', yLabelL:'tok/s per user',
    series, marker:{x:Math.min(m0.d.active,Smax), y:m0.d.tps, label:esc(shortPoolTag(pools,0))+' '+fmt(m0.d.tps), series:0}});
  const ctxMax=Math.max.apply(null, pools.map(p=>p.state.ctx));
  let maxC=0;
  const cser=pools.map((p,pi)=>{ const pts=[];
    for(let i2=0;i2<=56;i2++){ const c=Math.round(1024*Math.pow(ctxMax/1024, i2/56));
      const v=p.d.bwEff/(p.state.active*p.state.bytesW+p.d.batchPerRep*Math.min(c,p.state.ctx)*p.d.kvTok);
      pts.push([c,v]); maxC=Math.max(maxC,v); }
    return {pts, color:poolHex(PC[pi]), axis:'L'}; });
  $('chartCtx').innerHTML=chartSVG({
    aria:'Per-user speed versus context length, one line per pool',
    xScale:v=>Math.log(v/1024)/Math.log(ctxMax/1024||2), xMax:ctxMax, maxL:maxC, maxR:0, rightAxis:false,
    xTicks:[1024,4096,16384,65536,ctxMax].filter((v,ix,arr)=>arr.indexOf(v)===ix&&v<=ctxMax).map(v=>[v,fmtTok(v)]),
    xLabel:'resident context (tokens, log scale)', yLabelL:'tok/s per user', series:cser});
  const clg=id=>{ const el=$(id); if(el){ el.style.display='flex'; el.innerHTML=pools.map((p,pi)=>`<span class="lg-li"><span class="sw" style="background:${poolHex(PC[pi])}"></span>${esc(tag(pi))}</span>`).join(''); } };
  clg('chartBatchLgd'); clg('chartCtxLgd');
  document.querySelectorAll('.chart-legend').forEach(el=>el.style.display='none');
  // --- latency anatomy: one row per use case ---
  const rows=[];
  pools.forEach(p=>p.perUc.forEach(x=>{
    const segs=[['ttft',x.d.ttft],['ovh',x.s.ovh],['reason',x.s.reasonTok? x.s.reasonTok/x.d.tps*1000:0],['out',x.s.visibleOut/x.d.tps*1000]].filter(sg=>sg[1]>0.01);
    const tot=segs.reduce((a2,sg)=>a2+sg[1],0);
    rows.push(`<div class="wfp"><span class="n">${esc(ucName(x.uc))}</span><div class="bar">${segs.map(sg=>`<div class="wf-seg ${sg[0]}" style="width:${(sg[1]/tot*100)}%" title="${sg[0]}: ${fmt(sg[1])} ms"></div>`).join('')}</div><span class="t mono">${tot>=1000? fmt(tot/1000)+' s' : fmt(tot)+' ms'}</span></div>`); }));
  $('wfBar').innerHTML=`<div class="wfp-list">${rows.join('')}</div>`;
  $('wfLegend').innerHTML=[['TTFT','ttft'],['Overhead','ovh'],['Reasoning','reason'],['Visible output','out']].map(([n2,c2])=>`<span class="lg-li"><span class="lg-sw wf-seg ${c2}" style="width:10px;height:10px"></span><span class="k">${n2}</span></span>`).join('');
  $('wfTotal').textContent=`mean ${fmt(wavg(p=>p.d.latency))} s (demand-weighted)`;
  // --- insights hidden (Summary carries findings); recommendations per pool ---
  const insPanel=$('insights').closest('section'); if(insPanel) insPanel.style.display='none';
  let recs=[], bns=[];
  pools.forEach((p,pi)=>{
    const g2=hw.g, pre=/2026/.test(g2.cls);
    const rb=buildRecs(p.state, p.d, p.state.model, g2, pre);
    if(rb.bottleneck!=='none') bns.push(shortPoolTag(pools,pi)+': '+rb.bottleneck);
    rb.recs.forEach(r=>recs.push(`<div class="rec ${r.lv}"><div class="r-t">${esc(shortPoolTag(pools,pi))} · ${r.t}</div><div class="r-b">${r.b}</div></div>`)); });
  $('recBottleneck').textContent=bns.length? bns.join(' · ') : 'no active bottleneck';
  $('recs').innerHTML=recs.join('');
  // --- print inputs: every use case, side by side ---
  const cols=[];
  pools.forEach(p=>p.perUc.forEach(x=>cols.push(x)));
  const row=(label,get)=>`<tr><td>${label}</td>${cols.map(get).map(v=>`<td>${v}</td>`).join('')}</tr>`;
  $('printInputs').innerHTML=`<div class="pi-title">Inputs · all use cases · ${esc(hw.g.name)} · ${hw.perW} GPU/node · ${esc((RESIL[hw.resil]||RESIL.n).long)}</div>
  <table class="pi-table"><tr><td></td>${cols.map(x=>`<td><b>${esc(ucName(x.uc))}</b></td>`).join('')}</tr>
  ${row('Model', x=>esc(x.s.model.name))}
  ${row('Weights / KV', x=>esc(x.s.wq.name+' / '+x.s.kq.name))}
  ${row('Active users', x=>fmt(+x.uc.f.nrmUsers||0))}
  ${row('Concurrent calls', x=>x.s.concurrent)}
  ${row('Resident seq', x=>fmtTok(x.s.resident))}
  ${row('Visible out', x=>fmtTok(x.s.visibleOut))}
  ${row('SLO ttft/tps/p95', x=>(x.s.sloTtft||'—')+' / '+(x.s.sloTps||'—')+' / '+(x.s.sloP95||'—'))}
  ${row('Pool topology', x=>'TP'+x.s.tp+' · '+x.s.workers+' node · batch '+x.s.batch)}
  </table>`;
}
function restoreSingleReport(){
  const box=$('projLedger'); if(box) box.style.display='none';
  document.querySelectorAll('.chart-legend').forEach(el=>el.style.display='');
  ['chartBatchLgd','chartCtxLgd'].forEach(id=>{ const el=$(id); if(el) el.style.display='none'; });
  const panel=$('lgScale').parentElement;
  $('lgScale').style.display=''; panel.querySelector('.lg-wrap').style.display='';
  $('lgLegend').style.display='';
  const insPanel=$('insights').closest('section'); if(insPanel) insPanel.style.display='';
  const labs={kpiTtft:'Time to first token', kpiTps:'Per-user speed', kpiAgg:'Aggregate throughput', kpiLat:'Mean user latency'};
  Object.keys(labs).forEach(id=>{ const el=$(id); if(el) el.querySelector('.k-lab').lastChild.textContent=labs[id]; });
}

/* ================= SERIALIZE / APPLY ================= */
function serialize(){
  captureUc();
  const s=readState(), d=compute(s);
  return {
    schema:'gpuscale.net/5', engine:ENGINE_VERSION, studio:STUDIO_VERSION,
    name: projName(), projectId: PROJ_ID, scenarioId: PROJ_ID, mode: document.documentElement.dataset.uxMode||'advanced',
    savedAt: new Date().toISOString(),
    config:{
      model: $('chkCustom').checked? {custom:true, params:s.params, active:s.active, hidden:s.hidden,
        layers:s.layers, kvHeads:s.kvHeads, headDim:s.headDim, ctx:s.ctx} : {custom:false, name:s.model.name},
      weightQuant:s.wq.name, kvQuant:s.kq.name,
      preset: +$('selCase').value>=0 ? CASES[+$('selCase').value].name : null,
      residentSeq:s.resident, visibleOut:s.visibleOut,
      reasoning:{mode:s.reasonMode, tokens:s.reasonTok, extendsKV:s.extend},
      concurrentCalls:s.concurrent, maxBatchPerReplica:s.batch, kvPolicy:s.policy,
      gpu:s.gpu.name,
      hardware:{workers:s.workers, gpusPerWorker:s.perW, tensorParallel:s.tp, resilience:s.resil},
      tuning:{prefillMFU:s.mfu, decodeMBU:s.mbu, interconnectEff:s.ic, frameworkOverheadMs:s.ovh, autoSizeUtilPct:+($('autoUtil')&&$('autoUtil').value)||80},
      sloTargets:{ttftMs:s.sloTtft, tps:s.sloTps, p95s:s.sloP95},
      estimator:{sessions:+$('ccSessions').value||0, turnsPerHour:+$('ccTurns').value||0,
        pctTurnsLLM:+$('ccShare').value||0, callsPerTurn:+$('ccCalls').value||0,
        burst:+$('ccBurst').value||1, callDurS:+$('ccDur').value||0},
      theme: document.documentElement.dataset.theme,
    },
    // full snapshots make the file self-contained: imports survive library renames and removals
    snapshot:{
      model:{name:s.model.name, params:s.params, active:s.active, hidden:s.hidden, layers:s.layers,
             kvHeads:s.kvHeads, headDim:s.headDim, ctx:s.ctx, arch:s.model.arch||'', dev:s.model.dev||''},
      gpu:{name:s.gpu.name, vram:s.gpuVram, bw:s.gpuBw, tflops:s.gpuTflops, watts:s.gpu.watts, arch:s.gpu.arch||''},
      weightBytes:s.bytesW, kvBytes:s.bytesK,
    },
    results:{vramRequiredGB:+d.total.toFixed(1), vramAvailableGB:d.avail, headroomGB:+d.headroom.toFixed(1),
      ttftMs:+d.ttft.toFixed(1), perUserTps:+d.tps.toFixed(1), aggregateTps:+d.agg.toFixed(0),
      meanLatencyS:+d.latency.toFixed(2), p95S:+d.p95.toFixed(2), admitted:d.active, queued:d.queued,
      fits:d.fits, sloMet:d.sloAll},
    // v5: the full use-case list. config/snapshot above stay v4-shaped (the active
    // card) so older importers still read this file as a single-scenario config.
    project:{active:activeUc, usecases:UC.map(u=>({id:u.id, name:u.name||null,
      isolate:!!u.isolate, supports:u.supports||[], concManual:!!u.concManual,
      activeUsers:+u.f.nrmUsers||null,
      config:ucToConfig(u), snapshot:ucSnapshot(u)})),
      results:(()=>{ const prj=computeProject(); const F=prj.fleet;
        return {fits:F.fits, sloMet:F.sloAll,
          servingGpus:F.servG+F.supG, procuredNodes:F.procW, procuredGpus:F.procG, powerKw:+F.kW.toFixed(1),
          vramRequiredGB:+F.vramNeed.toFixed(1), vramAvailableGB:+F.vramAvail.toFixed(1),
          pools:prj.pools.map(p=>({model:p.state.model.name, weightQuant:p.state.wq.name,
            usecases:p.members.map(mi=>ucName(UC[mi])), tensorParallel:p.state.tp,
            workers:p.state.workers, batch:p.state.batch, replicas:p.d.replicas,
            concurrent:p.state.concurrent, fits:p.d.fits})),
          supports:prj.sup.items.map(it=>({kind:it.kind, model:it.model.name,
            instances:it.instances, vramPerInstanceGB:it.model.vram, demand:it.demand})),
          supportGpus:prj.sup.gpus, supportPlacement:prj.sup.note}; })()}
  };
}
function setSel(notes, sel, name, what){ if(!name) return true; const o=findOption(sel,name);
  if(o){ sel.value=o.value; return true; }
  notes.push(`${what} "${name}" not found; kept the current selection`); return false; }
function findOption(sel, match){
  return [...sel.querySelectorAll('option')].find(o=>o.textContent===match)
      || [...sel.querySelectorAll('option')].find(o=>o.textContent.includes(match));
}
function applyUcDom(c, snap, notes){
  const mdl = c.model && typeof c.model==='object' ? c.model : {custom:false, name:c.model};
  if(mdl.custom){
    $('chkCustom').checked=true; $('customBox').style.display='block'; $('selModel').disabled=true;
    $('cusParams').value=mdl.params; $('cusActive').value=mdl.active; $('cusHidden').value=mdl.hidden;
    $('cusLayers').value=mdl.layers; $('cusKvh').value=mdl.kvHeads; $('cusHdim').value=mdl.headDim; $('cusCtx').value=mdl.ctx;
  } else if(mdl.name){
    const o=findOption($('selModel'), mdl.name);
    if(o){
      $('chkCustom').checked=false; $('customBox').style.display='none'; $('selModel').disabled=false;
      $('selModel').value=o.value;
    } else if(snap.model && snap.model.params){
      // model left the library since this file was saved: rebuild it from the embedded geometry
      $('chkCustom').checked=true; $('customBox').style.display='block'; $('selModel').disabled=true;
      $('cusParams').value=snap.model.params; $('cusActive').value=snap.model.active;
      $('cusHidden').value=snap.model.hidden; $('cusLayers').value=snap.model.layers;
      $('cusKvh').value=snap.model.kvHeads; $('cusHdim').value=snap.model.headDim; $('cusCtx').value=snap.model.ctx;
      notes.push(`model "${mdl.name}" not in this library; restored its saved geometry as a custom model`);
    } else {
      notes.push(`model "${mdl.name}" not found; kept the current selection`);
    }
  }
  setSel(notes, $('selWQuant'), c.weightQuant, 'weight quant'); setSel(notes, $('selKQuant'), c.kvQuant, 'KV quant');
  if(c.preset){ const o=findOption($('selCase'), c.preset); if(o) $('selCase').value=o.value; }
  else if(c.preset===null) $('selCase').value=-1;
  if(c.residentSeq!=null) $('inSeq').value=c.residentSeq;
  if(c.visibleOut!=null) $('inOut').value=c.visibleOut;
  const rz=c.reasoning||{};
  if(rz.mode){ $('selReason').value=rz.mode; }
  syncReason();
  if(rz.mode==='Custom'&&rz.tokens!=null){ $('inReasonTok').value=rz.tokens; refreshCtl('inReasonTok'); }
  if(rz.extendsKV!=null) $('chkExtend').checked=!!rz.extendsKV;
  if(c.concurrentCalls!=null) $('inConc').value=c.concurrentCalls;
  if(c.maxBatchPerReplica!=null) $('inBatch').value=c.maxBatchPerReplica;
  if(c.kvPolicy) $('selPolicy').value=c.kvPolicy;
  const hw=c.hardware;
  if(hw){
    if(hw.workers!=null) $('inWorkers').value=hw.workers;
    if(hw.tensorParallel!=null) $('inTp').value=hw.tensorParallel;
  } else if(c.gpuCount!=null){
    const count=Math.max(1,Math.round(c.gpuCount));
    const perW = count<=16? count : 8;
    $('inPerW').value=perW;
    $('inWorkers').value=Math.max(1,Math.ceil(count/perW));
    if(c.tensorParallel!=null) $('inTp').value=c.tensorParallel;
  }
  const sl=c.sloTargets||{};
  if(sl.ttftMs!=null) $('sloTtft').value=sl.ttftMs;
  if(sl.tps!=null) $('sloTps').value=sl.tps;
  if(sl.p95s!=null) $('sloP95').value=sl.p95s;
  const es=c.estimator||{};
  if(es.sessions!=null) $('ccSessions').value=es.sessions;
  if(es.turnsPerHour!=null) $('ccTurns').value=es.turnsPerHour;
  if(es.pctTurnsLLM!=null) $('ccShare').value=es.pctTurnsLLM;
  if(es.callsPerTurn!=null) $('ccCalls').value=es.callsPerTurn;
  if(es.burst!=null) $('ccBurst').value=es.burst;
  if(es.callDurS!=null) $('ccDur').value=es.callDurS;
}
function applyGlobalDom(c, raw, notes){
  setSel(notes, $('selGpu'), c.gpu, 'GPU');
  const hw=c.hardware||{};
  if(hw.gpusPerWorker!=null) $('inPerW').value=hw.gpusPerWorker;
  if(hw.resilience && RESIL[hw.resilience]) $('selResil').value=hw.resilience;
  const t=c.tuning||{};
  if(t.prefillMFU!=null) $('inMfu').value=t.prefillMFU;
  if(t.decodeMBU!=null) $('inMbu').value=t.decodeMBU;
  if(t.interconnectEff!=null) $('inIc').value=t.interconnectEff;
  if(t.frameworkOverheadMs!=null) $('inOvh').value=t.frameworkOverheadMs;
  if(t.autoSizeUtilPct!=null&&$('autoUtil')) $('autoUtil').value=t.autoSizeUtilPct;
  if(raw.name) $('scenarioName').value = /^Untitled (scenario|project)$/.test(raw.name)? '' : raw.name;
  if(c.theme==='dark'||c.theme==='light'){ window.__themeLocked=true; setTheme(c.theme); }
  if(raw.mode==='normal'||raw.mode==='advanced'||c.mode==='normal'||c.mode==='advanced') setUxMode(raw.mode||c.mode);
}
function applyConfig(raw){
  const notes=[];
  const proj=raw.project;
  if(proj && Array.isArray(proj.usecases) && proj.usecases.length){
    UC.length=0;
    proj.usecases.forEach(pu=>UC.push({id:'uc'+(++ucSeq), name:pu.name||'',
      supports:Array.isArray(pu.supports)?pu.supports:[], isolate:!!pu.isolate, concManual:!!pu.concManual, f:{}}));
    UC.forEach((u,idx)=>{ activeUc=idx; const pu=proj.usecases[idx];
      applyUcDom(pu.config||{}, pu.snapshot||{}, notes); captureUc();
      UC[idx].f.nrmUsers = pu.activeUsers || +((pu.config||{}).estimator||{}).sessions || UC[idx].f.nrmUsers;
      const est=(pu.config||{}).estimator||{};
      const untouched = (+est.turnsPerHour===8||est.turnsPerHour==null) && (+est.callsPerTurn===1.5||est.callsPerTurn==null)
        && (+est.burst===1.5||est.burst==null) && (!est.callDurS);
      const cs=CASES[+UC[idx].f.selCase];
      if(untouched && cs && cs.traffic && !cs.traffic.direct){
        UC[idx].f.ccTurns=cs.traffic.turns; UC[idx].f.ccCalls=cs.traffic.calls;
        UC[idx].f.ccBurst=cs.traffic.burst; UC[idx].f.ccDur=cs.traffic.durS||0; } });
    activeUc=Math.max(0,Math.min(+proj.active||0, UC.length-1));
    // sync the editor to the active card BEFORE global settings: applying the
    // file's theme re-renders, and render() captures the editor DOM into the
    // active card, which would otherwise clobber it with the last card's values
    loadUc(activeUc);
    applyGlobalDom(raw.config||{}, raw, notes);
  } else {
    // v3/v4 single-scenario file: the saved config is the whole project (one card)
    UC.length=0; UC.push({id:'uc'+(++ucSeq), name:'', f:{}, supports:[], isolate:false});
    activeUc=0;
    const c=raw.config||raw, snap=raw.snapshot||{};
    applyUcDom(c, snap, notes);
    applyGlobalDom(c, raw, notes);
    captureUc();
    UC[0].supports=defaultSupports(+UC[0].f.selCase);
  }
  Object.keys(FIELDS).forEach(refreshCtl);
  renderUcCards();
  render();
  return notes;
}

/* ================= XLS TEMPLATE (SpreadsheetML with live formulas) ================= */
function xlsInputRows(s){
  return [
    ['modelName','Model', s.model.name, 'Selected model (informational)','s'],
    ['params','Total params (B)', s.params, 'All weights in VRAM; MoE loads every expert'],
    ['activeP','Active params (B)', s.active, 'Params used per token: compute and decode reads'],
    ['hidden','Hidden dim', s.hidden, 'Model width: activation workspace'],
    ['layers','Layers', s.layers, 'KV cache scales linearly with layers'],
    ['kvh','KV heads (effective)', s.kvHeads, '1 for MLA-style compressed caches'],
    ['hdim','Head dim (effective)', s.headDim, 'Compressed-latent equivalent for MLA'],
    ['bytesW','Bytes / weight', s.bytesW, 'From weight quantization ('+s.wq.name+')'],
    ['bytesK','Bytes / KV element', s.bytesK, 'From KV quantization ('+s.kq.name+')'],
    ['seq','Resident sequence (tok)', s.resident, 'Prompt + history + tools + expected output'],
    ['reason','Reasoning tokens', s.reasonTok, 'Hidden thinking tokens per call'],
    ['ext','Reasoning extends KV (1/0)', s.extend?1:0, '1 = thinking stays in context'],
    ['out','Visible output (tok)', s.visibleOut, 'Tokens the user sees'],
    ['conc','Concurrent LLM calls', s.concurrent, 'Peak in-flight requests'],
    ['batch','Max batch / replica', s.batch, 'Admission cap per replica'],
    ['policy','KV policy (1=all,0=running)', s.policy==='all'?1:0, 'Residency policy'],
    ['workers','GPU workers N', s.workers, 'Load-bearing nodes'],
    ['perW','GPUs per worker', s.perW, '8 = HGX/DGX · 72 = NVL72-class rack'],
    ['tp','Tensor parallel size', s.tp, 'GPUs per replica: drives TTFT'],
    ['vram','GPU VRAM (GB)', s.gpuVram, s.gpu.name],
    ['bwTB','GPU bandwidth (TB/s)', s.gpuBw, 'Decode ceiling'],
    ['tflops','GPU dense FP16 TFLOPS', s.gpuTflops, 'Prefill ceiling (dense Tensor-Core)'],
    ['watts','GPU TDP (W)', s.gpu.watts, 'For power roll-up'],
    ['mfu','Prefill MFU', s.mfu, 'Typical 0.3–0.7'],
    ['mbu','Decode MBU', s.mbu, 'Typical 0.5–0.75'],
    ['ic','Interconnect efficiency', s.ic, 'NVLink ≈ 0.85 · cross-node 0.6–0.7'],
    ['ovh','Framework overhead (ms)', s.ovh, 'Added to every call'],
    ['resil','Resilience (0=N,1=N+1,2=N+N,3=DR,4=N+N+DR,5=A/A,6=A/A N+1,7=N+2,8=DR half)', RESIL[s.resil].code, 'Adds procurement, not throughput'],
    ['sloTtft','SLO: TTFT ≤ (ms, 0=off)', s.sloTtft, ''],
    ['sloTps','SLO: TPS ≥ (tok/s, 0=off)', s.sloTps, ''],
    ['sloP95','SLO: P95 ≤ (s, 0=off)', s.sloP95, ''],
  ];
}
function buildXls(){
  const s=readState();
  const esc=x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const INP=xlsInputRows(s);
  const iRow=k=>3+INP.findIndex(x=>x[0]===k);
  const I=k=>`'Inputs'!R${iRow(k)}C2`;
  const RES=[];
  const rRow=k=>3+RES.findIndex(x=>x[0]===k);
  const R=k=>`R${rRow(k)}C2`;
  function res(key,label,unit,f,str){ RES.push([key,label,unit,f,str]); }
  res('gpusTotal','Total GPUs','', ()=>`${I('workers')}*${I('perW')}`);
  res('weights','Weights','GB', ()=>`${I('params')}*${I('bytesW')}`);
  res('kvTok','KV per token','GB', ()=>`2*${I('layers')}*${I('kvh')}*${I('hdim')}*${I('bytesK')}/1000000000`);
  res('effSeq','Effective sequence','tok', ()=>`${I('seq')}+IF(${I('ext')}=1,${I('reason')},0)`);
  res('replicas','Replicas','', ()=>`MAX(1,INT(${R('gpusTotal')}/MAX(${I('tp')},1)))`);
  res('active','Active sequences','', ()=>`IF(${I('policy')}=1,${I('conc')},MIN(${I('conc')},${I('batch')}*${R('replicas')}))`);
  res('kvTotal','KV cache total','GB', ()=>`${R('active')}*${R('effSeq')}*${R('kvTok')}`);
  res('activ','Activations','GB', ()=>`MIN(${R('effSeq')},8192)*${I('hidden')}*12*${I('bytesW')}/1000000000`);
  res('fixed','Fixed overhead','GB', ()=>`5`);
  res('multi','Multi-GPU overhead','GB', ()=>`MAX(0,${R('gpusTotal')}-1)*15`);
  res('total','Total VRAM required','GB', ()=>`${R('replicas')}*(${R('weights')}+${R('activ')})+${R('kvTotal')}+${R('fixed')}+${R('multi')}`);
  res('avail','VRAM available (serving GPUs)','GB', ()=>`${R('replicas')}*${I('tp')}*${I('vram')}`);
  res('headroom','Headroom','GB', ()=>`${R('avail')}-${R('total')}`);
  res('fits','Memory verdict','', ()=>`IF(${R('total')}<=${R('avail')},"FITS","EXCEEDS")`, true);
  res('bwEff','Effective bandwidth','GB/s', ()=>`${I('bwTB')}*${I('tp')}*${I('ic')}*${I('mbu')}*1000`);
  res('bpr','Batch per replica','', ()=>`MAX(1,${R('active')}/${R('replicas')})`);
  res('tps','Per-user decode TPS','tok/s', ()=>`${R('bwEff')}/(${I('activeP')}*${I('bytesW')}+${R('bpr')}*${R('effSeq')}*${R('kvTok')})`);
  res('agg','Aggregate throughput','tok/s', ()=>`${R('tps')}*${R('active')}`);
  res('ttft','TTFT (prefill)','ms', ()=>`2*${I('seq')}*${I('activeP')}/(${I('tflops')}*${I('tp')}*${I('mfu')})`);
  res('itl','Inter-token latency','ms', ()=>`1000/${R('tps')}`);
  res('lat','User latency (mean)','s', ()=>`(${R('ttft')}+${I('ovh')})/1000+(${I('reason')}+${I('out')})/${R('tps')}`);
  res('p95','P95 latency','s', ()=>`${R('lat')}*1.3`);
  res('sloT','SLO check: TTFT','', ()=>`IF(${I('sloTtft')}=0,"—",IF(${R('ttft')}<=${I('sloTtft')},"PASS","FAIL"))`, true);
  res('sloS','SLO check: TPS','', ()=>`IF(${I('sloTps')}=0,"—",IF(${R('tps')}>=${I('sloTps')},"PASS","FAIL"))`, true);
  res('sloP','SLO check: P95','', ()=>`IF(${I('sloP95')}=0,"—",IF(${R('p95')}<=${I('sloP95')},"PASS","FAIL"))`, true);
  res('procW','Procured workers (this pool + resilience)','', ()=>`${I('workers')}+IF(OR(${I('resil')}=1,${I('resil')}=11),1,IF(OR(${I('resil')}=7,${I('resil')}=10),2,IF(${I('resil')}=4,3*${I('workers')},IF(${I('resil')}=6,${I('workers')}+2,IF(${I('resil')}=8,CEILING(${I('workers')}/2,1),IF(OR(${I('resil')}=2,${I('resil')}=3,${I('resil')}=5),${I('workers')},0))))))`);
  res('procG','Procured GPUs','', ()=>`${R('procW')}*${I('perW')}`);
  res('power','GPU power (TDP)','kW', ()=>`${R('procG')}*${I('watts')}/1000`);

  const cS=(v,st)=>`<Cell${st?` ss:StyleID="${st}"`:''}><Data ss:Type="String">${esc(v)}</Data></Cell>`;
  const cN=(v,st)=>`<Cell${st?` ss:StyleID="${st}"`:''}><Data ss:Type="Number">${v}</Data></Cell>`;
  const cF=(f,str)=>`<Cell ss:StyleID="sOut" ss:Formula="=${esc(f)}"><Data ss:Type="${str?'String':'Number'}">${str?'':0}</Data></Cell>`;
  const row=cells=>`<Row>${cells}</Row>`;
  const name=scenName();
  const inpRows=INP.map(x=>row(cS(x[1],'sLab')+(x[4]==='s'?cS(x[2],'sIn'):cN(x[2],'sIn'))+cS(x[3]||'','sNote'))).join('');
  const resRows=RES.map(x=>row(cS(x[1],'sLab')+cF(x[3](),x[4])+cS(x[2]||'','sNote'))).join('');
  const xml=`<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles>
<Style ss:ID="sTitle"><Font ss:Bold="1" ss:Size="13" ss:Color="#1A2744"/></Style>
<Style ss:ID="sHead"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#1A2744" ss:Pattern="Solid"/></Style>
<Style ss:ID="sLab"><Font ss:Color="#33415C"/></Style>
<Style ss:ID="sIn"><Interior ss:Color="#FFF8E1" ss:Pattern="Solid"/><Font ss:Bold="1" ss:Color="#1F3B99"/></Style>
<Style ss:ID="sOut"><Interior ss:Color="#F2F4F8" ss:Pattern="Solid"/><Font ss:Bold="1" ss:Color="#0F766E"/></Style>
<Style ss:ID="sNote"><Font ss:Italic="1" ss:Size="9" ss:Color="#757575"/></Style>
</Styles>
<Worksheet ss:Name="Inputs"><Table>
<Column ss:Width="215"/><Column ss:Width="120"/><Column ss:Width="330"/>
${row(cS('GPUscale.net · sizing template · '+name,'sTitle'))}
${row(cS('Parameter','sHead')+cS('Value (edit me)','sHead')+cS('Notes','sHead'))}
${inpRows}
</Table></Worksheet>
<Worksheet ss:Name="Results"><Table>
<Column ss:Width="235"/><Column ss:Width="120"/><Column ss:Width="90"/>
${row(cS('Results · live formulas (engine v'+ENGINE_VERSION+')','sTitle'))}
${row(cS('Metric','sHead')+cS('Value','sHead')+cS('Unit','sHead'))}
${resRows}
</Table></Worksheet>
<Worksheet ss:Name="Notes"><Table><Column ss:Width="700"/>
${row(cS('Generated by GPUscale.net · LLM Capacity & Dimensioning Studio on '+new Date().toISOString(),'sNote'))}
${row(cS('Edit the amber cells on the Inputs sheet; Results recompute live with the same engine as the studio.','sNote'))}
${row(cS('Performance is sized on N load-bearing workers; the resilience code adds standby procurement (N+1 = +1 · N+N = +N · DR = +N · N+N+DR = +3N).','sNote'))}
${row(cS('Estimates are peak numbers; production typically achieves 70–90%. Validate with vLLM bench / GenAI-Perf before final commitments.','sNote'))}
</Table></Worksheet>
</Workbook>`;
  return xml;
}


/* ================= XLSX EXPORT (dependency-free: stored-zip OOXML with embedded images) ================= */
const CRC_T=(()=>{const T=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;T[n]=c>>>0;}return T;})();
function crc32(u8){let c=0xFFFFFFFF;for(let i=0;i<u8.length;i++)c=CRC_T[(c^u8[i])&0xFF]^(c>>>8);return (c^0xFFFFFFFF)>>>0;}
function zipStore(entries){ // entries: [name, Uint8Array]
  const enc=new TextEncoder(); const parts=[]; const central=[]; let off=0;
  const u16=v=>new Uint8Array([v&255,(v>>8)&255]);
  const u32=v=>new Uint8Array([v&255,(v>>8)&255,(v>>16)&255,(v>>>24)&255]);
  for(const [name,data] of entries){
    const n=enc.encode(name), crc=crc32(data);
    const head=[u32(0x04034b50),u16(20),u16(0),u16(0),u16(0),u16(22561),u32(crc),u32(data.length),u32(data.length),u16(n.length),u16(0)];
    const hb=concatU8(head.concat([n,data]));
    parts.push(hb);
    central.push({n,crc,size:data.length,off});
    off+=hb.length;
  }
  const cd=[];
  for(const e of central)
    cd.push(concatU8([u32(0x02014b50),u16(20),u16(20),u16(0),u16(0),u16(0),u16(22561),u32(e.crc),u32(e.size),u32(e.size),u16(e.n.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(e.off),e.n]));
  const cdb=concatU8(cd);
  const eocd=concatU8([u32(0x06054b50),u16(0),u16(0),u16(central.length),u16(central.length),u32(cdb.length),u32(off),u16(0)]);
  return concatU8(parts.concat([cdb,eocd]));
}
function concatU8(arr){let len=0;for(const a of arr)len+=a.length;const out=new Uint8Array(len);let p=0;for(const a of arr){out.set(a,p);p+=a.length;}return out;}
const xEsc=x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function svgToPngBytes(svgEl, scale){
  return new Promise((resolve,reject)=>{
    try{
      const vb=svgEl.viewBox&&svgEl.viewBox.baseVal;
      const w=Math.round(((vb&&vb.width)||svgEl.clientWidth||900)*scale);
      const h=Math.round(((vb&&vb.height)||svgEl.clientHeight||400)*scale);
      const clone=svgEl.cloneNode(true);
      clone.setAttribute('width',w); clone.setAttribute('height',h);
      const xml=new XMLSerializer().serializeToString(clone);
      const url=URL.createObjectURL(new Blob([xml],{type:'image/svg+xml;charset=utf-8'}));
      const img=new Image();
      img.onload=()=>{
        const cv=document.createElement('canvas'); cv.width=w; cv.height=h;
        const ctx=cv.getContext('2d');
        ctx.fillStyle=document.documentElement.dataset.theme==='dark'?'#131C30':'#FFFFFF';
        ctx.fillRect(0,0,w,h); ctx.drawImage(img,0,0,w,h);
        URL.revokeObjectURL(url);
        const b64=cv.toDataURL('image/png').split(',')[1];
        const bin=atob(b64), u8=new Uint8Array(bin.length);
        for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i);
        resolve({u8, w, h});
      };
      img.onerror=e=>{URL.revokeObjectURL(url);reject(e);};
      img.src=url;
    }catch(e){reject(e);}
  });
}
function ledgerPngBytes(s,d){
  const W=1200,H=150,cv=document.createElement('canvas');cv.width=W;cv.height=H;
  const ctx=cv.getContext('2d');
  ctx.fillStyle='#FFFFFF';ctx.fillRect(0,0,W,H);
  const scaleMax=Math.max(d.total,d.avail)*1.05, x0=10,x1=W-10,bw=x1-x0;
  const px=v=>x0+bw*v/scaleMax;
  ctx.fillStyle='#EEF1F7';rr(ctx,x0,40,bw,56,8);ctx.fill();
  const segs=[['#475569',d.weightsAll],['#0F766E',d.kvTotal],['#4F63C2',d.actAll],['#CBD5E1',d.fixed+d.multi]];
  let acc=0;
  for(const [col,v] of segs){ctx.fillStyle=col;ctx.fillRect(px(acc),42,Math.max(1,px(acc+v)-px(acc)),52);acc+=v;}
  ctx.strokeStyle='#1A2536';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(px(d.avail),28);ctx.lineTo(px(d.avail),108);ctx.stroke();
  ctx.fillStyle='#1A2536';ctx.font='600 18px Arial';ctx.fillText('Memory ledger · '+fmt(d.total)+' GB needed of '+fmt(d.avail)+' GB serving capacity ('+(d.total/d.avail*100).toFixed(0)+'%)',x0,24);
  ctx.font='14px Arial';ctx.fillStyle='#5A6B8C';
  ctx.fillText('weights x '+d.replicas+' replicas '+fmt(d.weightsAll)+' GB · KV '+fmt(d.kvTotal)+' GB · activations '+fmt(d.actAll)+' GB · overhead '+fmt(d.fixed+d.multi)+' GB · capacity line at '+fmt(d.avail)+' GB',x0,128);
  const b64=cv.toDataURL('image/png').split(',')[1];
  const bin=atob(b64),u8=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i);
  return {u8,w:W,h:H};
  function rr(c,x,y,w,h,r){c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();}
}

async function buildXlsxBytes(){
  const prj=computeProject();
  const actPool=prj.pools[0];
  const multi=UC.length>1;
  const s=multi? actPool.state : readState(), d=multi? actPool.d : compute(s);
  const enc=new TextEncoder();
  const name=projName();

  // ----- input rows (single source also used by the legacy SpreadsheetML export) -----
  const INP=xlsInputRows(s);
  const iIdx={}; INP.forEach((r,i)=>iIdx[r[0]]=i);
  const I=k=>`Inputs!B${iIdx[k]+3}`;

  // ----- results rows: [key,label,unit,formula,liveValue,isString] -----
  const info=RESIL[s.resil], extraW=info.extraW(s.workers), procW=s.workers+extraW, procG=procW*s.perW, powerKW=procG*s.gpu.watts/1000;
  const RES=[]; const rIdx={};
  const R=k=>`B${rIdx[k]+3}`;
  function res(key,label,unit,f,v,str){ rIdx[key]=RES.length; RES.push([key,label,unit,f,v,!!str]); }
  res('gpusTotal','Total serving-fleet GPUs','', ()=>`${I('workers')}*${I('perW')}`, s.gpus);
  res('weights','Weights per replica','GB', ()=>`${I('params')}*${I('bytesW')}`, d.weights);
  res('kvTok','KV per token','GB', ()=>`2*${I('layers')}*${I('kvh')}*${I('hdim')}*${I('bytesK')}/1000000000`, d.kvTok);
  res('effSeq','Effective sequence','tok', ()=>`${I('seq')}+IF(${I('ext')}=1,${I('reason')},0)`, d.effSeq);
  res('replicas','Replicas (model copies)','', ()=> multi? `MIN(MAX(1,INT(${R('gpusTotal')}/MAX(${I('tp')},1))),MAX(1,CEILING(${I('conc')}/MAX(${I('batch')},1),1)))` : `MAX(1,INT(${R('gpusTotal')}/MAX(${I('tp')},1)))`, d.replicas);
  res('active','Admitted sequences','', ()=>`IF(${I('policy')}=1,${I('conc')},MIN(${I('conc')},${I('batch')}*${R('replicas')}))`, d.active);
  res('kvTotal','KV cache total','GB', ()=>`${R('active')}*${R('effSeq')}*${R('kvTok')}`, d.kvTotal);
  res('activ','Activations per replica','GB', ()=>`MIN(${R('effSeq')},8192)*${I('hidden')}*12*${I('bytesW')}/1000000000`, d.act);
  res('fixed','Fixed overhead','GB', ()=>`5`, d.fixed);
  res('multi','Multi-GPU overhead','GB', ()=>`MAX(0,${R('gpusTotal')}-1)*15`, d.multi);
  res('total','Total VRAM required','GB', ()=>`${R('replicas')}*(${R('weights')}+${R('activ')})+${R('kvTotal')}+${R('fixed')}+${R('multi')}`, d.total);
  res('avail','VRAM available (serving GPUs)','GB', ()=>`${R('replicas')}*${I('tp')}*${I('vram')}`, d.avail);
  res('headroom','Headroom','GB', ()=>`${R('avail')}-${R('total')}`, d.headroom);
  res('fits','Memory verdict','', ()=>`IF(${R('total')}<=${R('avail')},"FITS","EXCEEDS")`, d.fits?'FITS':'EXCEEDS', true);
  res('bwEff','Effective bandwidth','GB/s', ()=>`${I('bwTB')}*${I('tp')}*${I('ic')}*${I('mbu')}*1000`, d.bwEff);
  res('bpr','Batch per replica','', ()=>`MAX(1,${R('active')}/${R('replicas')})`, d.batchPerRep);
  res('tps','Per-user decode TPS','tok/s', ()=>`${R('bwEff')}/(${I('activeP')}*${I('bytesW')}+${R('bpr')}*${R('effSeq')}*${R('kvTok')})`, d.tps);
  res('agg','Aggregate throughput','tok/s', ()=>`${R('tps')}*${R('active')}`, d.agg);
  res('ttft','TTFT (prefill)','ms', ()=>`2*${I('seq')}*${I('activeP')}/(${I('tflops')}*${I('tp')}*${I('mfu')})`, d.ttft);
  res('itl','Inter-token latency','ms', ()=>`1000/${R('tps')}`, d.itl);
  res('lat','User latency (mean)','s', ()=>`(${R('ttft')}+${I('ovh')})/1000+(${I('reason')}+${I('out')})/${R('tps')}`, d.latency);
  res('p95','P95 latency','s', ()=>`${R('lat')}*1.3`, d.p95);
  res('sloT','SLO check: TTFT','', ()=>`IF(${I('sloTtft')}=0,"off",IF(${R('ttft')}<=${I('sloTtft')},"PASS","FAIL"))`, s.sloTtft? (d.slo.ttft.pass?'PASS':'FAIL'):'off', true);
  res('sloS','SLO check: TPS','', ()=>`IF(${I('sloTps')}=0,"off",IF(${R('tps')}>=${I('sloTps')},"PASS","FAIL"))`, s.sloTps? (d.slo.tps.pass?'PASS':'FAIL'):'off', true);
  res('sloP','SLO check: P95','', ()=>`IF(${I('sloP95')}=0,"off",IF(${R('p95')}<=${I('sloP95')},"PASS","FAIL"))`, s.sloP95? (d.slo.p95.pass?'PASS':'FAIL'):'off', true);
  res('procW','Procured workers (this pool + resilience)','', ()=>`${I('workers')}+IF(OR(${I('resil')}=1,${I('resil')}=11),1,IF(OR(${I('resil')}=7,${I('resil')}=10),2,IF(${I('resil')}=4,3*${I('workers')},IF(${I('resil')}=6,${I('workers')}+2,IF(${I('resil')}=8,CEILING(${I('workers')}/2,1),IF(OR(${I('resil')}=2,${I('resil')}=3,${I('resil')}=5),${I('workers')},0))))))`, procW);
  res('procG','Procured GPUs (this pool)','', ()=>`${R('procW')}*${I('perW')}`, procG);
  res('power','GPU power (TDP, this pool)','kW', ()=>`${R('procG')}*${I('watts')}/1000`, powerKW);
  res('fleetG','Fleet procured GPUs (all pools + support nodes)','', ()=>`${prj.fleet.procG}`, prj.fleet.procG);

  // ----- curve data -----
  const curveB=[]; const Smax=Math.max(Math.ceil(s.concurrent*1.4), s.batch*d.replicas*2, 16);
  for(let i=0;i<=24;i++){ const S=Math.max(1,Math.round(1+(Smax-1)*i/24));
    const bpr=Math.max(1,S/d.replicas);
    const tps=d.bwEff/(s.active*s.bytesW+bpr*d.effSeq*d.kvTok);
    curveB.push([S,tps,tps*S]); }
  const curveC=[];
  for(let i=0;i<=24;i++){ const c=Math.round(1024*Math.pow(s.ctx/1024, i/24));
    const tps=d.bwEff/(s.active*s.bytesW+d.batchPerRep*c*d.kvTok);
    curveC.push([c,tps]); }

  // ----- images -----
  const images=[];
  try{ images.push(['Memory ledger', ledgerPngBytes(s,d)]); }catch(e){}
  const grabs=[['Throughput vs admitted sequences','#chartBatch svg'],['Per-user speed vs context length','#chartCtx svg']];
  for(const [label,sel] of grabs){
    const el=document.querySelector(sel);
    if(el){ try{ images.push([label, await svgToPngBytes(el, 2)]); }catch(e){} }
  }

  // ----- sheet XML builders -----
  const cell=(ref,style,val,opts)=>{
    if(opts&&opts.formula) return `<c r="${ref}" s="${style}"${opts.str?' t="str"':''}><f>${xEsc(opts.formula)}</f><v>${xEsc(opts.str? val : (isFinite(val)? +(+val).toPrecision(10) : 0))}</v></c>`;
    if(typeof val==='number'&&isFinite(val)) return `<c r="${ref}" s="${style}"><v>${+val.toPrecision(10)}</v></c>`;
    return `<c r="${ref}" s="${style}" t="inlineStr"><is><t>${xEsc(val==null?'':val)}</t></is></c>`;
  };
  const col=i=>String.fromCharCode(65+i);
  function sheetXML(colWidths, rows, drawing){
    const cols=colWidths.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('');
    const body=rows.map((r,ri)=>`<row r="${ri+1}">${r.map((c,ci)=>c==null?'':(typeof c==='string'&&c.startsWith('<c ')?c:cell(col(ci)+(ri+1),0,c))).join('')}</row>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><cols>${cols}</cols><sheetData>${body}</sheetData>${drawing?'<drawing r:id="rId1"/>':''}</worksheet>`;
  }

  // ----- Project sheet: use cases, pools, supporting models, fleet, node map -----
  const projRows=[[`<c r="A1" s="5" t="inlineStr"><is><t>${xEsc('Project · '+name+' · '+prj.pools.length+' pool(s) · '+UC.length+' use case(s)')}</t></is></c>`]];
  const pr=(...cells)=>projRows.push(cells.map((v,i)=>v==null?null:v));
  pr(); pr('USE CASES');
  pr('Name','Preset','Model','Weights','KV','Concurrent','TTFT ms','TPS','P95 s','Supporting');
  UC.forEach(u=>{ const f=u.f; const ci=+f.selCase;
    pr(ucName(u), ci>=0&&CASES[ci]?CASES[ci].name:'Custom', ucModelName(u),
      (QUANTS[+f.selWQuant||0]||{}).name||'', (KV_QUANTS[+f.selKQuant||0]||{}).name||'',
      +f.inConc||0, +f.sloTtft||0, +f.sloTps||0, +f.sloP95||0,
      (u.supports||[]).map(sp=>(KIND_LABEL[sp.kind]||sp.kind)+' ('+sp.model+')').join(', ')); });
  pr(); pr('POOLS · one shared deployment per model+precision');
  pr('Model','Weights','Use cases','TP','Workers','Replicas','Batch','Pooled calls','Fits');
  prj.pools.forEach(p=>pr(p.state.model.name, p.state.wq.name,
    p.members.map(mi=>ucName(UC[mi])).join(' + '), p.state.tp, p.state.workers,
    p.d.replicas, p.state.batch, p.state.concurrent, p.d.fits?'FITS':'EXCEEDS'));
  if(prj.sup.items.length){
    pr(); pr('SUPPORTING MODELS · '+prj.sup.note);
    pr('Kind','Model','Peak demand','Instances','GB / instance','Placement');
    prj.sup.items.forEach(it=>pr(KIND_LABEL[it.kind]||it.kind, it.model.name, it.demand,
      it.instances, it.model.vram, it.units>1? (it.units+'-unit slice each') : (it.perSlice>1? it.perSlice+' instances per slice' : '1 slice each')));
  }
  pr(); pr('FLEET');
  [['Serving GPUs (pools)',prj.fleet.servG],['Support GPUs (shared)',prj.fleet.supG],
   ['Spare pool GPUs',prj.fleet.spare],['Standby nodes (resilience)',prj.fleet.resilW],
   ['Procured nodes',prj.fleet.procW],['Procured GPUs',prj.fleet.procG],
   ['GPU power (TDP) kW',+prj.fleet.kW.toFixed(1)],
   ['VRAM required GB',+prj.fleet.vramNeed.toFixed(1)],['VRAM available GB',+prj.fleet.vramAvail.toFixed(1)],
   ['Verdict', prj.fleet.fits? (prj.fleet.sloAll?'FITS · SLOs MET':'FITS · SLO FAILS'):'EXCEEDS VRAM']].forEach(rw=>pr(rw[0],rw[1]));
  pr(); pr('NODE MAP');
  pr('Node','Site / role','GPU assignments');
  buildFleetSites(prj).sites.forEach(s2=>s2.nodes.forEach(n2=>{
    const parts=n2.gpus.map((g2,k)=>{
      if(g2.type==='pool') return `GPU${k+1}: ${prj.pools[g2.pool].state.model.name} r${g2.rep+1}`;
      if(g2.type==='sup') return `GPU${k+1}: `+g2.bin.slices.map(sl=>(KIND_LABEL[sl.kind]||sl.kind)+(sl.inst>1?' ×'+sl.inst:'')).join('+');
      if(g2.type==='idle') return `GPU${k+1}: ${ROLE_LABEL[n2.cls]||n2.cls}`;
      return `GPU${k+1}: spare`; });
    pr(n2.label, s2.title+' · '+(ROLE_LABEL[n2.cls]||n2.cls), parts.join(' · ')); }));

  const inpRows=[[`<c r="A1" s="5" t="inlineStr"><is><t>${xEsc('GPUscale.net sizing workbook · '+name+(multi? ' · pool 1 of '+prj.pools.length+': '+s.model.name+' '+s.wq.name:'')+' · Studio '+STUDIO_VERSION+' · engine v'+ENGINE_VERSION)}</t></is></c>`],
    ['<c r="A2" s="1" t="inlineStr"><is><t>Parameter</t></is></c>','<c r="B2" s="1" t="inlineStr"><is><t>Value (edit me)</t></is></c>','<c r="C2" s="1" t="inlineStr"><is><t>Notes</t></is></c>']];
  INP.forEach((r,i)=>{
    const ri=i+3;
    inpRows.push([cell('A'+ri,4,r[1]), r[4]==='s'? cell('B'+ri,2,r[2]) : `<c r="B${ri}" s="2"><v>${+(+r[2]).toPrecision(10)}</v></c>`, cell('C'+ri,4,r[3]||'')]);
  });

  const resRows=[[`<c r="A1" s="5" t="inlineStr"><is><t>${xEsc('Results · live formulas + values computed by the studio (engine v'+ENGINE_VERSION+')')}</t></is></c>`],
    ['<c r="A2" s="1" t="inlineStr"><is><t>Metric</t></is></c>','<c r="B2" s="1" t="inlineStr"><is><t>Live formula</t></is></c>','<c r="C2" s="1" t="inlineStr"><is><t>Unit</t></is></c>','<c r="D2" s="1" t="inlineStr"><is><t>Studio value</t></is></c>']];
  RES.forEach((r,i)=>{
    const ri=i+3;
    resRows.push([cell('A'+ri,4,r[1]), cell('B'+ri,3,r[4],{formula:r[3](),str:r[5]}), cell('C'+ri,4,r[2]||''), r[5]? cell('D'+ri,3,r[4]) : `<c r="D${ri}" s="3"><v>${+(+r[4]).toPrecision(10)}</v></c>`]);
  });

  const curveRows=[[`<c r="A1" s="5" t="inlineStr"><is><t>Chart source data (as plotted in the studio)</t></is></c>`],
    ['<c r="A2" s="1" t="inlineStr"><is><t>Admitted seqs</t></is></c>','<c r="B2" s="1" t="inlineStr"><is><t>Per-user tok/s</t></is></c>','<c r="C2" s="1" t="inlineStr"><is><t>Aggregate tok/s</t></is></c>',null,'<c r="E2" s="1" t="inlineStr"><is><t>Context tokens</t></is></c>','<c r="F2" s="1" t="inlineStr"><is><t>Per-user tok/s</t></is></c>']];
  for(let i=0;i<25;i++){
    curveRows.push([curveB[i][0],curveB[i][1],curveB[i][2],null,curveC[i][0],curveC[i][1]]);
  }

  // visuals sheet: labels + anchored images
  const visRows=[[`<c r="A1" s="5" t="inlineStr"><is><t>Visuals · exported from the studio at save time</t></is></c>`]];
  __storyText.forEach((line,i)=>{ visRows.push([cell('A'+(visRows.length+1),4,line)]); });
  visRows.push([]);
  const EMU=9525, colW=64, rowH=20; // px per default col/row approx
  let anchorRow=2; const anchors=[]; const media=[];
  images.forEach(([label,img],idx)=>{
    while(visRows.length<anchorRow) visRows.push([]);
    visRows.push([cell('A'+(anchorRow+1),4,label)]);
    const dispW=Math.min(img.w,1180), dispH=Math.round(img.h*dispW/img.w);
    anchors.push(`<xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${anchorRow+1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="${dispW*EMU}" cy="${dispH*EMU}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${idx+2}" name="img${idx+1}"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" r:embed="rId${idx+1}"/><a:stretch xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:off x="0" y="0"/><a:ext cx="${dispW*EMU}" cy="${dispH*EMU}"/></a:xfrm><a:prstGeom xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`);
    media.push(img.u8);
    anchorRow += Math.ceil(dispH/rowH)+3;
  });
  while(visRows.length<anchorRow) visRows.push([]);

  const drawingXML=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${anchors.join('')}</xdr:wsDr>`;
  const drawingRels=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${media.map((m,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${i+1}.png"/>`).join('')}</Relationships>`;

  const styles=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="6"><font><sz val="10"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Arial"/></font><font><b/><color rgb="FF1F3B99"/><sz val="10"/><name val="Arial"/></font><font><b/><color rgb="FF0F766E"/><sz val="10"/><name val="Arial"/></font><font><i/><color rgb="FF757575"/><sz val="9"/><name val="Arial"/></font><font><b/><color rgb="FF1A2744"/><sz val="12"/><name val="Arial"/></font></fonts>
<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1A2536"/><bgColor rgb="FF1A2536"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF8E1"/><bgColor rgb="FFFFF8E1"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF2F4F8"/><bgColor rgb="FFF2F4F8"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0"/><xf numFmtId="0" fontId="2" fillId="3" borderId="0"/><xf numFmtId="0" fontId="3" fillId="4" borderId="0"/><xf numFmtId="0" fontId="4" fillId="0" borderId="0"/><xf numFmtId="0" fontId="5" fillId="0" borderId="0"/></cellXfs>
</styleSheet>`;

  const workbook=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Inputs" sheetId="1" r:id="rId1"/><sheet name="Results" sheetId="2" r:id="rId2"/><sheet name="Chart data" sheetId="3" r:id="rId3"/><sheet name="Visuals" sheetId="4" r:id="rId4"/><sheet name="Project" sheetId="5" r:id="rId5"/></sheets></workbook>`;
  const wbRels=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet4.xml"/><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet5.xml"/><Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const rootRels=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const contentTypes=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet4.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet5.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`;
  const sheet4Rels=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`;

  const entries=[
    ['[Content_Types].xml', enc.encode(contentTypes)],
    ['_rels/.rels', enc.encode(rootRels)],
    ['xl/workbook.xml', enc.encode(workbook)],
    ['xl/_rels/workbook.xml.rels', enc.encode(wbRels)],
    ['xl/styles.xml', enc.encode(styles)],
    ['xl/worksheets/sheet1.xml', enc.encode(sheetXML([34,16,52], inpRows))],
    ['xl/worksheets/sheet2.xml', enc.encode(sheetXML([34,42,10,14], resRows))],
    ['xl/worksheets/sheet3.xml', enc.encode(sheetXML([14,14,15,4,15,14], curveRows))],
    ['xl/worksheets/sheet4.xml', enc.encode(sheetXML([120], visRows, true))],
    ['xl/worksheets/sheet5.xml', enc.encode(sheetXML([22,22,34,10,10,10,10,12,10,40], projRows))],
    ['xl/worksheets/_rels/sheet4.xml.rels', enc.encode(sheet4Rels)],
    ['xl/drawings/drawing1.xml', enc.encode(drawingXML)],
    ['xl/drawings/_rels/drawing1.xml.rels', enc.encode(drawingRels)],
  ];
  media.forEach((m,i)=>entries.push([`xl/media/image${i+1}.png`, m]));
  return zipStore(entries);
}

/* ================= WIRING ================= */
function deriveConcFor(u){
  const f=u.f;
  const users=Math.max(1,+f.nrmUsers||1);
  const cs=CASES[+f.selCase];
  if(cs&&cs.traffic&&cs.traffic.direct){ f.ccSessions=users; f.inConc=users; u.concManual=false; return users; }
  const turns=+f.ccTurns||8, share=(+f.ccShare||100)/100;
  const calls=+f.ccCalls||1.5, burst=+f.ccBurst||1.5;
  const dur=+f.ccDur>0? +f.ccDur : Math.min(120, Math.max(5, window.__lastLat||20));
  const conc=Math.max(1, Math.ceil(users*turns*share*calls*dur/3600*burst));
  f.ccSessions=users; f.inConc=conc;
  u.concManual=false;
  return conc;
}
function applyNrmUsers(){
  captureUc();
  const u=UC[activeUc]; if(!u) return 1;
  const conc=deriveConcFor(u);
  $('ccSessions').value=u.f.nrmUsers; $('inConc').value=conc; refreshCtl('inConc');
  return conc;
}
document.querySelectorAll('input,select').forEach(el=>{
  el.addEventListener('input',()=>{
    if(el.id==='selCase') applyCase(+el.value);
    if(el.id==='selReason') syncReason();
    if(el.id==='chkCustom'){ $('customBox').style.display=el.checked?'block':'none'; $('selModel').disabled=el.checked; }
    if(el.id==='nrmUsers'||el.id==='ccTurns'||el.id==='ccShare'||el.id==='ccCalls'||el.id==='ccBurst'||el.id==='ccDur') applyNrmUsers();
    if((el.id==='inConc'||el.id==='inConc_r')&&UC[activeUc]) UC[activeUc].concManual=true;
    if(el.id==='selResilSimple') $('selResil').value=el.value;
    if(el.id==='selResil'){ const v=el.value, sim=$('selResilSimple');
      if(sim) sim.value = v==='n'? 'n' : (v==='n1'||v==='n2')? 'n1' : 'dr'; }
    if(el.id==='scenarioName') return;
    render();
    scheduleAuto();
  });
});
$('ccApply').addEventListener('click',()=>{ $('inConc').value=Math.max(1,+$('ccDerived').dataset.cc||1); refreshCtl('inConc'); render(); toast('Concurrency applied'); });

/* ================= AUTO-SIZE ================= */
function solvePool(s){
  const weights=s.params*s.bytesW;
  const actGB=Math.min(s.resident+(s.extend?s.reasonTok:0),8192)*s.hidden*12*s.bytesW/1e9;
  const packPct=Math.min(95,Math.max(50,+($('autoUtil')&&$('autoUtil').value)||80)), pack=packPct/100;
  // TP must leave room per GPU for the ~15 GB multi-GPU overhead too, or the
  // worker loop can never converge: (weights+act)/tp + 15 <= pack*vram
  let tp=[1,2,4,8,16,32,64,72].find(t=>weights+actGB<=Math.max(1,(pack*s.gpuVram-15))*t);
  if(!tp) return {ok:false, packPct,
    reason:`No TP up to 64 fits one copy of ${s.model.name} on ${s.gpu.name}: quantize the weights or pick a higher-VRAM GPU`};
  const tpFit=tp;
  // widen TP while a TTFT target is missed (prefill scales with TP)
  if(s.sloTtft>0){ let t=tp; while(t<64 && 2*s.resident*s.active/(s.gpuTflops*t*s.mfu)>s.sloTtft) t*=2; tp=Math.min(72,t); }
  const widened=tp>tpFit;
  const crossed=tp>s.perW;
  const ic=crossed? Math.min(s.ic,0.7) : s.ic;
  const interactive=(s.sloTtft>0||s.sloTps>0||s.sloP95>0);
  const eva=(workers,batch)=>compute({...s, tp, ic, workers, gpus:workers*s.perW, batch});
  let workers, batch, d;
  let converged=false;
  if(interactive){
    // fewest workers that admit the peak concurrency at a batch of at most 64, then grow until it fits
    workers=Math.min(64,Math.max(1,Math.ceil(Math.max(1,Math.ceil(s.concurrent/64))*tp/s.perW)));
    for(;;){
      const replicas=Math.max(1,Math.floor(workers*s.perW/tp));
      batch=Math.min(64,Math.max(1,Math.ceil(s.concurrent/replicas)));
      d=eva(workers,batch);
      if(d.total<=pack*d.avail){ converged=true; break; }
      if(workers>=64) break;
      workers++;
    }
  } else {
    // offline: queueing is fine, so keep hardware minimal and pick the largest batch that fits
    workers=Math.max(1,Math.ceil(tp/s.perW));
    outer: for(;;){
      for(const b of [256,128,64,32,16,8,4,2,1]){
        batch=b; d=eva(workers,b);
        if(d.total<=pack*d.avail){ converged=true; break outer; }
      }
      if(workers>=64) break;
      workers++;
    }
  }
  if(!converged) return {ok:false, packPct,
    reason:`Could not fit ${s.model.name} at TP${tp} within the ${packPct}% memory target even at 64 workers: quantize the weights, raise the target, or pick a higher-VRAM GPU`};
  return {ok:true, tp, tpFit, widened, crossed, workers, batch, packPct, weights, actGB};
}
function autoSizeProject(quiet){
  captureUc();
  const prj=computeProject();
  const lines=[]; let anyCrossed=false, allOk=true;
  prj.pools.forEach(p=>{
    const r=solvePool(p.state);
    if(!r.ok){ allOk=false; lines.push(`${p.state.model.name} ${p.state.wq.name}: ${r.reason}`); return; }
    anyCrossed=anyCrossed||r.crossed;
    p.members.forEach(mi=>{ const f=UC[mi].f; f.inTp=r.tp; f.inWorkers=r.workers; f.inBatch=r.batch; });
    const names=p.members.map(mi=>ucName(UC[mi])).join(' + ');
    lines.push(`${p.state.model.name} ${p.state.wq.name} (${names}): TP${r.tp} · ${r.workers} worker${r.workers>1?'s':''} · batch ${r.batch} for ${p.state.concurrent} pooled calls${r.widened?', TP widened for the TTFT target':''}${r.crossed?', one copy spans workers':''}.`);
  });
  if(anyCrossed&&+$('inIc').value>0.7){ $('inIc').value=0.7; refreshCtl('inIc'); }
  loadUc(activeUc); renderUcCards(); render();
  const done=computeProject();
  const why=`Sized each pool separately. `+lines.join(' ')+
    (done.sup.gpus? ` Supporting models need ${done.sup.gpus} shared GPU${done.sup.gpus>1?'s':''}: ${Math.min(done.fleet.spare,done.sup.gpus)} covered by spare pool GPUs, ${done.fleet.supExtraG} added.`:'')+
    ` Fleet: ${done.fleet.servG} serving GPUs across ${done.fleet.servW} workers, ${done.fleet.procG} procured with ${RESIL[done.hw.resil].label} resilience.`;
  const ar=$('autoResult'); if(ar){ ar.textContent=why+' Auto-size sets TP, workers and batch only; suggestions that change model or precision stay in Recommendations, as your call.'; ar.classList.add('show'); }
  if(!quiet||!allOk) toast(allOk? `Auto-sized ${prj.pools.length} pool${prj.pools.length>1?'s':''}: ${done.fleet.servG} serving GPUs, ${done.fleet.procG} procured` : 'Auto-size finished with problems: see the note under the Auto-size control', !allOk);
}
function autoSize(quiet){
  captureUc();
  UC.forEach(u=>{ if(!u.concManual) deriveConcFor(u); });
  loadUc(activeUc);
  if(UC.length>1) return autoSizeProject(quiet);
  const s=readState();
  const r=solvePool(s);
  if(!r.ok){ toast(r.reason, true); return; }
  const __quiet=!!quiet;
  const {tp, tpFit, widened, crossed, workers, batch, packPct, weights, actGB}=r;
  const interactive=(s.sloTtft>0||s.sloTps>0||s.sloP95>0);
  $('inTp').value=tp; refreshCtl('inTp');
  $('inWorkers').value=workers; refreshCtl('inWorkers');
  $('inBatch').value=batch; refreshCtl('inBatch');
  if(crossed&&+$('inIc').value>0.7){ $('inIc').value=0.7; refreshCtl('inIc'); }
  render();
  const df=compute(readState());
  const qAlt=QUANTS.filter(q=>q.bytes<s.bytesW && (s.params*q.bytes+actGB)<=0.8*s.perW*s.gpuVram).sort((a,b)=>b.bytes-a.bytes)[0];
  let why=`Chose TP${tp}: one ${s.wq.name} copy of ${s.model.name} is ${fmt(weights)} GB, and ${tp} × ${fmt(s.gpuVram)} GB GPUs is the smallest slice group that holds it with room for cache${widened?`, widened from TP${tpFit} to meet the ${fmt(s.sloTtft)} ms TTFT target`:''}. `;
  why+= crossed
    ? `Trade-off: one copy spans ${Math.ceil(tp/s.perW)} workers, so decode pays a network penalty (interconnect set to 0.7) and real prefill will be slower than shown. ${qAlt?`To stay inside one worker instead, switch weights to ${qAlt.name} in the Precision station (${fmt(s.params*qAlt.bytes)} GB fits TP${s.perW}). `:''}`
    : `One copy stays inside a single worker's NVLink island: no network penalty. `;
  why+=`${workers} worker${workers>1?'s':''} give ${df.replicas} cop${df.replicas>1?'ies':'y'} serving ${df.active} of ${s.concurrent} calls at batch ${batch}. `;
  why+= df.fits? (df.sloAll? 'Result: fits, and every SLO target passes. ' : 'Result: memory fits, but an SLO target still fails. Hardware alone cannot fix that one: see Recommendations below. ') : 'Result: still exceeds VRAM, see Recommendations. ';
  if(df.fits){
    const u=df.total/df.avail*100;
    why+=`Memory sits at ${u.toFixed(0)}% against your ${packPct}% target: the smallest whole-GPU fleet that ${interactive?'admits every call in the contract':'fits the model with the largest batch'} within it. The gap below the target is the rounding cost of whole GPUs and power-of-two TP; the gap above it would be your growth and burst margin. Raise the target to pack tighter, lower it for more headroom.`;
  }
  const ar=$('autoResult'); if(ar){ ar.textContent=why+' Auto-size sets TP, workers and batch only; suggestions that change model or precision stay in Recommendations, as your call.'; ar.classList.add('show'); }
  if(!__quiet) toast(`Auto-sized: TP${tp} · ${df.replicas} replica${df.replicas>1?'s':''} on ${workers} workers · batch ${batch} · ${df.active} of ${s.concurrent} admitted${df.fits? (df.sloAll?'':' · an SLO still fails, see Recommendations') : ' · still over VRAM, see Recommendations'}`);
}
let __autoT=null;
function scheduleAuto(){
  if(document.documentElement.dataset.uxMode!=='normal') return;
  clearTimeout(__autoT); __autoT=setTimeout(()=>autoSize(true), 500);
}
$('btnAuto').addEventListener('click',()=>autoSize());
{ const mb=$('miniBar'); if(mb) mb.addEventListener('click',()=>{ $('verdict').scrollIntoView({behavior:'smooth'}); }); }
document.querySelectorAll('#modeSeg button').forEach(b=>b.addEventListener('click',()=>{ setUxMode(b.dataset.mode); }));
$('btnReset').addEventListener('click',()=>location.reload());

const MOON='<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>';
const SUN='<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
function setTheme(t){
  document.documentElement.dataset.theme=t;
  $('icoTheme').innerHTML = t==='light'? MOON : SUN;
  render();
}
$('btnTheme').addEventListener('click',()=>{ window.__themeLocked=true;
  setTheme(document.documentElement.dataset.theme==='light'?'dark':'light'); });
try{ matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e=>{
  if(!window.__themeLocked) setTheme(e.matches?'dark':'light'); }); }catch(e){}
let __rzT=null;
window.addEventListener('resize',()=>{ clearTimeout(__rzT); __rzT=setTimeout(render,180); });

function download(blobParts, type, filename){
  const blob=new Blob(blobParts,{type});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),2000);
}
const slug=()=>scenName().replace(/[^A-Za-z0-9_-]+/g,'-').replace(/^-|-$/g,'')||'scenario';
$('btnExport').addEventListener('click',()=>{
  download([JSON.stringify(serialize(),null,2)],'application/json',`gpuscale-${slug()}-${new Date().toISOString().slice(0,10)}.json`);
  toast('Configuration exported');
});
$('btnXls').addEventListener('click',async()=>{
  try{
    render();
    const bytes=await buildXlsxBytes();
    download([bytes],'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',`gpuscale-${slug()}.xlsx`);
    toast('Excel workbook exported: inputs, live formulas, chart data and visuals');
  }catch(e){
    download([buildXls()],'application/vnd.ms-excel',`gpuscale-${slug()}-template.xls`);
    toast('Image embed unavailable here; exported the classic formula template instead', true);
  }
});
$('btnPdf').addEventListener('click',()=>{ render(); window.print(); });
let printThemeRestore=null, printTitleRestore=null;
window.addEventListener('beforeprint',()=>{
  printTitleRestore=document.title;
  document.title='gpuscale-'+slug();
  if(document.documentElement.dataset.theme==='dark'){ printThemeRestore='dark'; setTheme('light'); } });
window.addEventListener('afterprint',()=>{
  if(printTitleRestore){ document.title=printTitleRestore; printTitleRestore=null; }
  if(printThemeRestore){ setTheme(printThemeRestore); printThemeRestore=null; } });
$('btnImport').addEventListener('click',()=>$('fileImport').click());
$('fileImport').addEventListener('change',e=>{
  const f=e.target.files[0]; if(!f) return;
  const r=new FileReader();
  r.onload=()=>{ try{ const notes=applyConfig(JSON.parse(r.result))||[];
      autoSize(true);
      toast(notes.length? 'Imported and auto-sized, with notes: '+notes.join(' · ') : 'Imported and auto-sized for the file\u2019s demand', notes.length>0); }
    catch(err){ toast('Import failed: not a valid configuration file', true); } };
  r.onerror=()=>toast('Could not read the file', true);
  r.readAsText(f);
  e.target.value='';
});

/* ================= PUBLIC API & BOOT ================= */
window.GPUscale = {compute, readState, serialize, applyConfig, buildXls, buildXlsxBytes, render, autoSize, computeProject, MODELS, GPUS, QUANTS, CASES,
  usecases:{list:()=>UC, active:()=>activeUc, add:addUc, select:selectUc, remove:removeUc}};
window.SizingConsole = window.GPUscale;
(function boot(){
  UC.push({id:'uc'+(++ucSeq), name:'', f:{}, supports:[], isolate:false});
  const mi=MODELS.findIndex(m=>/Kimi K2\.5/.test(m.name)); if(mi>=0)$('selModel').value=mi;
  const wi=QUANTS.findIndex(q=>q.name==='BF16'); if(wi>=0)$('selWQuant').value=wi;
  const gi=GPUS.findIndex(g2=>/B300/.test(g2.name)); if(gi>=0)$('selGpu').value=gi;
  const ci=CASES.findIndex(c=>/Voice agent/.test(c.name)); if(ci>=0){ $('selCase').value=ci; applyCase(ci); }
  setTheme(document.documentElement.dataset.theme==='dark'?'dark':'light');
  syncReason();
  Object.keys(FIELDS).forEach(refreshCtl);
  const lv=document.getElementById('libVer');
  if(lv && DATA.meta) lv.textContent = (DATA.meta.library||'?')+' ('+(DATA.meta.updated||'')+')';
  const av=document.getElementById('appVer'); if(av) av.textContent='Studio '+STUDIO_VERSION;
  const ev=document.getElementById('engVer'); if(ev) ev.textContent='v'+ENGINE_VERSION;
  const vc=document.getElementById('verChip'); if(vc) vc.textContent='v'+STUDIO_VERSION.replace(/\.0$/,'');
  $('scenarioName').placeholder=PROJ_ID;
  try{ setUxMode(localStorage.getItem('gpuscale-mode')||'advanced'); }catch(e){ setUxMode('advanced'); }
  const sid=document.getElementById('storyId'); if(sid) sid.textContent=PROJ_ID;
  captureUc();
  render();
})();
