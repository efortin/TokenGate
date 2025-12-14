# Token-Gate

[![CI](https://github.com/efortin/token-gate/actions/workflows/ci.yml/badge.svg)](https://github.com/efortin/token-gate/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/badge/coverage-97.78%25-brightgreen)](https://github.com/efortin/token-gate)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

<p align="center">
  <strong>vLLM Proxy with Mistral/Devstral Compatibility Layer</strong>
</p>

<p align="center">
  <a href="#-key-features">Features</a> •
  <a href="#-mistralvllm-fixes">Mistral Fixes</a> •
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-documentation">Docs</a>
</p>

---

A lightweight API gateway that enables **Claude Code**, **Vibe**, and other AI clients to use **vLLM** backends with Mistral models (Devstral, Codestral, etc.).

## ✨ Key Features

| Feature | Description |
|---------|-------------|
| 🔄 **Dual API Support** | Anthropic `/v1/messages` + OpenAI `/v1/chat/completions` |
| 🛠️ **Mistral/vLLM Fixes** | Automatic fixes for Devstral 2 Small compatibility issues |
| 🎯 **Pipeline Architecture** | Composable `pipe()` + `when()` transformers |
| 📡 **SSE Streaming** | Full streaming support with format conversion |
| 👁️ **Vision Routing** | Route image requests to vision-capable backend |
| 📊 **Prometheus Metrics** | Built-in `/metrics` endpoint |

## 🔧 Mistral/vLLM Fixes

Token-Gate **automatically fixes** these Devstral 2 Small / vLLM compatibility issues:

| Issue | Problem | Fix |
|-------|---------|-----|
| **`index` field** | vLLM rejects `tool_calls` with `index` field | Stripped automatically |
| **Malformed JSON** | Mistral generates invalid JSON in `arguments` | Sanitized to `{}` |
| **Empty messages** | vLLM tokenizer fails on empty assistant messages | Filtered out |
| **Long tool IDs** | Mistral limits IDs to 9 alphanumeric chars | Truncated (`toolu_01ABC...` → `ABC123XYZ`) |
| **Orphan tool_choice** | vLLM rejects `tool_choice` without `tools` | Removed when no tools |

> 💡 These fixes are applied transparently — no client changes needed.

## 🚀 Quick Start

```bash
# Install
npm install

# Run with vLLM backend
VLLM_URL=http://localhost:8000 npm run dev

# Test
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
backend = "generic"  # Important: not "mistral"
```

## ⚙️ Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3456` | Server port |
| `VLLM_URL` | `http://localhost:8000` | vLLM backend URL |
| `VLLM_API_KEY` | - | Backend API key |
| `VLLM_MODEL` | - | Model name (auto-discovered) |
| `VISION_URL` | - | Vision backend URL |
| `LOG_LEVEL` | `info` | Log level |

## 📡 API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/messages` | Anthropic Messages API |
| `POST` | `/v1/chat/completions` | OpenAI Chat Completions |
| `POST` | `/v1/completions` | Legacy completions |
| `GET` | `/v1/models` | List models |
| `GET` | `/health` | Health check |
| `GET` | `/metrics` | Prometheus metrics |

## 🏗️ Architecture

```
┌─────────────────┐     ┌─────────────────┐
│   Claude Code   │     │      Vibe       │
│   (Anthropic)   │     │    (OpenAI)     │
└────────┬────────┘     └────────┬────────┘
         │                       │
         └───────────┬───────────┘
                     ▼
         ┌───────────────────────┐
         │     Token-Gate        │
         │  ┌─────────────────┐  │
         │  │ Pipeline:       │  │
         │  │ • stripImages   │  │
         │  │ • filterEmpty   │  │
         │  │ • normalizeIDs  │  │
         │  │ • sanitizeJSON  │  │
         │  └─────────────────┘  │
         └───────────┬───────────┘
                     ▼
         ┌───────────────────────┐
         │   vLLM + Devstral     │
         └───────────────────────┘
```

## 📚 Documentation

| Doc | Description |
|-----|-------------|
| [Architecture](docs/architecture.md) | Pipeline architecture & flow diagrams |
| [Mistral Edge Cases](docs/mistral-edge-cases.md) | Detailed compatibility fixes |
| [Vibe Config](docs/vibe-config.md) | Vibe configuration guide |
| [Devstral vLLM](docs/vllm/devstral-2-small.md) | Devstral 24B vLLM config (2x3090) |
| [Qwen3 Coder vLLM](docs/vllm/qwen3-coder.md) | Qwen3 Coder 30B vLLM config |

## 🧪 Development

```bash
npm install      # Install dependencies
npm run dev      # Development with hot reload
npm run build    # Production build
npm test         # Run tests (135 tests, 97% coverage)
npm run lint     # Run linter
```

## 📈 Stats

- **135 tests** with **97.78% coverage**
- **~230 lines** of route code (KISS architecture)
- **0 ESLint errors**

## 📄 License

MIT
