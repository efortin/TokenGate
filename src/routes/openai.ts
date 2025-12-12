import type {FastifyInstance, FastifyReply} from 'fastify';
import fp from 'fastify-plugin';

import type {OpenAIRequest, OpenAIResponse} from '../types/index.js';
import {callBackend, streamBackend} from '../services/backend.js';

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
} as const;

async function openaiRoutes(app: FastifyInstance): Promise<void> {
  app.post('/v1/chat/completions', async (request, reply) => {
    const startTime = Date.now();
    const user = request.userEmail;
    const body = request.body as OpenAIRequest;
    const authHeader = request.headers.authorization;
    const backend = app.config.defaultBackend;

    try {
      if (body.stream) {
        return handleStream(app, reply, body, authHeader, user, startTime);
      }

      const result = await callBackend<OpenAIResponse>(
        `${backend.url}/v1/chat/completions`,
        {...body, model: backend.model},
        backend.apiKey || authHeader,
      );

      recordMetrics(app, user, backend.model, startTime, 'ok', result.usage);
      return result;
    } catch (error) {
      recordMetrics(app, user, backend.model, startTime, 'error');
      request.log.error({err: error}, 'Request failed');
      reply.code(500);
      return {
        error: {
          type: 'api_error',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  });
}

async function handleStream(
  app: FastifyInstance,
  reply: FastifyReply,
  body: OpenAIRequest,
  authHeader: string | undefined,
  user: string,
  startTime: number,
): Promise<void> {
  const backend = app.config.defaultBackend;
  reply.raw.writeHead(200, SSE_HEADERS);

  try {
    for await (const chunk of streamBackend(
      `${backend.url}/v1/chat/completions`,
      {...body, model: backend.model, stream: true},
      backend.apiKey || authHeader,
    )) {
      reply.raw.write(chunk);
    }
    recordMetrics(app, user, backend.model, startTime, 'ok');
  } catch (error) {
    const errorEvent = `data: ${JSON.stringify({
      error: {
        type: 'api_error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    })}\n\n`;
    reply.raw.write(errorEvent);
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
  usage?: {prompt_tokens: number; completion_tokens: number},
): void {
  app.metrics.requestsTotal.inc({user, model, endpoint: 'openai', status});
  app.metrics.requestDuration.observe(
    {user, model, endpoint: 'openai'},
    (Date.now() - startTime) / 1000,
  );
  if (usage) {
    app.metrics.tokensTotal.inc({user, model, type: 'input'}, usage.prompt_tokens);
    app.metrics.tokensTotal.inc({user, model, type: 'output'}, usage.completion_tokens);
  }
}

export default fp(openaiRoutes, {name: 'openai-routes'});
