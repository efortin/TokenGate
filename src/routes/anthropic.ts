import type {FastifyInstance, FastifyReply} from 'fastify';
import fp from 'fastify-plugin';

import type {AnthropicRequest, OpenAIResponse} from '../types/index.js';
import {callBackend, streamBackend} from '../services/backend.js';
import {
  SSE_HEADERS,
  StatusCodes,
  createApiError,
  formatSseError,
  getBackendAuth,
  hasAnthropicImages,
  stripAnthropicImages,
  anthropicToOpenAI,
  openAIToAnthropic,
  injectWebSearchPrompt,
  convertOpenAIStreamToAnthropic,
  estimateRequestTokens,
} from '../utils/index.js';

async function anthropicRoutes(app: FastifyInstance): Promise<void> {
  app.post('/v1/messages', async (request, reply) => {
    const startTime = Date.now();
    const user = request.userEmail;
    const body = request.body as AnthropicRequest;
    const authHeader = request.headers.authorization;

    const visionBackend = app.config.visionBackend;
    const useVision = hasAnthropicImages(body) && !!visionBackend;
    const backend = useVision && visionBackend ? visionBackend : app.config.defaultBackend;

    try {
      if (body.stream) {
        return handleStream(app, reply, body, backend, useVision, authHeader, user, startTime);
      }

      // Always convert to OpenAI format for Mistral compatibility
      const openaiReq = anthropicToOpenAI(
        injectWebSearchPrompt(stripAnthropicImages(body)),
        {useVisionPrompt: useVision},
      );
      request.log.debug({openaiMessages: JSON.stringify(openaiReq.messages)}, 'Converted to OpenAI format');
      const openaiRes = await callBackend<OpenAIResponse>(
        `${backend.url}/v1/chat/completions`,
        {...openaiReq, model: backend.model || body.model},
        getBackendAuth(backend, authHeader),
      );
      const result = openAIToAnthropic(openaiRes, backend.model || body.model);
      recordMetrics(app, user, backend.model, startTime, 'ok', result.usage);
      return result;
    } catch (error) {
      recordMetrics(app, user, backend.model, startTime, 'error');
      request.log.error({err: error}, 'Request failed');
      reply.code(StatusCodes.INTERNAL_SERVER_ERROR);
      return createApiError(error instanceof Error ? error.message : 'Unknown error');
    }
  });
}

async function handleStream(
  app: FastifyInstance,
  reply: FastifyReply,
  body: AnthropicRequest,
  backend: {url: string; apiKey: string; model: string},
  useVision: boolean,
  authHeader: string | undefined,
  user: string,
  startTime: number,
): Promise<void> {
  reply.raw.writeHead(200, SSE_HEADERS);

  try {
    // Always use OpenAI format for Mistral compatibility
    const processedBody = injectWebSearchPrompt(stripAnthropicImages(body));
    const openaiReq = anthropicToOpenAI(processedBody, {useVisionPrompt: useVision});
    const reqBody = {...openaiReq, model: backend.model || body.model, stream: true};

    // Estimate input tokens from full OpenAI request (includes system prompt)
    const estimatedInputTokens = estimateRequestTokens(openaiReq.messages);

    // Convert OpenAI stream to Anthropic format
    const openaiStream = streamBackend(`${backend.url}/v1/chat/completions`, reqBody, getBackendAuth(backend, authHeader));
    for await (const chunk of convertOpenAIStreamToAnthropic(openaiStream, backend.model || body.model, estimatedInputTokens)) {
      reply.raw.write(chunk);
    }
    recordMetrics(app, user, backend.model, startTime, 'ok');
  } catch (error) {
    app.log.error({err: error, user, model: backend.model}, 'Streaming request failed');
    reply.raw.write(formatSseError(error));
    recordMetrics(app, user, backend.model, startTime, 'error');
  }

  reply.raw.end();
  reply.hijack();
}

function recordMetrics(
  app: FastifyInstance,
  user: string,
  model: string,
  startTime: number,
  status: string,
  usage?: {input_tokens: number; output_tokens: number},
): void {
  app.metrics.requestsTotal.inc({user, model, endpoint: 'anthropic', status});
  app.metrics.requestDuration.observe(
    {user, model, endpoint: 'anthropic'},
    (Date.now() - startTime) / 1000,
  );
  if (usage) {
    app.metrics.tokensTotal.inc({user, model, type: 'input'}, usage.input_tokens);
    app.metrics.tokensTotal.inc({user, model, type: 'output'}, usage.output_tokens);
  }
}

export default fp(anthropicRoutes, {name: 'anthropic-routes'});
