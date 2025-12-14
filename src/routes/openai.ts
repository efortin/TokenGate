import type {FastifyInstance, FastifyReply, FastifyRequest} from 'fastify';
import fp from 'fastify-plugin';

import type {OpenAIRequest, OpenAIResponse} from '../types/index.js';
import {callBackend, streamBackend} from '../services/backend.js';
import {
  SSE_HEADERS,
  StatusCodes,
  createApiError,
  formatSseError,
  getBackendAuth,
  hasOpenAIImages,
  stripOpenAIImages,
  normalizeOpenAIToolIds,
  filterEmptyAssistantMessages,
  sanitizeToolChoice,
  pipe,
  when,
} from '../utils/index.js';

// ============================================================================
// Request Pipeline - vLLM/Mistral compatibility transformations
// ============================================================================

const transform = (useVision: boolean) => pipe<OpenAIRequest>(
  when(!useVision, stripOpenAIImages),
  filterEmptyAssistantMessages,
  normalizeOpenAIToolIds,
  sanitizeToolChoice,
);

// ============================================================================
// Routes
// ============================================================================

async function openaiRoutes(app: FastifyInstance): Promise<void> {
  const getBackend = (useVision: boolean) => 
    useVision && app.config.visionBackend ? app.config.visionBackend : app.config.defaultBackend;

  // Legacy completions - passthrough
  app.post('/v1/completions', handler(app, false));
  app.post('/completions', handler(app, false));

  // Chat completions - with transformations
  app.post('/v1/chat/completions', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as OpenAIRequest;
    const useVision = hasOpenAIImages(body) && !!app.config.visionBackend;
    const backend = getBackend(useVision);
    const baseUrl = backend.url as string;
    const auth = getBackendAuth(backend, req.headers.authorization) ?? '';

    // Pipeline: transform → set model → send
    const transformed = transform(useVision)(body);
    const payload = {...transformed, model: backend.model || body.model};

    try {
      if (body.stream) return stream(reply, baseUrl, payload, auth);
      return await callBackend<OpenAIResponse>(`${baseUrl}/v1/chat/completions`, payload, auth);
    } catch (e) {
      req.log.error({err: e}, 'Request failed');
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
      ? {...transform(false)(body), model: backend.model || body.model}
      : {...body, model: backend.model || (body as {model?: string}).model};

    try {
      if ((body as {stream?: boolean}).stream) return stream(reply, baseUrl, payload, auth);
      return await callBackend(`${baseUrl}/v1/completions`, payload, auth);
    } catch (e) {
      req.log.error({err: e}, 'Request failed');
      reply.code(StatusCodes.INTERNAL_SERVER_ERROR);
      return createApiError(e instanceof Error ? e.message : 'Unknown error');
    }
  };

const stream = async (reply: FastifyReply, baseUrl: string, body: Record<string, unknown>, auth: string) => {
  const url = `${baseUrl}/v1/chat/completions`;
  let gen: AsyncGenerator<string>;

  try {
    gen = streamBackend(url, {...body, stream: true}, auth);
    const first = await gen.next();
    if (first.done) throw new Error('Empty response');
    reply.raw.writeHead(200, SSE_HEADERS);
    reply.raw.write(first.value);
  } catch (e) {
    reply.code(StatusCodes.INTERNAL_SERVER_ERROR);
    return reply.send(createApiError(e instanceof Error ? e.message : 'Backend failed'));
  }

  try {
    for await (const chunk of gen) reply.raw.write(chunk);
  } catch (e) {
    reply.raw.write(formatSseError(e));
  }

  reply.raw.end();
  reply.hijack();
};

export default fp(openaiRoutes, {name: 'openai-routes'});
