<p align="center"><img src="assets/logo-robot.svg" alt="GPUscale.net" width="420"></p>

# GPUscale.net — LLM Capacity & Dimensioning Studio

Open source · MIT · https://github.com/mahmoudyassine/gpu-scale-tool

A self-hosted, dependency-free web studio for sizing LLM deployments: pick a model,
precision, workload and hardware; get memory fit, latency, throughput, SLO compliance
and a resilient worker topology (N / N+1 / N+N / DR / N+N+DR). Exports JSON configs,
a live-formula Excel template, and a printable PDF report.

Everything is static — no backend, no build step, no external dependencies beyond
Google Fonts (which degrades gracefully offline).

## Directory layout

```
index.html                  page markup only — no data, no styles, no logic
assets/
  styles.css                all styling (light + dark themes via CSS variables)
  app.js                    all logic: engine, charts, topology, exports
  logo.svg / logo-dark.svg  full lockups (vector outlines — no font needed)
  mark.svg                  square mark only
  favicon.svg / *.png       favicons + apple-touch-icon + icon-512
  logo-preview.png          raster lockup for decks and sharing
data/
  models.js                 model library        ← edit these to maintain
  gpus.js                   GPU library          ← the tool; nothing else
  quants.js                 weight quant tiers   ← needs to change
  usecases.js               workload presets
tools/build_single_file.py  rebuilds the portable one-file version
dist/gpuscale_standalone.html  the portable one-file build (generated)
```

## Running and deploying

Open `index.html` directly (double-click works — the data files are plain scripts,
so no web server is required), or serve the folder with anything static:

```
python3 -m http.server 8080
```

The studio follows the device's light/dark appearance automatically; the header
toggle overrides it for the session. The page declares `color-scheme` so
dark-mode webviews and file previewers render it correctly instead of forcing
their own dark canvas around it.

To deploy, copy the folder contents to any static host — the root of gpuscale.net,
an S3/Blob bucket, GitHub Pages, or an internal web server. There is nothing to
compile. Note that "data out of the HTML source" is a maintainability and caching
win, not confidentiality: any browser tool ultimately ships its data to the client.

When you need a single portable file (email, air-gapped demo), use
`dist/gpuscale_standalone.html` or regenerate it after data edits:

```
python3 tools/build_single_file.py
```

### Publishing on GitHub Pages

The repo root is the site root, so Pages needs no configuration beyond enabling
it: push to `main`, then in the repository go to Settings → Pages → Source:
"Deploy from a branch" → branch `main`, folder `/ (root)`. The studio serves at
`https://mahmoudyassine.github.io/gpu-scale-tool/` within a minute. To attach
the custom domain, add `gpuscale.net` in the same Pages settings screen (GitHub
manages the CNAME file) and point the domain's DNS at GitHub Pages per their
docs; enable "Enforce HTTPS" once the certificate is issued.

## Maintaining the data

Each data file assigns one array onto `window.GPUSCALE_DATA`, one entry per line,
so additions are one-line edits and diffs stay readable. After editing, refresh the
page — the model/GPU counts, dropdowns and badges update automatically. Bump
`meta.library` and `meta.updated` at the top of `data/models.js` so the footer
reflects the new state, and rebuild the standalone if you use it.

### Model schema (`data/models.js`)

| Field | Meaning |
|---|---|
| `name` | Display name. Include size and `(MoE)` where relevant. |
| `params` | Total parameters in billions — everything that must sit in VRAM (MoE: all experts). |
| `active` | Parameters used per token, in billions. Drives prefill compute and decode weight reads. Equals `params` for dense models. |
| `hidden` | Hidden dimension — used for the activation-workspace estimate. |
| `layers` | Transformer block count. |
| `kvHeads`, `headDim` | **Effective** KV geometry — see the convention below. |
| `ctx` | Maximum context length in tokens. |
| `experts`, `activeExperts` | MoE expert counts, or `null` for dense. Informational. |
| `arch` | Architecture string. Substrings drive badges: `MoE`, `MLA/DSA/CSA/MSA` → compressed-KV, `SSM/Mamba` → hybrid, `MHA` → heavy-KV warning, `est. cfg` → amber estimate badge. |
| `dev` | Developer. Groups the dropdown; substrings `UAE/KSA/Qatar/G42/TII/SDAIA/QCRI/MBZUAI` add the GCC-sovereign badge. |
| `url` | Reference link (model card or announcement). |

**Effective-KV convention.** The engine computes KV per token as
`2 × layers × kvHeads × headDim × bytes`. For plain GQA models, use the real
config values. For everything else, encode an *effective* geometry that makes the
formula land on the true cache cost:

- **MLA** (DeepSeek/Kimi lineage): the compressed latent (e.g. 512+64=576 dims) is
  stored once, not as separate K and V — since the formula multiplies by 2, encode
  `kvHeads=1, headDim=288`.
- **Hybrid attention** (linear/SSM layers hold constant state, only some layers
  keep per-token KV): scale `headDim` by the full-attention layer fraction.
  Example — 80 layers, ~¼ full-attention MLA: `headDim = 288 × 20/80 = 72`.
- **Sliding-window mixes**: encode the long-context per-token cost (global-layer
  share), and note the pattern in `arch`.

**Estimated configs.** When a vendor hasn't published internals (API-only or
pre-weight-release models), estimate from family lineage or class norms, and put
`est. cfg` in `arch` so the UI badges it amber. Replace with real values when the
config ships.

### GPU schema (`data/gpus.js`)

`name`, `cls` (dropdown group — put `2026` in it to trigger the pre-launch-estimate
badge), `vram` (GB), `bw` (TB/s), `tflops` (**dense FP16 Tensor-Core** — halve any
"with sparsity" marketing number), `watts` (TDP, powers the topology kW roll-up),
`arch`, `mem`, `link` (informational).

### Quant tiers (`data/quants.js`) and presets (`data/usecases.js`)

Quants: `name`, `bytes` per parameter, optional `use` note. KV-cache quant options
are fixed in `app.js` (`KV_QUANTS`). Presets: `name`, `resident`, `reasoning`
(`None`/`Light reasoning`/`Heavy reasoning`), `visibleOut`, `ttftTarget`,
`tpsTarget`, `p95Target` — a preset only prefills fields; users can edit everything
afterwards.

## Engine notes

The compute engine lives in `assets/app.js` between `/*ENGINE-START*/` and
`/*ENGINE-END*/` and mirrors the Excel workbook engine v22 exactly (verified by
automated parity tests against hand-checked workbook scenarios). Core relations:

```
weights   = params × bytes/weight
KV/token  = 2 × layers × kvHeads_eff × headDim_eff × bytes/KV
TPS/user  = BW×TP×IC×MBU / (active×bytes + batch/replica × seq_eff × KV/token)
TTFT      = 2 × seq × active / (TFLOPS×TP×MFU)
```

Performance and fit are sized on the N load-bearing workers; the resilience model
(N+1 / N+N / DR / N+N+DR) adds procurement — workers, GPUs, kW — not throughput.
All figures are peak estimates; production typically achieves 70–90%. Validate with
vLLM bench / GenAI-Perf before commitments.

## Exports

- **JSON** — schema `gpuscale.net/3`; round-trips through Import (older Inferra
  and v1/v2 files import too).
- **XLS** — SpreadsheetML template with an amber editable Inputs sheet and a
  Results sheet whose cells hold live Excel formulas replicating the engine.
- **PDF** — print stylesheet report via the browser's Save-as-PDF.
- Scripting API at `window.GPUscale` (`compute`, `readState`, `serialize`,
  `applyConfig`, `buildXls`, `render`, plus the raw libraries).

## Logo

Primary mark: `mark-robot.svg` — a GPU card as a robot face (backplate brow,
I/O-bracket ear, twin-fan eyes with glowing hubs, and the PCIe edge as an
amber-toothed grin, key notch included). Lockups: `logo-robot.svg` /
`logo-robot-dark.svg`; the wordmark is converted to vector outlines (Archivo
Bold), so no font is needed anywhere. Favicons and the theme-aware header mark
use the robot. The earlier geometric chip mark remains available as an alternate
(`logo.svg`, `logo-dark.svg`, `mark.svg`) — to revert, point the favicon links
and the header `<svg class="logo-mark">` back at it. ## Palette

One accent per role, strictly:

| Role | Light | Dark |
|---|---|---|
| Brand / interactive / primary series | `#0F766E` | `#2DD4BF` |
| Secondary series (indigo) | `#4F63C2` | `#8B9CE8` |
| Editable-input accent (amber) | `#F59E0B` | `#FFC53D` |
| Alerts / overflow (red) | `#DC2626` | `#FF6B6B` |
| Neutrals | slate ramp (`#475569` → `#CBD5E1`) | slate ramp (`#5B6A8C` → `#33415E`) |

The single teal and single indigo are the only chromatic accents besides the
semantic amber/red. All tokens live at the top of `assets/styles.css`; the logo
generators use the same values.

## License

MIT — see [LICENSE](LICENSE). Contributions welcome: model/GPU library updates
are one-line edits in `data/` (see the schemas above); please keep the
effective-KV convention and flag undisclosed internals with `est. cfg`.
