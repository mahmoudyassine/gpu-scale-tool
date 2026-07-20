'use strict';
/* ================= DATA ================= */
const DATA = window.GPUSCALE_DATA || {};
const MODELS = DATA.models||[], GPUS = DATA.gpus||[], QUANTS = DATA.quants||[], CASES = DATA.cases||[];
if(!MODELS.length || !GPUS.length || !QUANTS.length || !CASES.length){
  document.body.innerHTML = '<div style="font-family:system-ui,sans-serif;max-width:560px;margin:80px auto;padding:0 20px;line-height:1.65;color:#1A2536"><h2 style="margin-bottom:10px">Data files not loaded</h2><p>GPUscale.net could not find its library. Keep <code>index.html</code> together with the <code>data/</code> and <code>assets/</code> folders: the four files <code>data/models.js</code>, <code>data/gpus.js</code>, <code>data/quants.js</code> and <code>data/usecases.js</code> must sit next to this page.</p><p>If you need one portable file instead, use <code>dist/gpuscale_standalone.html</code> or rebuild it with <code>python3 tools/build_single_file.py</code>.</p></div>';
  throw new Error('GPUscale.net data missing');
}
const STUDIO_VERSION = '4.13.0', ENGINE_VERSION = 23;
const KV_QUANTS = [{name:'BF16',bytes:2},{name:'FP16',bytes:2},{name:'FP8',bytes:1},{name:'INT8',bytes:1},{name:'INT4',bytes:0.5}];
const REASON_TOK = {'None':0,'Light reasoning':2000,'Heavy reasoning':8000,'Custom':2000};
const RESIL = {
  n:   {code:0, label:'N',       long:'N · capacity only',                              extraW:n=>0,              live:n=>n},
  n1:  {code:1, label:'N+1',     long:'N+1 · one standby worker',                       extraW:n=>1,              live:n=>n},
  n2:  {code:7, label:'N+2',     long:'N+2 · two standby workers',                      extraW:n=>2,              live:n=>n},
  nn:  {code:2, label:'N+N',     long:'N+N · in-site mirror (2N)',                      extraW:n=>n,              live:n=>n},
  dr:  {code:3, label:'DR',      long:'DR · full standby site (active/passive)',        extraW:n=>n,              live:n=>n},
  drh: {code:8, label:'DR ½',    long:'DR · half-size standby site (1.5N)',             extraW:n=>Math.ceil(n/2), live:n=>n, degraded:true},
  aas: {code:9, label:'A/A ½+½', long:'Active/Active split · N across two sites (1x)',  extraW:n=>0,              live:n=>n, degraded:true},
  aa:  {code:5, label:'A/A',     long:'Active/Active · two live sites (2N)',            extraW:n=>n,              live:n=>2*n},
  aan1:{code:6, label:'A/A N+1', long:'Active/Active · N+1 in each of two sites (2N+2)',extraW:n=>n+2,            live:n=>2*n},
  nndr:{code:4, label:'N+N+DR',  long:'N+N + DR · active/active twin sites (4N)',       extraW:n=>3*n,            live:n=>2*n},
};

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
function toast(msg, err){
  const t=document.createElement('div'); t.className='toast'+(err?' err':''); t.textContent=msg;
  $('toast').appendChild(t); requestAnimationFrame(()=>t.classList.add('show'));
  setTimeout(()=>{ t.classList.remove('show'); setTimeout(()=>t.remove(),250); }, 2400);
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
function renderTopology(s,d){
  const P=pal();
  const perGpu=d.total/(d.servingGpus||s.gpus), cap=s.gpuVram, fillPct=Math.min(1,perGpu/cap), hot=perGpu>cap;
  const utilTxt=(perGpu/cap*100).toFixed(0)+'%';
  const cell={w:20,h:34,g:4};
  const cols=Math.min(s.perW,8), rows=Math.ceil(s.perW/8);
  const cardW=20+cols*cell.w+(cols-1)*cell.g;
  const cardH=25+rows*cell.h+(rows-1)*cell.g+24;
  // narrow containers get a narrow canvas so cards stack and text stays legible when scaled
  const boxW=($('topo')&&$('topo').clientWidth)||1000;
  const W = boxW&&boxW<640 ? Math.max(320,Math.min(480,boxW)) : 1000;
  const gapCard=12, framePad=14, frameGap=40;
  const innerW=W-24-framePad*2;
  const perRow=Math.max(1,Math.floor((innerW+gapCard)/(cardW+gapCard)));
  const MODE={active:{col:P.line,tag:null},
              standby:{col:P.amber,tag:'STANDBY'},
              mirror:{col:P.teal,tag:'MIRROR'},
              drs:{col:P.violet,tag:'DR'}};

  function workerCard(x,y,label,mode){
    const M=MODE[mode], dashed=mode!=='active';
    let g=`<g>`;
    g+=`<rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="8" fill="${P.bg}" stroke="${dashed?M.col:P.line}" stroke-width="1.3"${dashed?' stroke-dasharray="5 4"':''}/>`;
    g+=`<text x="${x+10}" y="${y+15}" fill="${dashed?M.col:P.muted}" font-size="9.5" font-weight="600" font-family="IBM Plex Mono,monospace">${dashed?M.tag:label}</text>`;
    g+=`<text x="${x+cardW-10}" y="${y+15}" fill="${dashed?P.faint:(hot?P.red:P.teal)}" font-size="9.5" font-weight="600" text-anchor="end" font-family="IBM Plex Mono,monospace">${dashed?'idle':utilTxt}</text>`;
    for(let i=0;i<s.perW;i++){
      const cx=x+10+(i%8)*(cell.w+cell.g), cy=y+25+Math.floor(i/8)*(cell.h+cell.g);
      g+=`<rect x="${cx}" y="${cy}" width="${cell.w}" height="${cell.h}" rx="3" fill="${dashed?'none':P.inset}" stroke="${dashed?M.col:P.lineSoft}" stroke-width="1"${dashed?' stroke-dasharray="3 2.5"':''}/>`;
      if(!dashed){
        const fh=Math.max(2,(cell.h-2)*fillPct);
        g+=`<rect x="${cx+1}" y="${cy+cell.h-1-fh}" width="${cell.w-2}" height="${fh}" rx="2" fill="${hot?P.red:P.segkv}"/>`;
      }
    }
    const cap8=`${s.perW}× GPU · `+(dashed? (mode==='standby'?'standby':mode==='mirror'?'mirror':'DR standby') : `${fmt(perGpu*s.perW)}/${fmt(cap*s.perW)} GB`);
    g+=`<text x="${x+cardW/2}" y="${y+cardH-8}" fill="${P.faint}" font-size="8.5" text-anchor="middle" font-family="IBM Plex Mono,monospace">${cap8}</text>`;
    return g+'</g>';
  }

  function frame(y0, title, items, chip, iconName){
    const maxDraw=16;
    let list=items;
    if(items.length>maxDraw){
      const specials=items.filter(it=>it.mode!=='active');
      const actives=items.filter(it=>it.mode==='active');
      const room=Math.max(actives.length?1:0, maxDraw-1-specials.length);
      const shown=[...actives.slice(0,room),...specials].slice(0,maxDraw-1);
      list=[...shown,{mode:'more',n:items.length-shown.length}];
    }
    const rowsN=Math.ceil(list.length/perRow);
    const fh=32+framePad+rowsN*(cardH+gapCard)-gapCard+framePad;
    let g=`<g>`;
    g+=`<rect x="12" y="${y0}" width="${W-24}" height="${fh}" rx="12" fill="${P.panel2}" stroke="${P.line}" stroke-width="1"/>`;
    if(iconName) g+=svgIco(iconName, 12+framePad, y0+8, 15, P.muted);
    g+=`<text x="${12+framePad+(iconName?22:0)}" y="${y0+21}" fill="${P.text}" font-size="12" font-weight="600" font-family="Archivo,Inter,sans-serif">${title}</text>`;
    const chipX=W-12-framePad;
    g+=svgIco('zap', chipX-chip.length*5.55-18, y0+11, 12, P.faint);
    g+=`<text x="${chipX}" y="${y0+21}" fill="${P.faint}" font-size="9.5" text-anchor="end" font-family="IBM Plex Mono,monospace">${chip}</text>`;
    list.forEach((it,k)=>{
      const x=12+framePad+(k%perRow)*(cardW+gapCard);
      const y=y0+32+framePad+Math.floor(k/perRow)*(cardH+gapCard);
      if(it.mode==='more'){
        g+=`<rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="8" fill="none" stroke="${P.lineSoft}" stroke-width="1.3" stroke-dasharray="4 4"/>`;
        g+=`<text x="${x+cardW/2}" y="${y+cardH/2+4}" fill="${P.faint}" font-size="11" text-anchor="middle" font-family="IBM Plex Mono,monospace">+${it.n} more</text>`;
      } else g+=workerCard(x,y,it.label,it.mode);
    });
    return {svg:g+'</g>', h:fh};
  }

  const N=s.workers, r=s.resil;
  const act=(pre)=>Array.from({length:N},(_,i)=>({mode:'active',label:`${pre}${String(i+1).padStart(2,'0')}`}));
  const dup=(mode)=>Array.from({length:N},()=>({mode}));
  let y=4, parts=[], links=[];
  const gpuChip=(n,extra)=>`${n} worker${n>1?'s':''} · ${n*s.perW} GPU · ${fmt(n*s.perW*s.gpu.watts/1000)} kW${extra||''}`;
  if(r==='n'){
    const f=frame(y,`Production site · N=${N}`,act('WK-'),gpuChip(N),'building'); parts.push(f.svg); y+=f.h;
  } else if(r==='n1'){
    const f=frame(y,`Production site · N+1`,[...act('WK-'),{mode:'standby'}],gpuChip(N+1),'building'); parts.push(f.svg); y+=f.h;
  } else if(r==='n2'){
    const f=frame(y,`Production site · N+2`,[...act('WK-'),{mode:'standby'},{mode:'standby'}],gpuChip(N+2),'building'); parts.push(f.svg); y+=f.h;
  } else if(r==='drh'){
    const half=Math.ceil(N/2);
    const fa=frame(y,`Primary site · active · N=${N}`,act('WK-'),gpuChip(N),'building'); parts.push(fa.svg); y+=fa.h;
    links.push({y:y+frameGap/2, lab:'async replication', both:false});
    y+=frameGap;
    const fb=frame(y,`DR site · half-size standby · ${half} worker${half>1?'s':''}`,Array.from({length:half},()=>({mode:'drs'})),gpuChip(half,' · standby'),'globe'); parts.push(fb.svg); y+=fb.h;
  } else if(r==='nn'){
    const fa=frame(y,`System A · active · N=${N}`,act('WK-'),gpuChip(N),'building'); parts.push(fa.svg); y+=fa.h;
    links.push({y:y+frameGap/2, lab:'in-site failover', both:true});
    y+=frameGap;
    const fb=frame(y,`System B · mirror · N=${N}`,dup('mirror'),gpuChip(N,' · idle'),'shield'); parts.push(fb.svg); y+=fb.h;
  } else if(r==='dr'){
    const fa=frame(y,`Primary site · active · N=${N}`,act('WK-'),gpuChip(N),'building'); parts.push(fa.svg); y+=fa.h;
    links.push({y:y+frameGap/2, lab:'async replication', both:false});
    y+=frameGap;
    const fb=frame(y,`DR site · standby · N=${N}`,dup('drs'),gpuChip(N,' · standby'),'globe'); parts.push(fb.svg); y+=fb.h;
  } else if(r==='aas'){
    const nA=Math.max(1,Math.ceil(N/2)), nB=Math.max(0,N-nA);
    const acts=(pre,cnt,off)=>Array.from({length:cnt},(_,i)=>({mode:'active',label:`${pre}${String(i+1+off).padStart(2,'0')}`}));
    const fa=frame(y,`Site A · active · ${nA} of N=${N}`,acts('WK-',nA,0),gpuChip(nA),'building'); parts.push(fa.svg); y+=fa.h;
    if(nB>0){
      links.push({y:y+frameGap/2, lab:'active / active · geo load balancing', both:true});
      y+=frameGap;
      const fb=frame(y,`Site B · active · ${nB} of N=${N}`,acts('WK-',nB,nA),gpuChip(nB),'building'); parts.push(fb.svg); y+=fb.h;
    }
  } else if(r==='aa'){
    const fa=frame(y,`Site A · active · N=${N}`,act('A-'),gpuChip(N),'building'); parts.push(fa.svg); y+=fa.h;
    links.push({y:y+frameGap/2, lab:'active / active · geo load balancing', both:true});
    y+=frameGap;
    const fb=frame(y,`Site B · active · N=${N}`,act('B-'),gpuChip(N),'building'); parts.push(fb.svg); y+=fb.h;
  } else if(r==='aan1'){
    const fa=frame(y,`Site A · active · N+1`,[...act('A-'),{mode:'standby'}],gpuChip(N+1),'building'); parts.push(fa.svg); y+=fa.h;
    links.push({y:y+frameGap/2, lab:'active / active · geo load balancing', both:true});
    y+=frameGap;
    const fb=frame(y,`Site B · active · N+1`,[...act('B-'),{mode:'standby'}],gpuChip(N+1),'building'); parts.push(fb.svg); y+=fb.h;
  } else { /* nndr: active/active twin sites, each N+N */
    const fa=frame(y,`Site A · active · N+N`,[...act('A-'),...dup('mirror')],gpuChip(2*N),'building'); parts.push(fa.svg); y+=fa.h;
    links.push({y:y+frameGap/2, lab:'active / active · geo-replication', both:true});
    y+=frameGap;
    const fb=frame(y,`Site B · active · N+N`,[...act('B-'),...dup('mirror')],gpuChip(2*N),'building'); parts.push(fb.svg); y+=fb.h;
  }
  let linkSvg='';
  links.forEach(L=>{
    linkSvg+=`<line x1="${W/2}" y1="${L.y-13}" x2="${W/2}" y2="${L.y+13}" stroke="${P.faint}" stroke-width="1.5" stroke-dasharray="4 3"/>`;
    linkSvg+=`<path d="M ${W/2-4.5} ${L.y+7} L ${W/2} ${L.y+13} L ${W/2+4.5} ${L.y+7}" fill="none" stroke="${P.faint}" stroke-width="1.5"/>`;
    if(L.both) linkSvg+=`<path d="M ${W/2-4.5} ${L.y-7} L ${W/2} ${L.y-13} L ${W/2+4.5} ${L.y-7}" fill="none" stroke="${P.faint}" stroke-width="1.5"/>`;
    linkSvg+=svgIco('sync', W/2+13, L.y-6, 12, P.muted);
    linkSvg+=`<text x="${W/2+30}" y="${L.y+3.5}" fill="${P.muted}" font-size="9.5" font-weight="500" font-family="Inter,sans-serif">${L.lab}</text>`;
  });
  $('topo').innerHTML=`<svg viewBox="0 0 ${W} ${y+4}" style="aspect-ratio:${W}/${y+4};width:100%;height:auto" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Deployment topology with per-GPU memory utilization">${parts.join('')}${linkSvg}</svg>`;

  const legend=[['box',P.segkv,`active worker · GPU bars show memory fill (${utilTxt} of ${fmt(cap)} GB each)`]];
  if(r==='n1') legend.push(['dashed',P.amber,'standby worker (N+1)']);
  if(r==='n2') legend.push(['dashed',P.amber,'standby workers (N+2)']);
  if(r==='aan1') legend.push(['dashed',P.amber,'standby worker (one per site)']);
  if(r==='nn'||r==='nndr') legend.push(['dashed',P.teal,'mirror workers (N+N)']);
  if(r==='dr'||r==='drh') legend.push(['dashed',P.violet,'DR standby site']);
  $('topoLegend').innerHTML=legend.map(([k,c,t])=>
    `<span class="cl-item"><span class="sw box${k==='dashed'?' dashed':''}" style="${k==='dashed'?'color:'+c:'background:'+c}"></span>${t}</span>`).join('');

  const info=RESIL[r], extraW=info.extraW(N), procW=N+extraW, procG=procW*s.perW;
  const kW=procG*s.gpu.watts/1000;
  $('topoNote').textContent=`${info.label} · ${d.replicas} replica${d.replicas>1?'s':''} × TP${s.tp} · ${utilTxt}/GPU`;
  const resLine = r==='n'? 'No redundancy: a worker failure removes its replicas from service.'
    : r==='n1'? 'One idle standby absorbs a single node failure with no capacity loss after failover.'
    : r==='n2'? 'Two idle standbys absorb two node failures (or one failure during a maintenance window): the usual step up from N+1 for larger fleets.'
    : r==='nn'? 'A full second system in the same site: survives node and system-level failures; can also cover maintenance windows.'
    : r==='dr'? 'A standby remote site behind asynchronous replication: survives full site loss; the standby idles during normal operation.'
    : r==='drh'? 'A half-size standby site: the cost-conscious DR pattern. Survives a site loss but runs degraded at roughly half capacity until the primary returns; guaranteed capacity during a site loss is about half the normal figure.'
    : r==='aas'? 'The N load-bearing workers are split across two live sites with no extra procurement: the cheapest geographic pattern. A site loss halves capacity until repair, and the SLA must say so. If the full number must survive a site loss, each site has to carry N alone: that is the Active/Active (2N) pattern.'
    : r==='aa'? 'Two active sites share traffic behind global load balancing. Each site alone can carry the full load, so losing a site degrades nothing; in normal operation each runs at roughly half load.'
    : r==='aan1'? 'Two active sites, each with its own local standby: survives the loss of an entire site plus a node failure in the surviving site. A pragmatic middle ground between plain active/active and N+N+DR.'
    : 'Two active/active sites, each carrying N+N: traffic is shared across sites in normal operation, and the deployment survives any worker failure or the loss of an entire site without dropping below N. The most resilient, and most procurement-heavy, enterprise pattern.';
  $('topoSum').innerHTML=
    `Load: <b>N = ${N} worker${N>1?'s':''} · ${s.gpus} GPUs</b> (${s.perW}/worker): performance and fit are computed on these. `+
    `Procured for ${info.long}: <b>${procW} workers · ${procG} GPUs · ≈ ${fmt(kW)} kW</b> GPU TDP. ${resLine}`;

  const liveW=(info.live||(n=>n))(N), idleW=procW-liveW;
  const burst=liveW>N? d.agg*liveW/N : null;
  $('resilStats').innerHTML=
    `<div class="rs"><div class="k">Guaranteed at peak</div><div class="v">${fmt(d.agg)} tok/s · ${d.active} calls</div><div class="n">${info.degraded?'≈ half of this during a site loss':'held even through the covered failure'}</div></div>`+
    `<div class="rs"><div class="k">Normal-day capacity</div><div class="v">${burst?`≈ ${fmt(burst)} tok/s`:`${fmt(d.agg)} tok/s`}</div><div class="n">${burst?'both sites serving: burst headroom, not a guarantee': idleW>0?'spare hardware idles until a failure':'every worker serves; no reserve beyond N'}</div></div>`+
    `<div class="rs"><div class="k">Idle hardware</div><div class="v">${idleW>0?`${idleW} worker${idleW>1?'s':''}`:'none'}</div><div class="n">${idleW>0?'standing by in normal operation':'every worker serves traffic'}</div></div>`+
    `<div class="rs"><div class="k">Cost vs bare N</div><div class="v">${fmt(procW/N)}×</div><div class="n">${procW} of ${N} load-bearing workers</div></div>`;
  return {procW, procG, kW};
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
  const s = readState(), d = compute(s);
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

  const topoInfo=renderTopology(s,d);

  const ins=[];
  if(!d.fits) ins.push(['bad',`Memory is the binding constraint: ${(d.total/d.avail*100).toFixed(0)}% of serving VRAM would be needed${d.replicas>1?`, dominated by ${d.replicas} replica copies of the weights (${fmt(d.weightsAll)} GB)`:''}. The Recommendations panel below lists the viable fixes.`]);
  if(d.effSeq>m.ctx) ins.push(['bad',`Resident sequence + reasoning (${fmtTok(d.effSeq)}) exceeds ${m.name}'s max context (${fmtTok(m.ctx)}): an unservable configuration. Trim resident tokens or pick a longer-context model.`]);
  if(s.tp>s.perW) ins.push(s.ic>0.75
    ? ['bad',`TP${s.tp} spans workers (${s.perW} GPU/worker): tensor-parallel traffic leaves the NVLink domain. Either raise GPUs per worker, lower TP, or set interconnect efficiency to 0.6–0.7 to model the cross-node penalty.`]
    : ['warn',`TP${s.tp} spans workers; the cross-node penalty is modeled via interconnect efficiency ${s.ic}. Prefill (TTFT) is still estimated optimistically across nodes; real systems typically use TP${s.perW} inside the node plus pipeline parallelism across nodes.`]);
  if(d.queued>0&&d.fits){ const bn=Math.ceil(s.concurrent/d.replicas);
    ins.push(['warn',`${d.queued} of ${s.concurrent} calls queue at peak (only ${d.active} admitted). ${bn<=Math.min(d.maxBatchMem||0,512)? `Raise max batch per replica to ${bn} to admit everyone.`:'Add workers or trim context to admit more.'}`]); }
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

  $('printConfig').textContent =
    `GPUscale.net · ${$('scenarioName').value||'Untitled scenario'} · ${m.name} · weights ${s.wq.name} / KV ${s.kq.name} · seq ${fmtTok(s.resident)} (+${fmtTok(s.reasonTok)} reasoning) · `+
    `${s.concurrent} concurrent, batch ${s.batch}/replica · ${s.workers}× worker (${s.perW} GPU) ${g.name} · TP${s.tp} · ${RESIL[s.resil].long} → ${topoInfo.procW} workers procured · ${new Date().toLocaleDateString()}`;
}

/* ================= PRESETS ================= */
function applyCase(i){
  if(i<0) return;
  const c=CASES[i];
  if(c.resident) $('inSeq').value=c.resident;
  if(c.visibleOut) $('inOut').value=c.visibleOut;
  $('selReason').value=REASON_TOK.hasOwnProperty(c.reasoning)?c.reasoning:'None';
  syncReason();
  $('sloTtft').value=c.ttftTarget; $('sloTps').value=c.tpsTarget; $('sloP95').value=c.p95Target;
  refreshCtl('inSeq'); refreshCtl('inOut');
}
function syncReason(){
  const mode=$('selReason').value, el=$('inReasonTok'), rng=$('inReasonTok_r');
  if(mode==='Custom'){ el.disabled=false; rng.disabled=false; if(+el.value===0) el.value=REASON_TOK.Custom; }
  else { el.disabled=true; rng.disabled=true; el.value=REASON_TOK[mode]||0; }
  refreshCtl('inReasonTok');
}

/* ================= SERIALIZE / APPLY ================= */
function serialize(){
  const s=readState(), d=compute(s);
  return {
    schema:'gpuscale.net/3', engine:ENGINE_VERSION, studio:STUDIO_VERSION,
    name: $('scenarioName').value||'Untitled scenario',
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
      tuning:{prefillMFU:s.mfu, decodeMBU:s.mbu, interconnectEff:s.ic, frameworkOverheadMs:s.ovh},
      sloTargets:{ttftMs:s.sloTtft, tps:s.sloTps, p95s:s.sloP95},
      theme: document.documentElement.dataset.theme,
    },
    results:{vramRequiredGB:+d.total.toFixed(1), vramAvailableGB:d.avail, headroomGB:+d.headroom.toFixed(1),
      ttftMs:+d.ttft.toFixed(1), perUserTps:+d.tps.toFixed(1), aggregateTps:+d.agg.toFixed(0),
      meanLatencyS:+d.latency.toFixed(2), p95S:+d.p95.toFixed(2), admitted:d.active, queued:d.queued,
      fits:d.fits, sloMet:d.sloAll}
  };
}
function findOption(sel, match){
  return [...sel.querySelectorAll('option')].find(o=>o.textContent===match)
      || [...sel.querySelectorAll('option')].find(o=>o.textContent.includes(match));
}
function applyConfig(raw){
  const c = raw.config || raw;
  const mdl = c.model && typeof c.model==='object' ? c.model : {custom:false, name:c.model};
  if(mdl.custom){
    $('chkCustom').checked=true; $('customBox').style.display='block'; $('selModel').disabled=true;
    $('cusParams').value=mdl.params; $('cusActive').value=mdl.active; $('cusHidden').value=mdl.hidden;
    $('cusLayers').value=mdl.layers; $('cusKvh').value=mdl.kvHeads; $('cusHdim').value=mdl.headDim; $('cusCtx').value=mdl.ctx;
  } else if(mdl.name){
    $('chkCustom').checked=false; $('customBox').style.display='none'; $('selModel').disabled=false;
    const o=findOption($('selModel'), mdl.name); if(o) $('selModel').value=o.value;
  }
  const setSel=(sel,name)=>{ if(!name) return; const o=findOption(sel,name); if(o) sel.value=o.value; };
  setSel($('selWQuant'), c.weightQuant); setSel($('selKQuant'), c.kvQuant);
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
  setSel($('selGpu'), c.gpu);
  const hw=c.hardware;
  if(hw){
    if(hw.workers!=null) $('inWorkers').value=hw.workers;
    if(hw.gpusPerWorker!=null) $('inPerW').value=hw.gpusPerWorker;
    if(hw.tensorParallel!=null) $('inTp').value=hw.tensorParallel;
    if(hw.resilience && RESIL[hw.resilience]) $('selResil').value=hw.resilience;
  } else if(c.gpuCount!=null){
    const count=Math.max(1,Math.round(c.gpuCount));
    const perW = count<=16? count : 8;
    $('inPerW').value=perW;
    $('inWorkers').value=Math.max(1,Math.ceil(count/perW));
    if(c.tensorParallel!=null) $('inTp').value=c.tensorParallel;
  }
  const t=c.tuning||{};
  if(t.prefillMFU!=null) $('inMfu').value=t.prefillMFU;
  if(t.decodeMBU!=null) $('inMbu').value=t.decodeMBU;
  if(t.interconnectEff!=null) $('inIc').value=t.interconnectEff;
  if(t.frameworkOverheadMs!=null) $('inOvh').value=t.frameworkOverheadMs;
  const sl=c.sloTargets||{};
  if(sl.ttftMs!=null) $('sloTtft').value=sl.ttftMs;
  if(sl.tps!=null) $('sloTps').value=sl.tps;
  if(sl.p95s!=null) $('sloP95').value=sl.p95s;
  if(raw.name) $('scenarioName').value = raw.name==='Untitled scenario'? '' : raw.name;
  if(c.theme==='dark'||c.theme==='light'){ window.__themeLocked=true; setTheme(c.theme); }
  Object.keys(FIELDS).forEach(refreshCtl);
  render();
}

/* ================= XLS TEMPLATE (SpreadsheetML with live formulas) ================= */
function buildXls(){
  const s=readState();
  const esc=x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const INP=[
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
  res('procW','Procured workers (with resilience)','', ()=>`${I('workers')}+IF(${I('resil')}=1,1,IF(${I('resil')}=7,2,IF(${I('resil')}=4,3*${I('workers')},IF(${I('resil')}=6,${I('workers')}+2,IF(${I('resil')}=8,CEILING(${I('workers')}/2,1),IF(OR(${I('resil')}=2,${I('resil')}=3,${I('resil')}=5),${I('workers')},0))))))`);
  res('procG','Procured GPUs','', ()=>`${R('procW')}*${I('perW')}`);
  res('power','GPU power (TDP)','kW', ()=>`${R('procG')}*${I('watts')}/1000`);

  const cS=(v,st)=>`<Cell${st?` ss:StyleID="${st}"`:''}><Data ss:Type="String">${esc(v)}</Data></Cell>`;
  const cN=(v,st)=>`<Cell${st?` ss:StyleID="${st}"`:''}><Data ss:Type="Number">${v}</Data></Cell>`;
  const cF=(f,str)=>`<Cell ss:StyleID="sOut" ss:Formula="=${esc(f)}"><Data ss:Type="${str?'String':'Number'}">${str?'':0}</Data></Cell>`;
  const row=cells=>`<Row>${cells}</Row>`;
  const name=$('scenarioName').value||'Untitled scenario';
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

/* ================= WIRING ================= */
document.querySelectorAll('input,select').forEach(el=>{
  el.addEventListener('input',()=>{
    if(el.id==='selCase') applyCase(+el.value);
    if(el.id==='selReason') syncReason();
    if(el.id==='chkCustom'){ $('customBox').style.display=el.checked?'block':'none'; $('selModel').disabled=el.checked; }
    if(el.id==='scenarioName') return;
    render();
  });
});
$('ccApply').addEventListener('click',()=>{ $('inConc').value=Math.max(1,+$('ccDerived').dataset.cc||1); refreshCtl('inConc'); render(); toast('Concurrency applied'); });

/* ================= AUTO-SIZE ================= */
function autoSize(){
  const s=readState();
  const weights=s.params*s.bytesW;
  const actGB=Math.min(s.resident+(s.extend?s.reasonTok:0),8192)*s.hidden*12*s.bytesW/1e9;
  let tp=[1,2,4,8,16,32,64,72].find(t=>weights+actGB<=0.8*t*s.gpuVram);
  if(!tp){ toast(`No TP up to 64 fits one copy of ${s.model.name} on ${s.gpu.name}: quantize the weights or pick a higher-VRAM GPU`, true); return; }
  const tpFit=tp;
  // widen TP while a TTFT target is missed (prefill scales with TP)
  if(s.sloTtft>0){ let t=tp; while(t<64 && 2*s.resident*s.active/(s.gpuTflops*t*s.mfu)>s.sloTtft) t*=2; tp=Math.min(72,t); }
  const widened=tp>tpFit;
  const crossed=tp>s.perW;
  const ic=crossed? Math.min(s.ic,0.7) : s.ic;
  const interactive=(s.sloTtft>0||s.sloTps>0||s.sloP95>0);
  const eva=(workers,batch)=>compute({...s, tp, ic, workers, gpus:workers*s.perW, batch});
  let workers, batch, d;
  if(interactive){
    // fewest workers that admit the peak concurrency at a batch of at most 64, then grow until it fits
    workers=Math.min(64,Math.max(1,Math.ceil(Math.max(1,Math.ceil(s.concurrent/64))*tp/s.perW)));
    for(;;){
      const replicas=Math.max(1,Math.floor(workers*s.perW/tp));
      batch=Math.min(64,Math.max(1,Math.ceil(s.concurrent/replicas)));
      d=eva(workers,batch);
      if(d.fits||workers>=64) break;
      workers++;
    }
  } else {
    // offline: queueing is fine, so keep hardware minimal and pick the largest batch that fits
    workers=Math.max(1,Math.ceil(tp/s.perW));
    outer: for(;;){
      for(const b of [256,128,64,32,16,8,4,2,1]){
        batch=b; d=eva(workers,b);
        if(d.fits) break outer;
      }
      if(workers>=64) break;
      workers++;
    }
  }
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
    why+=`Memory sits at ${u.toFixed(0)}% deliberately: this is the smallest whole-GPU fleet that ${interactive?'admits every call in the contract':'fits the model with the largest batch'}, and the remainder is growth headroom (30 to 50% spare is standard capacity practice), not waste. Serving frameworks still pre-allocate most of each GPU as KV pool at runtime, so the spare becomes burst admission.`;
  }
  const ar=$('autoResult'); if(ar){ ar.textContent=why; ar.classList.add('show'); }
  toast(`Auto-sized: TP${tp} · ${df.replicas} replica${df.replicas>1?'s':''} on ${workers} workers · batch ${batch} · ${df.active} of ${s.concurrent} admitted${df.fits? (df.sloAll?'':' · an SLO still fails, see Recommendations') : ' · still over VRAM, see Recommendations'}`);
}
$('btnAuto').addEventListener('click',autoSize);
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
const slug=()=>(($('scenarioName').value||'scenario').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'scenario');
$('btnExport').addEventListener('click',()=>{
  download([JSON.stringify(serialize(),null,2)],'application/json',`gpuscale-${slug()}-${new Date().toISOString().slice(0,10)}.json`);
  toast('Configuration exported');
});
$('btnXls').addEventListener('click',()=>{
  download([buildXls()],'application/vnd.ms-excel',`gpuscale-${slug()}-template.xls`);
  toast('Excel template exported: edit the amber Inputs cells');
});
$('btnPdf').addEventListener('click',()=>{ render(); window.print(); });
let printThemeRestore=null;
window.addEventListener('beforeprint',()=>{ if(document.documentElement.dataset.theme==='dark'){ printThemeRestore='dark'; setTheme('light'); } });
window.addEventListener('afterprint',()=>{ if(printThemeRestore){ setTheme(printThemeRestore); printThemeRestore=null; } });
$('btnImport').addEventListener('click',()=>$('fileImport').click());
$('fileImport').addEventListener('change',e=>{
  const f=e.target.files[0]; if(!f) return;
  const r=new FileReader();
  r.onload=()=>{ try{ applyConfig(JSON.parse(r.result)); toast('Configuration imported'); }
    catch(err){ toast('Import failed: not a valid configuration file', true); } };
  r.onerror=()=>toast('Could not read the file', true);
  r.readAsText(f);
  e.target.value='';
});

/* ================= PUBLIC API & BOOT ================= */
window.GPUscale = {compute, readState, serialize, applyConfig, buildXls, render, autoSize, MODELS, GPUS, QUANTS, CASES};
window.SizingConsole = window.GPUscale;
(function boot(){
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
  render();
})();
