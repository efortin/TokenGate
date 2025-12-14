# Qwen3 Coder 30B FP8 - vLLM Configuration

> Tested on **2x RTX 3090** (48GB VRAM total)

Configuration for `Qwen/Qwen3-Coder-30B-A3B-Instruct-FP8` with vLLM.

## Launch vLLM

```bash
vllm serve Qwen/Qwen3-Coder-30B-A3B-Instruct-FP8 \
  --served-model-name qwen3-coder-30b-fp8 \
  --tool-call-parser qwen3_coder \
  --enable-auto-tool-choice \
  --tensor-parallel-size 2 \
  --dtype auto \
  --kv-cache-dtype fp8 \
  --max-model-len 132000 \
  --max-num-batched-tokens 16384 \
  --max-num-seqs 4 \
  --enable-prefix-caching \
  --enable-chunked-prefill \
  --gpu-memory-utilization 0.94 \
  --host 0.0.0.0 \
  --port 8000
```

## Critical Options

### Tool Calling

| Option | Value | Description |
|--------|-------|-------------|
| `--tool-call-parser` | `qwen3_coder` | Qwen3 Coder specific parser |
| `--enable-auto-tool-choice` | - | Enable automatic tool selection |

> ⚠️ Use `qwen3_coder`, not `hermes` or `mistral`.

### Performance 2x RTX 3090

| Option | Value | Description |
|--------|-------|-------------|
| `--tensor-parallel-size` | `2` | Split across 2 GPUs |
| `--kv-cache-dtype` | `fp8` | KV cache in FP8 (saves VRAM) |
| `--max-model-len` | `132000` | 132k token context |
| `--gpu-memory-utilization` | `0.94` | Leave margin to avoid OOM |

## Devstral vs Qwen3 Coder Comparison

| Aspect | Devstral 24B | Qwen3 Coder 30B FP8 |
|--------|--------------|---------------------|
| Tool parser | `mistral` | `qwen3_coder` |
| Max context | 140k | 132k |
| Tool ID format | 9 chars alphanum | Standard |
| Quantization | BF16 | Native FP8 |
| VRAM 2x3090 | ✅ | ✅ |

## Environment Variables

```bash
PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True
CUDA_VISIBLE_DEVICES=0,1
```

## Verification

```bash
# Health check
curl http://localhost:8000/health

# Test completion
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3-coder-30b-fp8",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```
