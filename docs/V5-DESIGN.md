# GPUscale v5 · design and build plan

Status: LOCKED · Batch 0 research done (3 researchers + 3-judge UX panel).
Branch: `v5`. Main stays on 4.x and keeps deploying until v5 ships whole.

## Batch 0 verdict (locked decisions)

All three judges (novice 40/50, expert 39/50, mobile 38/50) chose **Flow A:
guided sections evolved from the v4 rail** over a step wizard (B) and
hardware-first budgeting (C), on the same grounds: it preserves the tool's
soul (touch anything, see everything move), keeps v4 muscle memory and JSON
migration nearly free, and never taxes the expert's tweak-check-tweak loop
with navigation. Conditions attached by the panel, all adopted:

1. **Card list + bound editor.** Station 1 becomes USE CASES: a list of
   compact cards (name, type, model, live chips: share of fleet, derived
   concurrency, SLO pass dot, pooled badge). Selecting a card binds the
   existing Model / Precision / Workload stations to it ("Editing: Voice
   agent"). One editor, N cards; zero accordion churn; v4 layout intact.
2. **Users, not concurrency, in Normal mode.** Card asks "people using this
   at peak"; Little's law runs silently; derived concurrent calls shown as
   read-only fine print. Advanced exposes the full estimator drawer.
3. **Pooling is loud and steerable.** Same model+weightQuant+kvQuant ->
   pooled badge on every member card and one merged pool in results; a
   "Reuse <model> from <card>" one-tap chip appears when models differ;
   Advanced gets a per-card "Isolate deployment" override.
4. **Support attachment is loud.** Auto-attached chips announce via
   aria-live, each removable; Advanced can swap the model per chip.
5. **Sticky mobile mini-results bar** (stolen from Flow B): verdict lamp ·
   GPUs · kW pinned at the bottom under 1020px, aria-live polite,
   safe-area aware, tap scrolls to canvas.
6. **Headroom, not overflow** (stolen from Flow C): remaining-capacity
   strip in results; Advanced "Fleet is fixed" pins counts and turns
   Auto-size into a suggest-only diff that never overwrites.
7. **Normal mode diet**: resilience collapses to three plain choices (None /
   Survives a server failure / Survives a site outage); Auto-size runs
   automatically (debounced) with the button hidden; jargon fields hidden.
8. **Fleet map ships in two synchronized forms**: visual node/GPU grid
   (own overflow-x container) and a semantic nested list (screen-reader and
   compact-mobile default). Color plus label, never color alone.

## What v5 is

One project, many use cases, one fleet. A project holds N use cases (each
with a workload, its own concurrency, and a main model); identical
model+precision across use cases is served by one shared pooled deployment;
supporting models (embeddings, rerankers, ASR, TTS, OCR) attach to use cases
automatically and land on GPU partitions (MIG or fractional); hardware is
chosen once; results show the whole fleet down to each GPU's assignment.
Two experience modes: Normal (minimum decisions, curated defaults) and
Advanced (every control of v4 plus the new surface).

## Non-negotiables carried from v4

- Dependency-free static site; everything client-side; nothing uploaded.
- Live results on every input change; no compute button.
- Per-input help (the i buttons) preserved and extended to every new input.
- Mobile first-class at 390px; print/PDF first-class; dark mode complete.
- Exports (JSON/XLSX/PDF) complete and re-importable; old files import.
- Engine honesty: peak closed forms, dense TFLOPS, guarantee-based resilience.
- No em-dashes anywhere. No filler prose anywhere.

## State model (schema gpuscale.net/5)

```
project {
  id: "Project_ab123", name, mode: "normal"|"advanced",
  usecases: [ {
    id, name, type,                 // type keys usecases.js
    users|concurrent (+estimator fields),
    model, weightQuant, kvQuant,    // main model
    residentSeq, visibleOut, reasoning{...}, slo{...},   // advanced overrides
    supports: [ {kind, model, count, enabled} ],          // auto + editable
  } ],
  hardware: { gpu, perW, resilience, targetPct },
  tuning: { mfu, mbu, ic, ovh },    // advanced only
  results snapshot on export (per pool + per usecase + fleet)
}
```

Pooling rule: usecases group by (model, weightQuant, kvQuant, kvPolicy).
Each pool is sized once for the combined load (Batch 3 defines the math).
Support models never pool across kinds; same kind+model shares instances.

## Build batches

Each batch ends verified (node --check, engine harness, headless screenshots
at 1440/768/390, print PDF, dark) and committed on `v5`. No batch ships to
main until Batch 7 signs off the whole.

- **Batch 0 · Research and flow decision.** Web research: supporting-model
  footprints; MIG/partition matrix per GPU; competitive scan. UX: three-judge
  panel scores three candidate flows (guided sections / wizard with live
  preview / hardware-first). Output: this doc completed, flow locked,
  support library drafted, gpus.js partition fields drafted.
- **Batch 1 · Foundation.** Project state object + pub/sub refresh replacing
  implicit DOM reads; scenario->project rename everywhere (IDs, exports,
  labels); mode toggle plumbing (html[data-ux-mode], CSS gating, persistence
  via localStorage with privacy wording updated); v3/v4 JSON import mapped
  into a one-usecase project. Site remains fully functional single-usecase.
- **Batch 2 · Use-case builder.** Cards list (add/duplicate/rename/remove,
  cap 6); card editor per the chosen flow (inline expand desktop, full-screen
  modal mobile, focus-trapped); per-card model+precision; shared-model badge
  when pooling triggers; support-model auto-attach chips with per-chip
  disable and model swap (advanced); data/support.js + usecases.js `supports`
  mapping + gpus.js `part` fields (library v26).
- **Batch 3 · Engine and solver.** Multi-pool engine wrapper: per-pool
  combined sizing (sum concurrency, per-usecase KV terms, per-usecase
  envelopes at pool batch), fleet totals; support allocator (MIG slices
  first, fractional/time-slice fallback, whole small GPU last, N+1 option in
  advanced); project-level auto-size (per pool, then supports, then
  resilience roll-up); engine version v24 with harness parity tests.
- **Batch 4 · Results.** Fleet map: node grid, each GPU rectangle colored by
  pool (legend per model), MIG mosaics for support slices, spares dashed;
  per-usecase result cards (envelope + SLOs at pool batch); project verdict,
  economics, plain-words rewritten for multi-usecase; recommendations
  extended (pool-aware, support-aware).
- **Batch 5 · Exports.** JSON v5 (+import of v3/v4/v5); XLSX: project sheet,
  one sheet per pool, supports sheet, fleet-map image; PDF: project cover
  block, per-usecase sections, fleet map; filenames Project_ab123.
- **Batch 6 · Modes, mobile, polish.** Normal-mode curation audit (every
  visible control justified; defaults from presets; simple resilience
  choices), Advanced parity with v4 power; modal a11y pass; 390/768/1024/1440
  sweeps light+dark; print; perf (target: interactive under 150 ms on Pi
  Chromium).
- **Batch 7 · QA and release.** Harness regression matrix (v4 single-usecase
  scenarios must reproduce engine v23 numbers within stated deltas; new
  multi-pool cases hand-checked); import matrix (v3/v4/v5 files); docs
  (README, DATA.md, llms.txt, skill regeneration); CHANGELOG 5.0.0; merge to
  main, tag, deploy gpuscale.net + mirror, live verify.

## Support-model library (data/support.js, from Batch 0 research)

Six kinds. Each kind has a default model plus alternates (Advanced can swap).
`unitVram` = GB one serving instance needs; `unitCap` = concurrent calls one
instance absorbs (planning allowance, help text says so honestly).

| kind   | default model             | unitVram | unitCap | alternates |
|--------|---------------------------|---------:|--------:|------------|
| embed  | BGE-M3 (568M)             | 2.5      | 200 q/s class, plan 400 users | Qwen3-Embedding 0.6B (1.5), 8B (16), nomic-embed v1.5 (0.8) |
| rerank | bge-reranker-v2-m3 (568M) | 2.5      | 50 (cross-encode is the RAG hot spot) | Qwen3-Reranker 0.6B (1.5), 8B (16) |
| asr    | Whisper large-v3-turbo    | 1.6      | 4 live streams | Parakeet-TDT 0.6B (1.0, batch champion), Canary-1B-v2 (6.4, +translate) |
| tts    | Kokoro-82M                | 1.0      | 10 live streams | Orpheus-3B (6.0, streaming/expressive) |
| ocr    | PaddleOCR PP-OCRv5        | 2.0      | 8 concurrent docs (~190 pages/min) | dots.ocr 3B (8.0, layout VLM), olmOCR-2 (16.0) |
| guard  | Llama Guard 3 1B          | 2.5      | 30 concurrent chats | Llama Guard 3 8B FP8 (10.0) |

Use-case type -> auto-attached kinds (stable industry convention):
RAG / knowledge assistant: embed + rerank. Voice agent: asr + tts.
Document Q&A / intake: ocr + embed + rerank. Customer-facing chat: guard.
Code assistant: embed. Summarization / batch / offline: none.

Instances per kind = ceil(summed peak demand across attached use cases /
unitCap), min 1; same kind+model shares instances across use cases.

## Partitioning matrix (gpus.js `part` field, from Batch 0 research)

`part:{kind, max, min}`: kind mig|cpx|frac|whole, max = instances per GPU,
min = smallest slice GB.

- MIG 7-slice: A100 40 (min 5), A100 80 (10), H100 80 (10), H100 NVL (12),
  GH200/H100-96 (12), H200 141 (18), B200 (23), GB200 (23), B300 (34),
  GB300 (35). MIG 4-slice: A30 (6), RTX PRO 6000 Blackwell (24).
- AMD cpx: MI300X (8 x 24), MI325X (8 x 32), MI350X/MI355X (8 x 36).
- frac (time-slice/MPS, no isolation, note shown): L4, L40, L40S,
  RTX 6000 Ada, RTX 4090, RTX 5090 and other non-MIG parts.
- whole (no sharing): Gaudi 3.

Allocator ladder: pack support instances onto dedicated support GPUs using
the smallest slice >= unitVram (MIG/cpx); on frac parts co-locate up to
~90% of VRAM with an isolation note; on whole parts each support GPU hosts
all kinds together, ceil(total support VRAM / card VRAM) cards. Support
GPUs are additional serving GPUs: they join fleet totals, power and the
fleet map (rendered as slice mosaics) but never join main-pool TP math.
