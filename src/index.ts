import Fastify from 'fastify';
import cors from '@fastify/cors';
import { loadConfig } from './config.js';
import { AnthropicRouter, countTokens } from './router.js';
import type { AnthropicRequest, OpenAIRequest } from './types/index.js';

interface TokenCountRequest {
  messages?: { content: string | { type: string; text?: string; input?: unknown; content?: unknown }[] }[];
  system?: string | { type: string; text?: string }[];
  tools?: { name?: string; description?: string; input_schema?: unknown }[];
}

async function checkBackendHealth(url: string, name: string): Promise<void> {
  const healthUrl = `${url}/health`;
  const modelsUrl = `${url}/v1/models`;
  
  for (const endpoint of [healthUrl, modelsUrl]) {
    try {
      const response = await fetch(endpoint, { method: 'GET', signal: AbortSignal.timeout(5000) });
      // Accept 200 OK or 401 Unauthorized (means server is reachable but requires auth)
      if (response.ok || response.status === 401) {
        console.log(`✅ Backend ${name} reachable at ${endpoint}`);
        return;
      }
    } catch {
      // Try next endpoint
    }
  }
  
  throw new Error(`❌ Backend ${name} unreachable at ${url} - check VLLM_URL`);
}

async function main() {
  const config = loadConfig();
  
  // Verify backend connectivity before starting
  console.log(`🔍 Checking backend connectivity...`);
  await checkBackendHealth(config.defaultBackend.url, config.defaultBackend.name);
  
  if (config.visionBackend) {
    await checkBackendHealth(config.visionBackend.url, config.visionBackend.name);
  }
  
  const router = new AnthropicRouter(config);

  const app = Fastify({
    logger: {
      level: config.logLevel,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true }
      }
    }
  });

  await app.register(cors, { origin: true });

  // Health check
  app.get('/health', async () => ({ status: 'ok' }));

  // Telemetry stats endpoint
  app.get('/stats', async () => router.getTelemetryStats());

  // Models endpoint
  app.get('/v1/models', async () => ({
    object: 'list',
    data: [{
      id: config.defaultBackend.model,
      object: 'model',
      created: Date.now(),
      owned_by: 'vllm',
    }],
  }));

  // Token counting endpoint
  app.post('/v1/messages/count_tokens', async (request) => {
    const body = request.body as TokenCountRequest;
    const { messages = [], system, tools = [] } = body;
    
    let tokenCount = 0;
    
    for (const message of messages) {
      if (typeof message.content === 'string') {
        tokenCount += countTokens(message.content);
      } else if (Array.isArray(message.content)) {
        for (const part of message.content) {
          if (part.type === 'text') tokenCount += countTokens(part.text || '');
          else if (part.type === 'tool_use') tokenCount += countTokens(JSON.stringify(part.input || {}));
          else if (part.type === 'tool_result') {
            tokenCount += countTokens(typeof part.content === 'string' ? part.content : JSON.stringify(part.content || ''));
          }
        }
      }
    }
    
    if (typeof system === 'string') tokenCount += countTokens(system);
    else if (Array.isArray(system)) {
      for (const item of system) {
        if (item.type === 'text' && item.text) tokenCount += countTokens(item.text);
      }
    }
    
    for (const tool of tools) {
      if (tool.name) tokenCount += countTokens(tool.name);
      if (tool.description) tokenCount += countTokens(tool.description);
      if (tool.input_schema) tokenCount += countTokens(JSON.stringify(tool.input_schema));
    }
    
    return { input_tokens: tokenCount };
  });

  // Anthropic /v1/messages endpoint
  app.post('/v1/messages', async (request, reply) => {
    const authHeader = request.headers.authorization;
    const apiKey = authHeader?.replace('Bearer ', '') || request.headers['x-api-key'];
    
    if (apiKey !== config.apiKey) {
      reply.code(401);
      return { error: { type: 'authentication_error', message: 'Invalid API key' } };
    }

    const body = request.body as AnthropicRequest;

    try {
      if (body.stream) {
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });
        
        try {
          for await (const chunk of router.handleAnthropicStreamingRequest(body)) {
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
        return await router.handleAnthropicRequest(body);
      }
    } catch (error: unknown) {
      request.log.error({ err: error }, 'Anthropic request failed');
      if (!reply.sent) {
        reply.code(500);
        return { error: { type: 'api_error', message: error instanceof Error ? error.message : 'Unknown error' } };
      }
    }
  });

  // OpenAI /v1/chat/completions endpoint
  app.post('/v1/chat/completions', async (request, reply) => {
    const authHeader = request.headers.authorization;
    const apiKey = authHeader?.replace('Bearer ', '');
    
    if (apiKey !== config.apiKey) {
      reply.code(401);
      return { error: { message: 'Invalid API key', type: 'invalid_request_error' } };
    }

    const body = request.body as OpenAIRequest;

    try {
      if (body.stream) {
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });
        
        for await (const chunk of router.handleOpenAIStreamingRequest(body)) {
          reply.raw.write(chunk);
        }
        
        reply.raw.end();
        reply.hijack();
        return;
      } else {
        return await router.handleOpenAIRequest(body);
      }
    } catch (error: unknown) {
      request.log.error({ err: error }, 'OpenAI request failed');
      if (!reply.sent) {
        reply.code(500);
        return { error: { message: error instanceof Error ? error.message : 'Unknown error', type: 'api_error' } };
      }
    }
  });

  // Start server
  const host = config.host;
  const port = config.port;
  
  await app.listen({ host, port });
  
  console.log(`🚀 Anthropic Router listening on http://${host}:${port}`);
  console.log(`   Backend: ${config.defaultBackend.url} (${config.defaultBackend.model})`);
  console.log(`   Telemetry: ${config.telemetry.enabled ? 'enabled' : 'disabled'}`);
}

main().catch(console.error);
