import type { BackendConfig, OpenAIRequest, OpenAIResponse, TokenUsage } from '../types/index.js';

export interface OpenAIHandlerOptions {
  backend: BackendConfig;
  onTelemetry?: (usage: Omit<TokenUsage, 'totalTokens'>) => void;
}

export async function handleOpenAIRequest(
  request: OpenAIRequest,
  options: OpenAIHandlerOptions
): Promise<OpenAIResponse> {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();
  const { backend, onTelemetry } = options;

  const proxyRequest = { ...request, model: backend.model };

  const response = await fetch(`${backend.url}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${backend.apiKey}`,
    },
    body: JSON.stringify(proxyRequest),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Backend error: ${response.status} ${error}`);
  }

  const result = await response.json() as OpenAIResponse;
  const hasToolCalls = (result.choices?.[0]?.message?.tool_calls?.length ?? 0) > 0;

  if (onTelemetry) {
    onTelemetry({
      requestId,
      timestamp: new Date(),
      backend: backend.name,
      model: backend.model,
      inputTokens: result.usage?.prompt_tokens || 0,
      outputTokens: result.usage?.completion_tokens || 0,
      latencyMs: Date.now() - startTime,
      hasToolCalls,
      hasVision: false,
    });
  }

  return result;
}

export async function* handleOpenAIStreamingRequest(
  request: OpenAIRequest,
  options: OpenAIHandlerOptions
): AsyncGenerator<string> {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();
  const { backend, onTelemetry } = options;

  const proxyRequest = { ...request, model: backend.model, stream: true };

  const response = await fetch(`${backend.url}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${backend.apiKey}`,
    },
    body: JSON.stringify(proxyRequest),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Backend error: ${response.status} ${error}`);
  }

  if (!response.body) throw new Error('No response body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let inputTokens = 0;
  let outputTokens = 0;
  let hasToolCalls = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });

      for (const line of chunk.split('\n')) {
        if (line.startsWith('data: ') && line.slice(6) !== '[DONE]') {
          try {
            const event = JSON.parse(line.slice(6));
            if (event.usage?.prompt_tokens) inputTokens = event.usage.prompt_tokens;
            if (event.usage?.completion_tokens) outputTokens = event.usage.completion_tokens;
            if (event.choices?.[0]?.delta?.tool_calls) hasToolCalls = true;
          } catch {
            // Ignore
          }
        }
      }

      yield chunk;
    }
  } finally {
    reader.releaseLock();
  }

  if (onTelemetry) {
    onTelemetry({
      requestId,
      timestamp: new Date(),
      backend: backend.name,
      model: backend.model,
      inputTokens,
      outputTokens,
      latencyMs: Date.now() - startTime,
      hasToolCalls,
      hasVision: false,
    });
  }
}
