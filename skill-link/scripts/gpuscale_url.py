#!/usr/bin/env python3
"""
gpuscale_url.py - build, decode and verify GPUscale.net share URLs.

GPUscale.net share links carry the whole project inside the URL fragment:
    <base>#p=z:<base64url(deflate-raw(JSON payload))>
The payload follows the app's `serialize()` schema ('gpuscale.net/5').
On load the app applies the config and then auto-sizes topology (TP /
workers / batch) from the demand inputs, so the demand side of the payload
is what must be exact; topology values are seeds.

Commands
    encode <spec.json> [--base URL] [--out payload.json] [--quiet]
    decode <url | fragment | file> [--out payload.json]
    list   <models|gpus|quants|kvquants|presets|resilience|supports> [filter]

`encode` accepts either the friendly spec documented in the skill's
SKILL.md, or a full 'gpuscale.net/5' payload (detected by its "schema"
key) which is re-encoded as-is. Every encode is self-verified by decoding
the produced URL and comparing payloads.
"""
import argparse, base64, json, math, os, random, re, sys, zlib
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
LIB = json.load(open(os.path.join(HERE, '..', 'data', 'libraries.json')))
DEFAULT_BASE = 'https://gpuscale.net/'
BACKUP_BASE = 'https://mahmoudyassine.github.io/gpuscale/'   # same app, for networks that block gpuscale.net
FR = LIB['field_ranges']

# ---------------------------------------------------------------- helpers
def die(msg):
    sys.stderr.write('ERROR: ' + msg + '\n'); sys.exit(1)

def warn(msg):
    sys.stderr.write('note: ' + msg + '\n')

def clamp(key, v, warnings):
    r = FR.get(key)
    if r is None or v is None: return v
    c = min(r['max'], max(r['min'], v))
    if c != v:
        warnings.append(f"{key} {v} clamped to app range [{r['min']}, {r['max']}] -> {c}")
    return c

def resolve(query, pool, what, name_key='name'):
    """Mirror the app's findOption(): exact -> case-insensitive -> substring."""
    if query is None: return None
    q = str(query).strip()
    names = [e[name_key] for e in pool]
    for e in pool:
        if e[name_key] == q: return e
    low = [e for e in pool if e[name_key].lower() == q.lower()]
    if len(low) == 1: return low[0]
    sub = [e for e in pool if q.lower() in e[name_key].lower() or e[name_key].lower() in q.lower()]
    if len(sub) == 1: return sub[0]
    if len(sub) > 1:
        die(f'{what} "{query}" is ambiguous - matches: ' + ' | '.join(e[name_key] for e in sub[:8])
            + '. Use the exact library name (see: gpuscale_url.py list).')
    # token overlap as a last resort, unique only
    qt = set(re.split(r'[\s\-/]+', q.lower())) - {''}
    scored = [(len(qt & set(re.split(r'[\s\-/]+', e[name_key].lower()))), e) for e in pool]
    best = max(s for s, _ in scored) if scored else 0
    top = [e for s, e in scored if s == best and s > 0]
    if len(top) == 1: return top[0]
    hint = ' | '.join(e[name_key] for e in (top[:6] if top else pool[:6]))
    die(f'{what} "{query}" not found in the library. Closest: {hint}. '
        f'Run `gpuscale_url.py list` to browse, or ask the user which one they mean.')

def resolve_resil(query):
    if query is None: return 'n'
    q = str(query).strip()
    for r in LIB['resilience']:
        if q == r['key'] or q.lower() == r['label'].lower(): return r['key']
    for r in LIB['resilience']:
        if q.lower() in r['long'].lower(): return r['key']
    die(f'resilience "{query}" not recognized. Options: '
        + ', '.join(f"{r['key']} ({r['label']})" for r in LIB['resilience']))

def sup_default(kind):
    ms = [m for m in LIB['support']['models'] if m['kind'] == kind]
    for m in ms:
        if m.get('default'): return m
    return ms[0] if ms else None

def new_proj_id():
    L, D = 'abcdefghjkmnpqrstuvwxyz', '0123456789'
    return 'Project_' + ''.join(random.choice(L) for _ in range(2)) + ''.join(random.choice(D) for _ in range(3))

# ---------------------------------------------------------------- codec
def b64u_encode(b):  return base64.urlsafe_b64encode(b).decode().rstrip('=')
def b64u_decode(s):  return base64.urlsafe_b64decode(s + '=' * (-len(s) % 4))

def payload_to_url(payload, base=DEFAULT_BASE):
    raw = json.dumps(payload, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    co = zlib.compressobj(9, zlib.DEFLATED, -15)
    frag = b64u_encode(co.compress(raw) + co.flush())
    if not base.endswith('/') and '#' not in base: base += '/'
    return base + '#p=z:' + frag

def url_to_payload(text):
    s = text.strip()
    if os.path.isfile(s): s = open(s).read().strip()
    s = re.sub(r'\s+', '', s)
    if '#p=' in s: s = s.split('#p=', 1)[1]
    if s.startswith('p='): s = s[2:]
    if s.startswith('z:'):
        data = zlib.decompress(b64u_decode(s[2:]), -15)
    elif s.startswith('j:'):
        data = b64u_decode(s[2:])
    else:  # assume bare z-compressed fragment
        data = zlib.decompress(b64u_decode(s), -15)
    try:
        return json.loads(data)
    except json.JSONDecodeError as e:
        salvage = data[:e.pos].decode('utf-8', 'replace')
        open('salvaged_prefix.txt', 'w').write(data.decode('utf-8', 'replace'))
        die(f'the fragment decompresses but its JSON is damaged at character {e.pos} '
            f'(links often get mangled when copied through chat or email). '
            f'Readable prefix written to salvaged_prefix.txt ({len(salvage)} clean chars of {len(data)}).')

# ---------------------------------------------------------------- spec -> payload
REASON_MODES = list(LIB['reason_tokens'].keys())

def build_usecase(u, gl, idx, warnings):
    name = u.get('name') or f'Use case {idx + 1}'
    # --- model
    mdl = u.get('model')
    if mdl is None: die(f'use case "{name}": "model" is required (name from the library, or a custom geometry object).')
    if isinstance(mdl, dict) and (mdl.get('custom') or 'params' in mdl):
        need = ['params', 'active', 'hidden', 'layers', 'kvHeads', 'headDim', 'ctx']
        miss = [k for k in need if k not in mdl]
        if miss: die(f'use case "{name}": custom model is missing {miss}. Ask the user for the geometry or pick a library model.')
        model_cfg = {'custom': True, **{k: mdl[k] for k in need}}
        snap_model = {'name': mdl.get('name', 'Custom'), **{k: mdl[k] for k in need},
                      'arch': 'Custom', 'dev': '\u2014'}
    else:
        m = resolve(mdl, LIB['models'], 'model')
        model_cfg = {'custom': False, 'name': m['name']}
        snap_model = {k: m[k] for k in ('name', 'params', 'active', 'hidden', 'layers', 'kvHeads', 'headDim', 'ctx')}
        snap_model['arch'] = m.get('arch', ''); snap_model['dev'] = m.get('dev', '')
    # --- quants
    wq = resolve(u.get('weightQuant', 'FP8'), LIB['quants'], 'weight quant')
    # FP8 is the production default for the KV cache: it halves the cache against
    # BF16 with negligible quality loss. The readable-link parser and the docs
    # already default to it; this encoder defaulted to BF16 and quietly doubled
    # the KV bill of every configuration it produced.
    kq = resolve(u.get('kvQuant', 'FP8'), LIB['kv_quants'], 'KV quant')
    # --- preset
    preset = None
    case = None
    if u.get('preset'):
        case = resolve(u['preset'], LIB['cases'], 'workload preset')
        preset = case['name']
        if case['name'].startswith('Custom'): case, preset = None, None
    def from_case(key, spec_key, default):
        if u.get(spec_key) is not None: return u[spec_key]
        if case is not None: return case[key]
        return default
    resident = clamp('residentSeq', from_case('resident', 'residentSeq', FR['residentSeq']['default']), warnings)
    visible  = clamp('visibleOut', from_case('visibleOut', 'visibleOut', FR['visibleOut']['default']), warnings)
    # prefix caching: 0 unless the caller states a measured hit rate. Presets never
    # ship one, so from_case falls through to the spec value or to zero.
    cachep  = clamp('sharedPrefixPct',
                    u['sharedPrefixPct'] if u.get('sharedPrefixPct') is not None
                    else (case or {}).get('cachePct', 0) or 0, warnings)
    # conversation shape: a session holds its transcript, so the resident sequence
    # follows the call length. Stating callMinutes alone is enough when a preset
    # supplies the rate and the base.
    shp = (case or {}).get('session')
    sess = u.get('session')
    if sess is not None or shp is not None:
        sess = sess or {}
        mins = float(sess.get('callMinutes', shp['min'] if shp else 0) or 0)
        rate = float(sess.get('tokensPerMinute', shp['tokMin'] if shp else 200) or 0)
        base = float(sess.get('baseTokens', shp['base'] if shp else max(0, resident - 1000)) or 0)
        basis = 'mean' if str(sess.get('basis', 'peak')).lower().startswith(('mean', 'avg')) else 'peak'
        mins = max(0.0, min(240.0, mins)); rate = max(0.0, min(20000.0, rate)); base = max(0.0, base)
        session = {'callMinutes': mins, 'tokensPerMinute': rate,
                   'baseTokens': int(base), 'basis': basis}
        # an explicit session statement re-derives the resident sequence, but a
        # spec that only names a preset keeps that preset's own figure
        if u.get('session') is not None and u.get('residentSeq') is None and mins > 0 and rate > 0:
            resident = clamp('residentSeq',
                             int(round(base + rate * mins / (2 if basis == 'mean' else 1))), warnings)
    else:
        session = None
    # --- reasoning
    rz = u.get('reasoning')
    if rz is None:
        # v28 presets may pin an exact budget (reasonTok) through the Custom class
        if case is not None and case.get('reasonTok'):
            rz = {'mode': 'Custom', 'tokens': case['reasonTok']}
        else:
            rz = case['reasoning'] if case else 'None'
    if isinstance(rz, str): rz = {'mode': rz}
    mode = rz.get('mode', 'None')
    if mode not in REASON_MODES:
        die(f'use case "{name}": reasoning mode "{mode}" invalid. Options: {REASON_MODES}')
    tokens = rz.get('tokens', LIB['reason_tokens'][mode]) if mode == 'Custom' else LIB['reason_tokens'][mode]
    tokens = clamp('reasoningTokens', tokens, warnings)
    extends = bool(rz.get('extendsKV', True))
    # --- traffic / concurrency
    traffic = (case or {}).get('traffic', {}) or {}
    est_in = u.get('estimator', {}) or {}
    users = u.get('activeUsers')
    direct = bool(traffic.get('direct'))
    est = {
        'turnsPerHour': est_in.get('turnsPerHour', traffic.get('turns', 8)),
        'pctTurnsLLM': est_in.get('pctTurnsLLM', 100),
        'callsPerTurn': est_in.get('callsPerTurn', traffic.get('calls', 1.5)),
        'burst': est_in.get('burst', traffic.get('burst', 1.5)),
        'callDurS': est_in.get('callDurS', traffic.get('durS', 20)),
    }
    if u.get('concurrentCalls') is not None:
        conc = int(math.ceil(u['concurrentCalls'])); conc_manual = True
    elif users is not None:
        if direct:
            conc = int(math.ceil(users))
        else:
            conc = max(1, math.ceil(users * est['turnsPerHour'] * (est['pctTurnsLLM'] / 100.0)
                                    * est['callsPerTurn'] * est['callDurS'] / 3600.0 * est['burst']))
        conc_manual = False
    else:
        die(f'use case "{name}": give either "concurrentCalls" (peak in-flight requests) or '
            f'"activeUsers" (headcount; concurrency is derived Little\'s-law style). Ask the user for one of the two.')
    conc = clamp('concurrentCalls', conc, warnings)
    sessions = int(users) if users is not None else 0
    # --- SLOs
    slo_in = u.get('sloTargets', {}) or {}
    slo = {'ttftMs': slo_in.get('ttftMs', case['ttftTarget'] if case else 0),
           'tps':    slo_in.get('tps', case['tpsTarget'] if case else 0),
           'p95s':   slo_in.get('p95s', case['p95Target'] if case else 0)}
    # --- topology seeds (the app re-auto-sizes these on load)
    perw = gl['gpusPerWorker']; vram = gl['gpu']['vram']
    tp = u.get('tensorParallel')
    if tp is None:
        weights_gb = snap_model['params'] * wq['bytes']
        tp = 1
        while tp < 64 and (weights_gb * 1.1 + 4) > tp * vram * 0.9:
            tp *= 2
    tp = clamp('tensorParallel', int(tp), warnings)
    batch_seed = u.get('maxBatchPerReplica')
    workers = u.get('workers')
    if workers is None:
        reps = max(1, math.ceil(conc / (batch_seed or 16)))
        workers = max(1, math.ceil(reps * tp / perw))
    workers = clamp('workers', int(workers), warnings)
    if batch_seed is None:
        reps = max(1, (workers * perw) // max(1, tp))
        batch_seed = max(1, math.ceil(conc / reps))
    batch = clamp('maxBatchPerReplica', int(batch_seed), warnings)
    # --- kv policy
    policy = u.get('kvPolicy', (case or {}).get('policy') or 'running')
    if policy not in LIB['kv_policies']:
        die(f'use case "{name}": kvPolicy must be one of {LIB["kv_policies"]}')
    # --- supports
    sup_spec = u.get('supports', 'auto')
    supports = []
    if sup_spec == 'auto':
        for kind in (case or {}).get('supports', []) or []:
            d = sup_default(kind)
            if d: supports.append({'kind': kind, 'model': d['name'], 'on': True})
    else:
        for s in (sup_spec or []):
            if isinstance(s, str):
                kind, model = s, None
            else:
                kind, model = s.get('kind'), s.get('model')
            kinds = [k['key'] for k in LIB['support']['kinds']]
            if kind not in kinds:
                die(f'use case "{name}": support kind "{kind}" invalid. Options: {kinds}')
            if model is None:
                m = sup_default(kind)
            else:
                m = resolve(model, [x for x in LIB['support']['models'] if x['kind'] == kind],
                            f'{kind} support model')
            supports.append({'kind': kind, 'model': m['name'], 'on': True})
    # --- assemble (v5 per-use-case shape, mirrors ucToConfig/ucSnapshot)
    config = {
        'model': model_cfg,
        'weightQuant': wq['name'], 'kvQuant': kq['name'],
        'preset': preset,
        'residentSeq': resident, 'sharedPrefixPct': cachep, 'visibleOut': visible,
        **({'session': session} if session else {}),
        'reasoning': {'mode': mode, 'tokens': tokens, 'extendsKV': extends},
        'concurrentCalls': conc, 'maxBatchPerReplica': batch, 'kvPolicy': policy,
        'hardware': {'workers': workers, 'tensorParallel': tp},
        'sloTargets': slo,
        'estimator': {'sessions': sessions, **est},
    }
    snapshot = {'model': snap_model, 'weightBytes': wq['bytes'], 'kvBytes': kq['bytes']}
    return {'id': f'uc{idx + 1}', 'name': name, 'isolate': bool(u.get('isolate', False)),
            'supports': supports, 'concManual': conc_manual,
            'activeUsers': (int(users) if users is not None else None),
            'config': config, 'snapshot': snapshot}

# ---------------------------------------------------------------------------
# Physics audit. Name resolution and range clamping catch a typo; they do not
# catch a configuration that is arithmetically impossible or that will open red
# in the studio. Everything below is checked against the same libraries and the
# same closed forms the engine uses, BEFORE a link is printed, because a link
# that opens on a broken fleet is worse than no link at all.
# ---------------------------------------------------------------------------
KV_BYTES = {q['name']: q['bytes'] for q in LIB['kv_quants']}
W_BYTES  = {q['name']: q['bytes'] for q in LIB['quants']}
TP_WIDTHS = [1, 2, 4, 8, 16, 32, 64, 72]

def _kv_per_token(m, bytes_kv, eff_seq):
    """Engine v27 KV per token, including the sliding-window hybrid form."""
    kv_layers = max(1, m.get('kvLayers') or m['layers'])
    kv_global = min(kv_layers, max(0, m.get('kvGlobal') or 0))
    kv_win = max(0, m.get('kvWin') or 0)
    if kv_global > 0 and kv_win > 0:
        per = (kv_global * (1 if m.get('kvgKeyOnly') else 2)
               * (m.get('kvgHeads') or m['kvHeads']) * (m.get('kvgDim') or m['headDim'])
               + (kv_layers - kv_global) * 2 * m['kvHeads'] * m['headDim']
               * min(1.0, kv_win / max(1, eff_seq)))
    else:
        per = 2 * kv_layers * m['kvHeads'] * m['headDim']
    return per * bytes_kv / 1e9

def _model_of(uc):
    """The geometry actually in force: a library entry or the custom snapshot."""
    return uc['snapshot']['model']

def audit_payload(payload):
    """Returns (errors, warns, notes).

    errors  no hardware choice can fix this, so no link is produced
    warns   the fleet will be built but will MISS a stated target; the link is
            still the best way to show the user why, and the caller must repeat
            the warning rather than presenting the fleet as if it complied
    notes   legal, but usually a mistake"""
    errs, warns, notes = [], [], []
    gpu = resolve(payload['config']['gpu'], LIB['gpus'], 'GPU')
    per_w = payload['config']['hardware']['gpusPerWorker']
    tun = payload['config'].get('tuning', {})
    mfu = tun.get('prefillMFU', 0.5); mbu = tun.get('decodeMBU', 0.65)
    ic  = tun.get('interconnectEff', 0.85); ovh = tun.get('frameworkOverheadMs', 30)

    # quantization the card cannot run
    for uc in payload['project']['usecases']:
        c = uc['config']; who = uc['name']
        q = next((x for x in LIB['quants'] if x['name'] == c['weightQuant']), None)
        hw = (q or {}).get('hw', '')
        if 'Blackwell only' in hw and 'Blackwell' not in (gpu.get('arch') or ''):
            errs.append(f'{who}: {c["weightQuant"]} weights are {hw}, and {gpu["name"]} is '
                        f'{gpu.get("arch")}. Pick FP8 or BF16.')
        elif 'Hopper+' in hw and (gpu.get('arch') or '') in ('Ampere', 'Ada Lovelace', 'Turing', 'Volta'):
            notes.append(f'{who}: {c["weightQuant"]} is {hw}; {gpu["name"]} is {gpu.get("arch")}, '
                         f'so expect emulation rather than native throughput.')

    for uc in payload['project']['usecases']:
        c = uc['config']; who = uc['name']
        m = _model_of(uc)
        bw_w = uc['snapshot']['weightBytes']; bk = uc['snapshot']['kvBytes']
        rz = c['reasoning']; reason = rz['tokens'] if rz.get('extendsKV') else 0
        eff_seq = c['residentSeq'] + reason
        slo = c['sloTargets']; gen = rz['tokens'] + c['visibleOut']

        # --- errors -------------------------------------------------------
        if c['residentSeq'] < 1 or c['visibleOut'] < 1:
            errs.append(f'{who}: residentSeq and visibleOut must both be at least 1 token.')
        if eff_seq > m['ctx']:
            errs.append(f'{who}: {fmt_i(c["residentSeq"])} resident + {fmt_i(reason)} reasoning tokens '
                        f'exceed {m["name"]}\'s {fmt_i(m["ctx"])}-token context. Trim the sequence or '
                        f'pick a longer-context model.')
        if m['active'] > m['params'] + 1e-9:
            errs.append(f'{who}: active parameters ({m["active"]}B) exceed total ({m["params"]}B).')
        weights = m['params'] * bw_w
        if weights > 72 * gpu['vram']:
            errs.append(f'{who}: one {weights:,.0f} GB copy of {m["name"]} at {c["weightQuant"]} does not '
                        f'fit even across 72x {gpu["name"]} ({72 * gpu["vram"]:,.0f} GB). Quantize further '
                        f'or pick a smaller model.')
        if slo['p95s'] > 0 and slo['tps'] > 0:
            need = 1.3 * (slo['ttftMs'] / 1000 + gen / slo['tps'])
            if need > slo['p95s'] + 1e-9:
                errs.append(f'{who}: the three targets contradict each other. {fmt_i(gen)} generated tokens '
                            f'at {slo["tps"]} tok/s after a {slo["ttftMs"]} ms first token is {need:.1f} s at '
                            f'P95, above the {slo["p95s"]} s promise. Raise p95s to >= {need:.1f}, raise tps, '
                            f'or cut the output.')

        # --- the two that quietly over-order hardware ---------------------
        if c['residentSeq'] >= 0.9 * m['ctx'] and m['ctx'] >= 32768:
            notes.append(f'{who}: residentSeq {fmt_i(c["residentSeq"])} is ~the whole {fmt_i(m["ctx"])}-token '
                         f'context window. residentSeq is what one request HOLDS, not what the model can '
                         f'hold. If conversations are 8K, say 8192.')
        if c['sharedPrefixPct'] > 0:
            notes.append(f'{who}: sharedPrefixPct {c["sharedPrefixPct"]}% assumes the serving stack has '
                         f'automatic prefix caching ON and that the prompts really share that prefix. '
                         f'Only keep it if the user said so.')

        # --- workload-class sanity ---------------------------------------
        live = c['kvPolicy'] == 'all' or (0 < slo['p95s'] <= 6)
        if live and 0 < slo['tps'] < 30:
            notes.append(f'{who}: a live path at {slo["tps"]} tok/s. Speech and interactive paths need >= 30 '
                         f'tok/s to stay ahead of the listener.')
        if c.get('session') and c['kvPolicy'] != 'all':
            notes.append(f'{who}: a call length is set but KV is freed between turns, so the call length '
                         f'barely matters. Live voice paths usually want kvPolicy "all".')
        case = next((x for x in LIB['cases'] if x['name'] == c.get('preset')), None)
        if case and case.get('supports'):
            have = {sp['kind'] for sp in uc.get('supports') or []}
            missing = [k for k in case['supports'] if k not in have]
            if missing:
                notes.append(f'{who}: the {case["name"]} preset normally attaches {", ".join(missing)}. '
                             f'Leaving them off under-sizes the fleet.')
        if uc.get('activeUsers') and uc.get('concManual') and c['concurrentCalls'] > uc['activeUsers']:
            notes.append(f'{who}: {c["concurrentCalls"]} concurrent calls from {uc["activeUsers"]} active '
                         f'users means every user is mid-request at once. Check the concurrency.')

        # --- reachability: is the speed target physically possible here? ---
        kv_tok = _kv_per_token(m, bk, eff_seq)
        if slo['tps'] > 0:
            best_tp = min(72, per_w if per_w > 1 else 8)
            ic_eff = ic if best_tp <= per_w else min(ic, 0.7)
            bw_eff = gpu['bw'] * best_tp * ic_eff * mbu * 1000
            best = bw_eff / (m['active'] * bw_w + 1 * eff_seq * kv_tok)   # batch 1: the ceiling
            if best < slo['tps']:
                warns.append(f'{who}: {slo["tps"]} tok/s per user is unreachable on {gpu["name"]}. Even one '
                            f'request alone at TP{best_tp} tops out at {best:.0f} tok/s for {m["name"]} at '
                            f'{eff_seq:,} tokens. Lower the target, shorten the sequence, quantize the KV '
                            f'cache, or pick a faster card.')
            elif best < slo['tps'] * 1.35:
                notes.append(f'{who}: {slo["tps"]} tok/s is close to the {best:.0f} tok/s ceiling at TP{best_tp} '
                             f'and batch 1, so this pool will buy a replica per request or two.')
        if slo['ttftMs'] > 0:
            cached = int(c['residentSeq'] * min(0.95, c['sharedPrefixPct'] / 100))
            best_tp = min(72, per_w if per_w > 1 else 8)
            ttft = 2 * max(0, c['residentSeq'] - cached) * m['active'] / (gpu['tflops'] * best_tp * mfu)
            if ttft > slo['ttftMs']:
                warns.append(f'{who}: the {slo["ttftMs"]} ms first-token target will be missed. Prefilling '
                            f'{fmt_i(c["residentSeq"] - cached)} tokens of {m["name"]} at TP{best_tp} on '
                            f'{gpu["name"]} takes {ttft:.0f} ms, so the studio will show this red. Raise the '
                            f'target, shorten the prompt, widen the node, or pick a smaller model.')

        # --- KV precision left on the table -------------------------------
        admitted = min(c['concurrentCalls'], c['maxBatchPerReplica'])
        kv_total = admitted * eff_seq * kv_tok
        if bk >= 2 and kv_total > weights:
            notes.append(f'{who}: KV cache ({kv_total:,.0f} GB) outweighs the weights ({weights:,.0f} GB) at '
                         f'{c["kvQuant"]}. FP8 KV halves it with negligible quality loss and is the '
                         f'production default.')
    return errs, warns, notes

def fmt_i(n):
    return f'{int(round(n)):,}'

def build_payload(spec):
    warnings = []
    gpu = resolve(spec.get('gpu'), LIB['gpus'], 'GPU') if spec.get('gpu') else die('"gpu" is required - ask the user which GPU to size on (see `gpuscale_url.py list gpus`).')
    gl = {'gpu': gpu, 'gpusPerWorker': clamp('gpusPerWorker', int(spec.get('gpusPerWorker', 8)), warnings)}
    resil = resolve_resil(spec.get('resilience'))
    t_in = spec.get('tuning', {}) or {}
    tuning = {'prefillMFU': clamp('prefillMFU', t_in.get('prefillMFU', 0.5), warnings),
              'decodeMBU': clamp('decodeMBU', t_in.get('decodeMBU', 0.65), warnings),
              'interconnectEff': clamp('interconnectEff', t_in.get('interconnectEff', 0.85), warnings),
              'frameworkOverheadMs': clamp('frameworkOverheadMs', t_in.get('frameworkOverheadMs', 30), warnings),
              'autoSizeUtilPct': t_in.get('autoSizeUtilPct', 80)}
    ucs_in = spec.get('usecases')
    if not ucs_in:
        ucs_in = [spec]  # single-scenario shorthand: use-case fields at the top level
    ucs = [build_usecase(u, gl, i, warnings) for i, u in enumerate(ucs_in)]
    active = min(int(spec.get('active', 0)), len(ucs) - 1)
    a = ucs[active]
    config = dict(a['config'])
    config['gpu'] = gpu['name']
    config['hardware'] = {'workers': a['config']['hardware']['workers'], 'gpusPerWorker': gl['gpusPerWorker'],
                          'tensorParallel': a['config']['hardware']['tensorParallel'], 'resilience': resil}
    config['tuning'] = tuning
    config['theme'] = spec.get('theme', 'light')
    snapshot = {'model': a['snapshot']['model'],
                'gpu': {'name': gpu['name'], 'vram': gpu['vram'], 'bw': gpu['bw'],
                        'tflops': gpu['tflops'], 'watts': gpu['watts'], 'arch': gpu.get('arch', '')},
                'weightBytes': a['snapshot']['weightBytes'], 'kvBytes': a['snapshot']['kvBytes']}
    pid = spec.get('projectId') or new_proj_id()
    payload = {'schema': LIB['versions']['schema'], 'engine': LIB['versions']['engine'],
               'studio': LIB['versions']['studio'],
               'name': spec.get('name') or 'Untitled project', 'projectId': pid, 'scenarioId': pid,
               'mode': spec.get('mode', 'advanced'),
               'savedAt': (lambda n: n.strftime('%Y-%m-%dT%H:%M:%S.') + f'{n.microsecond // 1000:03d}Z')(datetime.now(timezone.utc)),
               'config': config, 'snapshot': snapshot,
               'project': {'active': active, 'usecases': ucs}}
    # computed `results` blocks are intentionally omitted: the app ignores them on
    # import and recomputes + auto-sizes topology the moment the link opens.
    return payload, warnings

# ---------------------------------------------------------------- summary
def summarize(payload, url):
    lines = []
    c = payload['config']; hw = c.get('hardware', {})
    lines.append(f"project  : {payload['name']}  (id {payload['projectId']}, {payload['mode']} mode)")
    lines.append(f"fleet    : {c.get('gpu')} | {hw.get('gpusPerWorker')} GPUs/worker | resilience {hw.get('resilience')}")
    t = c.get('tuning', {})
    lines.append(f"tuning   : MFU {t.get('prefillMFU')} | MBU {t.get('decodeMBU')} | IC {t.get('interconnectEff')} | overhead {t.get('frameworkOverheadMs')} ms | auto-size target {t.get('autoSizeUtilPct')}%")
    for u in payload.get('project', {}).get('usecases', []):
        cc = u['config']; m = cc['model']
        mname = m.get('name', 'Custom') if not m.get('custom') else f"Custom {m.get('params')}B"
        rz = cc['reasoning']
        lines.append(f"- {u['name']}: {mname} @ {cc['weightQuant']}/KV {cc['kvQuant']}"
                     f" | preset {cc['preset'] or 'Custom'} | seq {cc['residentSeq']} + out {cc['visibleOut']}"
                     f" | reasoning {rz['mode']}" + (f" ({rz['tokens']} tok)" if rz['tokens'] else '')
                     + f" | conc {cc['concurrentCalls']}" + (' (manual)' if u.get('concManual') else f" (from {u.get('activeUsers')} users)")
                     + f" | SLO ttft {cc['sloTargets']['ttftMs']}ms tps {cc['sloTargets']['tps']} p95 {cc['sloTargets']['p95s']}s"
                     + (f" | supports: {', '.join(s['kind'] + ':' + s['model'] for s in u['supports'])}" if u['supports'] else ''))
    lines.append(f"URL length: {len(url)} chars" + ('  (long - some tools truncate; consider sharing the JSON file too)' if len(url) > 8000 else ''))
    return '\n'.join(lines)

# ---------------------------------------------------------------- commands
def cmd_encode(args):
    spec = json.load(open(args.spec))
    if spec.get('schema', '').startswith('gpuscale'):
        payload, warnings = spec, []
    else:
        payload, warnings = build_payload(spec)

    # A link that opens on a broken fleet is worse than no link. Audit the
    # physics before encoding anything, and refuse on a hard contradiction.
    errs, warns, notes = ([], [], [])
    if not args.no_audit:
        try:
            errs, warns, notes = audit_payload(payload)
        except Exception as e:                      # never let the audit itself block a link
            notes.append(f'audit could not run ({e})')
    if errs and not args.force:
        sys.stderr.write('\nThis configuration is wrong, so no link was produced:\n\n')
        for e in errs:
            sys.stderr.write(f'  ERROR  {e}\n')
        for w in warns: sys.stderr.write(f'  WARN   {w}\n')
        if notes:
            sys.stderr.write('\n')
            for n in notes: sys.stderr.write(f'  note   {n}\n')
        sys.stderr.write('\nFix the spec and run again. Use --force only if you have a reason to '
                         'deliver a knowingly broken configuration.\n')
        sys.exit(2)

    url = payload_to_url(payload, args.base)
    url2 = payload_to_url(payload, BACKUP_BASE) if args.base != BACKUP_BASE else None
    for u_ in filter(None, [url, url2]):
        if url_to_payload(u_) != payload:
            die('self-verification failed: decoded URL does not match the payload. Do not deliver this link.')
    if args.out: json.dump(payload, open(args.out, 'w'), indent=1)
    for w in warnings: warn(w)
    for e in errs: warn('FORCED PAST AN ERROR: ' + e)
    if warns:
        sys.stderr.write('\nThis fleet will MISS a target you asked for. Say so when you deliver it:\n')
        for w in warns: sys.stderr.write(f'  WARN   {w}\n')
        sys.stderr.write('\n')
    if notes:
        sys.stderr.write('Check these before you hand the link over:\n')
        for n in notes: sys.stderr.write(f'  note   {n}\n')
        sys.stderr.write('\n')
    if not args.quiet:
        print(summarize(payload, url))
        print(f'audit      : {"clean" if not (errs or warns or notes) else f"{len(errs)} error(s), {len(warns)} warning(s), {len(notes)} note(s)"}')
        print('round-trip : verified OK (both links)\n')
    print(url)
    if url2:
        print()
        print('backup (same project, mirror host for networks that block gpuscale.net):')
        print(url2)

def cmd_decode(args):
    payload = url_to_payload(args.link)
    out = json.dumps(payload, indent=1, ensure_ascii=False)
    if args.out: open(args.out, 'w').write(out)
    print(out)

def cmd_list(args):
    f = (args.filter or '').lower()
    def keep(s): return f in s.lower()
    if args.what == 'models':
        for m in LIB['models']:
            row = f"{m['name']} | {m['params']}B total / {m['active']}B active | ctx {m['ctx']} | {m['arch']} | {m['dev']}"
            if keep(row): print(row)
    elif args.what == 'gpus':
        for g in LIB['gpus']:
            row = f"{g['name']} | {g['vram']} GB | {g['bw']} TB/s | {g['tflops']} TFLOPS | {g['watts']} W | {g.get('cls','')}"
            if keep(row): print(row)
    elif args.what == 'quants':
        for q in LIB['quants']:
            row = f"{q['name']} | {q['bytes']} B/param | {q['quality']} | {q['use']}"
            if keep(row): print(row)
    elif args.what == 'kvquants':
        for q in LIB['kv_quants']: print(f"{q['name']} | {q['bytes']} B/element")
    elif args.what == 'presets':
        for c in LIB['cases']:
            row = (f"{c['name']} | seq {c['resident']} | out {c['visibleOut']} | reasoning {c['reasoning']}"
                   f" | SLO {c['ttftTarget']}ms/{c['tpsTarget']}tps/{c['p95Target']}s | supports {','.join(c.get('supports', [])) or '-'}")
            if keep(row): print(row)
    elif args.what == 'resilience':
        for r in LIB['resilience']: print(f"{r['key']} | {r['label']} | {r['long']}")
    elif args.what == 'supports':
        for m in LIB['support']['models']:
            row = f"{m['kind']} | {m['name']} | {m['vram']} GB/instance | cap {m['cap']}" + (' | default' if m.get('default') else '')
            if keep(row): print(row)

def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest='cmd', required=True)
    e = sub.add_parser('encode'); e.add_argument('spec'); e.add_argument('--base', default=DEFAULT_BASE)
    e.add_argument('--out'); e.add_argument('--quiet', action='store_true')
    e.add_argument('--no-audit', action='store_true',
                   help='skip the physics audit (not recommended)')
    e.add_argument('--force', action='store_true',
                   help='emit the link even when the audit found a hard error'); e.set_defaults(fn=cmd_encode)
    d = sub.add_parser('decode'); d.add_argument('link'); d.add_argument('--out'); d.set_defaults(fn=cmd_decode)
    l = sub.add_parser('list'); l.add_argument('what', choices=['models', 'gpus', 'quants', 'kvquants', 'presets', 'resilience', 'supports'])
    l.add_argument('filter', nargs='?'); l.set_defaults(fn=cmd_list)
    args = p.parse_args()
    args.fn(args)

if __name__ == '__main__':
    main()
