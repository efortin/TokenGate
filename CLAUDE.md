# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Token-Gate is a lightweight API gateway that enables Anthropic API clients (like Claude Code and Vibe) to use **vLLM backends** with Mistral models (Devstral, Codestral, etc.). It acts as a compatibility layer that automatically fixes vLLM/Mistral compatibility issues.

## Architecture

The project is a Fastify-based proxy server with a pipeline architecture:

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

## Directory Structure

```
src/
├── app.ts                  # Fastify application builder (46 lines)
├── config.ts               # Configuration loader (17 lines)
├── index.ts                # Main entry point (60 lines)
├── types/                  # TypeScript interfaces
│   └── index.ts            # API request/response types (108 lines)
├── routes/
│   ├── openai.ts           # OpenAI API routes & pipeline (107 lines)
│   ├── anthropic.ts        # Anthropic API routes (120 lines)
│   └── system.ts           # Health check & metrics (40 lines)
├── services/
│   └── backend.ts          # HTTP client for vLLM (119 lines)
├── utils/
│   ├── pipeline.ts         # pipe() & when() combinators (11 lines)
│   ├── convert.ts          # Request/response transformations (431 lines)
│   ├── images.ts           # Image handling (77 lines)
│   ├── tokens.ts           # Token counting (64 lines)
│   └── auth.ts             # Backend authentication (21 lines)
└── prompts/
    └── web-search.ts       # Web search system prompt (13 lines)
```

## Development Commands

```bash
npm install      # Install dependencies
npm run dev      # Development with hot reload
npm run build    # Production build (TypeScript → dist/)
npm test         # Run tests (113 tests, 97%+ coverage)
npm run lint     # Run ESLint
npm run lint:fix # Auto-fix linting issues
```

## Key Features

### 1. Dual API Support
- **Anthropic format**: `/v1/messages` - Used by Claude Code
- **OpenAI format**: `/v1/chat/completions` - Used by Vibe
- **Legacy**: `/v1/completions` for backward compatibility

### 2. Mistral/vLLM Compatibility Fixes

Token-Gate automatically fixes these Devstral 2 Small / vLLM compatibility issues:

| Issue | Problem | Fix |
|-------|---------|-----|
| **`index` field** | vLLM rejects `tool_calls` with `index` field | Stripped automatically |
| **Malformed JSON** | Mistral generates invalid JSON in `arguments` | Sanitized to `{}` |
| **Empty messages** | vLLM tokenizer fails on empty assistant messages | Filtered out |
| **Long tool IDs** | Mistral limits IDs to 9 alphanumeric chars | Truncated (`toolu_01ABC...` → `ABC123XYZ`) |
| **Orphan tool_choice** | vLLM rejects `tool_choice` without `tools` | Removed when no tools |

### 3. Pipeline Architecture

The core architecture uses composable transformers:

```typescript
// utils/pipeline.ts
const pipe = <T>(...fns: Transformer<T>[]): Transformer<T> =>
  (data: T) => fns.reduce((acc, fn) => fn(acc), data);

const when = <T>(cond: boolean, fn: Transformer<T>): Transformer<T> =>
  cond ? fn : (x) => x;
```

**OpenAI pipeline:**
```typescript
const transform = pipe<OpenAIRequest>(
  filterEmptyAssistantMessages,
  normalizeOpenAIToolIds,
  sanitizeToolChoice,
);
```

**Anthropic pipeline:**
```typescript
const preprocess = pipe<AnthropicRequest>(
  stripAnthropicImages,
  injectWebSearchPrompt,
);
```

## Configuration

All configuration comes from environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3456` | Server port |
| `VLLM_URL` | `http://localhost:8000` | vLLM backend URL |
| `VLLM_API_KEY` | - | Backend API key |
| `VLLM_MODEL` | - | Model name (auto-discovered if not set) |
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

## Testing

The project has a comprehensive test suite with 113 tests:

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run specific test file
npx vitest run tests/utils/convert.test.ts
```

## Key Implementation Details

### Request Flow

1. **Incoming Request**: Client sends Anthropic or OpenAI format
2. **Transformations**: Pipeline applies compatibility fixes
3. **Backend Call**: Prove to vLLM
4. **Response**: Return to client in original format

### Transformations Applied

**OpenAI → vLLM:**
- `filterEmptyAssistantMessages`: Remove invalid assistant messages
- `normalizeOpenAIToolIds`: Strip `index` fields, normalize IDs to 9 chars, sanitize JSON
- `sanitizeToolChoice`: Remove `tool_choice` when no tools present

**Anthropic → OpenAI (for vLLM):**
- `stripAnthropicImages`: Remove images if no vision backend
- `injectWebSearchPrompt`: Add web search instructions to system prompt
- Tool call format conversion
- Message format normalization

**Streaming Support:**
- Both Anthropic and OpenAI SSE streaming formats
- OpenAI → Anthropic stream conversion

### Tool ID Normalization

Mistral has a 9-character limit for tool_call IDs. The code uses a deterministic hash:

```typescript
export function normalizeToolId(id: string): string {
  if (/^[a-zA-Z0-9]{9}$/.test(id)) {
    return id;
  }
  const hash = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0-123456789';
  return Array.from({length: 9}, (_, i) => chars[(hash * (i + 1) * 7) % chars.length]).join('');
}
```

## Documentation

Additional documentation is available in the `docs/` directory:

- `architecture.md`: Detailed architecture and flow diagrams
- `mistral-edge-cases.md`: Comprehensive list of Mistral compatibility issues
- `vibe-config.md`: Configuration guide for Vibe
- `vision.md`: Image/vision support
- `vllm/` directory: vLLM configuration examples for different models

## Environment Setup for Local Development

```bash
# Set required environment variables (example with .env file)
export VLLM_URL=http://localhost:8000

export PORT=3456

# Optional
export LOG_LEVEL=debug

# Run development server
npm run dev

# Test with Claude Code
export ANTHROPIC_BASE_URL="http://localhost:3456"
export ANTHROPIC_API_KEY="your-key-here"
claude
```

## Deploying with vLLM Backend

For production deployments, you'll need:
1. A running vLLM instance
2. The Token-Gate proxy configured to point to it
3. Optionally configure Vibe or Claude Code to use the proxy

See `docs/deployment.md` for more details.
