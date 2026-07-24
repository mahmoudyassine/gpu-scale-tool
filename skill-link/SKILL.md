---
name: gpuscale-link
description: Turn plain-language LLM/GPU inference sizing requirements into a fully populated GPUscale.net share URL, and decode or edit existing ones. GPUscale.net is Mahmoud's GPU sizing studio (mahmoudyassine.github.io/gpuscale); its share links carry the whole project in a "#p=z:..." fragment. Use this skill whenever the user mentions GPUscale, gpuscale.net, a gpuscale link/URL, asks to "put this scenario in gpuscale" or "give me the link", describes an LLM serving scenario (model, GPU, users or concurrency, context, SLOs, resilience) and wants it captured as a shareable/clickable config, pastes a link containing "#p=z:" or "#p=j:" to read, compare, repair or modify, or asks what such a link contains. Trigger even if they never say "gpuscale" but reply to a conversation about it, or hand over sizing inputs and ask for "the URL".
---

# GPUscale share-link builder

GPUscale.net share links are self-contained: the entire project travels inside
the URL fragment as `#p=z:` + base64url(deflate-raw(JSON)). This skill turns
sizing requirements into that link, asking for missing inputs first, and reads
links back. `scripts/gpuscale_url.py` does all encoding/decoding and
self-verifies every link by decoding it again before printing.

One important behavior to internalize: when a link opens, the app applies the
config and then **auto-sizes topology** (tensor parallel, workers, batch) from
the demand inputs. So the demand side - model, quantization, tokens,
concurrency, SLOs, GPU choice, resilience - is what must be right. Never
pester the user for TP/worker counts; only pin them if volunteered.

## Workflow

1. **Extract** every input the user already gave, including implied ones
   (their message, earlier turns, uploaded docs). Do not re-ask for anything
   already stated.
2. **Resolve names** against the libraries (`references/libraries.md`, or
   `python3 scripts/gpuscale_url.py list models|gpus|presets [filter]`).
   101 models, 37 GPUs, 19 weight quants, 20 presets. Never silently
   substitute a different model or GPU than the user named - if it's not in
   the library, say so and offer the closest matches or a custom geometry.
3. **Ask follow-ups only for missing essentials** (next section) - one
   batched round, with a proposed default for each question so the user can
   just say "yes". If they say "use defaults" or "just make it", proceed and
   state every assumption in the recap.
4. **Write the spec JSON** (format below) to a temp file.
5. **Encode**: `python3 scripts/gpuscale_url.py encode spec.json`.
   The script validates, fills defaults, clamps out-of-range values (with
   notes), self-verifies the round trip, and prints a summary + the URL.
6. **Deliver BOTH URLs** the script prints: the primary
   (https://gpuscale.net/#p=z:...) and the mirror backup
   (https://mahmoudyassine.github.io/gpuscale/#p=z:...), the same project on a
   second host for corporate networks that block gpuscale.net. Paste each on
   its own line. Add the summary recap (model, quant, scale, SLOs, resilience,
   assumptions made) so the user can spot a wrong input at a glance. If the
   URL exceeds ~8000 chars, warn that some chat/email tools truncate long
   links and offer the payload JSON file as a backup (`--out payload.json`).

## What to collect - and when to ask

Four essentials. Ask about an essential ONLY if it is missing and not
inferable; put all questions in one message; max one round.

| Essential | Accepted forms | If missing, ask like |
|---|---|---|
| Model(s) | Library name, family ("the 120B OSS one"), or custom geometry | "Which model? (e.g. GPT-OSS 120B, Llama 3.3 70B, Qwen3 32B - I have 94 in the library)" |
| GPU | Library name ("H200 NVL", "L40S", "MI300X", "B200"...) | "Which GPU are we sizing on? I'll assume H100 80GB SXM if you have no preference." |
| Workload shape | A preset name, a description you map to a preset, or explicit residentSeq/visibleOut | Propose the preset you inferred: "That sounds like 'Internal GPT / Copilot' (16K context, 800-token answers) - good?" |
| Scale | `concurrentCalls` (peak in-flight) OR `activeUsers` (headcount; concurrency derived Little's-law style from preset traffic) | "How many concurrent calls at peak - or if you only know headcount, how many active users?" |

Everything else defaults silently (mention notable ones in the recap):
weights FP8 / KV BF16, SLOs from the preset, resilience `n` (capacity only),
8 GPUs per worker, reasoning off, tuning MFU 0.5 / MBU 0.65 / IC 0.85 /
30 ms overhead, one use case, light theme, advanced mode.

### Mapping loose language

- "chatbot for the intranet / internal assistant / copilot" → preset
  `Internal GPT / Copilot`. "customer FAQ bot" → `Simple chatbot`.
  "RAG over our documents" → `Simple RAG` (or `Advanced RAG` if multi-hop,
  agents, tools, or reranking are mentioned). "contract review" →
  `Long-doc analysis (legal/financial)`. "coding assistant" →
  `Code generation`; "Cursor/Cline-style agent" → `Code agent`.
  "IVR / voice bot" → `Voice agent (real-time)` (direct: conc = callers).
  "batch extraction / classification jobs" → `Offline batch / extract`
  (direct: conc = jobs in flight).
- "thinking / reasoning model usage" → reasoning `Light reasoning` (2K tok)
  or `Heavy reasoning` (8K) if "deep/heavy/o1-style" is implied. Several
  presets pin an exact per-request budget via `reasonTok` (Advanced RAG 800,
  Document Q&A 500, code agent 1.5K per step, clinical assistant 1K, deep
  research 2K per call); leaving `reasoning` unset keeps that.
- Healthcare: "radiology / imaging reports" → `Medical imaging report
  assistant`; "clinical Q&A / guidelines" → `Clinical knowledge assistant`.
  "camera / CCTV / stream monitoring" → `Real-time video analytics`
  (direct: conc = streams). "translation / subtitles" → `Translation /
  localization`. "live agent-assist in a call center" → `Contact-center
  agent assist` (direct: conc = live calls; KV pinned per session, like the
  voice preset).
- "quantized"/"4-bit" → `INT4`; if llama.cpp/Ollama/GGUF context → `Q4_K_M`.
  "8-bit" → `FP8` on Hopper/Blackwell, else `INT8`. Full precision → `BF16`.
- Resilience: "one spare node" → `n1`; "no downtime, second site" → `dr`;
  "active-active" → `aa`; "both sites live, half load each" → `aas`;
  "N+N plus DR" / "twin active sites, 4N" → `nndr`. Keys and labels both
  work; `list resilience` shows all 12.
- Multiple workloads on one platform ("HR has 4 use cases...") → one
  `usecases` entry each; same model+quant cards pool automatically.
- Embeddings/reranker/ASR/TTS/OCR/guardrails mentioned → `supports`
  (or leave `"auto"` and the preset attaches its defaults).

## Spec format (input to `encode`)

```jsonc
{
  "name": "Project name",              // optional
  "gpu": "H200 141GB NVL",             // REQUIRED (library name, fuzzy ok)
  "gpusPerWorker": 8,                  // 8 = HGX/DGX, 72 = NVL72 rack
  "resilience": "n1",                  // key or label; default "n"
  "tuning": {"prefillMFU":0.5,"decodeMBU":0.65,"interconnectEff":0.85,
             "frameworkOverheadMs":30,"autoSizeUtilPct":80},   // optional
  "mode": "advanced", "theme": "light", // optional
  "projectId": null,                   // informational only: since studio 5.14
                                       // the app imports every link as a NEW
                                       // local copy and clears the URL, so a
                                       // link can never overwrite local work
  "usecases": [
    {
      "name": "Virtual Assistant",
      "model": "GPT-OSS 120B",         // or {"custom":true,"params":..,"active":..,
                                       //     "hidden":..,"layers":..,"kvHeads":..,
                                       //     "headDim":..,"ctx":..}
      "weightQuant": "FP8",            // default FP8
      "kvQuant": "BF16",               // default BF16
      "preset": "Internal GPT / Copilot",  // fills seq/out/reasoning/SLOs/traffic
      "residentSeq": 16384,            // override preset if user specified
      "visibleOut": 800,
      "reasoning": "None",             // None | Light reasoning | Heavy reasoning
                                       // | {"mode":"Custom","tokens":3000,"extendsKV":true}
      "concurrentCalls": 50,           // EITHER this (peak in-flight, manual)...
      "activeUsers": 200,              // ...or headcount (conc derived); both is fine
      "estimator": {"turnsPerHour":3,"pctTurnsLLM":100,"callsPerTurn":1.5,
                    "burst":2.5,"callDurS":9},   // optional; preset traffic otherwise
      "sloTargets": {"ttftMs":1000,"tps":25,"p95s":30},  // 0 = target off
      "kvPolicy": "running",           // "running" | "all" (KV for queued too)
      "supports": "auto",              // "auto" (preset defaults) | [] |
                                       // ["embed","rerank"] | [{"kind":"embed","model":"BGE-M3"}]
      "isolate": false,                // true = own pool even if model matches
      "workers": 1, "tensorParallel": 2, "maxBatchPerReplica": 15  // optional seeds;
                                       // the app re-auto-sizes these on load
    }
  ]
}
```

Single-scenario shorthand: omit `"usecases"` and put the use-case fields at
the top level next to `gpu`. A spec containing `"schema": "gpuscale.net/5"`
is treated as a full payload and re-encoded as-is (that's the edit path).

## Script commands

```bash
python3 scripts/gpuscale_url.py encode spec.json [--base URL] [--out payload.json] [--quiet]
python3 scripts/gpuscale_url.py decode '<url or fragment or file>' [--out payload.json]
python3 scripts/gpuscale_url.py list models|gpus|quants|kvquants|presets|resilience|supports [filter]
```

- Error messages are written to tell you exactly what to ask the user
  (missing scale, ambiguous model name with candidates, invalid preset...).
  Relay them as questions, not as errors.
- Default base is `https://mahmoudyassine.github.io/gpuscale/`; `--base`
  accepts any host serving the app (e.g. `https://gpuscale.net/`).
- `encode` prints a summary block first - reuse it for your recap.

## Decoding, editing and repairing links

- **"What's in this link?"** → `decode`, then answer with a human summary
  (project, per-use-case model/quant/scale/SLOs, fleet). Show raw JSON only
  if asked.
- **"Change X in this link"** → `decode --out payload.json`, edit precisely
  that field (payload schema in `references/payload-schema.md`), then
  `encode payload.json`. This preserves everything else untouched.
- Opening a link never destroys the recipient's local work: the app imports
  it as a new saved copy and strips the payload from the address bar
  (studio 5.14). To hand back an updated project, mint a NEW link.
- **Corrupted link** (decode reports JSON damage at a position): links get
  mangled in chat/email transit. The script salvages the readable prefix to
  `salvaged_prefix.txt` - reconstruct what you can from it, ask the user for
  the missing pieces, and rebuild a fresh link. Give the rebuilt project a
  NEW projectId unless the user wants their browser copy overwritten.

## Delivery rules

- Always run `encode` (never hand-assemble a fragment) - it is the only
  path with round-trip self-verification.
- Recap the key inputs and every assumption next to the URL. A wrong quant
  or concurrency silently baked into a link wastes a customer meeting; the
  recap is how the user catches it in five seconds.
- The link itself is the deliverable - paste it as a plain URL on its own
  line so it stays clickable and copyable.

## Worked example

User: "gpuscale link - Qwen3 32B RAG assistant on L40S for about 800 staff,
needs one spare node."

Everything essential is present (model Qwen3 32B; GPU L40S; shape → Simple
RAG unless multi-hop implied; scale activeUsers 800; resilience n1). No
follow-up needed - build:

```json
{"name":"Staff RAG assistant","gpu":"L40S 48GB","resilience":"n1",
 "model":"Qwen3 32B","preset":"Simple RAG","activeUsers":800}
```

`encode` derives concurrency from the preset traffic, attaches the default
embed+rerank supports, seeds topology, verifies, and prints the URL. Recap
the FP8/BF16 default quants and derived concurrency when delivering.
