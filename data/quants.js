// GPUscale.net · weight quantization tiers (bytes per parameter)
// One entry per line. Field reference: README.md → “Data schemas”.
window.GPUSCALE_DATA = window.GPUSCALE_DATA || {};
window.GPUSCALE_DATA.quants = [
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
