# GPUscale method reference (condensed from the white paper)

## Closed forms (engine v23)

- weights_per_replica = params_B x bytes_per_weight (GB)
- KV_per_token = 2 x layers x kv_heads_eff x head_dim_eff x bytes_KV
  (MLA models: kv_heads_eff=1, head_dim_eff=288 encodes the 576-dim latent;
  hybrids scale head_dim by the full-attention layer fraction)
- activations ~= min(effSeq, 8192) x hidden x 12 x bytes_W / 1e9 per replica
- overhead = 5 GB fixed + 15 GB per additional GPU
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

## Auto-size algorithm

1. TP = smallest of [1,2,4,8,16,32,64,72] whose group holds one copy within
   the memory target (default 80%). A TTFT target widens TP (prefill scales
   with TP).
2. Interactive workloads (any SLO set): fewest workers admitting the peak
   concurrency at batch <= 64, grown until the target is met. No SLOs =
   offline: minimal workers, largest fitting batch, queueing accepted.
3. Cross-island TP sets interconnect 0.7 and should be called out; real
   systems use in-island TP plus pipeline parallelism (not modeled).

## Workload classes (defaults)

chat 4K/400 out, TTFT 500ms, 25 tps, P95 15s · voice 4K/200, 300ms/50/3s ·
RAG 8-32K/700-1500, 0.6-1.5s/25/20-45s · copilot 16K/800, 1s/25/30s ·
code agent 64K/2000 +2K reasoning, 2s/30/180s · heavy reasoning 16K/1500
+8K, 1s/30/240s · deep research 64K/4000 +8K, 3s/25/600s · batch: no SLOs.
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
DistServe/Mooncake (disaggregation), MLPerf Inference SLOs, vendor datasheets
restated dense.
