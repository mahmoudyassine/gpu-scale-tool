# Maintaining the data library

All of the studio's knowledge lives in four small files under `data/`. Each file
assigns one array onto `window.GPUSCALE_DATA`, one entry per line, so adding an
entry is a one-line edit and diffs stay readable. After editing, refresh the
page: counts, dropdowns and badges update automatically.

When you change anything here:

1. Bump `library` and `updated` in the `meta` line at the top of `data/models.js`.
2. Rebuild the portable file: `python3 tools/build_single_file.py`.

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
- **Sliding-window mixes**: encode the long-context per-token cost (the
  global-layer share) and note the pattern in `arch`.

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

`name`, `resident`, `reasoning` (`None` / `Light reasoning` / `Heavy reasoning`),
`visibleOut`, `ttftTarget`, `tpsTarget`, `p95Target`, `note`. A preset only
prefills fields; users can edit everything afterwards. A value of `0` leaves the
corresponding field untouched and `0` SLO targets disable those checks.

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

Slice model (engine v24): only real profile geometries exist. On 7-slice MIG
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
class (e.g. Advanced RAG 250 tool-plan tokens, code agent 3000, deep
research 20000); `policy:"all"` pins per-session KV in VRAM for the whole
session, used only where an idle-turn eviction would break the latency
budget (real-time voice, contact-center agent assist). v28 also adds five
presets: medical imaging reports, clinical knowledge assistant, real-time
video analytics, translation/localization, contact-center agent assist.
