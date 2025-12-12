import type { FastifyRequest, FastifyReply } from 'fastify';
import { AnthropicRequestSchema, OpenAIRequestSchema, type RouterConfig } from '../types/index.js';
import type { AnthropicRouter } from '../router.js';

export interface RouteHandlerContext {
  router: AnthropicRouter;
  config: RouterConfig;
}

export function createAnthropicMessagesHandler(ctx: RouteHandlerContext) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    const apiKey = authHeader?.replace('Bearer ', '') || request.headers['x-api-key'];
    
    if (apiKey !== ctx.config.apiKey) {
      reply.code(401);
      return { error: { type: 'authentication_error', message: 'Invalid API key' } };
    }

    const body = AnthropicRequestSchema.parse(request.body);

    try {
      if (body.stream) {
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });
        
        try {
          for await (const chunk of ctx.router.handleAnthropicStreamingRequest(body)) {
            reply.raw.write(chunk);
          }
        } catch (streamError: unknown) {
          const errorEvent = `data: ${JSON.stringify({
            type: 'error',
            error: { type: 'api_error', message: streamError instanceof Error ? streamError.message : 'Unknown error' }
          })}\n\n`;
          reply.raw.write(errorEvent);
        }
        
        reply.raw.end();
        reply.hijack();
        return;
      } else {
        return await ctx.router.handleAnthropicRequest(body);
      }
    } catch (error: unknown) {
      request.log.error({ err: error }, 'Anthropic request failed');
      if (!reply.sent) {
        reply.code(500);
        return { error: { type: 'api_error', message: error instanceof Error ? error.message : 'Unknown error' } };
      }
    }
  };
}

export function createOpenAIChatHandler(ctx: RouteHandlerContext) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    const apiKey = authHeader?.replace('Bearer ', '');
    
    if (apiKey !== ctx.config.apiKey) {
      reply.code(401);
      return { error: { message: 'Invalid API key', type: 'invalid_request_error' } };
    }

    const body = OpenAIRequestSchema.parse(request.body);

    try {
      if (body.stream) {
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });
        
        for await (const chunk of ctx.router.handleOpenAIStreamingRequest(body)) {
          reply.raw.write(chunk);
        }
        
        reply.raw.end();
        reply.hijack();
        return;
      } else {
        return await ctx.router.handleOpenAIRequest(body);
      }
    } catch (error: unknown) {
      request.log.error({ err: error }, 'OpenAI request failed');
      if (!reply.sent) {
        reply.code(500);
        return { error: { message: error instanceof Error ? error.message : 'Unknown error', type: 'api_error' } };
      }
    }
  };
}

export function createHealthHandler() {
  return async () => ({ status: 'ok' });
}

export function createStatsHandler(ctx: RouteHandlerContext) {
  return async () => ctx.router.getTelemetryStats();
}

export function createModelsHandler(ctx: RouteHandlerContext) {
  return async () => ({
    object: 'list',
    data: [{
      id: ctx.config.defaultBackend.model,
      object: 'model',
      created: Date.now(),
      owned_by: 'vllm',
    }],
  });
}
