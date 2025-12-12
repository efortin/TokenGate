# Anthropic Router

A lightweight TypeScript proxy that enables [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and other Anthropic API clients to use [vLLM](https://docs.vllm.ai/) backends.

## Features

- **Anthropic API Compatible**: Proxies `/v1/messages` endpoint to vLLM
- **OpenAI API Compatible**: Also supports `/v1/chat/completions` endpoint
- **Vision Routing**: Optionally routes image requests to a separate vision-capable model
- **Token Telemetry**: Tracks token usage per request
- **Startup Health Check**: Verifies backend connectivity before accepting requests
- **SSE Streaming**: Full support for streaming responses

## Use Cases

- Run Claude Code with local/self-hosted LLMs via vLLM
- Use any vLLM-compatible model with Anthropic API clients
- Route vision requests to specialized models (e.g., GPT-4 Vision)

## Quick Start

```bash
# Install dependencies
npm install

# Development (with hot reload)
npm run dev

# Production build
npm run build
npm start
```

## Configuration

All configuration is done via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3456` | Server port |
| `HOST` | `0.0.0.0` | Server host |
| `API_KEY` | `sk-anthropic-router` | API key for client authentication |
| `VLLM_URL` | `http://localhost:8000` | vLLM backend URL |
| `VLLM_API_KEY` | - | vLLM API key (if required) |
| `VLLM_MODEL` | `default` | Model name to report to clients |
| `VISION_URL` | - | Vision backend URL (optional) |
| `VISION_API_KEY` | - | Vision backend API key |
| `VISION_MODEL` | `gpt-4-vision` | Vision model name |
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

## Docker

### Build

```bash
docker build -t anthropic-router .
```

### Run

```bash
docker run -d --name anthropic-router \
  -p 3456:3456 \
  -e VLLM_URL=http://your-vllm-server:8000 \
  -e VLLM_API_KEY=your-vllm-api-key \
  -e VLLM_MODEL=your-model-name \
  -e API_KEY=your-api-key \
  anthropic-router
```

### Local vLLM (Docker Desktop)

```bash
docker run -d --name anthropic-router \
  -p 3456:3456 \
  -e VLLM_URL=http://host.docker.internal:8000 \
  -e VLLM_MODEL=your-model-name \
  -e API_KEY=your-api-key \
  anthropic-router
```

### Container Management

```bash
docker logs -f anthropic-router  # View logs
docker stop anthropic-router     # Stop
docker rm anthropic-router       # Remove
```

## Claude Code Integration

Configure Claude Code to use the router:

```bash
export ANTHROPIC_BASE_URL="http://localhost:3456"
export ANTHROPIC_API_KEY="your-api-key"
export ANTHROPIC_MODEL="your-model-name"
claude
```

Or create a shell function:

```bash
function claude-local() {
  ANTHROPIC_BASE_URL="http://localhost:3456" \
  ANTHROPIC_API_KEY="your-api-key" \
  ANTHROPIC_MODEL="your-model-name" \
  claude "$@"
}
```

## Testing

```bash
# Run tests
npm test

# Run linter
npm run lint

# Health check
curl http://localhost:3456/health

# List models
curl http://localhost:3456/v1/models

# Chat completion (OpenAI format)
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "your-model-name",
    "messages": [{"role": "user", "content": "Hello!"}],
    "max_tokens": 100
  }'

# Anthropic format
curl -X POST http://localhost:3456/v1/messages \
  -H "x-api-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "your-model-name",
    "messages": [{"role": "user", "content": "Hello!"}],
    "max_tokens": 100
  }'
```

## Architecture

```
┌─────────────────────────────────────────┐
│              Clients                    │
│  (Claude Code, OpenWebUI, curl, etc.)   │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│          Anthropic Router               │
│  ┌─────────────────────────────────┐    │
│  │ • Startup health check          │    │
│  │ • API key validation            │    │
│  │ • Vision routing (optional)     │    │
│  │ • Token telemetry               │    │
│  │ • SSE streaming                 │    │
│  └─────────────────────────────────┘    │
└────────────────┬────────────────────────┘
                 │
        ┌────────┴────────┐
        ▼                 ▼
┌───────────────┐  ┌───────────────┐
│     vLLM      │  │    Vision     │
│   (default)   │  │  (optional)   │
└───────────────┘  └───────────────┘
```

## License

MIT
