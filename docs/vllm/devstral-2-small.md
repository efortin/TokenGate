# Devstral Small 2 24B - vLLM Configuration

> Tested on **2x RTX 3090** (48GB VRAM total)

Optimized configuration for `mistralai/Devstral-Small-2-24B-Instruct-2512` with vLLM.

## Launch vLLM

```bash
vllm serve mistralai/Devstral-Small-2-24B-Instruct-2512 \
  --served-model-name devstral-small-2-24b \
  --tool-call-parser mistral \
  --enable-auto-tool-choice \
  --tensor-parallel-size 2 \
  --dtype auto \
  --kv-cache-dtype fp8 \
  --max-model-len 140000 \
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
| `--tool-call-parser` | `mistral` | Mistral-specific parser for tool calls |
| `--enable-auto-tool-choice` | - | Enable automatic tool selection |

> ⚠️ **Without these options**, vLLM won't parse Mistral tool calls correctly.

### Performance

| Option | Value | Description |
|--------|-------|-------------|
| `--tensor-parallel-size` | `2` | Number of GPUs (adjust per setup) |
| `--kv-cache-dtype` | `fp8` | KV cache in FP8 to save VRAM |
| `--max-model-len` | `140000` | Max context window (~140k tokens) |
| `--enable-prefix-caching` | - | Cache common prefixes |
| `--enable-chunked-prefill` | - | Chunked prefill for better memory |
| `--gpu-memory-utilization` | `0.94` | GPU utilization (leave margin for OOM) |

### Batching

| Option | Value | Description |
|--------|-------|-------------|
| `--max-num-batched-tokens` | `16384` | Max tokens per batch |
| `--max-num-seqs` | `4` | Max concurrent sequences |

## Mistral/vLLM Edge Cases

Token-Gate proxy automatically handles these compatibility issues:

### 1. `index` field forbidden in `tool_calls`

vLLM rejects requests with `index` in tool calls.

```typescript
// Before (vLLM error)
tool_calls: [{ index: 0, id: "abc", function: {...} }]

// After (OK)
tool_calls: [{ id: "abc", function: {...} }]
```

### 2. Malformed JSON in arguments

Mistral can generate invalid JSON. The proxy sanitizes:

```typescript
// Before
arguments: "{ invalid json"

// After
arguments: "{}"
```

### 3. Empty assistant messages

vLLM tokenizer fails on assistant messages without content or tool_calls.

```typescript
// Automatically filtered
{ role: "assistant", content: "" }
```

### 4. tool_call IDs > 9 characters

Mistral limits IDs to 9 alphanumeric characters.

```typescript
// Before
id: "toolu_01ABC123XYZ"

// After  
id: "ABC123XYZ"
```

### 5. `tool_choice` without `tools`

vLLM rejects `tool_choice` if `tools` is empty or missing.

```typescript
// Before (error)
{ tool_choice: "auto", tools: [] }

// After (OK)
{ tools: [] }
```

## Environment Variables

```bash
# PyTorch performance
PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True

# HuggingFace (if private model)
HF_TOKEN=hf_xxx
```

## Required Resources

- **GPU**: 2x RTX 3090/4090 or equivalent (48GB VRAM total)
- **RAM**: 64GB recommended
- **Storage**: ~50GB for model

## Verification

```bash
# Health check
curl http://localhost:8000/health

# Test completion
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "devstral-small-2-24b",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```
