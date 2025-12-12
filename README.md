# Token Gate

A lightweight API gateway that enables Anthropic API clients (like Claude Code) to use alternative LLM backends such as vLLM, Ollama, or any OpenAI-compatible server.

## Why Token Gate?

Token Gate acts as a translation layer between Anthropic API clients and OpenAI-compatible backends. This allows you to:

- Use Claude Code with self-hosted models (vLLM, Ollama, etc.)
- Route vision requests to specialized models
- Track token usage across requests
- Maintain a single API interface for multiple backends

## Features

- **Dual API Support**: Accepts both Anthropic (`/v1/messages`) and OpenAI (`/v1/chat/completions`) formats
- **Vision Routing**: Automatically routes image requests to a vision-capable backend
- **Format Conversion**: Converts between Anthropic and OpenAI formats transparently
- **Token Telemetry**: Tracks input/output tokens per request
- **Health Checks**: Verifies backend connectivity at startup
- **SSE Streaming**: Full support for streaming responses

## Quick Start

```bash
# Install
npm install

# Run with a vLLM backend
VLLM_URL=http://localhost:8000 VLLM_MODEL=qwen npm run dev

# Test
curl http://localhost:3456/health
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3456` | Server port |
| `HOST` | `0.0.0.0` | Server host |
| `API_KEY` | `sk-anthropic-router` | API key for client authentication |
| `VLLM_URL` | `http://localhost:8000` | Default backend URL |
| `VLLM_API_KEY` | - | Backend API key (if required) |
| `VLLM_MODEL` | `qwen3-coder-30b-fp8` | Model name to use |
| `VISION_URL` | - | Vision backend URL (optional) |
| `VISION_API_KEY` | - | Vision backend API key |
| `VISION_MODEL` | `gpt-4-vision` | Vision model name |
| `VISION_ANTHROPIC_NATIVE` | `false` | Use Anthropic format for vision backend |
| `TELEMETRY_ENABLED` | `false` | Enable token usage tracking |
| `LOG_LEVEL` | `info` | Log level (debug/info/warn/error) |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/messages` | Anthropic Messages API |
| `POST` | `/v1/chat/completions` | OpenAI Chat Completions API |
| `POST` | `/v1/messages/count_tokens` | Token counting |
| `GET` | `/v1/models` | List available models |
| `GET` | `/health` | Health check |
| `GET` | `/stats` | Token usage statistics |

## Claude Code Integration

```bash
export ANTHROPIC_BASE_URL="http://localhost:3456"
export ANTHROPIC_API_KEY="your-api-key"
export ANTHROPIC_MODEL="your-model-name"
claude
```

## Architecture

```
+------------------+
|     Clients      |
| (Claude Code,    |
|  OpenWebUI, etc) |
+--------+---------+
         |
         v
+------------------+
|   Token Gate     |
|  - Auth          |
|  - Routing       |
|  - Conversion    |
|  - Telemetry     |
+--------+---------+
         |
    +----+----+
    |         |
    v         v
+------+  +--------+
| vLLM |  | Vision |
+------+  +--------+
```

## Documentation

- [Vision Routing](docs/vision.md) - How to configure vision model routing
- [Deployment Guide](docs/deployment.md) - Local, Docker, and Kubernetes deployment

## Development

```bash
npm install      # Install dependencies
npm run dev      # Development with hot reload
npm run build    # Production build
npm test         # Run tests
npm run lint     # Run linter
```

## License

MIT
