# Vision Routing

Token Gate can automatically route requests containing images to a separate vision-capable backend.

## How It Works

When a request contains image content, Token Gate detects it and routes the request to the vision backend instead of the default backend.

```
Request with image?
       |
       +-- No  --> Default Backend (VLLM_URL)
       |
       +-- Yes --> Vision Backend (VISION_URL)
```

## Image Detection

Token Gate detects images in both API formats:

**Anthropic format:**
```json
{
  "messages": [{
    "role": "user",
    "content": [
      {"type": "text", "text": "What is this?"},
      {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "..."}}
    ]
  }]
}
```

**OpenAI format:**
```json
{
  "messages": [{
    "role": "user",
    "content": [
      {"type": "text", "text": "What is this?"},
      {"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}}
    ]
  }]
}
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `VISION_URL` | - | Vision backend URL (required for vision routing) |
| `VISION_API_KEY` | - | Vision backend API key |
| `VISION_MODEL` | `gpt-4-vision` | Model name for vision requests |
| `VISION_ANTHROPIC_NATIVE` | `false` | Use Anthropic format for vision backend |

## Backend API Format

The `VISION_ANTHROPIC_NATIVE` setting controls which API format is used when communicating with the vision backend:

### `VISION_ANTHROPIC_NATIVE=false` (default)

Use this when your vision backend uses OpenAI format (Ollama, OpenAI, etc.):

```bash
VISION_URL=https://ollama.example.com \
VISION_MODEL=llava \
npm start
```

Token Gate will:
1. Receive Anthropic format request
2. Convert to OpenAI format
3. Send to vision backend
4. Convert response back to Anthropic format

### `VISION_ANTHROPIC_NATIVE=true`

Use this when your vision backend uses Anthropic format (vLLM with vision support):

```bash
VISION_URL=https://vllm-vision.example.com \
VISION_MODEL=llava-v1.6 \
VISION_ANTHROPIC_NATIVE=true \
npm start
```

Token Gate will forward the request as-is without format conversion.

## Example Setup

### Ollama with LLaVA

```bash
# Start Ollama with LLaVA
ollama run llava

# Start Token Gate
VLLM_URL=https://inference.example.com \
VLLM_MODEL=qwen \
VISION_URL=http://localhost:11434 \
VISION_MODEL=llava \
npm start
```

### vLLM with Vision Model

```bash
VLLM_URL=https://inference.example.com \
VLLM_MODEL=qwen \
VISION_URL=https://vision-vllm.example.com \
VISION_MODEL=llava-v1.6 \
VISION_ANTHROPIC_NATIVE=true \
npm start
```

## Testing Vision Routing

```bash
# Test with OpenAI format
curl http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "model": "test",
    "messages": [{
      "role": "user",
      "content": [
        {"type": "text", "text": "Describe this image"},
        {"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}}
      ]
    }],
    "max_tokens": 100
  }'

# Test with Anthropic format
curl http://localhost:3456/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -d '{
    "model": "test",
    "messages": [{
      "role": "user",
      "content": [
        {"type": "text", "text": "Describe this image"},
        {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "..."}}
      ]
    }],
    "max_tokens": 100
  }'
```

## Telemetry

Vision requests are tracked in telemetry with `hasVision: true`. Check `/stats` endpoint to see vision request statistics.
