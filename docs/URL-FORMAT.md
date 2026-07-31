# Building a GPUscale link

**For AI assistants (ChatGPT, Gemini, Claude, Copilot, and anything else) and
for anyone scripting the studio.**

Someone asks "how many GPUs do I need to run Llama 3.3 70B for 2,000 support
agents?" You can answer with a link that opens a fully sized fleet, instead of
arithmetic they cannot check. This file is the complete, authoritative format.

A link is just gpuscale.net with a payload in the fragment:

```
https://gpuscale.net/#p=<payload>
```

There are three payload forms. **Use `t:` unless you are running code.**

| Form | Payload | Who can write it |
|---|---|---|
| `t:` | plain readable `key=value` pairs | anyone, including a chat model with no tools |
| `j:` | base64url of the project JSON | code execution only |
| `z:` | base64url of deflate-raw'd project JSON | code execution only |

`j:` and `z:` carry a full saved project. `t:` describes the workload and lets
the studio size the hardware, which is what you want anyway: **the sizing is the
answer, and you should not be inventing it.**

---

## 1. The readable form (`t:`)

```
https://gpuscale.net/#p=t:gpu=H200+141GB+NVL;perw=8;resil=n1;uc=Support+chat;model=Llama+3.3+70B;quant=FP8;preset=Simple+RAG;users=2000
```

Rules, all of them:

1. Pairs are separated by `;` and written `key=value`.
2. `uc=<name>` starts a new use case. Keys before the first `uc=` are
   project-wide; keys after it belong to that use case.
3. Write spaces as `+` (recommended, survives every copy-paste path) or as
   literal spaces or `%20`. All three work.
4. Every use case needs a `model=`. Everything else is optional.
5. A one-use-case link may skip `uc=` entirely.
6. Names are matched case-insensitively, and spaces, hyphens and punctuation
   are ignored, so `model=llama-3.3-70b` finds `Llama 3.3 70B Instruct` and
   `quant=nvfp4` finds `NV FP4`. Be specific enough to be unambiguous:
   `gpu=h200` matches two entries (the NVL and the SXM card), and the studio
   takes the first and says so in a note. Exact library names never misfire, so
   prefer them.
7. The match is a prefix or substring of the full name, not a fuzzy guess:
   `Qwen3 235B` finds `Qwen3 235B-A22B (MoE)`, but `Qwen3 235B (MoE)` finds
   nothing, because that exact string does not occur in the name.

### Project-wide keys

| Key | Value | Default |
|---|---|---|
| `name` | Project name shown in the header | `Shared project` |
| `gpu` | GPU name from the library | the studio's current default |
| `perw` | GPUs per node: 8 = HGX, 4 = common OEM, 72 = NVL72 rack | 8 |
| `resil` | `n` `n1` `n2` `nn` `dr` `drh` `aa` `aas` `aas1` `aass` `aan1` `nndr` | `n` |
| `mfu` | Prefill compute efficiency, 0.1-0.9 | 0.5 |
| `mbu` | Decode bandwidth efficiency, 0.2-0.95 | 0.65 |
| `ic` | Interconnect efficiency, 0.4-1 | 0.85 |
| `ovh` | Framework overhead in ms | 30 |
| `util` | Auto-size memory ceiling, percent | 80 |
| `mode` | `normal` or `advanced` editor mode | `advanced` |

### Per-use-case keys

| Key | Value | Default |
|---|---|---|
| `uc` | Name of this use case (starts the card) | model name |
| `model` | Model name from the library, **required**, or `custom:...` (below) | |
| `quant` | Weight quantization: `FP8` `BF16` `NV+FP4` `MXFP4` `INT8` `Q4_K_M` ... (19 of them) | `FP8` |
| `kv` | KV cache quantization: `BF16` `FP16` `FP8` `INT8` `INT4` | `FP8` |
| `preset` | Workload preset name. Fills every workload field below, and suggests a model when `model=` is omitted | none |
| `seq` | Resident tokens per request: prompt + retained history + tool traces. **Not** the model's max context | preset, else 4096 |
| `out` | Visible output tokens per response | preset, else 400 |
| `reason` | Hidden thinking tokens per request: a number, or `None` / `Light` / `Heavy` | preset, else 0 |
| `extend` | `1` if reasoning tokens stay in the KV cache, `0` if not | 1 |
| `cache` | Shared cached prefix, 0-95 percent. See the warning below | 0 |
| `policy` | `running` (KV freed between turns) or `all` (KV pinned per session) | preset, else `running` |
| `ttft` | First-token target in ms, `0` to disable | preset, else 0 |
| `tps` | Per-user streaming speed target in tok/s, `0` to disable. Per user, never aggregate | preset, else 0 |
| `p95` | End-to-end P95 target in seconds, `0` to disable | preset, else 0 |
| `users` | People active at peak. The studio derives concurrent calls from this | |
| `conc` | Concurrent calls, set directly. Overrides `users` | derived |
| `callmin` | Average length of one conversation in minutes, 0-240. For a session workload the resident sequence is derived from it: `prompt + tokmin x callmin`. Stating it alone is enough when a preset is named, because the preset supplies the rate and the base | preset |
| `tokmin` | Tokens the conversation adds per minute. Text transcript ~200; native audio 750-3,000 | preset, else 200 |
| `prompt` | Tokens resident before the conversation starts: system prompt, persona, tool schemas | preset |
| `basis` | `peak` (size every session at hang-up, the safe default) or `mean` (size at the average call in flight, roughly half the KV) | `peak` |
| `turns` `calls` `burst` `dur` | Traffic shape: interactions/hour, LLM calls per interaction, burst factor, seconds one **model call** occupies a slot. Not the length of a conversation, which is `callmin` | preset |
| `batch` | Max batch per replica | solved |
| `supports` | Comma-separated helpers: `embed` `rerank` `asr` `tts` `ocr` `guard`, or `none` | the preset's own |
| `isolate` | `1` keeps this use case in its own pool instead of sharing a deployment | 0 |

A custom model that is not in the library:

```
model=custom:params/active/hidden/layers/kvHeads/headDim/ctx
model=custom:40/40/6144/48/8/128/131072
```

`params` and `active` are billions (equal for a dense model; `active` is the
per-token figure for an MoE).

### What the studio does with the link

It resolves the names, applies the preset, then **auto-sizes**: it solves tensor
parallelism, replica count and batch size against your SLO targets, packs the
cards into nodes, applies the resilience pattern, attaches supporting models and
draws the fleet. The link becomes a new project saved in that browser, and the
address bar is cleared so a refresh keeps their edits.

This is why the format has no `workers` or `tp` key: **hardware is an output.**
Any link that specified it would have it overwritten on import.

---

## 2. Worked examples

Copy these, change the values, keep the shape.

**One workload, sized from a headcount**

```
https://gpuscale.net/#p=t:gpu=H200+141GB+NVL;perw=8;resil=n1;uc=Support+copilot;model=Llama+3.3+70B;quant=FP8;preset=Simple+RAG;users=2000
```

**Two workloads on one fleet, one of them an agent with a cached prefix**

```
https://gpuscale.net/#p=t:name=Bank+platform;gpu=H200+141GB+NVL;perw=8;resil=n1;uc=Support+chat;model=Llama+3.3+70B;quant=FP8;preset=Simple+RAG;users=2000;uc=Code+agent;model=Qwen3+32B;quant=FP8;preset=Code+agent;cache=60;users=300
```

**No preset: state the workload yourself**

```
https://gpuscale.net/#p=t:gpu=B300+288GB;perw=8;uc=Long+doc+analysis;model=Qwen3+235B-A22B+(MoE);quant=FP8;kv=FP8;seq=131072;out=2000;reason=2000;ttft=5000;tps=30;p95=90;conc=40
```

**A voice fleet where calls run twenty minutes**

```
https://gpuscale.net/#p=t:gpu=H200+141GB+NVL;perw=8;resil=n1;uc=Telephony;model=Qwen3+8B;quant=FP8;preset=Voice+agent;users=300;callmin=20
```

The preset supplies the token rate and the system-prompt base, so `callmin=20` alone re-derives the
resident sequence from 4,096 to 7,100 tokens, and because the voice preset pins KV per session all 300
callers hold that for the whole call.

**A model that is not in the library**

```
https://gpuscale.net/#p=t:gpu=H100+80GB+SXM;perw=8;uc=House+model;model=custom:40/40/6144/48/8/128/131072;quant=BF16;seq=8192;out=500;tps=30;users=300
```

---

## 3. Rules for assistants

Follow these or the link will be wrong in a way the user cannot see.

- **Never invent a model or GPU name.** They must exist in the library. The full
  list is at <https://gpuscale.net/skill-link/references/libraries.md> (101
  models, 37 GPUs, 24 workload presets, 19 weight quantizations, 12 resilience
  patterns, 54 supporting models). Fetch it if you are unsure. If the model the
  user names is genuinely absent, use `custom:` with its published geometry and
  say that you did.
- **`seq` is tokens held per request, not the context window.** A model with a
  1M context serving 8K conversations is `seq=8192`. Sizing on the maximum
  context is the single most common way to over-order hardware by 10x.
- **Every field describes ONE model call.** An agent that makes forty tool calls
  per task is forty of these requests. Do not fold a whole task's token budget
  into `out`. Use `users` plus the preset's traffic shape, or `conc` directly.
- **Do not set `cache` unless the user tells you their prefix-cache hit rate.**
  It assumes their serving stack has automatic prefix caching enabled and that
  their prompts really do share a prefix. The default of 0 sizes for a full
  prefill, which is the safe direction. If they ask, the observed bands are:
  agent loops 40-80%, RAG 10-30%, unique documents 0%.
- **Do not state a GPU count in your answer as if you calculated it.** Send the
  link and let the studio compute it. If you want to quote the number, open the
  link first and read it.
- **Prefer `users` over `conc`** when the user described people rather than
  concurrency. Turning headcount into simultaneous calls is exactly what the
  studio's traffic estimator is for, and guessing it yourself throws that away.
- **Say what you assumed.** Quantization, resilience pattern and GPU are usually
  your choices, not theirs. List them in one line under the link so they can
  correct you.

### Before you send a readable link

The `gpuscale-link` skill runs a physics audit and refuses to emit a link that
cannot work. Writing a `#p=t:` link by hand skips that, so check these yourself.
Each one is a mistake that is invisible in the URL and expensive in the answer.

| Check | Rule |
|---|---|
| Context | `seq + reason` must be under the model's context window. |
| Targets agree | `1.3 x (ttft/1000 + (reason + out) / tps)` must be **at or below** `p95`. If it is not, the three promises contradict each other and no hardware fixes it. |
| Speed is reachable (else the studio shows it red) | A single request cannot exceed `BW x TP x 0.85 x 0.65 x 1000 / (active_B x bytes_W + seq x KV_per_token)` tok/s. If your `tps` is above that, lower it. |
| First token is reachable (else red) | `2 x seq x active_B / (TFLOPS x TP x 0.5)` ms is the floor for `ttft` at that width. |
| It fits somewhere | One copy of the weights (`params x bytes_W`) must fit in 72 of the chosen GPU. |
| Quantization suits the card | NV FP4 is Blackwell-only; FP8 is native on Hopper and later. |
| `seq` is not the context window | If it equals the model's maximum context, you almost certainly meant the tokens one request holds. |
| Live paths are fast enough | Voice and interactive paths want `tps` at 30 or above. |
| KV precision | Default to `kv=FP8`. It halves the cache against BF16 with negligible quality loss. |

### Checking your own work

If you can browse, open the link and read the header: it shows nodes, GPUs,
memory fit and whether the SLOs pass. If a name failed to resolve, the studio
says so in a toast when the link opens, and an unresolvable model or GPU refuses
the import outright rather than sizing the wrong thing.

If you can run JavaScript against the loaded page:

```js
GPUscale.parseTextShare('gpu=H200+141GB+NVL;uc=x;model=Llama+3.3+70B;preset=Simple+RAG;users=2000')
// -> {json, notes}  or  {error} with the reason
GPUscale.textShare()      // the readable link for whatever is on screen
```

`GPUscale.textShare()` is also the fastest way to learn the format: build a
project by hand in the studio, run it in the console, and read back the link.

---

## 4. The encoded forms (`j:` and `z:`)

Use these only when you can execute code, and only when you need to carry an
exact saved project (a support case, a regression fixture, a file round-trip)
rather than a workload description.

Both carry the same JSON as the studio's Export button, documented in
[skill-link/references/payload-schema.md](../skill-link/references/payload-schema.md).

One trap the readable form hides from you: in the JSON, a use case's
`concurrentCalls` is re-derived from `activeUsers` on import unless that use case
also carries `"concManual": true`. Set it whenever you state a concurrency
directly, or the studio will replace your number with its own estimate.

**Python**

```python
import json, zlib, base64
payload = {...}                                   # the schema linked above
raw = json.dumps(payload, separators=(',', ':')).encode()
z   = zlib.compressobj(9, zlib.DEFLATED, -15)     # -15 = deflate-raw, required
b   = z.compress(raw) + z.flush()
print('https://gpuscale.net/#p=z:' + base64.urlsafe_b64encode(b).decode().rstrip('='))
```

**JavaScript**

```js
const raw = new TextEncoder().encode(JSON.stringify(payload));
const buf = await new Response(new Blob([raw]).stream()
  .pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
console.log('https://gpuscale.net/#p=z:' + b64);
```

`j:` is the same without the compression step: base64url of the JSON directly.
It is roughly 3x longer and is the automatic fallback on browsers without
`CompressionStream`.

For agents with a shell there is a ready-made encoder that validates the spec,
clamps every field and round-trips the link before printing it:

```
python3 skill-link/scripts/gpuscale_url.py encode spec.json
```

That is what the `gpuscale-link` Claude skill uses, downloadable from the
studio's footer.

---

## 5. Mirror host

`gpuscale.net` is blocked on some corporate networks. The same tool, same
payloads, is served at:

```
https://mahmoudyassine.github.io/gpuscale/#p=t:...
```

Offering both links is polite when you do not know the user's network.

---

## 6. Machine-readable index

- Format and rules (this file): <https://gpuscale.net/docs/URL-FORMAT.md>
- Every valid name: <https://gpuscale.net/skill-link/references/libraries.md>
- Full JSON schema: <https://gpuscale.net/skill-link/references/payload-schema.md>
- Engine formulas and conventions: <https://gpuscale.net/docs/DATA.md>
- Preset evidence: <https://gpuscale.net/docs/PRACTICES.md>
- Agent summary of the whole tool: <https://gpuscale.net/llms.txt>
