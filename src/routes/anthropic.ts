import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import type { AnthropicRequest, OpenAIResponse } from '../types/index.js';
import { callBackend, streamBackend } from '../services/backend.js';
import {
  SSE_HEADERS,
  StatusCodes,
  createApiError,
  formatSseError,
  getBackendAuth,
  calculateTokenCount,
  anthropicToOpenAI,
  openAIToAnthropic,
  convertOpenAIStreamToAnthropic,
  removeUnsupportedTools,
  hashEmail,
} from '../utils/index.js';

// ============================================================================
// Route - Convert Anthropic → OpenAI, call vLLM, convert back
// This uses the OpenAI endpoint where --tool-call-parser mistral works
// ============================================================================

async function anthropicRoutes(app: FastifyInstance): Promise<void> {
  // Token counting endpoint (like claude-code-router)
  app.post('/v1/messages/count_tokens', async (req: FastifyRequest) => {
    const { messages, tools, system } = req.body as {
      messages?: unknown[];
      tools?: unknown[];
      system?: unknown;
    };
    const tokenCount = calculateTokenCount(
      (messages || []) as Parameters<typeof calculateTokenCount>[0],
      system as Parameters<typeof calculateTokenCount>[1],
      tools as Parameters<typeof calculateTokenCount>[2],
    );
    return { input_tokens: tokenCount };
  });

  app.post('/v1/messages', async (req: FastifyRequest, reply: FastifyReply) => {
    const rawBody = req.body as AnthropicRequest;

    // Debug: log tool names
    const tools = (rawBody as { tools?: { name: string }[] }).tools;
    if (tools && tools.length > 0) {
      req.log.debug({ toolNames: tools.map(t => t.name) }, 'Tools in request');
    }

    // Remove unsupported tools (WebSearch - use MCP brave-search instead)
    const anthropicBody = removeUnsupportedTools(rawBody);
    const backend = app.config.defaultBackend;
    const baseUrl = backend.url as string;
    const auth = getBackendAuth(backend, req.headers.authorization) ?? '';
    const model = backend.model || anthropicBody.model;

    // Convert Anthropic → OpenAI format (includes tool ID normalization & trailing assistant fix)
    const openaiPayload = {
      ...anthropicToOpenAI(anthropicBody),
      model,
      ...(backend.temperature !== undefined && { temperature: backend.temperature }),
    };

    // Calculate input tokens for accurate display
    const calculatedInputTokens = calculateTokenCount(
      anthropicBody.messages as Parameters<typeof calculateTokenCount>[0],
      anthropicBody.system as Parameters<typeof calculateTokenCount>[1],
      (anthropicBody as { tools?: unknown[] }).tools as Parameters<typeof calculateTokenCount>[2],
    );

    // Track tokens in metrics with user tag (hash email for privacy)
    const userTag = req.userEmail ? hashEmail(req.userEmail) : 'unknown';
    
    app.metrics.inferenceTokens.inc(
      { user: userTag, model: model, type: 'input' },
      calculatedInputTokens
    );

    req.log.debug({
      calculatedInputTokens,
      messageCount: anthropicBody.messages?.length,
      hasSystem: !!anthropicBody.system,
      toolCount: (anthropicBody as { tools?: unknown[] }).tools?.length || 0,
      stream: anthropicBody.stream,
    }, 'Token count calculation');

    // Debug: log outgoing request
    req.log.debug({
      messageCount: openaiPayload.messages?.length,
      lastMessage: openaiPayload.messages?.[openaiPayload.messages.length - 1],
      toolCount: (openaiPayload as { tools?: unknown[] }).tools?.length,
      maxTokens: (openaiPayload as { max_tokens?: number }).max_tokens,
      stream: openaiPayload.stream,
    }, 'Outgoing OpenAI request to vLLM');

    try {
      if (anthropicBody.stream) {
        return streamViaOpenAI(reply, baseUrl, openaiPayload, auth, model, calculatedInputTokens, app, req);
      }

      // Non-streaming: call OpenAI endpoint and convert response
      const openaiResponse = await callBackend<OpenAIResponse>(
        `${baseUrl}/v1/chat/completions`,
        openaiPayload,
        auth,
      );
      const anthropicResponse = openAIToAnthropic(openaiResponse, model);

      // Debug: log response
      req.log.debug({
        stopReason: anthropicResponse.stop_reason,
        contentLength: anthropicResponse.content?.length,
        content: anthropicResponse.content,
        usage: anthropicResponse.usage,
      }, 'Response from vLLM (converted)');

      // Track output tokens (hash email for privacy)
      if (anthropicResponse.usage?.output_tokens) {
        app.metrics.inferenceTokens.inc(
          { user: userTag, model: model, type: 'output' },
          anthropicResponse.usage.output_tokens
        );
      }

      return anthropicResponse;
    } catch (e) {
      req.log.error({ err: e }, 'Request failed');
      reply.code(StatusCodes.INTERNAL_SERVER_ERROR);
      return createApiError(e instanceof Error ? e.message : 'Unknown error');
    }
  });
}

// ============================================================================
// Streaming - Convert OpenAI SSE → Anthropic SSE
// Uses vLLM's OpenAI endpoint where --tool-call-parser mistral works
// ============================================================================

const streamViaOpenAI = async (
  reply: FastifyReply,
  baseUrl: string,
  openaiBody: Record<string, unknown>,
  auth: string,
  model: string,
  calculatedInputTokens: number,
  app: FastifyInstance,
  req: FastifyRequest,
) => {
  reply.raw.writeHead(200, SSE_HEADERS);

  // Track input tokens for streaming requests
  const userTag = req.userEmail ? hashEmail(req.userEmail) : 'unknown';
  app.metrics.inferenceTokens.inc(
    { user: userTag, model: model, type: 'input' },
    calculatedInputTokens
  );

  try {
    const openaiStream = streamBackend(
      `${baseUrl}/v1/chat/completions`,
      { ...openaiBody, stream: true, stream_options: { include_usage: true } },
      auth,
    );

    // Convert OpenAI SSE stream to Anthropic SSE format
    const anthropicStream = convertOpenAIStreamToAnthropic(openaiStream, model, calculatedInputTokens);

    for await (const chunk of anthropicStream) {
      reply.raw.write(chunk);
      // Extract usage from chunk and track output tokens
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.usage?.output_tokens) {
              app.metrics.inferenceTokens.inc(
                { user: userTag, model: model, type: 'output' },
                parsed.usage.output_tokens
              );
            }
          } catch {
            // Ignore parsing errors
          }
        }
      }
    }
  } catch (e) {
    reply.raw.write(formatSseError(e));
  }

  reply.raw.end();
  reply.hijack();
};

export default fp(anthropicRoutes, { name: 'anthropic-routes' });
