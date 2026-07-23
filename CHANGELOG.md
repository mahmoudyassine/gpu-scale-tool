# Changelog

## Studio 5.15 (2026-07-23)

A Claude skill that turns plain-language requirements into a ready link.

- New footer download: gpuscale-link.skill. Give the file to Claude
  (claude.ai or Claude Code) and it can read a questionnaire, an email or
  a meeting note, translate it into GPUscale inputs (library or custom
  model geometries, quantization, presets, users or concurrency, SLO
  targets, resilience, supporting models) and mint a verified share link,
  always as a pair: the gpuscale.net URL plus the mirror URL for networks
  that block the domain. The skill validates every value against the app's
  own ranges, self-verifies each link by decoding it back, asks only for
  genuinely missing essentials, and can also decode, edit or repair
  existing links.
- The skill's model/GPU/preset data is generated from the live libraries
  by tools/build_skill_link.py, so it ships current (library v28, engine
  v24) and is rebuilt on every release.

## Studio 5.14 (2026-07-23)

Share links are now a one-shot import.

- Opening a share link imports the project as a NEW local copy (its own
  project id, never the sender's) and immediately saves it to this
  browser, then strips the payload from the address bar. Refreshing keeps
  your edits instead of re-importing the stale snapshot, and the imported
  copy can no longer overwrite an existing local project that happened to
  carry the same id. The Share button remains the one explicit way to
  mint a link, so the address bar never silently carries your current
  configuration.

## Studio 5.13.2 (2026-07-23)

- The TP-shard explanation now carries the full reasoning, in the sizing
  bullets and in the fleet-map tooltip of every shard GPU: tensor parallel
  needs NCCL peer-to-peer over NVLink, MIG partitions have no peer-to-peer
  between them, so a TPn copy owns n whole GPUs however empty they look.

## Studio 5.13.1 (2026-07-23)

- Sizing bullets now explain the other half of GPU sharing: a TP-sharded
  pool whose shards leave the GPU half-empty states that tensor parallel
  cannot run across MIG slices (no peer-to-peer between partitions), so
  its shards keep whole GPUs no matter how empty they look.

## Studio 5.13 (2026-07-23)

The sizing decision reads as bullets, and shared GPUs show per-slice numbers.

- The Auto-size sizing decision is no longer a paragraph: one bullet per
  pool (model · TP × workers · batch · calls · dedicated or shared GPUs)
  with indented sub-points for the interesting parts (TP widened for TTFT,
  nodes added for speed targets, "dedicated, not sliced: <reason>",
  unachievable targets), then the shared-GPU and fleet totals. Same
  structure in the Summary and the printable report; the note also now
  appears immediately after Auto-size runs instead of on the next redraw.
- Shared GPUs in the fleet map got a "memory per slice" breakdown under
  the legend: identical GPUs grouped (16× GPU · Qwen3 14B 2g ×4 · 77% of
  slice each), guard/embedding slices listed with instances per slice.
  Bands inside shared GPU cells now stack from the bottom like every
  other fill in the map, each band shows its own percentage when the
  slice is tall enough, and the centered figure appears only when the
  slices are too small to label.
- Fixed the sizing-decision bullets inheriting the summary's flex layout
  (sub-points used to float beside the text instead of underneath).

## Studio 5.12 (2026-07-23)

Auto-size explains why replicas keep dedicated GPUs, and small polish.

- When a TP1 pool stays on dedicated GPUs instead of MIG slices, the
  auto-size summary now says exactly why: the copy does not fit the largest
  slice, a slice's reduced compute misses the TTFT target (with the
  measured prefill time), per-user speed or P95 fails even alone on the
  largest usable slice, the KV cache cannot fit at any replica count,
  sharing would not reduce hardware, or the selected GPU has no MIG
  partitioning at all. Half-empty dedicated GPUs on the fleet map are no
  longer an unexplained choice.
- The light/dark choice is remembered: toggling the theme stores it in
  this browser and it survives reload and reboot, taking priority over the
  OS preference (which still drives the first visit). The Normal/Advanced
  mode was already stored; both now persist.
- The Reset-to-defaults button is gone. New project covers the need without
  the risk of wiping a saved project's inputs.
- The footer privacy note is a quiet text block instead of a tinted box.

## Studio 5.11 (2026-07-23) · library v28

Research-refreshed workload presets, and shared GPUs that show their slice memory.

- Every preset's SLO targets re-grounded in production latency conventions
  (NVIDIA NIM/GenAI-Perf profiles, vLLM SLO-triage guides, Azure OpenAI
  latency guidance, voice-agent latency literature). Streaming targets now
  reflect what a user actually needs: 20 tok/s reading pace for chat, 40-60
  for skim and agent flows. TTFT budgets include the retrieval hop or the
  long prefill where the workload has one. Every preset's P95 is now
  numerically achievable from its own TTFT and TPS targets; several old
  presets demanded a P95 their own targets made physically impossible
  (voice asked for 3 s while its token budget alone took 4.3 s).
- Presets now carry an exact reasoning-token budget where the 2K/8K classes
  are wrong: Advanced RAG plans with ~250 tool-plan tokens, the code agent
  with ~3K, deep research with ~20K.
- Presets that cannot survive an idle-turn KV eviction pin session caches
  (real-time voice, contact-center assist); picking any other preset resets
  to running-batch admission. The default landing verdict now narrates it:
  "200 of 200 calls resident in KV".
- Five new presets: medical imaging report assistant, clinical knowledge
  assistant, real-time video analytics, translation / localization, and
  contact-center agent assist, each with its own users-to-concurrency
  traffic shape.
- Fleet map: shared GPUs now show how much of each slice's memory its model
  actually uses. Each band is one slice; the solid part is used memory, the
  faint part is slice headroom; hovering gives exact GB per slice. The
  centered percentage on a shared GPU is now memory-based, and the hatch
  pattern on supporting-model bands renders again (an inline background
  shorthand had been overriding it since the bands were introduced).
- Header: cleaner wordmark with the domain underneath, a tagline that says
  what the tool is (use cases in, VRAM out), and the JSON button is now
  labeled Export.
- Library v28; metadata now correctly reports engine v24. Preset field
  reference (reasonTok, policy, SLO consistency rule) documented in
  docs/DATA.md.

## Studio 5.10 (2026-07-23)

No hardware for impossible targets, and a fleet map that shows everything.

- Auto-size no longer buys nodes for an SLO target that no fleet size can
  meet. It first checks what a single call gets alone on the hardware at
  batch 1 (the physical best case); a target that fails even there, such
  as a tight P95 against a long reasoning output, is reported as
  unachievable and excluded from sizing. Previously the solver grew the
  fleet all the way to batch 1 chasing it and kept the added nodes: a
  project with a 5 s P95 target on an 8.8K-token workload procured 168
  GPUs where 16 carry the actual demand. The achievable targets still
  size the fleet exactly as before.
- Slice packing now counts MIG memory slices, not compute slices: on
  7-slice parts a 3g or 4g instance occupies 4 of the 8 memory slices, so
  combinations such as 3g+3g+1g that no H100/H200 can host are no longer
  produced, and shared-GPU utilization is measured against the memory
  budget.
- The fleet map shows every node: the "+N more" tile is gone. Node tiles
  and GPU cells are larger, and every GPU now displays its memory
  utilization inside the cell, including shared GPUs, where the figure is
  the slice-budget share of the sliced replicas and supporting models on
  that card.


## Studio 5.9 (2026-07-23) · engine v24

GPU sharing: replicas and models can now share physical GPUs, the way
Triton and vLLM deployments do on MIG-partitioned clusters.

- MIG-sliced pools: in a multi-use-case project, a TP1 pool whose model
  copy fits a hardware slice can run one replica per slice. Auto-size
  weighs a sliced plan against the dedicated one by pricing real
  first-fit slice packing (whole slices, never fractional GPUs) including
  co-residency with supporting models, and picks whichever needs fewer
  physical GPUs. Sliced replicas keep honest per-slice speed: compute
  scales with compute slices, bandwidth follows NVIDIA's memory-slice map
  at 0.93 delivered efficiency, and each instance pays 1.4 GB overhead
  instead of the whole-GPU multi-GPU term (engine v24's only new input,
  default-identical to v23).
- Only real slice geometries exist: 1g/2g/3g/4g on 7-slice MIG parts
  with true profile memory (a 3g slice on an H100 is 40 GB, not 30),
  1g/2g on 4-slice parts (RTX PRO 6000, A30), and uniform partitions on
  AMD CPX parts, which are labeled partitions, not MIG. Supporting models
  land on the smallest real profile that holds them.
- One packed fleet: dedicated pool GPUs, sliced replicas and supporting
  models pack together onto nodes; replicas beyond peak demand are
  trimmed and their GPUs simply are not procured. The fleet map draws
  shared GPUs as slice mosaics with per-slice tooltips (GB-based on
  non-partitionable GPUs), and resilience multiplies the packed node
  count everywhere: verdict, story, report, print and exports agree.
- Excel exports carry the per-extra-GPU overhead as an input cell, so the
  live formulas recalculate correctly for sliced pools too, and the
  project sheet reports placement (dedicated GPUs vs slices on shared
  GPUs) instead of raw worker settings.
- Single-use-case mode is unchanged and Auto-size there never applies a
  slice count as whole GPUs; a hint notes when a model would slice well
  in a project.


## Studio 5.8.1 (2026-07-21)

- A New-project button (+) sits next to the project name, beside the
  saved-projects menu; one click starts a clean project (the previous one
  stays in this browser's history).
- Tagline updated: "Size multi-scenario, self-hosted LLM fleets · all in
  your browser."


## Studio 5.8 (2026-07-21)

Charts anyone can explain, and a clearer canvas.

- The two charts speak plain language: "Speed per user as demand grows"
  and "Speed per user vs conversation length", with a halo-labeled "today"
  marker per pool (with units), an amber target line, and a y-axis capped
  to the operating region so slow pools no longer flatten onto the axis.
  Axis ticks are integers, not "1.00".
- Request latency anatomy rebuilt: one bar per use case on a shared scale,
  an amber tick marking the slowest allowed time (derived from the P95
  target), red totals when over, pool-color dots to tell same-named use
  cases apart, and a visible plain-words key. The panel no longer clips.
- Normal mode results are simplified but not dumbed down: dense breakdown
  lines, placement notes and solver prose hide; every chart, diagram,
  verdict and finding stays. Deployment bullets lead with the plain
  sentence and keep the TP/batch detail for Advanced.
- The input rail sits in a tinted container in both themes, corners are
  sharper across the app (8/6px system), and the SLO roll-up carries pool
  dots too.
- Fixed: printing through the browser dialog now keeps all bar and map
  colors even with "Background graphics" off (print-color-adjust); loading
  a saved or shared project no longer overrides the viewer's light/dark
  preference with the theme stored in the file.


## Studio 5.7.1 (2026-07-21)

Excel report polish for real Excel.

- Row heights across the Report sheet are now computed from the text (Excel
  never auto-grows merged wrapped cells): nothing clips or overlaps in
  Microsoft Excel; sections breathe with spacer rows.
- The throughput line chart samples 13 points and skips alternate category
  labels, so its axis is readable; bar charts keep every pool and use-case
  label.


## Studio 5.7 (2026-07-21)

Projects that survive reboots, and links that carry them.

- The current project autosaves to the browser's local storage (debounced,
  with a quiet "saved locally" pulse next to the project name) and is
  restored on the next visit, reboot included.
- A history menu (clock icon in the project box) lists every project saved
  in this browser with model, use-case count and date; click to load,
  delete per entry, or start a new project. Up to 40 projects kept.
- Share links: one click copies a URL that carries the whole project
  compressed inside the fragment (about 1-2 KB); anyone opening it gets
  the project loaded and auto-sized, with no upload and no backend.
  For short ?p=id links, docs/share-worker.js is a ready-to-deploy
  Cloudflare Worker + KV backend; deploying it and setting SHARE_API in
  app.js switches sharing over, as an explicit opt-in.
- Privacy wording updated honestly everywhere: projects stay on this
  device; nothing leaves the browser unless you create a share link,
  which itself contains the data.


## Studio 5.6 (2026-07-21)

A native Excel report, a richer ledger, and a quieter rail.

- The Excel export is rebuilt around a styled Report sheet that mirrors the
  page: verdict banner, use-case and deployment rows in each use case's
  color, KPI tiles, per-pool memory detail, the fleet map as a colored cell
  grid (supporting GPUs hatched, spares dashed), recommendations, and THREE
  native Excel charts you can edit like any chart: the memory ledger as a
  stacked bar per pool, per-user throughput lines per pool, and the latency
  anatomy per use case. Chart data lives on a Data sheet; the Inputs and
  Results formula sheets and the Project sheet remain. The screenshot-image
  sheet is gone. Landscape fit-to-width print setup included.
- The memory ledger got its depth back: every pool's bar carries hoverable
  segments plus a breakdown line (weights, KV with sequence count,
  activations, overhead, each in GB and percent, plus headroom), a
  supporting-models line, and a project-total row with utilization.
- The auto-size explainer moved behind the button's (i); the sizing
  decision, with a timestamp, now lives in the Summary panel (and in the
  Excel report) instead of a wall of text in the rail.
- Print: the results banner no longer leaks into the PDF header.


## Studio 5.5 (2026-07-21)

Auto-size now sizes for the SLA, and says what it cannot fix.

- After fitting memory, Auto-size keeps adding nodes until the per-user
  speed and P95 targets pass (smaller batch per replica means faster
  streams). When a target still fails at batch 1, no fleet size can fix
  it: the tool says so plainly and points at the real levers (shorter
  visible output and reasoning, a faster GPU, or a relaxed target).
- The Summary's findings name the lever per failing metric: first token
  responds to wider tensor parallel; per-user speed to more nodes, a
  higher-bandwidth GPU or quantization; P95 to the speed levers plus
  output length, which becomes the floor at batch 1.
- Mobile: the inputs and results halves are clearly separated with banner
  captions and a divider, and the results caption no longer claims the
  inputs are "on the left".


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
