import type { AnthropicRequest, AnthropicResponse, BackendConfig, TokenUsage, OpenAIResponse } from '../types/index.js';
import { SSEEnricher } from '../transform/sse-enricher.js';
import { estimateRequestTokens } from '../transform/token-counter.js';
import { convertAnthropicToOpenAI, convertOpenAIToAnthropic } from '../transform/anthropic-to-openai.js';

export interface AnthropicHandlerOptions {
  backend: BackendConfig;
  onTelemetry?: (usage: Omit<TokenUsage, 'totalTokens'>) => void;
}

export async function handleAnthropicRequest(
  request: AnthropicRequest,
  options: AnthropicHandlerOptions
): Promise<AnthropicResponse> {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();
  const { backend, onTelemetry } = options;

  const useOpenAI = backend.anthropicNative === false;

  let result: AnthropicResponse;

  if (useOpenAI) {
    const openaiRequest = convertAnthropicToOpenAI(request);
    openaiRequest.model = backend.model;

    const response = await fetch(`${backend.url}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${backend.apiKey}`,
      },
      body: JSON.stringify(openaiRequest),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Backend error: ${response.status} ${error}`);
    }

    const openaiResult = await response.json() as OpenAIResponse;
    result = convertOpenAIToAnthropic(openaiResult, request.model);
  } else {
    const proxyRequest = { ...request, model: backend.model };

    const response = await fetch(`${backend.url}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${backend.apiKey}`,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(proxyRequest),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Backend error: ${response.status} ${error}`);
    }

    result = await response.json() as AnthropicResponse;
  }

  const hasToolCalls = result.content?.some(c => c.type === 'tool_use') || false;
  const hasVision = request.messages.some(msg => 
    Array.isArray(msg.content) && msg.content.some(block => block.type === 'image')
  );

  if (onTelemetry) {
    onTelemetry({
      requestId,
      timestamp: new Date(),
      backend: backend.name,
      model: backend.model,
      inputTokens: result.usage?.input_tokens || 0,
      outputTokens: result.usage?.output_tokens || 0,
      latencyMs: Date.now() - startTime,
      hasToolCalls,
      hasVision,
    });
  }

  return result;
}

export async function* handleAnthropicStreamingRequest(
  request: AnthropicRequest,
  options: AnthropicHandlerOptions
): AsyncGenerator<string> {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();
  const { backend, onTelemetry } = options;

  const estimatedInputTokens = estimateRequestTokens(request.messages);
  const enricher = new SSEEnricher({ estimatedInputTokens });

  const proxyRequest = { ...request, model: backend.model, stream: true };

  const response = await fetch(`${backend.url}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${backend.apiKey}`,
      'anthropic-version': '2023-06-01',
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

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const enrichedChunk = enricher.processChunk(chunk);
      if (enrichedChunk) yield enrichedChunk;
    }

    const remaining = enricher.flush();
    if (remaining) yield remaining;
  } finally {
    reader.releaseLock();
  }

  if (onTelemetry) {
    const stats = enricher.getStats();
    onTelemetry({
      requestId,
      timestamp: new Date(),
      backend: backend.name,
      model: backend.model,
      inputTokens: stats.inputTokens,
      outputTokens: stats.outputTokens,
      latencyMs: Date.now() - startTime,
      hasToolCalls: stats.hasToolCalls,
      hasVision: request.messages.some(msg => 
        Array.isArray(msg.content) && msg.content.some(block => block.type === 'image')
      ),
    });
  }
}
