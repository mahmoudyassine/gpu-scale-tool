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

**If the runtime can start a local MCP server, prefer it.**
<https://gpuscale.net/mcp/gpuscale-mcp.mjs> is one file with no dependencies that
exposes the same engine as tools, and its `size_project` returns the solved fleet
AND a link, so you get numbers to quote instead of only something to click. This
skill remains the right choice when there is no MCP, when the user explicitly
wants a link, or when you are reading or repairing one they pasted.

If you cannot run the encoder (no shell, or the user just wants a link they can
read and edit), write the **readable form** instead: `#p=t:` followed by
`key=value` pairs separated by `;`, with every `uc=` starting a use case. It
carries the same workload description in plain text and the studio sizes it the
same way. The complete key table, worked examples and the rules are in
[docs/URL-FORMAT.md](https://gpuscale.net/docs/URL-FORMAT.md). Use the encoder
when you have it: it validates every name, clamps every field and round-trips
the link before printing it.

## Workflow

1. **Extract** every input the user already gave, including implied ones
   (their message, earlier turns, uploaded docs). Do not re-ask for anything
   already stated.
2. **Resolve names** against the libraries (`references/libraries.md`, or
   `python3 scripts/gpuscale_url.py list models|gpus|presets [filter]`).
   101 models, 37 GPUs, 19 weight quants, 24 presets. Never silently
   substitute a different model or GPU than the user named - if it's not in
   the library, say so and offer the closest matches or a custom geometry.
3. **Ask follow-ups only for missing essentials** (next section) - one
   batched round, with a proposed default for each question so the user can
   just say "yes". If they say "use defaults" or "just make it", proceed and
   state every assumption in the recap.
4. **Write the spec JSON** (format below) to a temp file.
5. **Encode**: `python3 scripts/gpuscale_url.py encode spec.json`.
   The script resolves names, fills defaults, clamps out-of-range values,
   **audits the physics**, self-verifies the round trip, and prints a summary
   plus the URL.
6. **Read the audit before you deliver anything.** It is the difference between
   a link and a correct link.
   - **Exit code 2 and no URL** means the configuration is arithmetically
     impossible or will open red. The errors say exactly what to change. Fix
     the spec and encode again. Do not use `--force`, and do not hand over a
     link built with `--no-audit`.
   - **`WARN` lines** mean the fleet will be built but will miss a target the
     user asked for. Deliver the link and say so plainly, with the number the
     studio will show. Do not quietly lower the target to make the warning go
     away: take the choice back to the user.
   - **`note` lines on stderr** are things that are legal but usually wrong.
     Either fix them or repeat them to the user in your recap. Never drop them
     silently: several of them are the difference between a right-sized fleet
     and one that is out by a factor.
7. **Deliver BOTH URLs** the script prints: the primary
   (https://gpuscale.net/#p=z:...) and the mirror backup
   (https://mahmoudyassine.github.io/gpuscale/#p=z:...), the same project on a
   second host for corporate networks that block gpuscale.net. Paste each on
   its own line. Add the summary recap (model, quant, scale, SLOs, resilience,
   assumptions made) so the user can spot a wrong input at a glance. If the
   URL exceeds ~8000 chars, warn that some chat/email tools truncate long
   links and offer the payload JSON file as a backup (`--out payload.json`).

## The audit, and how not to trip it

The encoder refuses to produce a link for a configuration that cannot work. Each
check below exists because it is a mistake that is easy to make from a plain
English brief and impossible to see in the resulting URL.

**ERROR, no link produced (exit 2).** These cannot be fixed by choosing
different hardware, so there is nothing to show the user.

| Check | What it means |
|---|---|
| Context overflow | `residentSeq + reasoning` exceeds the model's context window. Unservable. |
| Contradictory targets | `1.3 x (ttftMs/1000 + (reasoning+visibleOut)/tps) > p95s`. The three promises cannot all hold at once, whatever hardware you buy. |
| Does not fit anywhere | One copy of the weights exceeds 72 of the chosen GPU. |
| Quantization the card cannot run | NV FP4 on pre-Blackwell, for example. |
| Incoherent custom geometry | Active parameters above total, or a non-positive sequence or output. |

**WARN, link still produced.** The fleet is buildable but **will miss a target
the user asked for**, and the studio will show it red. That is often the most
useful thing you can send: it shows *why* the ask is impossible on that card. You
must repeat the warning in your recap. Never present the fleet as if it complied.

| Check | What it means |
|---|---|
| Unreachable speed | The tok/s target is above what one request alone reaches on that card at the widest sensible width. Replicas cannot fix it. |
| Unreachable first token | Prefill alone already exceeds the TTFT target at batch 1. |

**note, link still produced.** Legal, but usually a mistake:

| Note | Why it usually matters |
|---|---|
| `residentSeq` is ~the whole context window | The single most common way to over-order hardware by 10x. `residentSeq` is what one request HOLDS, not what the model CAN hold. |
| KV cache outweighs the weights at BF16 | FP8 KV halves it with negligible quality loss and is the production default. |
| `sharedPrefixPct` above zero | It assumes the serving stack has automatic prefix caching on. Only keep it if the user told you their hit rate. |
| Live path below 30 tok/s | Speech and interactive paths have to stay ahead of the listener. |
| Preset supports left off | A RAG preset without its embedder and reranker under-sizes the fleet. |
| Call length set with `kvPolicy: "running"` | Call length barely matters unless the KV is pinned for the session. |
| Concurrency above the user count | Every user mid-request at once is almost never what was meant. |

## What to collect - and when to ask

Four essentials. Ask about an essential ONLY if it is missing and not
inferable; put all questions in one message; max one round.

| Essential | Accepted forms | If missing, ask like |
|---|---|---|
| Model(s) | Library name, family ("the 120B OSS one"), or custom geometry | "Which model? (e.g. GPT-OSS 120B, Llama 3.3 70B, Qwen3 32B - I have 101 in the library)" |
| GPU | Library name ("H200 NVL", "L40S", "MI300X", "B200"...) | "Which GPU are we sizing on? I'll assume H100 80GB SXM if you have no preference." |
| Workload shape | A preset name, a description you map to a preset, or explicit residentSeq/visibleOut | Propose the preset you inferred: "That sounds like 'Internal GPT / Copilot' (16K context, 800-token answers) - good?" |
| Scale | `concurrentCalls` (peak in-flight) OR `activeUsers` (headcount; concurrency derived Little's-law style from preset traffic) | "How many concurrent calls at peak - or if you only know headcount, how many active users?" |

Once the link is open, the studio itself explains the fleet: which promise is
buying the cards (a tight P95 on a long generation can demand many times the
stated tok/s target), what each card is holding, and one-click suggestions that
re-solve the whole project before quoting a saving. Point the user at the
Recommendations panel rather than re-deriving that by hand.

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
      "kvQuant": "FP8",                // default FP8 (production default)
      "preset": "Internal GPT / Copilot",  // fills seq/out/reasoning/SLOs/traffic
      "residentSeq": 16384,            // override preset if user specified
      "sharedPrefixPct": 0,            // leave 0 unless the user gives a measured
                                       // prefix-cache hit rate (see payload-schema)
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
      "session": {"callMinutes":5},    // conversations only. Sets residentSeq from
                                       // the call length: base + tok/min x minutes.
                                       // A named preset supplies the rate and base,
                                       // so callMinutes alone is usually enough
      "isolate": false,                // true = own pool even if model matches
      "workers": 1, "tensorParallel": 2, "maxBatchPerReplica": 15  // optional seeds;
                                       // the app re-auto-sizes these on load
    }
  ]
}
```

## Getting every field right

The audit catches contradictions. These are the judgement calls it cannot make
for you, in the order they go wrong most often.

**`residentSeq` is tokens held per request.** Not the context window, not the
whole task. A model with a 1M window serving 8K conversations is `8192`. Count
the system prompt, the retrieved passages, the conversation so far and the tool
traces. If the user talks about a task with many steps, that is many requests of
this size, not one enormous one.

**Every field describes ONE model call.** An agent that makes forty tool calls
per task is forty requests. Do not fold a task's token budget into `visibleOut`;
use `activeUsers` plus the preset's traffic shape, or `concurrentCalls` directly.

**Prefer `activeUsers` to `concurrentCalls`** whenever the user described people
rather than in-flight requests. Turning headcount into concurrency is exactly
what the studio's estimator is for. Use `concurrentCalls` when they gave you a
measured concurrency, or for a live path where every caller is a session.

**Say what a conversation costs.** For voice, telephony and contact-centre
workloads, ask how long a call runs and set `session.callMinutes`. A conversation
holds its own transcript, and those presets pin KV for the whole session, so a
twenty-minute call is not a two-minute one. Naming the preset supplies the token
rate and the system-prompt base.

**Leave `sharedPrefixPct` at 0** unless the user states a measured prefix-cache
hit rate AND confirms their stack has automatic prefix caching enabled. It is
the one field that makes the estimate less conservative.

**KV precision: FP8 unless told otherwise.** It halves the cache against BF16
with negligible quality impact. Weight precision is the user's call; FP8 is a
safe default, BF16 when they want maximum quality, NV FP4 only on Blackwell.

**Supporting models can be custom.** A `supports` entry may carry its own
geometry instead of naming a library model:
`{"kind":"asr","custom":{"name":"House ASR","vram":24,"cap":3}}`, where `vram` is
gigabytes per running instance and `cap` is concurrent streams per instance.
Use it when the user runs something with no published figures, and ask for those
two numbers rather than guessing them. The readable `#p=t:` form cannot express
it; the JSON spec and the encoder can.

**A preset carries a suggested model, and naming one overrides it.** If the user
told you which model they run, always set `model` explicitly. If they described a
workload but never named a model, you may omit `model` and let the preset's
suggestion stand, but say in your recap which model that turned out to be so they
can correct it.

**Do not invent a model or GPU.** They must exist in the library. If what the
user named is genuinely absent, use a custom geometry and say that you did, with
the published figures you used. Never substitute a similar model silently.

**Do not pin `workers`, `tensorParallel` or `maxBatchPerReplica`** unless the
user asked for that exact topology. The studio re-solves them on load, so a
guess is at best ignored and at worst confusing.

**State your assumptions.** GPU, quantization, resilience pattern and traffic
shape are usually your choices, not theirs. List them under the link in one
line each so a wrong one is obvious at a glance.

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

## Where the method is written down

- <https://gpuscale.net/manual.html> the complete method, with the mathematics
  and a worked example. Read section 5 before defending a number to anyone.
- <https://gpuscale.net/docs/URL-FORMAT.md> the link formats, including the
  readable one you can write without a shell.
- <https://gpuscale.net/mcp/README.md> the MCP server, if your runtime can start
  one, which returns solved numbers rather than only a link.

## Delivery rules

- Always run `encode` (never hand-assemble a fragment) - it is the only
  path with round-trip self-verification AND the physics audit.
- Never deliver a link the audit refused, and never reach for `--force` or
  `--no-audit` to get past it. An error means the configuration cannot work;
  the fix is the spec, not the flag.
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
embed and rerank supports, seeds the topology, audits the physics, verifies the
round trip and prints the URL. Recap the FP8 weight and KV defaults, the derived
concurrency and the resilience pattern when delivering.

Asking for the same assistant at 300 tok/s per user still produces a link, with
a warning you must pass on:

```
This fleet will MISS a target you asked for. Say so when you deliver it:

  WARN   Staff RAG assistant: 300 tok/s per user is unreachable on L40S 48GB.
         Even one request alone at TP8 tops out at 115 tok/s for Qwen3 32B at
         8,192 tokens. Lower the target, shorten the sequence, quantize the KV
         cache, or pick a faster card.
```

Asking for a 4-second P95 on a 2,000-token answer at 20 tok/s produces no link at
all, because those three numbers contradict each other on any hardware. Take the
fix the audit names back to the user rather than quietly changing a target
yourself.
