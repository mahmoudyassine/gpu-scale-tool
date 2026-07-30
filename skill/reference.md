# GPUscale method reference (condensed from the white paper)

## Closed forms (engine v26)

- weights_per_replica = params_B x bytes_per_weight (GB)
- KV_per_token = 2 x layers x kv_heads_eff x head_dim_eff x bytes_KV
  (sliding-window hybrids: kvGlobal layers pay the full context, the other
  layers only a kvWin-token window, so the per-token cost falls with context)
  (sliding-window hybrids: kvGlobal layers pay the full context, the other
  layers only a kvWin-token window, so the per-token cost falls with context)
  (sliding-window hybrids: kvGlobal layers pay the full context, the other
  layers only a kvWin-token window, so the per-token cost falls with context)
  (sliding-window hybrids: kvGlobal layers pay the full context, the other
  layers only a kvWin-token window, so the per-token cost falls with context)
  (sliding-window hybrids: kvGlobal layers pay the full context, the other
  layers only a kvWin-token window, so the per-token cost falls with context)
  (sliding-window hybrids: kvGlobal layers pay the full context, the other
  layers only a kvWin-token window, so the per-token cost falls with context)
  (sliding-window hybrids: kvGlobal layers pay the full context, the other
  layers only a kvWin-token window, so the per-token cost falls with context)
  (sliding-window hybrids: kvGlobal layers pay the full context, the other
  layers only a kvWin-token window, so the per-token cost falls with context)
  (sliding-window hybrids: kvGlobal layers pay the full context, the other
  layers only a kvWin-token window, so the per-token cost falls with context)
  (sliding-window hybrids: kvGlobal layers pay the full context, the other
  layers only a kvWin-token window, so the per-token cost falls with context)
  (MLA models: kv_heads_eff=1, head_dim_eff=288 encodes the 576-dim latent;
  hybrids scale head_dim by the full-attention layer fraction)
- activations ~= min(effSeq, 8192) x hidden x 12 x bytes_W / 1e9 per replica
- overhead = 5 GB fixed + 15 GB per additional GPU INSIDE a replica
  (NCCL buffers live in one tensor-parallel communicator; independent replicas
  pay none, so a pool of TP1 replicas carries no multi-GPU overhead at all)
- fleet_need = replicas x (weights + activations) + KV_total + overhead
- capacity = replicas x TP x VRAM_per_GPU (idle GPUs when TP does not divide
  the fleet count for nothing)
- TTFT_ms ~= 2 x prompt_tokens x active_params_B / (TFLOPS_dense x TP x MFU)
- tok/s_per_user ~= BW_TBs x TP x IC x MBU x 1000 /
  (active_B x bytes_W + batch_per_replica x effSeq x KV_per_token_GB)
- admitted = min(concurrent, batch x replicas); mean latency =
  (TTFT+overhead)/1000 + (reasoning+visible)/tok_s; P95 ~= 1.3 x mean
- Defaults that survive production contact: MFU 0.5, MBU 0.65, interconnect
  0.85 in-island / 0.7 cross-node.

## Auto-size algorithm (current)

1. **Fitting width.** TP = smallest of [1,2,4,8,16,32,64,72] whose group holds
   one copy inside the memory target (default 80%), using the same inequality
   the engine enforces: `weights + activations + 5 + (TP-1) x movh <= target x
   VRAM x TP`.
2. **First-token widening.** A TTFT target widens TP further, up to the width
   that meets it. If no width meets it, the fitting width is kept and the
   target is reported as out of reach rather than buying cards for nothing.
   Widening may cross the NVLink island (priced at interconnect 0.7); widening
   for speed alone may not.
3. **Candidate sweep.** Every width from the fitting width up to GPUs-per-node
   is planned, and the cheapest plan meeting every member's targets wins. A
   wider group holds a bigger batch per replica, so this matters even with no
   speed target at all.
4. **Replicas.** Interactive: the fewest replicas admitting the peak, then the
   count each target needs, in closed form -
   `batchPerRep = (bwEff/T - activeParams x bytesW) / (effSeq x kvTok)`,
   `reps = ceil(concurrent / batchPerRep)`. Offline (no SLOs): minimal
   hardware, largest fitting batch, queueing accepted.
5. **Give-back.** Replicas that meet no target are returned, and a plan never
   reports success while missing a target it claims to meet.
6. A pool owns **cards**, not whole nodes; nodes are packed from the cards of
   every pool plus the supporting models.

## Workload classes

Run `--list-workloads` for the shipped presets with their exact numbers; do not
quote from memory. The 2026 conventions they follow (per-token intervals turned
into tok/s):

chat 300ms/20tps · RAG chat 400ms/12.5 · voice (the LLM's share of a 400ms p50
voice budget) 150-250ms/33 · inline code completion 100ms/40 · panel completion
300ms/20 · batch 3s/5 · reasoning interactive 1.5-2s/67 (MLPerf v6 TPOT 15ms) ·
reasoning server 2-3s/12.5 (TPOT 80ms) · frontier dense server 6s/5.7 (TPOT
175ms). Agentic requests carry 2-5K tokens of tool schema EVERY call and
retrieval adds 2-10K; whole tasks run 50K (code review) to 500K (multi-agent
research) tokens across many calls, so size the call, not the task.

Concurrency from headcount: sessions x turns/hr x calls/turn x duration_s
/ 3600 x burst (1.5-3x).

## Hardware quick table (dense figures)

A100 80GB 2.0TB/s 312TF BF16 (no FP8) · H100 80GB 3.35TB/s 1979TF FP8 ·
H200 141GB 4.8TB/s (same die) · MI300X 192GB 5.3TB/s · B200 180GB 8TB/s ·
B300 288GB 8TB/s · MI355X 288GB 8TB/s · 2026: VR200 288GB HBM4 ~20TB/s,
MI455X 432GB 19.6TB/s (pre-launch estimates). NVLink island: 8 (HGX) or 72
(NVL72/Helios rack). Halve any "with sparsity" TFLOPS claim.

## Resilience economics

Guaranteed = what survives the covered failure; never grows with redundancy.
n 1x · n1 +1 worker · n2 +2 · nn 2x mirror · dr 2x standby site · drh 1.5x
(halves on site loss) · aas 1x split sites (halves on site loss) · aas1/aass
split + spares · aa 2x each-site-full · aan1 2N+2 · nndr 4x. Active/active
normal-day capacity is real burst but must not carry planned load.

## Sources

Method and numbers: https://gpuscale.net (MIT, open source) and the white
paper "Sizing the Modern GenAI Data Center" (Yassine, 2026). Key research
anchors: DeepSeek-V2/V3 papers (MLA, MTP), vLLM SOSP 2023 (PagedAttention),
DistServe/Mooncake (disaggregation), MLPerf Inference v6.0 latency constraints,
vendor datasheets restated dense. The per-preset SLO evidence and the July 2026
review of every workload class are in docs/PRACTICES.md in the repository.

Not modeled, and worth saying out loud when it matters: prefix caching (a large
shared system prompt is still sized for a full prefill every call), speculative
decoding (1.3-2x decode when draft acceptance >= 0.7), pipeline parallelism, and
prefill/decode disaggregation. Each of these makes the real deployment cheaper
or faster than the estimate, never worse.
