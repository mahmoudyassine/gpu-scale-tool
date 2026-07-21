# Changelog

## Studio 5.4 (2026-07-21)

One report for the whole project, and demand grounded in research.

- The results canvas is now selection-independent: switching the edited
  use case never changes the report. Memory ledger shows one bar per pool,
  KPI tiles show project totals and demand-weighted averages, SLO
  compliance rolls up per use case, charts draw one line per pool, latency
  anatomy shows one row per use case, and recommendations are prefixed by
  pool. Exports (PDF, Excel) are stable no matter which card was selected.
- "In plain words" became "Summary": bullet points with icons covering
  every use case (active users, derived concurrent calls and the share in
  flight, model, SLO status), every deployment (why that TP, replicas,
  batch, memory use, spares), supporting models, resilience, and findings.
- Users-to-concurrency ratios are now researched per use-case type and
  seeded by the preset: enterprise copilot ~3% of active users in flight,
  chatbot ~8%, advanced RAG ~15%, code agents ~40%, code completion ~2.5%,
  voice and batch 1:1 (sources: Microsoft Copilot usage telemetry, GitHub
  Copilot latency data, contact-center Erlang math, production RAG and
  agent papers). Typing a concurrency directly marks it manual and stops
  the derivation; the field under Active users says which mode is live.
- Importing a JSON now auto-sizes the whole deployment for the file's
  demand, and re-seeds never-customized traffic shapes from the presets.
- Fixed an import bug where applying a file's theme re-rendered mid-import
  and overwrote the active card's inputs with the last card's values.
- The Auto-size button is now "Auto-size deployment": it derives
  concurrency from active users first, then solves TP, nodes and batch per
  pool, places supporting models and spares.
- Fleet map legend now explains the node outline (selected use case,
  screen only) and the alternating replica shades; site headers and result
  cards carry icons; the print verdict is stacked and clean.


## Studio 5.3 (2026-07-21)

Demand-honest sizing: no more replicas nobody asked for.

- Multi-use-case pools now keep only the replicas the peak load needs;
  the rest of the pool's GPUs become spares (dashed in the fleet map,
  reused for supporting models) instead of extra model copies. Nine
  concurrent calls at batch 16 now mean one replica, not eight. Single
  use case keeps the classic v4 behavior and instead warns loudly on
  structural overprovision (capacity 4x beyond peak).
- Active users at peak is now the primary demand input in BOTH modes.
  Little's law derives concurrent LLM calls live using the estimator's
  traffic shape (interactions per hour, calls per turn, burst, call
  duration), shown under the field and still directly editable.
- Auto-size fixes: tensor parallel is chosen so one copy plus the per-GPU
  overhead fits the memory target (previously a memory-tight model at TP1
  made the worker loop silently run to 64 workers and report them as the
  answer); the solver now fails with a clear reason instead of returning
  a fleet that never fit. Its note also states what Auto-size does and
  does not decide.
- A new use case that forms its own pool is auto-sized on creation, so
  stale topology values no longer ride along from the card it was cloned
  from.
- Normal mode regained the critical controls: concurrent calls, SLO
  targets, GPUs per node and the Auto-size button (auto-run stays).


## Studio 5.2.1 (2026-07-21)

Header redesign.

- One compact brand row with a short tagline ("Size self-hosted LLM fleets
  in your browser"); the long feature sentence is gone.
- The Normal/Advanced toggle is now two icon buttons (one slider for
  Normal, three for Advanced) with tooltips, styled like every other
  toolbar button.
- All actions sit in a single aligned toolbar row: mode toggle, then
  Import/JSON/XLS/PDF, then theme/GitHub/reset as one grouped cluster;
  the project-name field has its own row on small screens.
- The privacy chip hides on phones (the full statement stays in the
  footer); consistent control heights and spacing across all widths.


## Studio 5.2 (2026-07-21)

Color-coded use cases and a tighter flow.

- Rail reordered: Use cases, then Workload, Model and Precision (the three
  stations that edit the selected card), then Hardware. The Workload station
  now sits right under the cards, where presets and demand are chosen first.
- Every use case has its own color, carried everywhere: its card, the top
  border and context chip of the Workload/Model/Precision stations (so it is
  always clear which card the editor edits), its result card, and its pool's
  GPUs in the fleet map. The active pool's map outline uses the same color.
  Hardware is neutral and marked "project-wide · all use cases".
- The use-case palette avoids the brand teal, warning amber and error red,
  in both themes; supporting models keep a separate palette and draw as
  hatched slices, so a GPU square can never be misread between a pool fill
  and a support slice.
- Fleet map: all node cards are one fixed size with centered GPU grids;
  node labels show the shortest distinguishing model tag (K2.5 vs K3); the
  legend moved below the map and explains fill height, replica shading and
  hatching; the legend and map are followed by the placement note.
- Mobile: the project-name field takes its own row, numeric inputs no
  longer clip five-digit values, and card action buttons grow on touch
  screens. Removing a use case now offers Undo in the toast.
- Print: the fleet panel paginates instead of leaving a blank page, page
  backgrounds are white to the end, hover-only hints are dropped from
  paper, section captions stay with their panels, and SLO targets carry
  units in the per-use-case cards.


## Studio 5.1 (2026-07-21)

One topology view, and honest spare counts.

- The deployment topology and the fleet map are now the same panel: site
  frames from the resilience pattern (production site, Site A/B, DR site)
  contain the per-GPU fleet map. Every GPU square fills to its pool's
  memory use, support slices draw as mosaics, idle nodes are dashed, and
  the economics strip (guaranteed vs normal-day vs idle vs cost) is
  computed for the whole project.
- Additive spares (N+1, N+2, the A/A split spares) are procured once per
  project, not once per pool: hardware is uniform, so one idle node covers
  a failure in any pool. Three pools on N+2 now procure 2 spare nodes, not
  6. Mirrors, DR sites and second active sites still scale per pool, since
  they must hold each pool's own model copies.
- Per-site spares (A/A +1/site, A/A N+1) are labeled as site-local: each
  covers failures in its own site. Second active/active sites are described
  as live serving capacity, never as idle spares.
- Support nodes are excluded from the resilience cost ratio, included in
  every procurement total (verdict, story, mini-bar, print, JSON, Excel),
  and the Excel Results sheet now says explicitly which rows are pool-scoped
  with a fleet-total row alongside.
- Assorted honesty fixes from a 23-agent adversarial review: node labels
  no longer collide (RS- spares vs SP- support nodes), partially filled
  support nodes pad to the full node, mirror nodes render dashed, the
  legend only lists what is actually drawn, bare N no longer claims a
  covered failure, and the screen-reader text form uses plain role names.


## Studio 5.0 (2026-07-21)

Major release: scenarios become projects, and a project can hold several
use cases served by one fleet.

- Use cases: the new first station holds cards (add, duplicate, rename,
  remove, up to any mix). Each card carries its own workload shape,
  concurrency, SLOs, model and precision; the stations below edit the
  selected card.
- Pooling: use cases that pick the same model, weight and KV precision and
  KV policy are served by one shared pooled deployment, sized for the
  combined load. Cards show a "pooled" badge; per-use-case latency
  envelopes are evaluated at the pool's batch.
- Supporting models attach automatically per use case type: embeddings and
  reranker for RAG, ASR and TTS for voice, OCR for document work, a guard
  model for public chat. Chips on each card announce them; each is
  removable, and Advanced mode can swap the model (17-model library with
  honest per-instance footprints and capacity allowances).
- GPU partitioning: supporting models land on MIG slices (per-GPU profile
  matrix for A100 through GB300), AMD CPX partitions, fractional sharing
  (with a no-isolation note) or whole cards on Gaudi, packed by VRAM.
  Spare pool GPUs are used before new hardware is added.
- Fleet map: every node and GPU drawn with its assignment, replica shading,
  MIG mosaics for support slices, dashed standby nodes from the resilience
  pattern, a legend, tooltips, and a text form for screen readers.
- Two modes: Normal shows the minimum (people at peak instead of
  concurrency via a silent Little's-law derivation, three plain resilience
  choices, auto-size runs by itself); Advanced keeps every control.
- Mobile: a sticky mini-results bar (GPUs, kW, verdict) stays visible while
  editing; tap it to jump to results.
- Exports: JSON schema v5 with the full use-case list plus per-pool and
  support results (v3 and v4 files still import; the top-level config stays
  v4-shaped so old importers read v5 files); the Excel workbook gains a
  Project sheet with use cases, pools, supporting placements and the node
  map; print output leads with the project fleet.


## Studio 4.16 (2026-07-20)

- New "In plain words" panel at the top of the results: a generated narrative
  that walks the arithmetic in sentences. What one copy of the model weighs
  at the chosen quantization and how many GPUs that alone needs, how the
  concurrency multiplies the fleet into replicas, what the KV cache adds per
  conversation, the latency envelope, and what resilience procures. It
  adapts to fit failures, queueing and cache-dominated deployments, prints
  in the PDF, and its text is embedded in the Excel export.
- Every session now generates a unique scenario ID (Scenario_ab123 style,
  new on each refresh). It appears as the scenario-name placeholder and in
  the plain-words panel, travels inside JSON exports, and stamps every
  artifact filename: JSON, Excel workbook, and the suggested PDF filename.
  Typing your own scenario name overrides it everywhere.


## Studio 4.15 (2026-07-20)

Export and import, rebuilt for completeness and longevity.

- JSON schema v4: exports now carry every input including the Little's-law
  estimator fields, plus full snapshots of the selected model geometry, GPU
  specs and quantization bytes. Imports are version-proof: a model that has
  left the library is rebuilt from its saved geometry as a custom model, a
  missing GPU or quant keeps the current selection with an explanatory note,
  and v1/v2/v3 files continue to load.
- Excel export is now a real .xlsx workbook, built dependency-free in the
  browser: an Inputs sheet, a Results sheet holding live formulas alongside
  the studio-computed values, a Chart data sheet with both plotted curves,
  and a Visuals sheet with embedded images of the memory ledger, both charts
  and the topology schematic. Falls back to the classic formula template if
  image rendering is unavailable.
- The PDF report now begins with a complete three-column inputs table (model
  and geometry, precisions, workload, hardware, tuning, SLO targets) so a
  printed report is fully reproducible, alongside the existing outputs,
  charts and topology.


## Studio 4.14 (2026-07-19)

- Auto-size memory target is now editable (50 to 95%, default 80): it sets
  how full Auto-size may pack the serving GPUs, driving both the TP choice
  and the worker count. Raise it to pack tighter, lower it for more headroom;
  the explanation card reports achieved utilization against the target, and
  the value round-trips through JSON export.
- Two spare-equipped variants of the Active/Active split pattern: with one
  spare overall (N+1) and with a spare in each site (N+2). Both absorb a
  server failure at full capacity while keeping the split economics, still
  halving during a site loss; drawn in the topology with per-site standby
  cards and mirrored in the XLS export.


## Studio 4.13 (2026-07-19)

Driven by user challenges to the resilience and auto-size numbers.

- New resilience mode, Active/Active split: the N load-bearing workers spread
  across two live sites at no extra procurement (1x), accepting half capacity
  during a site loss. This is the pattern people mean when they say active
  active should be half N plus half N. The existing Active/Active (2N) option
  is now labeled for what it is: each site sized to carry the full load
  alone, so a site loss degrades nothing. The site-loss selector group is
  split into degraded-to-half and full-capacity variants.
- Auto-size now justifies its memory utilization in the explanation card:
  the fleet is the smallest whole-GPU configuration that admits the
  contracted concurrency; the remainder is standard 30 to 50 percent growth
  headroom plus integer rounding, and serving frameworks turn it into burst
  admission at runtime.
- The normal-day economics caption no longer claims spare hardware idles in
  modes that have no spare.


## Studio 4.12 (2026-07-19) · library v25

Improvements fed back from the research behind the "Sizing the Modern GenAI
Data Center" white paper.

- Rack-scale NVLink islands are now modelable: GPUs per worker goes up to 72
  and Tensor parallel up to 72, so GB200/GB300 NVL72 and AMD Helios racks can
  be expressed as what they are, one 72-GPU scale-up domain. Auto-size uses
  the wider island, and TP up to the rack no longer triggers cross-node
  penalties.
- Rubin CPX removed from the GPU library and from advice text: NVIDIA pulled
  the prefill-specialized part from its roadmap in March 2026. Disaggregated
  prefill guidance now points at serving software (Dynamo, Mooncake-style)
  instead.
- Quantization and hardware compatibility warnings: pairing NVFP4 with
  non-Blackwell parts, FP8 with Ampere or Apple silicon, or MXFP4 with
  pre-Blackwell hardware now produces a recommendation explaining that
  memory savings hold while the speed benefit largely does not.


## Studio 4.11.1 (2026-07-18)

Mobile pass.

- The topology diagram is now responsive: on narrow screens it draws on a
  narrow canvas so worker cards stack at full readable size instead of
  forcing a horizontal scrollbar, and it re-renders on resize and rotation.
- Page-level horizontal overflow is clipped globally; the memory ledger's
  headroom label flips inside the bar on a readable chip when the fill
  approaches the right edge; resilience stat values wrap instead of
  overflowing their cells.


## Studio 4.11 (2026-07-18)

Answers the question every user asks about resilience: why does doubling the
hardware not double the throughput?

- New resilience economics strip under the topology: guaranteed capacity at
  peak (held even through the covered failure), normal-day capacity (burst
  headroom when both sites serve), idle hardware, and cost versus bare N,
  with a standing one-line explanation of the sizing rule.
- The resilience selector is grouped by outcome: no redundancy, survives a
  server failure, survives a site loss, survives both, with plain-language
  option labels.
- Two practical patterns added: N+2 (two idle spares) and half-size DR
  (1.5N, the cost-conscious pattern that runs degraded at about half
  capacity during a site loss), both drawn in the topology and mirrored in
  the XLS export.


## Studio 4.10 (2026-07-18)

Usability release driven by user testing with real exports.

- Auto-size now leaves a persistent plain-language explanation of its
  decision under the button: why this TP was chosen, what crossing nodes
  costs, the precision change that would avoid it, and whether the result
  actually solves the problem (fit and SLOs), instead of a toast that
  disappears.
- Input flow reordered to match how decisions are made: SLO targets moved
  into the Workload station (presets set them there), the Hardware station
  runs GPU, node size, resilience, then Auto-size, with workers and TP after
  it as labeled fine-tune controls. Efficiency assumptions (MFU, MBU,
  interconnect, overhead) collapsed into an Advanced tuning drawer.
- New P95 recommendation distinguishes fixable misses (lower batch, add
  speculative decoding, with the batch value that meets the target) from
  workloads whose token count makes the target mathematically unachievable
  on any amount of hardware, and says which knob to change.
- The Balanced configuration card no longer appears when an SLO fails, and
  the bottleneck line recognizes generation-length vs P95 conflicts.


## Studio 4.9.1 (2026-07-18)

Auto-size now solves TP, workers and batch together and stays consistent
with its own advice. Found by exercising the previous version against a real
export.

- Batch is part of the solution: interactive workloads (any SLO target set)
  get the fewest workers that admit the peak concurrency at batch 64 or less,
  then grow until the configuration fits; workloads with no SLO targets are
  treated as offline: minimal hardware, largest fitting batch, queueing
  allowed. The same document-generation scenario that previously suggested
  64 workers now lands on 16 with every call admitted.
- A TTFT target widens TP (prefill scales with TP) before workers are sized.
- When TP crosses nodes with the interconnect penalty already modeled
  (efficiency 0.75 or less), the critical warning becomes an informational
  note instead of contradicting the auto-sizer.
- Queueing advice fixed: the worker count was wrong whenever TP spanned
  workers; the panel now first offers the batch value that admits everyone
  when memory allows it.


## Studio 4.9 (2026-07-18)

- Auto-size button in the Hardware station: picks the smallest Tensor
  parallel size that fits one copy of the selected model on the selected GPU
  (with headroom for KV), then adds workers until the peak concurrency is
  admitted at the current batch. Crossing the NVLink island also lowers
  interconnect efficiency to 0.7 and says so. Exposed as
  window.GPUscale.autoSize().
- The hardware card now always explains the fleet in plain language: how many
  replicas, that each is a full copy of the model on TP GPUs, and that more
  TP distributes a copy wider while more workers add copies for more users.


## Studio 4.8.2 (2026-07-18)

- Clearer distribution mental model throughout: the Tensor parallel help text
  now states that TP is the control that distributes the model and that GPUs
  beyond TP form additional full copies; the hardware meta card shows a note
  whenever replicas exceed one; the structural-misfit recommendation explains
  the copy-vs-room distinction and points at the exact slider, including the
  full-fleet TP value that distributes a single copy.


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
