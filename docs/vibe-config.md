# Vibe Configuration for Token-Gate

`~/.vibe/config.toml` configuration to use Vibe with Token-Gate proxy and vLLM.

## Essential Configuration

```toml
# Active model
active_model = "devstral"

# Auto-compact threshold (85% of vLLM max-model-len)
# vLLM max-model-len = 140000, so 140000 * 0.85 ≈ 119000
auto_compact_threshold = 115000

# API timeout (vLLM can be slow on long contexts)
api_timeout = 720.0
```

## Token-Gate Provider

```toml
[[providers]]
name = "vllm-direct"
api_base = "http://localhost:3456/v1"  # Token-Gate proxy
api_key_env_var = "VLLM_API_KEY"
api_style = "openai"
backend = "generic"  # Important: not "mistral" since we go through proxy
```

### Why `backend = "generic"`?

- Token-Gate proxy handles Mistral/vLLM compatibility
- Using `backend = "mistral"` would conflict with proxy transformations
- `generic` sends standard OpenAI requests that the proxy transforms

## Model

```toml
[[models]]
name = "devstral-small-2-24b"  # Must match --served-model-name vLLM
provider = "vllm-direct"
alias = "devstral"              # For `active_model`
temperature = 0.7
input_price = 0.0               # Local = free
output_price = 0.0
```

## Project Context

```toml
[project_context]
max_chars = 40000        # Project context limit
default_commit_count = 5
max_doc_bytes = 32768
max_depth = 3
max_files = 1000
```

## Session Logging

```toml
[session_logging]
save_dir = "/Users/manu/.vibe/logs/session"
session_prefix = "session"
enabled = true
```

## Key Differences vs Direct vLLM

| Parameter | Direct vLLM | Via Token-Gate |
|-----------|-------------|----------------|
| `api_base` | `https://openai.example.io/v1` | `http://localhost:3456/v1` |
| `backend` | `mistral` | `generic` |
| `auto_compact_threshold` | Not needed | 85% of max-model-len |

## Environment Variables

```bash
export VLLM_API_KEY="sk-your-api-key"
```

## Verification

```bash
# Start the proxy
cd ~/Projects/token-gate && npm run dev

# Test with Vibe
vibe "Hello, how are you?"
```
