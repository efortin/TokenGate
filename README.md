# Toktoken

![CI](https://github.com/efortin/token-gate/actions/workflows/ci.yml/badge.svg) ![codecov](https://codecov.io/gh/efortin/token-gate/graph/badge.svg) [![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/) [![Node](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)](https://nodejs.org/) [![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A lightweight API gateway enabling AI clients like Claude Code and Vibe to use vLLM backends with Mistral models (Devstral, Codestral, Qwen, etc.).

## Features

- **Dual API Support**: Anthropic `/v1/messages` + OpenAI `/v1/chat/completions`
- **Automatic Fixes**: Transparently resolves Mistral/vLLM compatibility issues
- **Pipeline Architecture**: Composable transformers for request/response processing
- **SSE Streaming**: Real-time streaming with format conversion
- **Vision Support**: Routes image requests to capable backends
- **Metrics & Health**: Built-in Prometheus metrics and health checks

## Quick Start

```bash
# 1. Install and run
npm install
VLLM_URL=http://localhost:8000 npm run dev

# 2. Test health endpoint
curl http://localhost:3456/health
```

### With Claude Code

```bash
export ANTHROPIC_BASE_URL="http://localhost:3456"
export ANTHROPIC_API_KEY="your-key"
claude
```

### With Vibe

```toml
# ~/.vibe/config.toml
[[providers]]
name = "vllm-direct"
api_base = "http://localhost:3456/v1"
api_key_env_var = "VLLM_API_KEY"
api_style = "openai"
backend = "generic"
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3456` | Server port |
| `VLLM_URL` | `http://localhost:8000` | vLLM backend URL |
| `VLLM_API_KEY` | - | Backend API key |
| `VLLM_MODEL` | - | Model name (auto-discovered) |
| `VISION_URL` | - | Vision backend URL |
| `LOG_LEVEL` | `info` | Log level (debug, info, warn, error) |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/messages` | Anthropic Messages API |
| `POST` | `/v1/chat/completions` | OpenAI Chat Completions |
| `POST` | `/v1/completions` | Legacy completions |
| `GET` | `/v1/models` | List models |
| `GET` | `/health` | Health check |
| `GET` | `/metrics` | Prometheus metrics |

## Mistral Compatibility Fixes

| Issue | Problem | Fix |
|-------|---------|-----|
| `index` field | vLLM rejects `tool_calls` with index field | Stripped automatically |
| Malformed JSON | Mistral generates invalid JSON in arguments | Sanitized to `{}` |
| Empty messages | vLLM tokenizer fails on empty assistant messages | Filtered out |
| Long tool IDs | Mistral limits IDs to 9 alphanumeric chars | Truncated with hash |
| Orphan tool_choice | vLLM rejects tool_choice without tools | Removed when no tools |

## Documentation

- **[Architecture](docs/architecture.md)** - Pipeline design and flow
- **[Vibe Config](docs/vibe-config.md)** - Configure Vibe with Token-Gate
- **[Vision Support](docs/vision.md)** - Image handling and routing
- **[vLLM Configs](docs/vllm/)** - Pre-configured model setups

## Development

```bash
npm install      # Install dependencies
npm run dev      # Development with hot reload
npm run build    # Production build
npm test         # Run tests (146 tests, 97%+ coverage)
npm run lint     # Run linter
```

## License

MIT
