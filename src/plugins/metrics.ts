import type {FastifyInstance, FastifyRequest} from 'fastify';
import fp from 'fastify-plugin';
import {Registry, Counter, Histogram, collectDefaultMetrics} from 'prom-client';

declare module 'fastify' {
  interface FastifyRequest {
    userEmail: string;
  }
  interface FastifyInstance {
    metrics: {
      requestsTotal: Counter;
      requestDuration: Histogram;
      tokensTotal: Counter;
      registry: Registry;
    };
  }
}

async function metricsPlugin(app: FastifyInstance): Promise<void> {
  const registry = new Registry();
  collectDefaultMetrics({register: registry});

  const requestsTotal = new Counter({
    name: 'llm_requests_total',
    help: 'Total LLM API requests',
    labelNames: ['user', 'model', 'endpoint', 'status'],
    registers: [registry],
  });

  const requestDuration = new Histogram({
    name: 'llm_request_duration_seconds',
    help: 'LLM request duration in seconds',
    labelNames: ['user', 'model', 'endpoint'],
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
    registers: [registry],
  });

  const tokensTotal = new Counter({
    name: 'llm_tokens_total',
    help: 'Total tokens processed',
    labelNames: ['user', 'model', 'type'],
    registers: [registry],
  });

  app.decorate('metrics', {requestsTotal, requestDuration, tokensTotal, registry});

  app.addHook('onRequest', async (request: FastifyRequest) => {
    request.userEmail =
      (request.headers['x-user-mail'] as string) || 'anonymous';
  });

  app.get('/metrics', async (_request, reply) => {
    reply.header('Content-Type', registry.contentType);
    return registry.metrics();
  });
}

export default fp(metricsPlugin, {name: 'metrics'});
