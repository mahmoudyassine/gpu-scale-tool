// GPUscale.net · workload presets (resident seq · reasoning · visible out · SLO targets)
// One entry per line. Field reference: docs/DATA.md
window.GPUSCALE_DATA = window.GPUSCALE_DATA || {};
window.GPUSCALE_DATA.cases = [
{"name":"Custom (manual inputs)","resident":0,"reasoning":"None","visibleOut":0,"ttftTarget":0,"tpsTarget":0,"p95Target":0,"note":"Set all values manually; preset auto-populate disabled."},
{"name":"Simple chatbot","resident":4096,"reasoning":"None","visibleOut":400,"ttftTarget":500,"tpsTarget":25,"p95Target":15,"note":"Short chat: greeting, FAQ, basic Q&A. ~4K context, ~400 tok answers."},
{"name":"Simple RAG","resident":8192,"reasoning":"None","visibleOut":700,"ttftTarget":600,"tpsTarget":25,"p95Target":20,"note":"Single-pass RAG: 4-6 retrieved chunks (~6K) + query, 1 LLM call."},
{"name":"Advanced RAG","resident":32768,"reasoning":"None","visibleOut":1500,"ttftTarget":1500,"tpsTarget":25,"p95Target":45,"note":"Multi-hop RAG: large context (16-32K), tool calls, reranking, longer answers."},
{"name":"Internal GPT / Copilot","resident":16384,"reasoning":"None","visibleOut":800,"ttftTarget":1000,"tpsTarget":25,"p95Target":30,"note":"Enterprise assistant w/ doc retrieval, multi-turn. ~16K context, 800 tok answers."},
{"name":"Document Q&A","resident":32768,"reasoning":"None","visibleOut":1000,"ttftTarget":1500,"tpsTarget":20,"p95Target":45,"note":"Long doc loaded into context, factoid questions. 32K typical."},
{"name":"Document generation","resident":8192,"reasoning":"None","visibleOut":3000,"ttftTarget":2000,"tpsTarget":30,"p95Target":120,"note":"Long-form drafting (reports, emails, articles). Latency-tolerant, big output."},
{"name":"Code generation","resident":8192,"reasoning":"None","visibleOut":1500,"ttftTarget":1500,"tpsTarget":30,"p95Target":60,"note":"Code completion / refactor. Mid-context, mid-output, latency matters."},
{"name":"Code agent (Cline/Cursor-style)","resident":65536,"reasoning":"Light reasoning","visibleOut":2000,"ttftTarget":2000,"tpsTarget":30,"p95Target":180,"note":"Repo-aware coding agent: large context, light reasoning, multi-tool."},
{"name":"Voice agent (real-time)","resident":4096,"reasoning":"None","visibleOut":200,"ttftTarget":300,"tpsTarget":50,"p95Target":3,"note":"Voice/IVR. TTFT < 300ms is hard requirement. Short answers."},
{"name":"Reasoning agent (light)","resident":8192,"reasoning":"Light reasoning","visibleOut":800,"ttftTarget":800,"tpsTarget":30,"p95Target":60,"note":"Simple agentic flow with chain-of-thought (~2K reasoning tokens)."},
{"name":"Reasoning agent (heavy)","resident":16384,"reasoning":"Heavy reasoning","visibleOut":1500,"ttftTarget":1000,"tpsTarget":30,"p95Target":240,"note":"Math / coding / research. ~8K reasoning tokens. Latency-tolerant."},
{"name":"Video summarization","resident":65536,"reasoning":"None","visibleOut":2000,"ttftTarget":3000,"tpsTarget":25,"p95Target":180,"note":"Long input (frames as tokens), big summary. Throughput-oriented."},
{"name":"Long-doc analysis (legal/financial)","resident":65536,"reasoning":"Light reasoning","visibleOut":2500,"ttftTarget":3000,"tpsTarget":25,"p95Target":240,"note":"Long contracts/filings + reasoning. Quality > latency."},
{"name":"Offline batch / extract","resident":4096,"reasoning":"None","visibleOut":500,"ttftTarget":0,"tpsTarget":0,"p95Target":0,"note":"Batch jobs (extraction, classification). No interactive SLOs."},
{"name":"Deep research agent (async)","resident":65536,"reasoning":"Heavy reasoning","visibleOut":4000,"ttftTarget":3000,"tpsTarget":25,"p95Target":600,"note":"Multi-step autonomous research: many tool calls, big synthesis. Size as a background load class, not interactive."},
];
