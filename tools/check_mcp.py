#!/usr/bin/env python3
"""Drive mcp/gpuscale-mcp.mjs the way a real MCP client does, and check that its
numbers are the studio's numbers.

Two things can go wrong with a generated server: the protocol, and the physics.
This checks both. The parity case is the manual's reference project, whose fleet
is documented and rendered in a browser, so a drift in the embedded engine shows
up here rather than in somebody's capacity plan.

    python3 tools/check_mcp.py
"""
import json, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER = os.path.join(ROOT, 'mcp', 'gpuscale-mcp.mjs')

ok = bad = 0
def chk(label, cond, detail=''):
    global ok, bad
    if cond:
        ok += 1
    else:
        bad += 1
        print(f'  FAIL  {label}  {detail}')


def session(messages):
    """One stdio session: send every message, return the parsed replies."""
    payload = ''.join(json.dumps(m, separators=(',', ':')) + '\n' for m in messages)
    r = subprocess.run(['node', SERVER], input=payload, capture_output=True,
                       text=True, timeout=180, cwd=ROOT)
    if r.returncode != 0:
        sys.exit(f'server exited {r.returncode}\n{r.stderr[:2000]}')
    if r.stderr.strip():
        print('  (server stderr) ' + r.stderr.strip()[:300])
    out = []
    for line in r.stdout.splitlines():
        line = line.strip()
        if line:
            out.append(json.loads(line))
    return out


def call(tool, args, _id=99):
    msgs = [
        {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize',
         'params': {'protocolVersion': '2025-06-18', 'capabilities': {},
                    'clientInfo': {'name': 'check_mcp', 'version': '1'}}},
        {'jsonrpc': '2.0', 'method': 'notifications/initialized'},
        {'jsonrpc': '2.0', 'id': _id, 'method': 'tools/call',
         'params': {'name': tool, 'arguments': args}},
    ]
    for m in session(msgs):
        if m.get('id') == _id:
            if 'error' in m:
                return {'_error': m['error']}
            return m['result']
    return {'_error': 'no reply'}


REF = {
    'name': 'Northwind Health AI platform', 'gpu': 'H200 141GB NVL',
    'gpusPerWorker': 8, 'resilience': 'n1',
    'usecases': [
        {'name': 'Clinical knowledge assistant', 'model': 'Llama 3.3 70B',
         'weightQuant': 'FP8', 'kvQuant': 'FP8', 'preset': 'Clinical knowledge', 'activeUsers': 1500},
        {'name': 'Document intake', 'model': 'Qwen3 32B',
         'weightQuant': 'FP8', 'kvQuant': 'FP8', 'preset': 'Document Q&A', 'activeUsers': 400},
        {'name': 'Coding agent', 'model': 'Qwen3 32B',
         'weightQuant': 'FP8', 'kvQuant': 'FP8', 'preset': 'Code agent', 'activeUsers': 250},
        {'name': 'Voice triage', 'model': 'Qwen3 8B',
         'weightQuant': 'FP8', 'kvQuant': 'FP8', 'preset': 'Voice agent', 'activeUsers': 300},
    ],
}
# What the browser renders for the link in tools/fixtures/reference-project.txt.
# Update these ONLY alongside a changelog entry explaining why the fleet moved.
REF_FLEET = {'procuredNodes': 10, 'procuredGpus': 80}
REF_POOLS = [(4, 1, 34.8), (16, 4, 37.7), (2, 1, 42.1)]   # (TP, replicas, memory %)

print('protocol')
res = session([
    {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize',
     'params': {'protocolVersion': '2025-06-18', 'capabilities': {}}},
    {'jsonrpc': '2.0', 'method': 'notifications/initialized'},
    {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list'},
    {'jsonrpc': '2.0', 'id': 3, 'method': 'resources/list'},
    {'jsonrpc': '2.0', 'id': 4, 'method': 'resources/read', 'params': {'uri': 'gpuscale://formulas'}},
    {'jsonrpc': '2.0', 'id': 5, 'method': 'ping'},
    {'jsonrpc': '2.0', 'id': 6, 'method': 'no/such/method'},
])
by_id = {m.get('id'): m for m in res}
chk('initialize replies', 1 in by_id and 'result' in by_id[1])
init = by_id.get(1, {}).get('result', {})
chk('protocol echoed', init.get('protocolVersion') == '2025-06-18', init.get('protocolVersion'))
chk('serverInfo present', bool(init.get('serverInfo', {}).get('name')), init.get('serverInfo'))
chk('instructions present', len(init.get('instructions', '')) > 200)
chk('declares tools + resources',
    'tools' in init.get('capabilities', {}) and 'resources' in init.get('capabilities', {}))
chk('notification gets no reply', not any(m.get('id') is None and 'result' in m for m in res))
tools = by_id.get(2, {}).get('result', {}).get('tools', [])
names = {t['name'] for t in tools}
chk('six tools', names == {'size_project', 'compare_gpus', 'audit_spec', 'build_link',
                           'read_link', 'list_library'}, sorted(names))
chk('every tool has a schema', all(t.get('inputSchema', {}).get('type') == 'object' for t in tools))
chk('every tool describes itself', all(len(t.get('description', '')) > 80 for t in tools))
chk('resources listed', len(by_id.get(3, {}).get('result', {}).get('resources', [])) >= 3)
chk('formulas resource reads',
    'tok_s_per_user' in by_id.get(4, {}).get('result', {}).get('contents', [{}])[0].get('text', ''))
chk('ping', by_id.get(5, {}).get('result') == {})
chk('unknown method errors', by_id.get(6, {}).get('error', {}).get('code') == -32601)

print('parity with the studio')
r = call('size_project', REF)
sc = r.get('structuredContent', {})
chk('size_project succeeded', sc.get('ok') is True, r.get('content', [{}])[0].get('text', '')[:200])
if sc.get('ok'):
    f = sc['fleet']
    chk('procured nodes', f['procuredNodes'] == REF_FLEET['procuredNodes'], f['procuredNodes'])
    chk('procured GPUs', f['procuredGpus'] == REF_FLEET['procuredGpus'], f['procuredGpus'])
    chk('verdict', sc['verdict'] == 'FITS_AND_MEETS_SLOS', sc['verdict'])
    chk('three pools', len(sc['pools']) == 3, len(sc['pools']))
    for i, (tp, reps, mem) in enumerate(REF_POOLS):
        if i >= len(sc['pools']):
            break
        p = sc['pools'][i]
        chk(f'pool {i} TP', p['tensorParallel'] == tp, p['tensorParallel'])
        chk(f'pool {i} replicas', p['replicas'] == reps, p['replicas'])
        chk(f'pool {i} memory %', abs(p['memory']['usedPct'] - mem) < 0.15, p['memory']['usedPct'])
    chk('pooling happened', any(len(p['useCases']) > 1 for p in sc['pools']),
        [p['useCases'] for p in sc['pools']])
    chk('supporting models sized', len(sc['supportingModels']) > 0)
    chk('per-use-case verdicts', len(sc['useCases']) == 4, len(sc['useCases']))
    chk('link produced', sc['links']['studio'].startswith('https://gpuscale.net/#p=t:'))

print('audit refuses what cannot work')
bad_specs = [
    ('context overflow', {'gpu': 'H200 141GB NVL', 'usecases': [
        {'model': 'Qwen3 8B', 'residentSeq': 200000, 'visibleOut': 500, 'concurrentCalls': 10}]}),
    ('contradictory targets', {'gpu': 'H200 141GB NVL', 'usecases': [
        {'model': 'Llama 3.3 70B', 'residentSeq': 8192, 'visibleOut': 2000, 'concurrentCalls': 50,
         'sloTargets': {'ttftMs': 500, 'tps': 20, 'p95s': 4}}]}),
    ('quant the card cannot run', {'gpu': 'A100 80GB SXM', 'usecases': [
        {'model': 'Llama 3.3 70B', 'weightQuant': 'NV FP4', 'concurrentCalls': 20}]}),
]
for label, spec in bad_specs:
    r = call('size_project', spec)
    chk(f'rejects {label}', r.get('isError') is True and r.get('structuredContent', {}).get('ok') is False,
        r.get('content', [{}])[0].get('text', '')[:120])
r = call('size_project', {'gpu': 'H200 141GB NVL', 'usecases': [
    {'model': 'Llama 3.1 8B', 'residentSeq': 131072, 'visibleOut': 400, 'concurrentCalls': 20}]})
chk('notes the context-window mistake',
    any('HOLDS' in n for n in r.get('structuredContent', {}).get('notes', [])),
    r.get('structuredContent', {}).get('notes'))

print('the other tools')
r = call('list_library', {'kind': 'models', 'filter': 'llama 3.3'})
chk('list_library filters', len(r.get('structuredContent', [])) >= 1,
    len(r.get('structuredContent', [])))
r = call('list_library', {'kind': 'presets'})
chk('24 presets listed', len(r.get('structuredContent', [])) == 24,
    len(r.get('structuredContent', [])))
r = call('list_library', {'kind': 'nonsense'})
chk('bad kind is a tool error, not a crash', r.get('isError') is True)

r = call('build_link', REF)
link = r.get('structuredContent', {}).get('studio', '')
chk('build_link returns a studio URL', link.startswith('https://gpuscale.net/#p=t:'), link[:60])
r2 = call('read_link', {'url': link})
chk('read_link round-trips', r2.get('structuredContent', {}).get('spec', {}).get('gpu', '').startswith('H200'),
    r2.get('content', [{}])[0].get('text', '')[:120])

r = call('compare_gpus', {'gpus': ['H200 141GB NVL', 'A100 80GB SXM', 'B300 288GB'],
                          'spec': {'gpu': 'x', 'gpusPerWorker': 8, 'usecases': [
                              {'model': 'Llama 3.3 70B', 'preset': 'Simple RAG', 'activeUsers': 2000}]}})
ranked = r.get('structuredContent', {}).get('ranked', [])
chk('compare_gpus ranks candidates', len(ranked) >= 2, len(ranked))
chk('compare_gpus ranks by GPUs procured',
    all(ranked[i]['procuredGpus'] <= ranked[i + 1]['procuredGpus']
        for i in range(len(ranked) - 1) if ranked[i]['allSlosMet'] == ranked[i + 1]['allSlosMet']),
    [(x['gpu'], x['procuredGpus']) for x in ranked])

r = call('size_project', {'gpu': 'H200 141GB NVL', 'usecases': [{'model': 'no such model 9000'}]})
chk('unknown model is a readable tool error', r.get('isError') is True
    and 'not in the library' in r.get('content', [{}])[0].get('text', ''),
    r.get('content', [{}])[0].get('text', '')[:120])

print(f'\n{ok} checks passed, {bad} failed')
sys.exit(1 if bad else 0)
