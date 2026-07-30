# Changelog

## Studio 5.27.0 (2026-07-30) · engine v27

Prefix caching, the last gap the 2026 practice review left open. Until now the
studio charged a full prefill on every call, which over-sized exactly the
workloads whose first-token targets are hardest to meet: an agent loop re-sends
2-5K tokens of tool schema verbatim every step, and step N+1's prompt is step
N's prompt plus one observation. Every serious serving stack computes that
prefix once (vLLM, SGLang and TensorRT-LLM all ship automatic prefix caching).

### The model

A per-use-case **Shared cached prefix** field (0-95%, default 0) says what share
of the resident sequence is byte-identical every call:

```
cached   = floor(resident x fraction)      prefilled once, held once per replica
unique   = max(0, effSeq - cached)         charged per call
TTFT     = 2 x (resident - cached) x active / (TFLOPS x TP x MFU)
KV total = calls x unique x KV/token + replicas x cached x KV/token
```

Three decisions kept it honest:

- **Decode is not discounted.** Per-user tok/s still divides by the full
  sequence. A cached prefix saves prefill FLOPs and one copy of the KV, but a
  call still re-reads its whole context from HBM on every generated token unless
  the kernel batches shared pages, which not every stack does. Decode bandwidth
  is the number that sizes most fleets; being optimistic there is the expensive
  kind of wrong.
- **The shared block is per replica, not per fleet.** Each replica holds its own
  copy. A pool with more replicas than concurrent calls saves less, correctly.
- **Zero by default.** A hit rate is a fact about the serving stack, not about
  the workload class. No preset ships one, no saved project moved, and at zero
  the engine is byte-identical to v26 (verified over 9,000 comparisons across
  three ways a pre-5.27 project can arrive without the field).

The solver uses the same split: TTFT widening prices the prefill rather than the
whole sequence, and the TP fit heuristic reserves the shared block before sizing
per-call KV. Both XLSX builders mirror the chain (`cachedTok`, `uniqueSeq`,
`kvShared`, `kvTotal`, `ttft`) as live formulas, and the CLI skill gains
`--cache pct` plus the four derived fields in `--json`.

### Offered, never assumed

Where a pool carries 8K+ resident tokens with no fraction set, the optimiser
prices 30% and 60% by re-solving the whole project and offers whichever actually
deliver, each button labelled with what it buys: GPUs off the order, cards at
the same order, or the first-token number it lands on. The quoted first token is
rebuilt from the engine's own closed form at the TP the re-solve chose, and is
suppressed entirely when that reconstruction cannot reproduce today's number.
The recommendation says outright that it should only be accepted if the serving
stack has prefix caching on and the prompts really do share that prefix.

One recommendation per project, not one per pool: three pools with the same
opportunity is one insight repeated, and each repeat evicted something the
reader needed more.

### Fixed along the way

- **The optimiser's recommendation cap silently dropped an explanation.** The
  list is capped, and the new class pushed "why the fleet is this size when the
  cards sit at N%" off the end on both reference projects: the very section a
  reader with a half-empty fleet needs. The cap is now 6, and the reference
  projects are byte-identical to 5.26.0 on every line except the added entry.
- **The shared prefix did not survive a save.** `serialize` and both importers
  omitted it, so a saved project or a share link lost the setting. It is now
  `config.sharedPrefixPct` at both levels, absent-means-zero on import, and the
  share-link skill encodes and clamps it (0-95).
- **The replica-trimming P95 guard rebuilt TTFT by hand** from the full resident
  sequence, so it refused trims that were legal once the prefix was cached.
- **`tools/build_skill.py` was not idempotent.** It appended the sliding-window
  note to `skill/reference.md` on every build; twelve copies had accumulated by
  5.26.0. Collapsed to one, and the generator now checks before inserting.
- **The white paper's library counts were stale** (94 models / 38 accelerators,
  actually 101 / 37).

### Verified

- Cache-free parity against the released v5.26.0 engine: 9,000 comparisons, 0
  differences.
- An independent Python reimplementation of v27, written from the documented
  formulas: 2,500 states (1,836 with caching on), 75,000 field checks and six
  invariants per state, 0 mismatches.
- Solver optimality: 3,664 dedicated plans, 0 beatable by a cheaper feasible one.
- Recommendation fuzz: 420 random projects, 140 fired the new class, 264 buttons
  checked promise-against-delivery, 0 mismatches, 0 that would have cost more.
- Reference projects f4 and NCSA: every line identical to 5.26.0 except the one
  added recommendation. Apply, then Undo, restores the project exactly.
- JSON, share-link and standalone-build round-trips; workbook chain with no bad
  references; no horizontal overflow at 390 px.

## Studio 5.26.0 (2026-07-30) · library v33

The 2026 practice review in [docs/PRACTICES.md](docs/PRACTICES.md), applied.
Four first-token targets move to the current convention, and the four workload
classes the review found missing are now presets. 24 presets, all passing
`tools/check_presets.py`.

### Four targets corrected

| Preset | TTFT | Why |
|---|---|---|
| Code generation (inline) | 300 -> **100 ms** | A 60-token completion is inline, where 2026 practice is 100 ms p99 and 25 ms ITL |
| Voice agent | 300 -> **200 ms** | The LLM's share of a 400 ms p50 voice budget is 150-250 ms (STT 80-120, TTS first chunk 60-100, transport 20-60) |
| Simple chatbot | 400 -> **300 ms** | Interactive chat converged on 300 ms p99 |
| Simple RAG | 800 -> **400 ms** | RAG chat is 400 ms p99; retrieval is its own budget line, not an excuse for a slower first token |

Nothing else moved. Every preset the review marked OK is untouched.

### Four classes added

Each is a distinct sizing shape, and each is sized PER REQUEST, not per task.

- **Computer-use / browser agent** (2000 / 30 / 60, 64K resident, 1,000 thinking
  tokens, 200 visible). One step of a task that runs about 200,000 tokens: the
  step re-sends the accumulated transcript plus 2-5K tokens of tool schema and
  answers with a short tool call.
- **Speech-to-speech (native audio)** (200 / 50 / 5, KV pinned per session, no
  ASR or TTS attached). Native stacks reach 160-400 ms voice-to-voice against
  1-2 s for a pipeline, so the entire budget sits on one model.
- **Code review agent** (3000 / 30 / 110, 64K resident, 1,500 thinking, 800
  out). About 50,000 tokens of prefill for a 2,000-line pull request, one long
  think, a page of comments. Prefill dominates.
- **Code completion (panel)** (300 / 20 / 18). The relaxed half of the
  completion class, read rather than accepted inline.

### Safety of the change

Saved and shared projects reference presets by NAME, not by index, so appending
four classes cannot disturb an existing project. The four corrected targets
apply to a card only when its preset is re-selected. Both reference projects
re-verified byte-identical: 64 GPUs / 8 nodes and 40 / 5, all SLOs met,
auto-size idempotent, round-trip stable.

## Studio 5.25.1 (2026-07-30) · documentation

A review of current serving practice, and a documentation pass over everything
in the repository. No behaviour changed; the studio, both skills and the
portable build are byte-for-byte the same tool.

### New: docs/PRACTICES.md

The workload presets carry SLO targets that were grounded in published practice
when they were written, but the evidence lived in commit messages. It now lives
in one file: the 2026 conventions per workload class (MLPerf Inference v6.0
latency constraints, TTFT/ITL guidance, the voice-turn budget decomposition,
measured agentic token consumption, reasoning budgets, speculative-decoding
speedups), a verdict for every one of the 20 presets against that evidence, and
the classes the library does not yet cover. Numbers were NOT silently edited:
changing a preset moves every project that uses it, so the review is a proposal.

### New: tools/check_presets.py

Enforces what PRACTICES.md documents: the self-consistency rule (a preset may
never demand a P95 its own first-token and speed targets make impossible),
field ranges, valid support kinds, complete traffic shapes, and advisory bands
per workload class. All 20 presets pass.

### Documentation brought current

- **docs/DATA.md** stopped at 5.21. It now documents the full preset schema
  (`reasonTok`, `policy`, `supports`, `traffic`), the per-request rule, the card
  stamp and its pool-wide freshness requirement, whole-GPU co-residency and its
  four merge gates, the SLO optimiser including P95-as-a-lever, the solver
  invariants, and an engine version history table.
- **README.md** gains the two newest capabilities, the full generated-artifact
  list (three build scripts, not one), the docs index, and contribution rules
  for preset changes.
- **llms.txt** explains which promise buys the hardware and why an empty-looking
  card is usually correct, so an agent reading it does not repeat the mistake.
- **skill/SKILL.md** and **skill/reference.md**: the auto-size description was
  the pre-5.21 algorithm; it now matches the shipped solver (fitting width,
  first-token widening with its feasibility guard, the candidate sweep, the
  closed-form replica count, give-back). Workload defaults now point at
  `--list-workloads` instead of quoting stale numbers, and the reference names
  what the engine does not model (prefix caching, speculative decoding,
  pipeline parallelism, prefill/decode disaggregation).
- **skill-link/**: corrected model count and the engine version in the payload
  schema.
- **docs/V5-DESIGN.md** is labelled as the historical design record it is.
- The white paper source states the per-replica overhead rule (rebuild with
  `python3 src/build_docx.py`).

## Studio 5.25.0 (2026-07-29) · engine v26

**The multi-GPU overhead is charged per replica, not per pool.** Every number in
the studio moves; nothing else about the engine changed.

The engine billed `(pool GPUs - 1) x 15 GB` of NCCL buffers across a whole pool.
But a communicator is one tensor-parallel replica: independent replicas never
talk to each other during decode. A pool of 40 TP1 replicas was charged **585 GB
to communicate with nobody** - 57% of that pool's reported memory. It is now
`replicas x (TP - 1) x movh`.

- TP1 pools pay nothing (was up to 945 GB in the fuzz corpus); a TP8 x 5 pool
  pays 525 GB instead of 585; a single TP16 copy is unchanged.
- Measured over 3,000 randomised states: 2,035 moved, and 79 configurations that
  did not fit now do. Speed, first-token, latency and throughput are untouched -
  this is a memory term only, verified field by field.
- Both XLSX builders mirror the new formula from the `movh` input row, and that
  row is relabelled: it is the overhead per extra GPU *inside* a replica.
- Re-verified: an independent reimplementation of engine v26 written from the
  documented physics agrees with the shipped engine on 12,000 checks; the
  optimality fuzz still finds 0 of 3,664 plans beatable; both reference projects
  are unchanged at 64 GPUs / 8 nodes and 40 / 5 with every SLO met.

Docs, `llms.txt`, `docs/DATA.md`, the README formula block and the bundled
sizing skill all state the new rule.

## Studio 5.24.1 (2026-07-29)

The last three accuracy items from the 5.24.0 audit.

- **The fill target ignored what a card holds but does not re-read.** An MoE keeps
  every expert resident while decode reads only the active ones, and activations
  and fixed overhead sit there too, so "filling 80% of the card asks for X tok/s"
  was too low: DeepSeek-V3.2 671B at TP16 quoted 19.2 tok/s where the real answer
  is 23.2. The residual is now subtracted before inverting.
- **The fleet-map note blamed the speed target for every empty card**, and said
  nothing at all when a pool had no speed target - exactly when an empty card
  most needs explaining. It now counts the pools under 60% and names what holds
  each one there: a per-user speed target, a first-token target that widened the
  group, or one replica already admitting the peak.
- **The auto-size note credited the whole tensor-parallel width to the
  first-token target** even when the speed targets took it wider. It now
  distinguishes the width TTFT needed from the width the plan settled on.

## Studio 5.24.0 (2026-07-29)

From a real project: four clinical use cases on B300, 7 nodes procured, cards
rendered at 12%, and not one actionable recommendation. The fleet was
arithmetically correct. Everything around it was not.

### The P95 promise can be the thing buying the hardware, and the optimiser could not say so

The reported project's largest pool cost 40 of its 45 cards, and every one of
them was bought by a **4-second P95 on a 1,000-token generation**: that promise
demands 343 tok/s per user, 11x the use case's own 30 tok/s speed target. The
SLO optimiser only ever knew how to propose a LOWER speed target, so it clamped
every proposal back to the current value and said nothing at all. Measured over
957 randomised projects: of those where speed/P95 demonstrably drove a quarter
or more of the fleet, **32.6% got no suggestion, and 68.5% of those silences
were this exact case**.

- A pool whose P95 implies more speed than its tok/s target now gets its own
  recommendation naming that, with Apply buttons that relax the P95 (halfway, or
  to the level that fills the card) priced by the same whole-project re-solve.
  On the reported project: **56 GPUs to 24**, with every SLO still met.
- A use case with no tok/s target at all but a binding P95 was invisible to the
  optimiser entirely. It is not any more.

### The solver was leaving hardware on the table

An independent optimality fuzz compared every plan against every cheaper
(TP, replica) configuration meeting the identical targets. **6.7% of plans were
beatable, the worst by 13.5x.** Three causes, all fixed:

- The tensor-parallel sweep only ran when a speed or P95 target existed, so
  memory-bound pools got an explosion of narrow replicas instead of a wider,
  cheaper group.
- The width-fitting heuristic charged the 15 GB multi-GPU overhead to every
  card, while the engine charges it once per extra GPU plus a flat 5 GB. It was
  stricter than the thing it was approximating and bought widths nobody needed.
- The first-token widening loop had no feasibility guard: an unreachable TTFT
  target walked it to TP64 and bought 64 cards per replica for a promise still
  missed. It now stops at the width that meets the target, and keeps the fitting
  width when none does.
- The post-growth rounding guard could spend its whole allowance on a target it
  could not move; it now stops as soon as an extra replica stops shrinking the
  set of missed targets.

After: **0 of 3,607 plans beatable**, on the tool's own policy of not crossing
NVLink islands for speed alone.

### Saying which promise is responsible

- The hardware-fit recommendation quoted the strictest tok/s target anywhere in
  the project and the project-wide interconnect. On the reported project that
  described a pool costing zero marginal cards. It now quotes the binding speed
  of the pool that actually owns the cards, using that pool's own interconnect,
  and prints what its cards are really carrying beside the ceiling.
- That ceiling is a per-token READ SET, not resident VRAM, so it is no longer
  worded as what a card "can hold".
- The empty-fleet explainer split "speed and P95" into the two promises, which
  need different levers, and no longer claims no relaxation exists without
  pricing one first.
- "Likely over-provisioned" no longer fires on a pool whose emptiness is a
  latency promise being kept, where it contradicted the solver.

Reference projects unchanged (64 GPUs / 8 nodes and 40 / 5, all SLOs met);
engine v25 byte-identical and verified over 3,000 states.

## Studio 5.23.2 (2026-07-28)

A project whose cards sit half empty could still get no explanation and no
button: the SLO optimiser only speaks when a promise can be honestly relaxed,
and a fleet driven by admission, KV memory, first-token compute, node rounding
or the resilience pattern got silence. Reported from a real project ("GPUs are
empty and still advising 7 nodes, and no action offered").

- When project memory sits under 50%, a new recommendation prices each
  constraint class with the same re-solve the suggestions use and itemises the
  order: cards kept only for the speed/P95 promises (saying so when those are
  already at their workload-class floor and no honest relaxation exists), cards
  for the first-token promises, the floor with every target off (admission +
  KV), node-rounding slots, and the resilience pattern's share.
- Grammar: "1 GPU slot are node-rounding".

## Studio 5.23.1 (2026-07-28)

The bundled `gpu-sizing` Claude skill is no longer three libraries behind.

- `skill/sizing.mjs` is now **generated** by `tools/build_skill.py`, which embeds
  the engine block and `solvePool` verbatim from `assets/app.js` and the model,
  GPU, quant and workload listings verbatim from `data/*.js`. The CLI's numbers
  are the studio's numbers by construction, and the generator runs on every
  release.
- The stale copy carried engine v23 / library v25 (94 models) and the uniform
  KV form, over-stating KV by up to 6x for sliding-window models: it answered
  40 GPUs for Gemma 3 12B on H100 at 32K context where the studio needs 6
  serving cards. The regenerated CLI matches the studio's solver exactly -
  verified on five configurations (hybrid attention, MoE, cross-node TP16 and
  the pinned-KV voice policy): identical cards, TP and batch on every one.
- The CLI gained `--policy running|all`, `--ttft/--tps/--p95` on presets,
  honest card-based fleet lines, an `sloStuck` note when a target is out of
  reach, and the hybrid-attention KV explanation in its story output.

## Studio 5.23.0 (2026-07-28)

Recommendations now act, the charts show where good and bad live, the fleet map
centres on phones, and the engine was re-verified independently. Engine v25 and
library v32 are untouched.

### Every actionable recommendation has a button

- Fix-it actions that survive a re-solve are offered everywhere: switch weights
  or KV cache to FP8 (with the GB saved), relax an unachievable P95 to the floor
  the workload can actually meet, turn reasoning off, switch to N+1, reset a
  costly interconnect value, run Auto-size. One click applies, re-solves where
  that is the honest thing to do, and offers a single Undo that restores every
  use case and every global control exactly.
- Manual-lever actions (widen TP, halve or cap batch, add workers) appear in
  single-use-case Advanced mode, where the solver will not overwrite them a
  moment later. That is also the answer to "why did some warnings have no
  button": a lever the next Auto-size recomputes is not an action, it is a lie.
- Under the "all sessions stay in KV" policy the engine admits every call
  regardless of batch, so the batch levers were a provable no-op there; the
  speed suggestion now offers the replica lever instead, with the honest tok/s.
- Pure observations (pre-launch hardware, TP crossing nodes, balanced) stay
  button-less by design.

### Charts say where good and bad are

- Both tok/s charts tint the region below the strictest speed target red and
  the region above it teal, with the amber dashed target line labelled. Zone
  labels draw above the series so a line can never strike through the words,
  and the target label moves out of the way of the operating-point markers.
- Legends now name every mark: the pool lines, the target dashes, both zones,
  the operating-point dot, and the latency chart's amber tick ("a bar past its
  tick runs late"). Same entries in single-use-case mode.

### Fixed on the way, found by the release judges

- **The four KPI headline tiles could show corrupted figures in project mode**:
  the single-mode count-up animation raced the project renderer and overwrote
  the demand-weighted averages with the active card's solo numbers (or a stale
  interpolation - "Avg user latency -10.8 s"). Present since the tiles were
  introduced; the tiles now have exactly one writer per mode.
- The new chart-legend entries made the legends min-content wide, overflowing
  the page horizontally on phones, on desktops up to ~2050px, and clipping the
  right chart in print. They wrap now.
- "P95 up to" on the latency tile understated the worst case: it took the
  worst pool blend, not the worst use case.
- The interconnect recommendation quoted serving-card sums as "GPUs".
- Action buttons meet the 34px touch minimum on coarse pointers.

### Mobile

Node tiles centre inside the site frame below 1020px instead of hugging the
left edge with 40% dead space; site headers and the shared-GPU strip centre
with them.

### Engine re-verified

The engine block is byte-identical to v5.22.2 and v5.21.3. An independent
reimplementation written from the documented formulas matched the live engine
on 3,000 randomised states x 19 fields = 57,000 comparisons with zero
mismatches, including sliding-window KV models, both KV policies and the
per-instance overhead path. The 1,293-plan solver fuzz and the full smoke on
both reference projects pass unchanged (64 GPUs / 8 nodes and 40 / 5).

## Studio 5.22.2 (2026-07-27)

- A recommendation could offer "→ 56 GPUs" and "→ 56 cards" side by side: the
  same number for two different quantities. A suggestion that does not change the
  order now says "56 cards, same order" instead of quoting a bare card count.
- The figures in a per-pool recommendation are project totals, and now say so.

## Studio 5.22.1 (2026-07-27)

An independent 14-agent adversarial audit re-checked 5.22.0. It confirmed the ten
findings that release closed, and found nine defects in the new work plus two
over-claims in the release notes. All are fixed here.

### The fleet-map legend reads

Eighteen entries wrapped raggedly across five rows from fourteen different left
edges. They now fill two aligned columns top to bottom, so the pool colours, the
node states and the memory key each stay together; one column below 1020px.

### What the audit found in the new work

- **Undo could hand back a bigger fleet than you started with.** The snapshot
  omitted each use case's slice geometry, so undoing an apply that had moved a
  pool onto MIG slices restored the targets but not the plan: measured 3 serving
  cards before, 22 after the undo, with a speed target now missed. It now
  snapshots every use case's whole allocation and restores it exactly.
- **"Relax the P95 promises" could tighten one.** The paired promise was computed
  from the proposed speed and written unconditionally, so a use case whose P95
  had slack had it rewritten downwards - a 120 s promise became 28 s, on a button
  labelled "relax". A promise is now never moved in the tightening direction.
- **A MIG-sliced pool was re-solved on top of its own slice.** `poolSolveState`
  exists to hand the solver a real card back, and three call sites bypassed it,
  including auto-size itself, so a sliced pool could never leave the geometry a
  previous run had put it in.
- **The give-back after growth compared categories, not targets.** A pool mixing
  a reachable speed target with an unreachable one had the hardware that met the
  reachable one handed straight back, and was then told the target was
  impossible. It now compares the set of missed targets: growth that met one has
  earned its cards.
- **"Fails even alone at batch 1" was said of targets that do not.** A target can
  also be out of reach because meeting it would need more replicas than the
  hardware allows; that now says so instead.
- **The quoted saving ignored node packing and resilience.** Cards are what a
  suggestion moves, but nodes are what you buy: the default single-use-case
  project showed "8 cards to 4" while the order went 16 GPUs to 8, and a real
  four-card saving could leave the order untouched. Every suggestion now quotes
  both, the buttons promise the procurement figure when it moves, and a saving
  that does not reach the order says so in those words.
- **The recommendation memo could outlive its inputs.** Custom-model geometry,
  the KV-extension flag, the preset, the tensor-parallel width and the attached
  supporting models all changed the answer without changing the key, so a card
  could quote a fleet that no longer existed.
- **The workload floor read the preset dropdown, not the workload.** Switching a
  voice agent to "Custom (manual inputs)" changes nothing about it, but dropped
  its floor from 30 to 15 tok/s and offered 26. The floor is now derived from the
  use case's own KV policy, P95 and reasoning budget.
- **The co-residency note could still lead with a generic gate.** The measured
  pairwise reasons now outrank them, the blocking tenant is the one actually in
  the way rather than whichever landed first, and two pools of the same model at
  the same width are told apart.
- Both spreadsheet exports still sized the fleet as workers x GPUs-per-worker, so
  the workbook contradicted the card plan the studio reports; they now carry the
  card count as an input with a live fallback formula. The XLSX fleet grid also
  emitted `rgb="FFundefined"` for a dedicated GPU inside a mixed node, and
  painted co-resident and shared cards as spare.

### Corrections to the 5.22.0 notes

- The band-label bullet described a fix that shipped in 5.21.2; 5.22.0 only added
  a comment. Dropped.
- "Every sampled sliced win was more expensive than the plan it beat" overstated
  it. Measured over 120 random projects: 5.21.3 picked sliced 39 times, of which
  17 bought nothing - 16 ties and one strictly more expensive.

### Docs

`llms.txt` (served to agents), the README diagram and the engine banner still said
engine v23, 94 models, 38 accelerators and JSON schema 4; the KV formula was
quoted in the pre-v25 uniform form. The Auto-size help text still described
buying whole nodes. `docs/DATA.md` and the README layout listed four data files
when there are five. The bundled `skill/` CLI is genuinely behind (engine v23,
library v25) and over-states KV for sliding-window models, so the README now says
so instead of claiming the same math and libraries.

## Studio 5.22.0 (2026-07-27)

The SLO targets are now a sizing lever you can act on, and the last of the audit
findings are closed. Engine v25 and library v32 are untouched.

### The speed target is a sizing decision

Decode reads the weights and the live cache once per token, so at the operating
point a card can only ever hold `bandwidth x interconnect x MBU / target tok/s`
GB, whatever the model and whatever the tensor-parallel width. A B300 asked for
60 tok/s per user can therefore fill 61 of its 288 GB, and the fleet grows to
buy bandwidth it cannot fill with memory. Recommendations now say so and offer
the target that would fill the card:

- Per pool, the target that fills the auto-size memory target is computed, then
  capped twice: by the use case's own workload class (a live voice path is never
  asked to read at 19 tok/s) and by its own P95 promise, which the first
  suggestion keeps exactly.
- A second suggestion relaxes P95 by at most half again where that is what pins
  the speed target, with the new promise spelled out in seconds.
- A first-token target that widened the TP group gets its own suggestion: the
  width the model actually needs, and what the first token costs there.
- Nothing is a rule of thumb. Every suggestion re-solves the whole project with
  `solvePool` and quotes the real card delta, exactly as the hardware-fit
  recommendation does. On the 13-use-case reference project: 60 cards to 48.
- Each one carries an **Apply** button that writes the targets across the use
  cases in scope (this pool, or all of them) in one click, re-runs Auto-size and
  offers the whole change back as a single Undo. Buttons never print.

### Audit findings closed

- **Sliced-versus-dedicated was priced in whole nodes.** Since 5.21 a pool owns
  cards, but the MIG comparison still rounded the dedicated plan up to a node, so
  three slices could "save" hardware against a single card. Measured over 120
  random projects: 39 sliced wins on 5.21.3, of which 17 bought nothing (16 ties
  and one strictly more expensive); on this build all 22 are strictly cheaper.
- **The SLA growth loop could buy 400 replicas and report success.** Its
  iteration guard was the binding exit on wide nodes, and leaving through it
  recorded nothing, so a plan that still missed its target claimed to meet it.
  The replica count the target needs is now solved in closed form, one
  unreachable target no longer suppresses growth for a reachable one, and growth
  that fixes nothing is given back. Verified over 1,293 randomised plans: no plan
  misses a target it claims to meet, and none gives up on a target that is
  reachable within the replica cap.
- **Single-use-case mode threw the card plan away** and applied whole nodes, so
  5.21 card sizing was inert in the default mode: a plan verified at 4 cards was
  reported at 16 replicas and 42% memory against a 80% target. It now keeps the
  plan, and the report matches what was solved.
- **The pool card stamp only protected the first member.** 5.21.3 claimed this
  was fixed; only the key fields were. Editing any other member of a pool reused
  the stale card count, so the same edit gave two different fleets depending on
  which row you typed in.
- Co-resident cards drew one flat teal band, dropping the pool colours the
  legend is built on. Each tenant now draws its own weights / KV / working-set
  bands in its own colour.
- A node of merged serving cards was labelled "shared / supporting" like a node
  of embedding slices, called its tenants "replica slice" in the text form, and
  emitted `var(--poolundefined)` for the selected-pool outline.
- Node headers averaged MIG slice occupancy while the cards underneath showed
  memory, printed as two bare percentages up to 24 points apart. Every cell and
  header now reports memory.
- The co-residency note could not name the two limits that actually reject a
  merge. On the reference project it blamed first-token headroom when every pair
  was over the decode-bandwidth ceiling; the binding reason is now recorded where
  the rejection happens and named with its numbers.
- `gpuFitScan` re-solved sliced pools against the slice instead of the card, and
  its memo ignored the GPU and the tuning inputs.

## Studio 5.21.3 (2026-07-27)

Solver fixes from the second and third audit lenses. One was serious.

- **The shrink loop could under-provision.** Giving replicas back was gated on
  memory and the speed targets, but turning calls away IMPROVES both, so a pool
  sized for 10,000 concurrent calls could be shrunk to a handful of GPUs that
  admitted a fraction of them and still looked healthy. Shrinking now stops the
  moment a single call would queue. Under-provisioning is worse than
  over-provisioning and this shipped in 5.21; anyone who auto-sized a
  high-concurrency project on 5.21.0 to 5.21.2 should re-run Auto-size.
- The demand cap re-checked only the speed target when trimming replicas, so it
  could still break a use case's P95 or push calls into the queue. It now checks
  both, per member.
- The MIG-sliced check passed a slice's TFLOPS where the tensor-parallel width
  belongs, wrecking the prefill term and letting sliced plans through that miss
  their P95.
- The stale-allocation stamp now covers every member of a pool and the SLO
  targets and memory-target slider, not just the first member's demand fields.

## Studio 5.21.2 (2026-07-27)

From an adversarial audit of the 5.21 co-residency and map work.

- **P95 is now judged at the speed and prefill a shared card actually gives.**
  The merge test inflated first-token time for a neighbour but still checked
  P95 against the SOLO prefill, so a card could be merged whose tenant then
  missed its P95 while the fleet reported all-clear. Both terms now use the
  same inflation.
- The band-label size test still held the pre-5.21 cell dimensions, so labels
  were hidden on cells that had room for them.
- "1 card carry more than one model" now agrees with itself.

## Studio 5.21.1 (2026-07-27)

Follow-ups from auditing 5.21 against a real project.

- **A card allocation can no longer go stale.** The exact per-pool GPU count is
  an auto-size output, so it is now stamped with the inputs it was solved
  against (model, precision, GPU, GPUs per worker, TP, concurrency, context,
  output and thinking tokens). Change any of them and that pool falls back to
  whole-node sizing until you re-run Auto-size, instead of quietly keeping an
  allocation that no longer fits.
- **Interconnect efficiency below the default is now called out, with its
  price.** The cross-node penalty is applied per pool since 5.19, so a blanket
  value under 0.85 taxes pools whose copy never leaves a node. Older builds
  wrote 0.70 into this field as a side effect of auto-size and it survives
  every re-export, so the tool measures what it costs and says so: on the
  reported project, 60 GPUs at 0.70 versus 46 at 0.85. It recommends rather
  than rewrites, because a saved input is the user's, not ours.
- Auto-size wording follows the card model: it now reports replicas and cards
  rather than nodes, since a pool no longer buys whole nodes.

## Studio 5.21 (2026-07-27)

Pools own cards, the map shows what fills them, and the tool now tells you when
the GPU is the wrong shape for the job.

- **A pool owns GPUs, not whole nodes.** Pools pack onto shared nodes anyway,
  so rounding each pool up to a full node bought cards nobody asked for: a pool
  needing two was handed eight. Auto-size now allocates an exact card count.
  On a 13-use-case project this is 11 nodes to 8, with utilization up across
  every pool (one went from 8 cards at 48% to 2 cards at 63%, same target met).
  A hand-edited worker or TP count returns that pool to whole-node sizing.
- **The fleet map shows what is actually in the memory.** Each card is stacked
  the way the ledger reads it: model weights, then KV cache, then working set,
  with the gap above left as what the speed target will not let you spend. KV
  is the part that grows with traffic and it was invisible before. Cards and
  node tiles are larger so the split is readable, and the tooltip gives the
  exact GB of each part.
- **Hardware fit is now a recommendation.** Decode is bandwidth bound, so a card
  can only hold (bandwidth x interconnect x MBU) / target tok/s of memory at the
  operating point. When that ceiling sits far below the card's VRAM you are
  buying HBM the targets forbid you from filling. The tool re-solves the whole
  project on every data-center part in the library and names the alternatives
  that serve the same load on fewer cards or less power, with pre-launch
  estimates labelled as such.

Engine parity re-verified over 44,000 comparisons.

## Studio 5.20 (2026-07-27)

Auto-size no longer capped the batch at 64 behind your back.

- The batch-per-replica control accepts up to 512, but the solver silently
  clamped its own search to 64. That forced at least `concurrent / 64`
  replicas, and every surplus replica re-reads the entire weight matrix on
  every decode step, so the fleet paid twice: more cards, and more of each
  card's bandwidth spent re-reading the same weights. A 370-call pool was
  held at 6 replicas where 4 meet the same target. The solver now searches
  up to the same ceiling the control allows and lets memory and the speed
  targets decide.
- Auto-size can also give nodes back: after growing to meet the targets it
  now shrinks again while memory and every member's target still hold, so a
  pool that overshot during the search does not keep the surplus.

On a 13-use-case project this takes the fleet from 11 nodes to 10 with every
target still met, on top of the 5.19 corrections.

## Studio 5.19.3 (2026-07-27)

Co-residency now respects first-token latency, found by the same audit.

- Sharing a card shares its prefill, so a co-tenant stretches every neighbour's
  first token by roughly 1/(1 - the share the neighbours take). 5.19.1 guarded
  P95 but not TTFT, so co-tenanted cards pushed a 500 ms first-token target to
  684 ms and a 1000 ms one to 1554 ms while the fleet still reported all-clear.
  Each merge is now checked against every tenant's own TTFT target.
- With prefill contention modelled explicitly, the blanket 20% bandwidth margin
  is gone: the decode budget runs to 95% and the latency check does the real work.
- When nothing can be shared the map now says why, in the pool's own terms
  ("only 11% first-token headroom, and a co-tenant needs more"), instead of
  silently showing dedicated cards.

Consequence worth stating: a project with tight first-token targets will not
share cards, and its honest fleet is larger than a shared one would be. The
previous release would have shared them and quietly missed the targets.

## Studio 5.19.2 (2026-07-27)

- Shared GPUs no longer read "100%". A co-resident card was labelling each
  model band with the share of its own slice that the model uses, which is
  always 100% by definition, and that meaningless label then suppressed the
  card's real figure: cards sitting at 59% of VRAM displayed 100% while their
  own node header said 59%. Shared cards now show the same memory percentage
  as every other card, and the band heights show how the card is divided.
- The fleet map now says what is actually limiting the fleet: how many cards
  carry more than one model, that a card can look empty in memory and still be
  full because decode is bound by memory bandwidth, and that dashed cells are
  unused slots on the last node because nodes are bought whole.

## Studio 5.19.1 (2026-07-27)

Co-residency hardening, found by an adversarial audit of 5.19.0.

- A card is now only shared when every tenant still meets its P95 at the speed
  it is GUARANTEED under sharing (its own target), not the higher speed it
  happens to get with the card to itself. A pool could previously pass P95
  comfortably alone and miss it once a neighbour moved in, while the fleet
  still reported all-clear.
- Pools with no per-user speed target never share: without a target there is
  no guaranteed bandwidth share to reason about.
- Two replicas of the same pool no longer stack on one card; real serving
  stacks raise the batch instead of running a second copy of the same weights.
- Fresh cards are appended as whole aligned blocks, so a tensor-parallel
  replica can no longer strand half-empty cards that were still being counted.

## Studio 5.19 (2026-07-27) · engine v25 · library v32

Fleet sizing correctness: the same project now sizes to 56 GPUs instead of 448.

A reported 11-use-case project procured 56 nodes / 448 GPUs whose cards sat at
12-37% memory with no model sharing a card. Five separate defects compounded
into that number; each was reproduced on the reported project and fixed.

- **The interconnect penalty was a global side effect.** Auto-size wrote 0.7
  into the shared interconnect-efficiency input whenever ANY pool's tensor
  parallel crossed a node boundary, so one wide model permanently taxed every
  other model's decode speed, and every later auto-size re-solved a harsher
  machine than the one it had just sized. The penalty now belongs to the pool
  whose copy actually spans workers. This alone took the project from 448 to
  144 GPUs and made auto-size idempotent: import, re-run and re-run again now
  agree, where before they gave three different fleets.
- **Pooled use cases were sized against a blended request.** A pool averaged
  all its use cases into one envelope, so a translation workload's 500 ms
  first-token target was priced against a contract-review workload's 131K
  prefill, and P95 growth paid for another member's thinking tokens. Each use
  case now keeps its own prefill, its own token budget and its own targets;
  only memory and the shared decode step are blended.
- **Tensor parallel could only widen for first-token latency.** Decode is
  memory-bandwidth bound and bandwidth scales with TP, but a pool missing a
  speed or P95 target could only add replicas, which asymptotes. The solver
  now plans at several TP widths and buys the cheapest that meets every
  target: the voice pool in the reported project went from 40 GPUs at TP1 to
  16 at TP4, same targets met.
- **The demand cap could break the target it had just been grown for.**
  Trimming replicas beyond peak demand raises batch per replica, which slows
  every user; the trim is now refused when it would cost the speed target.
- **Sliding-window attention was not modeled at all (engine v25).** Model
  entries carried raw head geometry, so Gemma 4 31B claimed 0.98 MB of KV per
  token, the largest in the library, despite being a shared-KV design whose
  global layers store no separate values. 26 entries corrected against real
  configs and checkpoint tensor shapes: Gemma 4 by up to 14.8x, Gemma 3 by
  5.3x, all eight Qwen3.5 hybrids by exactly 4x, gpt-oss by 2x, Llama 4 by
  2.3x, Command A by 2.9x, plus Fanar-2-27B and SILMA-9B which inherit Gemma
  attention. The engine now takes `kvGlobal` and `kvWin` and computes the
  window share per context, so one number no longer has to serve both a 4K
  voice call and a 128K contract. Models without those fields are bit-for-bit
  unchanged (verified over 48,000 comparisons).
- **Models can now share whole GPUs.** Where memory and bandwidth both allow,
  several models co-tenant one card, the way vLLM memory fractions and Triton
  multi-model serving do in practice. A card is shared only while each
  tenant's speed target still fits in its own bandwidth share.
- Excel exports carry the new KV terms, so the live formulas still reproduce
  the engine exactly.

Worth stating plainly, because it is physics and not a bug: a card can show
30% memory and still be full. Decode speed is bound by memory bandwidth, so a
fleet sized for per-user speed will often look empty in VRAM. The node count
was 8x too high; the low memory percentage is real.

## Studio 5.18 (2026-07-23) · library v31

Arabic across the whole stack: LLMs, VLMs and supporting models.

- Seven Arabic/GCC LLM additions (library now 101 models), configs read
  from each repo: AceGPT-v2 32B and 70B (KAUST-backed dense tiers),
  Falcon-H1R-7B (TII reasoning model with 256K hybrid-SSM context),
  Fanar-2-Oryx-IVU 7B and AIN-7B (the first hostable Arabic VLMs, from
  Qatar and the UAE), SILMA-Kashif-2B (Arabic RAG edge tier) and
  Nile-Chat-3x4B (Egyptian-dialect MoE).
- Eleven Arabic supporting models (now 54 total), every kind covered:
  Arabic-Triplet-Matryoshka-V2 embeddings, GATE-Reranker-V1, dialectal
  Whisper turbo (7 dialect groups), ArTST v3 ASR (flagged research-only),
  Tarteel Quranic ASR, SILMA TTS (MSA + English with tashkeel), Habibi-TTS
  (12 dialects), Qari-OCR (full diacritics), AIN 7B document OCR,
  Ara-Prompt-Guard (Arabic jailbreak classifier) and Nemotron Safety
  Guard 8B v3 (culturally adapted moderation incl. Arabic).
- Licenses vetted per model for on-prem commercial hosting; restricted
  ones are labeled in their notes. Excluded on license or availability
  grounds: Hala-9B and Command A (CC-BY-NC), Yehia (gated duplicate),
  Munsit (API-only), XTTS-v2 and OpenAudio (non-commercial).

## Studio 5.17 (2026-07-23) · library v30

Supporting-model library grown from 17 to 43, research-vetted.

- Every kind now spans tiny CPU-viable to flagship tiers, all open-weights
  with licenses verified for commercial self-hosting:
  - Embeddings (8): + granite-embedding-english-r2, EmbeddingGemma 300M,
    snowflake-arctic-embed-l-v2.0, Qwen3-Embedding 4B.
  - Rerankers (7): + gte-multilingual-reranker-base, mxbai-rerank-large-v2,
    zerank-1-small, Qwen3-Reranker 4B.
  - ASR (8): + Moonshine Base (61M edge), Kyutai STT 1B (streaming-native,
    400 streams per H100), Canary-Qwen-2.5B (Open ASR leaderboard leader),
    Voxtral Mini 3B, Granite Speech 3.3 8B.
  - TTS (6): + Kitten TTS Nano (15M, CPU realtime), Fun-CosyVoice3-0.5B
    (150 ms first packet), Chatterbox TTS, Dia-1.6B.
  - OCR (7): + Granite-Docling 258M, PaddleOCR-VL (OmniDocBench leader),
    MonkeyOCR-pro-1.2B, DeepSeek-OCR (~200k pages/day per A100).
  - Guards (7): + Qwen3Guard-Gen 0.6B and 4B (119 languages, severity
    tiers), ShieldGemma 2 4B (image-only, labeled as such), Granite
    Guardian 3.3 8B (adds RAG groundedness checks), Llama Guard 4 12B
    (multimodal).
- Candidates with non-commercial or research-only weights (F5-TTS,
  jina v4, Nanonets-OCR2, MinerU AGPL, VibeVoice) were evaluated and
  excluded deliberately. Capacity allowances follow the library's existing
  conventions (RTFx-derived ASR streams, pages/min OCR, per-GB guard curve).
- Defaults are unchanged, so existing projects resolve identically.

## Studio 5.16 (2026-07-23) · library v29

Preset library re-verified against 2026 production evidence.

- Three web-grounded research passes audited every field of all 20 presets
  (voice-latency literature, NVIDIA VSS RT-VLM measurements, SWE-agent and
  Cline traces, GitHub Copilot latency telemetry, OpenAI/Gemini deep-research
  norms, medical test-time-scaling studies). Twelve presets corrected:
  - Advanced RAG carries a real ~800-token thinking/tool-plan budget per
    call (was 250, roughly 3x too low for 2026 reasoning-model traces),
    at 40 tok/s and P95 45 s. Document Q&A gains a 500-token grounded
    verification budget; the clinical assistant rises to 1000 (a 250-token
    chain is not a chain).
  - Deep research no longer conflates per-task totals with the per-request
    class: ~2K thinking per call across ~40 calls (~35 min per task),
    P95 75 s per request instead of 620.
  - Code agent right-sized from traces: ~2K tokens per tool step, P95 60 s,
    two 20-30 min tasks per hour (the old traffic shape implied more agent
    seconds per hour than an hour has). IDE completion tightened to 60-token
    suggestions and a 2 s P95: slower suggestions get discarded, not read.
  - Voice streams at 50 tok/s to feed sentence-chunked TTS without gaps.
    Video presets get honest vision-token counts (a 10 s clip is ~8K tokens;
    a minute of native-sampled video is 30-47K), raising resident context.
  - Every traffic durS is now consistent with its own preset's token budget
    at its own speed target; concurrency notes updated.
- Presets that pin an exact budget now declare reasoning class Custom in
  the data itself, so "reasoning: None" can never sit next to a real
  thinking budget again (this is what made Advanced RAG look like it had
  no reasoning).
- All values still satisfy the hard consistency rule
  p95 >= 1.3 x (TTFT + (thinking + visible) / speed), verified in tests.

## Studio 5.15.3 (2026-07-23)

- Logos reworked: the ".net" no longer sits beside the wordmark; a small
  teal "gpuscale.net" line now runs underneath, in all four SVG variants
  (robot and chip marks, light and dark). The README logo is theme-aware:
  GitHub dark mode gets the dark variant.

## Studio 5.15.2 (2026-07-23)

Branding pass around the new tagline.

- Page title, meta/OG/Twitter descriptions, JSON-LD, web manifest and
  llms.txt now read "Local Open-Source GPU VRAM Calculator for Self-Hosted
  LLM Fleets".
- New social/hero card (og-card.png): wordmark, tagline and a stylized
  fleet-map motif with a MIG-shared GPU.
- README rebuilt around the same positioning with fresh screenshots from a
  real multi-use-case healthcare project (light hero, fleet map with
  per-slice memory, dark theme) and a Claude-skill feature bullet.

## Studio 5.15.1 (2026-07-23)

- Tagline: "Local Open-Source GPU VRAM calculator for self-hosted LLM fleets."

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
