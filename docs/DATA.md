# Maintaining the data library


> Prose version of much of this file, with diagrams and worked examples:
> [the manual](https://gpuscale.net/manual.html).

Building a link programmatically or from an AI assistant is a separate document:
[URL-FORMAT.md](URL-FORMAT.md) covers the readable `#p=t:` form, the encoded
`j:` / `z:` forms and the rules for getting a link right.

All of the studio's knowledge lives in five small files under `data/`
(`models.js`, `gpus.js`, `quants.js`, `usecases.js`, `support.js`). Each file
assigns one array onto `window.GPUSCALE_DATA`, one entry per line, so adding an
entry is a one-line edit and diffs stay readable. After editing, refresh the
page: counts, dropdowns and badges update automatically.

When you change anything here:

1. Bump `library` and `updated` in the `meta` line at the top of `data/models.js`
   (that line also carries `engine`, which tracks `ENGINE_VERSION` in `app.js`).
2. Rebuild every generated artifact:

   ```bash
   python3 tools/build_single_file.py    # dist/gpuscale_standalone.html
   python3 tools/build_skill.py          # skill/sizing.mjs (engine + solver, verbatim)
   python3 tools/build_skill_link.py     # gpuscale-link.skill + skill-link/ tables
   ```

3. If you touched `data/usecases.js`, run `python3 tools/check_presets.py`. It
   enforces the self-consistency rule and the field ranges, and prints advisory
   warnings when a target leaves the band its class implies. The evidence behind
   those bands is in [PRACTICES.md](PRACTICES.md).

## Model schema (`data/models.js`)

| Field | Meaning |
|---|---|
| `name` | Display name. Include size and `(MoE)` where relevant. |
| `params` | Total parameters in billions. Everything that must sit in VRAM (MoE: all experts). |
| `active` | Parameters used per token, in billions. Drives prefill compute and decode weight reads. Equals `params` for dense models. |
| `hidden` | Hidden dimension, used for the activation-workspace estimate. |
| `layers` | Transformer block count. |
| `kvHeads`, `headDim` | **Effective** KV geometry. See the convention below. |
| `ctx` | Maximum context length in tokens. |
| `experts`, `activeExperts` | MoE expert counts, or `null` for dense. Informational. |
| `arch` | Architecture string. Substrings drive badges: `MoE`, `MLA/DSA/CSA/MSA` (compressed KV), `SSM/Mamba` (hybrid), `MHA` (heavy-KV warning), `est. cfg` (amber estimate badge). |
| `dev` | Developer. Groups the dropdown; substrings `UAE/KSA/Qatar/G42/TII/SDAIA/QCRI/MBZUAI` add the GCC-sovereign badge. |
| `url` | Reference link (model card or announcement). |

### The effective-KV convention

The engine computes KV per token as `2 x layers x kvHeads x headDim x bytes`.
For plain GQA models, use the real config values. For everything else, encode an
*effective* geometry that makes the formula land on the true cache cost:

- **MLA** (DeepSeek/Kimi lineage): the compressed latent (e.g. 512+64=576 dims)
  is stored once, not as separate K and V. Since the formula multiplies by 2,
  encode `kvHeads: 1, headDim: 288`.
- **Hybrid attention** (linear/SSM layers hold constant state, only some layers
  keep per-token KV): scale `headDim` by the full-attention layer fraction.
  Example: 48 layers with 12 full-attention layers of `kvHeads 2, headDim 256`
  becomes `kvHeads: 2, headDim: 64` (256 x 12/48).
- **Sliding-window mixes** (added in engine v25, current): do NOT flatten these into one
  scalar. Give the entry `kvGlobal` (how many layers use full attention) and
  `kvWin` (the window in tokens); the engine then computes the per-token cost
  as `kvGlobal_layers + window_layers x min(1, kvWin/sequence)`, which is
  exact at every context instead of only at the one it was calibrated for.
  Optional companions: `kvgHeads` / `kvgDim` when the global layers have their
  own geometry, `kvgKeyOnly:true` when values are the keys (Gemma 4 global
  layers ship no `v_proj`), and `kvLayers` when later layers reuse an earlier
  layer's cache (Gemma 4 E-models share KV across their tail).
  A single scalar was the old convention and it was wrong in both directions:
  calibrated long it understated 4K voice traffic, calibrated short it
  overstated 128K documents.

### Estimated configs

When a vendor has not published internals (API-only or pre-weight-release
models), estimate from family lineage or class norms and put `est. cfg` in
`arch` so the UI badges it amber. Replace with real values when the config ships.

## GPU schema (`data/gpus.js`)

| Field | Meaning |
|---|---|
| `name` | Display name with VRAM size. |
| `cls` | Dropdown group. Put `2026` in it to trigger the pre-launch-estimate badge. |
| `vram` | Memory in GB. |
| `bw` | Memory bandwidth in TB/s. Sets decode speed. |
| `tflops` | **Dense FP16 Tensor-Core** TFLOPS. Halve any "with sparsity" marketing number. Sets prefill speed. |
| `watts` | TDP. Powers the topology kW roll-up. |
| `arch`, `mem`, `link` | Informational: architecture, memory type, interconnect. |

## Quant tiers (`data/quants.js`)

`name`, `bits`, `bytes` per parameter, plus informational `quality`, `speed`,
`use`, `hw` notes. Keep `bytes` consistent with real on-disk sizes for GGUF
tiers (K-quants carry block scales, so bytes can exceed `bits/8`). KV-cache
quant options are fixed in `app.js` (`KV_QUANTS`).

## Workload presets (`data/usecases.js`)

| Field | Meaning |
|---|---|
| `name` | Display name in the preset dropdown. |
| `resident` | Tokens actually held per request: prompt + retained history + tool traces. NOT the model's max context. |
| `visibleOut` | Tokens the user sees per response. |
| `reasoning` | `None` / `Light reasoning` (2,000) / `Heavy reasoning` (8,000), or `Custom` when `reasonTok` is present. |
| `reasonTok` | Exact hidden-thinking budget per request, applied through the Custom class. Overrides `reasoning`. |
| `ttftTarget` | First-token target in ms. `0` disables the check. |
| `tpsTarget` | Per-user streaming speed target in tok/s. `0` disables. This is per user, never aggregate. |
| `p95Target` | End-to-end P95 target in seconds. `0` disables. |
| `session` | Optional `{min, tokMin, base}`. Describes the preset's resident figure as a conversation: `base` tokens of system prompt and tools, plus `tokMin` tokens for every minute of a `min`-minute call. **`base + tokMin x min` must reproduce `resident` to within 2%**, enforced by `check_presets.py`: the two numbers are two views of the same assumption and may not disagree. It prefills the conversation-length estimator; it never changes `resident` on its own. Required in spirit for any preset with `policy: "all"`, which is warned about otherwise. |
| `cachePct` | Optional, 0-95. Share of `resident` that is byte-identical on every call, so a server with automatic prefix caching prefills it once and holds it once per replica. **Every shipped preset leaves this at 0** and sizes for a full prefill: a hit rate is a fact about the serving stack, not about the workload class. `check_presets.py` warns on any non-zero default. |
| `policy` | `"all"` pins per-session KV for the whole session. Only for paths where an idle-turn eviction would break the latency budget. |
| `supports` | Kind keys that auto-attach: `embed`, `rerank`, `asr`, `tts`, `ocr`, `guard`. |
| `traffic` | Users-to-concurrency shape. See the `traffic` section below. |
| `note` | One line shown under the dropdown. |

A preset only prefills fields; users edit everything afterwards. A value of `0`
leaves the corresponding field untouched, and `0` SLO targets disable those
checks.

**Every field describes ONE model call.** An agent that makes forty tool calls
per task is forty of these requests; `traffic` is what converts tasks into
simultaneous calls. Do not fold a whole task's token budget into `visibleOut`.

Targets must satisfy `p95Target >= 1.3 x (ttftTarget/1000 + (reasonTok +
visibleOut) / tpsTarget)`, so a preset can never demand a P95 its own targets
make impossible. `tools/check_presets.py` enforces it; [PRACTICES.md](PRACTICES.md)
records the published conventions each preset is calibrated against and the
2026 review of all of them.

## Adding an entry: worked examples

A dense GQA model is a straight copy of the config values:

```js
{"name":"MyModel 34B","params":34.0,"active":34.0,"hidden":7168,"layers":60,
 "kvHeads":8,"headDim":128,"ctx":131072,"experts":null,"activeExperts":null,
 "arch":"Dense (GQA)","dev":"MyLab","url":"https://example.com/model-card"},
```

A GPU needs the dense (not sparsity) tensor TFLOPS:

```js
{"name":"MyGPU 96GB","vram":96.0,"bw":4.0,"tflops":900.0,"mem":"HBM3e",
 "arch":"MyArch","watts":700,"cls":"Data Center","link":"PCIe 5.0",
 "url":"https://example.com/datasheet"},
```

## data/support.js · supporting models

`window.GPUSCALE_DATA.support = {kinds, models}`. Each model:
`{kind, name, params, vram, cap, default?, note, url}` where `vram` is GB one
serving instance needs and `cap` is the concurrent calls one instance absorbs
(a planning allowance from published benchmarks, not a guarantee). Instances
per kind+model = `ceil(summed peak demand / cap)`, shared across use cases.
Use-case presets in `data/usecases.js` carry a `supports` array of kind keys
that auto-attach when the preset is chosen.

## data/gpus.js · `part` field (partitioning)

`part:{kind, max, min}`. `kind`: `mig` (NVIDIA MIG), `cpx` (AMD compute
partitions), `frac` (time-slice/MPS, no isolation), `whole` (no partitioning,
Gaudi). `max` = partitions per GPU, `min` = smallest partition in GB.

Slice model (added in engine v24, current): only real profile geometries exist. On 7-slice MIG
parts the profiles are 1g/2g/3g/4g with memory and bandwidth from the
memory-slice map (1g:1, 2g:2, 3g:4, 4g:4 of 8 memory slices) at 0.93
delivered bandwidth; on 4-slice parts only 1g/2g (1 or 2 of 4 memory
slices); `cpx` parts partition uniformly, so only the single-partition
profile (`min` GB, 1/max compute and bandwidth) is modeled. A slice is a
synthetic smaller GPU: compute scales with compute slices/max, per-instance
overhead is 1.4 GB instead of the whole-GPU multi-GPU term. TP1 pools whose
copy fits a slice can be auto-placed on slices (multi-use-case projects
only); slices from different pools and support models pack whole onto
shared physical GPUs, and the sliced-vs-dedicated decision prices real
first-fit bins, never fractional GPUs. Support instances land on the
smallest real profile whose memory holds them; smaller models co-host
`floor(profileGB/vram)` instances per slice.

## Pools own cards, not nodes (5.21)

Auto-size allocates an exact GPU count per pool and stores it as `cards` on the
use case; pools then pack onto shared nodes. Rounding each pool up to a whole
node used to buy GPUs nobody asked for. Editing workers, TP or GPUs-per-worker
by hand clears `cards` and returns that pool to whole-node sizing.

## JSON schema gpuscale.net/5

A v5 file is a v4 file plus a `project` block: `{active, usecases:[{id, name,
isolate, supports, config, snapshot}], results}`. The top-level `config` and
`snapshot` still describe the active use case in v4 shape, so v4-era
importers read v5 files. Import accepts v3, v4 and v5.

## data/usecases.js · `traffic` field (v27)

Per-preset users-to-concurrency shape, grounded in published production data
(Microsoft Copilot Usage Report, GitHub Copilot telemetry, contact-center
Erlang math, I-GUIDE iterative-RAG paper, SWE-agent, voice-platform
concurrency docs): `traffic:{turns, calls, durS, burst, pct}` where
concurrent calls = users x turns x calls x durS / 3600 x burst (durS 0 =
model-derived latency), or `traffic:{direct:1}` for workloads where the
users figure IS the concurrency (voice calls, batch queue depth). `pct` is
the display note. The estimator drawer edits these per card; a directly
typed concurrency sets `concManual` and stops the derivation.

## data/usecases.js · SLO targets, `reasonTok`, `policy` (v28)

SLO targets (ttftTarget ms, tpsTarget tok/s, p95Target s) follow production
conventions (NVIDIA NIM/GenAI-Perf profiles, vLLM SLO-triage guides, Azure
OpenAI latency guidance, voice-agent latency literature) and are numerically
self-consistent with the engine's latency model: p95Target >= 1.3 x
(ttft + (reasoning + visibleOut) / tps) with margin, so a preset can never
demand a p95 its own TTFT/TPS targets make impossible. tpsTarget reflects
per-user streaming needs (20 tok/s reading pace for chat, 40-60 for
skim/agent flows), not batch throughput. Optional per-preset fields:
`reasonTok` overrides the reasoning-class token budget through the Custom
class (per-request budgets, research-grounded in v29: Advanced RAG 800,
Document Q&A 500, code agent 1500 per tool step, clinical assistant 1000,
deep research 2000 per call); `policy:"all"` pins per-session KV in VRAM for the whole
session, used only where an idle-turn eviction would break the latency
budget (real-time voice, contact-center agent assist). v28 also adds five
presets: medical imaging reports, clinical knowledge assistant, real-time
video analytics, translation/localization, contact-center agent assist.

## Engine version history

The current engine is **v27**. `ENGINE_VERSION` in `assets/app.js` and the
`engine` field in `data/models.js` meta must always agree with it.

| Engine | Change |
|---|---|
| v23 | Per-replica weight and activation accounting (the workbook v22 model). |
| v24 | `multiGb` input: per-extra-GPU overhead becomes a parameter (15 GB default, 1.4 for MIG slices). |
| v25 | Sliding-window KV: `kvGlobal` / `kvWin` (+ `kvgHeads`, `kvgDim`, `kvgKeyOnly`, `kvLayers`) make the per-token cost exact at every context. |
| v26 | Multi-GPU overhead moves from the pool to the replica: `replicas x (TP-1) x movh`. |
| v27 | Prefix caching: `cachePct` splits the sequence into a shared prefix prefilled once and held once per replica, and a unique remainder charged per call. At `cachePct = 0` the engine is byte-identical to v26. |

## Engine v27: prefix caching

Every serious serving stack computes a repeated prefix once (vLLM, SGLang and
TensorRT-LLM all ship automatic prefix caching), so charging a full prefill on
every call over-sizes exactly the workloads whose first-token targets are
hardest to meet. `cachePct` (state) / `inCache` (field, 0-95%) / `sharedPrefixPct`
(JSON) says what share of `resident` is byte-identical every time:

```
cached     = floor(resident x clamp(cachePct, 0, 0.95))
unique     = max(0, effSeq - cached)          effSeq = resident + reasoning (if it extends KV)
prefill    = max(0, resident - cached)
TTFT       = 2 x prefill x active / (TFLOPS x TP x MFU)
KV total   = calls x unique x KV/token + replicas x cached x KV/token
```

Three properties are deliberate:

- **Decode is not discounted.** `tps` still divides by the full `effSeq`. A
  cached prefix saves the prefill FLOPs and one copy of the KV, but every call
  still re-reads its whole context from HBM on every generated token unless the
  kernel batches shared pages, which not every stack does. Discounting decode
  would make the tool optimistic about the number that sizes the fleet.
- **The shared block is per replica, not per fleet.** Each replica holds its own
  copy, hence `replicas x cached x KV/token`. A pool with more replicas than
  concurrent calls therefore saves less, which is correct.
- **The default is 0.** Nothing assumes a hit rate. The SLO optimiser offers
  30% and 60% as priced buttons and states that the user should only accept them
  if their stack has prefix caching enabled.

The solver uses the same split: TTFT widening prices `prefill`, not `resident`,
and the TP fit heuristic reserves `floor(resident x cachePct) x KV/token` for the
shared block before sizing the per-call KV. Both XLSX builders mirror the chain
(`cachedTok`, `uniqueSeq`, `kvShared`, `kvTotal`, `ttft`) as live formulas.

## Engine v26: multi-GPU overhead

`multi = replicas x (TP - 1) x movh` (default movh 15 GB; 1.4 GB for MIG-sliced
instances). NCCL buffers belong to one tensor-parallel communicator, so
independent replicas do not pay for each other: a pool of 40 TP1 replicas
carries zero multi-GPU overhead, where the previous rule (engine v25 and
earlier) charged it 585 GB. Both XLSX
builders mirror the formula from the `movh` input row.

## Card allocation and its stamp (5.21.1+)

An exact per-pool GPU count is an auto-size OUTPUT, valid only for the inputs it
was solved against, so it is stamped: `cardsKey(u, hw)` hashes the model (or the
custom geometry), both quantizations, the GPU, GPUs per worker, TP, KV policy,
KV extension, concurrency, resident, the shared cached prefix, output and
reasoning tokens, all three SLO targets, and the auto-size memory target. `ucState` uses `u.cards` only while
that stamp matches; anything else returns the pool to whole-node sizing rather
than quietly keeping an allocation that no longer fits.

The stamp belongs to the POOL, not to one member: `poolState` requires every
member's stamp to be fresh. Reading only the first member meant the same edit
gave two different fleets depending on which card you typed in.

## Supporting models: library entry or custom geometry

A use case's `supports` array holds one entry per attached kind. An entry either names a library model:

```js
{"kind":"asr", "model":"Whisper large-v3-turbo", "on":true}
```

or carries its own geometry, which wins over `model`:

```js
{"kind":"asr", "model":"Whisper large-v3-turbo", "on":true,
 "custom":{"name":"House ASR", "params":0.8, "vram":24, "cap":3}}
```

`vram` is gigabytes per running instance and `cap` is how many concurrent streams or queries one
instance serves; those two numbers are all `allocSupports` reads, so a model with no published figures
is still sizeable. `model` is retained alongside `custom` so that clearing the custom entry falls back
to a real library choice rather than to nothing. Resolution goes through `supSpec(sp)`, never
`SUP_MODEL` directly, and the custom numbers are part of the project's solve signature so a changed
VRAM figure invalidates the memoised fleet.

## Whole-GPU co-residency (5.21)

Separate from MIG slicing: several pools can share one physical card the way
vLLM memory fractions or Triton multi-model do. `coPack` merges replicas onto a
card only while all of these hold, and records which one refused a merge:

- **Memory.** The sum of per-GPU footprints stays under the auto-size memory
  target.
- **Decode duty.** A pool that reaches `tps` alone but only owes `sloTps`
  consumes `sloTps/tps` of the card; the tenants' fractions must sum under 0.95.
- **First token.** Sharing stretches every tenant's prefill by roughly
  `1/(1 - what the neighbours take)`. Every tenant, incoming included, must
  still meet its TTFT and its P95 at that inflated prefill.
- **No pool with no speed target** ever shares, because there is no guaranteed
  share to hold it to, and no two replicas of one pool land on one card.

## The SLO optimiser (5.22+)

Inverting the same physics: at the bandwidth-limited operating point a card
re-reads `gpuBw x ic x mbu / target_tps` GB per token, so the speed target sizes
the fleet. `sloOptScan` proposes the targets that would fill the card, bounded
per use case by `sloTpsFloor` (its workload class) and by its own P95 promise,
then prices every proposal by re-solving the whole project with `sloPrice`. A
suggestion is only shown when that re-solve is strictly cheaper.

Since 5.24 the optimiser also treats the P95 as a lever in its own right. When a
use case's P95 implies a higher per-user speed than its `tpsTarget` does
(`gen / (sloP95/1.3 - (ttft+ovh)/1000) > sloTps`), lowering the speed target
cannot shrink anything and the P95 is the only promise with hardware behind it.

## Solver invariants worth knowing before editing

- A pool owns **cards**, not whole nodes; nodes are packed from cards.
- The tensor-parallel sweep runs from the fitting width up to `perW` for every
  pool that needs more than one replica, and the cheapest plan meeting every
  member's targets wins. TTFT may widen past `perW` (it is priced by the
  interconnect efficiency); speed alone may not.
- The replica count a speed target needs is closed form, not a search:
  `batchPerRep = (bwEff/T - activeParams x bytesW) / (effSeq x kvTok)` and
  `reps = ceil(concurrent / batchPerRep)`.
- Growth that fixes no target is given back, and a plan may never report success
  while missing a target it claims to meet.
- Every re-solve must hand the solver a real card: a sliced pool carries the
  slice as its hardware, so `poolSolveState()` restores the physical GPU first.
