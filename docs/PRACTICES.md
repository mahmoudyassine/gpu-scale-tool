# Serving practice the presets are grounded in (2026 review)


> How these presets are used in sizing, end to end:
> [the manual](https://gpuscale.net/manual.html).

The workload presets in `data/usecases.js` are not opinions. Each one's SLO
targets, context length and token budgets trace to published production
guidance or a benchmark standard. This file records that evidence, the review
done in July 2026, and the gaps the review found, so the next person changing a
preset can see what it was calibrated against instead of guessing.

Two rules govern every entry:

1. **Self-consistency.** `p95Target >= 1.3 x (ttftTarget/1000 + (reasonTok +
   visibleOut) / tpsTarget)`. A preset may never demand a P95 that its own
   first-token and speed targets make arithmetically impossible. Verify with
   `python3 tools/check_presets.py`.
2. **Per request, not per task.** Every field describes ONE model call. An
   agent that makes forty calls is forty of these, and the concurrency
   estimator (`traffic`) is what turns tasks into simultaneous calls.

## The 2026 evidence table

Latency conventions have converged since the v28 review. Sources cited below
give per-token intervals (ITL/TPOT); the studio's `tpsTarget` is their
reciprocal, so 50 ms ITL is 20 tok/s and 15 ms is 67 tok/s.

| Class | TTFT | Per-token | As tok/s | Source |
|---|---|---|---|---|
| Interactive chat | 300 ms p99 | 50 ms ITL | 20 | Spheron SLO guide 2026 |
| RAG-augmented chat | 400 ms p99 | 80 ms ITL | 12.5 | Spheron SLO guide 2026 |
| Voice agent | 150 ms p99 | 30 ms ITL | 33 | Spheron SLO guide 2026 |
| Code completion, inline | 100 ms p99 | 25 ms ITL | 40 | Spheron SLO guide 2026 |
| Code completion, panel | 300 ms p99 | 50 ms ITL | 20 | Spheron SLO guide 2026 |
| Batch / async | 3,000 ms | 200 ms ITL | 5 | Spheron SLO guide 2026 |
| Reasoning, interactive | 1.5-2.0 s p99 | 15 ms TPOT | 67 | MLPerf Inference v6.0 |
| Reasoning, server | 2.0-3.0 s p99 | 80 ms TPOT | 12.5 | MLPerf Inference v6.0 |
| Frontier dense, server | 6 s p99 | 175 ms TPOT | 5.7 | MLPerf Llama 3.1 405B |

Supporting facts the review relied on:

- **Voice budget decomposition.** A voice turn is roughly 80-120 ms STT, 150-250
  ms LLM first token, 60-100 ms TTS first chunk, 20-60 ms transport. Production
  targets are p50 under 400 ms and p95 under 800 ms voice-to-voice; the measured
  2026 fleet median was 680 ms p50 / 1,180 ms p95. Native speech-to-speech models
  reach 160-400 ms end to end. The LLM's share of that budget is what the preset
  encodes, not the whole turn.
- **Agentic token consumption.** Tool schemas cost 2,000-5,000 tokens on *every*
  request; retrieval adds 2,000-10,000 per query. Whole tasks run far larger: a
  code review agent about 50,000 tokens per review, a browser/computer-use agent
  about 200,000 per task, a multi-agent research pipeline about 500,000 per
  report. Twenty tool calls cost nearer 200x a single call than 20x, because
  each turn re-sends the accumulated transcript.
- **Reasoning budgets.** GSM8K and MATH-500 reach 95% of uncapped accuracy at
  256 thinking tokens; harder work needs more. Anthropic's `budget_tokens`
  spans 10K-100K with a 1,024 minimum, and the newest models make the budget
  adaptive rather than caller-set. MLPerf's reasoning benchmarks cap output at
  10,240 tokens.
- **Speculative decoding** yields 1.3-2x decode speedup when draft acceptance is
  at or above 0.7, and MLPerf v6.0 made it a sanctioned technique for the
  DeepSeek-R1 interactive scenario.
- **Utilization and cost.** Holding peak utilization at or below 70% is the
  stated precondition for a 400 ms TTFT target, and tightening 500 ms to 200 ms
  costs roughly 35% more infrastructure. This is the same trade the studio's SLO
  optimiser prices, from the other direction.

## Review outcome, preset by preset

Verdict key: **OK** matches current practice · **TIGHTEN**/**LOOSEN** the number
should move · **GAP** a class the library does not cover.

| Preset | Now (ttft / tps / p95) | Verdict | Evidence |
|---|---|---|---|
| Simple chatbot | **300** / 20 / 18 | APPLIED 5.26.0 (was 400) | Interactive chat is 300 ms p99 in 2026 guidance; 20 tok/s is exactly the 50 ms ITL convention |
| Simple RAG | **400** / 25 / 18 | APPLIED 5.26.0 (was 800) | RAG chat is 400 ms p99; retrieval latency is a separate budget line, not an excuse for a slower first token |
| Advanced RAG | 1200 / 40 / 45 | OK | Agentic RAG adds planning and verification passes; the 800-token reasoning budget matches an o-class trace |
| Internal GPT / Copilot | 600 / 25 / 18 | OK | Between chat and RAG; sits in the band |
| Document Q&A | 2500 / 30 / 40 | OK | Long grounded prefill legitimately relaxes TTFT |
| Document generation | 1000 / 40 / 70 | OK | 2,000 visible tokens at 40 tok/s is 50 s of streaming, inside the 70 s promise |
| Code generation (inline) | **100** / 60 / 2 | APPLIED 5.26.0 (was 300) | This preset's 60-token output is inline completion, where 2026 practice is 100 ms p99 and 25 ms ITL (40 tok/s). A panel-completion variant at 300 ms / 20 tok/s is the other half of the class |
| Code agent | 1000 / 50 / 60 | OK, note the schema tax | Per tool step is right; consider raising `resident` to cover the 2-5K tokens of tool schema every step carries |
| Voice agent | **200** / 50 / 3.5 | APPLIED 5.26.0 (was 300) | The LLM's share of a 400 ms p50 voice budget is 150-250 ms; 50 tok/s is above the 33 tok/s convention and safe |
| Reasoning light | 600 / 60 / 55 | OK | 60 tok/s sits just under MLPerf's 67 tok/s interactive reasoning bar |
| Reasoning heavy | 800 / 60 / 200 | OK | MLPerf caps reasoning output at 10,240 tokens; the preset's 8,000-token Heavy class is inside that |
| Video summarization | 3000 / 40 / 90 | OK | Vision prefill dominates; unchanged |
| Long-doc analysis | 5000 / 30 / 90 | OK | 64K prefill justifies the 5 s first token |
| Offline batch | 0 / 0 / 0 | CONSIDER 3000 / 5 / 0 | Batch has a published convention now (3 s TTFT, 200 ms ITL). Leaving the targets off keeps the preset a pure throughput sizing, which is still defensible |
| Deep research | 1000 / 50 / 75 | OK per call | The 500K tokens per report is a *task* total across many calls; the preset correctly models one call |
| Medical imaging report | 1500 / 50 / 15 | OK | Unchanged from the v29 clinical review |
| Clinical knowledge | 800 / 40 / 50 | OK | Unchanged |
| Real-time video analytics | 700 / 40 / 4 | OK | Frame-rate driven, not reading-speed driven |
| Translation | 500 / 40 / 18 | OK | Unchanged |
| Contact-center assist | 400 / 40 / 3 | OK | Agent-facing suggestions, tighter than the caller-facing voice path |

### Classes added in 5.26.0

Four of the five gaps this review found are now presets. Each is a distinct
sizing shape, not a variant of an existing one, and each is sized PER REQUEST.

| Preset | ttft / tps / p95 | Shape | Grounding |
|---|---|---|---|
| Computer-use / browser agent | 2000 / 30 / 60 | 64K resident, 200 visible, 1,000 thinking | One step of a task that runs about 200K tokens; each step re-sends the transcript plus 2-5K of tool schema and answers with a short tool call |
| Speech-to-speech (native audio) | 200 / 50 / 5 | 4K resident, 150 audio tokens out, KV pinned | Native stacks reach 160-400 ms voice-to-voice against 1-2 s for an STT/LLM/TTS pipeline, so the whole budget sits on one model and no ASR or TTS is attached |
| Code review agent | 3000 / 30 / 110 | 64K resident, 800 out, 1,500 thinking | About 50K tokens of prefill for a 2,000-line pull request, one long think, a page of comments |
| Code completion (panel) | 300 / 20 / 18 | 8K resident, 250 out | The relaxed half of the completion class: read rather than accepted inline |

### The last gap, closed in 5.27.0

**Prefix-cache-aware sizing.** The review's largest finding was that the studio
had no notion of a cache hit, so a workload with a large shared system prompt
was sized for a full prefill on every call. Every production stack caches that
prefix (vLLM, SGLang and TensorRT-LLM all ship automatic prefix caching), which
cuts first-token time and prefill compute for exactly the workloads whose TTFT
targets are hardest to meet, agentic loops most of all: a 2-5K tool schema
repeats verbatim every step, and step N+1's prompt is step N's prompt plus one
observation.

Engine v27 models it. A per-use-case **shared cached prefix** fraction splits
the sequence: `floor(resident x fraction)` is prefilled once and held once per
replica, the remainder is charged per call. TTFT falls with the prefill, KV
memory falls with the duplication, and **decode is not discounted** because a
call still re-reads its whole context on every generated token. The formulas are
in [DATA.md](DATA.md#engine-v27-prefix-caching).

Three decisions kept it honest:

- **Zero by default.** A hit rate is a fact about the serving stack, not about
  the workload class, so no preset ships one and no existing project moved. At
  zero the engine is byte-identical to v26, verified over 9,000 comparisons.
- **Offered, never assumed.** Where a pool carries 8K+ resident tokens and no
  fraction set, the optimiser prices 30% and 60% by re-solving the whole project
  and offers whichever actually deliver, labelled with what they buy: GPUs off
  the order, or first-token headroom. The recommendation says outright that it
  should only be accepted if the stack has prefix caching enabled.
- **Guidance, not a number.** The field's help text carries the observed bands
  (agent loops 40-80%, RAG 10-30%, unique documents 0%) so the user supplies a
  measured hit rate rather than inheriting a guess.

### Typical shared-prefix fractions

Bands only. Measure yours; vLLM and SGLang both report cache hit rate.

| Workload | Shared prefix | What repeats |
|---|---|---|
| Agent / tool loop | 40-80% | Tool schemas (2-5K tokens) plus the transcript so far, verbatim each step |
| Code agent on one repo | 40-70% | System prompt, tool schemas, the file map |
| RAG chat | 10-30% | System prompt and instructions; retrieved chunks differ per query |
| Chat with a long system prompt | 20-50% | The system prompt across every turn of every session |
| Document Q&A on one document | 60-90% | The document itself across a question series |
| One-off document processing | 0% | Nothing; each call is a new document |

## What was deliberately not changed

- **The tpsTarget convention stays per-user streaming speed**, not aggregate
  throughput. Every source above quotes per-token intervals per user.
- **P95 stays at 1.3x mean.** The engine's P95 is a fixed multiplier, not a
  measured tail. It is documented as such in the CLI and the report footer, and
  a real deployment should validate the tail with GenAI-Perf or vLLM bench.
- **Decode speed is not discounted by prefix caching.** Only prefill and KV
  memory are. Paged-attention kernels that read shared blocks once per batch
  exist, but they are not universal, and decode bandwidth is the number that
  sizes most fleets: being optimistic there would be the expensive kind of wrong.
- **Preset numbers were changed only with sign-off, and only the four the
  evidence moved.** Everything marked OK above is untouched. Saved projects
  reference presets by NAME, not by index, so appending the four new classes
  cannot disturb an existing project; the four corrected targets only apply to
  a card when its preset is re-selected.

## Sources

- Spheron, *LLM Inference SLO Engineering: TTFT, ITL, and P99 Latency Budgets
  for Production AI (2026)*
- MLCommons, *MLPerf Inference v6.0* results and the March 2026 GPT-OSS /
  DeepSeek-R1 latency-optimized reasoning announcement
- MLCommons, *MLPerf Inference v5.0 / 5.1* interactive-scenario constraints
- BentoML, *LLM Inference Handbook: key metrics for LLM inference*
- vLLM blog, *Prefill-Decode Disaggregation* (2026) and *Inside vLLM*
- llm-d, *KV-Cache Wins You Can See: prefix caching to distributed scheduling*
- AgentMarketCap, *The AI Agent Token Consumption Gap* (April 2026)
- Hamming AI, Telnyx and DestiLabs 2026 voice-agent latency benchmarks
- Redis, *Token-Budget-Aware LLM Reasoning*; arXiv 2504.09858 on thinking budgets
