import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import type { OpenAIRequest, OpenAIResponse, OpenAIMessage } from '../types/index.js';
import { callBackend, streamBackend } from '../services/backend.js';
import {
  SSE_HEADERS,
  StatusCodes,
  createApiError,
  formatSseError,
  getBackendAuth,
  normalizeOpenAIToolIds,
  filterEmptyAssistantMessages,
  sanitizeToolChoice,
  pipe,
  hashEmail,
  countTokens,
} from '../utils/index.js';

// ============================================================================
// Request Pipeline - vLLM/Mistral compatibility transformations
// ============================================================================

const transform = pipe<OpenAIRequest>(
  filterEmptyAssistantMessages,
  normalizeOpenAIToolIds,
  sanitizeToolChoice,
);

// ============================================================================
// Routes
// ============================================================================

async function openaiRoutes(app: FastifyInstance): Promise<void> {
  // Legacy completions - passthrough
  app.post('/v1/completions', handler(app, false));
  app.post('/completions', handler(app, false));

  // Chat completions - with transformations
  app.post('/v1/chat/completions', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as OpenAIRequest;
    const backend = app.config.defaultBackend;
    const baseUrl = backend.url as string;
    const auth = getBackendAuth(backend, req.headers.authorization) ?? '';

    // Pipeline: transform → set model → apply temperature override if configured
    const payload = {
      ...transform(body),
      model: backend.model || body.model,
      ...(backend.temperature !== undefined && { temperature: backend.temperature }),
    };

    try {
      if (body.stream) return stream(reply, baseUrl, payload, auth, app, req);
      
      const response = await callBackend<OpenAIResponse>(`${baseUrl}/v1/chat/completions`, payload, auth);
      
      // Track metrics (hash email for privacy)
      const userTag = req.userEmail ? hashEmail(req.userEmail) : 'unknown';
      
      const inputTokens = payload.messages.reduce((sum: number, msg: OpenAIMessage) => 
        sum + (typeof msg.content === 'string' ? countTokens(msg.content) : 0), 0
      );
      
      app.metrics.inferenceTokens.inc(
        { user: userTag, model: backend.model || body.model, type: 'input' },
        inputTokens
      );
      
      if (response.usage?.completion_tokens) {
        app.metrics.inferenceTokens.inc(
          { user: userTag, model: backend.model || body.model, type: 'output' },
          response.usage.completion_tokens
        );
      }
      
      return response;
    } catch (e) {
      req.log.error({ err: e }, 'Request failed');
      reply.code(StatusCodes.INTERNAL_SERVER_ERROR);
      return createApiError(e instanceof Error ? e.message : 'Unknown error');
    }
  });
}

// ============================================================================
// Helpers
// ============================================================================

const handler = (app: FastifyInstance, useTransform: boolean) =>
  async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as OpenAIRequest;
    const backend = app.config.defaultBackend;
    const baseUrl = backend.url as string;
    const auth = getBackendAuth(backend, req.headers.authorization) ?? '';
    const payload = useTransform
      ? { ...transform(body), model: backend.model || body.model }
      : { ...body, model: backend.model || (body as { model?: string }).model };

    try {
      if ((body as { stream?: boolean }).stream) return stream(reply, baseUrl, payload, auth, app, req);
      return await callBackend(`${baseUrl}/v1/completions`, payload, auth);
    } catch (e) {
      req.log.error({ err: e }, 'Request failed');
      reply.code(StatusCodes.INTERNAL_SERVER_ERROR);
      return createApiError(e instanceof Error ? e.message : 'Unknown error');
    }
  };

const stream = async (reply: FastifyReply, baseUrl: string, body: Record<string, unknown>, auth: string, app: FastifyInstance, req: FastifyRequest) => {
  const url = `${baseUrl}/v1/chat/completions`;
  let gen: AsyncGenerator<string>;

  // Track input tokens for streaming requests
  const userTag = req.userEmail ? hashEmail(req.userEmail) : 'unknown';
  const model = app.config.defaultBackend.model || (body as { model?: string }).model;
  
  const inputTokens = (body as { messages?: OpenAIMessage[] }).messages?.reduce((sum: number, msg: OpenAIMessage) =>
    sum + (typeof msg.content === 'string' ? countTokens(msg.content) : 0), 0) || 0;
  
  app.metrics.inferenceTokens.inc(
    { user: userTag, model: model, type: 'input' },
    inputTokens
  );

  try {
    gen = streamBackend(url, { ...body, stream: true, stream_options: { include_usage: true } }, auth);
    const first = await gen.next();
    if (first.done) throw new Error('Empty response');
    reply.raw.writeHead(200, SSE_HEADERS);
    reply.raw.write(first.value);
  } catch (e) {
    reply.code(StatusCodes.INTERNAL_SERVER_ERROR);
    return reply.send(createApiError(e instanceof Error ? e.message : 'Backend failed'));
  }

  try {
    for await (const chunk of gen) {
      reply.raw.write(chunk);
      // Try to extract usage from chunk and track output tokens
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.usage?.completion_tokens && !parsed.usage?.prompt_tokens) {
              // This is likely the final usage chunk with completion tokens
              app.metrics.inferenceTokens.inc(
                { user: userTag, model: model, type: 'output' },
                parsed.usage.completion_tokens
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

export default fp(openaiRoutes, { name: 'openai-routes' });
