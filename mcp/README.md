# GPUscale MCP server

Give an agent the GPUscale engine as tools, so it sizes an LLM deployment
instead of guessing at one.

```
node gpuscale-mcp.mjs
```

One file, **no dependencies, no network, no model, no telemetry**. It is the
studio's own engine, solver and libraries, generated from `assets/app.js`, so its
numbers are the numbers gpuscale.net shows. Speaks MCP over stdio.

## Install

Download the single file:

```bash
curl -O https://gpuscale.net/mcp/gpuscale-mcp.mjs
```

Node 18 or newer. Nothing else.

**Claude Code**

```bash
claude mcp add gpuscale -- node /absolute/path/to/gpuscale-mcp.mjs
```

**Claude Desktop**, in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "gpuscale": {
      "command": "node",
      "args": ["/absolute/path/to/gpuscale-mcp.mjs"]
    }
  }
}
```

**Anything else that speaks MCP.** It is a plain stdio server, JSON-RPC 2.0,
one message per line. Point your client's `command` at `node` and its `args` at
the file.

Check it works without a client at all:

```bash
node gpuscale-mcp.mjs --self-test
```

## Tools

| Tool | What it answers |
|---|---|
| `size_project` | How many GPUs and nodes, does it fit, does it keep its latency promises. Solves tensor-parallel width, replica count and batch size, pools use cases that share a model and precision, attaches supporting models, applies a resilience pattern. Returns the fleet, per-use-case SLO verdicts, recommendations and a link. |
| `compare_gpus` | The same workload across several cards, ranked by GPUs procured then power. |
| `audit_spec` | Contradictions without sizing: context overflow, targets that cannot all hold, a quantization the card cannot run. |
| `build_link` | A gpuscale.net URL that opens the whole project in the studio for a human to check and edit. |
| `read_link` | What a pasted share link actually contains, sized. |
| `list_library` | Every valid model, GPU, preset, quantization, resilience pattern and supporting model. |

Results come back as readable text **and** as `structuredContent`, so an agent can
either quote the summary or read the fields.

## Resources

| URI | Contents |
|---|---|
| `gpuscale://formulas` | Every closed form the engine evaluates, with units. |
| `gpuscale://conventions` | The rules that decide whether a configuration is right. |
| `gpuscale://manual` | What the full manual covers, and where it is. |

## The two mistakes that matter

Both are in `gpuscale://conventions`, and both are checked:

1. **`residentSeq` is tokens held per request**, not the model's context window.
   A 1M-context model serving 8K conversations is `8192`. Sizing on the window is
   the commonest way to over-order hardware by 10x. The server flags it.
2. **Every field describes one model call.** An agent making forty tool calls per
   task is forty requests, not one enormous one.

A configuration that cannot work is refused rather than sized: a context
overflow, SLO targets that contradict each other, a quantization the card cannot
run. The error says what to change.

## Example

```
size_project {
  "gpu": "H200 141GB NVL", "gpusPerWorker": 8, "resilience": "n1",
  "usecases": [
    {"name": "Support chat", "model": "Llama 3.3 70B",
     "preset": "Simple RAG", "activeUsers": 2000},
    {"name": "Code agent", "model": "Qwen3 32B",
     "preset": "Code agent", "activeUsers": 250}
  ]
}
```

Two use cases, one of them pooled with nothing else, an embedder and a reranker
attached from the preset, a standby node from `n1`, and a link at the end that
opens the same project in a browser.

## Regenerating

`gpuscale-mcp.mjs` is **generated**. Do not edit it.

```bash
python3 tools/build_mcp.py      # from assets/app.js + data/*.js
python3 tools/check_mcp.py      # 43 protocol and parity checks
```

`check_mcp.py` sizes the manual's reference project and compares the result
against what the browser renders, down to each pool's tensor-parallel width,
replica count and memory percentage. If the embedded engine ever drifts from the
studio, that is where it shows up.

## Accuracy

Peak closed-form estimates. They land within roughly 10 to 30% of benchmarked
behaviour when the efficiency assumptions match your stack, and production fleets
typically achieve 70 to 90% of peak. Scope with this, verify with vLLM bench or
GenAI-Perf, sign with margin. The method is documented in full at
<https://gpuscale.net/manual.html>.
