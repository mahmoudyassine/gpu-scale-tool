# Serving practice the presets are grounded in (2026 review)

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
| Simple chatbot | 400 / 20 / 18 | TIGHTEN ttft to 300 | Interactive chat is 300 ms p99 in 2026 guidance; 20 tok/s is exactly the 50 ms ITL convention |
| Simple RAG | 800 / 25 / 18 | TIGHTEN ttft to 400 | RAG chat is 400 ms p99; retrieval latency is a separate budget line, not an excuse for a slower first token |
| Advanced RAG | 1200 / 40 / 45 | OK | Agentic RAG adds planning and verification passes; the 800-token reasoning budget matches an o-class trace |
| Internal GPT / Copilot | 600 / 25 / 18 | OK | Between chat and RAG; sits in the band |
| Document Q&A | 2500 / 30 / 40 | OK | Long grounded prefill legitimately relaxes TTFT |
| Document generation | 1000 / 40 / 70 | OK | 2,000 visible tokens at 40 tok/s is 50 s of streaming, inside the 70 s promise |
| Code generation | 300 / 60 / 2 | TIGHTEN ttft to 100 | This preset's 60-token output is inline completion, where 2026 practice is 100 ms p99 and 25 ms ITL (40 tok/s). A panel-completion variant at 300 ms / 20 tok/s is the other half of the class |
| Code agent | 1000 / 50 / 60 | OK, note the schema tax | Per tool step is right; consider raising `resident` to cover the 2-5K tokens of tool schema every step carries |
| Voice agent | 300 / 50 / 3.5 | TIGHTEN ttft to 200 | The LLM's share of a 400 ms p50 voice budget is 150-250 ms; 50 tok/s is above the 33 tok/s convention and safe |
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

### Gaps: classes the library does not cover

Each of these is a distinct sizing shape, not a variant of an existing preset.

1. **Computer-use / browser agent.** About 200,000 tokens per task across many
   steps, each step carrying tool schemas and screenshots. Sizing shape: very large
   `resident` (64-128K), small visible output, loose TTFT, and a `traffic` entry
   whose turns-per-task is high. Nothing in the library models a step of a
   long-running autonomous task.
2. **Native speech-to-speech.** 160-400 ms voice-to-voice with audio tokens in
   and out, no STT/TTS support models attached. Materially different from the
   pipeline the current voice preset describes.
3. **Code review agent.** About 50,000 tokens per review, a single very large
   prefill against a whole diff, one modest answer. Between long-doc analysis
   and the code agent, and closer to neither than it looks.
4. **Panel code completion.** The 300 ms / 20 tok/s half of the completion
   class, distinct from the inline 100 ms / 40 tok/s case.
5. **Prefix-cache-aware sizing.** Not a preset: the studio has no notion of a
   cache hit, so a workload with a large shared system prompt is sized for a
   full prefill every call. Modelling a hit rate would reduce TTFT and prefill
   compute honestly, and is the single largest modelling gap this review found.

## What was deliberately not changed

- **The tpsTarget convention stays per-user streaming speed**, not aggregate
  throughput. Every source above quotes per-token intervals per user.
- **P95 stays at 1.3x mean.** The engine's P95 is a fixed multiplier, not a
  measured tail. It is documented as such in the CLI and the report footer, and
  a real deployment should validate the tail with GenAI-Perf or vLLM bench.
- **Preset numbers were not silently edited during this review.** Changing them
  moves every saved project that uses them, so the table above is a proposal
  for sign-off, not a changelog of applied edits.

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
