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
