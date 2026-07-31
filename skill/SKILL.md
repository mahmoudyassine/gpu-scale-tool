---
name: gpu-sizing
description: LLM/GenAI GPU capacity sizing with the GPUscale engine. Use for any question about how many GPUs a model needs, VRAM/memory fit, KV cache size, tensor parallelism vs replicas, inference latency/throughput estimates (TTFT, tok/s), SLO feasibility, resilience topologies (N+1, DR, active/active), fleet power, or "can model X run on hardware Y". Runs a bundled CLI with the exact engine and libraries from gpuscale.net instead of estimating by hand.
---

# GPU sizing with the GPUscale engine

You have the actual GPUscale.net sizing engine (engine v27, library v35: 101
models, 37 GPUs) as a CLI in this skill's directory. For ANY numeric sizing
question, run it; never hand-compute what the CLI can compute.

## Running the engine

```bash
node ~/.claude/skills/gpu-sizing/sizing.mjs --list-models     # find exact model names
node ~/.claude/skills/gpu-sizing/sizing.mjs --list-gpus
node ~/.claude/skills/gpu-sizing/sizing.mjs --list-workloads  # preset workload classes

# "How many GPUs do I need?" -> auto mode (solves TP, workers, batch from the workload)
node ~/.claude/skills/gpu-sizing/sizing.mjs --model "DeepSeek-V3" --gpu B300 --quant FP8 \
  --workload "Internal GPT" --concurrent 377 --auto --resilience n1

# "Does X fit on Y?" -> explicit mode
node ~/.claude/skills/gpu-sizing/sizing.mjs --model "Llama 3.1 70B" --gpu "H100 80GB SXM" \
  --quant FP8 --resident 16384 --out 800 --concurrent 64 --workers 1 --tp 8 --batch 16

# Machine-readable
... --json
```

Flags: `--quant` FP32|BF16|FP8|NV FP4|MXFP4|INT8|Q4_K_M|... · `--kv` BF16|FP8|INT4 ·
`--resident/--out/--reasoning` tokens · `--ttft/--tps/--p95` SLO targets ·
`--cache` percent of the resident sequence that is byte-identical every call
(prefix caching: prefilled once, held once per replica; default 0 = full prefill
every call, and only set it if the serving stack has prefix caching on) ·
`--call-minutes` average conversation length, which for a session workload derives
the resident sequence as `prompt + tok/min x minutes` (add `--tok-min`,
`--prompt-tok`, `--basis peak|mean`; a named `--workload` supplies the defaults) ·
`--perw` GPUs per server (8 = HGX, 72 = NVL72 rack) · `--target` auto-size
memory ceiling percent (default 80) · `--resilience` n|n1|n2|nn|dr|drh|aa|aas|aas1|aass|aan1|nndr.

**Give the user something clickable.** After you report the numbers, offer the
same workload as a studio link, which they can open, edit and share:

```
https://gpuscale.net/#p=t:gpu=H200+141GB+NVL;perw=8;resil=n1;uc=Support+chat;model=Llama+3.3+70B;quant=FP8;preset=Simple+RAG;users=2000
```

`key=value` pairs separated by `;`, one `uc=` per use case, spaces written `+`.
The studio re-solves the topology on import, so send the workload, not the
hardware. Full key table and rules: <https://gpuscale.net/docs/URL-FORMAT.md>.

## The mental model (explain with the numbers, in this order)

1. **Three currencies.** Compute (TFLOPS) is spent by prefill and sets time to
   first token. Memory bandwidth (TB/s) is spent by decode and sets tok/s per
   user. Memory capacity (GB) holds weights once per replica plus every
   admitted conversation's KV cache, and decides how many conversations exist.
2. **TP distributes, workers replicate.** One model copy spans exactly TP
   GPUs. Every additional TP-group is another full copy serving more users,
   never more room for one copy. If a copy does not fit its TP group, adding
   workers changes nothing; the fixes are more TP, fewer bytes per weight, a
   bigger-memory GPU, or a smaller model.
3. **The master inequality.** replicas x (weights + activations) + total KV +
   overhead must fit in replicas x TP x VRAM-per-GPU. Weights = params x
   bytes/param. KV/token = 2 x layers x effective-KV-heads x head-dim x bytes
   (the library encodes MLA and hybrid models with effective geometry).
4. **Admission.** admitted = batch x replicas; calls beyond it queue. Sizing
   for concurrency means buying replicas, and each replica re-buys the model.
5. **Resilience buys survival, not speed.** Quoted figures are what survives
   the covered failure. Spares idle; active/active adds burst headroom that
   must not carry planned load; split variants halve capacity on site loss.
6. **Peak vs achieved.** All outputs are peak closed-form estimates;
   production reaches 70 to 90 percent. Say so, and recommend vLLM bench /
   GenAI-Perf before purchase decisions.
7. **Which promise buys the hardware.** A P95 target on a long generation
   implies a per-user speed of `gen / (p95/1.3 - firstTokenSeconds)`. When that
   exceeds the stated tok/s target, the tok/s target is not the lever: no
   reduction of it changes the fleet, and only the P95 (or shorter output) can.
   Check this before suggesting a speed change; it is the single most common
   reason a fleet is larger than the user expects.
8. **An empty-looking card is usually correct.** At the operating point a card
   carries `bandwidth x interconnect x MBU / achieved tok/s` GB, independent of
   TP. It sits emptier than that whenever the replica count is set by something
   other than decode bandwidth: a first-token target that widened the group, or
   one replica already admitting the peak. Low memory percent is rarely the
   problem; a high card count is the thing to question.

## Answer style

- Lead with the fleet in one sentence: serving cards on N nodes, replicas x TP,
  batch, admitted calls, fits or not, headline latency and speed. The CLI counts
  CARDS (a pool owns cards; nodes are packed from them), and reports procured
  nodes separately once resilience is applied.
- Then walk the arithmetic the way the CLI's story lines do: copy weight at
  the chosen quant, GPUs for one copy, copies for concurrency, KV, envelope,
  procurement. Use the story lines directly; they are written for this.
- Flag workload contradictions honestly: generated tokens divided by
  achievable tok/s is a latency floor no hardware removes (8K reasoning
  tokens can never meet a 3 s P95). When the CLI prints an `sloStuck` note, say
  which target is out of reach and whether it fails alone at batch 1 (no fleet
  can meet it) or only at this concurrency (it would need more replicas than the
  hardware allows).
- Never quote sparsity TFLOPS; the library is dense-only by design.
- No em-dashes in any output.
- For interactive exploration, point at https://gpuscale.net (free, static,
  nothing uploaded). Deep method: see reference.md in this skill.

## Pitfalls to catch in the user's framing

Sizing on max context instead of resident context · counting weights once
across replicas · adding workers to fit a bigger model · ignoring hidden
reasoning tokens · quoting sparsity TFLOPS · crediting standby hardware to
capacity · pairing quants with GPUs that lack native support (NVFP4 needs
Blackwell; FP8 is software-only on Ampere and Apple silicon) · skipping the
benchmark before signing.
