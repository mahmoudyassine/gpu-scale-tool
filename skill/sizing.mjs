#!/usr/bin/env node
// GPUscale sizing CLI · generated from gpu-scale-tool (engine v23, library v25)
// Same math, same libraries as https://gpuscale.net · MIT license
'use strict';

const META = {"library":"v25","engine":23,"updated":"2026-07-19"};
const MODELS = [
{"name":"Llama 3.1 8B","params":8.0,"active":8.0,"hidden":4096,"layers":32,"kvHeads":8,"headDim":128,"ctx":131072,"experts":null,"activeExperts":null,"arch":"Dense (GQA)","dev":"Meta","url":"https://ai.meta.com/blog/meta-llama-3-1/"},
{"name":"Llama 3.1 70B","params":70.0,"active":70.0,"hidden":8192,"layers":80,"kvHeads":8,"headDim":128,"ctx":131072,"experts":null,"activeExperts":null,"arch":"Dense (GQA)","dev":"Meta","url":"https://ai.meta.com/blog/meta-llama-3-1/"},
{"name":"Llama 3.1 405B","params":405.0,"active":405.0,"hidden":16384,"layers":126,"kvHeads":8,"headDim":128,"ctx":131072,"experts":null,"activeExperts":null,"arch":"Dense (GQA)","dev":"Meta","url":"https://ai.meta.com/blog/meta-llama-3-1/"},
{"name":"Llama 4 Scout 109B (MoE)","params":109.0,"active":17.0,"hidden":5120,"layers":48,"kvHeads":8,"headDim":128,"ctx":10485760,"experts":16,"activeExperts":1,"arch":"MoE (16E/1A)","dev":"Meta","url":"https://ai.meta.com/blog/llama-4-multimodal-intelligence/"},
{"name":"Llama 4 Maverick 400B (MoE)","params":400.0,"active":17.0,"hidden":5120,"layers":48,"kvHeads":8,"headDim":128,"ctx":1048576,"experts":128,"activeExperts":2,"arch":"MoE (128E/2A)","dev":"Meta","url":"https://ai.meta.com/blog/llama-4-multimodal-intelligence/"},
{"name":"Qwen3 0.6B","params":0.6,"active":0.6,"hidden":1024,"layers":28,"kvHeads":8,"headDim":128,"ctx":32768,"experts":null,"activeExperts":null,"arch":"Dense (GQA)","dev":"Alibaba Cloud","url":"https://qwenlm.github.io/blog/qwen3/"},
{"name":"Qwen3 1.7B","params":1.7,"active":1.7,"hidden":2048,"layers":28,"kvHeads":8,"headDim":128,"ctx":32768,"experts":null,"activeExperts":null,"arch":"Dense (GQA)","dev":"Alibaba Cloud","url":"https://qwenlm.github.io/blog/qwen3/"},
{"name":"Qwen3 4B","params":4.0,"active":4.0,"hidden":2560,"layers":36,"kvHeads":8,"headDim":128,"ctx":32768,"experts":null,"activeExperts":null,"arch":"Dense (GQA)","dev":"Alibaba Cloud","url":"https://qwenlm.github.io/blog/qwen3/"},
{"name":"Qwen3 8B","params":8.0,"active":8.0,"hidden":4096,"layers":36,"kvHeads":8,"headDim":128,"ctx":131072,"experts":null,"activeExperts":null,"arch":"Dense (GQA)","dev":"Alibaba Cloud","url":"https://qwenlm.github.io/blog/qwen3/"},
{"name":"Qwen3 14B","params":14.0,"active":14.0,"hidden":5120,"layers":40,"kvHeads":8,"headDim":128,"ctx":131072,"experts":null,"activeExperts":null,"arch":"Dense (GQA)","dev":"Alibaba Cloud","url":"https://qwenlm.github.io/blog/qwen3/"},
{"name":"Qwen3 32B","params":32.0,"active":32.0,"hidden":5120,"layers":64,"kvHeads":8,"headDim":128,"ctx":131072,"experts":null,"activeExperts":null,"arch":"Dense (GQA)","dev":"Alibaba Cloud","url":"https://qwenlm.github.io/blog/qwen3/"},
{"name":"Qwen3 30B-A3B (MoE)","params":30.0,"active":3.0,"hidden":2048,"layers":48,"kvHeads":4,"headDim":128,"ctx":131072,"experts":128,"activeExperts":8,"arch":"MoE (128E/8A)","dev":"Alibaba Cloud","url":"https://qwenlm.github.io/blog/qwen3/"},
{"name":"Qwen3 235B-A22B (MoE)","params":235.0,"active":22.0,"hidden":4096,"layers":94,"kvHeads":4,"headDim":128,"ctx":262144,"experts":128,"activeExperts":8,"arch":"MoE (128E/8A)","dev":"Alibaba Cloud","url":"https://qwenlm.github.io/blog/qwen3/"},
{"name":"Qwen3.5 0.8B","params":0.8,"active":0.8,"hidden":1024,"layers":24,"kvHeads":2,"headDim":256,"ctx":262144,"experts":null,"activeExperts":null,"arch":"Dense (Hybrid attn approx)","dev":"Alibaba Cloud","url":"https://github.com/QwenLM/Qwen3.5"},
{"name":"Qwen3.5 2B","params":2.0,"active":2.0,"hidden":2048,"layers":24,"kvHeads":2,"headDim":256,"ctx":262144,"experts":null,"activeExperts":null,"arch":"Dense (Hybrid attn approx)","dev":"Alibaba Cloud","url":"https://github.com/QwenLM/Qwen3.5"},
{"name":"Qwen3.5 4B","params":4.0,"active":4.0,"hidden":2560,"layers":32,"kvHeads":4,"headDim":256,"ctx":262144,"experts":null,"activeExperts":null,"arch":"Dense (Hybrid attn approx)","dev":"Alibaba Cloud","url":"https://github.com/QwenLM/Qwen3.5"},
{"name":"Qwen3.5 9B","params":9.0,"active":9.0,"hidden":4096,"layers":32,"kvHeads":4,"headDim":256,"ctx":262144,"experts":null,"activeExperts":null,"arch":"Dense (Hybrid attn approx)","dev":"Alibaba Cloud","url":"https://github.com/QwenLM/Qwen3.5"},
{"name":"Qwen3.5 27B","params":27.0,"active":27.0,"hidden":5120,"layers":64,"kvHeads":4,"headDim":256,"ctx":262144,"experts":null,"activeExperts":null,"arch":"Dense (Hybrid attn approx)","dev":"Alibaba Cloud","url":"https://github.com/QwenLM/Qwen3.5"},
{"name":"Qwen3.5 35B-A3B (MoE)","params":35.0,"active":3.0,"hidden":2048,"layers":40,"kvHeads":2,"headDim":256,"ctx":262144,"experts":256,"activeExperts":8,"arch":"MoE (256E/8A, hybrid approx)","dev":"Alibaba Cloud","url":"https://github.com/QwenLM/Qwen3.5"},
{"name":"Qwen3.5 122B-A10B (MoE)","params":122.0,"active":10.0,"hidden":3072,"layers":48,"kvHeads":2,"headDim":256,"ctx":262144,"experts":256,"activeExperts":8,"arch":"MoE (256E/8A, hybrid approx)","dev":"Alibaba Cloud","url":"https://github.com/QwenLM/Qwen3.5"},
{"name":"Qwen3.5 397B-A17B (MoE)","params":397.0,"active":17.0,"hidden":4096,"layers":60,"kvHeads":2,"headDim":256,"ctx":262144,"experts":512,"activeExperts":10,"arch":"MoE (512E/10A, hybrid approx)","dev":"Alibaba Cloud","url":"https://github.com/QwenLM/Qwen3.5"},
{"name":"DeepSeek-V3 671B (MoE)","params":671.0,"active":37.0,"hidden":7168,"layers":61,"kvHeads":1,"headDim":288,"ctx":131072,"experts":257,"activeExperts":9,"arch":"MoE (257E/9A, MLA eff.)","dev":"DeepSeek","url":"https://huggingface.co/deepseek-ai/DeepSeek-V3"},
{"name":"DeepSeek-R1 671B (MoE)","params":671.0,"active":37.0,"hidden":7168,"layers":61,"kvHeads":1,"headDim":288,"ctx":131072,"experts":257,"activeExperts":9,"arch":"MoE (257E/9A, MLA eff.)","dev":"DeepSeek","url":"https://huggingface.co/deepseek-ai/DeepSeek-R1"},
{"name":"Kimi K2 1T-A32B (MoE)","params":1000.0,"active":32.0,"hidden":7168,"layers":61,"kvHeads":1,"headDim":288,"ctx":131072,"experts":385,"activeExperts":9,"arch":"MoE (385E/9A, MLA eff.)","dev":"Moonshot AI","url":"https://huggingface.co/moonshotai/Kimi-K2-Instruct"},
{"name":"Kimi K2.5 1T-A32B (MoE)","params":1000.0,"active":32.0,"hidden":7168,"layers":61,"kvHeads":1,"headDim":288,"ctx":262144,"experts":385,"activeExperts":9,"arch":"MoE (385E/9A, MLA eff.)","dev":"Moonshot AI","url":"https://huggingface.co/moonshotai/Kimi-K2.5"},
{"name":"Mistral 7B v0.3","params":7.3,"active":7.3,"hidden":4096,"layers":32,"kvHeads":8,"headDim":128,"ctx":32768,"experts":null,"activeExperts":null,"arch":"Dense (GQA+SWA)","dev":"Mistral AI","url":"https://huggingface.co/mistralai/Mistral-7B-v0.3"},
{"name":"Mixtral 8x7B (MoE)","params":46.7,"active":12.9,"hidden":4096,"layers":32,"kvHeads":8,"headDim":128,"ctx":32768,"experts":8,"activeExperts":2,"arch":"MoE (8E/2A)","dev":"Mistral AI","url":"https://huggingface.co/mistralai/Mixtral-8x7B-Instruct-v0.1"},
{"name":"Mistral Small 3 24B","params":24.0,"active":24.0,"hidden":5120,"layers":40,"kvHeads":8,"headDim":128,"ctx":32768,"experts":null,"activeExperts":null,"arch":"Dense (GQA)","dev":"Mistral AI","url":"https://mistral.ai/news/mistral-small-3"},
{"name":"Mistral Small 3.1 24B","params":24.0,"active":24.0,"hidden":5120,"layers":40,"kvHeads":8,"headDim":128,"ctx":131072,"experts":null,"activeExperts":null,"arch":"Dense (GQA)","dev":"Mistral AI","url":"https://mistral.ai/news/mistral-small-3-1"},
{"name":"Mistral Large 3 675B (MoE)","params":675.0,"active":41.0,"hidden":12288,"layers":88,"kvHeads":8,"headDim":128,"ctx":262144,"experts":null,"activeExperts":null,"arch":"MoE (granular; cfg approx)","dev":"Mistral AI","url":"https://mistral.ai/news/mistral-3"},
{"name":"Mixtral 8x22B (MoE)","params":141.0,"active":39.0,"hidden":6144,"layers":56,"kvHeads":8,"headDim":128,"ctx":65536,"experts":8,"activeExperts":2,"arch":"MoE (8E/2A)","dev":"Mistral AI","url":"https://huggingface.co/mistralai/Mixtral-8x22B-v0.1"},
{"name":"Gemma 2 2B","params":2.0,"active":2.0,"hidden":2304,"layers":26,"kvHeads":4,"headDim":256,"ctx":8192,"experts":null,"activeExperts":null,"arch":"Dense (GQA+SWA)","dev":"Google","url":"https://ai.google.dev/gemma/docs/core/model_card_2"},
{"name":"Gemma 2 9B","params":9.0,"active":9.0,"hidden":3584,"layers":42,"kvHeads":8,"headDim":256,"ctx":8192,"experts":null,"activeExperts":null,"arch":"Dense (GQA+SWA)","dev":"Google","url":"https://ai.google.dev/gemma/docs/core/model_card_2"},
{"name":"Gemma 2 27B","params":27.0,"active":27.0,"hidden":4608,"layers":46,"kvHeads":16,"headDim":128,"ctx":8192,"experts":null,"activeExperts":null,"arch":"Dense (GQA+SWA)","dev":"Google","url":"https://ai.google.dev/gemma/docs/core/model_card_2"},
{"name":"Gemma 3 1B","params":1.0,"active":1.0,"hidden":1152,"layers":26,"kvHeads":1,"headDim":256,"ctx":32768,"experts":null,"activeExperts":null,"arch":"Dense (GQA+SWA 5:1)","dev":"Google","url":"https://ai.google.dev/gemma/docs/core/model_card_3"},
{"name":"Gemma 3 4B","params":4.3,"active":4.3,"hidden":2560,"layers":34,"kvHeads":4,"headDim":256,"ctx":131072,"experts":null,"activeExperts":null,"arch":"Dense (GQA+SWA 5:1)","dev":"Google","url":"https://ai.google.dev/gemma/docs/core/model_card_3"},
{"name":"Gemma 3 12B","params":12.2,"active":12.2,"hidden":3840,"layers":48,"kvHeads":8,"headDim":256,"ctx":131072,"experts":null,"activeExperts":null,"arch":"Dense (GQA+SWA 5:1)","dev":"Google","url":"https://ai.google.dev/gemma/docs/core/model_card_3"},
{"name":"Gemma 3 27B","params":27.4,"active":27.4,"hidden":5376,"layers":62,"kvHeads":16,"headDim":128,"ctx":131072,"experts":null,"activeExperts":null,"arch":"Dense (GQA+SWA 5:1)","dev":"Google","url":"https://ai.google.dev/gemma/docs/core/model_card_3"},
{"name":"Gemma 4 E2B","params":5.1,"active":2.3,"hidden":1536,"layers":35,"kvHeads":1,"headDim":256,"ctx":131072,"experts":null,"activeExperts":null,"arch":"Dense (shared KV approx)","dev":"Google","url":"https://ai.google.dev/gemma/docs/core/model_card_4"},
{"name":"Gemma 4 E4B","params":8.0,"active":4.5,"hidden":2560,"layers":42,"kvHeads":2,"headDim":256,"ctx":131072,"experts":null,"activeExperts":null,"arch":"Dense (shared KV approx)","dev":"Google","url":"https://ai.google.dev/gemma/docs/core/model_card_4"},
{"name":"Gemma 4 26B-A4B (MoE)","params":25.2,"active":3.8,"hidden":2816,"layers":30,"kvHeads":8,"headDim":256,"ctx":262144,"experts":129,"activeExperts":9,"arch":"MoE (129E/9A; shared KV approx)","dev":"Google","url":"https://ai.google.dev/gemma/docs/core/model_card_4"},
{"name":"Gemma 4 31B","params":30.7,"active":30.7,"hidden":5376,"layers":60,"kvHeads":16,"headDim":256,"ctx":262144,"experts":null,"activeExperts":null,"arch":"Dense (shared KV approx)","dev":"Google","url":"https://ai.google.dev/gemma/docs/core/model_card_4"},
{"name":"Phi-4-mini 3.8B","params":3.8,"active":3.8,"hidden":3072,"layers":32,"kvHeads":8,"headDim":128,"ctx":131072,"experts":null,"activeExperts":null,"arch":"Dense (GQA)","dev":"Microsoft","url":"https://huggingface.co/microsoft/Phi-4-mini-instruct"},
{"name":"Phi-4 14B","params":14.0,"active":14.0,"hidden":5120,"layers":40,"kvHeads":10,"headDim":128,"ctx":16384,"experts":null,"activeExperts":null,"arch":"Dense (GQA)","dev":"Microsoft","url":"https://huggingface.co/microsoft/phi-4"},
{"name":"GPT-OSS 20B","params":21.0,"active":3.6,"hidden":2880,"layers":24,"kvHeads":8,"headDim":64,"ctx":131072,"experts":32,"activeExperts":4,"arch":"MoE (32E/4A, GQA)","dev":"OpenAI","url":"https://openai.com/index/gpt-oss-model-card/"},
{"name":"GPT-OSS 120B","params":117.0,"active":5.1,"hidden":2880,"layers":36,"kvHeads":8,"headDim":64,"ctx":131072,"experts":128,"activeExperts":4,"arch":"MoE (128E/4A, GQA)","dev":"OpenAI","url":"https://openai.com/index/gpt-oss-model-card/"},
{"name":"Qwen3-Next 80B-A3B (MoE, hybrid)","params":80.0,"active":3.9,"hidden":2048,"layers":48,"kvHeads":2,"headDim":64,"ctx":262144,"experts":512,"activeExperts":10,"arch":"MoE (512E/10A, hybrid attn)","dev":"Alibaba","url":"https://huggingface.co/Qwen/Qwen3-Next-80B-A3B-Instruct"},
{"name":"Qwen3-Coder 480B-A35B (MoE)","params":480.0,"active":35.0,"hidden":6144,"layers":62,"kvHeads":8,"headDim":128,"ctx":262144,"experts":160,"activeExperts":8,"arch":"MoE (160E/8A, GQA)","dev":"Alibaba","url":"https://huggingface.co/Qwen/Qwen3-Coder-480B-A35B-Instruct"},
{"name":"DeepSeek-V3.1 671B (MoE)","params":671.0,"active":37.0,"hidden":7168,"layers":61,"kvHeads":1,"headDim":288,"ctx":131072,"experts":257,"activeExperts":9,"arch":"MoE (257E/9A, MLA eff.)","dev":"DeepSeek","url":"https://huggingface.co/deepseek-ai/DeepSeek-V3.1"},
{"name":"DeepSeek-V3.2 671B (MoE, DSA)","params":671.0,"active":37.0,"hidden":7168,"layers":61,"kvHeads":1,"headDim":288,"ctx":131072,"experts":257,"activeExperts":9,"arch":"MoE (DSA sparse attn, MLA eff.)","dev":"DeepSeek","url":"https://huggingface.co/deepseek-ai/DeepSeek-V3.2"},
{"name":"GLM-4.5 355B-A32B (MoE)","params":355.0,"active":32.0,"hidden":5120,"layers":92,"kvHeads":8,"headDim":128,"ctx":131072,"experts":160,"activeExperts":8,"arch":"MoE (160E/8A, GQA)","dev":"Z.ai (Zhipu)","url":"https://huggingface.co/zai-org/GLM-4.5"},
{"name":"GLM-4.6 357B-A32B (MoE)","params":357.0,"active":32.0,"hidden":5120,"layers":92,"kvHeads":8,"headDim":128,"ctx":200000,"experts":160,"activeExperts":8,"arch":"MoE (160E/8A, GQA)","dev":"Z.ai (Zhipu)","url":"https://huggingface.co/zai-org/GLM-4.6"},
{"name":"MiniMax-M2 230B-A10B (MoE)","params":230.0,"active":10.0,"hidden":3072,"layers":62,"kvHeads":8,"headDim":128,"ctx":200000,"experts":256,"activeExperts":8,"arch":"MoE (256E/8A, GQA)","dev":"MiniMax","url":"https://huggingface.co/MiniMaxAI/MiniMax-M2"},
{"name":"Llama 3.3 70B Instruct","params":70.0,"active":70.0,"hidden":8192,"layers":80,"kvHeads":8,"headDim":128,"ctx":131072,"experts":null,"activeExperts":null,"arch":"Dense (GQA)","dev":"Meta","url":"https://huggingface.co/meta-llama/Llama-3.3-70B-Instruct"},
{"name":"Mistral Medium 3.5 128B","params":128.0,"active":128.0,"hidden":12288,"layers":80,"kvHeads":8,"headDim":128,"ctx":262144,"experts":null,"activeExperts":null,"arch":"Dense (GQA, est. cfg)","dev":"Mistral AI","url":"https://huggingface.co/mistralai/Mistral-Medium-3.5-128B"},
{"name":"Cohere Command A 111B","params":111.0,"active":111.0,"hidden":12288,"layers":64,"kvHeads":8,"headDim":128,"ctx":262144,"experts":null,"activeExperts":null,"arch":"Dense (hybrid SWA, est. cfg)","dev":"Cohere","url":"https://huggingface.co/CohereLabs/c4ai-command-a-03-2025"},
{"name":"Ministral 3 14B","params":14.0,"active":14.0,"hidden":5120,"layers":40,"kvHeads":8,"headDim":128,"ctx":32768,"experts":null,"activeExperts":null,"arch":"Dense (GQA)","dev":"Mistral AI","url":"https://huggingface.co/collections/mistralai/ministral-3"},
{"name":"DeepSeek-V4-Pro 1.6T-A49B (MoE)","params":1600.0,"active":49.0,"hidden":7168,"layers":61,"kvHeads":1,"headDim":40,"ctx":1048576,"experts":385,"activeExperts":7,"arch":"MoE (385E/7A, hybrid CSA/HCA eff.)","dev":"DeepSeek","url":"https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro"},
{"name":"DeepSeek-V4-Flash 284B-A13B (MoE)","params":284.0,"active":13.0,"hidden":4096,"layers":43,"kvHeads":1,"headDim":40,"ctx":1048576,"experts":257,"activeExperts":7,"arch":"MoE (257E/7A, hybrid CSA/HCA eff.)","dev":"DeepSeek","url":"https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash"},
{"name":"Kimi K2.6 1T-A32B (MoE)","params":1000.0,"active":32.0,"hidden":7168,"layers":61,"kvHeads":1,"headDim":288,"ctx":262144,"experts":385,"activeExperts":9,"arch":"MoE (385E/9A, MLA eff.)","dev":"Moonshot AI","url":"https://huggingface.co/moonshotai/Kimi-K2.6"},
{"name":"GLM-5.2 744B-A40B (MoE)","params":744.0,"active":40.0,"hidden":6144,"layers":78,"kvHeads":1,"headDim":288,"ctx":1048576,"experts":257,"activeExperts":9,"arch":"MoE (257E/9A, MLA+DSA eff.)","dev":"Z.ai (Zhipu)","url":"https://huggingface.co/zai-org/GLM-5.2"},
{"name":"MiniMax-M3 230B-A10B (MoE)","params":230.0,"active":10.0,"hidden":3072,"layers":62,"kvHeads":8,"headDim":128,"ctx":1048576,"experts":256,"activeExperts":8,"arch":"MoE (256E/8A, MSA sparse; cfg approx)","dev":"MiniMax","url":"https://huggingface.co/MiniMaxAI/MiniMax-M3"},
{"name":"Qwen3.6 35B-A3B (MoE)","params":35.0,"active":3.0,"hidden":2048,"layers":40,"kvHeads":2,"headDim":256,"ctx":262144,"experts":256,"activeExperts":8,"arch":"MoE (256E/8A, hybrid; cfg approx)","dev":"Alibaba Cloud","url":"https://huggingface.co/Qwen"},
{"name":"Nemotron 3 Super 120B-A12B (MoE)","params":120.0,"active":12.0,"hidden":6144,"layers":52,"kvHeads":2,"headDim":128,"ctx":1048576,"experts":null,"activeExperts":null,"arch":"MoE hybrid Mamba-Attn (est. cfg)","dev":"NVIDIA","url":"https://huggingface.co/nvidia"},
{"name":"Nemotron 3 Ultra 550B-A55B (MoE)","params":550.0,"active":55.0,"hidden":8192,"layers":64,"kvHeads":2,"headDim":128,"ctx":1048576,"experts":null,"activeExperts":null,"arch":"MoE hybrid Mamba+LatentMoE (est. cfg)","dev":"NVIDIA","url":"https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-BF16"},
{"name":"Falcon-H1-34B","params":34.0,"active":34.0,"hidden":5120,"layers":72,"kvHeads":4,"headDim":128,"ctx":262144,"experts":null,"activeExperts":null,"arch":"Dense hybrid Attn+SSM (GQA-4)","dev":"TII (UAE)","url":"https://huggingface.co/tiiuae/Falcon-H1-34B-Instruct"},
{"name":"Falcon3-10B","params":10.0,"active":10.0,"hidden":3072,"layers":40,"kvHeads":4,"headDim":256,"ctx":32768,"experts":null,"activeExperts":null,"arch":"Dense (GQA)","dev":"TII (UAE)","url":"https://huggingface.co/tiiuae/Falcon3-10B-Instruct"},
{"name":"Jais-family-30B (Arabic, 16K)","params":30.0,"active":30.0,"hidden":7168,"layers":48,"kvHeads":56,"headDim":128,"ctx":16384,"experts":null,"activeExperts":null,"arch":"Dense (MHA+ALiBi) · heavy KV","dev":"Inception / G42 (UAE)","url":"https://huggingface.co/inceptionai/jais-family-30b-16k"},
{"name":"ALLaM-7B (Arabic)","params":7.0,"active":7.0,"hidden":4096,"layers":32,"kvHeads":32,"headDim":128,"ctx":4096,"experts":null,"activeExperts":null,"arch":"Dense (MHA, Llama-2 base)","dev":"SDAIA (KSA)","url":"https://huggingface.co/ALLaM-AI/ALLaM-7B-Instruct-preview"},
{"name":"Fanar-1-9B (Arabic, Qatar)","params":9.2,"active":9.2,"hidden":3584,"layers":42,"kvHeads":8,"headDim":256,"ctx":8192,"experts":null,"activeExperts":null,"arch":"Dense (GQA+SWA, Gemma2 base)","dev":"QCRI (Qatar)","url":"https://huggingface.co/QCRI/Fanar-1-9B-Instruct"},
{"name":"K2-Think 32B (reasoning)","params":32.8,"active":32.8,"hidden":5120,"layers":64,"kvHeads":8,"headDim":128,"ctx":32768,"experts":null,"activeExperts":null,"arch":"Dense (GQA, Qwen2.5 base)","dev":"MBZUAI / G42 (UAE)","url":"https://huggingface.co/LLM360/K2-Think"},
{"name":"Llama 3.2 3B","params":3.2,"active":3.2,"hidden":3072,"layers":28,"kvHeads":8,"headDim":128,"ctx":131072,"experts":null,"activeExperts":null,"arch":"Dense (GQA)","dev":"Meta","url":"https://huggingface.co/meta-llama/Llama-3.2-3B-Instruct"},
{"name":"Kimi K3 2.8T-A50B (MoE)","params":2800.0,"active":50.0,"hidden":9216,"layers":80,"kvHeads":1,"headDim":72,"ctx":1000000,"experts":896,"activeExperts":16,"arch":"MoE (896E/16A, KDA hybrid + MLA eff., est. cfg)","dev":"Moonshot AI","url":"https://huggingface.co/blog/ResterChed/kimi-k3-model-overview-mxfp4-quantization-open-wei"},
{"name":"Jais-2-70B (Arabic)","params":70.0,"active":70.0,"hidden":8192,"layers":80,"kvHeads":8,"headDim":128,"ctx":32768,"experts":null,"activeExperts":null,"arch":"Dense (GQA, est. cfg) · from scratch, Cerebras-trained","dev":"Inception / G42 (UAE)","url":"https://huggingface.co/inceptionai"},
{"name":"Jais-2-8B (Arabic)","params":8.0,"active":8.0,"hidden":4096,"layers":32,"kvHeads":8,"headDim":128,"ctx":32768,"experts":null,"activeExperts":null,"arch":"Dense (GQA, est. cfg) · from scratch, Cerebras-trained","dev":"Inception / G42 (UAE)","url":"https://huggingface.co/inceptionai"},
{"name":"Jais-adapted-70B (Arabic)","params":70.0,"active":70.0,"hidden":8192,"layers":80,"kvHeads":8,"headDim":128,"ctx":4096,"experts":null,"activeExperts":null,"arch":"Dense (GQA, Llama-2 adapted)","dev":"Inception / G42 (UAE)","url":"https://huggingface.co/inceptionai/jais-adapted-70b"},
{"name":"Fanar-2-27B (Arabic, Qatar)","params":27.4,"active":27.4,"hidden":5376,"layers":62,"kvHeads":16,"headDim":128,"ctx":131072,"experts":null,"activeExperts":null,"arch":"Dense (GQA) · Gemma-3-27B continual pretrain","dev":"QCRI (Qatar)","url":"https://huggingface.co/QCRI/Fanar-2-27B-Instruct"},
{"name":"ALLaM-34B (Arabic)","params":34.0,"active":34.0,"hidden":7168,"layers":60,"kvHeads":8,"headDim":128,"ctx":32768,"experts":null,"activeExperts":null,"arch":"Dense (GQA, est. cfg) · from scratch","dev":"HUMAIN (KSA)","url":"https://www.middleeastainews.com/p/humain-chat-live-allam-34b-llm"},
{"name":"Falcon-H1-Arabic-34B","params":34.0,"active":34.0,"hidden":5120,"layers":72,"kvHeads":4,"headDim":128,"ctx":262144,"experts":null,"activeExperts":null,"arch":"Dense hybrid Attn+SSM (GQA-4) · OALL #1","dev":"TII (UAE)","url":"https://huggingface.co/blog/tiiuae/falcon-h1-arabic"},
{"name":"Falcon-Arabic-7B","params":7.0,"active":7.0,"hidden":3072,"layers":28,"kvHeads":4,"headDim":256,"ctx":32768,"experts":null,"activeExperts":null,"arch":"Dense (GQA) · Falcon3-7B base","dev":"TII (UAE)","url":"https://www.tii.ae/news/middle-easts-leading-ai-powerhouse-tii-launches-two-new-ai-models-falcon-arabic-first-arabic"},
{"name":"SILMA-9B (Arabic)","params":9.0,"active":9.0,"hidden":3584,"layers":42,"kvHeads":8,"headDim":256,"ctx":8192,"experts":null,"activeExperts":null,"arch":"Dense (GQA+SWA) · Gemma-2-9B base","dev":"SILMA AI (KSA)","url":"https://huggingface.co/silma-ai/SILMA-9B-Instruct-v1.0"},
{"name":"Cohere Command A+ 218B-A25B (MoE)","params":218.0,"active":25.0,"hidden":6144,"layers":48,"kvHeads":8,"headDim":128,"ctx":131072,"experts":null,"activeExperts":null,"arch":"MoE (25B active, est. cfg) · Apache 2.0, vision-in","dev":"Cohere","url":"https://docs.cohere.com/docs/command-a-plus"},
{"name":"Cohere Command A Reasoning 111B","params":111.0,"active":111.0,"hidden":12288,"layers":64,"kvHeads":8,"headDim":128,"ctx":262144,"experts":null,"activeExperts":null,"arch":"Dense (hybrid SWA, est. cfg) · reasoning","dev":"Cohere","url":"https://docs.cohere.com/docs/models"},
{"name":"Cohere Command R+ 104B","params":104.0,"active":104.0,"hidden":12288,"layers":64,"kvHeads":8,"headDim":128,"ctx":131072,"experts":null,"activeExperts":null,"arch":"Dense (GQA)","dev":"Cohere","url":"https://huggingface.co/CohereLabs/c4ai-command-r-plus-08-2024"},
{"name":"Cohere Command R 32B (08-2024)","params":32.3,"active":32.3,"hidden":8192,"layers":40,"kvHeads":8,"headDim":128,"ctx":131072,"experts":null,"activeExperts":null,"arch":"Dense (GQA)","dev":"Cohere","url":"https://huggingface.co/CohereLabs/c4ai-command-r-08-2024"},
{"name":"Cohere Command R7B","params":8.0,"active":8.0,"hidden":4096,"layers":32,"kvHeads":8,"headDim":128,"ctx":131072,"experts":null,"activeExperts":null,"arch":"Dense (GQA, 3:1 SWA)","dev":"Cohere","url":"https://huggingface.co/CohereLabs/c4ai-command-r7b-12-2024"},
{"name":"Cohere Command R7B Arabic","params":8.0,"active":8.0,"hidden":4096,"layers":32,"kvHeads":8,"headDim":128,"ctx":131072,"experts":null,"activeExperts":null,"arch":"Dense (GQA, 3:1 SWA) · Arabic-optimized","dev":"Cohere","url":"https://huggingface.co/CohereLabs/c4ai-command-r7b-arabic-02-2025"},
{"name":"Aya Expanse 32B (multilingual)","params":32.3,"active":32.3,"hidden":8192,"layers":40,"kvHeads":8,"headDim":128,"ctx":131072,"experts":null,"activeExperts":null,"arch":"Dense (GQA) · 23 languages incl. Arabic","dev":"Cohere","url":"https://huggingface.co/CohereLabs/aya-expanse-32b"},
{"name":"Aya Expanse 8B (multilingual)","params":8.0,"active":8.0,"hidden":4096,"layers":32,"kvHeads":8,"headDim":128,"ctx":8192,"experts":null,"activeExperts":null,"arch":"Dense (GQA) · 23 languages incl. Arabic","dev":"Cohere","url":"https://huggingface.co/CohereLabs/aya-expanse-8b"},
{"name":"Mistral Saba 24B (MENA/S-Asia)","params":24.0,"active":24.0,"hidden":5120,"layers":40,"kvHeads":8,"headDim":128,"ctx":32768,"experts":null,"activeExperts":null,"arch":"Dense (GQA, est. cfg) · Arabic-focused, on-prem","dev":"Mistral AI","url":"https://mistral.ai/news/mistral-saba/"},
{"name":"Magistral Small 1.2 24B (reasoning)","params":24.0,"active":24.0,"hidden":5120,"layers":40,"kvHeads":8,"headDim":128,"ctx":131072,"experts":null,"activeExperts":null,"arch":"Dense (GQA) · reasoning","dev":"Mistral AI","url":"https://huggingface.co/mistralai/Magistral-Small-2509"},
{"name":"Mistral Large 2 123B","params":123.0,"active":123.0,"hidden":12288,"layers":88,"kvHeads":8,"headDim":128,"ctx":131072,"experts":null,"activeExperts":null,"arch":"Dense (GQA)","dev":"Mistral AI","url":"https://huggingface.co/mistralai/Mistral-Large-Instruct-2407"},
{"name":"Ministral 8B","params":8.0,"active":8.0,"hidden":4096,"layers":36,"kvHeads":8,"headDim":128,"ctx":131072,"experts":null,"activeExperts":null,"arch":"Dense (GQA, interleaved SWA)","dev":"Mistral AI","url":"https://huggingface.co/mistralai/Ministral-8B-Instruct-2410"},
{"name":"Mistral Small 4 24B","params":24.0,"active":24.0,"hidden":5120,"layers":40,"kvHeads":8,"headDim":128,"ctx":131072,"experts":null,"activeExperts":null,"arch":"Dense (GQA, est. cfg) · Apache 2.0","dev":"Mistral AI","url":"https://mistral.ai/news/"},
];
const GPUS = [
{"name":"RTX 4060 Ti 16GB","vram":16.0,"bw":0.288,"tflops":44.0,"mem":"GDDR6","arch":"Ada Lovelace","watts":165,"cls":"Consumer","link":"PCIe 4.0","url":"https://www.nvidia.com/en-us/geforce/graphics-cards/40-series/"},
{"name":"RTX 4070 Ti Super 16GB","vram":16.0,"bw":0.672,"tflops":88.0,"mem":"GDDR6X","arch":"Ada Lovelace","watts":285,"cls":"Consumer","link":"PCIe 4.0","url":"https://www.nvidia.com/en-us/geforce/graphics-cards/40-series/"},
{"name":"RTX 4080 Super 16GB","vram":16.0,"bw":0.736,"tflops":104.0,"mem":"GDDR6X","arch":"Ada Lovelace","watts":320,"cls":"Consumer","link":"PCIe 4.0","url":"https://www.nvidia.com/en-us/geforce/graphics-cards/40-series/"},
{"name":"RTX 4090 24GB","vram":24.0,"bw":1.008,"tflops":165.0,"mem":"GDDR6X","arch":"Ada Lovelace","watts":450,"cls":"Consumer","link":"PCIe 4.0","url":"https://www.nvidia.com/en-us/geforce/graphics-cards/40-series/"},
{"name":"RTX 5070 Ti 16GB","vram":16.0,"bw":0.896,"tflops":88.0,"mem":"GDDR7","arch":"Blackwell","watts":300,"cls":"Consumer","link":"PCIe 5.0","url":"https://www.nvidia.com/en-us/geforce/graphics-cards/50-series/"},
{"name":"RTX 5080 16GB","vram":16.0,"bw":0.96,"tflops":113.0,"mem":"GDDR7","arch":"Blackwell","watts":360,"cls":"Consumer","link":"PCIe 5.0","url":"https://www.nvidia.com/en-us/geforce/graphics-cards/50-series/"},
{"name":"RTX 5090 32GB","vram":32.0,"bw":1.792,"tflops":210.0,"mem":"GDDR7","arch":"Blackwell","watts":575,"cls":"Consumer","link":"PCIe 5.0","url":"https://www.nvidia.com/en-us/geforce/graphics-cards/50-series/"},
{"name":"RTX 6000 Ada 48GB","vram":48.0,"bw":0.96,"tflops":182.0,"mem":"GDDR6","arch":"Ada Lovelace","watts":300,"cls":"Workstation","link":"PCIe 4.0","url":"https://www.nvidia.com/en-us/products/workstations/rtx-6000/"},
{"name":"RTX PRO 6000 Blackwell Server Edition 96GB","vram":96.0,"bw":1.597,"tflops":250.0,"mem":"GDDR7","arch":"Blackwell","watts":600,"cls":"Server / Workstation","link":"PCIe 5.0","url":"https://www.nvidia.com/en-us/data-center/rtx-pro-6000-blackwell-server-edition/"},
{"name":"A100 40GB SXM","vram":40.0,"bw":1.555,"tflops":312.0,"mem":"HBM2e","arch":"Ampere","watts":400,"cls":"Data Center","link":"NVLink Gen3","url":"https://www.nvidia.com/en-us/data-center/a100/"},
{"name":"A100 80GB SXM","vram":80.0,"bw":2.039,"tflops":312.0,"mem":"HBM2e","arch":"Ampere","watts":400,"cls":"Data Center","link":"NVLink Gen3","url":"https://www.nvidia.com/en-us/data-center/a100/"},
{"name":"A100 80GB PCIe","vram":80.0,"bw":1.935,"tflops":312.0,"mem":"HBM2e","arch":"Ampere","watts":300,"cls":"Data Center","link":"PCIe 4.0","url":"https://www.nvidia.com/en-us/data-center/a100/"},
{"name":"L4 24GB","vram":24.0,"bw":0.3,"tflops":60.5,"mem":"GDDR6","arch":"Ada Lovelace","watts":72,"cls":"Data Center","link":"PCIe 4.0","url":"https://www.nvidia.com/en-us/data-center/l4/"},
{"name":"L40 48GB","vram":48.0,"bw":0.864,"tflops":90.5,"mem":"GDDR6","arch":"Ada Lovelace","watts":300,"cls":"Data Center","link":"PCIe 4.0","url":"https://www.nvidia.com/en-us/data-center/l40/"},
{"name":"L40S 48GB","vram":48.0,"bw":0.864,"tflops":183.0,"mem":"GDDR6","arch":"Ada Lovelace","watts":350,"cls":"Data Center","link":"PCIe 4.0","url":"https://www.nvidia.com/en-us/data-center/l40s/"},
{"name":"H100 NVL 94GB","vram":94.0,"bw":3.9,"tflops":835.0,"mem":"HBM3","arch":"Hopper","watts":350,"cls":"Data Center","link":"NVLink Gen4","url":"https://www.nvidia.com/en-us/data-center/h100/"},
{"name":"H100 80GB SXM","vram":80.0,"bw":3.35,"tflops":989.0,"mem":"HBM3","arch":"Hopper","watts":700,"cls":"Data Center","link":"NVLink Gen4","url":"https://www.nvidia.com/en-us/data-center/h100/"},
{"name":"H100 80GB PCIe","vram":80.0,"bw":2.0,"tflops":756.0,"mem":"HBM2e","arch":"Hopper","watts":350,"cls":"Data Center","link":"PCIe 5.0","url":"https://www.nvidia.com/en-us/data-center/h100/"},
{"name":"H200 141GB NVL","vram":141.0,"bw":4.8,"tflops":989.0,"mem":"HBM3e","arch":"Hopper","watts":600,"cls":"Data Center","link":"NVLink Gen4","url":"https://www.nvidia.com/en-us/data-center/h200/"},
{"name":"H200 141GB SXM","vram":141.0,"bw":4.8,"tflops":989.0,"mem":"HBM3e","arch":"Hopper","watts":700,"cls":"Data Center","link":"NVLink Gen4","url":"https://www.nvidia.com/en-us/data-center/h200/"},
{"name":"B200 180GB","vram":180.0,"bw":8.0,"tflops":2250.0,"mem":"HBM3e","arch":"Blackwell","watts":1000,"cls":"Data Center","link":"NVLink Gen5","url":"https://www.nvidia.com/en-us/data-center/dgx-b200/"},
{"name":"B300 288GB","vram":288.0,"bw":8.0,"tflops":2250.0,"mem":"HBM3e","arch":"Blackwell Ultra","watts":1200,"cls":"Data Center","link":"NVLink Gen5","url":"https://www.nvidia.com/en-us/data-center/dgx-b300/"},
{"name":"Apple M2 Ultra 192GB","vram":192.0,"bw":0.8,"tflops":27.2,"mem":"Unified LPDDR5","arch":"Apple M2","watts":215,"cls":"Apple Silicon","link":"—","url":"https://www.apple.com/newsroom/2023/06/apple-introduces-m2-ultra/"},
{"name":"Apple M4 Max 128GB","vram":128.0,"bw":0.546,"tflops":38.0,"mem":"Unified LPDDR5X","arch":"Apple M4","watts":150,"cls":"Apple Silicon","link":"—","url":"https://www.apple.com/macbook-pro/"},
{"name":"AMD Instinct MI300X 192GB","vram":192.0,"bw":5.3,"tflops":1307.0,"mem":"HBM3","arch":"CDNA 3","watts":750,"cls":"Data Center","link":"Infinity Fabric","url":"https://www.amd.com/en/products/accelerators/instinct/mi300/mi300x.html"},
{"name":"AMD Instinct MI325X 256GB","vram":256.0,"bw":6.0,"tflops":1307.0,"mem":"HBM3E","arch":"CDNA 3","watts":1000,"cls":"Data Center","link":"Infinity Fabric","url":"https://www.amd.com/en/products/accelerators/instinct/mi325x.html"},
{"name":"AMD Instinct MI355X 288GB","vram":288.0,"bw":8.0,"tflops":2513.0,"mem":"HBM3E","arch":"CDNA 4","watts":1400,"cls":"Data Center","link":"Infinity Fabric","url":"https://www.amd.com/en/products/accelerators/instinct/mi350.html"},
{"name":"NVIDIA GB200 186GB (per GPU)","vram":186.0,"bw":8.0,"tflops":2250.0,"mem":"HBM3e","arch":"Blackwell (Grace)","watts":1200,"cls":"Data Center","link":"NVLink Gen5","url":"https://www.nvidia.com/en-us/data-center/gb200-nvl72/"},
{"name":"Apple M3 Ultra 256GB","vram":256.0,"bw":0.819,"tflops":28.0,"mem":"Unified LPDDR5","arch":"Apple M3","watts":270,"cls":"Apple Silicon","link":"—","url":"https://www.apple.com/mac-studio/"},
{"name":"Intel Gaudi 3 128GB","vram":128.0,"bw":3.7,"tflops":1835.0,"mem":"HBM2e","arch":"Intel Gaudi 3","watts":900,"cls":"Data Center","link":"RoCE / Ethernet","url":"https://www.intel.com/content/www/us/en/products/details/processors/ai-accelerators/gaudi3.html"},
{"name":"GH200 141GB","vram":141.0,"bw":4.9,"tflops":989.0,"mem":"HBM3e","arch":"Grace Hopper","watts":1000,"cls":"Data Center","link":"NVLink-C2C","url":"https://www.nvidia.com/en-us/data-center/grace-hopper-superchip/"},
{"name":"GB300 288GB (per GPU)","vram":288.0,"bw":8.0,"tflops":2250.0,"mem":"HBM3e","arch":"Blackwell Ultra","watts":1400,"cls":"Data Center","link":"NVLink Gen5","url":"https://www.nvidia.com/en-us/data-center/gb300-nvl72/"},
{"name":"AMD Instinct MI350X 288GB","vram":288.0,"bw":8.0,"tflops":2300.0,"mem":"HBM3E","arch":"CDNA 4","watts":1000,"cls":"Data Center","link":"Infinity Fabric","url":"https://www.amd.com/en/products/accelerators/instinct/mi350.html"},
{"name":"AMD Instinct MI455X 432GB","vram":432.0,"bw":19.6,"tflops":5000.0,"mem":"HBM4","arch":"CDNA 5","watts":2000,"cls":"Data Center (H2 2026)","link":"IF + UALink","url":"https://www.amd.com/en/products/accelerators/instinct.html"},
{"name":"NVIDIA Rubin VR200 288GB","vram":288.0,"bw":20.5,"tflops":8300.0,"mem":"HBM4","arch":"Rubin","watts":1800,"cls":"Data Center (H2 2026)","link":"NVLink Gen6","url":"https://www.nvidia.com/en-us/data-center/vera-rubin/"},
{"name":"NVIDIA DGX Spark 128GB (GB10)","vram":128.0,"bw":0.273,"tflops":125.0,"mem":"Unified LPDDR5x","arch":"Grace Blackwell","watts":240,"cls":"Desktop","link":"NVLink-C2C","url":"https://www.nvidia.com/en-us/products/workstations/dgx-spark/"},
{"name":"Apple M3 Ultra 512GB","vram":512.0,"bw":0.819,"tflops":28.0,"mem":"Unified LPDDR5","arch":"Apple M3","watts":270,"cls":"Apple Silicon","link":"—","url":"https://www.apple.com/mac-studio/"},
];
const QUANTS = [
{"name":"FP32","bits":32.0,"bytes":4.0,"quality":"100% (baseline)","speed":"Slowest","use":"Training / research only","hw":"All GPUs"},
{"name":"FP16","bits":16.0,"bytes":2.0,"quality":"~99-100%","speed":"Fast","use":"Default inference & training","hw":"All modern GPUs"},
{"name":"BF16","bits":16.0,"bytes":2.0,"quality":"~99-100%","speed":"Fast","use":"Default inference on BF16-native hardware","hw":"Ampere+ / BF16-capable GPUs"},
{"name":"FP8","bits":8.0,"bytes":1.0,"quality":"~97-99%","speed":"Very Fast","use":"Production inference","hw":"Hopper+ (H100/H200/B200, RTX 50)"},
{"name":"NV FP4","bits":4.5,"bytes":0.5625,"quality":"~94-97%","speed":"Fastest","use":"Blackwell native inference (incl. block scales)","hw":"Blackwell only (B200, RTX 50)"},
{"name":"INT8","bits":8.0,"bytes":1.0,"quality":"~95-98%","speed":"Fast","use":"Optimized inference (bitsandbytes)","hw":"All (Tensor Cores)"},
{"name":"INT4","bits":4.0,"bytes":0.5,"quality":"~92-96%","speed":"Fastest","use":"GPTQ/AWQ deployment (+~6% group scales not counted)","hw":"All GPUs (software)"},
{"name":"Q8_0","bits":8.0,"bytes":1.0,"quality":"~99%","speed":"Fast","use":"GGUF near-lossless","hw":"All (llama.cpp)"},
{"name":"Q6_K","bits":6.5,"bytes":0.8125,"quality":"~97-99%","speed":"Fast","use":"GGUF high quality","hw":"All (llama.cpp)"},
{"name":"Q5_K_M","bits":5.5,"bytes":0.6875,"quality":"~96-98%","speed":"Faster","use":"GGUF recommended balance","hw":"All (llama.cpp)"},
{"name":"Q5_K_S","bits":5.5,"bytes":0.69,"quality":"~95-97%","speed":"Faster","use":"GGUF good quality, smaller","hw":"All (llama.cpp)"},
{"name":"Q4_K_M","bits":4.5,"bytes":0.575,"quality":"~93-96%","speed":"Fastest","use":"GGUF most popular (Ollama default)","hw":"All (llama.cpp)"},
{"name":"Q4_K_S","bits":4.3,"bytes":0.5375,"quality":"~92-95%","speed":"Fastest","use":"GGUF smaller Q4 variant","hw":"All (llama.cpp)"},
{"name":"Q4_0","bits":4.0,"bytes":0.5,"quality":"~91-94%","speed":"Fastest","use":"GGUF basic 4-bit","hw":"All (llama.cpp)"},
{"name":"Q3_K_M","bits":3.5,"bytes":0.4375,"quality":"~88-93%","speed":"Fastest","use":"GGUF aggressive compression","hw":"All (llama.cpp)"},
{"name":"Q3_K_L","bits":3.9,"bytes":0.4875,"quality":"~90-94%","speed":"Fastest","use":"GGUF large Q3 variant","hw":"All (llama.cpp)"},
{"name":"Q3_K_S","bits":3.4,"bytes":0.425,"quality":"~85-90%","speed":"Fastest","use":"GGUF small Q3","hw":"All (llama.cpp)"},
{"name":"Q2_K","bits":2.6,"bytes":0.32,"quality":"~80-88%","speed":"Fastest","use":"GGUF extreme (quality loss)","hw":"All (llama.cpp)"},
{"name":"MXFP4","bits":4.25,"bytes":0.53125,"quality":"~93-96%","speed":"Fastest","use":"GPT-OSS native / OCP microscaling (incl. scales)","hw":"Blackwell native; Hopper via SW"},
];
const CASES = [
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
const KV_QUANTS = [{name:'BF16',bytes:2},{name:'FP16',bytes:2},{name:'FP8',bytes:1},{name:'INT8',bytes:1},{name:'INT4',bytes:0.5}];
const REASON_TOK = {'None':0,'Light reasoning':2000,'Heavy reasoning':8000};
const RESIL = {
  n:   {code:0, long:'N · capacity only',                              extraW:n=>0,              live:n=>n},
  n1:  {code:1, long:'N+1 · one standby worker',                       extraW:n=>1,              live:n=>n},
  n2:  {code:7, long:'N+2 · two standby workers',                      extraW:n=>2,              live:n=>n},
  nn:  {code:2, long:'N+N · in-site mirror (2N)',                      extraW:n=>n,              live:n=>n},
  dr:  {code:3, long:'DR · full standby site (active/passive)',        extraW:n=>n,              live:n=>n},
  drh: {code:8, long:'DR · half-size standby site (1.5N)',             extraW:n=>Math.ceil(n/2), live:n=>n, degraded:true},
  aas: {code:9, long:'Active/Active split · N across two sites (1x)',  extraW:n=>0,              live:n=>n, degraded:true},
  aas1:{code:11,long:'Active/Active split + one spare (N+1)',          extraW:n=>1,              live:n=>n, degraded:true},
  aass:{code:10,long:'Active/Active split + spare per site (N+2)',     extraW:n=>2,              live:n=>n, degraded:true},
  aa:  {code:5, long:'Active/Active · two live sites (2N)',            extraW:n=>n,              live:n=>2*n},
  aan1:{code:6, long:'Active/Active · N+1 in each of two sites (2N+2)',extraW:n=>n+2,            live:n=>2*n},
  nndr:{code:4, long:'N+N + DR · active/active twin sites (4N)',       extraW:n=>3*n,            live:n=>2*n},
};

/* ---- engine, verbatim from the studio ---- */

function compute(s){
  const bw = s.bytesW, bk = s.bytesK;
  const weights = s.params * bw;
  const kvTok  = 2 * s.layers * s.kvHeads * s.headDim * bk / 1e9;
  const effSeq = s.resident + (s.extend ? s.reasonTok : 0);
  const replicas = Math.max(1, Math.floor(s.gpus / Math.max(s.tp,1)));
  const active = s.policy === 'all' ? s.concurrent
               : Math.min(s.concurrent, s.batch * replicas);
  const kvTotal = active * effSeq * kvTok;
  const act = Math.min(effSeq, 8192) * s.hidden * 12 * bw / 1e9;
  const fixed = 5, multi = Math.max(0, s.gpus - 1) * 15;
  const weightsAll = replicas * weights, actAll = replicas * act;
  const total = weightsAll + kvTotal + actAll + fixed + multi;
  const servingGpus = replicas * Math.max(s.tp,1), idleGpus = s.gpus - servingGpus;
  const avail = servingGpus * s.gpuVram;
  const bwEff = s.gpuBw * s.tp * s.ic * s.mbu * 1000;
  const batchPerRep = Math.max(1, active / replicas);
  const tps = bwEff / (s.active * bw + batchPerRep * effSeq * kvTok);
  const agg = tps * active;
  const ttft = 2 * s.resident * s.active / (s.gpuTflops * s.tp * s.mfu);
  const itl = 1000 / tps;
  const genTok = s.reasonTok + s.visibleOut;
  const latency = (ttft + s.ovh) / 1000 + genTok / tps;
  const p95 = latency * 1.3;
  const maxBatchMem = Math.max(0, Math.floor((avail - weightsAll - actAll - fixed - multi) / (effSeq * kvTok) / replicas)) || 0;
  const kvDelta = effSeq * kvTok;
  const allActiveVram = weightsAll + s.concurrent * effSeq * kvTok + actAll + fixed + multi;
  const queued = Math.max(0, s.concurrent - active);
  const fits = total <= avail;
  const slo = {
    ttft: s.sloTtft > 0 ? {on:true, pass: ttft <= s.sloTtft} : {on:false, pass:true},
    tps:  s.sloTps  > 0 ? {on:true, pass: tps  >= s.sloTps } : {on:false, pass:true},
    p95:  s.sloP95  > 0 ? {on:true, pass: p95  <= s.sloP95 } : {on:false, pass:true},
  };
  const sloAll = slo.ttft.pass && slo.tps.pass && slo.p95.pass;
  return {weights,weightsAll,kvTok,effSeq,replicas,active,kvTotal,act,actAll,fixed,multi,total,avail,
          servingGpus,idleGpus,bwEff,batchPerRep,tps,agg,ttft,itl,latency,p95,genTok,maxBatchMem,kvDelta,
          allActiveVram,queued,fits,slo,sloAll,headroom:avail-total};
}


/* ---- helpers ---- */
const fmt = x => !isFinite(x) ? '-' : Math.abs(x)>=1000 ? Math.round(x).toLocaleString('en-US') : Math.abs(x)>=100 ? x.toFixed(0) : Math.abs(x)>=10 ? x.toFixed(1) : x.toFixed(2).replace(/\.00$/,'');
const fmtTok = x => x>=1048576 ? (x/1048576)+'M' : x>=1024 ? Math.round(x/1024)+'K' : String(x);
const findBy = (arr, q) => arr.find(x=>x.name.toLowerCase()===q.toLowerCase()) || arr.find(x=>x.name.toLowerCase().includes(q.toLowerCase()));

function makeState(o){
  const m = o.model, g = o.gpu;
  return {
    model:m, gpu:g, wq:o.wq, kq:o.kq,
    params:m.params, active:m.active, hidden:m.hidden, layers:m.layers,
    kvHeads:m.kvHeads, headDim:m.headDim, ctx:m.ctx,
    bytesW:o.wq.bytes, bytesK:o.kq.bytes,
    resident:o.resident, visibleOut:o.visibleOut, reasonTok:o.reasonTok, extend:o.extend!==false,
    concurrent:o.concurrent, batch:o.batch, policy:o.policy||'running',
    workers:o.workers, perW:o.perW, gpus:o.workers*o.perW, tp:Math.min(o.tp, o.workers*o.perW),
    gpuVram:g.vram, gpuBw:g.bw, gpuTflops:g.tflops,
    mfu:o.mfu??0.5, mbu:o.mbu??0.65, ic:o.ic??(o.tp>o.perW?0.7:0.85), ovh:o.ovh??30,
    sloTtft:o.sloTtft??0, sloTps:o.sloTps??0, sloP95:o.sloP95??0,
  };
}

function autoSolve(o){ // ports the studio auto-sizer
  const pack=(o.target??80)/100;
  const weights=o.model.params*o.wq.bytes;
  const act=Math.min(o.resident+(o.reasonTok||0),8192)*o.model.hidden*12*o.wq.bytes/1e9;
  let tp=[1,2,4,8,16,32,64,72].find(t=>weights+act<=pack*t*o.gpu.vram);
  if(!tp) return {error:`No TP up to 72 fits one copy of ${o.model.name} (${fmt(weights)} GB at ${o.wq.name}) on ${o.gpu.name}. Quantize further or pick a higher-VRAM GPU.`};
  if(o.sloTtft>0){ let t=tp; while(t<64 && 2*o.resident*o.model.active/(o.gpu.tflops*t*0.5)>o.sloTtft) t*=2; tp=Math.min(72,t); }
  const interactive=(o.sloTtft>0||o.sloTps>0||o.sloP95>0);
  const evalW=(workers,batch)=>compute(makeState({...o, workers, batch, tp}));
  let workers, batch, d;
  if(interactive){
    workers=Math.min(64,Math.max(1,Math.ceil(Math.max(1,Math.ceil(o.concurrent/64))*tp/o.perW)));
    for(;;){
      const replicas=Math.max(1,Math.floor(workers*o.perW/tp));
      batch=Math.min(64,Math.max(1,Math.ceil(o.concurrent/replicas)));
      d=evalW(workers,batch);
      if(d.total<=pack*d.avail||workers>=64) break;
      workers++;
    }
  } else {
    workers=Math.max(1,Math.ceil(tp/o.perW));
    outer: for(;;){
      for(const b of [256,128,64,32,16,8,4,2,1]){ batch=b; d=evalW(workers,b); if(d.total<=pack*d.avail) break outer; }
      if(workers>=64) break; workers++;
    }
  }
  return {tp, workers, batch, d, s:makeState({...o, workers, batch, tp})};
}

function story(s,d){
  const m=s.model, g=s.gpu, L=[];
  const minGpus=Math.ceil((d.weights+d.act)/s.gpuVram);
  L.push(`One copy of ${m.name} at ${s.wq.name} weighs ${fmt(d.weights)} GB (${fmt(s.params)}B params x ${s.bytesW} B). A ${g.name} holds ${fmt(s.gpuVram)} GB, so one copy needs at least ${minGpus} GPU(s); it is sliced across TP${s.tp} (${fmt(s.tp*s.gpuVram)} GB per group).`);
  if(d.replicas>1) L.push(`Serving ${s.concurrent} concurrent calls at batch ${s.batch} takes ${d.replicas} full copies: ${d.replicas} x TP${s.tp} = ${d.servingGpus||s.gpus} GPUs on ${s.workers} workers${d.queued>0?` (${d.queued} calls queue at peak)`:''}. The model alone needed ${minGpus}; the rest serve concurrency.`);
  else L.push(`One copy serves everything: batch ${s.batch} admits ${d.active} of ${s.concurrent} calls${d.queued>0?`, ${d.queued} queue`:''}.`);
  L.push(`KV cache: ${(d.kvTok*1e6).toFixed(1)} KB/token at ${s.kq.name}; ${fmt(d.effSeq*d.kvTok)} GB per admitted ${fmtTok(d.effSeq)}-token conversation; ${fmt(d.kvTotal)} GB total across ${d.active} admitted.`);
  L.push(`Envelope: TTFT ~${fmt(d.ttft)} ms, ~${fmt(d.tps)} tok/s per user, aggregate ~${fmt(d.agg)} tok/s, mean latency ${fmt(d.latency)} s (P95 ~${fmt(d.p95)} s).`);
  return L;
}

function report(s,d,resil){
  const info=RESIL[resil||'n'], extraW=info.extraW(s.workers), procW=s.workers+extraW, procG=procW*s.perW;
  const out={
    fits:d.fits, utilizationPct:+(d.total/d.avail*100).toFixed(1),
    memory:{ totalGB:+d.total.toFixed(1), availGB:d.avail, weightsPerReplicaGB:+d.weights.toFixed(1),
      weightsAllGB:+d.weightsAll.toFixed(1), kvTotalGB:+d.kvTotal.toFixed(1), replicas:d.replicas,
      kvPerTokenKB:+(d.kvTok*1e6).toFixed(2), headroomGB:+d.headroom.toFixed(1) },
    fleet:{ workers:s.workers, gpusPerWorker:s.perW, servingGpus:d.servingGpus||s.gpus, tp:s.tp, batchPerReplica:s.batch,
      admitted:d.active, queued:d.queued },
    performance:{ ttftMs:+d.ttft.toFixed(1), perUserTps:+d.tps.toFixed(1), aggregateTps:+d.agg.toFixed(0),
      meanLatencyS:+d.latency.toFixed(2), p95S:+d.p95.toFixed(2) },
    slo:{ ttft:s.sloTtft? (d.slo.ttft.pass?'PASS':'FAIL'):'off', tps:s.sloTps? (d.slo.tps.pass?'PASS':'FAIL'):'off',
      p95:s.sloP95? (d.slo.p95.pass?'PASS':'FAIL'):'off' },
    resilience:{ model:info.long, procuredWorkers:procW, procuredGpus:procG, powerKwTdp:+(procG*s.gpu.watts/1000).toFixed(1),
      degradedOnSiteLoss:!!info.degraded },
    story: story(s,d),
    caveat:'Peak estimates; production typically achieves 70-90%. Validate with vLLM bench / GenAI-Perf. Interactive studio: https://gpuscale.net',
  };
  return out;
}

/* ---- CLI ---- */
const args={}; const argv=process.argv.slice(2);
for(let i=0;i<argv.length;i++){ const a=argv[i];
  if(a.startsWith('--')){ const k=a.slice(2); const v=(argv[i+1]&&!argv[i+1].startsWith('--'))?argv[++i]:true; args[k]=v; } }

if(args['list-models']){ MODELS.forEach(m=>console.log(`${m.name}  · ${m.params}B total / ${m.active}B active · ctx ${fmtTok(m.ctx)} · ${m.arch}`)); process.exit(0); }
if(args['list-gpus']){ GPUS.forEach(g=>console.log(`${g.name}  · ${g.vram} GB · ${g.bw} TB/s · ${g.tflops} dense FP16 TF · ${g.watts} W`)); process.exit(0); }
if(args['list-workloads']){ CASES.forEach(c=>console.log(`${c.name}  · ctx ${fmtTok(c.resident||0)} · out ${c.visibleOut} · reasoning ${c.reasoning} · SLO ${c.ttftTarget}ms/${c.tpsTarget}tps/${c.p95Target}s`)); process.exit(0); }
if(args.help||Object.keys(args).length===0){
  console.log(`GPUscale sizing CLI (engine v${META.engine}, library ${META.library})
Usage:
  sizing.mjs --model "DeepSeek-V3" --gpu B300 --quant FP8 [--kv FP8]
             (--workload "Internal GPT" | --resident 16384 --out 800 --reasoning 0)
             --concurrent 377 [--auto [--target 80] | --workers 3 --tp 4 --batch 63]
             [--perw 8] [--resilience n1|aa|aas|drh|nndr|...] [--json]
  sizing.mjs --list-models | --list-gpus | --list-workloads`);
  process.exit(0);
}

const model=findBy(MODELS, String(args.model||''));
if(!model){ console.error('Unknown model. Try --list-models'); process.exit(1); }
const gpu=findBy(GPUS, String(args.gpu||'H100 80GB SXM'));
if(!gpu){ console.error('Unknown GPU. Try --list-gpus'); process.exit(1); }
const wq=QUANTS.find(q=>q.name.toLowerCase()===String(args.quant||'FP8').toLowerCase())||QUANTS.find(q=>q.name==='FP8');
const kq=KV_QUANTS.find(q=>q.name.toLowerCase()===String(args.kv||'FP8').toLowerCase())||KV_QUANTS[2];

let wl={resident:4096, visibleOut:400, reasonTok:0, sloTtft:0, sloTps:0, sloP95:0};
if(args.workload){
  const c=CASES.find(x=>x.name.toLowerCase().includes(String(args.workload).toLowerCase()));
  if(c) wl={resident:c.resident||4096, visibleOut:c.visibleOut||400, reasonTok:REASON_TOK[c.reasoning]||0,
            sloTtft:c.ttftTarget||0, sloTps:c.tpsTarget||0, sloP95:c.p95Target||0};
}
if(args.resident) wl.resident=+args.resident;
if(args.out) wl.visibleOut=+args.out;
if(args.reasoning) wl.reasonTok=+args.reasoning;
if(args.ttft) wl.sloTtft=+args.ttft;
if(args.tps) wl.sloTps=+args.tps;
if(args.p95) wl.sloP95=+args.p95;

const base={ model, gpu, wq, kq, ...wl, concurrent:+(args.concurrent||64), perW:+(args.perw||8), extend:true };

let s,d;
if(args.auto || !(args.workers&&args.tp)){
  const sol=autoSolve({...base, target:+(args.target||80)});
  if(sol.error){ console.error(sol.error); process.exit(2); }
  s=sol.s; d=sol.d;
} else {
  s=makeState({...base, workers:+args.workers, tp:+args.tp, batch:+(args.batch||4)});
  d=compute(s);
}
const rep=report(s,d,String(args.resilience||'n'));
if(args.json){ console.log(JSON.stringify(rep,null,2)); }
else {
  console.log(`\n=== ${model.name} · ${wq.name} weights / ${kq.name} KV · ${gpu.name} ===`);
  console.log(`${rep.fits?'FITS':'DOES NOT FIT'} · ${rep.utilizationPct}% of serving memory · ${rep.fleet.workers} workers x ${rep.fleet.gpusPerWorker} GPUs · ${rep.memory.replicas} replicas x TP${rep.fleet.tp} · batch ${rep.fleet.batchPerReplica}`);
  console.log(`admitted ${rep.fleet.admitted}/${s.concurrent}${rep.fleet.queued?` (queued ${rep.fleet.queued})`:''} · TTFT ${rep.performance.ttftMs} ms · ${rep.performance.perUserTps} tok/s/user · P95 ${rep.performance.p95S} s`);
  console.log(`SLO: TTFT ${rep.slo.ttft} · TPS ${rep.slo.tps} · P95 ${rep.slo.p95}`);
  console.log(`resilience ${rep.resilience.model}: ${rep.resilience.procuredWorkers} workers · ${rep.resilience.procuredGpus} GPUs · ~${rep.resilience.powerKwTdp} kW TDP`);
  console.log('');
  rep.story.forEach(p=>console.log('· '+p));
  console.log('\n'+rep.caveat);
}
