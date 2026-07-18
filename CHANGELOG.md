# Changelog

## Studio 4.8.1 (2026-07-18)

- The studio now explains structural misfits: when a single TP replica cannot
  hold one copy of the model, the verdict, insights and a new top-ranked
  recommendation say so explicitly, with the minimum TP that would fit, the
  largest weight quant that fits at the current TP, and a note that adding
  workers only adds more weight copies (and that pipeline parallelism is not
  modeled).
- "Add workers" is no longer suggested when it cannot help; queueing guidance
  is hidden while the configuration does not fit; the "balanced configuration"
  insight no longer appears on non-fitting configurations.


## Studio 4.8 (2026-07-18)

- Recommendations panel: names the primary bottleneck (VRAM, prefill, decode
  bandwidth, admission or headroom) and lists concrete numbered fixes for the
  selected configuration, ranked by severity.
- Two new resilience modes: Active/Active (two live sites, 2N) and
  Active/Active with N+1 in each site (2N+2), with topology diagrams,
  procurement roll-ups and XLS support.
- Topology frames now draw up to 16 workers per site before truncating.
- Desktop layout: the input rail pins to the viewport and scrolls
  independently of the results canvas; columns are captioned (Inputs /
  Results) and input stations are numbered to guide filling order.
- Privacy made explicit: a header chip and a highlighted footer callout state
  that nothing entered is saved, uploaded or tracked.
- Footer shows the full repository URL.


## Studio 4.7 (2026-07-18) · engine v23 · library v24

Correctness release, verified by a multi-agent adversarial review.

**Engine v23**
- Multi-replica accounting fixed: total VRAM now charges weights and
  activations per data-parallel replica instead of once per fleet. Fit
  verdicts for multi-worker configurations were previously far too optimistic
  (example: 4 replicas of Llama 3.1 70B BF16 need 563 GB of weights, not 140).
- Capacity now counts serving GPUs only (replicas x TP); VRAM on idle GPUs
  that no replica can use is no longer credited.
- New insight warns when resident sequence plus reasoning exceeds the model's
  max context.
- MHA insight corrected: per-token KV was overstated 1000x (GB to MB unit slip).
- The XLS export mirrors all engine changes cell-for-cell.

**Library v24**
- Llama 3.1 405B: kvHeads corrected 16 to 8.
- Llama 4 Scout and Maverick: headDim corrected 256 to 128; Maverick hidden
  corrected 8192 to 5120.
- Qwen3-Next 80B: effective KV encoding corrected to kvHeads 2, headDim 64
  (12 of 48 full-attention layers), matching the hybrid convention.
- RTX PRO 6000 Blackwell SE: dense FP16 TFLOPS corrected 500 to 250 (the 500
  figure was the sparsity number).
- GGUF tiers: Q5_K_S corrected to 5.5 bits / 0.69 B per param, Q3_K_S bits
  field aligned with its bytes value; Gemma 3 arch labels note SWA 5:1.

**UI and robustness**
- Topology diagram: mirror/standby/DR frames now truncate past 8 cards like
  active frames, and the "+N more" count is always correct.
- All slider-backed inputs clamp through their field config: typed
  out-of-range or cleared values can no longer make the engine, the readout
  and the visible input disagree (previously clearing MFU produced NaN).
- The Custom preset no longer writes zeros into resident/output fields.
- Little's-law Apply is floored at 1 concurrent call.
- Importing a config with a saved theme locks the theme against later OS
  scheme changes; printing from dark mode switches to light for the snapshot
  and restores afterwards.

**Design and publishing**
- Header: version chip linking to releases, grouped Import/JSON/XLS/PDF
  toolbar, GitHub link.
- Footer: three-column layout with brand, project links and studio internals;
  compact print variant.
- Social metadata: canonical URL, Open Graph and Twitter cards with a
  dedicated 1200x630 share image; web manifest, branded 404 page, robots.txt.
- Build tool hardened: callable re.sub replacement (backslash-safe) and
  fail-loud checks that every inline step matched.
- README rewritten around a live demo link, screenshot, feature summary,
  worked example and a how-it-works diagram; deep schema docs moved to
  docs/DATA.md; Cloudflare DNS import file at docs/dns-cloudflare.txt.

## Studio 4.6 (2026-07-18)
- Icons inside the graphics: site/shield/globe glyphs on topology frames, sync
  icon on replication links, per-frame power (kW) chips with bolt icon.
- Chart annotations: axis captions on both charts, memory-limit value on the
  guide line, aggregate-throughput operating point, tok/s value on the context
  marker; topology note shows per-GPU utilization.
- Footer states the open-source status and links the repo.

## Studio 4.5 (2026-07-18)
- Section icon system: 16 hand-drawn stroke icons (currentColor, both themes)
  across input stations, readout panels and KPI cards.
- Open-sourced: MIT license, .gitignore, .nojekyll, README header and GitHub
  Pages publishing guide.

## Studio 4.4 (2026-07-18)
- Dark-mode correctness: page declares color-scheme (meta + CSS), paints the
  html element, ships scheme-aware theme-color metas, and follows the OS
  appearance on load (manual toggle overrides; live-follows OS changes until
  toggled). Fixes mixed light-panels-on-dark-canvas rendering in dark-mode
  webviews and file previews.

## Studio 4.3 (2026-07-18)
- Unified palette: exactly one teal (#0F766E / #2DD4BF) and one indigo
  (#4F63C2 / #8B9CE8) plus semantic amber/red and slate neutrals across
  styles, charts, topology, badges, XLS and both logo suites.
- Footer: GitHub link.

## Studio 4.2 (2026-07-18)
- New primary logo: robot-head mark derived from a GPU card illustration.
  Twin-fan eyes, glowing hubs, PCIe gold-finger grin with key-notch gap.
  Favicons, rasters and the theme-aware header mark updated; chip mark kept
  as an alternate.

## Library v23 · Studio 4.1 (2026-07-18)
- Restructured into a maintainable site pack: markup, styles, logic and data
  fully separated; data lives in data/*.js, one entry per line.
- New brand identity: chip-and-rising-bars mark, vector-outline wordmark,
  full favicon set; theme-aware logo in the header.
- Library grew 22 models to 94: Kimi K3, Arabic/GCC set (Jais-2, Fanar-2,
  ALLaM, Falcon-H1-Arabic, SILMA), Cohere set (Command A+, R+, R7B, Aya),
  Mistral set (Saba, Magistral, Large 2, Ministral, Small 4).
- tools/build_single_file.py regenerates the portable one-file build.

## Studio 4.0 (2026-07-18)
- Rebranded to GPUscale.net; N+N+DR active/active resilience mode (4N);
  rebuilt worker/GPU-utilization topology infographic; Safari SVG
  height-collapse fix; cleaner headings.

## Studio 3.0 and earlier (2026-07-18)
- Worker x GPUs-per-worker hardware model with N/N+1/N+N/DR topologies,
  PDF and live-formula XLS export, mobile pass, light and dark themes,
  engine v22 parity with the Excel workbook.
