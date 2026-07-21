// GPUscale.net · supporting-model library (auto-attached per use case)
// vram = GB one serving instance needs; cap = concurrent calls one instance absorbs
// (planning allowances from published benchmarks, not guarantees). Field reference: docs/DATA.md
window.GPUSCALE_DATA = window.GPUSCALE_DATA || {};
window.GPUSCALE_DATA.support = {
kinds: [
{"key":"embed","label":"Embeddings","role":"turns text into vectors for retrieval"},
{"key":"rerank","label":"Reranker","role":"re-orders retrieved chunks by relevance"},
{"key":"asr","label":"ASR","role":"speech to text"},
{"key":"tts","label":"TTS","role":"text to speech"},
{"key":"ocr","label":"OCR","role":"documents and scans to text"},
{"key":"guard","label":"Guard","role":"input/output safety screening"}
],
models: [
{"kind":"embed","name":"BGE-M3","params":0.568,"vram":2.5,"cap":400,"default":true,"note":"Multilingual dense+sparse retrieval; ~60k tokens/s per instance","url":"https://huggingface.co/BAAI/bge-m3"},
{"kind":"embed","name":"Qwen3-Embedding 0.6B","params":0.6,"vram":1.5,"cap":400,"note":"Lightweight MTEB top-tier","url":"https://huggingface.co/Qwen/Qwen3-Embedding-0.6B"},
{"kind":"embed","name":"Qwen3-Embedding 8B","params":8.0,"vram":16.0,"cap":400,"note":"MTEB multilingual leader; needs a large slice","url":"https://huggingface.co/Qwen/Qwen3-Embedding-8B"},
{"kind":"embed","name":"nomic-embed-text v1.5","params":0.137,"vram":0.8,"cap":400,"note":"Smallest footprint; CPU-viable","url":"https://huggingface.co/nomic-ai/nomic-embed-text-v1.5"},
{"kind":"rerank","name":"bge-reranker-v2-m3","params":0.568,"vram":2.5,"cap":50,"default":true,"note":"Cross-encoder; ~150-250 ms per top-50 rerank","url":"https://huggingface.co/BAAI/bge-reranker-v2-m3"},
{"kind":"rerank","name":"Qwen3-Reranker 0.6B","params":0.6,"vram":1.5,"cap":50,"note":"Lightweight cross-encoder","url":"https://huggingface.co/Qwen/Qwen3-Reranker-0.6B"},
{"kind":"rerank","name":"Qwen3-Reranker 8B","params":8.0,"vram":16.0,"cap":120,"note":"~31 req/s under vLLM; needs a large slice","url":"https://huggingface.co/Qwen/Qwen3-Reranker-8B"},
{"kind":"asr","name":"Whisper large-v3-turbo","params":0.809,"vram":1.6,"cap":4,"default":true,"note":"~130x real-time; the serving default","url":"https://huggingface.co/openai/whisper-large-v3-turbo"},
{"kind":"asr","name":"Parakeet-TDT 0.6B v3","params":0.6,"vram":1.0,"cap":8,"note":"Batch-throughput champion (RTFx ~3,300)","url":"https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3"},
{"kind":"asr","name":"Canary-1B v2","params":1.0,"vram":6.4,"cap":6,"note":"Adds speech translation","url":"https://huggingface.co/nvidia/canary-1b-v2"},
{"kind":"tts","name":"Kokoro-82M","params":0.082,"vram":1.0,"cap":10,"default":true,"note":"~15x real-time; Apache license","url":"https://huggingface.co/hexgrad/Kokoro-82M"},
{"kind":"tts","name":"Orpheus-3B","params":3.0,"vram":6.0,"cap":8,"note":"Streaming, expressive; Apache license","url":"https://huggingface.co/canopylabs/orpheus-3b-0.1-ft"},
{"kind":"ocr","name":"PaddleOCR PP-OCRv5","params":0.05,"vram":2.0,"cap":8,"default":true,"note":"~190 pages/min per instance; plain text","url":"https://github.com/PaddlePaddle/PaddleOCR"},
{"kind":"ocr","name":"dots.ocr 3B","params":3.0,"vram":8.0,"cap":4,"note":"Layout-aware VLM parser; MIT license","url":"https://github.com/rednote-hilab/dots.ocr"},
{"kind":"ocr","name":"olmOCR-2 7B","params":7.0,"vram":16.0,"cap":2,"note":"Highest-fidelity document parsing","url":"https://huggingface.co/allenai/olmOCR-2-7B-1025"},
{"kind":"guard","name":"Llama Guard 3 1B","params":1.0,"vram":2.5,"cap":30,"default":true,"note":"Input/output moderation; CPU-viable","url":"https://huggingface.co/meta-llama/Llama-Guard-3-1B"},
{"kind":"guard","name":"Llama Guard 3 8B FP8","params":8.0,"vram":10.0,"cap":60,"note":"Higher accuracy; fits a 10 GB slice","url":"https://huggingface.co/meta-llama/Llama-Guard-3-8B"}
]
};
