import type {FastifyInstance} from 'fastify';
import fp from 'fastify-plugin';

async function systemRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({status: 'ok'}));

  app.get('/v1/models', async () => ({
    object: 'list',
    data: [
      {
        id: app.config.defaultBackend.model,
        object: 'model',
        created: Date.now(),
        owned_by: 'vllm',
      },
    ],
  }));
}

export default fp(systemRoutes, {name: 'system-routes'});
