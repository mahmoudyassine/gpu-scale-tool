/* ---------------------------------------------------------------------------
   Everything above this line is the studio. Everything below is the interface.
   --------------------------------------------------------------------------- */

const PROTOCOL_DEFAULT = '2024-11-05';
const KNOWN_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const SITE = 'https://gpuscale.net/';
const MIRROR = 'https://mahmoudyassine.github.io/gpuscale/';

/* ---------- library lookup: forgiving on input, exact on output ---------- */
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9.]+/g, '');
function pick(list, query, what, key = 'name') {
  const q = norm(query);
  if (!q) throw new Err(`${what} is required`);
  const names = list.map(x => String(key ? x[key] : x));
  const idx = names.map((s, i) => [norm(s), i]);
  let hits = idx.filter(h => h[0] === q);
  if (!hits.length) hits = idx.filter(h => h[0].startsWith(q));
  if (!hits.length) hits = idx.filter(h => h[0].includes(q));
  if (!hits.length) {
    const near = names.filter(n => norm(n).includes(q.slice(0, 4))).slice(0, 6);
    throw new Err(`${what} "${query}" is not in the library.` +
      (near.length ? ` Did you mean: ${near.join(', ')}?` : '') +
      ` Call list_library to see every valid name.`);
  }
  return { entry: list[hits[0][1]], name: names[hits[0][1]], ambiguous: hits.length > 1 };
}
class Err extends Error {}

/* ---------- build the studio's UC array from a plain spec ---------- */
function buildUC(spec) {
  const notes = [];
  const g = pick(GPUS, spec.gpu, 'gpu');
  SETTINGS.selGpu = GPUS.indexOf(g.entry);
  if (g.ambiguous) notes.push(`"${spec.gpu}" matched more than one GPU; used ${g.name}`);
  SETTINGS.inPerW = clamp(spec.gpusPerWorker != null ? spec.gpusPerWorker : 8, 1, 72);
  const rk = String(spec.resilience || 'n').toLowerCase();
  SETTINGS.selResil = RESIL[rk] ? rk : 'n';
  if (spec.resilience && !RESIL[rk])
    notes.push(`resilience "${spec.resilience}" is not a pattern; used N (no redundancy)`);
  const t = spec.tuning || {};
  SETTINGS.inMfu = clamp(num(t.prefillMFU, 0.5), 0.1, 0.9);
  SETTINGS.inMbu = clamp(num(t.decodeMBU, 0.65), 0.2, 0.95);
  SETTINGS.inIc = clamp(num(t.interconnectEff, 0.85), 0.4, 1);
  SETTINGS.inOvh = clamp(num(t.frameworkOverheadMs, 30), 0, 200);
  SETTINGS.autoUtil = clamp(num(t.autoSizeUtilPct, 80), 50, 95);

  const list = Array.isArray(spec.usecases) && spec.usecases.length
    ? spec.usecases : [spec];
  UC = list.map((u, i) => {
    const f = {};
    let mdl = u.model, custom = null;
    if (mdl && typeof mdl === 'object' && mdl.custom) custom = mdl;
    const cs = u.preset != null ? pick(CASES.filter(c => !/^Custom/.test(c.name)), u.preset, 'preset') : null;
    const c = cs ? cs.entry : null;
    if (custom) {
      f.chkCustom = true;
      f.cusParams = custom.params; f.cusActive = custom.active; f.cusHidden = custom.hidden;
      f.cusLayers = custom.layers; f.cusKvh = custom.kvHeads; f.cusHdim = custom.headDim;
      f.cusCtx = custom.ctx;
      f.selModel = 0;
    } else {
      const name = (typeof mdl === 'object' ? mdl.name : mdl) || (c && c.model);
      if (!name) throw new Err(`use case ${i + 1} has no model. Give "model", or a "preset" that suggests one.`);
      const m = pick(MODELS, name, 'model');
      if (m.ambiguous) notes.push(`"${name}" matched more than one model; used ${m.name}`);
      f.chkCustom = false; f.selModel = MODELS.indexOf(m.entry);
    }
    const wq = pick(QUANTS, u.weightQuant || 'FP8', 'weightQuant');
    const kq = pick(KV_QUANTS, u.kvQuant || 'FP8', 'kvQuant');
    f.selWQuant = QUANTS.indexOf(wq.entry);
    f.selKQuant = KV_QUANTS.indexOf(kq.entry);
    f.selCase = c ? CASES.indexOf(c) : -1;

    f.inSeq = num(u.residentSeq, c ? c.resident : 4096);
    f.inOut = num(u.visibleOut, c ? c.visibleOut : 400);
    f.inCache = clamp(num(u.sharedPrefixPct, (c && c.cachePct) || 0), 0, 95);
    // conversation length: a preset that describes a session carries the shape
    const sh = (c && c.session) || null, se = u.session || null;
    f.slMin = num(se && se.callMinutes, sh ? sh.min : 5);
    f.slRate = num(se && se.tokensPerMinute, sh ? sh.tokMin : 200);
    f.slBase = num(se && se.baseTokens, sh ? sh.base : Math.max(0, f.inSeq - 1000));
    f.slBasis = se && /^(mean|avg)/i.test(String(se.basis || '')) ? 'mean' : 'peak';
    if (se && se.callMinutes != null && u.residentSeq == null && f.slMin > 0 && f.slRate > 0)
      f.inSeq = Math.round(f.slBase + f.slRate * f.slMin / (f.slBasis === 'mean' ? 2 : 1));

    let rz = u.reasoning;
    if (rz == null) rz = c ? (c.reasonTok ? { mode: 'Custom', tokens: c.reasonTok }
                                          : { mode: c.reasoning || 'None' }) : { mode: 'None' };
    if (typeof rz === 'string') rz = { mode: rz };
    f.selReason = REASON_TOK[rz.mode] !== undefined ? rz.mode : 'None';
    f.inReasonTok = rz.mode === 'Custom' && rz.tokens != null ? rz.tokens : (REASON_TOK[f.selReason] || 0);
    f.chkExtend = rz.extendsKV !== false;

    f.selPolicy = u.kvPolicy ? (/^(all|session|pinned)/i.test(u.kvPolicy) ? 'all' : 'running')
                             : (c && c.policy === 'all' ? 'all' : 'running');
    const slo = u.sloTargets || {};
    f.sloTtft = num(slo.ttftMs, c ? c.ttftTarget || 0 : 0);
    f.sloTps = num(slo.tps, c ? c.tpsTarget || 0 : 0);
    f.sloP95 = num(slo.p95s, c ? c.p95Target || 0 : 0);

    const tr = (c && c.traffic) || {};
    const est = u.estimator || {};
    f.ccTurns = num(est.turnsPerHour, tr.turns || 8);
    f.ccShare = num(est.pctTurnsLLM, 100);
    f.ccCalls = num(est.callsPerTurn, tr.calls || 1.5);
    f.ccBurst = num(est.burst, tr.burst || 1.5);
    f.ccDur = num(est.callDurS, tr.durS || 0);
    const users = u.activeUsers != null ? Math.max(1, Math.round(+u.activeUsers)) : null;
    f.nrmUsers = users || 200;
    f.ccSessions = f.nrmUsers;

    let conc = u.concurrentCalls != null ? Math.max(1, Math.round(+u.concurrentCalls)) : null;
    const manual = conc != null;
    if (conc == null) {
      if (tr.direct) conc = f.nrmUsers;
      else {
        const dur = f.ccDur > 0 ? f.ccDur : 20;
        conc = Math.max(1, Math.ceil(f.nrmUsers * f.ccTurns * (f.ccShare / 100) * f.ccCalls * dur / 3600 * f.ccBurst));
      }
    }
    f.inConc = clamp(conc, 1, 10000);
    f.inBatch = clamp(num(u.maxBatchPerReplica, Math.min(64, f.inConc)), 1, 512);
    f.inWorkers = 1; f.inTp = 1; f.inPerW = SETTINGS.inPerW;
    f.inMfu = SETTINGS.inMfu; f.inMbu = SETTINGS.inMbu; f.inIc = SETTINGS.inIc; f.inOvh = SETTINGS.inOvh;

    let sup;
    if (u.supports === 'auto' || u.supports == null) sup = c ? defaultSupports(CASES.indexOf(c)) : [];
    else if (Array.isArray(u.supports)) sup = u.supports.map(x => {
      const kind = typeof x === 'string' ? x : x.kind;
      const k = TS_SUP.find(y => y.startsWith(String(kind).slice(0, 3).toLowerCase()));
      if (!k) { notes.push(`support kind "${kind}" is not one of ${TS_SUP.join(', ')}`); return null; }
      if (x && x.custom) return { kind: k, model: (SUP_DEFAULT(k) || {}).name, on: true, custom: x.custom };
      const want = typeof x === 'object' && x.model ? x.model : null;
      const m = want ? (SUPPORT.models.find(s2 => s2.kind === k && norm(s2.name) === norm(want))
                        || SUP_DEFAULT(k)) : SUP_DEFAULT(k);
      return m ? { kind: k, model: m.name, on: true } : null;
    }).filter(Boolean);
    else sup = [];

    return { id: 'uc' + (i + 1), name: u.name || (c ? c.name : null) || '', f,
             supports: sup, isolate: !!u.isolate, concManual: manual, modelManual: true,
             cards: 0, cardsKey: '', sliceU: 0 };
  });
  activeUc = 0;
  return notes;
}
const num = (v, d) => { const n = +v; return isFinite(n) && v !== null && v !== '' && v !== undefined ? n : d; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, +v || 0));
const r1 = x => Math.round(x * 10) / 10;
const strip = h => String(h).replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();

/* ---------- the physics audit, shared with the link skill ---------- */
function auditProject(spec) {
  const errors = [], warnings = [], notes = [];
  const gpu = GPUS[SETTINGS.selGpu];
  UC.forEach(u => {
    const s = ucState(u, readHw()), who = u.name || u.id;
    const d = compute(s);
    const gen = s.reasonTok + s.visibleOut;
    if (d.effSeq > s.ctx)
      errors.push(`${who}: ${d.effSeq.toLocaleString()} resident + reasoning tokens exceed ${s.model.name}'s ${s.ctx.toLocaleString()}-token context.`);
    if (s.params * s.bytesW > 72 * s.gpuVram)
      errors.push(`${who}: one ${Math.round(s.params * s.bytesW)} GB copy of ${s.model.name} does not fit across 72x ${gpu.name}.`);
    if (s.sloP95 > 0 && s.sloTps > 0) {
      const need = 1.3 * (s.sloTtft / 1000 + gen / s.sloTps);
      if (need > s.sloP95 + 1e-9)
        errors.push(`${who}: the targets contradict each other. ${gen.toLocaleString()} tokens at ${s.sloTps} tok/s after ${s.sloTtft} ms is ${need.toFixed(1)} s at P95, above the ${s.sloP95} s promise.`);
    }
    const q = QUANTS[+u.f.selWQuant] || {};
    if (/Blackwell only/.test(q.hw || '') && !/Blackwell/.test(gpu.arch || ''))
      errors.push(`${who}: ${q.name} weights are ${q.hw}, and ${gpu.name} is ${gpu.arch}.`);
    if (s.resident >= 0.9 * s.ctx && s.ctx >= 32768)
      notes.push(`${who}: residentSeq is ~the whole context window. It is what one request HOLDS, not what the model can hold.`);
    if (uv(u.f, 'inCache') > 0)
      notes.push(`${who}: sharedPrefixPct assumes automatic prefix caching is enabled and the prompts really share that prefix.`);
    const live = s.policy === 'all' || (s.sloP95 > 0 && s.sloP95 <= 6);
    if (live && s.sloTps > 0 && s.sloTps < 30)
      notes.push(`${who}: a live path at ${s.sloTps} tok/s; speech and interactive paths want 30 or more.`);
    if (u.f.selCase >= 0) {
      const c = CASES[+u.f.selCase];
      if (c && c.supports) {
        const have = new Set((u.supports || []).map(x => x.kind));
        const miss = c.supports.filter(k => !have.has(k));
        if (miss.length) notes.push(`${who}: the ${c.name} preset normally attaches ${miss.join(', ')}; leaving them off under-sizes the fleet.`);
      }
    }
  });
  return { errors, warnings, notes };
}

/* ---------- solve, and describe the result the way the studio does ---------- */
function solveProject(spec) {
  const inputNotes = buildUC(spec);
  const audit = auditProject(spec);
  if (audit.errors.length)
    return { ok: false, errors: audit.errors, notes: audit.notes.concat(inputNotes) };

  // auto-size every pool, exactly as the Auto-size button does
  let prj = computeProject();
  prj.pools.forEach(p => {
    const r = solvePool(poolSolveState(p, prj.hw));
    if (!r.ok) return;
    p.members.forEach(mi => {
      UC[mi].f.inTp = r.tp; UC[mi].f.inWorkers = r.workers; UC[mi].f.inBatch = r.batch;
      UC[mi].cards = r.mode === 'sliced' ? 0 : (r.cards || 0);
      UC[mi].cardsKey = UC[mi].cards ? cardsKey(UC[mi], prj.hw) : '';
      UC[mi].sliceU = r.mode === 'sliced' ? r.sliceU : 0;
    });
  });
  prj = computeProject();

  const F = prj.fleet, hw = prj.hw;
  const pools = prj.pools.map((p, i) => {
    const d = p.d, s = p.state;
    return {
      models: s.model.name, weightQuant: s.wq.name, kvQuant: s.kq.name,
      useCases: p.members.map(mi => ucName(UC[mi])),
      tensorParallel: s.tp, replicas: d.replicas,
      servingCards: p.sliced ? 0 : d.replicas * s.tp,
      migSliced: p.sliced ? { units: p.sliced.units, perGpu: p.sliced.per || null } : null,
      batchPerReplica: s.batch, pooledConcurrency: s.concurrent, admitted: d.active, queued: d.queued,
      memory: { neededGB: r1(d.total), availableGB: r1(d.avail), usedPct: r1(d.total / d.avail * 100),
                weightsGB: r1(d.weightsAll), kvCacheGB: r1(d.kvTotal),
                activationsGB: r1(d.act * d.replicas), overheadGB: r1(d.fixed + d.multi),
                headroomGB: r1(d.headroom) },
      performance: { ttftMs: r1(d.ttft), perUserTps: r1(d.tps), aggregateTps: Math.round(d.agg),
                     interTokenMs: r1(d.itl), meanLatencyS: r1(d.latency), p95S: r1(d.p95) },
      fits: d.fits
    };
  });
  const useCases = [];
  prj.pools.forEach((p, pi) => p.perUc.forEach(x => useCases.push({
    name: ucName(x.uc), pool: pi, model: x.s.model.name,
    activeUsers: +x.uc.f.nrmUsers || null, concurrentCalls: x.s.concurrent,
    residentTokens: x.s.resident, visibleOut: x.s.visibleOut, reasoningTokens: x.s.reasonTok,
    kvPolicy: x.s.policy, sharedPrefixPct: Math.round((x.s.cachePct || 0) * 100),
    ttftMs: r1(x.d.ttft), perUserTps: r1(x.d.tps), p95S: r1(x.d.p95),
    targets: { ttftMs: x.s.sloTtft || null, tps: x.s.sloTps || null, p95s: x.s.sloP95 || null },
    slo: { ttft: x.s.sloTtft ? (x.d.slo.ttft.pass ? 'PASS' : 'FAIL') : 'off',
           tps: x.s.sloTps ? (x.d.slo.tps.pass ? 'PASS' : 'FAIL') : 'off',
           p95: x.s.sloP95 ? (x.d.slo.p95.pass ? 'PASS' : 'FAIL') : 'off' },
    sloMet: x.d.sloAll,
    supports: (x.uc.supports || []).map(sp => ({ kind: sp.kind, model: (supSpec(sp) || {}).name }))
  })));
  const info = RESIL[hw.resil] || RESIL.n;
  let recommendations = [];
  try {
    recommendations = sloOptScan(prj).map(r => ({
      level: r.lv === 'bad' ? 'critical' : r.lv === 'warn' ? 'warning' : 'info',
      title: strip(r.t), detail: strip(r.b)
    }));
  } catch (e) { /* recommendations are a bonus, never a failure */ }

  return {
    ok: true,
    verdict: !F.fits ? 'EXCEEDS_VRAM' : (F.sloAll ? 'FITS_AND_MEETS_SLOS' : 'FITS_BUT_MISSES_SLOS'),
    fleet: {
      gpu: hw.g.name, gpusPerNode: hw.perW, resilience: info.long,
      servingCards: F.servG, activeGpus: F.activeG,
      procuredNodes: F.procW, procuredGpus: F.procG, powerKwTdp: r1(F.kW),
      fits: F.fits, allSlosMet: F.sloAll
    },
    pools, useCases,
    supportingModels: (prj.sup && prj.sup.items || []).map(it => ({
      kind: it.kind, model: it.model.name, instances: it.instances,
      vramPerInstanceGB: it.model.vram })),
    supportingGpus: (prj.sup && prj.sup.gpus) || 0,
    recommendations,
    notes: audit.notes.concat(inputNotes),
    links: linksFor(spec),
    caveat: 'Peak closed-form estimates; production typically achieves 70-90%. Validate with vLLM bench or GenAI-Perf before committing hardware.'
  };
}

/* ---------- readable links, the form an agent can also write by hand ---------- */
function linksFor(spec) {
  const parts = [];
  if (spec.name) parts.push('name=' + spec.name);
  parts.push('gpu=' + GPUS[SETTINGS.selGpu].name);
  parts.push('perw=' + SETTINGS.inPerW);
  if (SETTINGS.selResil !== 'n') parts.push('resil=' + SETTINGS.selResil);
  UC.forEach(u => {
    const f = u.f, c = f.selCase >= 0 ? CASES[+f.selCase] : null;
    parts.push('uc=' + (u.name || 'Use case'));
    parts.push('model=' + (f.chkCustom
      ? 'custom:' + [f.cusParams, f.cusActive, f.cusHidden, f.cusLayers, f.cusKvh, f.cusHdim, f.cusCtx].join('/')
      : MODELS[+f.selModel].name));
    parts.push('quant=' + QUANTS[+f.selWQuant].name);
    parts.push('kv=' + KV_QUANTS[+f.selKQuant].name);
    if (c) parts.push('preset=' + c.name);
    const put = (k, v, base) => { if (base == null || +v !== +base) parts.push(k + '=' + v); };
    put('seq', +f.inSeq, c && c.resident);
    put('out', +f.inOut, c && c.visibleOut);
    if (+f.inCache) parts.push('cache=' + (+f.inCache));
    put('ttft', +f.sloTtft, c && c.ttftTarget);
    put('tps', +f.sloTps, c && c.tpsTarget);
    put('p95', +f.sloP95, c && c.p95Target);
    if (u.concManual) parts.push('conc=' + (+f.inConc));
    else if (+f.nrmUsers) parts.push('users=' + (+f.nrmUsers));
    if (u.isolate) parts.push('isolate=1');
  });
  const frag = '#p=t:' + parts.join(';').replace(/ /g, '+');
  return { studio: SITE + frag, mirror: MIRROR + frag,
           note: 'Open either link to see the same project in the studio, edit it, and export it.' };
}

/* ---------- tool definitions ---------- */
const SPEC_USECASE = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Label for this workload.' },
    model: { description: 'Library model name, or {custom:true, params, active, hidden, layers, kvHeads, headDim, ctx}. Optional when preset is given, which suggests one.' },
    preset: { type: 'string', description: 'Workload preset name. Fills tokens, reasoning, SLO targets, KV policy, traffic shape and supporting models.' },
    weightQuant: { type: 'string', description: 'FP8 (default), BF16, NV FP4, MXFP4, INT8, Q4_K_M and 13 more.' },
    kvQuant: { type: 'string', description: 'FP8 (default), BF16, FP16, INT8, INT4.' },
    residentSeq: { type: 'integer', description: 'Tokens HELD per request: prompt + retained history + tool traces. NOT the model context window. Sizing on the window is the commonest way to over-order by 10x.' },
    visibleOut: { type: 'integer', description: 'Tokens the user sees per response.' },
    reasoning: { description: '"None" | "Light reasoning" | "Heavy reasoning" | {mode:"Custom", tokens:N, extendsKV:true}.' },
    sharedPrefixPct: { type: 'integer', description: 'Share of the sequence byte-identical every call, 0-95. Leave 0 unless the user gave a measured prefix-cache hit rate.' },
    session: { type: 'object', description: 'Conversations only: {callMinutes} sets the resident sequence from the call length. A named preset supplies the token rate and base.' },
    activeUsers: { type: 'integer', description: 'People using this at peak. Preferred over concurrentCalls when the user described people.' },
    concurrentCalls: { type: 'integer', description: 'Requests in flight at peak. Overrides activeUsers.' },
    kvPolicy: { type: 'string', description: '"running" (freed between turns) or "all" (pinned per session, correct for live voice).' },
    sloTargets: { type: 'object', description: '{ttftMs, tps, p95s}. tps is PER USER, never aggregate. 0 disables a check.' },
    supports: { description: '"auto" (the preset\'s own), [] for none, or ["embed","rerank","asr","tts","ocr","guard"].' },
    isolate: { type: 'boolean', description: 'Keep this use case in its own deployment even when another shares its model and precision.' }
  }
};
const SPEC = {
  type: 'object',
  required: ['gpu'],
  properties: {
    name: { type: 'string' },
    gpu: { type: 'string', description: 'One GPU type for the whole project. Library name, fuzzy match allowed.' },
    gpusPerWorker: { type: 'integer', description: 'GPUs per node: 8 = HGX, 4 = many OEM servers, 72 = NVL72 rack. Default 8.' },
    resilience: { type: 'string', description: 'n | n1 | n2 | nn | dr | drh | aa | aas | aas1 | aass | aan1 | nndr. Default n.' },
    tuning: { type: 'object', description: '{prefillMFU 0.5, decodeMBU 0.65, interconnectEff 0.85, frameworkOverheadMs 30, autoSizeUtilPct 80}.' },
    usecases: { type: 'array', items: SPEC_USECASE, description: 'One entry per workload. Two entries sharing a model, both precisions and the KV policy are served by ONE pooled deployment, as they would be in production.' }
  }
};

const TOOLS = [
  {
    name: 'size_project',
    description: 'Size a self-hosted LLM deployment: how many GPUs and nodes, whether it fits, and whether it keeps its latency promises. Solves tensor-parallel width, replica count and batch size, pools use cases that share a model and precision, attaches supporting models, applies a resilience pattern, and returns the fleet plus per-use-case SLO verdicts and recommendations. This is the whole gpuscale.net studio in one call. Use it for any question about GPU counts, VRAM fit, KV cache size, tokens per second, time to first token, or "can model X run on hardware Y".',
    inputSchema: SPEC
  },
  {
    name: 'compare_gpus',
    description: 'Size the SAME workload across several GPUs and rank them by procured GPUs, then by power. Answers "which card should we buy for this" without running size_project once per candidate.',
    inputSchema: {
      type: 'object', required: ['gpus', 'spec'],
      properties: {
        gpus: { type: 'array', items: { type: 'string' }, description: 'Candidate GPU names, 2 to 8 of them.' },
        spec: { type: 'object', description: 'A size_project spec. Its "gpu" field is replaced by each candidate in turn.' }
      }
    }
  },
  {
    name: 'audit_spec',
    description: 'Check a configuration for contradictions without sizing it: a context overflow, SLO targets that cannot all hold at once, a quantization the card cannot run, a resident sequence set to the whole context window. Returns errors (no hardware fixes these) and notes (legal but usually a mistake).',
    inputSchema: SPEC
  },
  {
    name: 'build_link',
    description: 'Turn a spec into a gpuscale.net URL that opens the whole project in the studio, where a human can edit it, export it or share it. The link carries the project inside the fragment; nothing is uploaded.',
    inputSchema: SPEC
  },
  {
    name: 'read_link',
    description: 'Decode a gpuscale.net share link (#p=t:, #p=j: or #p=z:) into the project it carries, and size it. Use this when a user pastes a link and asks what is in it or whether it is right.',
    inputSchema: {
      type: 'object', required: ['url'],
      properties: { url: { type: 'string', description: 'A gpuscale.net link or just its fragment.' } }
    }
  },
  {
    name: 'list_library',
    description: 'Every valid name the other tools accept. Call this before naming a model or GPU you are not certain of: an invented name is rejected, and a silently substituted one would be worse.',
    inputSchema: {
      type: 'object', required: ['kind'],
      properties: {
        kind: { type: 'string', enum: ['models', 'gpus', 'presets', 'quants', 'kv_quants', 'resilience', 'supports'] },
        filter: { type: 'string', description: 'Case-insensitive substring, e.g. "llama" or "h100".' }
      }
    }
  }
];

/* ---------- tool implementations ---------- */
function toolSize(args) {
  const r = solveProject(args);
  if (!r.ok) return { text: 'This configuration cannot work:\n' + r.errors.map(e => '  ERROR ' + e).join('\n'), data: r, isError: true };
  const f = r.fleet;
  const lines = [
    `${f.procuredNodes} node${f.procuredNodes > 1 ? 's' : ''} · ${f.procuredGpus} ${f.gpu} · ~${f.powerKwTdp} kW  (${f.resilience})`,
    `${r.verdict === 'FITS_AND_MEETS_SLOS' ? 'Fits and every SLO target is met.'
      : r.verdict === 'FITS_BUT_MISSES_SLOS' ? 'Fits, but at least one latency target is missed.'
      : 'Does not fit.'}`,
    `${f.servingCards} serving cards${r.supportingGpus ? ` + ${r.supportingGpus} shared GPUs for supporting models` : ''}.`, ''
  ];
  r.pools.forEach(p => lines.push(
    `  ${p.models} ${p.weightQuant}/${p.kvQuant}: TP${p.tensorParallel} x ${p.replicas} replica${p.replicas > 1 ? 's' : ''}` +
    ` = ${p.servingCards} cards, batch ${p.batchPerReplica}, ${p.memory.usedPct}% memory, ` +
    `${p.performance.ttftMs} ms first token, ${p.performance.perUserTps} tok/s per user` +
    (p.useCases.length > 1 ? `  [pooled: ${p.useCases.join(' + ')}]` : '')));
  lines.push('');
  r.useCases.forEach(u => lines.push(
    `  ${u.name}: ${u.concurrentCalls} concurrent · ttft ${u.ttftMs}/${u.targets.ttftMs || '-'} ms · ` +
    `${u.perUserTps}/${u.targets.tps || '-'} tok/s · p95 ${u.p95S}/${u.targets.p95s || '-'} s · ` +
    (u.sloMet ? 'SLOs met' : 'TARGET MISSED')));
  if (r.notes.length) lines.push('', 'Notes:', ...r.notes.map(n => '  · ' + n));
  if (r.recommendations.length) lines.push('', 'Recommendations:',
    ...r.recommendations.slice(0, 4).map(x => `  [${x.level}] ${x.title}`));
  lines.push('', 'Open in the studio: ' + r.links.studio, '', r.caveat);
  return { text: lines.join('\n'), data: r };
}

function toolCompare(args) {
  const cands = (args.gpus || []).slice(0, 8);
  if (cands.length < 2) throw new Err('give at least two GPUs to compare');
  const rows = cands.map(name => {
    try {
      const r = solveProject(Object.assign({}, args.spec, { gpu: name }));
      if (!r.ok) return { gpu: name, ok: false, reason: r.errors[0] };
      return { gpu: r.fleet.gpu, ok: true, procuredGpus: r.fleet.procuredGpus,
               procuredNodes: r.fleet.procuredNodes, powerKwTdp: r.fleet.powerKwTdp,
               fits: r.fleet.fits, allSlosMet: r.fleet.allSlosMet,
               topology: r.pools.map(p => `TP${p.tensorParallel}x${p.replicas}`).join(' + ') };
    } catch (e) { return { gpu: name, ok: false, reason: e.message }; }
  });
  const good = rows.filter(r => r.ok && r.fits).sort((a, b) =>
    (b.allSlosMet - a.allSlosMet) || (a.procuredGpus - b.procuredGpus) || (a.powerKwTdp - b.powerKwTdp));
  const lines = ['Ranked by GPUs procured, then power. Only configurations that fit are ranked.', ''];
  good.forEach((r, i) => lines.push(
    `  ${i + 1}. ${r.gpu}: ${r.procuredNodes} nodes · ${r.procuredGpus} GPUs · ~${r.powerKwTdp} kW · ${r.topology}` +
    (r.allSlosMet ? '' : '  (misses an SLO target)')));
  rows.filter(r => !r.ok || !r.fits).forEach(r => lines.push(
    `     ${r.gpu}: ${r.ok ? 'does not fit' : r.reason}`));
  return { text: lines.join('\n'), data: { ranked: good, rejected: rows.filter(r => !r.ok || !r.fits) } };
}

function toolAudit(args) {
  buildUC(args);
  const a = auditProject(args);
  const clean = !a.errors.length && !a.notes.length;
  const lines = clean ? ['No contradictions found.'] : [];
  a.errors.forEach(e => lines.push('ERROR  ' + e));
  a.notes.forEach(n => lines.push('note   ' + n));
  return { text: lines.join('\n'), data: a, isError: a.errors.length > 0 };
}

function toolLink(args) {
  const notes = buildUC(args);
  const a = auditProject(args);
  if (a.errors.length)
    return { text: 'No link produced; this configuration cannot work:\n' + a.errors.map(e => '  ERROR ' + e).join('\n'),
             data: { errors: a.errors }, isError: true };
  const l = linksFor(args);
  return { text: [l.studio, '', 'Mirror (for networks that block gpuscale.net):', l.mirror,
                  ...(a.notes.length ? ['', 'Notes:', ...a.notes.map(n => '  · ' + n)] : []),
                  ...(notes.length ? notes.map(n => '  · ' + n) : [])].join('\n'),
           data: Object.assign({}, l, { notes: a.notes.concat(notes) }) };
}

function toolRead(args) {
  const url = String(args.url || '');
  const i = url.indexOf('#p=');
  if (i < 0) throw new Err('that does not look like a GPUscale link: no "#p=" fragment.');
  const payload = url.slice(i + 3);
  if (payload.startsWith('t:')) {
    const r = parseTextShare(payload.slice(2));
    if (r.error) throw new Err(r.error);
    const spec = fromPayload(r.json);
    const sized = solveProject(spec);
    return { text: describeSpec(spec) + '\n\n' + (sized.ok ? toolSize(spec).text : sized.errors.join('\n')),
             data: { spec, sized } };
  }
  throw new Err('this build reads the readable "#p=t:" form. For "#p=z:" or "#p=j:" links, ' +
                'decode with scripts/gpuscale_url.py from the gpuscale-link skill, or open the link in a browser.');
}
function fromPayload(j) {
  const g = j.config || {};
  return {
    name: j.name, gpu: g.gpu, gpusPerWorker: (g.hardware || {}).gpusPerWorker,
    resilience: (g.hardware || {}).resilience, tuning: g.tuning,
    usecases: (j.project.usecases || []).map(u => {
      const c = u.config || {};
      return { name: u.name, model: c.model && c.model.custom ? Object.assign({ custom: true }, c.model) : (c.model || {}).name,
               preset: c.preset, weightQuant: c.weightQuant, kvQuant: c.kvQuant,
               residentSeq: c.residentSeq, visibleOut: c.visibleOut,
               sharedPrefixPct: c.sharedPrefixPct, session: c.session,
               reasoning: c.reasoning, kvPolicy: c.kvPolicy, sloTargets: c.sloTargets,
               concurrentCalls: u.concManual ? c.concurrentCalls : null,
               activeUsers: u.activeUsers, isolate: u.isolate,
               supports: (u.supports || []).map(s => s.kind) };
    })
  };
}
function describeSpec(spec) {
  return `Project "${spec.name || 'untitled'}" · ${spec.gpu} · ${spec.gpusPerWorker || 8} GPU/node · ` +
         `resilience ${spec.resilience || 'n'} · ${spec.usecases.length} use case(s)`;
}

function toolList(args) {
  const kind = args.kind, filt = (args.filter || '').toLowerCase();
  const keep = s => !filt || String(s).toLowerCase().includes(filt);
  let rows = [], data = [];
  if (kind === 'models') {
    data = MODELS.filter(m => keep(m.name + ' ' + (m.arch || '') + ' ' + (m.dev || '')));
    rows = data.map(m => `${m.name} · ${m.params}B total / ${m.active}B active · ctx ${m.ctx.toLocaleString()} · ${m.arch || ''}`);
  } else if (kind === 'gpus') {
    data = GPUS.filter(g => keep(g.name + ' ' + (g.arch || '')));
    rows = data.map(g => `${g.name} · ${g.vram} GB · ${g.bw} TB/s · ${g.tflops} dense TF · ${g.watts} W · ${g.arch || ''}`);
  } else if (kind === 'presets') {
    data = CASES.filter(c => !/^Custom/.test(c.name) && keep(c.name));
    rows = data.map(c => `${c.name} · seq ${c.resident} · out ${c.visibleOut} · SLO ${c.ttftTarget}ms/${c.tpsTarget}tps/${c.p95Target}s` +
      (c.model ? ` · suggests ${c.model}` : '') + (c.policy === 'all' ? ' · KV pinned per session' : ''));
  } else if (kind === 'quants') {
    data = QUANTS.filter(q => keep(q.name));
    rows = data.map(q => `${q.name} · ${q.bytes} bytes/param · ${q.quality || ''} · ${q.hw || ''}`);
  } else if (kind === 'kv_quants') {
    data = KV_QUANTS.filter(q => keep(q.name));
    rows = data.map(q => `${q.name} · ${q.bytes} bytes/element`);
  } else if (kind === 'resilience') {
    data = Object.keys(RESIL).filter(k => keep(k + RESIL[k].long)).map(k => ({ key: k, label: RESIL[k].label, long: RESIL[k].long }));
    rows = data.map(r => `${r.key} · ${r.label} · ${r.long}`);
  } else if (kind === 'supports') {
    data = SUPPORT.models.filter(m => keep(m.name + ' ' + m.kind));
    rows = data.map(m => `${m.kind} · ${m.name} · ${m.vram} GB/instance · ~${m.cap} concurrent/instance`);
  } else throw new Err('unknown kind: ' + kind);
  return { text: `${rows.length} ${kind}:\n` + rows.map(r => '  ' + r).join('\n'), data };
}

const IMPL = { size_project: toolSize, compare_gpus: toolCompare, audit_spec: toolAudit,
               build_link: toolLink, read_link: toolRead, list_library: toolList };

/* ---------- resources: the method, for an agent that wants to read it ---------- */
const RESOURCES = [
  { uri: 'gpuscale://manual', name: 'GPUscale manual', mimeType: 'text/plain',
    description: 'How the studio sizes a fleet: the three currencies, the closed forms, the solver, resilience patterns.' },
  { uri: 'gpuscale://formulas', name: 'Engine formulas', mimeType: 'text/plain',
    description: 'Every closed form the engine evaluates, with units.' },
  { uri: 'gpuscale://conventions', name: 'Sizing conventions', mimeType: 'text/plain',
    description: 'The rules that decide whether a configuration is right: per-request fields, resident vs context, tok/s per user.' }
];
const RESOURCE_TEXT = {
  'gpuscale://formulas': `GPUscale engine v${ENGINE_VERSION} closed forms (all memory in GB, params in billions)

weights        = params x bytes_per_weight                     per replica
kv_per_token   = 2 x layers x kv_heads x head_dim x bytes_kv / 1e9
                 (sliding-window hybrids mix a full-attention term with a
                  windowed one, so their per-token cost falls with context)
cached         = floor(resident x shared_prefix_fraction)      prefilled once,
                 held once per replica
unique         = max(0, effSeq - cached)                       charged per call
effSeq         = resident + reasoning (when reasoning extends the KV cache)
kv_total       = admitted x unique x kv_per_token + replicas x cached x kv_per_token
activations    = min(effSeq, 8192) x hidden x 12 x bytes_w / 1e9   per replica
overhead       = 5 GB fixed + replicas x (TP-1) x 15 GB NCCL buffers
need           = replicas x (weights + activations) + kv_total + overhead
avail          = replicas x TP x VRAM_per_GPU

BW_eff         = BW_TBs x TP x interconnect x MBU x 1000        GB/s
admitted       = min(concurrency, batch x replicas)             running batch
                 concurrency                                    KV pinned
tok_s_per_user = BW_eff / (active_params x bytes_w + batch_per_replica x effSeq x kv_per_token)
TTFT_ms        = 2 x (resident - cached) x active_params / (TFLOPS x TP x MFU)
latency_s      = (TTFT + framework_overhead)/1000 + (reasoning + visible) / tok_s
p95_s          = 1.3 x latency_s                                fixed convention

concurrency    = ceil(users x turns x share x calls x duration/3600 x burst)

Defaults: MFU 0.5, MBU 0.65, interconnect 0.85 in-island and 0.70 across nodes,
framework overhead 30 ms, auto-size memory target 80%.
All figures are peak estimates; production typically achieves 70-90%.`,
  'gpuscale://conventions': `Getting a GPUscale configuration right

1. residentSeq is tokens HELD per request: system prompt + retrieved context +
   conversation so far + tool traces. It is NOT the model's context window.
   A 1M-context model serving 8K conversations is residentSeq 8192. Sizing on
   the window is the commonest way to over-order hardware by 10x.
2. Every field describes ONE model call. An agent making forty tool calls per
   task is forty requests, not one enormous one. Use activeUsers plus the
   preset's traffic shape, or concurrentCalls.
3. tps targets are PER USER streaming speed, never aggregate throughput.
4. Prefer activeUsers over concurrentCalls when the user described people.
   Turning headcount into concurrency is what the traffic estimator is for.
5. For voice and contact-centre workloads ask how long a call lasts and set
   session.callMinutes: a conversation holds its transcript, and those presets
   pin KV for the whole session.
6. Leave sharedPrefixPct at 0 unless the user gave a measured prefix-cache hit
   rate AND their stack has automatic prefix caching enabled.
7. KV cache at FP8 unless told otherwise: it halves the cache against BF16 with
   negligible quality loss.
8. Never invent a model or GPU name. Call list_library. If the model is genuinely
   absent, pass a custom geometry and say that you did.
9. Do not pin tensor parallelism, workers or batch size: the solver chooses them,
   and a guess is either ignored or wrong.
10. State your assumptions. GPU, quantization and resilience pattern are usually
    your choices, not the user's.`,
  'gpuscale://manual': `The GPUscale manual lives at ${SITE}manual.html

It covers, with worked examples and diagrams:
  1 Quick start
  2 How the studio thinks: three currencies, one model call, pools
  3 The interface, control by control
  4 Reading the results
  5 The mathematics, in full, with a worked example checkable on a calculator
  6 The auto-size solver and its invariants
  7 Pooling, co-residency and MIG slicing
  8 Supporting models
  9 Resilience patterns
 10 The SLO optimiser
 11 Workload presets and the evidence behind them
 12 Exports, share links and AI assistants
 13 Libraries and how to extend them
 14 Accuracy, limits and validation
 15 Glossary

Call the gpuscale://formulas resource for the closed forms, or
gpuscale://conventions for the rules that decide whether a configuration is
right.`
};

/* ---------- JSON-RPC 2.0 over stdio, one message per line ---------- */
function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
function reply(id, result) { if (id !== undefined && id !== null) send({ jsonrpc: '2.0', id, result }); }
function fail(id, code, message) { if (id !== undefined && id !== null) send({ jsonrpc: '2.0', id, error: { code, message } }); }

function handle(msg) {
  const { id, method, params } = msg;
  try {
    switch (method) {
      case 'initialize': {
        const want = (params || {}).protocolVersion;
        return reply(id, {
          protocolVersion: KNOWN_PROTOCOLS.includes(want) ? want : PROTOCOL_DEFAULT,
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: 'gpuscale', version: STUDIO_VERSION,
                        title: 'GPUscale · LLM GPU capacity sizing' },
          instructions:
            'GPUscale sizes self-hosted LLM deployments with closed-form arithmetic: no model, no ' +
            'network, no telemetry. Call list_library before naming a model or GPU you are unsure of. ' +
            'Call size_project for any question about GPU counts, VRAM fit, tokens per second or SLO ' +
            'feasibility, and quote its numbers rather than estimating. Read gpuscale://conventions ' +
            'once: residentSeq is tokens held per request, not the context window, and every field ' +
            'describes one model call. Hand the user the link size_project returns so they can check ' +
            'and edit the sizing themselves.'
        });
      }
      case 'notifications/initialized': return;
      case 'ping': return reply(id, {});
      case 'tools/list': return reply(id, { tools: TOOLS });
      case 'resources/list': return reply(id, { resources: RESOURCES });
      case 'resources/read': {
        const uri = (params || {}).uri;
        const text = RESOURCE_TEXT[uri];
        if (text === undefined) return fail(id, -32602, 'unknown resource: ' + uri);
        return reply(id, { contents: [{ uri, mimeType: 'text/plain', text }] });
      }
      case 'tools/call': {
        const name = (params || {}).name, args = (params || {}).arguments || {};
        const fn = IMPL[name];
        if (!fn) return fail(id, -32602, 'unknown tool: ' + name);
        let out;
        try {
          out = fn(args);
        } catch (e) {
          // a bad argument is the caller's problem to fix, not a protocol error:
          // report it inside the result so the model can read it and retry
          return reply(id, { content: [{ type: 'text', text: (e instanceof Err ? '' : 'error: ') + e.message }],
                             isError: true });
        }
        const res = { content: [{ type: 'text', text: out.text }] };
        if (out.data !== undefined) res.structuredContent = out.data;
        if (out.isError) res.isError = true;
        return reply(id, res);
      }
      default:
        return fail(id, -32601, 'method not found: ' + method);
    }
  } catch (e) {
    return fail(id, -32603, e && e.message ? e.message : String(e));
  }
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); }
    catch (e) { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); continue; }
    if (Array.isArray(msg)) msg.forEach(handle); else handle(msg);
  }
});
process.stdin.on('end', () => process.exit(0));

/* A one-shot mode for humans and CI: node gpuscale-mcp.mjs --self-test */
if (process.argv.includes('--self-test')) {
  const spec = { name: 'self test', gpu: 'H200 141GB NVL', gpusPerWorker: 8, resilience: 'n1',
    usecases: [{ name: 'Support chat', model: 'Llama 3.3 70B', preset: 'Simple RAG', activeUsers: 2000 }] };
  const r = toolSize(spec);
  process.stdout.write(r.text + '\n');
  process.exit(r.data && r.data.ok ? 0 : 1);
}
